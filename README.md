# Incident Response: Structured Logging & Request Tracing

## Overview

This repository was built as a technical assignment for Hopae's application
process. The assignment asks for a design document proposing a solution for
structured logging and request tracing across microservices, plus a TypeScript
logging module based on that design — so this submission has two parts:

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

1. Enter the package directory:

   ```bash
   cd logger
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the tests:

   ```bash
   npm test
   ```

4. Run the demos (one request across two services, one shared `trace_id`, sensitive fields redacted):

   ```bash
   npm run demo        # Express
   npm run demo:nest   # NestJS (same flow, plus request boundary logs)
   ```

Other useful scripts:

```bash
npm run typecheck
npm run build
```

## Note

This is a scoped reference implementation meant to demonstrate the design's key
decisions, not a production-hardened library — see the design doc's non-goals and
phased plan for what is intentionally deferred.

`@hopae/logger` is structured as a real npm package (proper exports, dual
ESM/CJS builds, and TypeScript types). Other services can import it via a local
path or `npm pack`. It is not published to the public npm registry, since that
seemed outside the assignment scope.

If you require any further clarification or additional information regarding the
design or the code, please do not hesitate to contact me.
