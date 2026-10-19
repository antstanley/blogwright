import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createNodeFileSystem,
  createNodeTerminal,
  deriveNames,
  findRepoRoot,
  parseConfigDocument,
  StateStore,
  type AwsClients,
  type CallerIdentity,
  type FileSystem,
  type Names,
  type OpsConfig,
  type OpsState,
} from 'blogwright-core';

import { createFetchPing } from './adapters/fetch-ping.js';
import { createNodeModuleLoader } from './adapters/node-module-loader.js';
import { createProcessAwsLogin } from './adapters/process-aws-login.js';
import { createProcessVcs } from './adapters/process-vcs.js';
import {
  emitSessionLine,
  formatIdentityLine,
  resolveAwsSession,
  type AwsHost,
  type ResolvedAwsProfile,
} from './aws-session.js';
import { createLogger, type Logger } from './logger.js';
import type { Ports } from './ports.js';

export interface OpsContext {
  env: string;
  domain: string | undefined;
  /** True for the shared preview stack (host-routed, per-PR prefixes). */
  preview: boolean;
  config: OpsConfig;
  /**
   * The environment's config file exactly as parsed, before `OpsConfig`'s
   * merge and validation - every top-level key the document carries, a
   * plugin's own block included. `OpsConfig` has no index signature, so this
   * is the only typed route to `config[plugin.configKey]` (see
   * `blogwright-core`'s `parseConfigDocument`).
   *
   * CLI-side ONLY, and deliberately absent from `PluginContext`: dispatch
   * reads the DISPATCHED plugin's block off this and hands that one block to
   * that one plugin (`resolvePluginConfig`, `plugins.ts`), so no plugin ever
   * sees another plugin's config.
   */
  configDocument: Readonly<Record<string, unknown>>;
  names: Names;
  /** Equals `identity.account`. */
  accountId: string;
  /** Whose credentials this invocation signs with, from `sts:GetCallerIdentity`. */
  identity: CallerIdentity;
  /** The profile those credentials came from, and which precedence row chose it. */
  awsProfile: ResolvedAwsProfile;
  clients: AwsClients;
  ports: Ports;
  /**
   * Directory holding the build-agent artifacts - Dockerfile, bundled server.js,
   * and agent-manifest.json - copied into this package by its build
   * (scripts/copy-agent.mjs). Resolved at the composition root; tests inject one.
   */
  agentDir: string;
  /**
   * Tags applied to every AWS resource this stack creates:
   * `environment` (the env name) and `app` (see {@link deriveAppTag}).
   */
  tags: Record<string, string>;
  state: OpsState;
  store: StateStore;
  logger: Logger;
  /** Persist the working state to S3. */
  save(): Promise<void>;
}

/**
 * The `app` tag value, by precedence: the explicit `config.app`, else the
 * site's domain, else the repo directory name - always something a human can
 * trace back to the project from a billing or resource listing.
 */
export function deriveAppTag(
  config: Pick<OpsConfig, 'app'>,
  domain: string | undefined,
  repoRoot: string,
): string {
  return config.app ?? domain ?? basename(repoRoot);
}

export interface ContextOptions {
  env: string;
  configPath?: string | undefined;
  domain?: string | undefined;
  endpointOverride?: string | undefined;
  preview?: boolean | undefined;
  /** `--profile`: the first row of AWS profile resolution. */
  profile?: string | undefined;
  /** The environment AWS resolution reads; defaults to `process.env`. */
  processEnv?: NodeJS.ProcessEnv | undefined;
  /** Home directory the shared AWS files resolve against; defaults to `os.homedir()`. */
  home?: string | undefined;
  /** Builds the AWS clients; defaults to core's `createClients`. Tests substitute it. */
  createClients?: AwsHost['createClients'];
  /** Adapter overrides; anything omitted defaults to the real (node) adapter. */
  ports?: Partial<Ports> | undefined;
}

/**
 * The real adapter for every port not supplied in `overrides`. Shared by
 * `createContext` and the pre-context paths (`whoami`, `init`) through
 * `bin.ts`, so all three wire the same adapters.
 */
