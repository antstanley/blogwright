/**
 * Tests for the PackageManager process adapter. `detect` is exercised over an
 * in-memory FileSystem; `add`/`remove` are exercised through an injected
 * `runProcess` fake and a fixed `startDir`, so the whole pipeline - repo and
 * manager resolution, command construction, error translation - is covered
 * without ever spawning a real process.
 */

import { describe, expect, it } from 'vitest';

import { createMemoryFileSystem } from 'blogwright-core';

import type { PackageManagerName } from '../ports.js';
import {
  addArgs,
  createProcessPackageManager,
  MAX_OUTPUT_BYTES,
  PACKAGE_MANAGER_LOCKFILES,
  removeArgs,
} from './process-package-manager.js';

const REPO_ROOT = '/repo';

/** Await `promise`, returning the rejection as a narrowed `Error` - never a cast. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error) return err;
    throw err;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('createProcessPackageManager.detect', () => {
  it.each(Object.entries(PACKAGE_MANAGER_LOCKFILES) as [PackageManagerName, string][])(
    'detects %s from its lockfile',
    async (manager, lockfile) => {
      const fs = createMemoryFileSystem({ [`${REPO_ROOT}/${lockfile}`]: '' });
      const packageManager = createProcessPackageManager(fs);

      await expect(packageManager.detect(REPO_ROOT)).resolves.toBe(manager);
    },
  );

  it('raises naming the repo root and every lockfile it looked for when none matches', async () => {
    const fs = createMemoryFileSystem({ [`${REPO_ROOT}/README.md`]: 'hello' });
    const packageManager = createProcessPackageManager(fs);

    await expect(packageManager.detect(REPO_ROOT)).rejects.toThrow(REPO_ROOT);
    for (const lockfile of Object.values(PACKAGE_MANAGER_LOCKFILES)) {
      await expect(packageManager.detect(REPO_ROOT)).rejects.toThrow(lockfile);
    }
  });
});

describe('addArgs', () => {
  it.each([
    ['pnpm', 'add'],
    ['npm', 'install'],
    ['yarn', 'add'],
    ['bun', 'add'],
  ] as [PackageManagerName, string][])('%s: no options installs plainly', (manager, verb) => {
    expect(addArgs(manager, 'blogwright-analytics', {})).toEqual([verb, 'blogwright-analytics']);
  });

  it('pnpm/npm spell dev and exact with --save- flags', () => {
    expect(addArgs('pnpm', 'pkg', { dev: true })).toEqual(['add', 'pkg', '--save-dev']);
    expect(addArgs('pnpm', 'pkg', { exact: true })).toEqual(['add', 'pkg', '--save-exact']);
    expect(addArgs('pnpm', 'pkg', { dev: true, exact: true })).toEqual([
      'add',
      'pkg',
      '--save-dev',
      '--save-exact',
    ]);
    expect(addArgs('npm', 'pkg', { dev: true })).toEqual(['install', 'pkg', '--save-dev']);
    expect(addArgs('npm', 'pkg', { exact: true })).toEqual(['install', 'pkg', '--save-exact']);
    expect(addArgs('npm', 'pkg', { dev: true, exact: true })).toEqual([
      'install',
      'pkg',
      '--save-dev',
      '--save-exact',
    ]);
  });

  it('yarn/bun spell dev and exact with bare flags', () => {
    expect(addArgs('yarn', 'pkg', { dev: true })).toEqual(['add', 'pkg', '--dev']);
    expect(addArgs('yarn', 'pkg', { exact: true })).toEqual(['add', 'pkg', '--exact']);
    expect(addArgs('yarn', 'pkg', { dev: true, exact: true })).toEqual([
      'add',
      'pkg',
      '--dev',
      '--exact',
    ]);
    expect(addArgs('bun', 'pkg', { dev: true })).toEqual(['add', 'pkg', '--dev']);
    expect(addArgs('bun', 'pkg', { exact: true })).toEqual(['add', 'pkg', '--exact']);
    expect(addArgs('bun', 'pkg', { dev: true, exact: true })).toEqual([
      'add',
      'pkg',
      '--dev',
      '--exact',
    ]);
  });
});

describe('removeArgs', () => {
  it.each([
    ['pnpm', 'remove'],
    ['npm', 'uninstall'],
    ['yarn', 'remove'],
    ['bun', 'remove'],
  ] as [PackageManagerName, string][])('%s uses %s', (manager, verb) => {
    expect(removeArgs(manager, 'blogwright-analytics')).toEqual([verb, 'blogwright-analytics']);
  });
});

describe('createProcessPackageManager add/remove', () => {
  interface RecordedRun {
    command: string;
    args: string[];
    options: { cwd: string; maxBuffer: number };
  }

  function fsWithLockfile(lockfile: string): ReturnType<typeof createMemoryFileSystem> {
    return createMemoryFileSystem({
      [`${REPO_ROOT}/.git`]: '',
      [`${REPO_ROOT}/${lockfile}`]: '',
    });
  }

  it('resolves the repo root and manager, then runs the constructed command from there', async () => {
    const fs = fsWithLockfile('pnpm-lock.yaml');
    const runs: RecordedRun[] = [];
    const packageManager = createProcessPackageManager(fs, {
      startDir: REPO_ROOT,
      runProcess: async (command, args, opts) => {
        runs.push({ command, args, options: opts });
        return { stdout: '', stderr: '' };
      },
    });

    await packageManager.add('blogwright-analytics', { dev: true });
    await packageManager.remove('blogwright-pds');

    expect(runs).toEqual([
      {
        command: 'pnpm',
        args: ['add', 'blogwright-analytics', '--save-dev'],
        options: { cwd: REPO_ROOT, maxBuffer: MAX_OUTPUT_BYTES },
      },
      {
        command: 'pnpm',
        args: ['remove', 'blogwright-pds'],
        options: { cwd: REPO_ROOT, maxBuffer: MAX_OUTPUT_BYTES },
      },
    ]);
  });

  it('picks the manager detected at the resolved repo root, not a hardcoded default', async () => {
    const fs = fsWithLockfile('yarn.lock');
    const runs: RecordedRun[] = [];
    const packageManager = createProcessPackageManager(fs, {
      startDir: REPO_ROOT,
      runProcess: async (command, args, opts) => {
        runs.push({ command, args, options: opts });
        return { stdout: '', stderr: '' };
      },
    });

    await packageManager.add('blogwright-analytics');

    expect(runs).toEqual([
      {
        command: 'yarn',
        args: ['add', 'blogwright-analytics'],
        options: { cwd: REPO_ROOT, maxBuffer: MAX_OUTPUT_BYTES },
      },
    ]);
  });

  it('translates a failure into an Error naming the command, arguments and directory, with cause set', async () => {
    const fs = fsWithLockfile('package-lock.json');
    const cause = new Error('ENOENT: no such file or directory');
    const packageManager = createProcessPackageManager(fs, {
      startDir: REPO_ROOT,
      runProcess: async () => {
        throw cause;
      },
    });

    const failure = await rejection(packageManager.remove('blogwright-analytics'));

    expect(failure.message).toBe(
      `npm uninstall blogwright-analytics failed in ${REPO_ROOT}: ${cause.message}`,
    );
    expect(failure.cause).toBe(cause);
  });

  it('propagates the repo-root/detect failure when no lockfile is found', async () => {
    const fs = createMemoryFileSystem({ [`${REPO_ROOT}/.git`]: '' });
    const packageManager = createProcessPackageManager(fs, {
      startDir: REPO_ROOT,
      runProcess: async () => ({ stdout: '', stderr: '' }),
    });

    await expect(packageManager.add('blogwright-analytics')).rejects.toThrow(
      /no supported package manager detected/,
    );
  });
});
