import { describe, expect, it } from 'vitest';

import {
  budgetPasses,
  compareToBaseline,
  parseBaseline,
  serializeBaseline,
  type Baseline,
} from './budget.js';
import type { PackageMeasurement } from './measure.js';

const TARGET = 'linux-x64-glibc';

function measured(name: string, installSize: number): PackageMeasurement {
  return { name, ownSize: installSize, installSize, dependencies: [] };
}

function baseline(maximums: Record<string, number>): Baseline {
  return { target: TARGET, maximums: new Map(Object.entries(maximums)) };
}

describe('parseBaseline', () => {
  it('reads the target and each maximum', () => {
    const parsed = parseBaseline(
      JSON.stringify({ target: TARGET, packages: { blogwright: 1_000 } }),
      'sizes.json',
    );
    expect(parsed).toEqual({ target: TARGET, maximums: new Map([['blogwright', 1_000]]) });
  });

  it('ignores the explanatory "//" key', () => {
    const text = JSON.stringify({ '//': 'note', target: TARGET, packages: {} });
    expect(parseBaseline(text, 'sizes.json').maximums.size).toBe(0);
  });

  it('rejects text that is not JSON, naming the file', () => {
    expect(() => parseBaseline('{', 'sizes.json')).toThrow(/sizes.json is not valid JSON/);
  });

  it('rejects a missing target or packages object', () => {
    expect(() => parseBaseline(JSON.stringify({ packages: {} }), 'sizes.json')).toThrow(
      /"target" must be/,
    );
    expect(() =>
      parseBaseline(JSON.stringify({ target: TARGET, packages: [] }), 'sizes.json'),
    ).toThrow(/"packages" must be an object/);
  });

  it('rejects a maximum that is not a positive whole number of bytes', () => {
    for (const bad of [0, -1, 1.5, '1000', null]) {
      const text = JSON.stringify({ target: TARGET, packages: { blogwright: bad } });
      expect(() => parseBaseline(text, 'sizes.json')).toThrow(
        /packages.blogwright must be a positive whole number/,
      );
    }
  });
});

describe('serializeBaseline', () => {
  it('round-trips through parseBaseline with names sorted', () => {
    const text = serializeBaseline([measured('b', 2), measured('a', 1)], TARGET);
    expect(Object.keys(JSON.parse(text).packages)).toEqual(['a', 'b']);
    expect(parseBaseline(text, 'sizes.json')).toEqual(baseline({ a: 1, b: 2 }));
    expect(text.endsWith('}\n')).toBe(true);
  });
});

describe('compareToBaseline', () => {
  it('passes one byte under and exactly at the maximum', () => {
    const result = compareToBaseline(
      [measured('a', 999), measured('b', 1_000)],
      baseline({ a: 1_000, b: 1_000 }),
      TARGET,
    );
    expect(result.rows.map((row) => row.status)).toEqual(['within', 'within']);
    expect(budgetPasses(result)).toBe(true);
  });

  it('fails one byte over the maximum', () => {
    const result = compareToBaseline([measured('a', 1_001)], baseline({ a: 1_000 }), TARGET);
    expect(result.rows[0]?.status).toBe('over');
    expect(budgetPasses(result)).toBe(false);
  });

  it('passes a package that shrank well below its maximum', () => {
    const result = compareToBaseline([measured('a', 10)], baseline({ a: 1_000 }), TARGET);
    expect(budgetPasses(result)).toBe(true);
  });

  it('fails a published package with no approved maximum', () => {
    const result = compareToBaseline(
      [measured('a', 10), measured('new', 10)],
      baseline({ a: 1_000 }),
      TARGET,
    );
    expect(result.rows[1]?.status).toBe('unbudgeted');
    expect(budgetPasses(result)).toBe(false);
  });

  it('fails a baseline entry for a package that is no longer published', () => {
    const result = compareToBaseline([measured('a', 10)], baseline({ a: 1_000, gone: 5 }), TARGET);
    expect(result.stale).toEqual(['gone']);
    expect(budgetPasses(result)).toBe(false);
  });

  it('rejects a baseline measured for another platform', () => {
    const other: Baseline = { target: 'darwin-arm64-glibc', maximums: new Map() };
    expect(() => compareToBaseline([], other, TARGET)).toThrow(
      /measured for darwin-arm64-glibc .* run pnpm size:update/,
    );
  });
});
