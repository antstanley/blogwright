/**
 * The recording {@link AnalyticsIngest} the backfill's tests substitute at the
 * write port, so no test in this package starts DuckDB to prove what was
 * written. It is the write-side counterpart of `fixture-query.ts`, and it is
 * shipped beside the interface it implements for the same reason
 * `createMemoryFileSystem` (`packages/core/src/adapters/memory-fs.ts`) is: a
 * real implementation of the port, not a stub that agrees with anything.
 *
 * **It records rather than judges, with two exceptions, and both are the
 * contract rather than a convenience.** {@link AnalyticsIngest.insertDay}
 * documents that a batch is one whole day and that an empty batch is a caller
 * error; a fake that quietly accepted a row belonging to another day, or an
 * insert of nothing, would let a backfill defect pass through it and land on
 * an assertion about something else. Everything a test actually asserts - which
 * days were written, in which order, with which rows - it reads off
 * {@link RecordingAnalyticsIngest.calls}, and the fake takes no view on it.
 * The bound (no day at or after the recorded `createdDay`) in particular is
 * deliberately NOT enforced here: it is the property the backfill exists to
 * hold, so a fake that enforced it would answer the question under test.
 */

import type { AnalyticsIngest } from './ports.js';
import type { PageView } from './schema.js';

/**
 * One accepted {@link AnalyticsIngest.insertDay}, exactly as it arrived.
 *
 * Not exported, following `ports.ts`' `QueryValue`: no consumer needs the
 * shape by name today - a test reaches it as
 * `RecordingAnalyticsIngest['calls'][number]` or, in practice, by reading
 * `call.day` and `call.rows` off it. Export it once something names it.
 */
interface RecordedInsert {
  /** The UTC day the call named. */
  readonly day: string;
  /** The rows it carried, in the order the caller handed them over. */
  readonly rows: readonly PageView[];
}

/** The fake, plus the record of what it was asked to write. */
export interface RecordingAnalyticsIngest extends AnalyticsIngest {
  /** Every accepted insert, in call order. */
  readonly calls: readonly RecordedInsert[];
  /** The days of {@link calls}, in call order - the shape most assertions want. */
  readonly days: readonly string[];
}

/**
 * Build a {@link RecordingAnalyticsIngest}. Takes nothing: an ingest port has
 * no result to seed, so the only thing a test needs from it is what it saw.
 */
export function createRecordingAnalyticsIngest(): RecordingAnalyticsIngest {
  const calls: RecordedInsert[] = [];
  const days: string[] = [];

  return {
    calls,
    days,

    async insertDay(day: string, rows: readonly PageView[]): Promise<void> {
      if (rows.length === 0) {
        throw new Error(`analytics ingest was asked to insert day ${day} with no rows`);
      }
      const foreign = rows.find((row) => row.day !== day);
      if (foreign !== undefined) {
        throw new Error(
          `analytics ingest was asked to insert day ${day} carrying a row for day ${foreign.day}`,
        );
      }
      calls.push({ day, rows });
      days.push(day);
    },
  };
}
