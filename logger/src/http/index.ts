import { getContext, runWithContext, type TraceContext } from "../context";
import {
  parseTraceparent,
  generateTraceId,
  generateSpanId,
  formatTraceparent,
} from "../trace";

/**
 * Runs at the very start of every incoming request and "puts the wristband on"
 * — it attaches a trace context that then follows the request everywhere.
 *
 * For each request it:
 *  - Looks for a `traceparent` header from the caller. If one exists, this
 *    request is part of an existing trace, so we keep the same `traceId`.
 *    If not, this is a brand-new request, so we generate a fresh `traceId`.
 *  - Always creates a new `spanId` to identify THIS service's leg of the trace.
 *  - Copies the ids back onto the response headers (handy when debugging).
 *  - Calls `runWithContext(...)`, so every log line produced while handling
 *    this request is automatically stamped with the trace/span ids.
 */

export interface TraceMiddlewareOptions {
  header?: string;
  setResponseHeaders?: boolean;
}

interface MinimalReq {
  headers?: Record<string, string | string[] | undefined>;
}

interface MinimalRes {
  setHeader?: (name: string, value: string) => void;
}

export function traceContextMiddleware(options: TraceMiddlewareOptions = {}) {
  const headerName = (options.header ?? "traceparent").toLowerCase();
  const setResponseHeaders = options.setResponseHeaders ?? true;

  return function traceMiddleware(
    req: MinimalReq,
    res: MinimalRes,
    next: () => void,
  ): void {
    const raw = req.headers?.[headerName];
    const incoming = parseTraceparent(Array.isArray(raw) ? raw[0] : raw);

    const context: TraceContext = {
      traceId: incoming?.traceId ?? generateTraceId(),
      spanId: generateSpanId(),
      parentSpanId: incoming?.spanId,
    };

    if (setResponseHeaders && typeof res.setHeader === "function") {
      res.setHeader(
        "traceparent",
        formatTraceparent(context.traceId, context.spanId),
      );
      res.setHeader("x-trace-id", context.traceId);
    }

    runWithContext(context, () => next());
  };
}

/**
 * Headers to attach to OUTBOUND calls so the next service continues this trace.
 * Usage: `fetch(url, { headers: outboundTraceHeaders() })`.
 */
export function outboundTraceHeaders(): Record<string, string> {
  const ctx = getContext();
  if (!ctx) return {};
  return { traceparent: formatTraceparent(ctx.traceId, ctx.spanId) };
}
