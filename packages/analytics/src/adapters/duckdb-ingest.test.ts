/**
 * The write adapter's statements, its transaction and its refusals, read off a
 * **recording connection** substituted at the `connect` seam. No test here
 * starts DuckDB: the session module's real `connectDuckDb` is never called, so
 * what is asserted is exactly the SQL an operator's session would run.
 *
 * The read adapter's own suite covers everything the two share - the bound
 * credentials, the redaction, the attach target, the error translation - and
 * it is not restated here. What is here is what writing adds: the attach that
 * is *not* read-only, the one transaction per day, the batching, and the two
 * contract refusals `AnalyticsIngest` documents.
 */

import { parseConfig, staticCredentials } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { validateAnalyticsConfig } from '../config.js';
import { PAGE_VIEWS_COLUMNS, type PageView } from '../schema.js';
import { createDuckDbAnalyticsIngest } from './duckdb-ingest.js';
import { createDuckDbAnalyticsQuery } from './duckdb-query.js';
import type {
  DuckDbBindings,
  DuckDbConnect,
  DuckDbConnection,
  DuckDbSessionContext,
} from './duckdb-session.js';

/** Credentials with a session token, the shape an SSO or assumed-role session resolves to. */
const CREDENTIALS = {
  accessKeyId: 'AKIAEXAMPLEKEYID',
  secretAccessKey: 'wJalrXUtnFEMI-K7MDENG-EXAMPLEKEY',
  sessionToken: 'FwoGZXIvYXdzEXAMPLESESSIONTOKEN',
};

/** The account the site's resources live in - what the table bucket's ARN carries. */
const ACCOUNT_ID = '123456789012';

/** The bucket ARN the `production` / `example` context below resolves to. */
const ATTACH_TARGET = `arn:aws:s3tables:us-east-1:${ACCOUNT_ID}:bucket/production-example-analytics`;

/** The day every insert in this file names. */
const DAY = '2026-08-18';

/** A row carrying only the columns the table requires; the other fifteen are absent. */
const SPARSE_ROW: PageView = {
  event_time: `${DAY}T09:41:07.512Z`,
  day: DAY,
  host: 'example.com',
  uri: '/posts/hello-world',
  status: 200,
};

/** A row carrying an optional column of each stored type. */
const FULL_ROW: PageView = {
  ...SPARSE_ROW,
  query: 'utm_source=rss',
  bytes_sent: 14832,
  time_taken: 0.041,
  is_bot: false,
  visitor_key: '699408ed0df313a11118206c1ce49c3a59e96d641429ad001bfbccddbe60501d',
};

/** A plugin context the way the host builds one, so task 44's `ENV_DERIVED` seal stays shut. */
function contextFor(): DuckDbSessionContext {
  return {
    env: 'production',
    config: parseConfig(JSON.stringify({ siteName: 'example', region: 'us-east-1' })),
    pluginConfig: validateAnalyticsConfig({}),
    accountId: ACCOUNT_ID,
  };
}

/** One statement the adapter issued, with whatever it bound to it. */
interface RecordedStatement {
  readonly sql: string;
  readonly bindings: DuckDbBindings;
}

/** A recording `connect` seam, plus what it saw. */
interface Recorder {
  readonly connect: DuckDbConnect;
  readonly statements: RecordedStatement[];
  opened(): number;
}

/** A `connect` seam that records every statement, and can be told to fail on one. */
function recordingConnect(opts: { failOn?: (sql: string) => unknown } = {}): Recorder {
  const statements: RecordedStatement[] = [];
  let opened = 0;
  const connect: DuckDbConnect = () => {
    opened += 1;
    const connection: DuckDbConnection = {
      run(sql, bindings) {
        statements.push({ sql, bindings });
        const failure = opts.failOn?.(sql);
        if (failure !== undefined) return Promise.reject(failure);
        return Promise.resolve([]);
      },
      close() {},
    };
    return Promise.resolve(connection);
  };
  return { connect, statements, opened: () => opened };
}

/** An ingest adapter over a recording connection. */
function ingestOver(recorder: Recorder): ReturnType<typeof createDuckDbAnalyticsIngest> {
  return createDuckDbAnalyticsIngest({
    ctx: contextFor(),
    credentials: staticCredentials(CREDENTIALS),
    connect: recorder.connect,
  });
}

/** The statements starting with `prefix`, in issue order. */
function starting(statements: readonly RecordedStatement[], prefix: string): RecordedStatement[] {
  return statements.filter((statement) => statement.sql.startsWith(prefix));
}

