import { dirname, join, resolve } from 'node:path';

import type { FileSystem } from 'blogwright-core';

/**
 * Locate the site repo root by walking up to the VCS directory (`.git`, which is
 * a file in worktrees, or `.jj`). The pds commands read/write repo files
 * (public/, src/) and the deploy zips `git ls-files` output, so the CLI must
 * anchor on the checkout root regardless of the invocation directory.
 */
export class RepoRootNotFoundError extends Error {
  constructor(start: string) {
    super(`could not find the repo root (no .git or .jj above ${start})`);
    this.name = 'RepoRootNotFoundError';
  }
}

export async function findRepoRoot(fs: FileSystem, start = process.cwd()): Promise<string> {
  let dir = resolve(start);
  for (;;) {
    if ((await fs.exists(join(dir, '.git'))) || (await fs.exists(join(dir, '.jj')))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new RepoRootNotFoundError(start);
    }
    dir = parent;
  }
}
