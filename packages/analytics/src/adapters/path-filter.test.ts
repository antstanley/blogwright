/** Execute path matching alongside exact time bounds and traffic splits in real DuckDB. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDuckDb, type DuckDbConnection } from './duckdb-session.js';
import { bindPageViewsRelation } from './duckdb-query.js';
import { ANALYTICS_QUERY_NAMES, prepareQuery } from '../queries.js';

const RANGE = { from: '2026-09-01T00:02Z', to: '2026-09-01T00:03Z' };
const PATHS = [
  '/docs',
  '/docs/',
  '/docs/start',
  '/docs/deep/page',
  '/docs-old',
  '/doc',
  '/other',
  '/docs%_',
  '/docs%_/child',
  '/docsXX/child',
  "/quote'/child",
];
describe('path-scoped reports', () => {
  let connection: DuckDbConnection;
  beforeAll(async () => {
    connection = await connectDuckDb();
    await connection.run(
      'CREATE TABLE page_views(event_time TIMESTAMP, day DATE, is_bot BOOLEAN, visitor_key VARCHAR, uri VARCHAR, referrer VARCHAR, country VARCHAR, status INTEGER, result_type VARCHAR)',
      {},
    );
    for (const [index, path] of PATHS.entries()) {
      await connection.run(
        "INSERT INTO page_views VALUES (TIMESTAMP '2026-09-01 00:02:00', DATE '2026-09-01', $bot, $visitor, $path, 'https://example.com', 'ZA', 200, 'Hit')",
        { bot: index % 2 === 0, visitor: String(index), path },
      );
    }
    await connection.run(
      "INSERT INTO page_views VALUES (TIMESTAMP '2026-09-01 00:03:00', DATE '2026-09-01', true, 'outside', '/docs', 'https://example.com', 'ZA', 200, 'Hit')",
      {},
    );
  });
  afterAll(() => connection.close());
  it.each(ANALYTICS_QUERY_NAMES)(
    '%s limits reporting before aggregation and traffic splitting',
    async (name) => {
      const prepared = prepareQuery(
        name,
        { range: RANGE, path: '/docs', includeBots: true, splitBots: true },
        { bots: 'filter' },
      );
      const rows = await connection.run(
        bindPageViewsRelation(prepared, 'page_views'),
        prepared.bindings,
      );
      const metric =
        name === 'row-count'
          ? 'row_count'
          : name === 'cache-hit-ratio'
            ? 'requests'
            : name === 'unique-visitors'
              ? 'daily_unique_visitors'
              : 'views';
      expect(rows.reduce((sum, row) => sum + Number(row[metric]), 0)).toBe(4);
      expect(rows.reduce((sum, row) => sum + Number(row['bot']) + Number(row['non_bot']), 0)).toBe(
        name === 'cache-hit-ratio' ? 1 : 4,
      );
    },
  );
  it.each([
    ['/docs/', 4],
    ['/', 11],
    ['', 11],
    ['/docs%_', 2],
    ["/quote'", 1],
    ['/missing', 0],
  ] as const)('matches %s literally with expected count %i', async (path, count) => {
    const prepared = prepareQuery(
      'row-count',
      { range: RANGE, path, includeBots: true },
      { bots: 'filter' },
    );
    const rows = await connection.run(
      bindPageViewsRelation(prepared, 'page_views'),
      prepared.bindings,
    );
    expect(rows[0]?.['row_count']).toBe(count);
    if (path.includes("'")) expect(prepared.sql).not.toContain(path);
  });
  it('combines path, bot exclusion, and intraday granularity', async () => {
    const prepared = prepareQuery(
      'views-over-time',
      { range: RANGE, path: '/docs', includeBots: false, granularity: '15m' },
      { bots: 'flag' },
    );
    const rows = await connection.run(
      bindPageViewsRelation(prepared, 'page_views'),
      prepared.bindings,
    );
    expect(rows).toEqual([{ day: '2026-09-01T00:00:00Z', views: 2 }]);
  });
});
