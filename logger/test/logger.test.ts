import { describe, it, expect } from 'vitest';
import { createLogger, runWithContext } from '../src/index';

function capture() {
  const lines: Array<Record<string, any>> = [];
  const destination = { write: (chunk: string) => lines.push(JSON.parse(chunk)) };
  return { lines, destination };
}

describe('createLogger', () => {
  it('emits the documented structured schema', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 'test-svc', env: 'test', version: '1.2.3', destination });

    log.info('hello world', { userId: 'u1' });

    expect(lines).toHaveLength(1);
    const entry = lines[0]!;
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('test-svc');
    expect(entry.env).toBe('test');
    expect(entry.version).toBe('1.2.3');
    expect(entry.message).toBe('hello world');
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(entry.context).toEqual({ userId: 'u1' });
  });

  it('respects the configured log level', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 's', level: 'info', destination });

    log.debug('should be dropped');
    log.info('should be kept');

    expect(lines.map((l) => l.message)).toEqual(['should be kept']);
  });

  it('serializes errors into the error field', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 's', destination });

    log.error('capture failed', new TypeError('bad input'), { orderId: 'o1' });

    const entry = lines[0]!;
    expect(entry.error.type).toBe('TypeError');
    expect(entry.error.message).toBe('bad input');
    expect(typeof entry.error.stack).toBe('string');
    expect(entry.context).toEqual({ orderId: 'o1' });
  });

  it('auto-injects trace context from AsyncLocalStorage', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 's', destination });

    runWithContext({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }, () => {
      log.info('inside a request');
    });

    expect(lines[0]!.trace_id).toBe('a'.repeat(32));
    expect(lines[0]!.span_id).toBe('b'.repeat(16));
  });

  it('redacts sensitive fields by default (deep)', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 's', destination });

    log.info('login attempt', {
      email: 'user@example.com',
      password: 'hunter2',
      nested: { accessToken: 'abc.def.ghi' },
    });

    const ctx = lines[0]!.context;
    expect(ctx.email).toBe('[REDACTED]');
    expect(ctx.password).toBe('[REDACTED]');
    expect(ctx.nested.accessToken).toBe('[REDACTED]');
  });

  it('merges bound context from child loggers', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 's', destination }).child({ module: 'billing' });

    log.info('charged card', { amountCents: 100 });

    expect(lines[0]!.context).toEqual({ module: 'billing', amountCents: 100 });
  });
});
