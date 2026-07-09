import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createClients,
  deriveNames,
  DEFAULT_CONFIG,
  mergeConfig,
  parseConfig,
  StateStore,
  type AwsClients,
  type Names,
  type OpsConfig,
  type OpsState,
} from '@iamstan/ops-core';

import { createLogger, type Logger } from './logger.js';
import { findRepoRoot } from './repo-root.js';

export interface OpsContext {
  env: string;
  domain: string | undefined;
  /** True for the shared preview stack (host-routed, per-PR prefixes). */
  preview: boolean;
  config: OpsConfig;
  names: Names;
  accountId: string;
  clients: AwsClients;
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
}

async function loadConfig(env: string, configPath: string | undefined): Promise<OpsConfig> {
  const root = findRepoRoot();
  const candidates = configPath
    ? [configPath]
    : [
        resolve(root, `ops/config/${env}.jsonc`),
        resolve(root, `config/${env}.jsonc`),
        resolve(root, 'ops.config.jsonc'),
      ];
  for (const path of candidates) {
    try {
      const text = await readFile(path, 'utf8');
      return parseConfig(text);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  // No file found — fall back to built-in defaults.
  return mergeConfig({ ...DEFAULT_CONFIG });
}

/**
 * Build the runtime context: load config, resolve the account id, derive names, create
 * clients, and load topology state from S3. The state bucket name is deterministic, which
 * resolves the bootstrap chicken-and-egg.
 */
export async function createContext(opts: ContextOptions): Promise<OpsContext> {
  const logger = createLogger();
  const config = await loadConfig(opts.env, opts.configPath);
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
    state,
    store,
    logger,
    save: async () => {
      await store.save(state);
    },
  };
  return ctx;
}
