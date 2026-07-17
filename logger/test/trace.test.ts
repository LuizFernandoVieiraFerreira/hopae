import { describe, it, expect } from 'vitest';
import {
  parseTraceparent,
  formatTraceparent,
  generateTraceId,
  generateSpanId,
} from '../src/index';

describe('W3C trace context', () => {
  it('parses a valid traceparent header', () => {
    const parsed = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.spanId).toBe('00f067aa0ba902b7');
    expect(parsed?.flags).toBe('01');
  });

  it('rejects malformed and all-zero ids', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`)).toBeNull();
    expect(parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`)).toBeNull();
  });

  it('generates ids of the correct length', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('round-trips format -> parse', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const parsed = parseTraceparent(formatTraceparent(traceId, spanId));
    expect(parsed?.traceId).toBe(traceId);
    expect(parsed?.spanId).toBe(spanId);
  });
});
