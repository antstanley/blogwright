import { describe, expect, it } from 'vitest';
import { pickerValue, reportingValue } from './picker-date.js';
import { presetRange, rangeProblem } from '../../../src/reporting-range.js';

describe('reporting calendar values', () => {
  it.each(['2026-03-08T02:30', '2026-11-01T01:30', '2024-02-29T23:59'])(
    'preserves UTC wall time %s across DST and leap days',
    (value) => expect(reportingValue(pickerValue(value).value)).toBe(value),
  );

  it('retains hours and minutes when selecting a different day', () => {
    const selected = pickerValue('2026-09-05T19:09').value;
    expect(reportingValue(selected?.set({ day: 8 }))).toBe('2026-09-08T19:09');
  });

  it('represents cleared segments as an incomplete reporting window', () => {
    expect(pickerValue('')).toEqual({});
    expect(reportingValue(undefined)).toBe('');
    expect(rangeProblem({ from: reportingValue(undefined), to: '2026-09-05T19:09' })).toBeDefined();
  });

  it('round-trips preset changes and keeps reversed ranges invalid', () => {
    const range = presetRange('3h', new Date('2026-09-05T19:09:00Z'));
    const from = reportingValue(pickerValue(range.from).value);
    const to = reportingValue(pickerValue(range.to).value);
    expect({ from, to }).toEqual(range);
    expect(rangeProblem({ from, to })).toBeUndefined();
    expect(rangeProblem({ from: to, to: from })).toBeDefined();
  });
});
