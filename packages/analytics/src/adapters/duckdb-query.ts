/**
 * The real {@link AnalyticsQuery}: DuckDB with the S3 Tables catalog attached
 * read-only. This is the **only** module in the repo that imports
 * `@duckdb/node-api` (until task 61 adds `duckdb-ingest.ts` beside it), which
 * is what `ports.ts` promises and what the change spec's §Ports →
 * `AnalyticsQuery` requires: DuckDB's iceberg extension is documented as
 * *preview*, so its attach syntax may move, and when it does the edit lands
 * here rather than across the dashboard.
 *
 * **Credentials are injected, never resolved by DuckDB.** The adapter takes a
 * `CredentialProvider` - core's own chain, the one `deploy` already signs with
 * (`packages/core/src/aws/credentials.ts:19`) - resolves it, and names the
 * secret it builds in the `ATTACH`. DuckDB therefore has exactly one credential
 * source and no reason to consult its own; a session that works for `deploy`
 * works for the dashboard, which is the spec's §Analytics dashboard →
 * Credentials decision.
 *
 * **The credential values are bound, not spelled.** `CREATE SECRET` accepts
 * `$name` placeholders (verified against DuckDB 1.5.5, 2026-08-30), so the
 * statement this module builds is a constant and the access key, secret and
 * session token travel as bind values. That is not a style preference: DuckDB's
 * parser echoes the offending line back in a syntax error (`LINE 1: ...`), so a
 * credential spliced into the statement text could reach an error message, a
 * log, or a thrown stack. Bound, it cannot. {@link redactorFor} is the second
 * half of the same property, covering a message DuckDB builds for itself.
 *
 * **No vendor error object escapes.** Every DuckDB call runs inside
 * {@link step}, and what leaves this module is always a plain repo `Error`
 * naming the query, the attach target and the step that failed. Unlike
 * `createNodeFileSystem`'s `contextualise`
 * (`packages/core/src/adapters/node-fs.ts:13`) nothing is attached as `cause`:
 * a `cause` keeps the vendor error reachable, and `err.cause.message` is
 * exactly the string the redaction above exists to control. The vendor's own
 * words are preserved - redacted - inside this module's message instead.
 *
 * **The relation is bound here because only here is there a context to bind it
 * from.** `queries.ts` reads one fixed relation, {@link PAGE_VIEWS_RELATION},
 * because SQL binds values and not identifiers and that module exists to make
 * splicing impossible. This adapter holds the plugin context, so it takes
 * `resolveAnalyticsConfig(ctx)` - never a caller-supplied bucket name, so
 * task 44's `ENV_DERIVED` seal is honoured and staging cannot resolve to
 * production's Iceberg table - and rewrites that one name into the configured
 * `<catalog>.<namespace>.<table>` triple before every statement runs.
 */

import { type DuckDBValue, DuckDBInstance } from '@duckdb/node-api';
import type { AwsCredentials, CredentialProvider, PluginContext } from 'blogwright-core';

import {
  type AnalyticsConfig,
  resolveAnalyticsConfig,
  type ResolvedAnalyticsConfig,
} from '../config.js';
import type { AnalyticsQuery, QueryRow } from '../ports.js';
import {
  PAGE_VIEWS_RELATION,
  type PreparedQuery,
  prepareQuery,
  type QueryName,
  type QueryParams,
} from '../queries.js';

/**
 * The DuckDB surface this adapter uses, narrowed to the two operations it
 * needs. Declared here rather than in `ports.ts` because it is not a domain
 * port - no domain module may name it - but the seam a test substitutes at to
 * observe the statements this adapter issues without an AWS account.
 */
export interface DuckDbConnection {
  /** Run one statement, binding `$name` placeholders from `bindings`. */
  run(sql: string, bindings: DuckDbBindings): Promise<readonly QueryRow[]>;
  /** Release the connection. Called when a session's setup failed. */
  close(): void;
}

/** How a {@link DuckDbConnection} is obtained. Defaults to {@link connectDuckDb}. */
export type DuckDbConnect = () => Promise<DuckDbConnection>;

/**
 * Values bound to a statement's placeholders - the shape `prepareQuery`
 * already produces, derived from it rather than restated so the two cannot
 * drift.
 */
type DuckDbBindings = PreparedQuery['bindings'];

/**
 * The slice of a plugin context this adapter reads. `env`, `config` and
 * `pluginConfig` are what `resolveAnalyticsConfig` needs; `accountId` and
 * `config.region` are what the table bucket's ARN needs. Taken as a `Pick` of
 * core's own `PluginContext` rather than a restatement, so the four members
 * cannot drift from the SPI and a plugin command passes `ctx` straight
 * through.
 */
