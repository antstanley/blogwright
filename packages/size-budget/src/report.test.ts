import { describe, expect, it } from 'vitest';

import type { BudgetResult } from './budget.js';
import { formatBytes, formatReport } from './report.js';

describe('formatBytes', () => {
  it('prints whole bytes below one kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('switches to decimal units at each thousand', () => {
    expect(formatBytes(1_000)).toBe('1.00 kB');
    expect(formatBytes(2_606_499)).toBe('2.61 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.50 GB');
  });
});

describe('formatReport', () => {
  const result: BudgetResult = {
    rows: [
      {
        measurement: {
          name: 'blogwright-analytics',
          ownSize: 2_000_000,
          installSize: 3_100_000,
          dependencies: [
            { id: '@duckdb/node-bindings-linux-x64@1.5.5', size: 1_000_000 },
            { id: 'fflate@0.8.3', size: 100_000 },
          ],
        },
        maximum: 3_000_000,
        status: 'over',
      },
      {
        measurement: { name: 'blogwright', ownSize: 500, installSize: 900, dependencies: [] },
        maximum: 1_000,
        status: 'within',
      },
      {
        measurement: { name: 'new', ownSize: 5, installSize: 5, dependencies: [] },
        maximum: undefined,
        status: 'unbudgeted',
      },
    ],
    stale: ['gone'],
  };
  const report = formatReport(result, 'linux-x64-glibc');

  it('gives each package its size and standing against its maximum', () => {
    expect(report).toContain('Package install sizes (linux-x64-glibc):');
    expect(report).toMatch(
      /blogwright-analytics +3\.10 MB {2}max 3\.00 MB - over by 100\.00 kB \(100000 bytes\)/,
    );
    expect(report).toMatch(/blogwright +900 B {2}max 1\.00 kB - 100 B under/);
    expect(report).toMatch(/new +5 B {2}no approved maximum/);
  });

  it('lists the largest dependencies of an over-budget package', () => {
    expect(report).toContain('blogwright-analytics: own files 2.00 MB, 2 dependencies. Largest:');
    expect(report).toMatch(/1\.00 MB {2}@duckdb\/node-bindings-linux-x64@1\.5\.5/);
  });

  it('names a stale baseline entry', () => {
    expect(report).toContain('gone has an approved size but is no longer a published package.');
  });
});
