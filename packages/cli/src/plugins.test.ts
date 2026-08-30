/**
 * Tests for `discover`. Every case but the three integration `describe`
 * blocks at the END of this file runs over a
 * Map-backed `FileSystem` (`createMemoryFileSystem`) and a map-backed
 * `ModuleLoader` fake (`createFakeModuleLoader`, below) - no disk or registry
 * access. Those three are the deliberate exception: they exercise the REAL
 * `ModuleLoader` adapter (`createNodeModuleLoader`) and the real `FileSystem`
 * adapter against actual files on disk, because Node's `exports`
 * encapsulation is invisible to a map-backed fake - a fake has no `exports`
 * map to enforce, so it cannot reproduce `ERR_PACKAGE_PATH_NOT_EXPORTED` -
 * and because the bundled `blogwright-pds` plugin (task 26) is only really
 * discoverable if its published manifest, its `exports` map and its default
 * export all line up, which no fake can tell you.
 * The last of the three reaches past `discover` into `runPluginNamespace`
 * (`plugin-commands.ts`) for `blogwright plugin list`: that command is where
 * the same real-disk discovery becomes something a human reads, and this
 * task's `Reviewable:` line runs `vitest run plugins`, which matches this
 * file and not `plugin-commands.test.ts`. Every other `plugin list` case -
 * the ones pinning the RENDERING - stays there, over fixtures.
 * Without these integration cases, the whole discovery path could pass every
 * fake-backed test here and still fail for every real install. Fixtures are
 * built through `ports.fs.writeText` (which creates parent directories as
 * needed) rather than `node:fs` directly, so this file - outside
 * `adapters/**` - stays within the `no-restricted-imports` boundary the rest
 * of the CLI's domain code follows.
 */

import { join } from 'node:path';

