/**
 * The fixed set of named, parameterised queries this package answers from -
 * never SQL supplied by a client. Seven of them are the dashboard's panels;
 * see [the change spec's §Analytics dashboard → Local
 * server](../../../.specs/changes/merged/2026-07-26-analytics_plugin.md). The eighth,
 * {@link ROW_COUNT_QUERY}, serves `analytics status`, and is here for the same
 * reason the other seven are: a command reaches the table through the
 * `AnalyticsQuery` port, and the port takes a name from this set, never a
 * statement.
 *
 * **Parameterised is a shape here, not a convention.** A definition's SQL is
 * built by the {@link sql} tag, whose only substitution slot accepts
 * {@link SqlRelation} - a branded type whose single inhabitant is
 * {@link PAGE_VIEWS}, declared in this module. Interpolating anything else is
 * a compile error (`TS2345: Argument of type 'string' is not assignable to
 * parameter of type 'SqlRelation'`), and a plain string cannot be assigned to
 * {@link SqlText} either (`TS2322`), so a definition has nowhere to put a
 * caller's value: caller values reach the statement only as `$name`
 * placeholders, bound by {@link prepareQuery}. The tag is module-private, so
 * no other module can mint SQL for this port at all.
 *
 * **The type-level block is the one holding the property; the runtime tests
 * are a partial net under it, not a second copy of it.** `tsc` rejects *every*
 * splice of a caller value that is not deliberately cast, and `pnpm typecheck`
 * runs it in CI (`.github/workflows/ci.yml:22`). The tests in
 * `queries.test.ts` catch only what a splice leaves visible in the finished
 * string - a quoted literal the definition did not declare, or anything
 * day-shaped. They do not catch the rest: splicing `'0 OR 1=1'` into
 * `status-codes` as `` AND status >= ${'0 OR 1=1'} `` leaves the whole suite
 * green while `tsc` reports `TS2345` (observed, 2026-08-30). What the net does
 * still add is independence over the forms it does cover: vitest transpiles
 * without typechecking, so `` AND day >= '${'2026-08-01' as SqlRelation}' ``
 * passes `tsc` and reddens the parameterisation test anyway. Read the two as a
 * check total up to a deliberate cast and a partial backstop under it, not as
 * equals - weakening or dropping the branded types because "the tests cover
 * it" would leave only the partial net.
 *
 * **Why the relation is a fixed name rather than the configured triple.** SQL
 * binds *values*, not identifiers: a configured `<tableBucket>/<namespace>/
 * <table>` spliced into the statement would be exactly the interpolation this
 * module exists to make impossible. So every definition reads one relation,
 * {@link PAGE_VIEWS_RELATION}, and binding that name to the configured triple
 * is the adapter's job - it holds the plugin context, so it takes
 * `resolveAnalyticsConfig(ctx)` and attaches or aliases accordingly. The
 * configurability task 44 declares is therefore preserved, in the one place
 * that has the environment to resolve it.
 *
 * Pure data and pure functions only: no `node:` builtin, no vendor SDK, no
 * `fetch`. Nothing here runs a statement - that is `AnalyticsQuery`'s adapter.
 */

import { normalizePathFilter } from './path-filter.js';
import { withTrafficBreakdown } from './traffic-breakdown.js';
import {
  parseViewGranularity,
  VIEW_GRANULARITIES,
  type ViewGranularity,
} from './view-granularity.js';
import type { AnalyticsConfig } from './config.js';
import type { PageViewColumnName } from './schema.js';

/**
 * A statement one of the named definitions carries. Branded, and the brand's
 * symbol is not exported, so the only way to a value of this type is the
 * {@link sql} tag below - and the tag is module-private too. A `string` is not
 * assignable to it.
 */
declare const SQL_TEXT: unique symbol;
type SqlText = string & { readonly [SQL_TEXT]: true };

/**
 * A relation name a statement may name. Branded the same way, with
 * {@link PAGE_VIEWS} as its only inhabitant, so the tag's substitution slot
 * can carry the table and nothing else.
 */
declare const SQL_RELATION: unique symbol;
type SqlRelation = string & { readonly [SQL_RELATION]: true };

