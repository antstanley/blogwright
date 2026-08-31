import { isRetryable } from './aws/errors.js';

/**
 * The fixed timestamp every reproducible zip in this repo stamps its entries
 * with, so identical input bytes always produce identical archive bytes.
 *
 * **Constructed from local parts on purpose, and the obvious `Date.UTC` form is
 * a bug.** A zip's DOS timestamp is *local* time, and `fflate` reads it with
 * `getFullYear()`/`getMonth()`/`getDate()`, so a `Date` fixed in UTC lands on a
 * different local date in every zone. Two things follow, and this repo shipped
 * both:
 *
 * - `new Date('1980-01-01T00:00:00Z')` is 1979-12-31 local anywhere west of
 *   Greenwich, and `fflate` throws `date not in range 1980-2099` outright -
 *   so `blogwright bootstrap`, `deploy` and `analytics bootstrap` all failed
 *   for most of the Americas while passing in CI, which runs `TZ=UTC`.
 * - Even where it did not throw, the encoded timestamp differed by zone, so
 *   the archive was *not* reproducible - the property the constant exists to
 *   provide. The crash was hiding that.
 *
 * A local-constructed 1980-01-02 is 1980-01-02 in every zone by construction:
 * in range everywhere, and byte-identical everywhere. The second of January
 * rather than the first so that no offset can push it below the 1980 floor.
 */
export const REPRODUCIBLE_ZIP_MTIME = new Date(1980, 0, 2);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Predicate for whether an error is retryable (defaults to isRetryable). */
  retryable?: (err: unknown) => boolean;
}

/** Retry a fn on transient AWS/network errors with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseDelayMs ?? 200;
  const max = opts.maxDelayMs ?? 5000;
  const retryable = opts.retryable ?? isRetryable;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !retryable(err)) throw err;
      const delay = Math.min(max, base * 2 ** i);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Poll `fn` until `done` returns true or the deadline passes. Returns the last value. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (value: T) => boolean,
  opts: { intervalMs: number; timeoutMs: number },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let value = await fn();
  while (!done(value)) {
    if (Date.now() >= deadline) return value;
    await sleep(opts.intervalMs);
    value = await fn();
  }
  return value;
}
