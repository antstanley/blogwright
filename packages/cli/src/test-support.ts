/**
 * Test-only OpsContext factory. Builds a real, fully-typed context over
 * in-memory adapters: file access hits a Map-backed FileSystem, and every AWS
 * client method that a test has not overridden fails fast at the transport.
 * Tests substitute behaviour here - at the ports - never by casting.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createClients,
  createMemoryFileSystem,
  createNodeFileSystem,
  deriveNames,
  emptyState,
  findRepoRoot,
  mergeConfig,
  staticCredentials,
  StateStore,
  type AwsClients,
  type FileSystem,
  type Names,
  type OpsConfig,
  type OpsState,
  type Plugin,
  type PluginCommand,
  type PluginContext,
  type Terminal,
  type Transport,
} from 'blogwright-core';

import { cliPackageDir, type OpsContext } from './context.js';
import type { Logger } from './logger.js';
import type {
  AddPackageOptions,
  ModuleLoader,
  ModuleResolution,
  PackageManager,
  PackageManagerName,
  PingBuilder,
  Ports,
  Vcs,
} from './ports.js';

type ServiceName = Exclude<keyof AwsClients, 'region'>;

/** Per-service method overrides; anything not overridden rejects when called. */
type ClientOverrides = { [Service in ServiceName]?: Partial<AwsClients[Service]> };

export interface TestContextOverrides {
  env?: string | undefined;
  domain?: string | undefined;
  preview?: boolean | undefined;
  accountId?: string | undefined;
  config?: Partial<OpsConfig> | undefined;
  names?: Partial<Names> | undefined;
  state?: Partial<OpsState> | undefined;
  clients?: ClientOverrides | undefined;
  logger?: Partial<Logger> | undefined;
  ports?: Partial<Ports> | undefined;
  agentDir?: string | undefined;
  tags?: Record<string, string> | undefined;
  save?: (() => Promise<void>) | undefined;
}

const rejectAllTransport: Transport = async (req) => {
  throw new Error(
    `unexpected AWS request in test: ${req.method} ${req.url} - override the client method on createTestContext`,
  );
};

/**
 * Layer test overrides over a real client so untouched methods still fail fast.
 * Overrides must be plain objects of methods (own properties) - a class
 * instance's prototype methods would not be copied.
 */
function overrideClient<T extends object>(base: T, overrides: Partial<T> | undefined): T {
  if (!overrides) return base;
  return Object.assign(Object.create(base) as T, overrides);
}

function testClients(region: string, overrides: ClientOverrides): AwsClients {
  const base = createClients({
    region,
    credentials: staticCredentials({ accessKeyId: 'test', secretAccessKey: 'test' }),
    transport: rejectAllTransport,
  });
  return {
    ...base,
    signing: overrideClient(base.signing, overrides.signing),
    s3: overrideClient(base.s3, overrides.s3),
    sts: overrideClient(base.sts, overrides.sts),
    iam: overrideClient(base.iam, overrides.iam),
    logs: overrideClient(base.logs, overrides.logs),
    logsUsEast1: overrideClient(base.logsUsEast1, overrides.logsUsEast1),
    acm: overrideClient(base.acm, overrides.acm),
    cloudfront: overrideClient(base.cloudfront, overrides.cloudfront),
    route53: overrideClient(base.route53, overrides.route53),
    microvms: overrideClient(base.microvms, overrides.microvms),
    secrets: overrideClient(base.secrets, overrides.secrets),
  };
}

const rejectAllVcs: Vcs = {
  revisionHash: async (cwd) => {
    throw new Error(
      `unexpected VCS call in test: revisionHash(${cwd}) - override ports.vcs on createTestContext`,
    );
  },
  listFiles: async (cwd) => {
    throw new Error(
      `unexpected VCS call in test: listFiles(${cwd}) - override ports.vcs on createTestContext`,
    );
  },
};

const rejectAllLoader: ModuleLoader = {
  resolve: async (specifier, fromDir) => {
    throw new Error(
      `unexpected module resolution in test: resolve(${specifier}, ${fromDir}) - override ports.loader on createTestContext`,
    );
  },
  packageJsonPathFor: async (specifier, fromDir) => {
    throw new Error(
      `unexpected module resolution in test: packageJsonPathFor(${specifier}, ${fromDir}) - override ports.loader on createTestContext`,
    );
  },
  load: async (path) => {
    throw new Error(
      `unexpected module load in test: load(${path}) - override ports.loader on createTestContext`,
    );
  },
};

/**
 * One recorded `add` or `remove` call on the value {@link createRecordingPackageManager}
 * returns. Not exported: nothing outside this module names the type directly - a caller
 * reads `.calls` off the inferred return type instead.
 */
