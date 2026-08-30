/*
 * Pure presentation helpers: data in, lines out - the caller writes them.
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

/**
 * Leveled-logger surface {@link logStatusEntries} reports through - both the
 * CLI's own `Logger` (`packages/cli/src/logger.ts`) and core's
 * `PluginLogger` (`blogwright-core`'s `plugin.ts`) satisfy it structurally,
 * so this module needs neither type imported.
 */
export interface StatusLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/**
 * Report `entries` through `logger`, choosing the pretty tree ({@link
 * renderStatusTree}) on an interactive terminal or the plain, CI-stable form
 * otherwise: a `present`/`missing` line via `logger.info`, or a `read
 * failed` line via `logger.warn` for an entry whose `read()` threw. Shared
 * by the CLI's own `status` command (`commands.ts`) and a plugin's generic
 * `status` verb (`plugin-commands.ts`), so the two never carry two
 * near-identical copies of the same render branch.
 */
export function logStatusEntries(
  entries: StatusEntry[],
  pretty: boolean,
  logger: StatusLogger,
): void {
  if (pretty) {
    for (const line of renderStatusTree(entries)) logger.info(line);
    return;
  }
  // The plain form is the stable contract for CI logs and agents.
  for (const entry of entries) {
    if (entry.state === 'error') {
      logger.warn(`${entry.title}: read failed (${entry.detail})`);
      continue;
    }
    const mark = entry.state === 'present' ? colors.green('present') : colors.yellow('missing');
    logger.info(`  ${mark}  ${entry.title} ${entry.detail ? colors.dim(entry.detail) : ''}`);
  }
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

/** One installed plugin's row in `blogwright plugin list`. */
export interface PluginListRow {
  /** The CLI namespace the plugin claims - `Plugin.name`. */
  namespace: string;
  /** The npm package the plugin was loaded from. */
  packageName: string;
  /** From the package's own `package.json`; `undefined` when it declares none. */
  version?: string | undefined;
  /** The single top-level config key the plugin owns; `undefined` when it owns none. */
  configKey?: string | undefined;
}

/** One plugin that failed to load, as `discover` reported it. */
interface PluginListFailure {
  packageName: string;
  reason: string;
}

/** What `blogwright plugin list` has to show: the plugins that loaded, and the ones that did not. */
export interface PluginListing {
  rows: readonly PluginListRow[];
  failures: readonly PluginListFailure[];
}

/**
 * Printed in place of a cell the plugin genuinely has no value for. An
 * explicit marker, never an empty cell: plain output is column-per-line and
 * whitespace-separated, so a blank cell would silently shift every column
 * after it for whatever is parsing the line.
 */
const NO_CONFIG_KEY = '(none)';

/** Printed for a plugin whose own `package.json` declares no `version` field at all. */
const UNKNOWN_VERSION = '(unknown)';

/** Column headers, in the order {@link pluginListCells} emits the cells. */
const PLUGIN_LIST_HEADERS = ['namespace', 'package', 'version', 'configKey'] as const;

/** Heading the failure lines are printed under, in both forms. */
const FAILED_TO_LOAD_HEADING = 'failed to load:';

function pluginListCells(row: PluginListRow): string[] {
  return [
    row.namespace,
    row.packageName,
    row.version ?? UNKNOWN_VERSION,
    row.configKey ?? NO_CONFIG_KEY,
  ];
}

/** Pad every cell but the last to the widest value in its column. */
function alignCells(cells: readonly string[], widths: readonly number[]): string {
  return cells
    .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
    .join('  ')
    .trimEnd();
}

/**
 * The `blogwright plugin list` listing, in the two forms every renderer in
 * this module offers: an aligned table under a bold header on a TTY, and the
 * same columns single-space separated otherwise. The plain form is the stable
 * contract for CI logs and agents - the same split `history` makes
 * (`commands.ts`), which is why the column set is identical in both and only
 * the padding and the colour differ.
 *
 * Emits NOTHING for a listing with no rows and no failures, so a repo with no
 * plugins installed gets its caller's empty-state line and not a header over
 * an empty table.
 */
export function renderPluginList(listing: PluginListing, pretty: boolean): string[] {
  const lines: string[] = [];
  if (listing.rows.length > 0) {
    const cells = listing.rows.map(pluginListCells);
    if (pretty) {
      const widths = PLUGIN_LIST_HEADERS.map((header, i) =>
        Math.max(header.length, ...cells.map((row) => (row[i] ?? '').length)),
      );
      lines.push(colors.bold(alignCells(PLUGIN_LIST_HEADERS, widths)));
      lines.push(...cells.map((row) => alignCells(row, widths)));
    } else {
      lines.push(PLUGIN_LIST_HEADERS.join(' '));
      lines.push(...cells.map((row) => row.join(' ')));
    }
  }
  if (listing.failures.length > 0) {
    lines.push(pretty ? colors.bold(FAILED_TO_LOAD_HEADING) : FAILED_TO_LOAD_HEADING);
    // The same `<package>: <reason>` shape `--help` already prints a failed
    // plugin in (`cli.ts`'s `renderPluginFailure`), and for the same reason:
    // the reason is `discover`'s own message, never an `Error.stack`.
    lines.push(...listing.failures.map((failure) => `${failure.packageName}: ${failure.reason}`));
  }
  return lines;
}
