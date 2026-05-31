const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns a shallow clone of `headers` with the values of any
 * well-known sensitive headers (Authorization, Cookie, API keys, …)
 * replaced with `***`.
 */
export function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
      result[name] = '***';
    } else {
      result[name] = value;
    }
  }
  return result;
}

/**
 * Returns a deep clone of an axios-like config object in which all
 * sensitive headers are masked. Intended for logging only — the
 * original object is never mutated.
 */
export function sanitizeRequestConfigForLogging<T>(config: T): T {
  if (!config || typeof config !== 'object') {
    return config;
  }

  let clone: any;
  try {
    clone = JSON.parse(JSON.stringify(config));
  } catch {
    return config;
  }

  if (isPlainObject(clone?.headers)) {
    clone.headers = sanitizeHeaders(clone.headers);
  }
  return clone as T;
}
