import { createMemoryFileSystem, createNodeFileSystem, type FileSystem } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  TRANSFORM_BUNDLE_DIR,
  TRANSFORM_BUNDLE_FILE,
  transformSourceHash,
  transformZipKey,
} from './transform-hash.js';

const ROOT = '/workspace';

/** The analytics package root inside a synthetic workspace at `root`. */
function analyticsDir(root: string): string {
  return `${root}/packages/analytics`;
}

/**
 * A synthetic workspace carrying one file per input `transformSourceHash`
 * reads, so a test can change exactly one of them and watch the hash move.
 * Keys are absolute paths; `overrides` replaces a file's content or adds a new
 * one, and every test that adds a file asserts the file count it expects, so a
 * key that silently collides with a base entry cannot pass unnoticed.
 */
function workspace(root: string, overrides: Record<string, string> = {}): Record<string, string> {
  const pkg = analyticsDir(root);
  const core = `${root}/packages/core`;
  return {
    [`${pkg}/src/index.ts`]: "export const ANALYTICS_NAMESPACE = 'analytics';\n",
    [`${pkg}/src/transform/handler.ts`]: 'export function createTransformHandler() {}\n',
    [`${pkg}/src/transform/map-record.ts`]: '// maps one record\nexport function mapRecord() {}\n',
    [`${pkg}/src/transform/entry.ts`]: 'export const handler = 1;\n',
    [`${pkg}/src/transform/rolldown.config.ts`]: 'export default [];\n',
    [`${pkg}/src/transform/map-record.test.ts`]: "it('maps', () => {});\n",
    [`${pkg}/package.json`]: '{ "name": "blogwright-analytics" }\n',
    [`${pkg}/tsconfig.json`]: '{ "extends": "../../tsconfig.base.json" }\n',
    [`${core}/src/index.ts`]: "export * from './aws/signer.js';\n",
    [`${core}/src/aws/signer.ts`]: 'export class SigningClient {}\n',
    [`${core}/package.json`]: '{ "name": "blogwright-core" }\n',
    [`${root}/tsconfig.base.json`]: '{ "compilerOptions": { "strict": true } }\n',
    [`${root}/pnpm-lock.yaml`]: "lockfileVersion: '9.0'\n",
    ...overrides,
  };
}

/** How many files the base workspace holds, so an "added file" case can prove it added one. */
const BASE_FILE_COUNT = Object.keys(workspace(ROOT)).length;

/** Hash a synthetic workspace through the in-memory adapter. */
function hashOf(files: Record<string, string>, root = ROOT): Promise<string> {
  return transformSourceHash(analyticsDir(root), createMemoryFileSystem(files));
}

/**
 * Hash the base workspace with exactly one file replaced or added, asserting
 * the change landed: an override key that did not match a base key (a typo, a
 * moved file) would otherwise "change the hash" for the wrong reason, and an
 * override meant to add a file that silently replaced one would go unnoticed.
 */
async function hashWithChange(
  path: string,
  content: string,
  expected: 'replaced' | 'added',
): Promise<string> {
  const base = workspace(ROOT);
  expect(Object.hasOwn(base, path)).toBe(expected === 'replaced');
  const changed = workspace(ROOT, { [path]: content });
  expect(Object.keys(changed)).toHaveLength(
    expected === 'replaced' ? BASE_FILE_COUNT : BASE_FILE_COUNT + 1,
  );
  return hashOf(changed);
}

/**
 * The same files, listed back to front. The port contracts `listFiles` to
 * return sorted paths and both shipped adapters honour it, but the hash must
 * not lean on that: this wrapper proves the codepoint sort inside
 * `transformSourceHash` is what fixes the digest order.
 */
function reversedListing(fs: FileSystem): FileSystem {
  return {
    ...fs,
    async listFiles(dir: string): Promise<string[]> {
      return (await fs.listFiles(dir)).reverse();
    },
  };
}