describe('createDuckDbAnalyticsIngest: the statements it issues', () => {
  it('exposes the port and nothing wider - no statement in, no read path out', () => {
    expect(Object.keys(ingestOver(recordingConnect()))).toEqual(['insertDay']);
  });

  it('attaches the catalog writable, where the read adapter attaches it read-only', async () => {
    const writer = recordingConnect();
    await ingestOver(writer).insertDay(DAY, [SPARSE_ROW]);
    const reader = recordingConnect();
    await createDuckDbAnalyticsQuery({
      ctx: contextFor(),
      credentials: staticCredentials(CREDENTIALS),
      connect: reader.connect,
    }).run('row-count', { range: { from: DAY, to: DAY }, includeBots: true });

    const writeAttach = starting(writer.statements, 'ATTACH')[0]?.sql;
    const readAttach = starting(reader.statements, 'ATTACH')[0]?.sql;
    expect(writeAttach).toBe(
      `ATTACH '${ATTACH_TARGET}' AS "analytics" (TYPE iceberg, ENDPOINT_TYPE s3_tables, SECRET blogwright_analytics)`,
    );
    expect(readAttach).toBe(
      `ATTACH '${ATTACH_TARGET}' AS "analytics" (TYPE iceberg, ENDPOINT_TYPE s3_tables, SECRET blogwright_analytics, READ_ONLY)`,
    );
    expect(writeAttach).not.toContain('READ_ONLY');
  });

  it('wraps the day in one transaction, in order', async () => {
    const recorder = recordingConnect();
    await ingestOver(recorder).insertDay(DAY, [SPARSE_ROW, FULL_ROW]);

    const transactional = recorder.statements
      .map((statement) => statement.sql)
      .filter((sql) => /^(BEGIN|INSERT|COMMIT|ROLLBACK)/.test(sql))
      .map((sql) => sql.split(' ')[0]);
    expect(transactional).toEqual(['BEGIN', 'INSERT', 'COMMIT']);
  });

  it('names every column of the table, each cast to the type the schema declares', async () => {
    const recorder = recordingConnect();
    await ingestOver(recorder).insertDay(DAY, [SPARSE_ROW]);

    // Written out rather than derived from `PAGE_VIEWS_COLUMNS`: a statement
    // built from the same table the module builds it from would agree with
    // whatever that module did, including writing every column as VARCHAR.
    expect(starting(recorder.statements, 'INSERT')[0]?.sql).toBe(
      'INSERT INTO "analytics"."web"."page_views" ("event_time", "day", "host", "uri", "query", "method", "status", "referrer", "user_agent", "country", "asn", "edge_location", "result_type", "bytes_sent", "time_taken", "content_type", "protocol", "request_id", "visitor_key", "is_bot") VALUES (CAST($r0_event_time AS TIMESTAMP), CAST($r0_day AS DATE), CAST($r0_host AS VARCHAR), CAST($r0_uri AS VARCHAR), CAST($r0_query AS VARCHAR), CAST($r0_method AS VARCHAR), CAST($r0_status AS INTEGER), CAST($r0_referrer AS VARCHAR), CAST($r0_user_agent AS VARCHAR), CAST($r0_country AS VARCHAR), CAST($r0_asn AS VARCHAR), CAST($r0_edge_location AS VARCHAR), CAST($r0_result_type AS VARCHAR), CAST($r0_bytes_sent AS BIGINT), CAST($r0_time_taken AS DOUBLE), CAST($r0_content_type AS VARCHAR), CAST($r0_protocol AS VARCHAR), CAST($r0_request_id AS VARCHAR), CAST($r0_visitor_key AS VARCHAR), CAST($r0_is_bot AS BOOLEAN))',
    );
    // The column count is the table's, so a column added there without a cast
    // added here fails rather than being silently left out of the insert.
    expect(PAGE_VIEWS_COLUMNS).toHaveLength(20);
  });

  it('binds an absent optional column as NULL rather than omitting it', async () => {
    const recorder = recordingConnect();
    await ingestOver(recorder).insertDay(DAY, [SPARSE_ROW]);

    const insert = starting(recorder.statements, 'INSERT')[0];
    expect(insert?.bindings['r0_host']).toBe('example.com');
    expect(insert?.bindings['r0_status']).toBe(200);
    // Present as a binding and null, not omitted: an omitted placeholder is a
    // statement DuckDB refuses, and a dropped column is a silently wrong row.
    expect(Object.hasOwn(insert?.bindings ?? {}, 'r0_query')).toBe(true);
    expect(insert?.bindings['r0_query']).toBeNull();
    expect(insert?.bindings['r0_visitor_key']).toBeNull();
  });

  it('binds each row under its own placeholder prefix', async () => {
    const recorder = recordingConnect();
    await ingestOver(recorder).insertDay(DAY, [SPARSE_ROW, FULL_ROW]);

    const insert = starting(recorder.statements, 'INSERT')[0];
    expect(insert?.bindings['r0_query']).toBeNull();
    expect(insert?.bindings['r1_query']).toBe('utm_source=rss');
    expect(insert?.bindings['r1_is_bot']).toBe(false);
    expect(insert?.bindings['r1_time_taken']).toBe(0.041);
  });

  it('splits a large day into batched statements inside the one transaction', async () => {
    const recorder = recordingConnect();
    // Each row distinguishable, so the assertion below is about which rows
    // landed in which batch rather than only about how many did.
    const rows: PageView[] = Array.from({ length: 501 }, (_unused, index) => ({
      ...SPARSE_ROW,
      request_id: `r${index}`,
    }));
    await ingestOver(recorder).insertDay(DAY, rows);

    const inserts = starting(recorder.statements, 'INSERT');
    expect(inserts).toHaveLength(2);
    expect(starting(recorder.statements, 'BEGIN')).toHaveLength(1);
    expect(starting(recorder.statements, 'COMMIT')).toHaveLength(1);
    // The batches partition the day: the first carries rows 0..499 and the
    // second carries the one that is left, under its own placeholder prefix.
    expect(inserts[0]?.bindings['r0_request_id']).toBe('r0');
    expect(inserts[0]?.bindings['r499_request_id']).toBe('r499');
    expect(Object.hasOwn(inserts[0]?.bindings ?? {}, 'r500_request_id')).toBe(false);
    expect(inserts[1]?.bindings['r0_request_id']).toBe('r500');
    expect(Object.keys(inserts[1]?.bindings ?? {}).filter((key) => key.startsWith('r1_'))).toEqual(
      [],
    );
  });
});