type PackageManagerCall =
  | { op: 'add'; spec: string; opts: AddPackageOptions | undefined }
  | { op: 'remove'; name: string };

/**
 * Records every `add`/`remove` call and answers `detect` with `manager`,
 * without touching disk or a process. The default `ports.packages` for
 * {@link createTestContext}; importable directly for a test that needs to
 * configure which manager `detect` reports and inspect what was requested.
 */
export function createRecordingPackageManager(
  manager: PackageManagerName = 'pnpm',
): PackageManager & { readonly calls: PackageManagerCall[] } {
  const calls: PackageManagerCall[] = [];
  return {
    calls,
    detect: async () => manager,
    add: async (spec, opts) => {
      calls.push({ op: 'add', spec, opts });
    },
    remove: async (name) => {
      calls.push({ op: 'remove', name });
    },
  };
}

/** Pings are best-effort fire-and-forget by contract; the default resolves silently. */
const noopPing: PingBuilder = async () => undefined;

/** Silent, non-interactive terminal; a prompt in a test is a missing override. */
const silentTerminal: Terminal = {
  isInteractive: false,
  write: () => undefined,
  error: () => undefined,
  status: () => undefined,
  question: async (prompt) => {
    throw new Error(
      `unexpected terminal prompt in test: ${prompt} - override ports.terminal on createTestContext`,
    );
  },
};

