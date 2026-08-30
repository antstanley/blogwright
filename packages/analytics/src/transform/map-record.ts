/**
 * `mapRecord`: one CloudFront standard-logging (v2) record in, one `page_views`
 * row out - or a droppable result naming the column that could not be filled
 * and the CloudFront field behind it. This is steps 1, 2 and 5 of
 * [§Record transformation](../../../../.specs/changes/2026-07-26-analytics_plugin.md):
 * rename each selected field to its column, derive `event_time` and the `day`
 * partition from `timestamp(ms)`, and drop what the schema cannot accept.
 * Steps 3 and 4 - `visitor_key` and `is_bot` - land beside this function
 * later; until they do the two columns are simply absent, which the table
 * permits (both are nullable).
 *
 * Why the drop path exists at all: Firehose matches incoming JSON keys to
 * Iceberg column names **exactly**, and a record it cannot match goes to the
 * S3 error bucket with no error anywhere an operator will see it - the symptom
 * is an empty dashboard. So this module never emits a key that is not a column
 * and never emits a value whose JavaScript type is not the one the column
 * stores. Where it cannot honour that, it returns the droppable result and the
 * envelope (task 42) reports `ProcessingFailed` for that one record, which
 * routes it to the error prefix without failing the batch.
 *
 * Every column and field name comes from `schema.ts`: the row is built by
 * iterating `FIELD_TO_COLUMN`, the required set and the numeric set are
 * derived from `PAGE_VIEWS_COLUMNS`, and the only two names spelled here are
 * the two derived columns this task fills, each checked against
 * `PageViewColumnName` so a typo is a compile error rather than a column
 * Firehose silently drops.
 *
 * Three input decisions the spec left open, settled here:
 *
 * - **`-` and the empty string mean absent.** CloudFront writes `-` for a
 *   field the request had nothing to say for (no referrer, no query string).
 *   Writing that through would fill `referrer` with a wall of `-`; treating it
 *   as absent leaves the column null, which is what it means. For a *required*
 *   column it is a drop, not a null.
 * - **A number where a string column is expected is rendered, not rejected.**
 *   `asn` is a string column that a JSON encoder may well emit unquoted;
 *   `String(64512)` is the same value in the type the column stores. Anything
 *   that is not a string or a number - an object, an array, a boolean - is a
 *   drop, because there is no rendering of it that is not a guess.
 * - **A numeric column that does not parse is a drop, never a coerced value.**
 *   `Number('abc')` is `NaN` and `Number('')` is `0`; writing either would put
 *   a wrong number in the table, which is worse than losing the record.
 *
 * Nullability governs the *absent* case only. A value that is present but
 * unusable drops the record whether or not the column is nullable: leaving a
 * nullable column empty asserts the request had nothing to say for it, which
 * is a different - and false - fact about that request.
 *
 * Pure: no clock (`event_time` comes from the record's own `timestamp(ms)`, in
 * UTC), no `node:` builtin, no vendor SDK, no `fetch`. The record arrives
 * already parsed and is trusted to be an object - JSON parsing and its
 * failures are the handler's boundary, not this function's.
 */

import {
  FIELD_TO_COLUMN,
  PAGE_VIEWS_COLUMNS,
  type PageView,
  type PageViewColumnName,
  type PageViewsColumn,
  TIMESTAMP_MS_FIELD,
} from '../schema.js';

/**
 * One CloudFront access-log record as the delivery hands it over: the selected
 * field names of `CLOUDFRONT_RECORD_FIELDS` against values of whatever type
 * the JSON payload carried.
 */
export type CloudFrontRecord = Readonly<Record<string, unknown>>;

/** A record that maps cleanly: the row is complete and safe to hand Firehose. */
interface MappedRecord {
  readonly mapped: true;
  readonly row: PageView;
}

/**
 * A record the schema cannot accept. It carries no row at all - a partially
 * populated one is exactly the silent corruption the drop path exists to
 * prevent.
 */
interface DroppedRecord {
  readonly mapped: false;
  /** The `page_views` column that could not be filled. */
  readonly column: PageViewColumnName;
  /** The CloudFront field that column reads. */
  readonly field: string;
  /** Names both, plus what was wrong with the value. */
  readonly reason: string;
}

