/**
 * Analytics-owned ports. Shared ports (`FileSystem`, `Terminal`) come from
 * blogwright-core; the ports here serve only this package, following the CLI's
 * private-ports precedent (`packages/cli/src/ports.ts:1-6`).
 *
 * **The vendor library lives only behind these interfaces.** DuckDB is what
 * actually answers a named query - it attaches the S3 Tables catalog in
 * read-only mode and runs the statement - and DuckDB's node-api package is
 * imported nowhere in this package except the adapter under `adapters/` that
 * implements {@link AnalyticsQuery}. (Named in prose rather than spelled as
 * the package specifier, so the definition of done's grep for that specifier
 * over this tree does not trip over a comment.) Nothing in the signatures
 * below names a DuckDB type either: a result row is this package's own
 * {@link QueryRow}, not a vendor result object, so the named query set, the
 * local server and the dashboard's data shaping all compile with no knowledge
 * that DuckDB exists.
 *
 * That containment is load-bearing rather than tidy. The change spec records
 * DuckDB's iceberg extension as *preview*, so its attach syntax may move, and
 * it records that the "no Lake Formation grant" assumption holds only while
 * the table bucket stays in IAM access-control mode. The port is what keeps
 * either of those turning into an edit spread across the dashboard: both land
 * in one adapter, which is also where DuckDB's errors are mapped into the
 * repo's own vocabulary.
 *
 * Tests never start DuckDB. They substitute at this port with the
 * fixture-backed fake in `fixture-query.ts`, which answers the same named set
 * through the same lookup and range validation the real adapter uses.
 */

import type { QueryName, QueryParams } from './queries.js';

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
