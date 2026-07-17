import { describe, it, expect } from 'vitest';
import { createRedactor } from '../src/index';

describe('createRedactor', () => {
  const redact = createRedactor();

  it('redacts keys case- and separator-insensitively', () => {
    const out = redact({
      Password: 'x',
      access_token: 'y',
      apiKey: 'z',
      safeField: 'ok',
    }) as Record<string, unknown>;

    expect(out.Password).toBe('[REDACTED]');
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.safeField).toBe('ok');
  });

  it('redacts nested objects and arrays', () => {
    const out = redact({
      a: { b: { token: 't' } },
      list: [{ password: 'p' }, { ok: 1 }],
    }) as any;

    expect(out.a.b.token).toBe('[REDACTED]');
    expect(out.list[0].password).toBe('[REDACTED]');
    expect(out.list[1].ok).toBe(1);
  });

  it('handles circular references safely', () => {
    const obj: Record<string, unknown> = { name: 'x' };
    obj.self = obj;

    const out = redact(obj) as any;
    expect(out.name).toBe('x');
    expect(out.self).toBe('[Circular]');
  });

  it('supports a custom deny-list', () => {
    const custom = createRedactor(['customSecret']);
    const out = custom({ customSecret: 'v', password: 'not-redacted-here' }) as any;
    expect(out.customSecret).toBe('[REDACTED]');
    expect(out.password).toBe('not-redacted-here');
  });
});
