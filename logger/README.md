# @hopae/logger

Structured, trace-correlated logging for Node/TypeScript microservices.

A thin wrapper over [Pino](https://getpino.io) that implements the MVP of the
[design doc](../DESIGNDOC.md): one JSON schema, automatic cross-service
correlation via W3C `traceparent`, and redaction by default.

To run tests and demos, see the [root README](../README.md).

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

## Usage

Wire the middleware once at request start. Every log inside that request gets
`trace_id` / `span_id` automatically — no manual threading.

Exports:

- `@hopae/logger` — core logger
- `@hopae/logger/http` — connect-style middleware + outbound header helper
- `@hopae/logger/nestjs` — NestJS module, middleware, and interceptor  
  (`@nestjs/common` and `rxjs` are optional peers)

### Express

```ts
import express from "express";
import { createLogger } from "@hopae/logger";
import {
  traceContextMiddleware,
  outboundTraceHeaders,
} from "@hopae/logger/http";

const logger = createLogger({ service: "orders-api" });
const app = express();
app.use(traceContextMiddleware());

app.get("/order/:id", async (req, res) => {
  logger.info("order received"); // includes trace_id + span_id automatically

  const r = await fetch("http://inventory/checks", {
    headers: outboundTraceHeaders(), // continue the same trace downstream
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

## Redaction

Sensitive keys are redacted deeply by default (case- and separator-insensitive):

```ts
logger.info("login", { email: "a@b.com", password: "x" });
// context: { "email": "[REDACTED]", "password": "[REDACTED]" }
```

Override the deny-list with `createLogger({ redact: [...] })`.

## Package layout

```
src/
  types.ts, context.ts, trace.ts, redaction.ts, logger.ts, index.ts  → @hopae/logger
  http/     → @hopae/logger/http
  nestjs/   → @hopae/logger/nestjs
examples/   → Express and NestJS demos
```

## Scope

MVP only: structured logs, HTTP correlation, redaction. Full tracing spans,
metrics, and queue propagation are deferred — see the design doc.
