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
