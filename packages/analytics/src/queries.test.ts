import { describe, expect, it } from 'vitest';

import { validateAnalyticsConfig } from './config.js';
import { createFixtureAnalyticsQuery, type QueryFixtures } from './fixture-query.js';
import type { QueryRow } from './ports.js';
import {
  ANALYTICS_QUERIES,
  ANALYTICS_QUERY_NAMES,
  PAGE_VIEWS_RELATION,
  prepareQuery,
  type QueryName,
  type QueryParams,
  ROW_COUNT_COLUMN,
  ROW_COUNT_QUERY,
  WHOLE_TABLE_RANGE,
} from './queries.js';
import { PAGE_VIEWS_COLUMNS } from './schema.js';

/** The seven the change spec's §Analytics dashboard → Local server lists, in its order. */
const SPEC_QUERY_NAMES = [
  'views-over-time',
  'top-paths',
  'referrers',
  'countries',
  'status-codes',
  'cache-hit-ratio',
  'unique-visitors',
];

/**
 * Every name the set answers to: the spec's seven, then the row count task 55
 * added for `analytics status`. Spelled as a literal rather than as
 * `[...SPEC_QUERY_NAMES, ROW_COUNT_QUERY]` in the membership assertion's own
 * terms, so a set that lost the row count fails here instead of agreeing with
 * whatever the module exports.
 */
const EVERY_QUERY_NAME = [...SPEC_QUERY_NAMES, 'row-count'];

/** The date range and bot-inclusion flag the spec requires of every query. */
const EVERY_BIND = ['from', 'to', 'include_bots'];

/** A well-formed range, used wherever the range is not what a test is about. */
const RANGE = { from: '2026-08-01', to: '2026-08-07' };

/** Those days, with the bot flag left to the config. */
const PARAMS: QueryParams = { range: RANGE };

/** A validated empty `analytics` block, so `bots` carries task 44's own default. */
const CONFIG = validateAnalyticsConfig({});

/** Anything shaped like a day - what an interpolated `from` or `to` leaves behind. */
const DAY_SHAPED = /\d{4}-\d{2}-\d{2}/;

/**
 * Names that are keys of `Object.prototype` rather than of the named set. A
 * plain property lookup answers every one of them with an inherited function,
 * so a lookup that only checks for `undefined` never rejects them and the
 * caller gets an internal `TypeError` off a "definition" that is really
 * `Object.prototype.constructor`. Reachable from a URL: the local server's
 * `GET /api/queries/<name>` path arrives at exactly this seam.
 */
const INHERITED_KEYS = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  '__proto__',
];

/** The unknown-name rejection, as a caller reads it. */
function unknownNameError(name: string): string {
  return `unknown analytics query "${name}" - available queries are ${EVERY_QUERY_NAME.join(', ')}`;
}

/**
 * Parameters as the dashboard's query string can actually produce them. The
 * casts are the whole reason `prepareQuery` re-checks a range the type says is
 * present: the local server reads `from` and `to` off a URL, where every value
 * is `string | undefined` and a narrowing can be forgotten.
 */
const PARAMS_WITHOUT_RANGE = {} as unknown as QueryParams;
const PARAMS_WITHOUT_FROM = { range: { to: '2026-08-07' } } as unknown as QueryParams;

/**
 * The definition shape these tests assert over. Declared here rather than
 * imported because `queries.ts` deliberately exports neither `QueryDefinition`
 * nor the `SqlText` brand - the assignment in {@link definitionOf} is itself a
 * check that the real definitions have this shape.
 */
interface QueryDefinitionView {
  readonly rowMeaning: string;
  readonly columns: readonly string[];
  readonly binds: readonly string[];
  readonly resultColumns: readonly string[];
  readonly literals: readonly string[];
  readonly sql: string;
}

function definitionOf(name: QueryName): QueryDefinitionView {
  return ANALYTICS_QUERIES[name];
}

