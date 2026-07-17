# Design Doc: Structured Logging & Request Tracing for Microservices

|                    |                                                         |
| ------------------ | ------------------------------------------------------- |
| **Status**         | Proposed                                                |
| **Author**         | Luiz                                                    |
| **Target metrics** | MTTD (mean time to detect), MTTR (mean time to resolve) |

---

## 1. Problem Definition

We recently moved from a monolith to microservices. In the last month we had **5 production incidents that we learned about from users or CS first**, with an **average response time of ~4 hours**. Each service logs with `console.log`, and the split has surfaced concrete failures.

### 1.1 Observed pains

The reported symptoms cluster into a small number of **root problems**:

| #   | Root problem                          | Symptoms from the field                                                                                          |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P1  | **No request traceability**           | A single request crosses multiple services, but there is no way to follow its flow end to end.                   |
| P2  | **Inconsistent, unsearchable format** | Every service logs differently, so we cannot search across them.                                                 |
| P3  | **No centralization**                 | To find an error we manually open logs on each service, one at a time.                                           |
| P4  | **No signal/noise discipline**        | Some services log every variable and call; others log almost nothing. There is no answer to "what should I log?" |
| P5  | **No proactive detection**            | Engineers hear about production errors from users/CS, not from our systems.                                      |
| P6  | **No log lifecycle**                  | A server went down when disk filled with logs, yet we still need weeks-old logs for investigations.              |

### 1.2 Core problems this system must solve

1. **Detection** — the system, not the user, must tell us when something breaks (P5).
2. **Traceability** — one identifier must follow a request across all services (P1).
3. **Consistency & searchability** — one schema, one central place to query (P2, P3).
4. **Governance** — a clear, followable standard for _what_ and _how_ to log, plus a retention policy that never fills disk yet keeps history (P4, P6).

> **Framing.** The prompt says "logging," but the business pain — _"users tell us first, and it takes 4 hours"_ — is a broken **MTTD/MTTR**. Structured logging is necessary but not sufficient; it must be paired with **trace correlation**, **centralized aggregation**, and **baseline alerting**. This document is scoped as a _pragmatic observability foundation_, not a full APM platform.

---

## 2. Goals and Non-goals

### 2.1 Goals

- **G1 — Cut MTTD from hours to minutes.** Systems alert us on error spikes and new failures before users report them.
- **G2 — One correlated trace per request.** A `trace_id` propagates across every service (and from the frontend) so one query reconstructs a request's full path.
- **G3 — One log schema, one queryable store.** All services emit the same structured JSON; all logs are searchable in one place (Kibana).
- **G4 — Answer "what should I log?"** A written guideline (levels + required fields + what-to-log-where) that a new hire can follow on day one.
- **G5 — Safe, bounded retention.** Tiered lifecycle so disk never fills, while weeks-old logs remain queryable.
- **G6 — Low adoption friction.** A shared TypeScript library that a service adopts in minutes; correlation is automatic, not hand-threaded.
- **G7 — No sensitive data in logs.** PII, credentials, and tokens are redacted by default — a first-class concern given our identity domain.

### 2.2 Non-goals (explicitly deferred)

- **Full distributed tracing (spans/waterfalls).** MVP propagates a correlation/trace ID; span-level tracing is a later phase (the schema is already OTel-aligned to make this cheap).
- **Metrics & dashboards / full APM.** RED/USE metrics, latency histograms, and business dashboards are out of scope for v1.
- **A security SIEM / audit-log system.** Compliance auditing is a separate concern with separate retention/access rules.
- **Migrating historical logs.** We start forward-looking; we do not backfill old `console.log` output.
- **Replacing the existing stack.** We build on the team's current Elastic Stack + AWS CloudWatch rather than introducing a new observability platform.

---

## 3. Proposed Design

### 3.1 Overall architecture

We keep applications ignorant of where logs go: they emit structured JSON to **stdout** (12-factor), and the platform ships, stores, and queries it. This decouples app code from infrastructure and lets us evolve the pipeline without redeploying services.

```
┌─────────────────────────────┐
│  Service (NestJS)           │
│   └─ @hopae/logger (Pino)   │  ── structured JSON ──▶ stdout
└─────────────────────────────┘
                │  (k8s captures container stdout)
                ▼
┌─────────────────────────────┐
│  Fluent Bit (DaemonSet)     │  parse JSON, add k8s metadata, route
└─────────────────────────────┘
        │                     │
        ▼                     ▼
┌──────────────────┐   ┌────────────────────┐
│ Elasticsearch    │   │ AWS CloudWatch     │
│ (app logs, ELK)  │   │ (infra/platform,   │
│                  │   │  AWS-native alarms)│
└──────────────────┘   └────────────────────┘
        │                     │
        ▼                     ▼
┌──────────────────┐   ┌───────────────────┐
│ Kibana           │   │ Alerting          │
│ (search/query)   │   │ (Kibana + CW) →   │
│                  │   │ Slack / PagerDuty │
└──────────────────┘   └───────────────────┘
```

