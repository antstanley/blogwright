/**
 * Turning a result cell into something a reader sees. Small and shared,
 * because the alternative - each panel formatting its own numbers - is how two
 * charts on one page end up disagreeing about what a thousand looks like.
 */

/** Grouped integers, in the reader's own locale. */
const COUNT_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** A ratio as a percentage. One decimal: a cache hit rate moves in tenths. */
const RATIO_FORMAT = new Intl.NumberFormat(undefined, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** How long a ranking label may be before it is elided in the middle of the axis. */
const LABEL_LIMIT = 28;

/** A `YYYY-MM-DD` day - the only label {@link shortenDay} will trim. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Characters in a day's `YYYY-` prefix, which is what a crowded axis drops. */
const YEAR_PREFIX_LENGTH = 5;

/** What a cell that carried nothing renders as, rather than an empty gap. */
const ABSENT_CELL = '-';

/** Format a count of requests, visitors or responses. */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

/** Format a ratio - a value in `0..1` - as a percentage. */
export function formatRatio(value: number): string {
  return RATIO_FORMAT.format(value);
}

/**
 * A result column's name as a sentence: `summed_daily_unique_visitors` becomes
 * "Summed daily unique visitors".
 *
 * Derived from the column name rather than written out beside it, and that is
 * the point for exactly one column. `unique-visitors` reports its range total
 * as the *sum of daily counts*, and its column name says so; a hand-written
 * label is where that would quietly become "unique visitors", which is a
 * number the daily-rotating salt makes uncomputable. Deriving the label means
 * the query set's own words are what a reader sees.
 */
export function humaniseColumn(column: string): string {
  const words = column.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Shorten a long ranking label - a request path or a referring URL - keeping
 * both ends, since a truncated tail loses exactly the part that distinguishes
 * `/posts/a` from `/posts/b`.
 */
export function shortenLabel(label: string): string {
  if (label.length <= LABEL_LIMIT) return label;
  const head = Math.ceil((LABEL_LIMIT - 1) / 2);
  const tail = Math.floor((LABEL_LIMIT - 1) / 2);
  return `${label.slice(0, head)}…${label.slice(label.length - tail)}`;
}

/**
 * A `YYYY-MM-DD` day written as `MM-DD`, for a category axis drawing several
 * of them side by side.
 *
 * Six full days do not fit. Measured in the browser at the narrowest column
 * this page's grid lays out (`minmax(360px, 1fr)`, a 345px panel), each tick
 * is about 59px wide inside a plot area of about 281px, so every adjacent
 * pair overlaps and the axis reads `2026-08-2026-08-...`. Without the year a
 * tick is about 30px, which leaves a gap between all six.
 *
 * String arithmetic rather than a `Date`, for the reason `range.ts` gives: a
 * day is a UTC partition key, and parsing one to reformat it would re-read it
 * in the reader's own zone, which west of Greenwich labels every point one day
 * early. The year is not lost to the reader - the range these days belong to
 * is spelled out in the date inputs at the top of the page - and a label that
 * is not day-shaped, such as a status code, is returned untouched rather than
 * blindly sliced.
 */
export function shortenDay(label: string): string {
  return DAY_PATTERN.test(label) ? label.slice(YEAR_PREFIX_LENGTH) : label;
}

/**
 * Read one cell as a number, answering 0 when the column carried something
 * else. A SQL NULL reaches the browser as an *absent* key (`ports.ts`'
 * `QueryValue` excludes null on purpose), so an absent count is genuinely
 * zero of something rather than an unknown to propagate.
 */
export function numericCell(row: Readonly<Record<string, unknown>>, column: string): number {
  const value = row[column];
  return typeof value === 'number' ? value : 0;
}

/** Read one cell as a label, naming its absence rather than rendering `undefined`. */
export function labelCell(row: Readonly<Record<string, unknown>>, column: string): string {
  const value = row[column];
  return value === undefined ? ABSENT_CELL : String(value);
}