/** The outcome of mapping one record: a complete row, or a named drop. */
export type MapRecordResult = MappedRecord | DroppedRecord;

/** CloudFront's marker for a field the request had nothing to say for. */
const CLOUDFRONT_EMPTY_VALUE = '-';

/** The `YYYY-MM-DD` prefix an ISO-8601 instant opens with, in characters. */
const ISO_DATE_LENGTH = 10;

/**
 * An ISO-8601 instant with a four-digit year, as `toISOString` renders every
 * year from 0000 to 9999. Outside that range it switches to an expanded year
 * (`+058632-08-17T19:50:00.000Z`), whose first ten characters are not a date
 * but would still slice cleanly into `day`. This is the check that stops that.
 *
 * Which wrong units it actually catches, taking 1788099825 as the instant:
 *
 * - **Microseconds** (`1788099825000000`) land in the year 58632. A `Date`
 *   holds it, `toISOString` renders it with an expanded year, and this regex
 *   rejects it. Dropped.
 * - **Nanoseconds** (`1788099825000000000`) exceed the 8.64e15 ms either side
 *   of the epoch a `Date` can represent at all, so `eventTimeFrom`'s
 *   representability guard rejects it before this regex sees it. Dropped.
 * - **Seconds** (`1788099825`) are *not* detected, and seconds are the
 *   likeliest wrong unit anyone would actually supply. Read as milliseconds
 *   the value is an ordinary instant - `1970-01-21T16:41:39.825Z` - so it
 *   passes both checks and writes a well-formed row under `day=1970-01-21`,
 *   a partition no query will look at and indistinguishable from a genuine
 *   1970 record.
 *
 * The seconds case is a known hole, not an oversight: catching it needs a
 * plausibility floor on the value rather than a shape check on the rendering,
 * which is a different decision (what floor, and what to do at it) than this
 * transform was scoped to make.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Iceberg types the `PageView` row stores as a JavaScript `number`. */
const NUMERIC_ICEBERG_TYPES = new Set<PageViewsColumn['icebergType']>(['int', 'long', 'double']);

/** Columns Firehose may not write a null to; an absent value drops the record. */
const REQUIRED_COLUMNS: ReadonlySet<PageViewColumnName> = new Set(
  PAGE_VIEWS_COLUMNS.filter((column) => column.required).map((column) => column.name),
);

/** Columns whose value must be coerced to a number before it is written. */
const NUMERIC_COLUMNS: ReadonlySet<PageViewColumnName> = new Set(
  PAGE_VIEWS_COLUMNS.filter((column) => NUMERIC_ICEBERG_TYPES.has(column.icebergType)).map(
    (column) => column.name,
  ),
);

/** The two columns this transform derives; checked against the table's names. */
const EVENT_TIME_COLUMN = 'event_time' satisfies PageViewColumnName;
const DAY_COLUMN = 'day' satisfies PageViewColumnName;

/** A field that produced no value, and why. */
type UnfilledField =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly detail: string };

/** What one CloudFront field yielded for its column. */
type FieldOutcome<T> = UnfilledField | { readonly kind: 'value'; readonly value: T };

const ABSENT: UnfilledField = { kind: 'absent' };

function invalid(detail: string): UnfilledField {
  return { kind: 'invalid', detail };
}

/** The clause a drop reason ends with, for a field that yielded no value. */
function unfilledDetail(outcome: UnfilledField): string {
  return outcome.kind === 'absent' ? 'is absent' : outcome.detail;
}

/** A string column's value, with CloudFront's absence markers read as absent. */
function stringFrom(raw: unknown): FieldOutcome<string> {
  if (raw === undefined || raw === null) return ABSENT;
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { kind: 'value', value: String(raw) }
      : invalid(`holds ${String(raw)}, which is not a finite number`);
  }
  if (typeof raw !== 'string')
    return invalid(`holds an unsupported ${typeof raw} value, which is not text`);
  const value = raw.trim();
  return value === '' || value === CLOUDFRONT_EMPTY_VALUE ? ABSENT : { kind: 'value', value };
}

