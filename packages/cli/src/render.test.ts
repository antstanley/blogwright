import { stripColors } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  formatAgo,
  formatDuration,
  renderHistoryTable,
  renderStatusTree,
  renderSummary,
  spinnerFrame,
} from './render.js';

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

describe('formatAgo', () => {
  it('scales from seconds to days', () => {
    expect(formatAgo(42_000)).toBe('42s ago');
    expect(formatAgo(5 * 60_000)).toBe('5m ago');
    expect(formatAgo(3 * 3_600_000)).toBe('3h ago');
    expect(formatAgo(12 * 86_400_000)).toBe('12d ago');
  });
});

describe('renderStatusTree', () => {
  it('marks present/missing/error entries and closes the tree', () => {
    const lines = renderStatusTree([
      { title: 'S3 bucket', state: 'present', detail: '{"arn":"a"}' },
      { title: 'ACM certificate', state: 'missing' },
      { title: 'CloudFront distribution', state: 'error', detail: 'read failed' },
    ]).map(stripColors);

    expect(lines[0]).toBe('├─ ✓ S3 bucket {"arn":"a"}');
    expect(lines[1]).toBe('├─ ◌ ACM certificate');
    expect(lines[2]).toBe('╰─ ✗ CloudFront distribution read failed');
  });
});

describe('renderHistoryTable', () => {
  const now = Date.parse('2026-07-11T12:00:00Z');
  const entries = [
    {
      hash: 'ffffffffffff',
      status: 'failed' as const,
      finishedAt: '2026-07-11T11:58:00Z',
      durationMs: 30_000,
    },
    {
      hash: 'aaaaaaaaaaaa',
      status: 'succeeded' as const,
      finishedAt: '2026-07-11T10:00:00Z',
      durationMs: 134_000,
    },
    {
      hash: 'bbbbbbbbbbbb',
      status: 'succeeded' as const,
      finishedAt: '2026-07-10T10:00:00Z',
      durationMs: 90_000,
    },
  ];

  it('marks only the newest success as live', () => {
    const lines = renderHistoryTable(entries, now).map(stripColors);

    expect(lines[1]).toContain('ffffffffffff');
    expect(lines[1]).toContain('✗');
    expect(lines[1]).not.toContain('← live');
    expect(lines[2]).toContain('aaaaaaaaaaaa');
    expect(lines[2]).toContain('← live');
    expect(lines[3]).not.toContain('← live');
  });

  it('renders relative times and compact durations', () => {
    const lines = renderHistoryTable(entries, now).map(stripColors);

    expect(lines[1]).toContain('2m ago');
    expect(lines[2]).toContain('2h ago');
    expect(lines[2]).toContain('2m14s');
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
