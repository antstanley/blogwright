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
  it('walks up from a nested directory to the .git directory', async () => {
    await mkdir(join(root, '.git'));
    const nested = join(root, 'packages', 'cli');
    await mkdir(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
    expect(findRepoRoot(root)).toBe(root);
  });

  it('accepts a .git file (worktree checkout)', async () => {
    await writeFile(join(root, '.git'), 'gitdir: /elsewhere\n');
    expect(findRepoRoot(root)).toBe(root);
  });

  it('accepts a .jj repo', async () => {
    await mkdir(join(root, '.jj'));
    expect(findRepoRoot(root)).toBe(root);
  });

  it('throws when no VCS directory exists above', async () => {
    expect(() => findRepoRoot(root)).toThrow(/repo root/);
  });
});
