/**
 * Test-only PdsContext factory. Builds a real, fully-typed context over
 * in-memory adapters: file access hits a Map-backed FileSystem, and every
 * secrets-client method a test has not overridden fails fast at the transport.
 * Tests substitute behaviour here — at the ports — never by casting.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createClients,
  createMemoryFileSystem,
  mergeConfig,
  staticCredentials,
  type FileSystem,
  type OpsConfig,
  type SecretsManagerClient,
  type Terminal,
  type Transport,
} from 'blogwright-core';

import type { PdsContext, PdsLogger } from './context.js';

export interface TestContextOverrides {
  env?: string | undefined;
  domain?: string | undefined;
  config?: Partial<OpsConfig> | undefined;
  clients?: { secrets?: Partial<SecretsManagerClient> | undefined } | undefined;
  logger?: Partial<PdsLogger> | undefined;
  ports?: { fs?: FileSystem | undefined; terminal?: Terminal | undefined } | undefined;
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
function testSecrets(
  region: string,
  overrides: Partial<SecretsManagerClient> | undefined,
): SecretsManagerClient {
  const base = createClients({
    region,
    credentials: staticCredentials({ accessKeyId: 'test', secretAccessKey: 'test' }),
    transport: rejectAllTransport,
  }).secrets;
  if (!overrides) return base;
  return Object.assign(Object.create(base) as SecretsManagerClient, overrides);
}

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

const NOOP_LOGGER: PdsLogger = {
  info: () => undefined,
  step: () => undefined,
  ok: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Create a unique real-disk directory for a node-adapter integration test. */
export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

/** Delete a directory created by {@link makeTempDir}. */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Build a complete PdsContext for tests. Defaults: env "test", site "example",
 * config merged over DEFAULT_CONFIG, a fresh in-memory FileSystem, a silent
 * terminal, a secrets client that fails fast until overridden, and a silent
 * logger.
 */
export function createTestContext(overrides: TestContextOverrides = {}): PdsContext {
  const config = mergeConfig({ siteName: 'example', ...overrides.config });
  return {
    env: overrides.env ?? 'test',
    domain: overrides.domain,
    config,
    clients: { secrets: testSecrets(config.region, overrides.clients?.secrets) },
    ports: {
      fs: overrides.ports?.fs ?? createMemoryFileSystem(),
      terminal: overrides.ports?.terminal ?? silentTerminal,
    },
    logger: { ...NOOP_LOGGER, ...overrides.logger },
  };
}
