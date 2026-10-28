import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPnpmWorkspace } from './pnpm-workspace.js';

/**
 * A miniature pnpm layout on disk: workspace packages under `packages/`, each
 * store package at `node_modules/.pnpm/<id>/node_modules/<name>` with its own
 * dependencies symlinked beside it, as pnpm installs them.
 */
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'size-budget-test-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

function storeDir(name: string, version: string): string {
  return join(root, 'node_modules/.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules');
}

/** Install a store package with `files` (name to content) and the given manifest fields. */
async function storePackage(
  name: string,
  version: string,
  manifest: Record<string, unknown> = {},
  files: Record<string, string> = {},
): Promise<string> {
  const dir = join(storeDir(name, version), name);
  await writeJson(join(dir, 'package.json'), { name, version, ...manifest });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), content);
  }
  return dir;
}

/** Symlink `target` into `fromDir/node_modules/<name>`. */
async function link(fromDir: string, name: string, target: string): Promise<void> {
  const path = join(fromDir, 'node_modules', name);
  await mkdir(join(path, '..'), { recursive: true });
  await symlink(target, path);
}

async function workspacePackage(name: string, manifest: Record<string, unknown>): Promise<string> {
  const dir = join(root, 'packages', name);
  await writeJson(join(dir, 'package.json'), { name, version: '1.0.0', ...manifest });
  return dir;
}

describe('createPnpmWorkspace productionDependencies', () => {
  it('walks transitive dependencies through the store, once per real path', async () => {
    const leaf = await storePackage('leaf', '1.0.0');
    const middle = await storePackage('@scope/middle', '2.0.0', { dependencies: { leaf: '^1' } });
    // pnpm puts a store package's dependencies beside it, in the same node_modules.
    await link(join(storeDir('@scope/middle', '2.0.0'), '..'), 'leaf', leaf);
    const app = await workspacePackage('app', {
      dependencies: { '@scope/middle': '^2', leaf: '^1' },
      devDependencies: { ignored: '^1' },
    });
    await link(app, '@scope/middle', middle);
    await link(app, 'leaf', leaf);

    const dependencies = await createPnpmWorkspace(root).productionDependencies({
      name: 'app',
      dir: app,
    });
    expect(
      dependencies.map((dependency) => `${dependency.name}@${dependency.version}`).sort(),
    ).toEqual(['@scope/middle@2.0.0', 'leaf@1.0.0']);
  });

  it('versions a workspace dependency as a link and walks into it', async () => {
    const leaf = await storePackage('leaf', '1.0.0');
    const core = await workspacePackage('core', { dependencies: { leaf: '^1' } });
    await link(core, 'leaf', leaf);
    const cli = await workspacePackage('cli', { dependencies: { core: 'workspace:*' } });
    await link(cli, 'core', core);

    const dependencies = await createPnpmWorkspace(root).productionDependencies({
      name: 'cli',
      dir: cli,
    });
    expect(dependencies.map((dependency) => dependency.version).sort()).toEqual([
      '1.0.0',
      'link:packages/core',
    ]);
  });

  it('keeps an optional variant this host skipped, at its exact version', async () => {
    const bindings = await storePackage('bindings', '1.5.5', {
      optionalDependencies: { 'bindings-linux-x64': '1.5.5' },
    });
    const app = await workspacePackage('app', { dependencies: { bindings: '1.5.5' } });
    await link(app, 'bindings', bindings);

    const dependencies = await createPnpmWorkspace(root).productionDependencies({
      name: 'app',
      dir: app,
    });
    expect(dependencies).toContainEqual({
      name: 'bindings-linux-x64',
      version: '1.5.5',
      path: join(storeDir('bindings-linux-x64', '1.5.5'), 'bindings-linux-x64'),
    });
  });

  it('rejects a skipped optional dependency declared with a range', async () => {
    const bindings = await storePackage('bindings', '1.5.5', {
      optionalDependencies: { 'bindings-linux-x64': '^1.5.5' },
    });
    const app = await workspacePackage('app', { dependencies: { bindings: '1.5.5' } });
    await link(app, 'bindings', bindings);

    await expect(
      createPnpmWorkspace(root).productionDependencies({ name: 'app', dir: app }),
    ).rejects.toThrow(/bindings-linux-x64.* "\^1.5.5" is a range/);
  });

  it('rejects a required dependency that is not installed', async () => {
    const app = await workspacePackage('app', { dependencies: { missing: '^1' } });
    await expect(
      createPnpmWorkspace(root).productionDependencies({ name: 'app', dir: app }),
    ).rejects.toThrow(/missing, a dependency of .* is not installed - run pnpm install/);
  });
});

describe('createPnpmWorkspace installedConstraints and directorySize', () => {
  it('reads platform constraints, or undefined where nothing is installed', async () => {
    const variant = await storePackage('variant', '1.0.0', { os: ['darwin'], cpu: ['arm64'] });
    const workspace = createPnpmWorkspace(root);
    expect(await workspace.installedConstraints(variant)).toEqual({
      os: ['darwin'],
      cpu: ['arm64'],
    });
    expect(await workspace.installedConstraints(join(root, 'absent'))).toBeUndefined();
  });

  it('sums regular files recursively without following symlinks', async () => {
    const dir = await storePackage('sized', '1.0.0', {}, { 'a.js': 'xxxx', 'lib/b.js': 'yy' });
    await symlink(join(dir, 'a.js'), join(dir, 'alias.js'));
    const manifestSize = JSON.stringify({ name: 'sized', version: '1.0.0' }).length;
    expect(await createPnpmWorkspace(root).directorySize(dir)).toBe(manifestSize + 6);
  });
});
