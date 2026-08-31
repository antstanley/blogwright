/**
 * Analytics-owned ports. Shared ports (`FileSystem`, `Terminal`) come from
 * blogwright-core; the ports here serve only this package, following the CLI's
 * private-ports precedent (`packages/cli/src/ports.ts:1-6`).
 *
 * **The vendor library lives only behind these interfaces.** DuckDB is what
 * actually answers a named query - it attaches the S3 Tables catalog in
 * read-only mode and runs the statement - and what writes a backfilled day,
 * through a second attach of the same catalog that is not read-only. DuckDB's
 * node-api package is imported nowhere in this package except the two adapters
 * under `adapters/` that implement {@link AnalyticsQuery} and
 * {@link AnalyticsIngest}. (Named in prose rather than spelled as the package
 * specifier, so the definition of done's grep for that specifier over this
 * tree does not trip over a comment.) Nothing in the signatures below names a
 * DuckDB type either: a result row is this package's own {@link QueryRow} and
 * an inserted row is {@link PageView} off `schema.ts`, neither of them a
 * vendor object, so the named query set, the local server, the dashboard's
 * data shaping and the backfill command all compile with no knowledge that
 * DuckDB exists.
 *
 * That containment is load-bearing rather than tidy. The change spec records
 * DuckDB's iceberg extension as *preview*, so its attach syntax may move, and
 * it records that the "no Lake Formation grant" assumption holds only while
 * the table bucket stays in IAM access-control mode. The port is what keeps
 * either of those turning into an edit spread across the dashboard: both land
 * in one adapter, which is also where DuckDB's errors are mapped into the
 * repo's own vocabulary.
 *
 * Tests never start DuckDB. They substitute at these ports with the
 * fixture-backed fake in `fixture-query.ts`, which answers the same named set
 * through the same lookup and range validation the real adapter uses, and with
 * the recording fake in `fixture-ingest.ts`, which keeps every day it was
 * handed so a test can assert what was written rather than that something was.
 */

import type { QueryName, QueryParams } from './queries.js';
import type { PageView } from './schema.js';

/**
 * One cell of a result row. `null` is deliberately not among them: a SQL NULL
 * reaches a caller as an absent key, so no reader ever has to tell "the column
 * was null" from "the column means null" - the repo's rule that no `null`
 * stands for a domain value, applied at the read boundary.
 *
 * Not exported: no consumer needs the bare union today - one can reach the
 * same type as `QueryRow[string]`. Export it once a real consumer needs it by
 * name.
 */
type QueryValue = string | number | boolean;

/**
 * One result row, keyed by the result column names the query's definition
 * declares (`resultColumns` in `queries.ts`). A generic record rather than a
 * per-query row type: the seven definitions' shapes are data, and a caller
 * that wants a narrower type narrows it at its own boundary.
 */
export type QueryRow = Readonly<Record<string, QueryValue>>;

/**
 * Reading the `page_views` table, in domain vocabulary: one operation, "answer
 * this named query over this date range".
 *
 * `name` is a {@link QueryName} and not a `string`, which is the port's half of
 * the spec's *Named queries, never client-supplied SQL* decision - a caller
 * cannot ask this port for a statement, only for one of the seven the package
 * defines. An implementation still validates at run time, because the one seam
 * that feeds it is an HTTP path off the local server, where the compiler's
 * guarantee has already been erased: an unknown name raises an error listing
 * the available names, and an absent or inverted range raises rather than
 * quietly standing in a default (see `prepareQuery`).
 */
export interface AnalyticsQuery {
  /**
   * Answer one of the named queries. Rows come back in the definition's own
   * order (the `ORDER BY` it carries), so a caller never re-sorts to get a
   * stable chart.
   */
  run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]>;
}

/**
 * Writing whole days into the `page_views` table, in domain vocabulary: one
 * operation, "insert these rows for this UTC day".
 *
 * **It exists for the one-shot `analytics backfill` action and nothing else.**
 * The steady-state pipeline never reaches it: CloudFront's logs arrive through
 * Firehose, which writes the table itself (§Analytics pipeline → Shape), so
 * the only writer on this side of the port is the hand-run pull of history
 * that predates the Firehose delivery. The dashboard's read path is never
 * handed an implementation of this interface - `createDashboardServer` takes
 * an {@link AnalyticsQuery} and has no member to put one in - so a named query
 * cannot become a write however the server is called.
 *
 * `day` is the `YYYY-MM-DD` UTC day every row in `rows` carries in its own
 * `day` column, passed separately because it is the unit of the operation: an
 * implementation inserts the whole day or none of it. Passing it also lets an
 * implementation refuse a batch whose rows do not all belong to the day it was
 * asked to write, which is a mistake no row-shaped signature could express.
 *
 * There is deliberately no `close()`. Task 55 measured the read side - an
 * unclosed in-memory DuckDB instance holds no libuv handle and the process
 * exits - and the write side adds nothing that outlives a call: each
 * {@link insertDay} is its own transaction, committed or rolled back before it
 * returns, so a command that stops between days leaves no open transaction and
 * no half-written day behind. A `close()` here would be an interface member
 * with no caller, which `pnpm knip` cannot see and a reader would take for a
 * resource that needs releasing.
 */
export interface AnalyticsIngest {
  /**
   * Insert one whole UTC day's rows, atomically. An empty `rows` is a caller
   * error rather than a no-op: a day with nothing to write is a day the caller
   * should not have asked to insert, and treating it as success would make an
   * "inserted" report line true of a day that got nothing.
   */
  insertDay(day: string, rows: readonly PageView[]): Promise<void>;
}