export type DuckDbQueryContext = Pick<
  PluginContext<AnalyticsConfig>,
  'env' | 'config' | 'pluginConfig' | 'accountId'
>;

/** What {@link createDuckDbAnalyticsQuery} is built from. */
export interface DuckDbAnalyticsQueryOptions {
  /**
   * The plugin context. The adapter resolves the analytics config from it
   * itself: `tableBucket` is sealed under task 44's `ENV_DERIVED` symbol and
   * `resolveAnalyticsConfig` is the only way to it, so no caller can hand this
   * adapter a bucket name that dropped the environment.
   */
  readonly ctx: DuckDbQueryContext;
  /**
   * Credentials for the catalog, resolved through core's provider chain
   * (`createCredentialProvider`). A test passes `staticCredentials`.
   */
  readonly credentials: CredentialProvider;
  /**
   * How a DuckDB connection is obtained. Defaults to {@link connectDuckDb};
   * a test substitutes a recording connection here.
   */
  readonly connect?: DuckDbConnect | undefined;
}

/**
 * The name the attached catalog takes inside a DuckDB session. A module
 * constant and not derived from configuration: it is private to one
 * connection, so nothing is gained by letting an operator name it, and a
 * fixed name keeps one more configured string out of the statement text.
 */
const CATALOG_ALIAS = 'analytics';

/**
 * The name of the secret the credentials land in. The `ATTACH` names it
 * explicitly rather than letting DuckDB pick a secret by scope, which is what
 * makes "the adapter never lets DuckDB resolve its own chain" a property of
 * the statement rather than of the ambient secret table.
 */
const SECRET_NAME = 'blogwright_analytics';

/**
 * The extensions the S3 Tables attach needs: `iceberg` for the catalog itself,
 * `httpfs` for the `s3` secret type and the object reads behind it. Loaded
 * explicitly rather than left to DuckDB's autoloading, so a machine that
 * cannot reach the extension repository fails at a named setup step instead of
 * midway through a query.
 */
const REQUIRED_EXTENSIONS = ['httpfs', 'iceberg'] as const;

/**
 * {@link PAGE_VIEWS_RELATION} wherever a statement names it as a whole word.
 * The word boundaries matter: `daily_page_views` must not match, and a bound
 * relation contains the literal `page_views` inside its own quotes, which a
 * replacement callback (rather than a replacement string) leaves alone.
 */
const PAGE_VIEWS_RELATION_PATTERN = new RegExp(String.raw`\b${PAGE_VIEWS_RELATION}\b`, 'g');

/** What replaces a credential value in a message that came back carrying one. */
const REDACTED = '<redacted>';

/**
 * A failed DuckDB step, carrying the words that follow "failed while" in the
 * message a caller sees. Module-private and always caught by
 * {@link createDuckDbAnalyticsQuery}'s `run`, so it is a way of passing the
 * step description outwards, never a type any caller can observe.
 */
class DuckDbStepFailure extends Error {}

/** What an error says for itself, whether or not it is an `Error`. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Quote an identifier for the statement text. `validateAnalyticsConfig` already
 * holds `namespace` and `table` to `^[a-z0-9_]+$`, so there is no quote
 * character to escape and this adds no second validation of a rule config owns.
 * What it does add is reserved words: `web` and `page_views` need no quoting,
 * but `order` and `table` match that same pattern and an operator may configure
 * either.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

/**
 * Quote a value as a SQL string literal, doubling every `'` so the literal
 * cannot be closed from inside it.
 *
 * This is deliberately not conditional on the value having been validated.
 * `ATTACH` takes its target as a literal and DuckDB accepts no placeholder
 * there, so this is the one place in this module where a configured value is
 * spelled into statement text rather than bound - and `runAndReadAll` executes
 * *every* statement in the string it is handed, after `CREATE SECRET` has
 * already put the operator's real AWS credentials into the session. A single
 * unescaped quote in the attach target is therefore arbitrary SQL execution
 * under those credentials, with `httpfs` loaded.
 *
 * Of the ARN's three components `tableBucket` is held to `^[0-9a-z-]{3,63}$`
 * and `accountId` comes from STS, but `config.region` is checked only for
 * truthiness (`packages/core/src/config.ts`), so today a region *is* a way in.
 * That gap is being closed upstream; this escape stays regardless. The
 * adapter must not be one upstream change - a relaxed rule, a new field
 * spliced into the ARN, a caller that assembles a context by hand - away from
 * executing arbitrary SQL. The escape is local to the quote it protects and
 * holds whatever validation elsewhere does or does not do.
 */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The configured `<catalog>.<namespace>.<table>` triple every statement reads,
 * inside the attached catalog. This is the binding task 45 delegated here.
 */
