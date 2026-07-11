import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Locate the site repo root by walking up to the VCS directory (`.git`, which is
 * a file in worktrees, or `.jj`). The pds commands read/write repo files
 * (public/, src/) and the deploy zips `git ls-files` output, so the CLI must
 * anchor on the checkout root regardless of the invocation directory.
 */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.jj'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not find the repo root (no .git or .jj above ${start})`);
    }
    dir = parent;
  }
}
