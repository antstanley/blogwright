import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Locate the repo root by walking up to the pnpm workspace file. The pds
 * commands read/write repo files (public/, src/) and must not depend on the
 * CLI being invoked from the root — `pds keygen` run from ops/ once planted
 * public/oauth/ inside the workspace.
 */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not find the repo root (no pnpm-workspace.yaml above ${start})`);
    }
    dir = parent;
  }
}
