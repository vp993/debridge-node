/**
 * Default timeout (ms) for any outgoing Web3 / RPC call. Must stay in sync
 * with `.default.env` (WEB3_TIMEOUT). Single source of truth for the whole app.
 */
export const DEFAULT_WEB3_TIMEOUT_MS = 30000;

/**
 * Safely parses a string env value into a positive integer.
 * Falls back to `fallback` when the value is undefined, empty, non-numeric,
 * zero, negative, or NaN. Prevents subtle bugs like `setTimeout(fn, NaN)`
 * (which behaves as `setTimeout(fn, 0)` and fires immediately).
 */
export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
