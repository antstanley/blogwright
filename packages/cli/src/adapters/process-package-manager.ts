/**
 * Process adapter for the PackageManager port: detects which package manager
 * governs the repo from the lockfile it wrote (read through the injected
 * FileSystem port, never node:fs), then shells out to it for add/remove. One
 * of only two modules that may import node:child_process (the other is
 * process-vcs.ts); failures are translated with the command, its arguments
 * and the directory before they cross the port, mirroring runVcsCommand.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { findRepoRoot, type FileSystem } from 'blogwright-core';

import type { AddPackageOptions, PackageManager, PackageManagerName } from '../ports.js';

const run = promisify(execFile);

/** A verbose install/uninstall can exceed the 1 MiB default buffer, same rationale as process-vcs.ts. */
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The shape of `execFile`, promisified - injectable so tests exercise command
 * construction and error translation without spawning a process. */
type ExecFileAsync = (
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

/** How each supported manager writes its lockfile and spells add/remove/dev/exact. */
interface ManagerSpec {
  readonly lockfile: string;
  readonly addVerb: string;
  readonly removeVerb: string;
  readonly devFlag: string;
  readonly exactFlag: string;
}

/**
 * The module-level table `detect` and command-building read from - a named
 * constant rather than a chain of literals at each call site. The binary
 * invoked for a manager is its own key (`pnpm`, `npm`, `yarn`, `bun`).
 */
const PACKAGE_MANAGERS: Readonly<Record<PackageManagerName, ManagerSpec>> = {
  pnpm: {
    lockfile: 'pnpm-lock.yaml',
    addVerb: 'add',
    removeVerb: 'remove',
    devFlag: '--save-dev',
    exactFlag: '--save-exact',
  },
  npm: {
    lockfile: 'package-lock.json',
    addVerb: 'install',
    removeVerb: 'uninstall',
    devFlag: '--save-dev',
    exactFlag: '--save-exact',
  },
  yarn: {
    lockfile: 'yarn.lock',
    addVerb: 'add',
    removeVerb: 'remove',
    devFlag: '--dev',
    exactFlag: '--exact',
  },
  bun: {
    lockfile: 'bun.lock',
    addVerb: 'add',
    removeVerb: 'remove',
    devFlag: '--dev',
    exactFlag: '--exact',
  },
};

/** Exported for tests, so the negative case's expected list is derived, not hand-copied. */
export const PACKAGE_MANAGER_LOCKFILES: Readonly<Record<PackageManagerName, string>> =
  Object.fromEntries(
    Object.entries(PACKAGE_MANAGERS).map(([name, spec]) => [name, spec.lockfile]),
  ) as Record<PackageManagerName, string>;

/** Probe each candidate lockfile in `repoRoot` through `fs`; first match wins. */
async function detectManager(fs: FileSystem, repoRoot: string): Promise<PackageManagerName> {
  for (const [name, spec] of Object.entries(PACKAGE_MANAGERS) as [
    PackageManagerName,
    ManagerSpec,
  ][]) {
    if (await fs.exists(join(repoRoot, spec.lockfile))) return name;
  }
  const lockfiles = Object.values(PACKAGE_MANAGERS)
    .map((spec) => spec.lockfile)
    .join(', ');
  throw new Error(`no supported package manager detected in ${repoRoot} - looked for ${lockfiles}`);
}

/** Exported for tests: the exact argument vector `add` shells out with, per manager. */
export function addArgs(
  manager: PackageManagerName,
  spec: string,
  opts: AddPackageOptions,
): string[] {
  const { addVerb, devFlag, exactFlag } = PACKAGE_MANAGERS[manager];
  const args = [addVerb, spec];
  if (opts.dev) args.push(devFlag);
  if (opts.exact) args.push(exactFlag);
  return args;
}

/** Exported for tests: the exact argument vector `remove` shells out with, per manager. */
export function removeArgs(manager: PackageManagerName, name: string): string[] {
  return [PACKAGE_MANAGERS[manager].removeVerb, name];
}

/**
 * Build the process package-manager adapter. `detect` probes `repoRoot` for
 * each candidate lockfile through `fs`; `add`/`remove` resolve their own repo
 * root (`findRepoRoot`, starting from `startDir` - `process.cwd()` in
 * production) and manager, then shell out from that directory. `runProcess`
 * and `startDir` are injectable so tests can exercise the whole add/remove
 * pipeline - repo/manager resolution, command construction, and error
 * translation - without spawning a process or depending on the real cwd.
 */
export function createProcessPackageManager(
  fs: FileSystem,
  options: { runProcess?: ExecFileAsync; startDir?: string } = {},
): PackageManager {
  const runProcess = options.runProcess ?? run;
  const startDir = options.startDir ?? process.cwd();

  async function runPackageCommand(cwd: string, command: string, args: string[]): Promise<void> {
    try {
      await runProcess(command, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES });
    } catch (err) {
      throw new Error(`${command} ${args.join(' ')} failed in ${cwd}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  async function resolveRepo(): Promise<{ repoRoot: string; manager: PackageManagerName }> {
    const repoRoot = await findRepoRoot(fs, startDir);
    const manager = await detectManager(fs, repoRoot);
    return { repoRoot, manager };
  }

  return {
    detect: (repoRoot) => detectManager(fs, repoRoot),

    async add(spec, opts = {}) {
      const { repoRoot, manager } = await resolveRepo();
      await runPackageCommand(repoRoot, manager, addArgs(manager, spec, opts));
    },

    async remove(name) {
      const { repoRoot, manager } = await resolveRepo();
      await runPackageCommand(repoRoot, manager, removeArgs(manager, name));
    },
  };
}
