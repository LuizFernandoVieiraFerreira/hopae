export type Redactor = (input: unknown) => unknown;

/**
 * Default deny-list of sensitive keys. Given the identity/credentials domain,
 * the default posture is REDACT — logging these requires an explicit opt-in.
 * Matching is case- and separator-insensitive (`access_token` == `accessToken`).
 */
export const DEFAULT_REDACT_KEYS: string[] = [
  'authorization',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'apiKey',
  'cookie',
  'setCookie',
  'ssn',
  'creditCard',
  'card',
  'cvv',
  'pin',
  'email',
  'phone',
  'credential',
  'credentials',
  'privateKey',
  'clientSecret',
  'jwt',
  'bearer',
  'sessionId',
];

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const TRUNCATED = '[Truncated]';
const MAX_DEPTH = 8;

function normalize(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/**
 * Builds a deep redactor that clones the input and replaces the value of any
 * key matching the deny-list (recursively, cycle-safe, depth-bounded).
 */
export function createRedactor(keys: string[] = DEFAULT_REDACT_KEYS): Redactor {
  const deny = new Set(keys.map(normalize));

  const visit = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return TRUNCATED;
    if (seen.has(value as object)) return CIRCULAR;
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => visit(item, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deny.has(normalize(k)) ? REDACTED : visit(v, depth + 1, seen);
    }
    return out;
  };

  return (input: unknown) => visit(input, 0, new WeakSet());
}
