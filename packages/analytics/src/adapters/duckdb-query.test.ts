/**
 * Two halves, testing two different things.
 *
 * The first substitutes a **recording connection** at the adapter's `connect`
 * seam and reads the statements it issues: which credential values reach the
 * secret, that the attach is read-only and names the configured bucket's ARN,
 * that the fixed relation is bound to the configured triple, and that no
 * vendor error object ever leaves the module.
 *
 * The second runs the *real* DuckDB - through the session module's own
 * {@link connectDuckDb}, so this file names no vendor package and DuckDB stays
 * confined to `duckdb-session.ts` - against a local `page_views` table with real
 * rows, and executes all seven of `queries.ts`' definitions over it. That half
 * exists because task 45 could not: there was no adapter then, so
 * `FILTER (WHERE ...)`, `sum(...) OVER ()`, `CAST($from AS DATE)` against a
 * DATE column and a bound parameter in boolean position were all unexecuted.
 * `unique-visitors` gets the closest reading, because a dialect difference
 * there fails by returning a plausible number rather than an error.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeFileSystem, parseConfig, staticCredentials } from 'blogwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveAnalyticsConfig, validateAnalyticsConfig } from '../config.js';
import type { AnalyticsQuery, QueryRow } from '../ports.js';
import {
  ANALYTICS_QUERY_NAMES,
  PAGE_VIEWS_RELATION,
  type PreparedQuery,
  prepareQuery,
  type QueryName,
  type QueryParams,
  queryDefinition,
} from '../queries.js';
import { bindPageViewsRelation, createDuckDbAnalyticsQuery } from './duckdb-query.js';
import {
  type DuckDbBindings,
  connectDuckDb,
  type DuckDbConnect,
  type DuckDbConnection,
  type DuckDbSessionContext,
  pageViewsRelation,
} from './duckdb-session.js';

/** Credentials with a session token, the shape an SSO or assumed-role session resolves to. */
const CREDENTIALS = {
  accessKeyId: 'AKIAEXAMPLEKEYID',
  secretAccessKey: 'wJalrXUtnFEMI-K7MDENG-EXAMPLEKEY',
  sessionToken: 'FwoGZXIvYXdzEXAMPLESESSIONTOKEN',
};

/** The account the site's resources live in - what the table bucket's ARN carries. */
const ACCOUNT_ID = '123456789012';

/** The bucket ARN the default `production` / `example` context resolves to. */
const ATTACH_TARGET = `arn:aws:s3tables:us-east-1:${ACCOUNT_ID}:bucket/production-example-analytics`;

/** The range every test asks for, and the days the fixture rows straddle. */
const RANGE = { from: '2026-08-01', to: '2026-08-03' };

/**
 * A plugin context carrying a validated `analytics` block, built the way the
 * host builds one - `validateAnalyticsConfig` over the raw block beside the
 * site config `parseConfig` returns - so the adapter reaches the bucket name
 * only through `resolveAnalyticsConfig` and task 44's seal stays shut.
 */
