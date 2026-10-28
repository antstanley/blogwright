/** Plain-text rendering of a budget result for the terminal and CI logs. */

import type { BudgetResult, BudgetRow } from './budget.js';

/** Decimal units, as npm reports package sizes. */
const UNITS = ['B', 'kB', 'MB', 'GB'] as const;
const UNIT_STEP = 1000;

/** How many of an over-budget package's largest dependencies to list. */
const LARGEST_DEPENDENCIES_SHOWN = 5;

/** `1234567` -> `1.23 MB`; whole bytes below 1 kB. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= UNIT_STEP && unit < UNITS.length - 1) {
    value /= UNIT_STEP;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(2)} ${UNITS[unit]}`;
}

/** One line per package, then the detail and remedy for anything that fails. */
export function formatReport(result: BudgetResult, target: string): string {
  const width = Math.max(...result.rows.map((row) => row.measurement.name.length));
  const lines = [`Package install sizes (${target}):`, ''];
  for (const row of result.rows) {
    lines.push(
      `  ${row.measurement.name.padEnd(width)}  ${formatBytes(row.measurement.installSize).padStart(9)}  ${describe(row)}`,
    );
  }
  for (const row of result.rows.filter((candidate) => candidate.status === 'over')) {
    lines.push('', ...largestDependencies(row));
  }
  for (const name of result.stale) {
    lines.push('', `${name} has an approved size but is no longer a published package.`);
  }
  return lines.join('\n');
}

/** What a failed check tells the author to do. */
export const APPROVAL_INSTRUCTIONS = [
  'If this change is intended, run `pnpm size:update` and commit package-sizes.json',
  'so the new maximum is reviewed and approved in the pull request.',
].join('\n');

function describe(row: BudgetRow): string {
  if (row.maximum === undefined) return 'no approved maximum';
  const delta = row.measurement.installSize - row.maximum;
  const limit = `max ${formatBytes(row.maximum)}`;
  if (row.status === 'over')
    return `${limit} - over by ${formatBytes(delta)} (${delta} ${delta === 1 ? 'byte' : 'bytes'})`;
  return delta === 0 ? `${limit} - at the limit` : `${limit} - ${formatBytes(-delta)} under`;
}

function largestDependencies(row: BudgetRow): string[] {
  const { measurement } = row;
  return [
    `${measurement.name}: own files ${formatBytes(measurement.ownSize)}, ${measurement.dependencies.length} dependencies. Largest:`,
    ...measurement.dependencies
      .slice(0, LARGEST_DEPENDENCIES_SHOWN)
      .map((dependency) => `    ${formatBytes(dependency.size).padStart(9)}  ${dependency.id}`),
  ];
}
