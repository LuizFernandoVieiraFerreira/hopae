import { randomBytes } from "node:crypto";

/**
 * Minimal W3C Trace Context implementation.
 * Header format: `version-traceId-spanId-flags`
 * e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
 *
 * We adopt the standard header shape now so we can graduate to full
 * OpenTelemetry tracing later without changing the propagation contract.
 */

const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const NULL_TRACE_ID = "0".repeat(32);
const NULL_SPAN_ID = "0".repeat(16);

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  spanId: string;
  flags: string;
}

/** 16 random bytes as 32 hex chars. */
export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** 8 random bytes as 16 hex chars. */
export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** Reads a `traceparent` header string and splits it into its parts (returns null if it's missing or malformed). */
export function parseTraceparent(
  header?: string | null,
): ParsedTraceparent | null {
  if (!header || typeof header !== "string") return null;
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) return null;
  const [, version, traceId, spanId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version === "ff") return null;
  if (traceId === NULL_TRACE_ID || spanId === NULL_SPAN_ID) return null;
  return { version, traceId, spanId, flags };
}

/** Builds the `traceparent` header string we send to the next service, from a trace id + span id. */
export function formatTraceparent(
  traceId: string,
  spanId: string,
  sampled = true,
): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}
