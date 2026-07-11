import { stripColors } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { formatDuration, renderSummary, spinnerFrame } from './render.js';

describe('formatDuration', () => {
  it('renders seconds below a minute and m/s above', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(12_400)).toBe('12s');
    expect(formatDuration(134_000)).toBe('2m14s');
    expect(formatDuration(60_000)).toBe('1m00s');
  });

  it('clamps negatives to zero', () => {
    expect(formatDuration(-500)).toBe('0s');
  });
});

describe('spinnerFrame', () => {
  it('cycles frames and never returns undefined', () => {
    const first = spinnerFrame(0);
    expect(spinnerFrame(10)).toBe(first);
    expect(spinnerFrame(123)).toBeTruthy();
  });
});

describe('renderSummary', () => {
  const rows = [
    { label: 'revision', value: 'abc123def456' },
    { label: 'build', value: '2m14s' },
  ];

  it('renders plain label: value lines off-TTY, colour stripped', () => {
    expect(renderSummary('deploy summary', rows, false)).toEqual([
      'deploy summary:',
      '  revision: abc123def456',
      '  build: 2m14s',
    ]);
  });

  it('renders an aligned box on a TTY with equal visible line widths', () => {
    const lines = renderSummary('deploy summary', rows, true);
    const visible = lines.map((l) => stripColors(l));

    expect(visible[0]!.startsWith('╭─ deploy summary ')).toBe(true);
    expect(visible.at(-1)!.startsWith('╰')).toBe(true);
    const widths = new Set(visible.map((l) => [...l].length));
    expect(widths.size).toBe(1);
    expect(visible[1]).toContain('revision');
    expect(visible[1]).toContain('abc123def456');
  });
});