describe('transformSourceHash', () => {
  it('is twelve lowercase hex characters', async () => {
    expect(await hashOf(workspace(ROOT))).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is byte-stable across two runs over identical source', async () => {
    const first = await hashOf(workspace(ROOT));
    const second = await hashOf(workspace(ROOT));

    expect(second).toBe(first);
  });

  it('does not move when the same source sits at a different absolute path', async () => {
    const here = await hashOf(workspace(ROOT), ROOT);
    const elsewhere = await hashOf(
      workspace('/somewhere/else/checkout'),
      '/somewhere/else/checkout',
    );

    // A hash that carried absolute paths would key identical code under a
    // different zip on every machine that checked the repo out somewhere new.
    expect(elsewhere).toBe(here);
  });

  it('does not move when the file listing comes back in a different order', async () => {
    const files = workspace(ROOT);
    const sorted = await transformSourceHash(analyticsDir(ROOT), createMemoryFileSystem(files));
    const reversed = await transformSourceHash(
      analyticsDir(ROOT),
      reversedListing(createMemoryFileSystem(files)),
    );

    expect(reversed).toBe(sorted);
  });

  it('changes when a single source byte changes', async () => {
    const before = await hashOf(workspace(ROOT));
    const after = await hashWithChange(
      `${analyticsDir(ROOT)}/src/transform/map-record.ts`,
      '// Maps one record\nexport function mapRecord() {}\n',
      'replaced',
    );

    expect(after).not.toBe(before);
  });

  it('changes when a file is renamed but its bytes are not', async () => {
    const before = await hashOf(workspace(ROOT));
    const renamed = workspace(ROOT);
    const moved = renamed[`${analyticsDir(ROOT)}/src/transform/map-record.ts`];
    delete renamed[`${analyticsDir(ROOT)}/src/transform/map-record.ts`];
    renamed[`${analyticsDir(ROOT)}/src/transform/map-row.ts`] = moved as string;

    // The label goes into the digest ahead of the bytes, so a rename is a change.
    expect(await hashOf(renamed)).not.toBe(before);
  });

  it.each([
    [
      'the rolldown config',
      `${analyticsDir(ROOT)}/src/transform/rolldown.config.ts`,
      'export default [{}];\n',
    ],
    [
      'the package tsconfig',
      `${analyticsDir(ROOT)}/tsconfig.json`,
      '{ "extends": "../../tsconfig.base.json", "compilerOptions": {} }\n',
    ],
    [
      'the package manifest',
      `${analyticsDir(ROOT)}/package.json`,
      '{ "name": "blogwright-analytics", "version": "0.4.0" }\n',
    ],
    [
      'core source the bundle inlines',
      `${ROOT}/packages/core/src/aws/signer.ts`,
      'export class SigningClient { region = 1; }\n',
    ],
    [
      'the core manifest',
      `${ROOT}/packages/core/package.json`,
      '{ "name": "blogwright-core", "version": "0.4.0" }\n',
    ],
    [
      'the workspace tsconfig',
      `${ROOT}/tsconfig.base.json`,
      '{ "compilerOptions": { "strict": false } }\n',
    ],
    ['the lockfile', `${ROOT}/pnpm-lock.yaml`, "lockfileVersion: '9.0'\nsettings: {}\n"],
  ])('changes when %s changes', async (_label, path, content) => {
    const before = await hashOf(workspace(ROOT));

    expect(await hashWithChange(path, content, 'replaced')).not.toBe(before);
  });

  it('ignores the built bundle, so the hash keys source rather than bundler output', async () => {
    const before = await hashOf(workspace(ROOT));
    const withBundle = await hashWithChange(
      `${analyticsDir(ROOT)}/${TRANSFORM_BUNDLE_DIR}/${TRANSFORM_BUNDLE_FILE}`,
      'export const handler = () => {};\n',
      'added',
    );

    // DEVELOPMENT.md §Repository hygiene: bundler output varies by platform, so
    // hashing it would redeploy the same code from a different machine.
    expect(withBundle).toBe(before);
  });

  it('ignores a changed test file, which is never bundled', async () => {
    const before = await hashOf(workspace(ROOT));
    const after = await hashWithChange(
      `${analyticsDir(ROOT)}/src/transform/map-record.test.ts`,
      "it('maps every field', () => {});\n",
      'replaced',
    );

    expect(after).toBe(before);
  });

  it('ignores a new test file', async () => {
    const before = await hashOf(workspace(ROOT));
    const after = await hashWithChange(
      `${analyticsDir(ROOT)}/src/transform/entry.test.ts`,
      "it('exports a handler', () => {});\n",
      'added',
    );

    expect(after).toBe(before);
  });

  it('is byte-stable across two runs over this repository, read from real disk', async () => {
    const fs = createNodeFileSystem();
    const first = await transformSourceHash(process.cwd(), fs);
    const second = await transformSourceHash(process.cwd(), fs);

    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(second).toBe(first);
  });
});

describe('transformZipKey', () => {
  it('derives one key per hash and embeds it', () => {
    expect(transformZipKey('abcdef012345')).toBe('analytics/transform/transform-abcdef012345.zip');
  });

  it('gives the same key for the same hash and a different key for a different hash', () => {
    expect(transformZipKey('0123456789ab')).toBe(transformZipKey('0123456789ab'));
    expect(transformZipKey('0123456789ab')).not.toBe(transformZipKey('0123456789ac'));
  });

  it('turns the hash the build actually produced into a key', async () => {
    const hash = await hashOf(workspace(ROOT));

    expect(transformZipKey(hash)).toBe(`analytics/transform/transform-${hash}.zip`);
  });

  it.each([
    ['nothing', ''],
    ['a stringified undefined', 'undefined'],
    ['uppercase hex', '72ABFA246E99'],
    ['too few characters', '72abfa246e9'],
    ['too many characters', '72abfa246e999'],
    ['a non-hex character', '72abfa246e9z'],
  ])('refuses %s rather than keying the function under it', (_label, hash) => {
    expect(() => transformZipKey(hash)).toThrow(/source hash must be 12 lowercase hex characters/);
  });

  it('names the rejected value so the operator can see what it read', () => {
    expect(() => transformZipKey('undefined')).toThrow(/"undefined"/);
  });
});
