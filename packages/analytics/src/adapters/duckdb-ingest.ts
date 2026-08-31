/**
 * The real {@link AnalyticsIngest}: DuckDB with the S3 Tables catalog attached
 * writable, inserting one whole UTC day per transaction. It is the write half
 * of the change spec's §Backfill of historical logs - "written through the
 * DuckDB dependency the dashboard already ships, behind a write port of its
 * own" - and it shares every part of the session with the read adapter beside
 * it through `duckdb-session.ts`: the same credential secret, the same attach
 * target, the same quoting and the same rule that no vendor error object
 * escapes. The one clause that differs is `READ_ONLY`, which this session
 * omits.
 *
 * **The steady-state pipeline does not come through here.** Firehose writes
 * the table itself; this module exists for the one-shot `analytics backfill`
 * action and is constructed only by that command. The dashboard's session is a
 * different object with `readOnly: true`, so nothing the server can be asked
 * to do reaches a writable connection.
 *
 * ## One day, one transaction
 *
 * `insertDay` is atomic by construction: `BEGIN TRANSACTION`, the day's rows,
 * `COMMIT`. That is what makes the backfill's idempotency hold under a crash -
 * a day is in the table or it is not, so the occupancy check the command runs
 * before each day cannot see half of one and skip the rest. A failure rolls
 * back and propagates: the command stops rather than carrying on to later
 * days, because a run that reported five days inserted while one failed in the
 * middle would leave an operator with no way to tell which history they have.
 *
 * The rows are batched into statements rather than sent one at a time, because
 * a day of a blog's traffic is thousands of rows and one round trip each would
 * make a backfill slower than the log read that feeds it. {@link
 * INSERT_BATCH_ROWS} bounds the statement; every batch is inside the one
 * transaction, so the batching is invisible to a reader of the table.
 *
 * ## Why the column list comes from `schema.ts`
 *
 * Every statement names all twenty columns in `PAGE_VIEWS_COLUMNS`' order and
 * binds a value or a NULL for each, rather than naming only the columns a row
 * happens to carry. Two reasons: a batch's rows do not all carry the same
 * optional columns, so a per-row column list would mean a statement per row;
 * and the cast each value is written through comes from the column's own
 * `icebergType`, so a column added to the table is a column this module writes
 * without being edited - the same property `map-record.ts` has on the read
 * side.
 */

import type { CredentialProvider } from 'blogwright-core';

import type { AnalyticsIngest } from '../ports.js';
import { PAGE_VIEWS_COLUMNS, type PageView, type PageViewsColumn } from '../schema.js';
import {
  createDuckDbSession,
  type DuckDbBindings,
  type DuckDbConnect,
  type DuckDbSessionContext,
  quoteIdentifier,
} from './duckdb-session.js';

/** What {@link createDuckDbAnalyticsIngest} is built from. */
export interface DuckDbAnalyticsIngestOptions {
  /**
   * The plugin context. The session resolves the analytics config from it
   * itself, so no caller can hand this adapter a bucket name that dropped the
   * environment - the same seal the read adapter is held to, and it matters
   * more here: a write against the wrong environment's table cannot be undone
   * by re-running the command.
   */
  readonly ctx: DuckDbSessionContext;
  /** Credentials for the catalog, resolved through core's provider chain. */
  readonly credentials: CredentialProvider;
  /**
   * How a DuckDB connection is obtained. Defaults to the session's own
   * `connectDuckDb`; a test substitutes a recording connection here.
   */
  readonly connect?: DuckDbConnect | undefined;
}

/**
 * How many rows one `INSERT` statement carries. Chosen against the statement
 * rather than against the data: twenty columns a row, so five hundred rows is
 * ten thousand bound placeholders - large enough that a day of a blog's
 * traffic is a handful of statements, small enough to stay well inside any
 * parser's limits and to keep one failure's error message readable.
 */
const INSERT_BATCH_ROWS = 500;

/** The SQL type each Iceberg column type is cast to on the way in. */
const SQL_TYPES: Record<PageViewsColumn['icebergType'], string> = {
  string: 'VARCHAR',
  timestamp: 'TIMESTAMP',
  date: 'DATE',
  int: 'INTEGER',
  long: 'BIGINT',
  double: 'DOUBLE',
  boolean: 'BOOLEAN',
};