const NOOP_LOGGER: Logger = {
  info: () => undefined,
  step: () => undefined,
  ok: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Default agent-artifact directory for tests; seed the in-memory fs under it. */
export const TEST_AGENT_DIR = '/agent';

/** Create a unique real-disk directory for a node-adapter integration test. */
export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

/** Delete a directory created by {@link makeTempDir}. */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Build a complete OpsContext for tests. Defaults: env "test", site "example",
 * account 123456789012, config merged over DEFAULT_CONFIG, derived names,
 * empty state, a fresh in-memory FileSystem, a Vcs that fails fast until
 * overridden, TEST_AGENT_DIR as the agent directory, a silent logger, and a
 * no-op save.
 */
export function createTestContext(overrides: TestContextOverrides = {}): OpsContext {
  const env = overrides.env ?? 'test';
  const accountId = overrides.accountId ?? '123456789012';
  const config = mergeConfig({ siteName: 'example', ...overrides.config });
  const names = { ...deriveNames(env, accountId, config), ...overrides.names };
  const state = { ...emptyState(env), ...overrides.state };
  const clients = testClients(config.region, overrides.clients ?? {});
  const ports: Ports = {
    fs: overrides.ports?.fs ?? createMemoryFileSystem(),
    vcs: overrides.ports?.vcs ?? rejectAllVcs,
    terminal: overrides.ports?.terminal ?? silentTerminal,
    ping: overrides.ports?.ping ?? noopPing,
    loader: overrides.ports?.loader ?? rejectAllLoader,
    packages: overrides.ports?.packages ?? createRecordingPackageManager(),
  };

  return {
    env,
    // Mirrors production resolution (context.ts): an explicit domain wins,
    // else the config's - so a test setting config.domain builds the same
    // graph shape (certificate node, aliases) the real run would.
    domain: overrides.domain ?? config.domain,
    preview: overrides.preview ?? false,
    config,
    names,
    accountId,
    clients,
    ports,
    agentDir: overrides.agentDir ?? TEST_AGENT_DIR,
    // Mirrors production derivation (context.ts deriveAppTag) with '/repo' as root.
    tags: overrides.tags ?? {
      environment: env,
      app: config.app ?? overrides.domain ?? config.domain ?? 'repo',
    },
    state,
    store: new StateStore(clients.s3, names.bucket, env),
    logger: { ...NOOP_LOGGER, ...overrides.logger },
    save: overrides.save ?? (async () => undefined),
  };
}

/**
 * The single S3 read every dispatched plugin command now makes: the load of
 * the plugin's own SCOPED state object (`toPluginContext`,
 * `plugin-commands.ts`), answered with `undefined` - a fresh, empty state.
 *
 * Deliberately NOT a blanket `getObjectText: async () => undefined`. That
 * would loosen {@link createTestContext}'s reject-everything default for
 * every key in every context built with it, including the site's own
 * `state/<env>.json` - and a regression re-pointing a plugin's store back
 * at the site's key would then read as a perfectly ordinary empty state
 * instead of failing. Only a key of the scoped SHAPE
 * (`state/<env>.<plugin>.json` - three dot-separated parts, where the
 * site's own key has two) is answered here; every other key still fails
 * fast at the transport with the same message it would have before.
 */
export function scopedStateOnlyS3(): {
  getObjectText: (bucket: string, key: string) => Promise<string | undefined>;
} {
  return {
    getObjectText: async (bucket, key) => {
      if (/^state\/[^./]+\.[^./]+\.json$/.test(key)) return undefined;
      throw new Error(
        `unexpected S3 read in test: getObjectText(${bucket}, ${key}) - only a plugin's own ` +
          'scoped state key is defaulted; override clients.s3 on createTestContext for anything else',
      );
    },
  };
}

/**
 * Fixtures shared by `cli.test.ts`'s "generic plugin dispatch" tests and
 * `plugin-commands.test.ts` - both owned by task 10, which is why they share
 * ONE definition here rather than each carrying its own copy.
 * `plugins.test.ts` (task 08/09, not owned by this task) keeps its own,
 * near-identical `createFakeModuleLoader` - left alone deliberately.
 */

/** One installed package a fake `ModuleLoader` can resolve, keyed by `(specifier, fromDir)`. */
interface FakeInstalledPackage {
  specifier: string;
  fromDir: string;
  packageJsonPath: string;
  entryPath: string;
  module: unknown;
}

/**
 * A map-backed `ModuleLoader` fake, keyed by `(specifier, fromDir)` pairs,
 * recording every call so a laziness test can assert none were made.
 */
export function createFakeModuleLoader(installed: FakeInstalledPackage[]): ModuleLoader & {
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

/** One fake plugin package to seed into a discovery fixture built by {@link buildDiscoveryPorts}. */
export interface FakePluginSpec {
  packageName: string;
  namespace: string;
  plugin: Plugin;
  /** Resolved as the CLI's own bundled dependency rather than the consumer's. */
  bundled?: boolean;
  /**
   * Written as the fake package's own `version` field, for
   * `blogwright plugin list`, which reads it back through the FileSystem
   * port. Omit to seed a manifest declaring no version at all - the shape a
   * private workspace package has, and the one the listing must mark rather
   * than leave blank.
   */
  version?: string;
}

/**
 * Build a `{ fs, loader }` pair `discover`/`runPlugin` can run against with
 * no real disk or module resolution, for every fake plugin in `specs`.
 *
 * `discover`'s two-source union resolves the consumer's dependencies from
 * the repo root and the CLI's own bundled dependencies from
 * `cliPackageDir()` (`plugins.ts`'s module comment) - both REAL, absolute
 * paths this dev checkout resolves to, not test constants - so `runPlugin`'s
 * own (non-injectable) `findRepoRoot`/`cliPackageDir()` calls land on
 * exactly the paths seeded here. `repoRoot` is learned the same way
 * `plugins.test.ts`'s integration block does: by running the REAL adapter
 * once against this actual checkout, purely to read off the constant - the
 * fixture's `fs`/`loader` returned below stay entirely in-memory. The
 * returned `fs` is a live, writable `FileSystem` (via `writeText`), so a
 * test can layer additional fixture files - e.g. a config file for one
 * environment - onto it after the fact.
 */
export async function buildDiscoveryPorts(
  specs: FakePluginSpec[],
  extra: { consumerDeps?: Record<string, string> } = {},
): Promise<{ fs: FileSystem; loader: ReturnType<typeof createFakeModuleLoader> }> {
  const repoRoot = await findRepoRoot(createNodeFileSystem());
  const cliDir = cliPackageDir();
  const consumerDeps: Record<string, string> = { ...extra.consumerDeps };
  const cliDeps: Record<string, string> = {};
  const files: Record<string, string> = {
    // A `.jj` marker at the repo root only - `findRepoRoot`'s walk-up must
    // not find one anywhere between the real `process.cwd()` and here, or it
    // would stop short of the value `discover` is seeded to expect.
    [`${repoRoot}/.jj`]: '',
  };
  const installed: FakeInstalledPackage[] = [];

  for (const spec of specs) {
    const fromDir = spec.bundled ? cliDir : repoRoot;
    (spec.bundled ? cliDeps : consumerDeps)[spec.packageName] = '1.0.0';
    const pkgDir = `/pkgs/${spec.packageName}`;
    files[`${pkgDir}/package.json`] = JSON.stringify({
      name: spec.packageName,
      ...(spec.version === undefined ? {} : { version: spec.version }),
      blogwright: { plugin: spec.namespace },
    });
    installed.push({
      specifier: spec.packageName,
      fromDir,
      packageJsonPath: `${pkgDir}/package.json`,
      entryPath: `${pkgDir}/index.js`,
      module: { default: spec.plugin },
    });
  }

  files[`${repoRoot}/package.json`] = JSON.stringify({ dependencies: consumerDeps });
  files[`${cliDir}/package.json`] = JSON.stringify({ dependencies: cliDeps });

  return { fs: createMemoryFileSystem(files), loader: createFakeModuleLoader(installed) };
}

/** One recorded invocation of a fake plugin command's `run`. */
export interface RecordedRun {
  action: string;
  ctx: PluginContext<unknown>;
  args: string[];
}

/**
 * A fake plugin named "fake" declaring four actions - `sync` (single-word),
 * a bare `secret` and the two-word `secret status`/`secret delete` - so
 * dispatch tests can prove the longest declared action wins (`secret
 * status` over the bare `secret`) rather than a positional-shifting guess.
 * Every command pushes its invocation onto `calls` instead of doing
 * anything, so a test can assert exactly what `run` received.
 */
export function makeFakePlugin(calls: RecordedRun[]): Plugin {
  function recordingCommand(action: string, summary: string): PluginCommand {
    return {
      action,
      summary,
      run: async (ctx, args) => {
        calls.push({ action, ctx, args });
      },
    };
  }
  return {
    name: 'fake',
    description: 'a fake plugin for dispatch tests',
    commands: [
      recordingCommand('sync', 'sync it'),
      recordingCommand('secret', 'show secret (bare, should never win over "secret status")'),
      recordingCommand('secret status', 'show secret status'),
      recordingCommand('secret delete', 'delete the secret'),
    ],
  };
}

/** The same narrowing `plugins.ts` and `plugin-commands.ts` each keep locally. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Wrap a {@link buildDiscoveryPorts} result with one additional BROKEN
 * candidate: `brokenPackageName` resolves and loads fine, but its default
 * export is `{}` - no `name`, `description` or `commands` - so
 * `validatePlugin` (`blogwright-core`) rejects it and `discover` reports a
 * `failures` entry instead of an `installed` one, the same outcome
 * `plugins.test.ts` proves against the real validator in "reports a failure
 * ... when the default export fails validatePlugin".
 * `packageJsonPathFor`/`resolve`/`load` for every OTHER specifier still
 * delegate to `base.loader` unchanged.
 *
 * Shared by `cli.test.ts` (a working plugin's `--help` section survives a
 * broken sibling) and `plugin-commands.test.ts` (`blogwright plugin list`
 * lists both), for the same reason every other fixture in this section is:
 * one definition rather than two near-identical copies.
 */
export async function withBrokenPlugin(
  base: { fs: FileSystem; loader: ModuleLoader },
  brokenPackageName: string,
): Promise<{ fs: FileSystem; loader: ModuleLoader }> {
  const repoRoot = await findRepoRoot(base.fs);
  const packageJsonPath = `/pkgs/${brokenPackageName}/package.json`;
  const entryPath = `/pkgs/${brokenPackageName}/index.js`;
  await base.fs.writeText(
    packageJsonPath,
    JSON.stringify({ name: brokenPackageName, blogwright: { plugin: 'broken' } }),
  );
  const repoPackageJsonPath = `${repoRoot}/package.json`;
  const repoPkg: unknown = JSON.parse(await base.fs.readText(repoPackageJsonPath));
  // Narrowed rather than cast, and the manifest is REWRITTEN rather than
  // replaced: the broken candidate has to JOIN whatever
  // `buildDiscoveryPorts` already declared, or seeding it would drop every
  // healthy plugin out of the consumer manifest and the mixed good/broken
  // fixtures would silently become broken-only ones. That applies to the
  // whole file, not just to `dependencies` - `collectCandidates` reads
  // `devDependencies` too (`plugins.ts`), so emitting a lone `dependencies`
  // key here would silently erase a fixture that seeded those, with no
  // failure to say so.
  const manifest: Record<string, unknown> = isRecord(repoPkg) ? repoPkg : {};
  const declared = manifest.dependencies;
  const dependencies: Record<string, unknown> = isRecord(declared) ? declared : {};
  await base.fs.writeText(
    repoPackageJsonPath,
    JSON.stringify({
      ...manifest,
      dependencies: { ...dependencies, [brokenPackageName]: '1.0.0' },
    }),
  );

  const loader: ModuleLoader = {
    resolve: async (specifier, fromDir) =>
      specifier === brokenPackageName
        ? { found: true, path: entryPath }
        : base.loader.resolve(specifier, fromDir),
    packageJsonPathFor: async (specifier, fromDir) =>
      specifier === brokenPackageName
        ? { found: true, path: packageJsonPath }
        : base.loader.packageJsonPathFor(specifier, fromDir),
    load: async (path) => (path === entryPath ? { default: {} } : base.loader.load(path)),
  };
  return { fs: base.fs, loader };
}