function contextFor(
  site: { env: string; siteName: string; region?: string },
  raw: unknown = {},
): DuckDbSessionContext {
  return {
    env: site.env,
    config: parseConfig(
      JSON.stringify({ siteName: site.siteName, region: site.region ?? 'us-east-1' }),
    ),
    pluginConfig: validateAnalyticsConfig(raw),
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
  closed(): number;
}

/** A `connect` seam that records every statement, and can be told to fail on one. */
function recordingConnect(opts: { failOn?: (sql: string) => unknown } = {}): Recorder {
  const statements: RecordedStatement[] = [];
  let opened = 0;
  let closed = 0;
  const connect: DuckDbConnect = () => {
    opened += 1;
    const connection: DuckDbConnection = {
      run(sql, bindings) {
        statements.push({ sql, bindings });
        const failure = opts.failOn?.(sql);
        if (failure !== undefined) return Promise.reject(failure);
        return Promise.resolve([]);
      },
      close() {
        closed += 1;
      },
    };
    return Promise.resolve(connection);
  };
  return { connect, statements, opened: () => opened, closed: () => closed };
}

/** An adapter over a recording connection, for the default `production`/`example` site. */
function adapterOver(recorder: Recorder, raw: unknown = {}, region?: string): AnalyticsQuery {
  return createDuckDbAnalyticsQuery({
    ctx: contextFor({ env: 'production', siteName: 'example', ...(region && { region }) }, raw),
    credentials: staticCredentials(CREDENTIALS),
    connect: recorder.connect,
  });
}

/** The one recorded statement starting with `prefix`, failing loudly when there is not exactly one. */
function only(statements: readonly RecordedStatement[], prefix: string): RecordedStatement {
  const matches = statements.filter((statement) => statement.sql.startsWith(prefix));
  expect(matches.map((statement) => statement.sql)).toHaveLength(1);
  // Justified by the assertion above: exactly one statement matched.
  return matches[0] as RecordedStatement;
}

describe('createDuckDbAnalyticsQuery: the statements it issues', () => {
  it('exposes the port and nothing wider - no statement in, no write path out', () => {
    expect(Object.keys(adapterOver(recordingConnect()))).toEqual(['run']);
  });

  it('binds the resolved credentials into the secret statement', async () => {
    const recorder = recordingConnect();
    await adapterOver(recorder, {}, 'eu-west-2').run('views-over-time', { range: RANGE });

    expect(only(recorder.statements, 'CREATE OR REPLACE SECRET').bindings).toEqual({
      access_key_id: 'AKIAEXAMPLEKEYID',
      secret_access_key: 'wJalrXUtnFEMI-K7MDENG-EXAMPLEKEY',
      session_token: 'FwoGZXIvYXdzEXAMPLESESSIONTOKEN',
      region: 'eu-west-2',
    });
  });

  it('keeps the credential values out of the statement text, where a parser error could echo them', async () => {
    const recorder = recordingConnect();
    await adapterOver(recorder).run('views-over-time', { range: RANGE });

    expect(only(recorder.statements, 'CREATE OR REPLACE SECRET').sql).toBe(
      'CREATE OR REPLACE SECRET blogwright_analytics (TYPE s3, PROVIDER config, KEY_ID $access_key_id, SECRET $secret_access_key, REGION $region, SESSION_TOKEN $session_token)',
    );
    const everyStatement = recorder.statements.map((statement) => statement.sql).join('\n');
    for (const value of Object.values(CREDENTIALS)) {
      expect(everyStatement).not.toContain(value);
    }
  });

  it('drops the session-token clause when the credentials carry no token', async () => {
    const recorder = recordingConnect();
    const query = createDuckDbAnalyticsQuery({
      ctx: contextFor({ env: 'production', siteName: 'example' }),
      credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
      connect: recorder.connect,
    });
    await query.run('views-over-time', { range: RANGE });

    const secret = only(recorder.statements, 'CREATE OR REPLACE SECRET');
    expect(secret.sql).not.toContain('SESSION_TOKEN');
    expect(secret.bindings).toEqual({
      access_key_id: 'AKIA',
      secret_access_key: 'secret',
      region: 'us-east-1',
    });
  });

  it('attaches the S3 Tables catalog read-only, against the secret it just created', async () => {
    const recorder = recordingConnect();
    await adapterOver(recorder).run('views-over-time', { range: RANGE });

    expect(only(recorder.statements, 'ATTACH').sql).toBe(
      `ATTACH '${ATTACH_TARGET}' AS "analytics" (TYPE iceberg, ENDPOINT_TYPE s3_tables, SECRET blogwright_analytics, READ_ONLY)`,
    );
  });

  it('loads the extensions the attach needs before creating the secret', async () => {
    const recorder = recordingConnect();
    await adapterOver(recorder).run('views-over-time', { range: RANGE });

    expect(recorder.statements.slice(0, 4).map((statement) => statement.sql)).toEqual([
      'INSTALL httpfs',
      'LOAD httpfs',
      'INSTALL iceberg',
      'LOAD iceberg',
    ]);
  });

  it('takes the attach target from the environment-carrying config, so two environments differ', async () => {
    const attached: string[] = [];
    for (const env of ['staging', 'production']) {
      const recorder = recordingConnect();
      const query = createDuckDbAnalyticsQuery({
        ctx: contextFor({ env, siteName: 'example' }),
        credentials: staticCredentials(CREDENTIALS),
        connect: recorder.connect,
      });
      await query.run('views-over-time', { range: RANGE });
      attached.push(only(recorder.statements, 'ATTACH').sql);
    }
    expect(attached[0]).toContain('bucket/staging-example-analytics');
    expect(attached[1]).toContain('bucket/production-example-analytics');
  });

  it('honours a configured table bucket, namespace and table', async () => {
    const recorder = recordingConnect();
    const query = adapterOver(
      recorder,
      { tableBucket: 'chosen-bucket', namespace: 'other_ns', table: 'other_table' },
      'eu-west-2',
    );
    await query.run('views-over-time', { range: RANGE });

    expect(only(recorder.statements, 'ATTACH').sql).toContain(
      `'arn:aws:s3tables:eu-west-2:${ACCOUNT_ID}:bucket/chosen-bucket'`,
    );
    expect(only(recorder.statements, 'SELECT').sql).toContain(
      `FROM "analytics"."other_ns"."other_table"`,
    );
  });

  it('binds the fixed relation name into every one of the seven definitions', async () => {
    for (const name of ANALYTICS_QUERY_NAMES) {
      const recorder = recordingConnect();
      await adapterOver(recorder).run(name, { range: RANGE });

      const executed = recorder.statements.at(-1);
      expect(executed?.sql).toContain(`FROM "analytics"."web"."page_views"`);
      expect(executed?.sql).not.toMatch(/FROM page_views/);
      expect(executed?.bindings).toEqual({ ...RANGE, include_bots: true });
    }
  });

  it('resolves credentials and attaches once, however many queries are asked', async () => {
    let resolutions = 0;
    const recorder = recordingConnect();
    const query = createDuckDbAnalyticsQuery({
      ctx: contextFor({ env: 'production', siteName: 'example' }),
      credentials: () => {
        resolutions += 1;
        return Promise.resolve(CREDENTIALS);
      },
      connect: recorder.connect,
    });
    await query.run('views-over-time', { range: RANGE });
    await query.run('top-paths', { range: RANGE });

    expect(resolutions).toBe(1);
    expect(recorder.opened()).toBe(1);
    expect(recorder.statements.filter((s) => s.sql.startsWith('ATTACH'))).toHaveLength(1);
  });

  it('closes and forgets a session whose setup failed, so the next query retries it', async () => {
    let attaches = 0;
    const recorder = recordingConnect({
      failOn: (sql) => {
        if (!sql.startsWith('ATTACH')) return undefined;
        attaches += 1;
        return attaches === 1 ? new Error('expired token') : undefined;
      },
    });
    const query = adapterOver(recorder);

    await expect(query.run('views-over-time', { range: RANGE })).rejects.toThrow('expired token');
    expect(recorder.closed()).toBe(1);
    await expect(query.run('views-over-time', { range: RANGE })).resolves.toEqual([]);
    expect(recorder.opened()).toBe(2);
  });

  it('refuses an unknown query name before it opens a connection', async () => {
    const recorder = recordingConnect();
    // The port's parameter is a `QueryName`; the seam that fills it is an HTTP
    // path, where the compiler's guarantee has already been erased.
    const unknown: string = 'drop-everything';

    await expect(adapterOver(recorder).run(unknown as QueryName, { range: RANGE })).rejects.toThrow(
      'unknown analytics query "drop-everything"',
    );
    expect(recorder.opened()).toBe(0);
  });

  it('refuses an inverted range before it opens a connection', async () => {
    const recorder = recordingConnect();

    await expect(
      adapterOver(recorder).run('views-over-time', {
        range: { from: '2026-08-03', to: RANGE.from },
      }),
    ).rejects.toThrow('range is inverted');
    expect(recorder.opened()).toBe(0);
  });
});

/**
 * A vendor error, standing in for the one DuckDB's node bindings raise. Named in
 * prose rather than spelled as the package specifier, for the reason `ports.ts`
 * gives: the definition of done greps this tree for that specifier and only the
 * adapter may match it.
 */
class VendorError extends Error {
  readonly vendorHandle = 'duckdb internal';
}

describe('createDuckDbAnalyticsQuery: error translation', () => {
  /** The query statement itself, whichever of the seven it is - `cache-hit-ratio` opens with `WITH`. */
  const isTheQuery = (sql: string): boolean => sql.includes(`FROM "analytics"."web"."page_views"`);

  /** An adapter whose connection fails on the statements `matches` picks out. */
  function failingOn(matches: (sql: string) => boolean, failure: unknown): AnalyticsQuery {
    return adapterOver(recordingConnect({ failOn: (sql) => (matches(sql) ? failure : undefined) }));
  }

  /** Run a query and hand back whatever it threw. */
  async function thrownBy(query: AnalyticsQuery): Promise<unknown> {
    try {
      await query.run('cache-hit-ratio', { range: RANGE });
    } catch (err) {
      return err;
    }
    throw new Error('the query resolved, so there was nothing to translate');
  }

  /** What `thrownBy` produced, as an `Error` - it raises if it produced anything else. */
  function messageOf(thrown: unknown): string {
    expect(thrown).toBeInstanceOf(Error);
    return (thrown as Error).message;
  }

  it('names the query, the attach target and the failing step when a statement fails', async () => {
    const thrown = await thrownBy(
      failingOn(isTheQuery, new VendorError('Binder Error: no column')),
    );
    expect(messageOf(thrown)).toBe(
      `analytics query "cache-hit-ratio" against ${ATTACH_TARGET} failed while executing the statement: Binder Error: no column`,
    );
  });

  it('names the attach step when the catalog cannot be attached', async () => {
    const thrown = await thrownBy(
      failingOn((sql) => sql.startsWith('ATTACH'), new VendorError('403 Forbidden')),
    );
    expect(messageOf(thrown)).toBe(
      `analytics query "cache-hit-ratio" against ${ATTACH_TARGET} failed while attaching the catalog read-only: 403 Forbidden`,
    );
  });

  it('names the secret step when the secret cannot be created', async () => {
    const thrown = await thrownBy(
      failingOn(
        (sql) => sql.startsWith('CREATE OR REPLACE SECRET'),
        new VendorError('Binder Error: unknown parameter'),
      ),
    );
    expect(messageOf(thrown)).toContain(
      'failed while creating the credentials secret: Binder Error: unknown parameter',
    );
  });

  it('names the credential-resolution step when the provider chain fails', async () => {
    const recorder = recordingConnect();
    const query = createDuckDbAnalyticsQuery({
      ctx: contextFor({ env: 'production', siteName: 'example' }),
      credentials: () => Promise.reject(new VendorError('could not load credentials')),
      connect: recorder.connect,
    });

    expect(messageOf(await thrownBy(query))).toContain(
      'failed while resolving AWS credentials: could not load credentials',
    );
    expect(recorder.opened()).toBe(0);
  });

  it('lets no vendor error object escape', async () => {
    const vendorError = new VendorError('Invalid Configuration Error');
    const thrown = await thrownBy(failingOn(isTheQuery, vendorError));

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(VendorError);
    expect(thrown).not.toBe(vendorError);
    expect((thrown as Error).cause).toBeUndefined();
    expect(Object.hasOwn(thrown as object, 'vendorHandle')).toBe(false);
  });

  it('translates a thrown non-Error too, rather than passing it through', async () => {
    const thrown = await thrownBy(failingOn(isTheQuery, 'a bare string from the binding layer'));
    expect(thrown).toBeInstanceOf(Error);
    expect(messageOf(thrown)).toContain('a bare string from the binding layer');
  });

  it('redacts credential values a vendor message came back carrying', async () => {
    const leaky = new VendorError(
      `Conversion Error: could not convert '${CREDENTIALS.secretAccessKey}' (token ${CREDENTIALS.sessionToken}, key ${CREDENTIALS.accessKeyId})`,
    );
    const thrown = await thrownBy(failingOn(isTheQuery, leaky));

    for (const value of Object.values(CREDENTIALS)) {
      expect(messageOf(thrown)).not.toContain(value);
    }
    expect(messageOf(thrown)).toContain('<redacted>');
  });
});

describe('bindPageViewsRelation', () => {
  /** A prepared query carrying `sql` and nothing else that matters here. */
  function preparing(sql: string): PreparedQuery {
    return { name: 'views-over-time', sql, resultColumns: [], bindings: {} };
  }

  it('rewrites the fixed relation wherever a statement names it as a whole word', () => {
    const sql = `SELECT count(*) FROM ${PAGE_VIEWS_RELATION} JOIN ${PAGE_VIEWS_RELATION} USING (day)`;
    expect(bindPageViewsRelation(preparing(sql), '"c"."n"."t"')).toBe(
      'SELECT count(*) FROM "c"."n"."t" JOIN "c"."n"."t" USING (day)',
    );
  });

  it('leaves a name that merely contains the relation alone', () => {
    const sql = `SELECT daily_page_views FROM ${PAGE_VIEWS_RELATION}`;
    expect(bindPageViewsRelation(preparing(sql), '"c"."n"."t"')).toBe(
      'SELECT daily_page_views FROM "c"."n"."t"',
    );
  });

  it('refuses a statement that names no relation, rather than reading nothing', () => {
    expect(() => bindPageViewsRelation(preparing('SELECT 1'), '"c"."n"."t"')).toThrow(
      'analytics query "views-over-time" names no page_views relation to bind, so it would read nothing',
    );
  });
});

/**
 * The `page_views` columns and types `schema.ts` declares, as DuckDB DDL. The
 * point of the second half of this file is that the seven definitions run
 * against a table shaped like the real one - a DATE `day`, a BOOLEAN `is_bot`
 * that may be null, an INTEGER `status` - so `CAST($from AS DATE)` and
 * `coalesce(is_bot, false)` meet the types they will meet in production.
 */
const PAGE_VIEWS_DDL = `(
  event_time TIMESTAMP NOT NULL, day DATE NOT NULL, host VARCHAR NOT NULL, uri VARCHAR NOT NULL,
  query VARCHAR, method VARCHAR, status INTEGER NOT NULL, referrer VARCHAR, user_agent VARCHAR,
  country VARCHAR, asn VARCHAR, edge_location VARCHAR, result_type VARCHAR, bytes_sent BIGINT,
  time_taken DOUBLE, content_type VARCHAR, protocol VARCHAR, request_id VARCHAR,
  visitor_key VARCHAR, is_bot BOOLEAN
)`;

/**
 * One request, in the columns the seven queries read, as a positional tuple so
 * the fixture below reads as the table it is. `undefined` is a SQL NULL.
 */
type FixtureRow = readonly [
  day: string,
  uri: string,
  status: number,
  referrer: string | undefined,
  country: string | undefined,
  resultType: string,
  visitorKey: string,
  isBot: boolean | undefined,
];

/**
 * The fixture table. `k-a` returns on all three days, so the summed daily
 * uniques and a cross-day `count(DISTINCT visitor_key)` disagree - which is the
 * whole point of `unique-visitors`' shape - and the rows on 07-31 and 08-04 sit
 * outside the range, so the `day` bound has something to exclude.
 */
const FIXTURE_ROWS: readonly FixtureRow[] = [
  ['2026-07-31', '/old', 200, 'https://old.example', 'ZA', 'Hit', 'k-old', false],
  ['2026-08-01', '/', 200, 'https://ref.example', 'GB', 'Hit', 'k-a', false],
  ['2026-08-01', '/', 200, undefined, 'GB', 'RefreshHit', 'k-a', undefined],
  ['2026-08-01', '/about', 404, 'https://ref.example', undefined, 'Miss', 'k-b', false],
  ['2026-08-01', '/bot', 200, undefined, 'US', 'Miss', 'k-z', true],
  ['2026-08-02', '/', 200, 'https://ref.example', 'GB', 'Miss', 'k-a', false],
  ['2026-08-02', '/posts', 200, 'https://other.example', 'US', 'Hit', 'k-c', false],
  ['2026-08-03', '/', 500, undefined, 'US', 'Error', 'k-a', false],
  ['2026-08-04', '/new', 200, undefined, 'US', 'Hit', 'k-new', false],
];

/** A fixture value as a SQL literal. Test-owned constants only - nothing here comes from a caller. */
function literal(value: string | number | boolean | undefined): string {
  if (value === undefined) return 'NULL';
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/** The `INSERT` that seeds one fixture row. */
function insertFor(relation: string, row: FixtureRow): string {
  const [day, uri, status, referrer, country, resultType, visitorKey, isBot] = row;
  const values = [
    `CAST(${literal(day)} AS TIMESTAMP)`,
    `CAST(${literal(day)} AS DATE)`,
    `'example.com'`,
    ...[uri, status, referrer, country, resultType, visitorKey, isBot].map(literal),
  ];
  return `INSERT INTO ${relation}
    (event_time, day, host, uri, status, referrer, country, result_type, visitor_key, is_bot)
    VALUES (${values.join(', ')})`;
}

describe('the seven named queries, executed against a real DuckDB table', () => {
  const ctx = contextFor({ env: 'production', siteName: 'example' });
  const config = resolveAnalyticsConfig(ctx);
  const relation = pageViewsRelation(config);
  let connection: DuckDbConnection;

  /** Answer `name` over the fixture table, exactly as the adapter would. */
  async function run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]> {
    const prepared = prepareQuery(name, params, config);
    return connection.run(bindPageViewsRelation(prepared, relation), prepared.bindings);
  }

  beforeAll(async () => {
    connection = await connectDuckDb();
    await connection.run(`ATTACH ':memory:' AS "analytics"`, {});
    await connection.run(`CREATE SCHEMA "analytics"."${config.namespace}"`, {});
    await connection.run(`CREATE TABLE ${relation} ${PAGE_VIEWS_DDL}`, {});
    for (const row of FIXTURE_ROWS) await connection.run(insertFor(relation, row), {});
  });

  afterAll(() => {
    connection.close();
  });

  it('scopes daily viewers to a country before distinct counting and time/path/bot filtering', async () => {
    expect(
      await run('unique-visitors', { range: RANGE, country: 'GB', includeBots: true }),
    ).toEqual([
      { day: '2026-08-01', daily_unique_visitors: 1, summed_daily_unique_visitors: 2 },
      { day: '2026-08-02', daily_unique_visitors: 1, summed_daily_unique_visitors: 2 },
    ]);
    expect(
      await run('unique-visitors', {
        range: { from: '2026-08-01T00:00Z', to: '2026-08-03T00:00Z' },
        country: 'US',
        path: '/posts',
        includeBots: false,
      }),
    ).toEqual([{ day: '2026-08-02', daily_unique_visitors: 1, summed_daily_unique_visitors: 1 }]);
    expect(await run('unique-visitors', { range: RANGE, country: 'ZA' })).toEqual([]);
    expect(
      await run('unique-visitors', {
        range: RANGE,
        country: 'US',
        includeBots: true,
        splitBots: true,
      }),
    ).toEqual([
      {
        day: '2026-08-01',
        daily_unique_visitors: 1,
        non_bot: 0,
        bot: 1,
        summed_daily_unique_visitors: 3,
      },
      {
        day: '2026-08-02',
        daily_unique_visitors: 1,
        non_bot: 1,
        bot: 0,
        summed_daily_unique_visitors: 3,
      },
      {
        day: '2026-08-03',
        daily_unique_visitors: 1,
        non_bot: 1,
        bot: 0,
        summed_daily_unique_visitors: 3,
      },
    ]);
  });

  it('answers views-over-time with one row per day in the range', async () => {
    expect(await run('views-over-time', { range: RANGE, includeBots: false })).toEqual([
      { day: '2026-08-01', views: 3 },
      { day: '2026-08-02', views: 2 },
      { day: '2026-08-03', views: 1 },
    ]);
  });

  it('answers top-paths, most-requested first', async () => {
    expect(await run('top-paths', { range: RANGE, includeBots: false })).toEqual([
      { uri: '/', views: 4 },
      { uri: '/about', views: 1 },
      { uri: '/posts', views: 1 },
    ]);
  });

  it('answers referrers, dropping the requests that carried none', async () => {
    expect(await run('referrers', { range: RANGE, includeBots: false })).toEqual([
      { referrer: 'https://ref.example', views: 3 },
      { referrer: 'https://other.example', views: 1 },
    ]);
  });

  it('answers countries, dropping the requests with no country', async () => {
    expect(await run('countries', { range: RANGE, includeBots: false })).toEqual([
      { country: 'GB', views: 3 },
      { country: 'US', views: 2 },
    ]);
  });

  it('answers status-codes in code order', async () => {
    expect(await run('status-codes', { range: RANGE, includeBots: false })).toEqual([
      { status: 200, views: 4 },
      { status: 404, views: 1 },
      { status: 500, views: 1 },
    ]);
  });

  it('answers cache-hit-ratio, counting Hit and RefreshHit through FILTER (WHERE ...)', async () => {
    expect(await run('cache-hit-ratio', { range: RANGE, includeBots: false })).toEqual([
      { day: '2026-08-01', requests: 3, cache_hits: 2, cache_hit_ratio: 2 / 3 },
      { day: '2026-08-02', requests: 2, cache_hits: 1, cache_hit_ratio: 0.5 },
      { day: '2026-08-03', requests: 1, cache_hits: 0, cache_hit_ratio: 0 },
    ]);
  });

  it('answers unique-visitors as per-day counts beside their sum, not a cross-day distinct', async () => {
    expect(await run('unique-visitors', { range: RANGE, includeBots: false })).toEqual([
      { day: '2026-08-01', daily_unique_visitors: 2, summed_daily_unique_visitors: 5 },
      { day: '2026-08-02', daily_unique_visitors: 2, summed_daily_unique_visitors: 5 },
      { day: '2026-08-03', daily_unique_visitors: 1, summed_daily_unique_visitors: 5 },
    ]);

    // `k-a` requests on all three days, so a `count(DISTINCT visitor_key)` over
    // the whole range says 3 - a plausible number that means nothing once the
    // salt has rotated. The definition's 5 is the sum of the daily counts, and
    // the two disagreeing here is what makes this test able to tell them apart.
    expect(
      await connection.run(
        `SELECT count(DISTINCT visitor_key) AS across FROM ${relation}
         WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
           AND NOT coalesce(is_bot, false)`,
        RANGE,
      ),
    ).toEqual([{ across: 3 }]);
  });

  it('bounds the range on the day partition, excluding the days either side', async () => {
    const oneDay = { from: '2026-08-02', to: '2026-08-02' };
    expect(await run('views-over-time', { range: oneDay, includeBots: false })).toEqual([
      { day: '2026-08-02', views: 2 },
    ]);
    expect(await run('unique-visitors', { range: oneDay, includeBots: false })).toEqual([
      { day: '2026-08-02', daily_unique_visitors: 2, summed_daily_unique_visitors: 2 },
    ]);
    // `/old` is on 07-31 and `/new` on 08-04; no row inside the range carries either.
    const paths = await run('top-paths', { range: RANGE, includeBots: false });
    expect(paths.map((row) => row['uri'])).toEqual(['/', '/about', '/posts']);
  });

  it('honours the bound include_bots flag in boolean position, both ways', async () => {
    expect(await run('views-over-time', { range: RANGE, includeBots: false })).toEqual([
      { day: '2026-08-01', views: 3 },
      { day: '2026-08-02', views: 2 },
      { day: '2026-08-03', views: 1 },
    ]);
    expect(await run('views-over-time', { range: RANGE, includeBots: true })).toEqual([
      { day: '2026-08-01', views: 4 },
      { day: '2026-08-02', views: 2 },
      { day: '2026-08-03', views: 1 },
    ]);
    expect(await run('unique-visitors', { range: RANGE, includeBots: true })).toEqual([
      { day: '2026-08-01', daily_unique_visitors: 3, summed_daily_unique_visitors: 6 },
      { day: '2026-08-02', daily_unique_visitors: 2, summed_daily_unique_visitors: 6 },
      { day: '2026-08-03', daily_unique_visitors: 1, summed_daily_unique_visitors: 6 },
    ]);
  });

  it('takes an absent flag from the configured bots mode, not from a default of its own', async () => {
    // `flag` is what `config` above carries: bot rows are kept and marked, so an
    // absent flag counts the /bot request on 08-01.
    expect(await run('views-over-time', { range: RANGE })).toEqual([
      { day: '2026-08-01', views: 4 },
      { day: '2026-08-02', views: 2 },
      { day: '2026-08-03', views: 1 },
    ]);
    const filtered = prepareQuery('views-over-time', { range: RANGE }, { bots: 'filter' });
    expect(await connection.run(bindPageViewsRelation(filtered, relation), filtered.bindings)) //
      .toEqual([
        { day: '2026-08-01', views: 3 },
        { day: '2026-08-02', views: 2 },
        { day: '2026-08-03', views: 1 },
      ]);
  });

  it('returns exactly the result columns each definition declares', async () => {
    for (const name of ANALYTICS_QUERY_NAMES) {
      const rows = await run(name, { range: RANGE });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([...queryDefinition(name).resultColumns].sort());
      }
    }
  });
});

