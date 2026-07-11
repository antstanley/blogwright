/**
 * Test-only OpsContext factory. Builds a real, fully-typed context over
 * in-memory adapters: file access hits a Map-backed FileSystem, and every AWS
 * client method that a test has not overridden fails fast at the transport.
 * Tests substitute behaviour here — at the ports — never by casting.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createClients,
  createMemoryFileSystem,
  deriveNames,
  emptyState,
  mergeConfig,
  staticCredentials,
  StateStore,
  type AwsClients,
  type Names,
  type OpsConfig,
  type OpsState,
  type Terminal,
  type Transport,
} from 'blogwright-core';

import type { OpsContext } from './context.js';
import type { Logger } from './logger.js';
import type { PingBuilder, Ports, Vcs } from './ports.js';

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
  save?: (() => Promise<void>) | undefined;
}

const rejectAllTransport: Transport = async (req) => {
  throw new Error(
    `unexpected AWS request in test: ${req.method} ${req.url} — override the client method on createTestContext`,
  );
};

/**
 * Layer test overrides over a real client so untouched methods still fail fast.
 * Overrides must be plain objects of methods (own properties) — a class
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
      `unexpected VCS call in test: revisionHash(${cwd}) — override ports.vcs on createTestContext`,
    );
  },
  listFiles: async (cwd) => {
    throw new Error(
      `unexpected VCS call in test: listFiles(${cwd}) — override ports.vcs on createTestContext`,
    );
  },
};

/** Pings are best-effort fire-and-forget by contract; the default resolves silently. */
const noopPing: PingBuilder = async () => undefined;

/** Silent, non-interactive terminal; a prompt in a test is a missing override. */
const silentTerminal: Terminal = {
  isInteractive: false,
  write: () => undefined,
  error: () => undefined,
  question: async (prompt) => {
    throw new Error(
      `unexpected terminal prompt in test: ${prompt} — override ports.terminal on createTestContext`,
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
  };

  return {
    env,
    domain: overrides.domain,
    preview: overrides.preview ?? false,
    config,
    names,
    accountId,
    clients,
    ports,
    agentDir: overrides.agentDir ?? TEST_AGENT_DIR,
    state,
    store: new StateStore(clients.s3, names.bucket, env),
    logger: { ...NOOP_LOGGER, ...overrides.logger },
    save: overrides.save ?? (async () => undefined),
  };
}
