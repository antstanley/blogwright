import { describe, expect, it } from 'vitest';
import { defaultRange, PERIODS, presetRange, rangeProblem } from './reporting-range.js';

const NOW = new Date('2026-09-05T15:47:59.123Z');
describe('reporting period presets', () => {
  it.each([
    ['3h', '2026-09-05T12:47'],
    ['6h', '2026-09-05T09:47'],
    ['12h', '2026-09-05T03:47'],
    ['24h', '2026-09-04T15:47'],
    ['5d', '2026-08-31T15:47'],
    ['1w', '2026-08-29T15:47'],
    ['4w', '2026-08-08T15:47'],
    ['3mo', '2026-06-05T15:47'],
    ['6mo', '2026-03-05T15:47'],
    ['1y', '2025-09-05T15:47'],
  ] as const)('%s anchors both bounds to the current UTC minute', (period, from) => {
    expect(presetRange(period, NOW)).toEqual({ from, to: '2026-09-05T15:47' });
  });
  it('clamps leap days and short months', () => {
    expect(presetRange('1y', new Date('2024-02-29T01:23Z')).from).toBe('2023-02-28T01:23');
    expect(presetRange('3mo', new Date('2026-05-31T01:23Z')).from).toBe('2026-02-28T01:23');
  });
  it('uses elapsed UTC hours across daylight saving changes', () => {
    const end = new Date('2026-03-08T08:15Z');
    expect(presetRange('3h', end)).toEqual({ from: '2026-03-08T05:15', to: '2026-03-08T08:15' });
  });
  it('returns valid ranges for every preset and the initial window', () => {
    for (const period of PERIODS)
      expect(rangeProblem(presetRange(period.value, NOW))).toBeUndefined();
    expect(rangeProblem(defaultRange(NOW))).toBeUndefined();
  });
  it.each(['', '2026-02-30T12:00', '2026-09-05T25:00', '2026-09-05', '2026-09-05T15:47:12'])(
    'rejects invalid input %s',
    (from) => {
      expect(rangeProblem({ from, to: '2026-09-05T16:00' })).toBeDefined();
    },
  );
  it('rejects empty and inverted windows', () => {
    expect(rangeProblem({ from: '2026-09-05T16:00', to: '2026-09-05T16:00' })).toBeDefined();
    expect(rangeProblem({ from: '2026-09-05T16:01', to: '2026-09-05T16:00' })).toBeDefined();
  });
});