describe('a namespace named for a SQL keyword', () => {
  it('is quoted, so `order` reads as a namespace and not as a clause', async () => {
    const ctx = contextFor({ env: 'production', siteName: 'example' }, { namespace: 'order' });
    const config = resolveAnalyticsConfig(ctx);
    const relation = pageViewsRelation(config);
    const connection = await connectDuckDb();
    try {
      await connection.run(`ATTACH ':memory:' AS "analytics"`, {});
      await connection.run(`CREATE SCHEMA "analytics"."order"`, {});
      await connection.run(`CREATE TABLE ${relation} ${PAGE_VIEWS_DDL}`, {});
      const prepared = prepareQuery('views-over-time', { range: RANGE }, config);
      const rows = await connection.run(
        bindPageViewsRelation(prepared, relation),
        prepared.bindings,
      );
      expect(rows).toEqual([]);
    } finally {
      connection.close();
    }
  });
});

/**
 * The other injection surface, and the one the identifier quoting above does
 * not cover. `ATTACH` takes its target as a string literal - DuckDB accepts no
 * placeholder there - so the table bucket's ARN is the single configured value
 * this adapter spells into statement text rather than binding. Two of its three
 * components are constrained (`tableBucket` by `validateAnalyticsConfig`,
 * `accountId` by STS); `config.region` is checked only for truthiness, so a
 * region really is a way to put a `'` into that literal, and `runAndReadAll`
 * runs every statement in what it is handed - after `CREATE SECRET` has put the
 * operator's AWS credentials into the session.
 *
 * These three hold the *escaping*, not any validation elsewhere: remove the
 * `replaceAll` in `quoteLiteral` and all three go red, the last of them by
 * writing a file.
 */
