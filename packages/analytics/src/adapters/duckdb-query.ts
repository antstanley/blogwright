/**
 * The real {@link AnalyticsQuery}: DuckDB with the S3 Tables catalog attached
 * read-only. Everything about the session - the credential secret, the attach,
 * the quoting and the translation of vendor errors - belongs to
 * `duckdb-session.ts`, which the write adapter beside this one shares; what
 * lives here is only what reading a named query adds to it.
 *
 * **Read-only is a property of the connection, not of this module's shape.**
 * The session is built with `readOnly: true`, so the `ATTACH` carries
 * `READ_ONLY` and DuckDB itself refuses a write on it. `AnalyticsQuery.run` is
 * the whole surface this adapter returns, so there is no statement to supply
 * and no write path to reach even before that.
 */

import type { CredentialProvider } from 'blogwright-core';

import type { AnalyticsQuery, QueryRow } from '../ports.js';
import {
  PAGE_VIEWS_RELATION,
  type PreparedQuery,
  prepareQuery,
  type QueryName,
  type QueryParams,
} from '../queries.js';
import {
  createDuckDbSession,
  type DuckDbConnect,
  type DuckDbConnection,
  type DuckDbSessionContext,
} from './duckdb-session.js';

/** What {@link createDuckDbAnalyticsQuery} is built from. */
export interface DuckDbAnalyticsQueryOptions {
  /**
   * The plugin context. The session resolves the analytics config from it
   * itself: `tableBucket` is sealed under task 44's `ENV_DERIVED` symbol and
   * `resolveAnalyticsConfig` is the only way to it, so no caller can hand this
   * adapter a bucket name that dropped the environment.
   */
  readonly ctx: DuckDbSessionContext;
  /**
   * Credentials for the catalog, resolved through core's provider chain
   * (`createCredentialProvider`). A test passes `staticCredentials`.
   */
  readonly credentials: CredentialProvider;
  /**
   * How a DuckDB connection is obtained. Defaults to the session's own
   * `connectDuckDb`; a test substitutes a recording connection here.
   */
  readonly connect?: DuckDbConnect | undefined;
}

/**
 * {@link PAGE_VIEWS_RELATION} wherever a statement names it as a whole word.
 * The word boundaries matter: `daily_page_views` must not match, and a bound
 * relation contains the literal `page_views` inside its own quotes, which a
 * replacement callback (rather than a replacement string) leaves alone.
 */
const PAGE_VIEWS_RELATION_PATTERN = new RegExp(String.raw`\b${PAGE_VIEWS_RELATION}\b`, 'g');

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
 * Build the DuckDB-backed {@link AnalyticsQuery}. Returns the port and nothing
 * wider: `run(name, params)` is the whole surface, so there is no statement to
 * supply and no write path to reach. Construct it at the plugin's composition
 * root - the dashboard, status and backfill commands - and hand every domain
 * module the port.
 *
 * The connection is opened lazily on the first query and then reused, so
 * building the adapter touches neither the network nor the native library, and
 * the dashboard binds its port before AWS is ever consulted.
 */
export function createDuckDbAnalyticsQuery(opts: DuckDbAnalyticsQueryOptions): AnalyticsQuery {
  const session = createDuckDbSession({
    ctx: opts.ctx,
    credentials: opts.credentials,
    readOnly: true,
    connect: opts.connect,
  });

  function contextualise(name: QueryName, err: unknown): Error {
    return new Error(
      `analytics query "${name}" against ${session.attachTarget} failed while ${session.detail(err, 'running the query')}`,
    );
  }

  return {
    async run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]> {
      const prepared = prepareQuery(name, params, session.config);
      const sql = bindPageViewsRelation(prepared, session.relation);
      let connection: DuckDbConnection;
      try {
        connection = await session.open();
      } catch (err) {
        throw contextualise(prepared.name, err);
      }
      try {
        return await session.step('executing the statement', () =>
          connection.run(sql, prepared.bindings),
        );
      } catch (err) {
        throw contextualise(prepared.name, err);
      }
    },
  };
}
