/**
 * Public contract for the logger. These types intentionally mirror the log
 * schema documented in the design doc (OpenTelemetry log-data-model aligned).
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** Structured, business-relevant key/values. Never free-form string concat. */
export type LogContext = Record<string, unknown>;

export interface LoggerOptions {
  /** Emitting service name, e.g. "payments-api". Required. */
  service: string;
  /** Deployment environment. Defaults to process.env.NODE_ENV or "development". */
  env?: string;
  /** Service version / build, e.g. "1.8.2". */
  version?: string;
  /** Minimum level to emit. Defaults to process.env.LOG_LEVEL or "info". */
  level?: LogLevel;
  /** Override the default sensitive-key deny-list used for redaction. */
  redact?: string[];
  /**
   * Where to write log lines. Defaults to stdout (12-factor).
   * Primarily used in tests to capture output.
   */
  destination?: { write: (chunk: string) => void };
}

export interface Logger {
  fatal(message: string, error?: unknown, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  trace(message: string, context?: LogContext): void;
  /** Returns a logger that merges `bindings` into the `context` of every line. */
  child(bindings: LogContext): Logger;
}