/**
 * The relation every named query reads. Not "the configured table name" - the
 * adapter binds this name to the configured `<namespace>.<table>` inside the
 * attached catalog before it runs anything, and this module never sees the
 * configuration. See the module doc comment for why an identifier cannot be a
 * bind parameter.
 */
export const PAGE_VIEWS_RELATION = 'page_views';

/** {@link PAGE_VIEWS_RELATION} as the one value the {@link sql} tag will splice. */
const PAGE_VIEWS = PAGE_VIEWS_RELATION as SqlRelation;

/**
 * Build a definition's statement. The rest parameter is typed
 * {@link SqlRelation}, so `` sql`... WHERE day > ${params.range.from}` `` does
 * not compile; a caller's value has to go through a `$name` placeholder.
 */
function sql(fragments: TemplateStringsArray, ...relations: SqlRelation[]): SqlText {
  return fragments
    .reduce((text, fragment, index) => text + (relations[index - 1] ?? '') + fragment)
    .trim() as SqlText;
}

/**
 * The parameters a definition binds, as `$name` placeholders in its SQL. Every
 * query takes the date range and the bot-inclusion flag the spec requires of
 * all of them; the list is per-definition so a statement that forgot one is a
 * test failure naming that query rather than a filter that quietly never ran.
 */
const QUERY_PARAM_NAMES = [
  'from',
  'to',
  'include_bots',
  'bucket_minutes',
  'from_time',
  'to_time',
] as const;

/** One of {@link QUERY_PARAM_NAMES}. */
type QueryParamName = (typeof QUERY_PARAM_NAMES)[number];

/** A value bound to a placeholder. Days are bound as text and cast in the SQL. */
type BindValue = string | boolean;

/** UTC calendar days (inclusive) or minute timestamps (start inclusive, end exclusive). */
interface DateRange {
  /** Inclusive start day or UTC minute. */
  readonly from: string;
  /** Inclusive end day, or exclusive end UTC minute. */
  readonly to: string;
}

/**
 * What a caller hands {@link AnalyticsQuery.run}. `includeBots` is optional
 * because its default is not this module's to state: it comes from
 * `config.analytics.bots` (task 44) through {@link BOTS_INCLUDED_BY_DEFAULT}.
 */
export interface QueryParams {
  /** Exact path and descendants at a slash boundary; blank means every path. */
  readonly path?: string | undefined;
  /** Include disjoint bot/non-bot contributions; requires bots to be included. */
  readonly splitBots?: boolean | undefined;
  /** The UTC reporting window. */
  readonly range: DateRange;
  /**
   * Whether bot-flagged rows are counted. Absent means "whatever
   * `config.analytics.bots` says": `flag` keeps them, `filter` excludes them.
   * Records are stored either way - filtering is a query concern, per the
   * spec's Decision *Flag bots, do not drop them*.
   */
  readonly includeBots?: boolean | undefined;
  /** UTC bucket width; accepted only by views-over-time. */
  readonly granularity?: ViewGranularity | undefined;
}

/** One named query: its statement, what it reads, what it binds, what it returns. */
interface QueryDefinition {
  /**
   * What one result row means, in one line. The dashboard renders it beside
   * the chart, which is why `unique-visitors` says "summed daily uniques"
   * here as well as in its column names - see {@link ANALYTICS_QUERIES}.
   */
  readonly rowMeaning: string;
  /** The `page_views` columns the statement reads, typed against `schema.ts`. */
  readonly columns: readonly PageViewColumnName[];
  /** The placeholders the statement carries, one bound value each. */
  readonly binds: readonly QueryParamName[];
  /** The columns a result row carries, in the order the statement selects them. */
  readonly resultColumns: readonly string[];
  /**
   * Constants the statement spells for itself, quoted inside the SQL. Declared
   * so the parameterisation test can tell a domain constant from an
   * interpolated caller value: any literal in the SQL that is not on this list
   * fails, naming the query.
   */
  readonly literals: readonly string[];
  /** The statement. Only {@link sql} can produce one. */
  readonly sql: SqlText;
}

/**
 * The `x-edge-result-type` values CloudFront reports for a cache hit. AWS
 * documents that field's values as `Hit`, `RefreshHit`, `Miss`,
 * `LimitExceeded`, `CapacityExceeded`, `Error` and `Redirect`; the first two
 * are the hits. `OriginShieldHit` is deliberately absent - it is an
 * `x-edge-detailed-result-type` value, and `schema.ts` selects
 * `x-edge-result-type` rather than the detailed field, so it can never appear
 * in `result_type`.
 */