/**
 * A numeric column's value; anything that does not parse is a drop, not a
 * `NaN`.
 *
 * Known gap: this coerces by JavaScript number, not by the column's Iceberg
 * type, so an `int` or `long` column accepts a non-integral value as readily
 * as a `double` does - `sc-status: '200.5'` is written through as `200.5`. No
 * CloudFront field can produce such a value, so nothing here rounds or rejects
 * one; a source that could would need an integrality check keyed on
 * `icebergType`.
 */
function numberFrom(raw: unknown): FieldOutcome<number> {
  if (raw === undefined || raw === null) return ABSENT;
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { kind: 'value', value: raw }
      : invalid(`holds ${String(raw)}, which is not a finite number`);
  }
  if (typeof raw !== 'string')
    return invalid(`holds an unsupported ${typeof raw} value, which is not a number`);
  const text = raw.trim();
  if (text === '' || text === CLOUDFRONT_EMPTY_VALUE) return ABSENT;
  const value = Number(text);
  return Number.isFinite(value)
    ? { kind: 'value', value }
    : invalid(`holds "${raw}", which does not parse as a number`);
}

/** Reads one field the way its target column stores it. */
function columnValueFrom(raw: unknown, column: PageViewColumnName): FieldOutcome<string | number> {
  return NUMERIC_COLUMNS.has(column) ? numberFrom(raw) : stringFrom(raw);
}

/** `event_time` as a UTC ISO-8601 instant, from `timestamp(ms)`. */
function eventTimeFrom(raw: unknown): FieldOutcome<string> {
  const milliseconds = numberFrom(raw);
  if (milliseconds.kind !== 'value') return milliseconds;
  const instant = new Date(milliseconds.value);
  if (Number.isNaN(instant.getTime())) {
    return invalid(`holds ${String(milliseconds.value)}, which is not a representable instant`);
  }
  const eventTime = instant.toISOString();
  return ISO_INSTANT.test(eventTime)
    ? { kind: 'value', value: eventTime }
    : invalid(`holds ${String(milliseconds.value)}, which falls outside the years 0000-9999`);
}

/** The `day` partition value: the UTC date `event_time` falls on. */
function dayFrom(eventTime: string): string {
  return eventTime.slice(0, ISO_DATE_LENGTH);
}

/** A drop naming the column, the field behind it, and what was wrong. */
function dropped(column: PageViewColumnName, field: string, detail: string): DroppedRecord {
  return {
    mapped: false,
    column,
    field,
    reason: `page_views column "${column}" cannot be filled: CloudFront field "${field}" ${detail}`,
  };
}

/** Both derived columns are lost together, because both read the same field. */
function droppedTimestamp(detail: string): DroppedRecord {
  return {
    mapped: false,
    column: EVENT_TIME_COLUMN,
    field: TIMESTAMP_MS_FIELD,
    reason: `page_views columns "${EVENT_TIME_COLUMN}" and "${DAY_COLUMN}" cannot be filled: CloudFront field "${TIMESTAMP_MS_FIELD}" ${detail}`,
  };
}

/**
 * Turns one CloudFront access-log record into a `page_views` row, or reports
 * why it cannot. Never returns a partially populated row: the first column it
 * cannot fill ends the mapping.
 */
export function mapRecord(record: CloudFrontRecord): MapRecordResult {
  const eventTime = eventTimeFrom(record[TIMESTAMP_MS_FIELD]);
  if (eventTime.kind !== 'value') return droppedTimestamp(unfilledDetail(eventTime));

  const columns: Partial<Record<PageViewColumnName, string | number | boolean>> = {
    [EVENT_TIME_COLUMN]: eventTime.value,
    [DAY_COLUMN]: dayFrom(eventTime.value),
  };

  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    const outcome = columnValueFrom(record[field], column);
    if (outcome.kind === 'invalid') return dropped(column, field, outcome.detail);
    if (outcome.kind === 'absent') {
      if (REQUIRED_COLUMNS.has(column)) return dropped(column, field, unfilledDetail(outcome));
      continue;
    }
    columns[column] = outcome.value;
  }

  // Every required column is filled above or the record has already dropped:
  // `event_time` and `day` unconditionally, and the required mapped columns by
  // the guard in the loop. `map-record.test.ts` pins that correspondence
  // against `PAGE_VIEWS_COLUMNS` itself, so a column the table makes required
  // later fails a test here rather than a Firehose write in production.
  return { mapped: true, row: columns as PageView };
}