function createPorts(overrides: Partial<Ports> = {}): Ports {
  return {
    fs: overrides.fs ?? createNodeFileSystem(),
    vcs: overrides.vcs ?? createProcessVcs(),
    terminal: overrides.terminal ?? createNodeTerminal(),
    ping: overrides.ping ?? createFetchPing(),
    loader: overrides.loader ?? createNodeModuleLoader(),
    awsLogin: overrides.awsLogin ?? createProcessAwsLogin(),
  };
}

/** The operator's machine as AWS resolution sees it, from `process` and `os`. */
export function createAwsHost(
  overrides: Pick<ContextOptions, 'processEnv' | 'home' | 'createClients'> = {},
): AwsHost {
  return {
    processEnv: overrides.processEnv ?? process.env,
    home: overrides.home ?? homedir(),
    platform: process.platform,
    cwd: process.cwd(),
    createClients: overrides.createClients,
  };
}

/**
 * The directory holding the CLI's own `package.json` - `blogwright`'s package
 * root. Located from `import.meta.url` the same way {@link OpsContext.agentDir}
 * is (below): `packages/cli/package.json` declares an `exports` map with a
 * `./rkey` entry and no `.` entry (the CLI is consumed through its `bin`, not
 * imported), so neither `blogwright` nor `blogwright/package.json` can be
 * resolved through the `ModuleLoader` port - see that port's doc comment.
 * Self-location is therefore a composition-root concern, not something
 * `discover` (`plugins.ts`) can derive itself.
 *
 * A standalone function, not folded into {@link createContext}: `blogwright
 * plugin list` dispatches before a context exists and still needs this
 * value, and it is the one supplier every discovery-running path (plugin
 * dispatch, `blogwright --help`, the init wizard, `plugin list`) passes as
 * `discover`'s second argument.
 */
export function cliPackageDir(): string {
  // `new URL('..', …)` yields a trailing separator, unlike every other directory
  // value in the CLI. join() and createRequire() tolerate it, but a caller
  // writing `${cliPackageDir()}/x` would get a doubled separator - in the path
  // and in any error message built from it. Normalise here so no caller has to
  // remember. Four discovery-running paths (tasks 10, 11, 14, 17) consume this.
  return resolve(fileURLToPath(new URL('..', import.meta.url)));
}

/** Narrow parsed JSON to an object before reading a field off it - no cast, no `any`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The running CLI's own declared version - the value `blogwright plugin add`
 * (`plugin-commands.ts`) pins into the install spec, so a plugin and the CLI
 * that dispatches it can never silently drift apart across two developers'
 * checkouts.
 *
 * Read HERE, at the composition root, for exactly the reason
 * {@link cliPackageDir} is resolved here: `blogwright`'s own `exports` map has
 * no `.` entry, so neither the package nor its `package.json` can be reached
 * through the `ModuleLoader` port, and this module is one of the few the
 * `no-restricted-imports` rule lets touch `node:fs` at all. `plugin-commands.ts`
 * receives the resolved string as DATA and never walks the filesystem for it -
 * the same division `agentDir` already makes.
 *
 * Read on demand rather than at module load: `blogwright plugin list` and every
 * built-in command share this module and none of them needs the value, so only
 * the one command that pins a version pays for the read.
 */
export async function cliVersion(): Promise<string> {
  const path = join(cliPackageDir(), 'package.json');
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  const version = isRecord(parsed) ? parsed.version : undefined;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(
      `${path} declares no "version" - \`blogwright plugin add\` pins the installed plugin to ` +
        "the running CLI's own version and has nothing to pin to",
    );
  }
  return version;
}

export interface ConfigSource {
  env: string;
  /** Repo root the default config candidates resolve against. */
  root: string;
  /** Explicit config file; when set it is the only candidate. */
  configPath?: string | undefined;
}

