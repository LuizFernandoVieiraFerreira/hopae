import { describe, it, expect } from 'vitest';
import { runWithContext, getContext, getTraceId, addContext } from '../src/index';

describe('trace context (AsyncLocalStorage)', () => {
  it('exposes the context only inside runWithContext', () => {
    expect(getContext()).toBeUndefined();

    runWithContext({ traceId: 't1', spanId: 's1' }, () => {
      expect(getContext()?.traceId).toBe('t1');
      expect(getTraceId()).toBe('t1');
    });

    expect(getContext()).toBeUndefined();
  });

  it('merges request-scoped bindings via addContext', () => {
    runWithContext({ traceId: 't1', spanId: 's1' }, () => {
      addContext({ userId: 'u1' });
      addContext({ tenant: 'acme' });
      expect(getContext()?.bindings).toEqual({ userId: 'u1', tenant: 'acme' });
    });
  });

  it('isolates context across concurrent async flows', async () => {
    const seen: string[] = [];
    const run = (id: string) =>
      new Promise<void>((resolve) => {
        runWithContext({ traceId: id, spanId: 's' }, () => {
          setTimeout(() => {
            seen.push(getTraceId() ?? 'none');
            resolve();
          }, 5);
        });
      });

    await Promise.all([run('trace-a'), run('trace-b')]);
    expect(seen.sort()).toEqual(['trace-a', 'trace-b']);
  });
});