import {
  createMemoryFileSystem,
  createNodeFileSystem,
  createScriptedTerminal,
  findRepoRoot,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { createNodeModuleLoader } from './adapters/node-module-loader.js';
import { cliPackageDir } from './context.js';
import { createLogger } from './logger.js';
import { runPluginNamespace } from './plugin-commands.js';
import { discover } from './plugins.js';
import type { ModuleLoader, ModuleResolution } from './ports.js';
import { makeTempDir, removeTempDir } from './test-support.js';

const REPO_ROOT = '/repo';
const CLI_DIR = '/cli-pkg';

/** A minimal, `validatePlugin`-passing module shape, as `ports.loader.load` would return it. */
function validPluginModule(name: string): unknown {
  return {
    default: {
      name,
      description: `the ${name} plugin`,
      commands: [{ action: 'sync', summary: 'sync it', run: async () => undefined }],
    },
  };
}

interface FakeInstalledPackage {
  specifier: string;
  fromDir: string;
  packageJsonPath: string;
  entryPath: string;
  module: unknown;
}

/**
 * A map-backed `ModuleLoader` fake, keyed by `(specifier, fromDir)` pairs so
 * tests can assert a candidate was resolved from its own directory, not just
 * by name. Every call is recorded, so a test can assert a specifier was
 * never handed to the resolver at all (the bare `blogwright` specifier,
 * `<name>/package.json`, and every non-matching dependency name).
 */
function createFakeModuleLoader(installed: FakeInstalledPackage[]): ModuleLoader & {
  readonly resolveCalls: { specifier: string; fromDir: string }[];
  readonly packageJsonPathForCalls: { specifier: string; fromDir: string }[];
  readonly loadCalls: string[];
} {
  const resolveCalls: { specifier: string; fromDir: string }[] = [];
  const packageJsonPathForCalls: { specifier: string; fromDir: string }[] = [];
  const loadCalls: string[] = [];

  function find(specifier: string, fromDir: string): FakeInstalledPackage | undefined {
    return installed.find((pkg) => pkg.specifier === specifier && pkg.fromDir === fromDir);
  }

  return {
    resolveCalls,
    packageJsonPathForCalls,
    loadCalls,
    async resolve(specifier, fromDir): Promise<ModuleResolution> {
      resolveCalls.push({ specifier, fromDir });
      const pkg = find(specifier, fromDir);
      return pkg ? { found: true, path: pkg.entryPath } : { found: false };
    },
    async packageJsonPathFor(specifier, fromDir): Promise<ModuleResolution> {
      packageJsonPathForCalls.push({ specifier, fromDir });
      const pkg = find(specifier, fromDir);
      return pkg ? { found: true, path: pkg.packageJsonPath } : { found: false };
    },
    async load(path): Promise<unknown> {
      loadCalls.push(path);
      const pkg = installed.find((candidate) => candidate.entryPath === path);
      if (!pkg) throw new Error(`fake loader: no module registered at ${path}`);
      return pkg.module;
    },
  };
}

describe('discover - repo-level preconditions', () => {
  it('raises naming the path when <repoRoot>/package.json is absent', async () => {
    const fs = createMemoryFileSystem({ [`${CLI_DIR}/package.json`]: '{}' });
    const loader = createFakeModuleLoader([]);
    await expect(discover(REPO_ROOT, CLI_DIR, { fs, loader })).rejects.toThrow(
      new RegExp(`${REPO_ROOT}/package\\.json`),
    );
  });

  it('raises when <repoRoot>/package.json is not valid JSON, before any candidate is resolved', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: '{ this is not json',
      [`${CLI_DIR}/package.json`]: '{}',
    });
    const loader = createFakeModuleLoader([]);
    await expect(discover(REPO_ROOT, CLI_DIR, { fs, loader })).rejects.toThrow(
      new RegExp(`${REPO_ROOT}/package\\.json`),
    );
    expect(loader.packageJsonPathForCalls).toEqual([]);
    expect(loader.resolveCalls).toEqual([]);
  });

  it("raises naming the path when the CLI's own package.json is absent", async () => {
    const fs = createMemoryFileSystem({ [`${REPO_ROOT}/package.json`]: '{}' });
    const loader = createFakeModuleLoader([]);
    await expect(discover(REPO_ROOT, CLI_DIR, { fs, loader })).rejects.toThrow(
      new RegExp(`${CLI_DIR}/package\\.json`),
    );
  });
});