describe('a configured value that tries to close the attach literal', () => {
  /** The whole attach statement the adapter issues for `region`. */
  async function attachFor(region: string): Promise<string> {
    const recorder = recordingConnect();
    await adapterOver(recorder, {}, region).run('views-over-time', { range: RANGE });
    return only(recorder.statements, 'ATTACH').sql;
  }

  /** The target literal out of an attach statement, quotes and all. */
  function targetLiteral(attach: string): string {
    const end = attach.lastIndexOf(' AS "analytics" (');
    expect(end).toBeGreaterThan(0);
    return attach.slice('ATTACH '.length, end);
  }

  /**
   * Whether a path has a file, through core's own `FileSystem` adapter - which
   * is what the repo's `no-restricted-imports` rule directs a non-adapter
   * module at, and enough here: this asks only whether DuckDB wrote something.
   */
  const files = createNodeFileSystem();

  it('doubles a lone quote, rather than letting the literal end on it', async () => {
    expect(await attachFor("us-east-1'--")).toBe(
      `ATTACH 'arn:aws:s3tables:us-east-1''--:${ACCOUNT_ID}:bucket/production-example-analytics'` +
        ' AS "analytics" (TYPE iceberg, ENDPOINT_TYPE s3_tables, SECRET blogwright_analytics, READ_ONLY)',
    );
  });

  it("round-trips that region through DuckDB's own parser as one value", async () => {
    const region = "us-east-1'--";
    const target = targetLiteral(await attachFor(region));
    const connection = await connectDuckDb();
    try {
      // DuckDB reading the literal back is the judge here: if the doubled quote
      // ended the string, `SELECT <target> AS target` is a syntax error rather
      // than a row, and had the quote been dropped instead the region would
      // come back changed.
      expect(await connection.run(`SELECT ${target} AS target`, {})).toEqual([
        { target: `arn:aws:s3tables:${region}:${ACCOUNT_ID}:bucket/production-example-analytics` },
      ]);
    } finally {
      connection.close();
    }
  });

  it('runs no statement a region smuggled in behind a closing quote', async () => {
    // `(TYPE duckdb)` is what makes this reachable with no AWS account and no
    // extension: the smuggled attach and the COPY behind it are both built-ins
    // and both sit ahead of the iceberg attach that fails. `runAndReadAll`
    // executes a whole statement list, so reaching the second one is the bug.
    // Both paths carry a token unique to this run, because nothing here can
    // delete them: a file either of these names exists only when the escaping
    // is gone, and a stale one from such a run must not redden the next.
    const token = crypto.randomUUID();
    const written = join(tmpdir(), `blogwright-analytics-injected-${token}.csv`);
    const region = `${token}' AS "inj" (TYPE duckdb); COPY (SELECT 42 AS pwned) TO '${written}'; ATTACH '`;
    /** What the smuggled `ATTACH` would create, relative to the package. */
    const attached = `arn:aws:s3tables:${token}`;
    const attach = await attachFor(region);
    const connection = await connectDuckDb();
    try {
      // Keeps this offline whatever the machine: without these, a checkout
      // with no cached iceberg extension would fetch one from DuckDB's
      // repository. The attach fails either way, which is all this needs.
      await connection.run('SET autoinstall_known_extensions = false', {});
      await connection.run('SET autoload_known_extensions = false', {});
      await expect(connection.run(attach, {})).rejects.toThrow();
      expect(await files.exists(written)).toBe(false);
      expect(await files.exists(attached)).toBe(false);
    } finally {
      connection.close();
    }
  });
});