export function pageViewsRelation(config: ResolvedAnalyticsConfig): string {
  return [CATALOG_ALIAS, config.namespace, config.table].map(quoteIdentifier).join('.');
}

/**
 * The statement a prepared query actually runs as: its definition's SQL with
 * the fixed relation name rewritten to `relation`. Raises when a definition
 * names no relation at all, because a statement that reads nothing would
 * otherwise return an empty result that looks like "no traffic that week".
 */
export function bindPageViewsRelation(prepared: PreparedQuery, relation: string): string {
  let bindings = 0;
  const sql = prepared.sql.replaceAll(PAGE_VIEWS_RELATION_PATTERN, () => {
    bindings += 1;
    return relation;
  });
  if (bindings === 0) {
    throw new Error(
      `analytics query "${prepared.name}" names no ${PAGE_VIEWS_RELATION} relation to bind, so it would read nothing`,
    );
  }
  return sql;
}

/**
 * The S3 Tables bucket's ARN - the attach target, and the string every error
 * this module raises names, because it is what an operator checks permissions
 * and region against. The `s3tables` ARN form is the one
 * `S3TablesClient.createTableBucket` documents
 * (`packages/analytics/src/aws/s3tables.ts:245`).
 */
function tableBucketArn(ctx: DuckDbQueryContext, config: ResolvedAnalyticsConfig): string {
  return `arn:aws:s3tables:${ctx.config.region}:${ctx.accountId}:bucket/${config.tableBucket}`;
}

/**
 * The `CREATE SECRET` statement and the values it binds. The statement is a
 * constant apart from whether the credentials carry a session token: an absent
 * token drops the clause rather than binding a null, so DuckDB is never handed
 * an empty `x-amz-security-token` to sign with.
 */
function secretStatement(
  credentials: AwsCredentials,
  region: string,
): { sql: string; bindings: DuckDbBindings } {
  const clauses = [
    'TYPE s3',
    'PROVIDER config',
    'KEY_ID $access_key_id',
    'SECRET $secret_access_key',
    'REGION $region',
  ];
  const bindings: Record<string, string> = {
    access_key_id: credentials.accessKeyId,
    secret_access_key: credentials.secretAccessKey,
    region,
  };
  if (credentials.sessionToken !== undefined) {
    clauses.push('SESSION_TOKEN $session_token');
    bindings.session_token = credentials.sessionToken;
  }
  return {
    sql: `CREATE OR REPLACE SECRET ${SECRET_NAME} (${clauses.join(', ')})`,
    bindings,
  };
}

/**
 * The `ATTACH` statement, read-only. `READ_ONLY` is an option the iceberg
 * catalog accepts rather than one it ignores - DuckDB rejects an unrecognised
 * attach option outright ("Unhandled options found"), so an attach that parses
 * is an attach whose mode was understood - and it is the spec's "The
 * dashboard's own attach stays read-only" as a property of the connection, not
 * merely of the port's shape.
 */
function attachStatement(target: string): string {
  return `ATTACH ${quoteLiteral(target)} AS ${quoteIdentifier(CATALOG_ALIAS)} (TYPE iceberg, ENDPOINT_TYPE s3_tables, SECRET ${SECRET_NAME}, READ_ONLY)`;
}

/**
 * Replace every credential value in `text`. DuckDB builds some of its own
 * messages out of the values it was handed, so a bound credential can still
 * reach a message this module is about to raise; this is what keeps it from
 * leaving. Empty values are skipped - replacing the empty string matches
 * everywhere.
 */
function redactorFor(credentials: AwsCredentials): (text: string) => string {
  const secrets = [
    credentials.accessKeyId,
    credentials.secretAccessKey,
    credentials.sessionToken ?? '',
  ].filter((secret) => secret.length > 0);
  return (text) =>
    secrets.reduce((redacted, secret) => redacted.replaceAll(secret, REDACTED), text);
}

/**
 * One `page_views` result cell, in this package's own vocabulary. A SQL NULL
 * becomes `undefined` so the caller sees an absent key, which is `QueryRow`'s
 * rule. Counts arrive as `BIGINT`, and a range total as `HUGEINT`, so both
 * arrive as `bigint`; anything past `Number.MAX_SAFE_INTEGER` raises rather
 * than rounding, because a silently rounded view count is worse than no chart.
 * DATE and the other typed columns come back as DuckDB value objects whose
 * `toString` is the SQL rendering - a `day` reads back as `2026-08-01`, with
 * no `Date` and so no time zone anywhere near it.
 */