describe('discover - candidate selection', () => {
  it('never resolves a non-matching dependency name through the loader', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'some-lib': '^1.0.0', react: '^18.0.0' },
        devDependencies: { 'another-lib': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: JSON.stringify({
        dependencies: {},
        devDependencies: { typescript: '^6.0.0' },
      }),
    });
    const loader = createFakeModuleLoader([]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result).toEqual({ plugins: [], installed: [], failures: [] });
    expect(loader.packageJsonPathForCalls).toEqual([]);
    expect(loader.resolveCalls).toEqual([]);
  });

  it('considers both dependencies and devDependencies, filtered to the blogwright- prefix', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-a': '^1.0.0' },
        devDependencies: { 'blogwright-b': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/a/package.json': JSON.stringify({ name: 'blogwright-a' }), // no blogwright field
      '/b/package.json': JSON.stringify({ name: 'blogwright-b' }), // no blogwright field
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-a',
        fromDir: REPO_ROOT,
        packageJsonPath: '/a/package.json',
        entryPath: '/a/index.js',
        module: {},
      },
      {
        specifier: 'blogwright-b',
        fromDir: REPO_ROOT,
        packageJsonPath: '/b/package.json',
        entryPath: '/b/index.js',
        module: {},
      },
    ]);

    await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    const resolvedSpecifiers = loader.packageJsonPathForCalls.map((call) => call.specifier).sort();
    expect(resolvedSpecifiers).toEqual(['blogwright-a', 'blogwright-b']);
  });

  it('never hands the resolver the bare "blogwright" specifier, and discovers a bundled plugin from a consumer package.json listing only "blogwright"', async () => {
    const fs = createMemoryFileSystem({
      // The consuming repo depends on "blogwright" itself - not on
      // "blogwright-pds" - which is exactly why a consumer-only scan would
      // find nothing.
      [`${REPO_ROOT}/package.json`]: JSON.stringify({ dependencies: { blogwright: '^1.0.0' } }),
      [`${CLI_DIR}/package.json`]: JSON.stringify({ dependencies: { 'blogwright-pds': '^1.0.0' } }),
      '/bundled/blogwright-pds/package.json': JSON.stringify({
        name: 'blogwright-pds',
        blogwright: { plugin: 'pds' },
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-pds',
        fromDir: CLI_DIR,
        packageJsonPath: '/bundled/blogwright-pds/package.json',
        entryPath: '/bundled/blogwright-pds/index.js',
        module: validPluginModule('pds'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.failures).toEqual([]);
    expect(result.plugins.map((p) => p.name)).toEqual(['pds']);
    // Resolved from the CLI's own directory, never from the consumer root.
    expect(loader.packageJsonPathForCalls).toContainEqual({
      specifier: 'blogwright-pds',
      fromDir: CLI_DIR,
    });
    expect(
      loader.packageJsonPathForCalls.some(
        (call) => call.specifier === 'blogwright-pds' && call.fromDir === REPO_ROOT,
      ),
    ).toBe(false);
    // The bare "blogwright" specifier - and by construction, never
    // "blogwright/package.json" either, since this fake is only ever asked
    // for bare specifiers - is never handed to the resolver.
    expect(loader.resolveCalls.some((call) => call.specifier === 'blogwright')).toBe(false);
    expect(loader.packageJsonPathForCalls.some((call) => call.specifier === 'blogwright')).toBe(
      false,
    );
  });

  it('skips a declared dependency that cannot be resolved (not actually installed), reporting no failure', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-ghost': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
    });
    const loader = createFakeModuleLoader([]); // nothing actually installed

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result).toEqual({ plugins: [], installed: [], failures: [] });
  });

  it('falls through to the CLI-bundled copy when the consumer declares the plugin but cannot resolve it', async () => {
    // The consumer's package.json names the plugin, but it is not installed
    // there - a pruned devDependency, `pnpm install --prod`, or a manifest
    // edited before install. The CLI's bundled copy IS installed. Deduping on
    // DECLARATION would suppress the working copy and report nothing at all:
    // no plugin, no failure, so `blogwright plugin list` shows neither. That is
    // exactly the silence the two-source union exists to prevent, which is why
    // discover() skips a duplicate only once the first entry has RESOLVED.
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-pruned': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-pruned': '^1.0.0' },
      }),
      '/pruned/package.json': JSON.stringify({
        name: 'blogwright-pruned',
        blogwright: { plugin: 'pruned' },
      }),
    });
    // Registered ONLY from the CLI directory: resolution from REPO_ROOT fails.
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-pruned',
        fromDir: CLI_DIR,
        packageJsonPath: '/pruned/package.json',
        entryPath: '/pruned/index.js',
        module: validPluginModule('pruned'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.plugins.map((p) => p.name)).toEqual(['pruned']);
    expect(result.failures).toEqual([]);
  });

  it('resolves a package listed in both the consumer and CLI-bundled manifests only once, from the consumer half, not as a duplicate of itself', async () => {
    // A pnpm install commonly hoists one package to a location resolvable
    // from either directory, so both the consuming repo and the CLI's own
    // package.json can legitimately list the same blogwright-* dependency -
    // `blogwright plugin add` (task 18) is the natural way a user creates
    // exactly this arrangement by pinning a plugin alongside `blogwright`.
    // That is one installed package, not two, so it must be probed once.
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-both': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-both': '^1.0.0' },
      }),
      '/both/package.json': JSON.stringify({
        name: 'blogwright-both',
        blogwright: { plugin: 'both' },
      }),
    });
    const loader = createFakeModuleLoader([
      // Registered as resolvable from BOTH directories, mirroring a real
      // hoisted install - if collectCandidates ever stopped deduping, both
      // of these would be probed and loaded, producing two LoadedPlugin
      // entries with the same packageName that reject each other as
      // "duplicates".
      {
        specifier: 'blogwright-both',
        fromDir: REPO_ROOT,
        packageJsonPath: '/both/package.json',
        entryPath: '/both/index.js',
        module: validPluginModule('both'),
      },
      {
        specifier: 'blogwright-both',
        fromDir: CLI_DIR,
        packageJsonPath: '/both/package.json',
        entryPath: '/both/index.js',
        module: validPluginModule('both'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.failures).toEqual([]);
    expect(result.plugins.map((p) => p.name)).toEqual(['both']);
    // Probed exactly once, from the consumer half - the CLI-bundled half is
    // never even asked for it.
    expect(loader.packageJsonPathForCalls).toEqual([
      { specifier: 'blogwright-both', fromDir: REPO_ROOT },
    ]);
    expect(loader.resolveCalls).toEqual([{ specifier: 'blogwright-both', fromDir: REPO_ROOT }]);
  });
});

