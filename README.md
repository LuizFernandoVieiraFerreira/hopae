# Incident Response: Structured Logging & Request Tracing

## Overview

This submission has two parts, addressing the "learn about errors from users
first / 4-hour response time" problem:

1. **Design document** — [`DESIGNDOC.md`](./DESIGNDOC.md):
   a proposal to standardize structured, trace-correlated logging across our
   microservices, aggregate it centrally, and close the detection gap with
   baseline alerting. It covers the problem, goals/non-goals, architecture, log
   schema, request tracing, retention & PII policies, alternatives, trade-offs,
   and a phased implementation plan.

2. **Implementation** — [`logger/`](./logger): `@hopae/logger`, a working
   TypeScript npm package that implements the MVP slice of the design. It is a
   thin, opinionated wrapper over [Pino](https://getpino.io) providing one log
   schema, automatic cross-service trace correlation, and redaction by default —
   importable by any Node service (framework-agnostic, with an optional NestJS
   integration).

## Getting Started

The implementation lives in [`logger/`](./logger).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the tests:

   ```bash
   npm test
   ```

3. See it work end to end (one request across two services, one shared
   `trace_id`, sensitive fields redacted):
   ```bash
   npm run demo        # plain Express
   npm run demo:nest   # same demo built with NestJS
   ```

Other useful scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # bundle to dist/ (ESM + CJS + type declarations)
```

## Details

- **Structured logs** — every service emits the same single-line JSON schema
  (`timestamp`, `level`, `service`, `env`, `version`, `trace_id`, `span_id`,
  `message`, `context`, `error`), aligned to the OpenTelemetry log data model.
- **Automatic request tracing** — a `trace_id` follows a request across services
  with zero manual threading, using `AsyncLocalStorage` + W3C Trace Context
  (`traceparent`).
- **Redaction by default** — credentials, tokens, and PII are redacted
  automatically (deep, cycle-safe), a first-class concern for the identity domain.
- **Framework-agnostic core + adapters** — a single package with subpath exports:
  - `@hopae/logger` — the core logger.
  - `@hopae/logger/http` — connect-style trace middleware + outbound header helper.
  - `@hopae/logger/nestjs` — `LoggerModule`, `TraceContextMiddleware`, and a
    boundary-logging `LoggingInterceptor`.
- **12-factor** — logs go to stdout; shipping and storage (Fluent Bit →
  Elasticsearch / CloudWatch) are the platform's responsibility, as described in
  the design doc.

For full usage and API details, see the package README:
[`logger/README.md`](./logger/README.md).

## Note

This is a scoped reference implementation meant to demonstrate the design's key
decisions, not a production-hardened library — see the design doc's non-goals and
phased plan for what is intentionally deferred.

If you require any further clarification or additional information regarding the
design or the code, please do not hesitate to contact me.
