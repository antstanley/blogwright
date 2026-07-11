import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createClients,
  createNodeFileSystem,
  createNodeTerminal,
  deriveNames,
  FileNotFoundError,
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
   * Directory holding the build-agent artifacts — Dockerfile, bundled server.js,
   * and agent-manifest.json — copied into this package by its build
   * (scripts/copy-agent.mjs). Resolved at the composition root; tests inject one.
   */
  agentDir: string;
  state: OpsState;
  store: StateStore;
  logger: Logger;
  /** Persist the working state to S3. */
  save(): Promise<void>;
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

export interface ConfigSource {
  env: string;
  /** Repo root the default config candidates resolve against. */
  root: string;
  /** Explicit config file; when set it is the only candidate. */
  configPath?: string | undefined;
}

/** Load and parse the first config candidate that exists. Exported for tests. */
export async function loadConfig(fs: FileSystem, source: ConfigSource): Promise<OpsConfig> {
  const candidates = source.configPath
    ? [source.configPath]
    : [
        resolve(source.root, `config/${source.env}.jsonc`),
        resolve(source.root, 'ops.config.jsonc'),
      ];
  for (const path of candidates) {
    try {
      return parseConfig(await fs.readText(path));
    } catch (err) {
      if (!(err instanceof FileNotFoundError)) throw err;
    }
  }
  throw new Error(
    `no config found for environment "${source.env}" — looked for ${candidates.join(', ')}`,
  );
}

/**
 * Build the runtime context: load config, resolve the account id, derive names, create
 * clients, and load topology state from S3. The state bucket name is deterministic, which
 * resolves the bootstrap chicken-and-egg. This is the composition root — the only place
 * real adapters are constructed and wired.
 */
export async function createContext(opts: ContextOptions): Promise<OpsContext> {
  const ports: Ports = {
    fs: opts.ports?.fs ?? createNodeFileSystem(),
    vcs: opts.ports?.vcs ?? createProcessVcs(),
    terminal: opts.ports?.terminal ?? createNodeTerminal(),
    ping: opts.ports?.ping ?? createFetchPing(),
  };
  const logger = createLogger(ports.terminal);
  const agentDir = fileURLToPath(new URL('../agent', import.meta.url));
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
    state,
    store,
    logger,
    save: async () => {
      await store.save(state);
    },
  };
  return ctx;
}