describe('discover - manifest handling', () => {
  it('skips a candidate with no "blogwright" field silently, with no failure and no load', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-notaplugin': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/notaplugin/package.json': JSON.stringify({
        name: 'blogwright-notaplugin',
        version: '1.0.0',
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-notaplugin',
        fromDir: REPO_ROOT,
        packageJsonPath: '/notaplugin/package.json',
        entryPath: '/notaplugin/index.js',
        module: validPluginModule('notaplugin'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result).toEqual({ plugins: [], installed: [], failures: [] });
    expect(loader.loadCalls).toEqual([]);
    expect(loader.resolveCalls).toEqual([]);
  });

  it('reports a failure for a "blogwright" field of the wrong type, without loading the module', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-bad': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/bad/package.json': JSON.stringify({ name: 'blogwright-bad', blogwright: 'not-an-object' }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-bad',
        fromDir: REPO_ROOT,
        packageJsonPath: '/bad/package.json',
        entryPath: '/bad/index.js',
        module: validPluginModule('bad'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.plugins).toEqual([]);
    expect(result.failures).toEqual([
      { packageName: 'blogwright-bad', reason: expect.stringContaining('/bad/package.json') },
    ]);
    expect(loader.loadCalls).toEqual([]);
  });

  it('reports a failure for a namespace violating ^[a-z0-9-]+$, without loading the module', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-badname': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/badname/package.json': JSON.stringify({
        name: 'blogwright-badname',
        blogwright: { plugin: 'Not Valid!' },
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-badname',
        fromDir: REPO_ROOT,
        packageJsonPath: '/badname/package.json',
        entryPath: '/badname/index.js',
        module: validPluginModule('badname'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.plugins).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.packageName).toBe('blogwright-badname');
    expect(loader.loadCalls).toEqual([]);
  });

  it('reports a failure naming the package and the reason when the default export fails validatePlugin', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-broken': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/broken/package.json': JSON.stringify({
        name: 'blogwright-broken',
        blogwright: { plugin: 'broken' },
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-broken',
        fromDir: REPO_ROOT,
        packageJsonPath: '/broken/package.json',
        entryPath: '/broken/index.js',
        // Missing name/description/commands - validatePlugin must reject this.
        module: { default: {} },
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.plugins).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.packageName).toBe('blogwright-broken');
    expect(result.failures[0]?.reason).toMatch(/blogwright-broken/);
    expect(loader.loadCalls).toEqual(['/broken/index.js']);
  });

  it('loads and returns a well-formed plugin', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-good': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/good/package.json': JSON.stringify({
        name: 'blogwright-good',
        blogwright: { plugin: 'good' },
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-good',
        fromDir: REPO_ROOT,
        packageJsonPath: '/good/package.json',
        entryPath: '/good/index.js',
        module: validPluginModule('good'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.failures).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.name).toBe('good');
  });
});