function toQueryValue(column: string, value: DuckDBValue): string | number | boolean | undefined {
  if (value === null) return undefined;
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw new Error(
        `analytics result column "${column}" is ${value}, past the largest integer JavaScript counts exactly`,
      );
    }
    return asNumber;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

/** One result row, with every SQL NULL dropped rather than carried as a null. */
function toQueryRow(row: Record<string, DuckDBValue>): QueryRow {
  const converted: Record<string, string | number | boolean> = {};
  for (const [column, value] of Object.entries(row)) {
    const cell = toQueryValue(column, value);
    if (cell !== undefined) converted[column] = cell;
  }
  return converted;
}

/**
 * Open a real DuckDB connection - the default {@link DuckDbConnect}, and the
 * one place `@duckdb/node-api` is called. Exported so the test suite can run
 * the named query set against a real local table without naming the vendor
 * package itself, which is what keeps DuckDB confined to this file.
 */
export const connectDuckDb: DuckDbConnect = async () => {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  return {
    async run(sql: string, bindings: DuckDbBindings): Promise<readonly QueryRow[]> {
      const reader = await connection.runAndReadAll(sql, { ...bindings });
      return reader.getRowObjects().map(toQueryRow);
    },
    close(): void {
      connection.closeSync();
      instance.closeSync();
    },
  };
};

/**
 * Build the DuckDB-backed {@link AnalyticsQuery}. Returns the port and nothing
 * wider: `run(name, params)` is the whole surface, so there is no statement to
 * supply and no write path to reach. Construct it at the plugin's composition
 * root - the dashboard command - and hand every domain module the port.
 *
 * The connection is opened lazily on the first query and then reused, so
 * building the adapter touches neither the network nor the native library, and
 * the dashboard binds its port before AWS is ever consulted. A session whose
 * setup failed is closed and forgotten rather than cached, so a dashboard left
 * open across an expired SSO session recovers on the next request instead of
 * repeating the first failure forever.
 */
export function createDuckDbAnalyticsQuery(opts: DuckDbAnalyticsQueryOptions): AnalyticsQuery {
  const config = resolveAnalyticsConfig(opts.ctx);
  const attachTarget = tableBucketArn(opts.ctx, config);
  const relation = pageViewsRelation(config);
  const connect = opts.connect ?? connectDuckDb;

  /**
   * Redaction needs the resolved credentials, and they are resolved inside the
   * session; this holds the redactor the current session installed so a failure
   * raised while executing a statement is scrubbed by the same rule a failure
   * raised while creating the secret is.
   */
  let redact: (text: string) => string = (text) => text;

  let session: Promise<DuckDbConnection> | undefined;

  async function step<T>(description: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw new DuckDbStepFailure(`${description}: ${redact(describeError(err))}`);
    }
  }

  async function openSession(): Promise<DuckDbConnection> {
    const credentials = await step('resolving AWS credentials', () => opts.credentials());
    redact = redactorFor(credentials);
    const connection = await step('opening a DuckDB connection', connect);
    try {
      for (const extension of REQUIRED_EXTENSIONS) {
        await step(`installing the ${extension} extension`, () =>
          connection.run(`INSTALL ${extension}`, {}),
        );
        await step(`loading the ${extension} extension`, () =>
          connection.run(`LOAD ${extension}`, {}),
        );
      }
      const secret = secretStatement(credentials, opts.ctx.config.region);
      await step('creating the credentials secret', () =>
        connection.run(secret.sql, secret.bindings),
      );
      await step('attaching the catalog read-only', () =>
        connection.run(attachStatement(attachTarget), {}),
      );
    } catch (err) {
      connection.close();
      throw err;
    }
    return connection;
  }

  function currentSession(): Promise<DuckDbConnection> {
    const pending = (session ??= openSession());
    return pending.catch((err: unknown) => {
      if (session === pending) session = undefined;
      throw err;
    });
  }

  function contextualise(name: QueryName, err: unknown): Error {
    const detail =
      err instanceof DuckDbStepFailure
        ? err.message
        : `running the query: ${redact(describeError(err))}`;
    return new Error(`analytics query "${name}" against ${attachTarget} failed while ${detail}`);
  }

  return {
    async run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]> {
      const prepared = prepareQuery(name, params, config);
      const sql = bindPageViewsRelation(prepared, relation);
      let connection: DuckDbConnection;
      try {
        connection = await currentSession();
      } catch (err) {
        throw contextualise(prepared.name, err);
      }
      try {
        return await step('executing the statement', () => connection.run(sql, prepared.bindings));
      } catch (err) {
        throw contextualise(prepared.name, err);
      }
    },
  };
}
