/** Interval inputs must be finite vocabulary, never SQL fragments or silent fallback. */
import { describe, expect, it } from 'vitest';
import { parseViewGranularity, VIEW_GRANULARITIES } from './view-granularity.js';
import { prepareQuery } from './queries.js';

const RANGE = { from: '2026-09-01', to: '2026-09-01' };

describe('view granularity', () => {
  it('defaults to the existing daily query', () => {
    expect(parseViewGranularity(undefined)).toBe('24h');
    expect(prepareQuery('views-over-time', { range: RANGE }, { bots: 'filter' })).toEqual(
      prepareQuery('views-over-time', { range: RANGE, granularity: '24h' }, { bots: 'filter' }),
    );
  });
  it.each(Object.keys(VIEW_GRANULARITIES))('accepts %s and binds its fixed interval', (value) => {
    const granularity = parseViewGranularity(value);
    const prepared = prepareQuery(
      'views-over-time',
      { range: RANGE, granularity },
      { bots: 'filter' },
    );
    if (granularity !== '24h') {
      expect(prepared.sql).toContain('time_bucket');
      expect(prepared.bindings['bucket_minutes']).toBe(
        String(VIEW_GRANULARITIES[granularity].minutes),
      );
    }
  });
  it.each(['', '30m', '0', '1H', '15m; DROP TABLE page_views', 15, null])('rejects %s', (value) => {
    expect(() => parseViewGranularity(value)).toThrow('granularity must be one of');
  });
  it('rejects intervals on unrelated reports', () => {
    expect(() =>
      prepareQuery('countries', { range: RANGE, granularity: '1h' }, { bots: 'filter' }),
    ).toThrow('only supported by views-over-time');
  });
});
