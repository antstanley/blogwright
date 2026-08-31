/**
 * The date range the whole page is indexed by.
 *
 * Days are UTC and are handled as `YYYY-MM-DD` text from end to end - never as
 * a `Date` - because the `day` column they filter is a UTC partition. Turning
 * one into a `Date` to render it would re-read it in the reader's own zone,
 * which west of Greenwich labels every point one day early.
 */

import type { DateRange } from './api.js';

/** Characters in a `YYYY-MM-DD` day - how much of an ISO timestamp the day is. */
const DAY_LENGTH = 10;

/** Milliseconds in a day, for stepping back from today. */
const MILLISECONDS_PER_DAY = 86_400_000;

/** How many days the dashboard opens on, today included. */
const DEFAULT_RANGE_DAYS = 30;

/** The `YYYY-MM-DD` UTC day an instant falls in. */
function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, DAY_LENGTH);
}

/** The range the dashboard opens on: {@link DEFAULT_RANGE_DAYS} ending today, UTC. */
export function defaultRange(now: Date = new Date()): DateRange {
  return {
    from: utcDay(new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * MILLISECONDS_PER_DAY)),
    to: utcDay(now),
  };
}

/**
 * What is wrong with the range the reader typed, or `undefined` when nothing
 * is. Checked here so an unusable range shows one sentence instead of seven
 * identical refusals - the server validates it too, and its message is what a
 * panel reports if anything reaches it.
 */
export function rangeProblem(range: DateRange): string | undefined {
  if (range.from === '' || range.to === '') return 'Choose a first and a last day.';
  // Both are `YYYY-MM-DD`, so lexical order is chronological order.
  if (range.from > range.to) return `The range is inverted: ${range.from} is after ${range.to}.`;
  return undefined;
}