/** Candidate config paths, in the precedence `loadConfig`/`resolveConfigPath` read them: an explicit `--config`, or `config/<env>.jsonc` then `ops.config.jsonc`. */
function configCandidates(source: ConfigSource): string[] {
  return source.configPath
    ? [source.configPath]
    : [
        resolve(source.root, `config/${source.env}.jsonc`),
        resolve(source.root, 'ops.config.jsonc'),
      ];
}

/**
 * Resolve the first config candidate that exists, in `configCandidates`'
 * precedence. Throws, naming every candidate it looked for, when none does -
 * the same message `loadConfig` has always raised on this path.
 *
 * Exported so `blogwright <plugin> init` (`plugin-commands.ts`) writes its
 * spliced block into exactly the file `loadConfig` would read, rather than
 * re-deriving the candidate list a second time.
 */
export async function resolveConfigPath(fs: FileSystem, source: ConfigSource): Promise<string> {
  const candidates = configCandidates(source);
  for (const path of candidates) {
    if (await fs.exists(path)) return path;
  }
  throw new ConfigNotFoundError(source.env, candidates);
}

/** Raised by {@link resolveConfigPath} when no candidate config file exists. */
export class ConfigNotFoundError extends Error {
  constructor(env: string, candidates: readonly string[]) {
    super(`no config found for environment "${env}" - looked for ${candidates.join(', ')}`);
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * Load and parse the first config candidate that exists, returning BOTH
 * halves `parseConfigDocument` produces: the validated `config` every
 * built-in command reads, and the `raw` document the dispatch path reads a
 * plugin's own block out of. The candidate list and its precedence are
 * unchanged - only the return type widens, so `createContext` can keep the
 * raw half on {@link OpsContext.configDocument} instead of the file having to
 * be read and parsed a second time at dispatch. Exported for tests.
 */
export async function loadConfig(
  fs: FileSystem,
  source: ConfigSource,
): Promise<{ config: OpsConfig; raw: Readonly<Record<string, unknown>>; path: string }> {
  const path = await resolveConfigPath(fs, source);
  return { ...parseConfigDocument(await fs.readText(path)), path };
}

/**
 * Build the runtime context: load config, resolve the AWS session (profile, caller
 * identity, account pin), derive names, and load topology state from S3. The state
 * bucket name is deterministic, which resolves the bootstrap chicken-and-egg; the pin
 * is checked before it is derived, so a wrong account never reads or creates state.
 * This is the composition root - the only place real adapters are constructed and wired.
 */
export async function createContext(opts: ContextOptions): Promise<OpsContext> {
  const ports = createPorts(opts.ports);
  const logger = createLogger(ports.terminal);
  const agentDir = join(cliPackageDir(), 'agent');
  const root = await findRepoRoot(ports.fs);
  const {
    config,
    raw: configDocument,
    path: configPath,
  } = await loadConfig(ports.fs, {
    env: opts.env,
    root,
    configPath: opts.configPath,
  });
  const domain = opts.domain ?? config.domain;

  const session = await resolveAwsSession({
    region: config.region,
    endpointOverride: opts.endpointOverride,
    flag: opts.profile,
    aws: config.aws,
    configLabel: relative(root, configPath) || configPath,
    host: createAwsHost(opts),
    ports,
    logger,
  });
  emitSessionLine(formatIdentityLine(session), ports.terminal, logger);
  const { clients, identity } = session;
  const accountId = identity.account;
  const names = deriveNames(opts.env, accountId, config);
  const store = new StateStore(clients.s3, names.bucket, opts.env);
  // load() already returns empty state for a not-yet-created bucket/object; any other
  // error (corrupt state, AccessDenied, transient S3) must surface, not be masked.
  const state = await store.load();

  const ctx: OpsContext = {
    env: opts.env,
    domain,
    preview: opts.preview ?? false,
    config,
    configDocument,
    names,
    accountId,
    identity,
    awsProfile: session.profile,
    clients,
    ports,
    agentDir,
    tags: { environment: opts.env, app: deriveAppTag(config, domain, root) },
    state,
    store,
    logger,
    save: async () => {
      await store.save(state);
    },
  };
  return ctx;
}
