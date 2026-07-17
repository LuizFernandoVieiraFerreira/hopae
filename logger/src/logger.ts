import pino, { type Logger as PinoLogger } from "pino";
import { getContext } from "./context";
import {
  createRedactor,
  DEFAULT_REDACT_KEYS,
  type Redactor,
} from "./redaction";
import type { Logger, LoggerOptions, LogContext, LogLevel } from "./types";

type Level = LogLevel;

function toErrorObject(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { type: error.name, message: error.message, stack: error.stack };
  }
  if (error && typeof error === "object") {
    return { type: "Error", ...(error as Record<string, unknown>) };
  }
  return { type: "Error", message: String(error) };
}

function build(base: PinoLogger, redact: Redactor, bound: LogContext): Logger {
  const emit = (
    level: Level,
    message: string,
    context?: LogContext,
    error?: unknown,
  ): void => {
    const merged = { ...bound, ...(context ?? {}) };
    const payload: Record<string, unknown> = {};
    if (Object.keys(merged).length > 0) payload.context = redact(merged);
    if (error !== undefined) payload.error = redact(toErrorObject(error));
    base[level](payload, message);
  };

  return {
    fatal: (message, error, context) => emit("fatal", message, context, error),
    error: (message, error, context) => emit("error", message, context, error),
    warn: (message, context) => emit("warn", message, context),
    info: (message, context) => emit("info", message, context),
    debug: (message, context) => emit("debug", message, context),
    trace: (message, context) => emit("trace", message, context),
    child: (bindings) => build(base, redact, { ...bound, ...bindings }),
  };
}

/**
 * Creates a structured logger. Emits single-line JSON to stdout (12-factor) by
 * default, automatically enriching every line with the active trace context.
 */
export function createLogger(options: LoggerOptions): Logger {
  const redact = createRedactor(options.redact ?? DEFAULT_REDACT_KEYS);

  const base = pino(
    {
      level:
        options.level ??
        (process.env.LOG_LEVEL as LogLevel | undefined) ??
        "info",
      messageKey: "message",
      base: {
        service: options.service,
        env: options.env ?? process.env.NODE_ENV ?? "development",
        ...(options.version ? { version: options.version } : {}),
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }),
      },
      // `mixin` runs automatically every time we log something. Here we "read
      // the wristband" for the request we're currently inside (via getContext)
      // and merge its ids into the log line. This is what makes trace_id and
      // span_id show up on every log without the caller ever passing them in.
      // Outside of a request there's no wristband, so we add nothing.
      mixin() {
        const ctx = getContext();
        if (!ctx) return {};
        // Extra request-scoped fields (e.g. userId added mid-request); redacted
        // in case any of them are sensitive.
        const extra = ctx.bindings
          ? (redact(ctx.bindings) as Record<string, unknown>)
          : {};
        return { trace_id: ctx.traceId, span_id: ctx.spanId, ...extra };
      },
    },
    options.destination as pino.DestinationStream | undefined,
  );

  return build(base, redact, {});
}