const CACHE_HIT_RESULT_TYPES = ['Hit', 'RefreshHit'] as const;

/**
 * The name of the row-count query. Not one of the seven the spec's §Local
 * server lists - those answer the dashboard's panels; this one answers
 * `analytics status`, which reports the table's current row count beside the
 * plugin's fourteen nodes. It lives in this set rather than in the command
 * because the command may not write SQL: every statement this package runs is
 * one of these definitions, reached through the `AnalyticsQuery` port.
 */
export const ROW_COUNT_QUERY = 'row-count';

/** The one column {@link ROW_COUNT_QUERY} selects. Named so no caller spells it twice. */
export const ROW_COUNT_COLUMN = 'row_count';

/**
 * The range {@link ROW_COUNT_QUERY} is asked over when the caller wants the
 * whole table, as `analytics status` does.
 *
 * Every definition in this set is bounded on the `day` partition - the spec
 * requires the range and the bot flag of all of them - so "the whole table" is
 * expressed as the widest range the column can hold rather than as an
 * unbounded statement. Both ends are calendar days {@link isCalendarDay}
 * accepts, so this constant goes through exactly the validation a caller's
 * range does. `from` is the Unix epoch, which no `day` can precede: the column
 * is derived from the request's own timestamp. `to` is the last day of the
 * four-digit years, which is the largest day this module's `YYYY-MM-DD` shape
 * can express at all.
 */
export const WHOLE_TABLE_RANGE = { from: '1970-01-01', to: '9999-12-31' } as const;

/**
 * Every named query, keyed by the name a caller asks for: the seven the spec's
 * §Local server lists, in its order, and then {@link ROW_COUNT_QUERY}, which
 * no panel draws and `analytics status` reports.
 *
 * Every statement reads {@link PAGE_VIEWS}, bounds itself on the `day`
 * partition with `$from`/`$to`, and honours `$include_bots` - a row whose
 * `is_bot` is null counts as not-a-bot, since the transform leaves the column
 * absent when it has nothing to say.
 *
 * **`unique-visitors` is the one whose semantic cannot be read off its name.**
 * `visitor_key` is a daily-salted digest and the salt turns over at every UTC
 * day boundary (the spec's Decision *Daily salt rotation stands*, settled
 * 2026-07-27), so the same person is a different `visitor_key` tomorrow.
 * A `count(DISTINCT visitor_key)` spanning a range therefore does not error -
 * it returns a plausible number that means nothing. The definition counts
 * distinct keys *within* a day and reports the range total as the sum of those
 * daily counts, and says so in its column names (`daily_unique_visitors`,
 * `summed_daily_unique_visitors`) and its `rowMeaning`, so a dashboard cannot
 * relabel the total "unique visitors" without deleting the words that say
 * otherwise. The sum over-counts a visitor who returns on another day; that is
 * the accepted cost of bounding what one day of brute-forced salt could ever
 * correlate.
 */