/** The column list every insert names, in the table's own order. */
const COLUMN_LIST = PAGE_VIEWS_COLUMNS.map((column) => quoteIdentifier(column.name)).join(', ');

/**
 * The placeholder one row's column binds to. Row index and column name, so a
 * batch's placeholders are unique and a failure's message points at a row
 * rather than at a position.
 */
function placeholder(rowIndex: number, column: string): string {
  return `r${rowIndex}_${column}`;
}

/**
 * One batch as a statement and its bindings: every column cast to the type
 * `schema.ts` declares for it, and every absent optional column bound as NULL
 * rather than omitted. An absent value is what "the request had nothing to say
 * for this field" means, and it is exactly what the Firehose path writes for
 * the same record.
 */
function insertStatement(
  relation: string,
  rows: readonly PageView[],
): { sql: string; bindings: DuckDbBindings } {
  const bindings: Record<string, string | number | boolean | null> = {};
  const tuples = rows.map((row, rowIndex) => {
    const values = PAGE_VIEWS_COLUMNS.map((column) => {
      const name = placeholder(rowIndex, column.name);
      const value = row[column.name];
      bindings[name] = value === undefined ? null : value;
      return `CAST($${name} AS ${SQL_TYPES[column.icebergType]})`;
    });
    return `(${values.join(', ')})`;
  });
  return {
    sql: `INSERT INTO ${relation} (${COLUMN_LIST}) VALUES ${tuples.join(', ')}`,
    bindings,
  };
}

/** `rows` in chunks of at most {@link INSERT_BATCH_ROWS}. */
function batched(rows: readonly PageView[]): (readonly PageView[])[] {
  const batches: (readonly PageView[])[] = [];
  for (let start = 0; start < rows.length; start += INSERT_BATCH_ROWS) {
    batches.push(rows.slice(start, start + INSERT_BATCH_ROWS));
  }
  return batches;
}

/**
 * Build the DuckDB-backed {@link AnalyticsIngest}. Returns the port and
 * nothing wider, so a caller can insert days and can neither run a statement
 * of its own nor read the table back through it.
 *
 * The connection is opened lazily on the first insert, so constructing this at
 * the plugin's composition root costs nothing on a run that refuses before it
 * reaches the table - which is what the backfill's missing-`createdDay`
 * refusal does.
 */
export function createDuckDbAnalyticsIngest(opts: DuckDbAnalyticsIngestOptions): AnalyticsIngest {
  const session = createDuckDbSession({
    ctx: opts.ctx,
    credentials: opts.credentials,
    readOnly: false,
    connect: opts.connect,
  });

  function contextualise(day: string, err: unknown): Error {
    return new Error(
      `analytics ingest of day ${day} into ${session.attachTarget} failed while ${session.detail(err, 'inserting the rows')}`,
    );
  }

  return {
    async insertDay(day: string, rows: readonly PageView[]): Promise<void> {
      // Both refusals are the port's documented contract, checked before a
      // connection is opened so a caller's mistake costs no AWS round trip.
      if (rows.length === 0) {
        throw new Error(`analytics ingest was asked to insert day ${day} with no rows`);
      }
      const foreign = rows.find((row) => row.day !== day);
      if (foreign !== undefined) {
        throw new Error(
          `analytics ingest was asked to insert day ${day} carrying a row for day ${foreign.day}`,
        );
      }

      let connection;
      try {
        connection = await session.open();
      } catch (err) {
        throw contextualise(day, err);
      }

      try {
        await session.step('beginning the transaction', () =>
          connection.run('BEGIN TRANSACTION', {}),
        );
      } catch (err) {
        throw contextualise(day, err);
      }

      try {
        for (const batch of batched(rows)) {
          const statement = insertStatement(session.relation, batch);
          await session.step('inserting the rows', () =>
            connection.run(statement.sql, statement.bindings),
          );
        }
        await session.step('committing the transaction', () => connection.run('COMMIT', {}));
      } catch (err) {
        // Best effort, and deliberately not reported: the failure a caller
        // needs to read is the one that ended the insert, not a second one
        // raised while unwinding it. A rollback that itself fails leaves the
        // connection unusable, which is why the command above stops at the
        // first failing day rather than trying the next one on it.
        try {
          await connection.run('ROLLBACK', {});
        } catch {
          /* the original failure is the one worth raising */
        }
        throw contextualise(day, err);
      }
    },
  };
}
