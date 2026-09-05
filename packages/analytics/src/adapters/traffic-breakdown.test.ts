/** Execute disjoint traffic contributions against real DuckDB aggregates. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDuckDb, type DuckDbConnection } from './duckdb-session.js';
import { bindPageViewsRelation } from './duckdb-query.js';
import { ANALYTICS_QUERY_NAMES, prepareQuery } from '../queries.js';

const RANGE = { from: '2026-09-01T00:01Z', to: '2026-09-01T00:05Z' };
describe('traffic breakdown', () => {
  let connection: DuckDbConnection;
  beforeAll(async () => {
    connection = await connectDuckDb();
    await connection.run(
      'CREATE TABLE page_views(event_time TIMESTAMP, day DATE, is_bot BOOLEAN, visitor_key VARCHAR, uri VARCHAR, referrer VARCHAR, country VARCHAR, status INTEGER, result_type VARCHAR)',
      {},
    );
    for (const [minute, bot, visitor, result] of [
      [1, false, 'a', 'Hit'],
      [2, true, 'a', 'Hit'],
      [3, true, 'b', 'Miss'],
      [4, null, 'c', 'Hit'],
      [5, true, 'd', 'Hit'],
    ] as const) {
      await connection.run(
        "INSERT INTO page_views VALUES (CAST($time AS TIMESTAMP), DATE '2026-09-01', $bot, $visitor, '/docs', 'https://example.com', 'ZA', 200, $result)",
        { time: `2026-09-01 00:0${minute}:00`, bot, visitor, result },
      );
    }
  });
  afterAll(() => connection.close());
  it.each(ANALYTICS_QUERY_NAMES)('%s splits without changing the aggregate total', async (name) => {
    const combined = prepareQuery(name, { range: RANGE, includeBots: true }, { bots: 'filter' });
    const split = prepareQuery(
      name,
      { range: RANGE, includeBots: true, splitBots: true },
      { bots: 'filter' },
    );
    const original = await connection.run(
      bindPageViewsRelation(combined, 'page_views'),
      combined.bindings,
    );
    const rows = await connection.run(bindPageViewsRelation(split, 'page_views'), split.bindings);
    expect(rows).toHaveLength(original.length);
    for (const [index, row] of rows.entries()) {
      const { bot, non_bot, ...total } = row;
      expect(total).toEqual(original[index]);
      const metric =
        name === 'cache-hit-ratio'
          ? 'cache_hit_ratio'
          : name === 'unique-visitors'
            ? 'daily_unique_visitors'
            : name === 'row-count'
              ? 'row_count'
              : 'views';
      expect(Number(bot) + Number(non_bot)).toBeCloseTo(Number(row[metric]));
      expect(Number(non_bot)).toBe(name === 'cache-hit-ratio' ? 0.5 : 2);
      expect(Number(bot)).toBe(
        name === 'cache-hit-ratio' ? 0.25 : name === 'unique-visitors' ? 1 : 2,
      );
    }
  });
  it.each(['15m', '1h', '6h', '12h', '24h'] as const)(
    'splits %s buckets after applying exact time bounds',
    async (granularity) => {
      const split = prepareQuery(
        'views-over-time',
        { range: RANGE, includeBots: true, splitBots: true, granularity },
        { bots: 'filter' },
      );
      const rows = await connection.run(bindPageViewsRelation(split, 'page_views'), split.bindings);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ views: 4, bot: 2, non_bot: 2 });
    },
  );
  it('refuses a split when bots have been excluded', () => {
    expect(() =>
      prepareQuery(
        'views-over-time',
        { range: RANGE, includeBots: false, splitBots: true },
        { bots: 'flag' },
      ),
    ).toThrow('splitBots requires includeBots=true');
  });
});
