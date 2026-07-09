import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRepoRoot } from './repo-root.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'repo-root-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findRepoRoot', () => {
  it('walks up from a nested directory to the workspace file', async () => {
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n');
    const nested = join(root, 'ops', 'cli');
    await mkdir(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
    expect(findRepoRoot(root)).toBe(root);
  });

  it('throws when no workspace file exists above', async () => {
    expect(() => findRepoRoot(root)).toThrow(/repo root/);
  });
});
