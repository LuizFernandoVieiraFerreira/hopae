import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context carried implicitly through the async call tree so that
 * every log line can be correlated to a single request without engineers
 * threading identifiers through every function signature.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  /** Span id of the upstream caller (this service's parent), if any. */
  parentSpanId?: string;
  /** Extra request-scoped correlation fields (e.g. userId) added on the fly. */
  bindings?: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Runs `fn` with `context` available to every log call inside it. */
export function runWithContext<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Returns the active request context, if the caller is inside `runWithContext`. */
export function getContext(): TraceContext | undefined {
  return storage.getStore();
}

/** Convenience accessor for the active trace id. */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/** Merges additional correlation fields into the active context (e.g. after auth). */
export function addContext(bindings: Record<string, unknown>): void {
  const store = storage.getStore();
  if (!store) return;
  store.bindings = { ...(store.bindings ?? {}), ...bindings };
}
