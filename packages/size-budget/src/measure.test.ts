import { describe, expect, it } from 'vitest';

import { measureWorkspace } from './measure.js';
import { INSTALL_TARGET } from './platform.js';
import { createFakeRegistry, createFakeWorkspace, locked } from './test-support.js';

const fflate = locked('fflate', '0.8.3');
const bindings = locked('@duckdb/node-bindings', '1.5.5');
const darwinVariant = locked('@duckdb/node-bindings-darwin-arm64', '1.5.5');
const linuxVariant = locked('@duckdb/node-bindings-linux-x64', '1.5.5');
const core = { name: 'blogwright-core', version: 'link:../core', path: '/repo/packages/core' };

/** DuckDB-style variants as the registry publishes them. */
const duckdbRegistry = {
  '@duckdb/node-bindings-darwin-arm64@1.5.5': {
    os: ['darwin'],
    cpu: ['arm64'],
    unpackedSize: 70_000,
  },
  '@duckdb/node-bindings-linux-x64@1.5.5': { os: ['linux'], cpu: ['x64'], unpackedSize: 90_000 },
};

describe('measureWorkspace', () => {
  it('adds dependencies on disk to the package own size', async () => {
    const workspace = createFakeWorkspace({
      packages: { 'blogwright-core': 1_000 },
      dependencies: { 'blogwright-core': [fflate] },
      installed: { [fflate.path]: { size: 250 } },
    });
    const [measured] = await measureWorkspace(
      { workspace, registry: createFakeRegistry({}) },
      INSTALL_TARGET,
    );
    expect(measured).toEqual({
      name: 'blogwright-core',
      ownSize: 1_000,
      installSize: 1_250,
      dependencies: [{ id: 'fflate@0.8.3', size: 250 }],
    });
  });

  it('counts a workspace dependency at its packed size', async () => {
    const workspace = createFakeWorkspace({
      packages: { blogwright: 500, 'blogwright-core': 1_000 },
      dependencies: { blogwright: [core, fflate], 'blogwright-core': [fflate] },
      installed: { [fflate.path]: { size: 250 } },
    });
    const measured = await measureWorkspace(
      { workspace, registry: createFakeRegistry({}) },
      INSTALL_TARGET,
    );
    expect(measured.map((pkg) => [pkg.name, pkg.installSize])).toEqual([
      ['blogwright', 1_750],
      ['blogwright-core', 1_250],
    ]);
  });

  it('measures the target platform variant whichever one this host installed', async () => {
    const workspace = createFakeWorkspace({
      packages: { 'blogwright-analytics': 1_000 },
      dependencies: { 'blogwright-analytics': [bindings, darwinVariant, linuxVariant] },
      installed: {
        [bindings.path]: { size: 100 },
        // The host (a Mac) installed its own variant; the Linux one is absent.
        [darwinVariant.path]: { constraints: { os: ['darwin'], cpu: ['arm64'] }, size: 70_000 },
      },
    });
    const registry = createFakeRegistry(duckdbRegistry);
    const [measured] = await measureWorkspace({ workspace, registry }, INSTALL_TARGET);
    expect(measured?.installSize).toBe(1_000 + 100 + 90_000);
    expect(measured?.dependencies.map((dependency) => dependency.id)).toEqual([
      '@duckdb/node-bindings-linux-x64@1.5.5',
      '@duckdb/node-bindings@1.5.5',
    ]);
  });

  it('measures each shared dependency once', async () => {
    const workspace = createFakeWorkspace({
      packages: { a: 10, b: 10 },
      dependencies: { a: [linuxVariant], b: [linuxVariant] },
      installed: {},
    });
    const registry = createFakeRegistry(duckdbRegistry);
    await measureWorkspace({ workspace, registry }, INSTALL_TARGET);
    expect(registry.lookups).toEqual(['@duckdb/node-bindings-linux-x64@1.5.5']);
  });

  it('rejects a locked dependency that is missing without a platform reason', async () => {
    const workspace = createFakeWorkspace({
      packages: { 'blogwright-core': 1_000 },
      dependencies: { 'blogwright-core': [fflate] },
      installed: {},
    });
    const registry = createFakeRegistry({ 'fflate@0.8.3': { unpackedSize: 250 } });
    await expect(measureWorkspace({ workspace, registry }, INSTALL_TARGET)).rejects.toThrow(
      /fflate@0.8.3 is in the lockfile but not installed .* run pnpm install/,
    );
  });

  it('rejects a target variant the registry publishes no size for', async () => {
    const workspace = createFakeWorkspace({
      packages: { 'blogwright-analytics': 1_000 },
      dependencies: { 'blogwright-analytics': [linuxVariant] },
      installed: {},
    });
    const registry = createFakeRegistry({
      '@duckdb/node-bindings-linux-x64@1.5.5': {
        os: ['linux'],
        cpu: ['x64'],
        unpackedSize: undefined,
      },
    });
    await expect(measureWorkspace({ workspace, registry }, INSTALL_TARGET)).rejects.toThrow(
      /publishes no unpacked size for @duckdb\/node-bindings-linux-x64@1.5.5/,
    );
  });

  it('rejects a workspace dependency that is not published', async () => {
    const workspace = createFakeWorkspace({
      packages: { blogwright: 500 },
      dependencies: { blogwright: [core] },
      installed: {},
    });
    await expect(
      measureWorkspace({ workspace, registry: createFakeRegistry({}) }, INSTALL_TARGET),
    ).rejects.toThrow(
      /blogwright-core is a workspace dependency of a published package but is not published/,
    );
  });
});
