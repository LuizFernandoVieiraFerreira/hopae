# @hopae/logger

Structured, trace-correlated logging for Node/TypeScript microservices.

A thin, opinionated wrapper over [Pino](https://getpino.io) that implements the
[Structured Logging & Request Tracing design doc](../DESIGNDOC.md):
one JSON schema, automatic cross-service trace correlation, sensitive-data
redaction by default, and a single stable API shared by every service.

This package is a **reference implementation** of the design's core: it
demonstrates the key decisions, not a production-hardened library.

## Why this exists

- **One schema, everywhere** — every service emits the same JSON shape, so logs
  are searchable in one place (fixes format drift + per-service log hunting).
- **Automatic trace correlation** — a `trace_id` follows a request across
  services with **zero manual threading**, using `AsyncLocalStorage` + W3C
  Trace Context. This is the headline feature.
- **Safe by default** — credentials, tokens, and PII are redacted automatically
  (critical for an identity domain).
- **12-factor** — logs go to stdout as single-line JSON; shipping/storage is the
  platform's job (Fluent Bit → Elasticsearch / CloudWatch).

## Install

```bash
npm install @hopae/logger pino
```

`@nestjs/common` and `rxjs` are optional peers, only needed for the `/nestjs` entry.

## Quick start

```ts
import { createLogger } from "@hopae/logger";

const logger = createLogger({
  service: "payments-api",
  version: "1.8.2",
  // level + env default to LOG_LEVEL / NODE_ENV
});

logger.info("payment captured", { orderId: "o_789", amountCents: 4200 });
logger.error("capture failed", new Error("gateway timeout"), {
  orderId: "o_789",
});
```

Output (one line per event):

```json
{
  "level": "info",
  "service": "payments-api",
  "env": "development",
  "version": "1.8.2",
  "message": "payment captured",
  "context": { "orderId": "o_789", "amountCents": 4200 },
  "timestamp": "2026-07-15T01:02:03.456Z"
}
```

## Log schema

| Field                       | When             | Notes                                         |
| --------------------------- | ---------------- | --------------------------------------------- |
| `timestamp`                 | always           | ISO-8601 UTC                                  |
| `level`                     | always           | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `service`, `env`, `version` | always           | base fields                                   |
| `trace_id`, `span_id`       | inside a request | auto-injected from context                    |
| `message`                   | always           | low-cardinality summary                       |
| `context`                   | optional         | structured business data (redacted)           |
| `error`                     | on errors        | `{ type, message, stack }`                    |

## Request tracing

Establish context once at the edge; every log line inside the request is
correlated automatically.

### Express / any connect-style app

```ts
import express from "express";
import {
  traceContextMiddleware,
  outboundTraceHeaders,
} from "@hopae/logger/http";

const app = express();
app.use(traceContextMiddleware()); // reads/creates `traceparent`, seeds context

app.get("/order/:id", async (req, res) => {
  logger.info("order received"); // includes trace_id + span_id automatically

  // forward the trace to downstream services:
  const r = await fetch("http://inventory/checks", {
    headers: outboundTraceHeaders(),
  });
  res.json(await r.json());
});
```

### NestJS

```ts
import { Module, MiddlewareConsumer } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import {
  LoggerModule,
  TraceContextMiddleware,
  LoggingInterceptor,
} from "@hopae/logger/nestjs";

@Module({
  imports: [LoggerModule.forRoot({ service: "orders-api", version: "1.0.0" })],
  providers: [{ provide: APP_INTERCEPTOR, useExisting: LoggingInterceptor }],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceContextMiddleware).forRoutes("*");
  }
}
```

`HopaeLoggerService` also implements Nest's `LoggerService`, so you can
`app.useLogger(app.get(HopaeLoggerService))` to route framework logs through
the same schema.

## Redaction

Sensitive keys are redacted deeply by default (case- and separator-insensitive,
so `access_token`, `accessToken`, and `AccessToken` all match):

```ts
logger.info("login", { email: "a@b.com", password: "x" });
// context: { "email": "[REDACTED]", "password": "[REDACTED]" }
```

Override the deny-list per logger via `createLogger({ redact: [...] })`.

## Adding correlation fields mid-request

```ts
import { addContext } from "@hopae/logger";

// after authentication:
addContext({ userId: "u_123" }); // now attached to every subsequent log line
```

## Scripts

```bash
npm run test       # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # bundle to dist (ESM + CJS + d.ts) via tsup
npm run demo       # two-service trace-propagation demo (Express)
npm run demo:nest  # same demo built with NestJS
```

## Demos

Both start an `orders` service that calls an `inventory` service, send one
request through both, and print logs sharing a single `trace_id` — plus a
redacted `authorization` field.

- `npm run demo` — plain Express. See [`examples/trace-demo.ts`](./examples/trace-demo.ts).
- `npm run demo:nest` — NestJS, using `LoggerModule`, `TraceContextMiddleware`,
  and the boundary-logging `LoggingInterceptor`. See
  [`examples/nestjs-trace-demo.ts`](./examples/nestjs-trace-demo.ts).

## Architecture

The `src/` layer is organized so that Pino is quarantined inside a single file
and everything depends only on the layers beneath it.

```
                         types.ts
              (LogLevel, LogContext, Logger, LoggerOptions)
                            ▲  the contract
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   context.ts           trace.ts          redaction.ts
 (AsyncLocalStorage   (W3C traceparent   (deep, cycle-safe
  request context)     parse/generate)    sensitive-key scrub)
        └───────────────────┼───────────────────┘
                            │  composed by
                            ▼
                        logger.ts
        (createLogger over Pino; `mixin` injects trace
         context; nests + redacts `context`; serializes errors)
                            │  re-exported by
                            ▼
                        index.ts   ── public entry: @hopae/logger
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        http/index.ts               nestjs/index.ts
   (@hopae/logger/http)          (@hopae/logger/nestjs)
   connect-style trace           LoggerModule + TraceContextMiddleware
   middleware + outbound         + LoggingInterceptor + HopaeLoggerService
   header helper
```

| File              | Layer       | Purpose                                                                                               |
| ----------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `types.ts`        | contract    | Public `Logger` interface + option/schema types. No imports — the root of the graph.                  |
| `context.ts`      | primitive   | `AsyncLocalStorage`-backed per-request trace context. Enables correlation with zero manual threading. |
| `trace.ts`        | primitive   | W3C Trace Context IDs + `traceparent` parse/format.                                                   |
| `redaction.ts`    | primitive   | Deep, cycle-safe, depth-bounded redactor with normalized key matching.                                |
| `logger.ts`       | core        | Composes the three primitives on top of Pino; the only file that imports Pino.                        |
| `index.ts`        | entry       | Public surface (`@hopae/logger`) — core + context + trace + redaction.                                |
| `http/index.ts`   | integration | Framework-agnostic trace middleware (inbound) + `outboundTraceHeaders()` (outbound).                  |
| `nestjs/index.ts` | integration | NestJS module, middleware, boundary-logging interceptor, and `LoggerService` adapter.                 |

Each layer only knows about the ones below it, and callers depend on the
`Logger` interface — so the underlying engine could be swapped without touching
a single call site.

## Scope

This is the MVP slice of the design. Deliberately **not** included: full
distributed tracing spans, metrics, log shipping/transport (that's Fluent Bit's
job), and async/queue propagation — all discussed as later phases in the design
doc.
