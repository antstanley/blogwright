/** Execute UTC bucket boundaries in real local DuckDB, without AWS or extensions. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDuckDb, type DuckDbConnection } from './duckdb-session.js';
import { bindPageViewsRelation } from './duckdb-query.js';
import { ANALYTICS_QUERY_NAMES, prepareQuery } from '../queries.js';
import type { ViewGranularity } from '../view-granularity.js';

const RANGE = { from: '2026-09-01', to: '2026-09-01' };
const TIMES = [
  '00:00:00',
  '00:14:59.999',
  '00:15:00',
  '00:59:59.999',
  '01:00:00',
  '05:59:59.999',
  '06:00:00',
  '11:59:59.999',
  '12:00:00',
  '23:59:59.999',
];
const EXPECTED: readonly [ViewGranularity, readonly [string, number][]][] = [
  [
    '15m',
    [
      ['00:00', 2],
      ['00:15', 1],
      ['00:45', 1],
      ['01:00', 1],
      ['05:45', 1],
      ['06:00', 1],
      ['11:45', 1],
      ['12:00', 1],
      ['23:45', 1],
    ],
  ],
  [
    '1h',
    [
      ['00:00', 4],
      ['01:00', 1],
      ['05:00', 1],
      ['06:00', 1],
      ['11:00', 1],
      ['12:00', 1],
      ['23:00', 1],
    ],
  ],
  [
    '6h',
    [
      ['00:00', 6],
      ['06:00', 2],
      ['12:00', 1],
      ['18:00', 1],
    ],
  ],
  [
    '12h',
    [
      ['00:00', 8],
      ['12:00', 2],
    ],
  ],
];

describe('UTC request buckets', () => {
  let connection: DuckDbConnection;
  beforeAll(async () => {
    connection = await connectDuckDb();
    await connection.run(
      'CREATE TABLE page_views(event_time TIMESTAMP, day DATE, is_bot BOOLEAN)',
      {},
    );
    for (const time of TIMES) {
      await connection.run(
        "INSERT INTO page_views VALUES (CAST($time AS TIMESTAMP), DATE '2026-09-01', false)",
        { time: `2026-09-01 ${time}` },
      );
    }
    await connection.run(
      "INSERT INTO page_views VALUES (TIMESTAMP '2026-09-01 00:15:00', DATE '2026-09-01', true), (TIMESTAMP '2026-09-02 00:00:00', DATE '2026-09-02', false)",
      {},
    );
  });
  beforeAll(async () => {
    await connection.run("ALTER TABLE page_views ADD COLUMN uri VARCHAR DEFAULT '/'", {});
    await connection.run(
      "ALTER TABLE page_views ADD COLUMN referrer VARCHAR DEFAULT 'https://example.com'",
      {},
    );
    await connection.run("ALTER TABLE page_views ADD COLUMN country VARCHAR DEFAULT 'ZA'", {});
    await connection.run('ALTER TABLE page_views ADD COLUMN status INTEGER DEFAULT 200', {});
    await connection.run("ALTER TABLE page_views ADD COLUMN result_type VARCHAR DEFAULT 'Hit'", {});
    await connection.run(
      "ALTER TABLE page_views ADD COLUMN visitor_key VARCHAR DEFAULT 'visitor'",
      {},
    );
  });
  afterAll(() => connection.close());
  it.each(EXPECTED)(
    'groups %s at midnight-aligned boundaries and excludes bots/out-of-range rows',
    async (granularity, expected) => {
      const prepared = prepareQuery(
        'views-over-time',
        { range: RANGE, granularity },
        { bots: 'filter' },
      );
      const rows = await connection.run(
        bindPageViewsRelation(prepared, 'page_views'),
        prepared.bindings,
      );
      expect(rows).toEqual(
        expected.map(([time, views]) => ({ day: `2026-09-01T${time}:00Z`, views })),
      );
    },
  );
  it('retains daily compatibility and includes bots when requested', async () => {
    const prepared = prepareQuery(
      'views-over-time',
      { range: RANGE, granularity: '24h', includeBots: true },
      { bots: 'filter' },
    );
    expect(
      await connection.run(bindPageViewsRelation(prepared, 'page_views'), prepared.bindings),
    ).toEqual([{ day: '2026-09-01', views: 11 }]);
  });
  it('filters exact minute bounds before bucketing, with an exclusive end', async () => {
    for (const granularity of ['15m', '1h', '24h'] as const) {
      const prepared = prepareQuery(
        'views-over-time',
        {
          range: { from: '2026-09-01T00:15Z', to: '2026-09-01T01:00Z' },
          granularity,
        },
        { bots: 'filter' },
      );
      const rows = await connection.run(
        bindPageViewsRelation(prepared, 'page_views'),
        prepared.bindings,
      );
      expect(rows.reduce((sum, row) => sum + Number(row['views']), 0)).toBe(2);
      expect(prepared.bindings['from']).toBe('2026-09-01');
    }
  });
  it('applies timestamp predicates to every named query, including daily CTEs', async () => {
    for (const name of ANALYTICS_QUERY_NAMES) {
      const prepared = prepareQuery(
        name,
        { range: { from: '2026-09-01T00:15Z', to: '2026-09-01T01:00Z' } },
        { bots: 'filter' },
      );
      expect(prepared.sql).toContain('event_time >= CAST($from_time AS TIMESTAMP)');
      expect(prepared.sql).toContain('event_time < CAST($to_time AS TIMESTAMP)');
      expect(prepared.bindings['to_time']).toBe('2026-09-01T01:00:00Z');
      const rows = await connection.run(
        bindPageViewsRelation(prepared, 'page_views'),
        prepared.bindings,
      );
      const countColumn =
        name === 'row-count'
          ? 'row_count'
          : name === 'cache-hit-ratio'
            ? 'requests'
            : name === 'unique-visitors'
              ? 'daily_unique_visitors'
              : 'views';
      expect(rows.reduce((sum, row) => sum + Number(row[countColumn]), 0)).toBe(
        name === 'unique-visitors' ? 1 : 2,
      );
    }
  });
  it.each(['2026-02-30T12:00Z', '2026-09-01T24:00Z', '2026-09-01T12:00+02:00', '2026-09-01T12:00'])(
    'rejects invalid or ambiguous timestamp %s',
    (from) => {
      expect(() =>
        prepareQuery(
          'views-over-time',
          { range: { from, to: '2026-09-02T00:00Z' } },
          { bots: 'filter' },
        ),
      ).toThrow();
    },
  );
  it('rejects mixed precision and empty timestamp ranges', () => {
    for (const from of ['2026-09-01', '2026-09-01T01:00Z']) {
      expect(() =>
        prepareQuery(
          'views-over-time',
          { range: { from, to: '2026-09-01T01:00Z' } },
          { bots: 'filter' },
        ),
      ).toThrow();
    }
  });
});