**Why this pipeline:** it maps onto tooling the team already runs (ELK + CloudWatch) on our existing Kubernetes-on-AWS platform, so the win comes from _standardization and consolidation_, not a new vendor. App logs go to Elasticsearch for rich search (fixes P2/P3); infra/platform logs and AWS-native alarms use CloudWatch.

### 3.2 Log format and structure

All logs are **single-line JSON**, one event per line, with a shared schema aligned to the **OpenTelemetry log data model** (so the same fields feed Elastic APM / tracing later at near-zero cost).

```json
{
  "timestamp": "2026-07-15T01:02:03.456Z",
  "level": "error",
  "service": "payments-api",
  "env": "production",
  "version": "1.8.2",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "message": "Failed to capture payment",
  "context": { "userId": "u_123", "orderId": "o_789", "amountCents": 4200 },
  "error": {
    "type": "PaymentGatewayTimeout",
    "message": "upstream timed out after 5000ms",
    "stack": "..."
  }
}
```

| Field                       | Required  | Purpose                                                                          |
| --------------------------- | --------- | -------------------------------------------------------------------------------- |
| `timestamp`                 | yes       | ISO-8601 UTC; consistent ordering across services.                               |
| `level`                     | yes       | `fatal`/`error`/`warn`/`info`/`debug`/`trace`.                                   |
| `service`, `env`, `version` | yes       | Where/what emitted it; enables per-service, per-deploy filtering.                |
| `trace_id` / `span_id`      | yes       | Correlation across services (generated if absent at the edge).                   |
| `message`                   | yes       | Human-readable, low-cardinality summary.                                         |
| `context`                   | optional  | Structured, business-relevant key/values (never free-form string concatenation). |
| `error`                     | on errors | Normalized error object: `type`, `message`, `stack`.                             |

**Rules:** no string interpolation of data into `message` (put data in `context`); `message` stays low-cardinality so it groups well; every field name is stable and documented.

### 3.3 How we trace a request across services

We adopt the **W3C Trace Context** standard (the `traceparent` HTTP header).

1. **Edge / frontend** generates a `trace_id` (or reuses one from the browser session) and sends it as `traceparent` on the first request.
2. **Each service** extracts `traceparent` from the inbound request. If absent, it generates one.
3. The `trace_id` is stored in an `**AsyncLocalStorage`** context for the lifetime of the request, so **every log line automatically carries it\*\* — engineers never thread it manually. This is the key adoption lever (G6).
4. On **outbound** calls (HTTP, and later message queues), the service injects the current `traceparent` so the next hop continues the same trace.

Result: `trace_id:4bf92...` in Kibana returns the full, ordered story of one request across all services — directly fixing P1.

> Async/queue propagation (e.g. SQS/Kafka message headers) follows the same pattern and is noted as a fast-follow, not MVP.

### 3.4 Collection, storage, and querying

- **Collect:** apps write JSON to stdout; a **Fluent Bit** DaemonSet on each node tails container logs, enriches with Kubernetes metadata (pod, namespace, node), and routes app logs → Elasticsearch, infra/platform → CloudWatch.
- **Store:** Elasticsearch with **ILM (Index Lifecycle Management)** for tiered retention (see §3.6).
- **Query:** Kibana for ad-hoc search and saved queries (by `trace_id`, `service`, `level`, `error.type`).

### 3.5 Baseline alerting (the MTTD fix, G1)

A small, high-signal set to start — the point is to _close the detection gap_, not to build dashboards:

1. **Error-rate spike** — `level:error` for a service exceeds its baseline over N minutes → page.
2. **New error signature** — a previously unseen `error.type` appears in production → notify.
3. **Fatal / crash-loop & ingestion health** — any `fatal`, or the log pipeline itself stops receiving data → page.

Routed to Slack (warn) and PagerDuty (page). Alerting lives in Kibana (app) + CloudWatch Alarms (infra).

### 3.6 Policies & guidelines

**Log-level guideline — the answer to "what should I log?" (P4, G4):**

| Level           | Log when…                                                  | Examples                                                           |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `error`/`fatal` | An operation failed and needs attention                    | unhandled exception, failed downstream call, data corruption       |
| `warn`          | Recoverable/unexpected but handled                         | retry, fallback used, deprecated path hit                          |
| `info`          | Meaningful business/lifecycle events (**default in prod**) | request received/completed, state transition, job started/finished |
| `debug`/`trace` | Developer detail (**off in prod by default**)              | variable values, branch decisions                                  |

Principle: **log at boundaries** (inbound request, outbound call, state change, error) — _not_ every variable or function call. High-volume paths may **sample** `info`. Prod level is `info` by default, tunable per-service via env var.