describe('discover - namespace collisions', () => {
  it('rejects a plugin claiming a reserved name, naming both the package and the collided name, and absent from plugins', async () => {
    // "preview" is reserved only through the union with the literal
    // {init, preview, plugin} set, not through KNOWN_COMMANDS - proving the
    // check consults RESERVED_COMMANDS (cli.ts) rather than KNOWN_COMMANDS
    // directly, which would under-reserve and let this collision through.
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-previewer': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/previewer/package.json': JSON.stringify({
        name: 'blogwright-previewer',
        blogwright: { plugin: 'preview' },
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-previewer',
        fromDir: REPO_ROOT,
        packageJsonPath: '/previewer/package.json',
        entryPath: '/previewer/index.js',
        module: validPluginModule('preview'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.plugins).toEqual([]);
    expect(result.failures).toEqual([
      {
        packageName: 'blogwright-previewer',
        reason:
          'blogwright-previewer declares plugin name "preview", which is reserved for the ' +
          'built-in "preview" command - built-in commands always win',
      },
    ]);
  });

  it('rejects two plugins claiming the same name, both recorded as failures naming both packages, identically regardless of candidate order', async () => {
    const expectedFailures = [
      {
        packageName: 'blogwright-alpha',
        reason:
          'plugin name "shared" is claimed by more than one installed package: ' +
          'blogwright-alpha, blogwright-zulu',
      },
      {
        packageName: 'blogwright-zulu',
        reason:
          'plugin name "shared" is claimed by more than one installed package: ' +
          'blogwright-alpha, blogwright-zulu',
      },
    ];

    // Order A: blogwright-alpha resolves as a consumer dependency,
    // blogwright-zulu as a CLI-bundled one - so `alpha` is processed first.
    const fsOrderA = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-alpha': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-zulu': '^1.0.0' },
      }),
      '/alpha/package.json': JSON.stringify({
        name: 'blogwright-alpha',
        blogwright: { plugin: 'shared' },
      }),
      '/zulu/package.json': JSON.stringify({
        name: 'blogwright-zulu',
        blogwright: { plugin: 'shared' },
      }),
    });
    const loaderOrderA = createFakeModuleLoader([
      {
        specifier: 'blogwright-alpha',
        fromDir: REPO_ROOT,
        packageJsonPath: '/alpha/package.json',
        entryPath: '/alpha/index.js',
        module: validPluginModule('shared'),
      },
      {
        specifier: 'blogwright-zulu',
        fromDir: CLI_DIR,
        packageJsonPath: '/zulu/package.json',
        entryPath: '/zulu/index.js',
        module: validPluginModule('shared'),
      },
    ]);

    const resultOrderA = await discover(REPO_ROOT, CLI_DIR, { fs: fsOrderA, loader: loaderOrderA });

    expect(resultOrderA.plugins).toEqual([]);
    expect(resultOrderA.failures).toEqual(expectedFailures);

    // Order B: the reverse - blogwright-zulu now resolves as the consumer
    // dependency and blogwright-alpha as the CLI-bundled one, so `zulu` is
    // processed first this time. The outcome (including message text) must
    // be identical to order A.
    const fsOrderB = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-zulu': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-alpha': '^1.0.0' },
      }),
      '/alpha/package.json': JSON.stringify({
        name: 'blogwright-alpha',
        blogwright: { plugin: 'shared' },
      }),
      '/zulu/package.json': JSON.stringify({
        name: 'blogwright-zulu',
        blogwright: { plugin: 'shared' },
      }),
    });
    const loaderOrderB = createFakeModuleLoader([
      {
        specifier: 'blogwright-zulu',
        fromDir: REPO_ROOT,
        packageJsonPath: '/zulu/package.json',
        entryPath: '/zulu/index.js',
        module: validPluginModule('shared'),
      },
      {
        specifier: 'blogwright-alpha',
        fromDir: CLI_DIR,
        packageJsonPath: '/alpha/package.json',
        entryPath: '/alpha/index.js',
        module: validPluginModule('shared'),
      },
    ]);

    const resultOrderB = await discover(REPO_ROOT, CLI_DIR, { fs: fsOrderB, loader: loaderOrderB });

    expect(resultOrderB.plugins).toEqual([]);
    expect(resultOrderB.failures).toEqual(expectedFailures);
  });

  it('does not reserve "pds" - a plugin may declare that name and is discovered normally (cli.ts\'s hardcoded branch is the only thing shadowing it, until task 29)', async () => {
    const fs = createMemoryFileSystem({
      [`${REPO_ROOT}/package.json`]: JSON.stringify({
        dependencies: { 'blogwright-pds-clone': '^1.0.0' },
      }),
      [`${CLI_DIR}/package.json`]: '{}',
      '/pds-clone/package.json': JSON.stringify({
        name: 'blogwright-pds-clone',
        blogwright: { plugin: 'pds' },
      }),
    });
    const loader = createFakeModuleLoader([
      {
        specifier: 'blogwright-pds-clone',
        fromDir: REPO_ROOT,
        packageJsonPath: '/pds-clone/package.json',
        entryPath: '/pds-clone/index.js',
        module: validPluginModule('pds'),
      },
    ]);

    const result = await discover(REPO_ROOT, CLI_DIR, { fs, loader });

    expect(result.failures).toEqual([]);
    expect(result.plugins.map((p) => p.name)).toEqual(['pds']);
  });
});

