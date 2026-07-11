/*
 * Pure presentation helpers: data in, lines out — the caller writes them.
 * Every renderer takes a `pretty` flag; the plain form is stable, line-oriented
 * output for CI systems and agents, the pretty form is for humans on a TTY.
 */

import { colors, stripColors } from 'blogwright-core';

/** Compact human duration: 12s, 2m14s. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** The spinner glyph for a poll cycle; callers pass a monotonically growing tick. */
export function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]!;
}

/** Coarse relative time for history listings: 42s ago, 5m ago, 3h ago, 12d ago. */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export interface SummaryRow {
  label: string;
  value: string;
}

/**
 * A summary card: a box on a TTY, plain `label: value` lines otherwise.
 * Values may carry colour; widths are computed on the visible text.
 */
export function renderSummary(title: string, rows: SummaryRow[], pretty: boolean): string[] {
  if (!pretty) {
    return [`${title}:`, ...rows.map((r) => `  ${r.label}: ${stripColors(r.value)}`)];
  }
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const body = rows.map((r) => `${colors.dim(r.label.padEnd(labelWidth))}  ${r.value}`);
  const inner = Math.max(title.length + 1, ...body.map((l) => stripColors(l).length));
  const pad = (content: string) => ' '.repeat(inner - stripColors(content).length);
  return [
    `╭─ ${colors.bold(title)} ${'─'.repeat(inner - title.length - 1)}╮`,
    ...body.map((l) => `│ ${l}${pad(l)} │`),
    `╰${'─'.repeat(inner + 2)}╯`,
  ];
}

export interface StatusEntry {
  title: string;
  state: 'present' | 'missing' | 'error';
  detail?: string | undefined;
}

const STATUS_MARKS = {
  present: colors.green('✓'),
  missing: colors.yellow('◌'),
  error: colors.red('✗'),
} as const;

/** The pretty drift tree for `status` (the plain form keeps the classic lines). */
export function renderStatusTree(entries: StatusEntry[]): string[] {
  return entries.map((entry, i) => {
    const connector = i === entries.length - 1 ? '╰─' : '├─';
    const detail = entry.detail ? ` ${colors.dim(entry.detail)}` : '';
    return `${connector} ${STATUS_MARKS[entry.state]} ${entry.title}${detail}`;
  });
}

export interface HistoryEntry {
  hash: string;
  status: 'succeeded' | 'failed';
  finishedAt: string;
  durationMs: number;
}

/**
 * The pretty deployment table for `history`: relative times, a live marker on
 * the newest success. Entries arrive newest-first (the caller sorts).
 */
export function renderHistoryTable(entries: HistoryEntry[], now: number): string[] {
  const liveIndex = entries.findIndex((e) => e.status === 'succeeded');
  const rows = entries.map((e, i) => {
    const mark = e.status === 'succeeded' ? colors.green('✓') : colors.red('✗');
    const cells = [
      e.hash.padEnd(13),
      mark,
      formatAgo(now - Date.parse(e.finishedAt)).padEnd(9),
      formatDuration(e.durationMs).padEnd(7),
    ].join(' ');
    return i === liveIndex ? `${cells} ${colors.cyan('← live')}` : cells;
  });
  return [colors.bold(`${'hash'.padEnd(13)} ${' '} ${'finished'.padEnd(9)} duration`), ...rows];
}
