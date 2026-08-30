import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createClients,
  createNodeFileSystem,
  createNodeTerminal,
  deriveNames,
  findRepoRoot,
  parseConfig,
  StateStore,
  type AwsClients,
  type FileSystem,
  type Names,
  type OpsConfig,
  type OpsState,
} from 'blogwright-core';

import { createFetchPing } from './adapters/fetch-ping.js';
import { createNodeModuleLoader } from './adapters/node-module-loader.js';
import { createProcessPackageManager } from './adapters/process-package-manager.js';
import { createProcessVcs } from './adapters/process-vcs.js';
import { createLogger, type Logger } from './logger.js';
import type { Ports } from './ports.js';

export interface OpsContext {
  env: string;
  domain: string | undefined;
  /** True for the shared preview stack (host-routed, per-PR prefixes). */
  preview: boolean;
  config: OpsConfig;
  names: Names;
  accountId: string;
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
  /** Adapter overrides; anything omitted defaults to the real (node) adapter. */
  ports?: Partial<Ports> | undefined;
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
  throw new Error(
    `no config found for environment "${source.env}" - looked for ${candidates.join(', ')}`,
  );
}

/** Load and parse the first config candidate that exists. Exported for tests. */
export async function loadConfig(fs: FileSystem, source: ConfigSource): Promise<OpsConfig> {
  return parseConfig(await fs.readText(await resolveConfigPath(fs, source)));
}

/**
 * Build the runtime context: load config, resolve the account id, derive names, create
 * clients, and load topology state from S3. The state bucket name is deterministic, which
 * resolves the bootstrap chicken-and-egg. This is the composition root - the only place
 * real adapters are constructed and wired.
 */
export async function createContext(opts: ContextOptions): Promise<OpsContext> {
  const fs = opts.ports?.fs ?? createNodeFileSystem();
  const ports: Ports = {
    fs,
    vcs: opts.ports?.vcs ?? createProcessVcs(),
    terminal: opts.ports?.terminal ?? createNodeTerminal(),
    ping: opts.ports?.ping ?? createFetchPing(),
    loader: opts.ports?.loader ?? createNodeModuleLoader(),
    packages: opts.ports?.packages ?? createProcessPackageManager(fs),
  };
  const logger = createLogger(ports.terminal);
  const agentDir = join(cliPackageDir(), 'agent');
  const root = await findRepoRoot(ports.fs);
  const config = await loadConfig(ports.fs, {
    env: opts.env,
    root,
    configPath: opts.configPath,
  });
  const domain = opts.domain ?? config.domain;

  const clients = createClients({
    region: config.region,
    endpointOverride: opts.endpointOverride,
  });

  const accountId = await clients.sts.getAccountId();
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
    names,
    accountId,
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