/**
 * The one integration case: the REAL ModuleLoader adapter
 * (`createNodeModuleLoader`), the real FileSystem adapter
 * (`createNodeFileSystem`), and this actual workspace on disk - no
 * map-backed fake anywhere in this block.
 */
describe('discover (integration - real ModuleLoader adapter, real disk)', () => {
  it('resolves candidates from the CLI package directory without ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
    const fs = createNodeFileSystem();
    const loader = createNodeModuleLoader();
    const repoRoot = await findRepoRoot(fs);
    const cliDir = cliPackageDir();

    const result = await discover(repoRoot, cliDir, { fs, loader });

    // blogwright-pds is a bundled dependency of the real packages/cli/package.json
    // (see PLUGIN_PACKAGE_PREFIX candidates), and its `exports` map lists "."
    // but not "./package.json" - the exact shape that makes
    // require.resolve('blogwright-pds/package.json') throw
    // ERR_PACKAGE_PATH_NOT_EXPORTED. This repo's own package.json has zero
    // blogwright-* dependencies, so blogwright-pds is reachable only through
    // the CLI-bundled half of the candidate set. If packageJsonPathFor were
    // ever "simplified" back to resolving <name>/package.json directly, that
    // throw would surface here as a load failure and this assertion would
    // catch it (verified: reverting the walk-up to the direct subpath turns
    // this into a non-empty `failures` array).
    expect(result.failures).toEqual([]);
  });

  it('discovers a plugin published with the dual-package layout, whose nearest package.json on disk carries no "name"', async () => {
    // Builds a real, on-disk consumer repo depending on a real, on-disk
    // "blogwright-dual" package shaped exactly like the case task 05's gate
    // missed: exports "." -> "./dist/index.js", plus a dist/package.json
    // stub of {"type": "module"} - no "name", no "blogwright" field. Without
    // the name-carrying guard in packageJsonPathFor, the walk-up stops at
    // that stub, discovery reads no "blogwright" field on it, and concludes
    // silently that the package is not a plugin - so this asserts the
    // opposite: it IS discovered, through the real resolver, end to end.
    const consumerRoot = await makeTempDir('plugins-discover-consumer');
    const cliDir = await makeTempDir('plugins-discover-cli');
    try {
      const fs = createNodeFileSystem();
      const loader = createNodeModuleLoader();
      const pkgDir = join(consumerRoot, 'node_modules', 'blogwright-dual');

      await fs.writeText(
        join(consumerRoot, 'package.json'),
        JSON.stringify({ name: 'consumer', dependencies: { 'blogwright-dual': '1.0.0' } }),
      );
      await fs.writeText(
        join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'blogwright-dual',
          version: '1.0.0',
          type: 'module',
          exports: { '.': './dist/index.js' },
          blogwright: { plugin: 'dual' },
        }),
      );
      // The dual-package stub nearer to the entry point: no "name", no "blogwright" field.
      await fs.writeText(join(pkgDir, 'dist', 'package.json'), JSON.stringify({ type: 'module' }));
      await fs.writeText(
        join(pkgDir, 'dist', 'index.js'),
        [
          'export default {',
          "  name: 'dual',",
          "  description: 'a dual-package-layout plugin',",
          "  commands: [{ action: 'run', summary: 'run it', run: async () => undefined }],",
          '};',
          '',
        ].join('\n'),
      );
      await fs.writeText(join(cliDir, 'package.json'), JSON.stringify({ name: 'cli-stub' }));

      const result = await discover(consumerRoot, cliDir, { fs, loader });

      expect(result.failures).toEqual([]);
      expect(result.plugins.map((p) => p.name)).toEqual(['dual']);
      // The manifest path carried out of discovery is the package's OWN
      // package.json, never one derived from the resolved entry point.
      // `<pkgDir>/dist/package.json` is the name-less `{"type":"module"}`
      // stub written above, which declares no `version`, so an entry-derived
      // path would make `blogwright plugin list` print `(unknown)` for a
      // package that plainly declares 1.0.0 - and still exit 0, with no
      // error anywhere. Asserted as a suffix, not an equality: macOS
      // realpaths the temp root from `/var/...` to `/private/var/...`.
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0]?.packageJsonPath).toMatch(
        /[/\\]node_modules[/\\]blogwright-dual[/\\]package\.json$/,
      );
    } finally {
      await removeTempDir(consumerRoot);
      await removeTempDir(cliDir);
    }
  });
});

