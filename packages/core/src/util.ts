import { isRetryable } from './aws/errors.js';

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