describe('createDuckDbAnalyticsIngest: when a statement fails', () => {
  it('rolls back, never commits, and names the day and the attach target', async () => {
    const recorder = recordingConnect({
      failOn: (sql) => (sql.startsWith('INSERT') ? new Error('Conversion Error: boom') : undefined),
    });

    await expect(ingestOver(recorder).insertDay(DAY, [SPARSE_ROW])).rejects.toThrow(
      `analytics ingest of day ${DAY} into ${ATTACH_TARGET} failed while inserting the rows: Conversion Error: boom`,
    );
    expect(starting(recorder.statements, 'ROLLBACK')).toHaveLength(1);
    expect(starting(recorder.statements, 'COMMIT')).toEqual([]);
  });

  it('lets no vendor error object out, even when the vendor error is not an Error', async () => {
    const recorder = recordingConnect({
      failOn: (sql) => (sql.startsWith('INSERT') ? { duckdb: 'a vendor object' } : undefined),
    });

    const failure = await ingestOver(recorder)
      .insertDay(DAY, [SPARSE_ROW])
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBeUndefined();
    expect((failure as Error).message).toContain('[object Object]');
  });

  it('carries a rollback that itself fails without hiding the failure that caused it', async () => {
    const recorder = recordingConnect({
      failOn: (sql) =>
        sql.startsWith('INSERT') || sql.startsWith('ROLLBACK')
          ? new Error(`${sql.split(' ')[0]} failed`)
          : undefined,
    });

    await expect(ingestOver(recorder).insertDay(DAY, [SPARSE_ROW])).rejects.toThrow(
      'INSERT failed',
    );
  });
});

describe('createDuckDbAnalyticsIngest: the contract it refuses', () => {
  it('refuses an empty day before opening a connection', async () => {
    const recorder = recordingConnect();
    await expect(ingestOver(recorder).insertDay(DAY, [])).rejects.toThrow(
      `analytics ingest was asked to insert day ${DAY} with no rows`,
    );
    expect(recorder.opened()).toBe(0);
  });

  it('refuses a batch carrying a row for another day, before opening a connection', async () => {
    const recorder = recordingConnect();
    const foreign: PageView = { ...SPARSE_ROW, day: '2026-08-19' };
    await expect(ingestOver(recorder).insertDay(DAY, [SPARSE_ROW, foreign])).rejects.toThrow(
      `analytics ingest was asked to insert day ${DAY} carrying a row for day 2026-08-19`,
    );
    expect(recorder.opened()).toBe(0);
  });
});