/**
 * TASK 26 - the bundled `blogwright-pds` package, now that
 * `packages/pds/package.json` declares `"blogwright": { "plugin": "pds" }`.
 *
 * Real adapters and this actual workspace again, for the same reason the
 * block above uses them: the thing under test is that the REAL manifest
 * field, the REAL `exports` map and the REAL default export line up, and a
 * map-backed fake proves none of that. The two cases here are the concrete
 * assertions §`blogwright-pds` -> Package manifest's "no install step"
 * guarantee rests on - a consuming repo depends on `blogwright`, never on
 * `blogwright-pds`, so the plugin has to arrive through the CLI's own
 * bundled dependency half or not at all.
 */
describe('discover (integration) - the bundled blogwright-pds plugin', () => {
  it('discovers blogwright-pds as the "pds" plugin from a consuming repo whose package.json names only "blogwright"', async () => {
    const consumerRoot = await makeTempDir('plugins-discover-pds-consumer');
    const cliStub = await makeTempDir('plugins-discover-pds-cli-stub');
    try {
      const fs = createNodeFileSystem();
      const loader = createNodeModuleLoader();
      // A real, on-disk consuming repo the way one looks after `npm i
      // blogwright`: one dependency, spelled `blogwright`, and NO
      // node_modules of its own. `blogwright-pds` is not resolvable from
      // here by construction, so whatever is discovered below arrived
      // through `cliPackageDir()`'s own dependencies.
      await fs.writeText(
        join(consumerRoot, 'package.json'),
        JSON.stringify({ name: 'consumer', dependencies: { blogwright: '^0.3.3' } }),
      );

      const result = await discover(consumerRoot, cliPackageDir(), { fs, loader });

      expect(result.failures).toEqual([]);
      expect(result.plugins.map((plugin) => plugin.name)).toEqual(['pds']);
      const entry = result.installed[0];
      expect(entry?.packageName).toBe('blogwright-pds');
      // The plugin object really is the one `packages/pds/src/plugin.ts`
      // default-exports: its config key and its six actions, in declaration
      // order, none of which a stub or a name-only match would carry.
      expect(entry?.plugin.configKey).toBe('pds');
      expect(entry?.plugin.commands.map((command) => command.action)).toEqual([
        'keygen',
        'login',
        'init',
        'sync',
        'secret status',
        'secret delete',
      ]);
      // And the manifest discovery actually read is the pds package's own,
      // carrying the field this task added - not a stub, and not one
      // derived from the resolved entry file.
      const manifest = JSON.parse(await fs.readText(entry?.packageJsonPath ?? '')) as {
        name?: string;
        blogwright?: { plugin?: string };
      };
      expect(manifest.name).toBe('blogwright-pds');
      expect(manifest.blogwright).toEqual({ plugin: 'pds' });

      // The control, run against the SAME consumer root: a CLI package that
      // bundles nothing discovers nothing. Without it, a discovery that had
      // somehow reached blogwright-pds through the consumer half - or
      // through this test process's own module graph - would pass the
      // assertions above just as well.
      await fs.writeText(join(cliStub, 'package.json'), JSON.stringify({ name: 'cli-stub' }));
      const control = await discover(consumerRoot, cliStub, { fs, loader });
      expect(control.plugins).toEqual([]);
      expect(control.failures).toEqual([]);
    } finally {
      await removeTempDir(consumerRoot);
      await removeTempDir(cliStub);
    }
  });
});