/** Sorted and de-duplicated, so a comparison is about membership rather than order. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Every `$name` placeholder a statement carries. */
function placeholdersIn(sql: string): string[] {
  return (sql.match(/\$[a-z_]+/g) ?? []).map((placeholder) => placeholder.slice(1));
}

/** Every quoted literal a statement spells for itself, quotes stripped. */
function literalsIn(sql: string): string[] {
  return (sql.match(/'[^']*'/g) ?? []).map((literal) => literal.slice(1, -1));
}

/** Every `page_views` column named as a whole word in a statement. */
function schemaColumnsIn(sql: string): string[] {
  return PAGE_VIEWS_COLUMNS.map((column) => column.name)
    .filter((name) => new RegExp(`\\b${name}\\b`).test(sql))
    .sort();
}

/** The names the per-definition suite below actually iterated. */
const ITERATED: string[] = [];

describe('ANALYTICS_QUERIES', () => {
  it("is the seven named queries the spec lists, in its order, then the status command's row count", () => {
    // One assertion, not two: a second one over `SPEC_QUERY_NAMES` alone would
    // be a slice of an array this line has already pinned whole, so nothing
    // could falsify it that has not already failed here.
    expect([...ANALYTICS_QUERY_NAMES]).toEqual(EVERY_QUERY_NAME);
  });

  it('names every key of the table, so a definition cannot be added without a name', () => {
    expect(Object.keys(ANALYTICS_QUERIES)).toEqual([...ANALYTICS_QUERY_NAMES]);
  });

  it('never names a result column "unique_visitors", which would imply a cross-day count', () => {
    const everyResultColumn = ANALYTICS_QUERY_NAMES.flatMap(
      (name) => definitionOf(name).resultColumns,
    );
    expect(everyResultColumn).not.toContain('unique_visitors');
  });
});

describe.each(ANALYTICS_QUERY_NAMES)('the %s query definition', (name) => {
  ITERATED.push(name);
  const definition = definitionOf(name);

  it('declares the date range and the bot flag, and carries a placeholder for each', () => {
    expect(sortedUnique(definition.binds)).toEqual(sortedUnique(EVERY_BIND));
    expect(sortedUnique(placeholdersIn(definition.sql))).toEqual(sortedUnique(definition.binds));
  });

  it('spells no value a caller could have supplied', () => {
    expect(sortedUnique(literalsIn(definition.sql))).toEqual(sortedUnique(definition.literals));
    for (const literal of definition.literals) {
      expect(literal).not.toMatch(DAY_SHAPED);
    }
    expect(definition.sql).not.toMatch(DAY_SHAPED);
    expect(definition.sql).not.toContain('${');
  });

  it('is one statement over the relation the adapter binds', () => {
    expect(definition.sql).toMatch(new RegExp(`\\b${PAGE_VIEWS_RELATION}\\b`));
    expect(definition.sql).not.toContain(';');
  });

  it('reads exactly the page_views columns it declares', () => {
    expect(schemaColumnsIn(definition.sql)).toEqual(sortedUnique(definition.columns));
  });

  it('selects exactly the result columns it declares', () => {
    expect(sortedUnique(definition.resultColumns)).toEqual([...definition.resultColumns].sort());
    expect(definition.resultColumns.length).toBeGreaterThan(0);
    for (const column of definition.resultColumns) {
      expect(definition.sql).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });
});

describe('the per-definition suite', () => {
  it('iterated every query in the set rather than a sample', () => {
    expect(ITERATED.sort()).toEqual(Object.keys(ANALYTICS_QUERIES).sort());
  });
});

describe('the unique-visitors query', () => {
  const definition = definitionOf('unique-visitors');

  it('counts distinct visitor_key inside a day and nowhere else', () => {
    expect(definition.sql.match(/count\(\s*DISTINCT/gi) ?? []).toHaveLength(1);
    const counting = definition.sql
      .split(/\bSELECT\b/i)
      .filter((segment) => /count\(\s*DISTINCT/i.test(segment));
    expect(counting).toHaveLength(1);
    expect(counting.join('')).toMatch(/GROUP BY day/i);
  });

  it('reports the range total as the sum of those daily counts', () => {
    expect(definition.sql).toMatch(/sum\(\s*daily_unique_visitors\s*\)\s*OVER/i);
  });

  it('labels its rows as summed daily uniques, so a chart cannot relabel them', () => {
    expect(definition.resultColumns).toEqual([
      'day',
      'daily_unique_visitors',
      'summed_daily_unique_visitors',
    ]);
    expect(definition.rowMeaning).toContain('the sum of those daily counts');
    expect(definition.rowMeaning).toContain('not a distinct count across days');
  });
});

describe('prepareQuery', () => {
  it('binds the range and the bot flag the caller asked for', () => {
    const prepared = prepareQuery('views-over-time', { range: RANGE, includeBots: true }, CONFIG);
    expect(prepared.name).toBe('views-over-time');
    expect(prepared.bindings).toEqual({ from: '2026-08-01', to: '2026-08-07', include_bots: true });
    expect(prepared.sql).toBe(definitionOf('views-over-time').sql);
    expect(prepared.resultColumns).toEqual(['day', 'views']);
  });

  it('binds one value per placeholder, for every query in the set', () => {
    for (const name of ANALYTICS_QUERY_NAMES) {
      const prepared = prepareQuery(name, PARAMS, CONFIG);
      expect(Object.keys(prepared.bindings).sort()).toEqual(
        sortedUnique(placeholdersIn(definitionOf(name).sql)),
      );
    }
  });

  it('defaults the bot flag from config.analytics.bots - "flag" counts bot rows', () => {
    const config = validateAnalyticsConfig({ bots: 'flag' });
    expect(prepareQuery('views-over-time', PARAMS, config).bindings['include_bots']).toBe(true);
  });

  it('defaults the bot flag from config.analytics.bots - "filter" leaves them out', () => {
    const config = validateAnalyticsConfig({ bots: 'filter' });
    expect(prepareQuery('views-over-time', PARAMS, config).bindings['include_bots']).toBe(false);
  });

  it('lets an explicit includeBots override the configured default', () => {
    const config = validateAnalyticsConfig({ bots: 'filter' });
    const params = { range: RANGE, includeBots: true };
    expect(prepareQuery('views-over-time', params, config).bindings['include_bots']).toBe(true);
  });

  it('accepts a range of one day', () => {
    const params = { range: { from: '2026-08-01', to: '2026-08-01' } };
    expect(prepareQuery('views-over-time', params, CONFIG).bindings).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-01',
    });
  });

  it('rejects an unknown name, listing the available queries', () => {
    expect(() => prepareQuery('top-page', PARAMS, CONFIG)).toThrow(
      'unknown analytics query "top-page" - available queries are views-over-time, top-paths, referrers, countries, status-codes, cache-hit-ratio, unique-visitors',
    );
  });

  it.each(INHERITED_KEYS)('rejects the inherited key %s as an unknown name', (name) => {
    expect(() => prepareQuery(name, PARAMS, CONFIG)).toThrow(unknownNameError(name));
  });

  it('rejects an absent range rather than standing in a default, naming the value', () => {
    expect(() => prepareQuery('views-over-time', PARAMS_WITHOUT_RANGE, CONFIG)).toThrow(
      'analytics query "views-over-time": range.from must be a YYYY-MM-DD calendar day, got undefined',
    );
  });

  it('rejects a range missing one end, naming the end that is missing', () => {
    expect(() => prepareQuery('views-over-time', PARAMS_WITHOUT_FROM, CONFIG)).toThrow(
      'analytics query "views-over-time": range.from must be a YYYY-MM-DD calendar day, got undefined',
    );
  });

  it('rejects a day that is not YYYY-MM-DD, naming it', () => {
    const params = { range: { from: '2026-8-1', to: '2026-08-07' } };
    expect(() => prepareQuery('views-over-time', params, CONFIG)).toThrow(
      'analytics query "views-over-time": range.from must be a YYYY-MM-DD calendar day, got "2026-8-1"',
    );
  });

  it('rejects an extended-year day, which the calendar round-trip alone accepts', () => {
    // `+271821-04` is ten characters and round-trips through `toISOString` unchanged,
    // so only the `YYYY-MM-DD` pattern rejects it. Drop that line and this reddens alone.
    const params = { range: { from: '+271821-04', to: '2026-08-07' } };
    expect(() => prepareQuery('views-over-time', params, CONFIG)).toThrow(
      'analytics query "views-over-time": range.from must be a YYYY-MM-DD calendar day, got "+271821-04"',
    );
  });

  it('rejects a day that is not on the calendar, naming it', () => {
    const params = { range: { from: '2026-08-01', to: '2026-02-30' } };
    expect(() => prepareQuery('views-over-time', params, CONFIG)).toThrow(
      'analytics query "views-over-time": range.to must be a YYYY-MM-DD calendar day, got "2026-02-30"',
    );
  });

  it('rejects an inverted range, naming both ends', () => {
    const params = { range: { from: '2026-08-10', to: '2026-08-01' } };
    expect(() => prepareQuery('unique-visitors', params, CONFIG)).toThrow(
      'analytics query "unique-visitors": range is inverted - from "2026-08-10" is after to "2026-08-01"',
    );
  });

  it('checks the name before the range, so a typo is reported as a typo', () => {
    expect(() => prepareQuery('top-page', PARAMS_WITHOUT_RANGE, CONFIG)).toThrow(
      /^unknown analytics query/,
    );
  });
});

describe('createFixtureAnalyticsQuery', () => {
  const VIEWS: readonly QueryRow[] = [
    { day: '2026-08-01', views: 12 },
    { day: '2026-08-02', views: 7 },
  ];

  it('answers a named query with the rows recorded for it', async () => {
    const query = createFixtureAnalyticsQuery({ 'views-over-time': VIEWS });
    await expect(query.run('views-over-time', PARAMS)).resolves.toEqual(VIEWS);
  });

  it('records what each call bound, so a consumer can assert its range reached the query', async () => {
    const query = createFixtureAnalyticsQuery({ 'views-over-time': VIEWS });
    await query.run('views-over-time', { range: RANGE, includeBots: true });
    expect(query.calls.map((call) => call.name)).toEqual(['views-over-time']);
    expect(query.calls.map((call) => call.bindings)).toEqual([
      { from: '2026-08-01', to: '2026-08-07', include_bots: true },
    ]);
  });

  it('defaults the bot flag from the config it was built with', async () => {
    const config = validateAnalyticsConfig({ bots: 'filter' });
    const query = createFixtureAnalyticsQuery({ 'views-over-time': VIEWS }, config);
    await query.run('views-over-time', PARAMS);
    expect(query.calls.map((call) => call.bindings['include_bots'])).toEqual([false]);
  });

  it('refuses fixture rows recorded under a name no query has', () => {
    const fixtures = { 'top-page': VIEWS } as unknown as QueryFixtures;
    expect(() => createFixtureAnalyticsQuery(fixtures)).toThrow(
      'unknown analytics query "top-page" - available queries are views-over-time, top-paths, referrers, countries, status-codes, cache-hit-ratio, unique-visitors',
    );
  });

  it.each(INHERITED_KEYS)('refuses fixture rows recorded under the inherited key %s', (name) => {
    const fixtures = { [name]: VIEWS } as unknown as QueryFixtures;
    expect(() => createFixtureAnalyticsQuery(fixtures)).toThrow(unknownNameError(name));
  });

  it('refuses fixture rows that are not shaped like the query result', () => {
    const fixtures = { 'views-over-time': [{ day: '2026-08-01', hits: 12 }] };
    expect(() => createFixtureAnalyticsQuery(fixtures)).toThrow(
      'fixture row 0 for analytics query "views-over-time" must carry exactly its result columns day, views, got day, hits',
    );
  });

  it('raises for a query it holds no rows for, listing what it does hold', async () => {
    const query = createFixtureAnalyticsQuery({ 'views-over-time': VIEWS });
    await expect(query.run('top-paths', PARAMS)).rejects.toThrow(
      'no fixture rows recorded for analytics query "top-paths" - recorded queries are views-over-time',
    );
  });

  it('refuses an inverted range at the port, exactly as prepareQuery does', async () => {
    const query = createFixtureAnalyticsQuery({ 'views-over-time': VIEWS });
    const params = { range: { from: '2026-08-10', to: '2026-08-01' } };
    await expect(query.run('views-over-time', params)).rejects.toThrow(
      'analytics query "views-over-time": range is inverted - from "2026-08-10" is after to "2026-08-01"',
    );
    expect(query.calls).toEqual([]);
  });

  it('is typed to refuse a name the named set does not carry', async () => {
    const query = createFixtureAnalyticsQuery({});
    await expect(
      // @ts-expect-error - `run` takes a QueryName, not a string: the compile-time
      // half of the spec's *Named queries, never client-supplied SQL* decision.
      query.run('drop-table', PARAMS),
    ).rejects.toThrow('unknown analytics query "drop-table"');
  });
});

/*
 * TASK 55 - the row count `analytics status` reports. It is in this set rather
 * than in the command for one reason: the command may not write SQL, so the
 * only way to the table is a name the port already answers to.
 */
describe('the row-count query', () => {
  const definition = definitionOf(ROW_COUNT_QUERY);

  it('selects one count column and nothing else, so a status line is one figure', () => {
    expect(definition.resultColumns).toEqual([ROW_COUNT_COLUMN]);
    expect(definition.sql).toMatch(/count\(\*\)\s+AS\s+row_count/i);
  });

  it('counts rows rather than grouping them, so the answer is a single row', () => {
    expect(definition.sql).not.toMatch(/\bGROUP BY\b/i);
  });

  it('is bounded on the day partition like every other definition, and binds the bot flag', () => {
    // Restated here as well as in the per-definition suite because this is the
    // property that makes WHOLE_TABLE_RANGE meaningful: an unbounded count
    // would ignore the range and the constant below would be decoration.
    expect(definition.sql).toContain('day BETWEEN CAST($from AS DATE) AND CAST($to AS DATE)');
    expect(definition.sql).toContain('$include_bots');
  });
});

describe('WHOLE_TABLE_RANGE', () => {
  it('is the widest range a YYYY-MM-DD day can express', () => {
    expect(WHOLE_TABLE_RANGE).toEqual({ from: '1970-01-01', to: '9999-12-31' });
  });

  it('passes the same day validation a caller-supplied range does', () => {
    // The point of the assertion: `validateRange` rejects anything that is not
    // a real calendar day, so a constant of `1970-1-1` or `9999-13-01` would
    // raise here rather than reaching the table as a silent no-rows answer.
    const prepared = prepareQuery(
      ROW_COUNT_QUERY,
      { range: WHOLE_TABLE_RANGE, includeBots: true },
      CONFIG,
    );
    expect(prepared.bindings).toEqual({ from: '1970-01-01', to: '9999-12-31', include_bots: true });
  });

  it('brackets the days the table can hold, which is what makes the count the whole table', () => {
    // Both ends compared lexically, which is chronological for this shape.
    // CloudFront predates the epoch by nothing and the table's `day` comes off
    // the request's own timestamp, so a row outside this range cannot exist.
    for (const day of ['2008-11-18', '2026-08-31', '2999-12-31']) {
      expect(WHOLE_TABLE_RANGE.from <= day).toBe(true);
      expect(WHOLE_TABLE_RANGE.to >= day).toBe(true);
    }
  });
});
