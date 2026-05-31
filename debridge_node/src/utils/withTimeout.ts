/**
 * Wraps a promise with a timeout. If the promise does not resolve within
 * the given milliseconds, it rejects with a descriptive error.
 * The internal timer is always cleaned up to avoid leaks.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout${label ? ` [${label}]` : ''} after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