/**
 * TASK 26 - `blogwright plugin list` over the real bundled plugin.
 *
 * Lives beside the discovery cases above, rather than with the other
 * `runPluginNamespace` tests in `plugin-commands.test.ts`, because it is the
 * same integration assertion in the register a human reads it: those tests
 * pin the RENDERING against map-backed fixtures, this one pins that the row
 * describes the package actually installed on disk. The task's `Reviewable:`
 * line runs `vitest run plugins`, which matches this file and not
 * `plugin-commands.test.ts`.
 */
describe('blogwright plugin list (integration) - the bundled blogwright-pds plugin', () => {
  it('reports the pds row: the namespace, the package, the version packages/pds/package.json declares, and the pds config key', async () => {
    const fs = createNodeFileSystem();
    const loader = createNodeModuleLoader();
    const terminal = createScriptedTerminal({ interactive: false });
    // Read from the package's own manifest by a path this test builds
    // itself - never off the discovery result the command under test
    // produced, which would make the version assertion circular.
    const repoRoot = await findRepoRoot(fs);
    const pdsManifest = JSON.parse(
      await fs.readText(join(repoRoot, 'packages', 'pds', 'package.json')),
    ) as { version?: string };
    expect(typeof pdsManifest.version).toBe('string');

    const code = await runPluginNamespace(
      ['list'],
      terminal,
      createLogger(terminal),
      {
        fs,
        loader,
      },
      {
        values: {
          env: undefined,
          domain: undefined,
          config: undefined,
          endpoint: undefined,
          hash: undefined,
          id: undefined,
          identifier: undefined,
          plain: false,
          refresh: false,
          yes: false,
          help: false,
        },
        makePackages: () => {
          throw new Error('unexpected: package manager built for `plugin list`');
        },
        cliVersion: () => {
          throw new Error('unexpected: CLI version resolved for `plugin list`');
        },
        makeContext: () => {
          throw new Error('unexpected: OpsContext built for `plugin list`');
        },
      },
    );

    expect(code).toBe(0);
    expect(terminal.errors).toEqual([]);
    // One row, because this workspace's own root package.json declares
    // `blogwright` and no `blogwright-*` package at all: pds is here purely
    // as the CLI's bundled dependency. Hand-typed in `--plain`'s
    // single-space form rather than assembled with the renderer's own
    // padding, so a renderer that stopped emitting a column fails here.
    expect(terminal.writes).toEqual([
      'namespace package version configKey',
      `pds blogwright-pds ${pdsManifest.version} pds`,
    ]);
  });
});