**Sensitive-data policy (G7):** the shared logger **redacts by default** a deny-list of keys (`authorization`, `password`, `token`, `secret`, `cookie`, plus identity fields like `ssn`, `email`, credential/claim payloads). Given Hopae's identity domain, the default is _redact_, and logging PII requires an explicit, reviewed opt-in.

**Retention policy (P6, G5):** Elasticsearch ILM, so disk never fills yet history stays queryable:

| Tier           | Age        | Storage                                          |
| -------------- | ---------- | ------------------------------------------------ |
| Hot            | 0–7 days   | fast, fully searchable                           |
| Warm           | 8–30 days  | downsized, searchable                            |
| Cold / archive | 31–90 days | Elasticsearch cold or S3 (via CloudWatch export) |
| Delete         | > 90 days  | auto-deleted by ILM                              |

---

## 4. Alternatives Considered

| Option                            | Considered approach                                           | Why not chosen                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Do nothing / conventions only** | Ask teams to "log better" with `console.log`                  | No enforcement, no correlation, no detection. Fixes nothing measurable.                                                                                                                                                                                 |
| **Custom correlation header**     | Generate a UUID per request and pass it as `x-correlation-id` | Simpler initially, but we'd be inventing our own format. Using the W3C `traceparent` standard (already supported by Elasticsearch, Datadog, and other tools) means we can upgrade to full distributed tracing later without changing the header format. |
| **Grafana Loki + Grafana**        | Cheaper (label-only indexing) log store                       | Would introduce a _second_ observability stack alongside the team's existing ELK — new runbooks, new expertise, more ops. Consolidation on ELK outweighs the storage savings.                                                                           |
| **Managed SaaS (Datadog, etc.)**  | Lowest ops burden                                             | Highest recurring cost and a new vendor; the team already operates ELK + CloudWatch.                                                                                                                                                                    |
| **Per-team library choice**       | Let each service pick Winston/Pino/etc.                       | Reproduces the format-fragmentation problem (P2). A single shared library is the point.                                                                                                                                                                 |

**Chosen:** OpenTelemetry-aligned structured logging via a **shared Pino-based TypeScript library**, shipped through **Fluent Bit** into the team's existing **Elastic Stack** (+ CloudWatch for infra), with **baseline alerting** and **written policy**. It maximizes MTTD reduction per unit of effort while reusing tooling the team already knows.

---

## 5. Trade-offs and Constraints

- **Cost / storage.** Elasticsearch is heavier per-GB than label-indexed stores; verbose logging and high index cardinality get expensive. Mitigated by the level guideline, sampling, and ILM retention.
- **Ops burden.** Self-hosted ELK requires capacity and lifecycle management. Accepted because the team already runs it; we add ILM discipline rather than a new system.
- **Runtime performance.** Logging has non-zero CPU/IO cost. Pino (async, low-overhead JSON) plus prod default of `info` keeps it small; `debug`/`trace` stay off in prod.
- **Sampling loses data.** Sampling high-volume `info` reduces cost but can drop a line you later wanted. `error`/`warn` are **never** sampled.
- **Adoption / migration.** Every service must adopt the library and stop using `console.log`. Mitigated by the drop-in NestJS integration and automatic context (low friction), rolled out service-by-service.
- **Cardinality discipline.** `context` must hold structured values, not unbounded free-form strings, or search/index cost balloons. Enforced by the schema and guideline.

---

## 6. Implementation Plan

Prioritized by **MTTD-reduction per unit of effort** — do the things that most quickly make systems (not users) the first to know.

### 6.1 MVP (v1)

1. **Shared logger library** (`@hopae/logger`) — Pino-based, structured schema, log levels, default redaction, framework-agnostic core + NestJS integration.
2. **Automatic trace correlation** — `traceparent` extract/generate + `AsyncLocalStorage` so every line carries `trace_id`.
3. **Central pipeline** — Fluent Bit → Elasticsearch; searchable in Kibana.
4. **Baseline alerts** — the three in §3.5.
5. **Retention** — Elasticsearch ILM per §3.6.
6. **The guideline doc** — levels, required fields, PII policy (answers P4).

_Rationale:_ items 1–4 together are what convert "users tell us first, 4 hours" into "systems tell us in minutes." Items 5–6 prevent regression (disk outages, format drift).

### 6.2 Later (v2+)

- **Full distributed tracing** (spans/waterfalls) via OTel Collector → Elastic APM — the schema is already aligned, so this is incremental.
- **Metrics & dashboards** (RED/USE), log-based **SLOs/error budgets**.
- **Queue/async trace propagation** (SQS/Kafka headers).
- **Automated, org-wide redaction enforcement** and PII scanning in CI.
- **Cold-storage archival** to S3 with restore-on-demand for old investigations.

### 6.3 Rollout

Pilot on 1–2 high-traffic services (fastest signal), validate end-to-end trace + alerts, publish the guideline, then adopt service-by-service. Definition of done for a service: no `console.log`, emits the schema, propagates `traceparent`.