export const ANALYTICS_QUERIES = {
  'views-over-time': {
    rowMeaning: 'one UTC day and the number of requests served that day',
    columns: ['day', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['day', 'views'],
    literals: [],
    sql: sql`
SELECT day, count(*) AS views
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
GROUP BY day
ORDER BY day
`,
  },

  'top-paths': {
    rowMeaning: 'one request path and the number of requests for it over the range',
    columns: ['day', 'uri', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['uri', 'views'],
    literals: [],
    sql: sql`
SELECT uri, count(*) AS views
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
GROUP BY uri
ORDER BY views DESC, uri
`,
  },

  referrers: {
    rowMeaning: 'one referring URL and the number of requests it sent over the range',
    columns: ['day', 'referrer', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['referrer', 'views'],
    literals: [],
    sql: sql`
SELECT referrer, count(*) AS views
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
  AND referrer IS NOT NULL
GROUP BY referrer
ORDER BY views DESC, referrer
`,
  },

  countries: {
    rowMeaning: 'one viewer country and the number of requests from it over the range',
    columns: ['day', 'country', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['country', 'views'],
    literals: [],
    sql: sql`
SELECT country, count(*) AS views
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
  AND country IS NOT NULL
GROUP BY country
ORDER BY views DESC, country
`,
  },

  'status-codes': {
    rowMeaning: 'one HTTP status code and the number of responses carrying it over the range',
    columns: ['day', 'status', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['status', 'views'],
    literals: [],
    sql: sql`
SELECT status, count(*) AS views
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
GROUP BY status
ORDER BY status
`,
  },

  'cache-hit-ratio': {
    rowMeaning:
      'one UTC day, its requests, the edge cache hits among them, and hits divided by requests',
    columns: ['day', 'result_type', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['day', 'requests', 'cache_hits', 'cache_hit_ratio'],
    literals: CACHE_HIT_RESULT_TYPES,
    sql: sql`
WITH daily AS (
  SELECT day,
         count(*) AS requests,
         count(*) FILTER (WHERE result_type IN ('Hit', 'RefreshHit')) AS cache_hits
  FROM ${PAGE_VIEWS}
  WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
    AND ($include_bots OR NOT coalesce(is_bot, false))
  GROUP BY day
)
SELECT day, requests, cache_hits, CAST(cache_hits AS DOUBLE) / requests AS cache_hit_ratio
FROM daily
ORDER BY day
`,
  },

  'unique-visitors': {
    rowMeaning:
      'one UTC day and its distinct visitor_key count, beside the range total - the sum of those daily counts, not a distinct count across days, because the salt rotates daily',
    columns: ['day', 'visitor_key', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: ['day', 'daily_unique_visitors', 'summed_daily_unique_visitors'],
    literals: [],
    sql: sql`
WITH daily AS (
  SELECT day, count(DISTINCT visitor_key) AS daily_unique_visitors
  FROM ${PAGE_VIEWS}
  WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
    AND ($include_bots OR NOT coalesce(is_bot, false))
    AND visitor_key IS NOT NULL
  GROUP BY day
)
SELECT day,
       daily_unique_visitors,
       sum(daily_unique_visitors) OVER () AS summed_daily_unique_visitors
FROM daily
ORDER BY day
`,
  },

  /**
   * Not a dashboard panel: the figure `analytics status` reports beside the
   * node listing, so an operator can tell "the pipeline is provisioned" from
   * "the pipeline has delivered something". Bots are counted when the caller
   * asks for them - a row is a row - which is why the status command binds
   * `include_bots` explicitly rather than leaving it to `config.analytics.bots`.
   */
  [ROW_COUNT_QUERY]: {
    rowMeaning: 'the number of rows the table holds over the range, one row carrying the count',
    columns: ['day', 'is_bot'],
    binds: ['from', 'to', 'include_bots'],
    resultColumns: [ROW_COUNT_COLUMN],
    literals: [],
    sql: sql`
SELECT count(*) AS row_count
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
`,
  },
} as const satisfies Record<string, QueryDefinition>;

/** The name of one of the {@link ANALYTICS_QUERIES}. */
export type QueryName = keyof typeof ANALYTICS_QUERIES;

/**
 * Every query name, in declaration order - what the unknown-name error lists
 * and what the test suite iterates. Derived from the table rather than
 * restated beside it, so the two cannot drift; the cast is `Object.keys`'
 * `string[]` narrowed back to the keys it just enumerated.
 */
export const ANALYTICS_QUERY_NAMES = Object.keys(ANALYTICS_QUERIES) as readonly QueryName[];

/**
 * Whether bot-flagged rows are counted when a caller states no preference, per
 * `bots` mode. Exhaustive over the union rather than a comparison against one
 * spelling, so adding a third mode to task 44's config is a compile error here
 * instead of a silent `false`. The *default value* is not restated: it is
 * whatever `validateAnalyticsConfig` put on `config.bots`.
 */
const BOTS_INCLUDED_BY_DEFAULT = {
  flag: true,
  filter: false,
} as const satisfies Record<AnalyticsConfig['bots'], boolean>;

/**
 * A `YYYY-MM-DD` day, the form the `day` partition column takes. Four digits,
 * so the extended-year forms `Date` also understands are not days here - see
 * {@link isCalendarDay} for which of the two checks catches what.
 */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Characters in a `YYYY-MM-DD` day - how much of an ISO timestamp is the day. */
const DAY_LENGTH = 10;

/** Render a rejected value for a message: strings quoted, as core's config messages quote them. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/**
 * Whether `day` names a day that exists. Neither half is redundant, and they
 * catch different things:
 *
 * - The round-trip is what rejects a *malformed or impossible* day, and it
 *   does most of the work. `Date.parse('2026-02-30T00:00:00Z')` does not fail,
 *   it rolls over to 2 March, so a mistyped range end would silently report a
 *   different month; comparing the parsed date's own ISO form back against the
 *   input catches that, and also catches `2026-8-1`, `20260801` and a day with
 *   a time already on it, which all parse to `NaN` here.
 * - {@link DAY_PATTERN} is what rejects the *extended-year* forms `Date` also
 *   accepts. `'+271821-04'` is ten characters long and round-trips exactly -
 *   `new Date(Date.parse('+271821-04T00:00:00Z')).toISOString().slice(0, 10)`
 *   is `'+271821-04'` - so without the pattern it would be bound as a day and
 *   reach `CAST($from AS DATE)`. `'-000001-01'` likewise.
 *
 * `queries.test.ts` pins both: drop either line and a different test reddens.
 */
function isCalendarDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString().slice(0, DAY_LENGTH) === day;
}

/** Minute precision only; explicit UTC prevents host-timezone interpretation. */
function isUtcMinute(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(value)) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 16) + 'Z' === value;
}

/**
 * Resolve a name to its definition, raising with the available names when it
 * is not one of them. Takes a `string` rather than a {@link QueryName} because
 * this is the boundary the local server's HTTP path arrives at, where the
 * compiler's guarantee has already been erased.
 *
 * The lookup is guarded by `Object.hasOwn` and not by a test for `undefined`,
 * for the reason `build.ts`'s `contentType` is: an unguarded index answers
 * every `Object.prototype` key with an inherited function, so
 * `GET /api/queries/constructor` would resolve to a truthy "definition" and
 * fail later as `definition.binds is not iterable` instead of the rejection
 * below. The names in the message are the only ones that resolve.
 */
export function queryDefinition(name: string): QueryDefinition {
  const definition = Object.hasOwn(ANALYTICS_QUERIES, name)
    ? (ANALYTICS_QUERIES as Record<string, QueryDefinition>)[name]
    : undefined;
  if (definition === undefined) {
    throw new Error(
      `unknown analytics query ${describeValue(name)} - available queries are ${ANALYTICS_QUERY_NAMES.join(', ')}`,
    );
  }
  return definition;
}

/**
 * Check the range at the same boundary the name is checked at, naming the
 * offending value. The declared type says `from` and `to` are present strings,
 * and the runtime says otherwise for the same reason `config.ts`'s
 * `unsealEnvDerivedOverrides` does: the one seam that fills these is the
 * dashboard's query string, where every value arrives as `string | undefined`
 * and a narrowing can be forgotten. Defaulting an absent range would be worse
 * than raising - a chart over "some window the server picked" is indexed by
 * nothing the reader chose.
 */
function validateRange(name: string, range: DateRange | undefined): DateRange {
  const from: unknown = range?.from;
  const to: unknown = range?.to;
  if (typeof from !== 'string' || !(isCalendarDay(from) || isUtcMinute(from))) {
    throw new Error(
      `analytics query ${describeValue(name)}: range.from must be a YYYY-MM-DD calendar day or YYYY-MM-DDTHH:mmZ UTC minute, got ${describeValue(from)}`,
    );
  }
  if (typeof to !== 'string' || !(isCalendarDay(to) || isUtcMinute(to))) {
    throw new Error(
      `analytics query ${describeValue(name)}: range.to must be a YYYY-MM-DD calendar day or YYYY-MM-DDTHH:mmZ UTC minute, got ${describeValue(to)}`,
    );
  }
  if (isUtcMinute(from) !== isUtcMinute(to)) {
    throw new Error('range endpoints must both be calendar days or both UTC minute timestamps');
  }
  // Canonical UTC strings sort chronologically.
  if (from > to || (isUtcMinute(from) && from === to)) {
    throw new Error(
      `analytics query ${describeValue(name)}: range is inverted - from ${describeValue(from)} is after to ${describeValue(to)}`,
    );
  }
  return { from, to };
}

/** Intraday alternative keeps the day partition filter for Iceberg pruning. */
const INTRADAY_VIEWS_SQL = sql`
SELECT strftime(time_bucket(CAST($bucket_minutes AS BIGINT) * INTERVAL '1 minute', event_time), '%Y-%m-%dT%H:%M:%SZ') AS day,
       count(*) AS views
FROM ${PAGE_VIEWS}
WHERE day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)
  AND ($include_bots OR NOT coalesce(is_bot, false))
GROUP BY 1
ORDER BY 1
`;

/** A named query resolved against its caller's parameters, ready for an adapter to execute. */
export interface PreparedQuery {
  /** The name that resolved. */
  readonly name: QueryName;
  /** The fixed statement to execute, including an intraday variant when requested. */
  readonly sql: string;
  /** The columns a row of the result carries. */
  readonly resultColumns: readonly string[];
  /** One entry per placeholder the statement carries, keyed by placeholder name. */
  readonly bindings: Readonly<Record<string, BindValue>>;
}

/**
 * Resolve a name and its parameters into the statement and the bindings an
 * adapter runs - the one boundary where an unknown name and a bad range are
 * both rejected, so every implementation of `AnalyticsQuery` (the DuckDB
 * adapter and the fixture-backed fake alike) refuses the same inputs with the
 * same messages.
 *
 * `config` is the validated `analytics` block off `ctx.pluginConfig`, taken for
 * its `bots` mode alone: a resolved config satisfies it too, so a caller passes
 * whichever it is holding.
 */
export function prepareQuery(
  name: string,
  params: QueryParams,
  config: Pick<AnalyticsConfig, 'bots'>,
): PreparedQuery {
  const definition = queryDefinition(name);
  const range = validateRange(name, params.range);
  const path = normalizePathFilter(params.path);
  if (params.granularity !== undefined && name !== 'views-over-time') {
    throw new Error('granularity is only supported by views-over-time');
  }
  const granularity = parseViewGranularity(params.granularity);
  const intraday = name === 'views-over-time' && granularity !== '24h';
  const includeBots = params.includeBots ?? BOTS_INCLUDED_BY_DEFAULT[config.bots];
  if (params.splitBots !== undefined && typeof params.splitBots !== 'boolean') {
    throw new Error('splitBots must be a boolean');
  }
  if (params.splitBots && !includeBots) throw new Error('splitBots requires includeBots=true');
  const available: Record<QueryParamName, BindValue> = {
    from: range.from.slice(0, 10),
    to: range.to.slice(0, 10),
    from_time: range.from,
    to_time: range.to,
    include_bots: includeBots,
    bucket_minutes: String(VIEW_GRANULARITIES[granularity].minutes),
  };
  const bindings: Record<string, BindValue> = {};
  for (const bind of definition.binds) bindings[bind] = available[bind];
  if (intraday) bindings['bucket_minutes'] = available.bucket_minutes;
  let statement: string = intraday ? INTRADAY_VIEWS_SQL : definition.sql;
  if (isUtcMinute(range.from)) {
    bindings['from_time'] = `${range.from.slice(0, 16)}:00Z`;
    bindings['to_time'] = `${range.to.slice(0, 16)}:00Z`;
    // Add a fixed predicate to the shared partition filter, including CTE queries.
    statement = statement.replace(
      'day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)',
      'day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE) AND event_time >= CAST($from_time AS TIMESTAMP) AND event_time < CAST($to_time AS TIMESTAMP)',
    );
  }
  if (path !== undefined) {
    bindings['path'] = path;
    bindings['path_prefix'] = path === '/' ? '/' : `${path}/`;
    // starts_with treats SQL wildcard characters as literal path characters.
    statement = statement.replace(
      'day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)',
      'day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE) AND (uri = $path OR starts_with(uri, $path_prefix))',
    );
  }
  if (params.splitBots) statement = withTrafficBreakdown(name, statement);
  return {
    // Justified by `queryDefinition` above: it raised unless `name` is one of
    // the table's own keys, which is exactly what `QueryName` enumerates.
    name: name as QueryName,
    sql: statement,
    resultColumns: params.splitBots
      ? [...definition.resultColumns, 'non_bot', 'bot']
      : definition.resultColumns,
    bindings,
  };
}