describe('connectDuckDb: the values it hands back', () => {
  let connection: DuckDbConnection;

  beforeAll(async () => {
    connection = await connectDuckDb();
  });

  afterAll(() => {
    connection.close();
  });

  it('drops a SQL NULL rather than carrying it, so an absent value is an absent key', async () => {
    const rows = await connection.run(`SELECT NULL AS referrer, 1 AS views`, {});
    expect(rows).toEqual([{ views: 1 }]);
    // `toEqual` treats an `undefined` value as an absent key, so the key itself
    // is what this asserts: a reader never has to tell one from the other.
    expect(rows.map((row) => Object.keys(row))).toEqual([['views']]);
  });

  it('reads a DATE back as its YYYY-MM-DD day, with no Date and no time zone', async () => {
    expect(await connection.run(`SELECT DATE '2026-08-01' AS day`, {})).toEqual([
      { day: '2026-08-01' },
    ]);
  });

  it('reads a BIGINT count back as a number', async () => {
    const rows = await connection.run(`SELECT count(*) AS views FROM range(3)`, {});
    expect(rows).toEqual([{ views: 3 }]);
    expect(typeof rows[0]?.['views']).toBe('number');
  });

  it('raises rather than rounding an integer JavaScript cannot count exactly', async () => {
    await expect(connection.run(`SELECT 9007199254740993::HUGEINT AS views`, {})).rejects.toThrow(
      'analytics result column "views" is 9007199254740993, past the largest integer JavaScript counts exactly',
    );
  });
});
