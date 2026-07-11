import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CONFIG } from '@iamstan/ops-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpsContext } from '../context.js';
import { init, keygen, secretStatus, syncAfterDeploy } from './commands.js';
import type { SyncSummary } from './sync.js';
import type { PdsClient } from './xrpc.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pds-hook-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function ctx(
  env: string,
  pdsConfigured = true,
): OpsContext & { lines: string[]; stored: Record<string, string> } {
  const lines: string[] = [];
  const stored: Record<string, string> = {};
  const log = (prefix: string) => (msg: string) => lines.push(`${prefix}:${msg}`);
  return {
    env,
    domain: 'iamstan.dev',
    config: pdsConfigured
      ? {
          siteName: 'iamstan',
          paths: DEFAULT_CONFIG.paths,
          pds: { name: 'Ant Stanley', secretName: 's' },
        }
      : { siteName: 'iamstan', paths: DEFAULT_CONFIG.paths },
    clients: {
      secrets: {
        getSecretValue: async (name: string) => stored[name],
        upsertSecret: async (name: string, value: string) => {
          stored[name] = value;
        },
        describeSecret: async (name: string) =>
          stored[name] ? { arn: 'arn:s', name, lastChangedDate: 1 } : undefined,
      },
    },
    logger: {
      info: log('info'),
      step: log('step'),
      ok: log('ok'),
      warn: log('warn'),
      error: log('error'),
    },
    lines,
    stored,
  } as unknown as OpsContext & { lines: string[]; stored: Record<string, string> };
}

async function markInitialised(): Promise<void> {
  await mkdir(join(root, 'public/.well-known'), { recursive: true });
  await writeFile(join(root, 'public/.well-known/site.standard.publication'), 'at://x/p/r\n');
}

const SUMMARY: SyncSummary = {
  publication: 'unchanged',
  created: [],
  updated: [],
  unchanged: 1,
  orphans: [],
};

const CLIENT_KEY = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'secret', kid: 'k1' };

describe('keygen', () => {
  it('stores the private key, clears the session, and writes the public documents', async () => {
    const c = ctx('production');
    c.stored.s = JSON.stringify({ version: 1, did: 'did:plc:me', session: { tokenSet: {} } });
    await keygen(c, root, async () => CLIENT_KEY);

    const secret = JSON.parse(c.stored.s!);
    expect(secret.clientKey).toEqual(CLIENT_KEY);
    expect(secret.session).toBeUndefined();
    expect(secret.did).toBe('did:plc:me');

    const metadata = JSON.parse(
      await readFile(join(root, 'public/oauth/client-metadata.json'), 'utf8'),
    );
    expect(metadata.client_id).toBe('https://iamstan.dev/oauth/client-metadata.json');
    expect(metadata.token_endpoint_auth_method).toBe('private_key_jwt');

    const jwks = JSON.parse(await readFile(join(root, 'public/oauth/jwks.json'), 'utf8'));
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].d).toBeUndefined(); // never the private half
    expect(jwks.keys[0].x).toBe('x');
  });

  it('requires a configured domain', async () => {
    const c = ctx('production');
    (c as { domain: string | undefined }).domain = undefined;
    await expect(keygen(c, root, async () => CLIENT_KEY)).rejects.toThrow(/domain/);
  });

  it('replaces a legacy app-password secret (the migration entry point)', async () => {
    const c = ctx('production');
    c.stored.s = JSON.stringify({ identifier: 'x', password: 'p' });
    await keygen(c, root, async () => CLIENT_KEY);
    expect(JSON.parse(c.stored.s!)).toEqual({ version: 1, clientKey: CLIENT_KEY });
  });
});

describe('init', () => {
  beforeEach(async () => {
    await mkdir(join(root, 'src/data'), { recursive: true }); // exists in the real repo
  });

  function repoStub() {
    const puts: string[] = [];
    const repo = {
      putRecord: async (collection: string, rkey: string) => {
        puts.push(`${collection}/${rkey}`);
        return { uri: `at://did:plc:me/${collection}/${rkey}` };
      },
      createRecord: async (collection: string) => ({
        uri: `at://did:plc:me/${collection}/3new`,
      }),
    } as unknown as PdsClient;
    return { repo, puts };
  }

  it('creates the publication and writes both site files', async () => {
    const c = ctx('production');
    const { repo } = repoStub();
    await init(
      c,
      root,
      async () => ({ did: 'did:plc:me', repo }),
      async () => undefined,
    );

    const wellKnown = await readFile(
      join(root, 'public/.well-known/site.standard.publication'),
      'utf8',
    );
    expect(wellKnown).toBe('at://did:plc:me/site.standard.publication/3new\n');
    const atproto = JSON.parse(await readFile(join(root, 'src/data/atproto.json'), 'utf8'));
    expect(atproto).toEqual({
      did: 'did:plc:me',
      publicationUri: 'at://did:plc:me/site.standard.publication/3new',
    });
  });

  it('updates in place when the well-known file already names a publication', async () => {
    await markInitialised();
    const c = ctx('production');
    const { repo, puts } = repoStub();
    await init(
      c,
      root,
      async () => ({ did: 'did:plc:me', repo }),
      async () => undefined,
    );
    expect(puts).toEqual(['site.standard.publication/r']);
  });
});

describe('secretStatus', () => {
  it('reports which parts the secret holds without printing values', async () => {
    const c = ctx('production');
    c.stored.s = JSON.stringify({ version: 1, clientKey: CLIENT_KEY, did: 'did:plc:me' });
    await secretStatus(c);
    const text = c.lines.join('\n');
    expect(text).toContain('client key    yes (k1)');
    expect(text).toContain('did           did:plc:me');
    expect(text).toContain('session       no');
    expect(text).not.toContain('secret');
  });

  it('surfaces the migration hint for a legacy app-password secret', async () => {
    const c = ctx('production');
    c.stored.s = JSON.stringify({ identifier: 'x', password: 'p' });
    await secretStatus(c);
    expect(c.lines.some((l) => l.startsWith('warn:') && l.includes('app passwords'))).toBe(true);
  });
});

describe('syncAfterDeploy', () => {
  it('does nothing outside production or when pds is unconfigured', async () => {
    let calls = 0;
    const count = async () => ((calls += 1), SUMMARY);
    await syncAfterDeploy(ctx('staging'), root, count);
    await syncAfterDeploy(ctx('production', false), root, count);
    expect(calls).toBe(0);
  });

  it('skips (with a note) when the site is not initialised', async () => {
    const c = ctx('production');
    let calls = 0;
    await syncAfterDeploy(c, root, async () => ((calls += 1), SUMMARY));
    expect(calls).toBe(0);
    expect(c.lines.some((l) => l.includes('not initialised'))).toBe(true);
  });

  it('runs the sync and logs the summary when initialised', async () => {
    await markInitialised();
    const c = ctx('production');
    await syncAfterDeploy(c, root, async () => SUMMARY);
    expect(c.lines.some((l) => l.startsWith('ok:') && l.includes('1 unchanged'))).toBe(true);
  });

  it('never lets a sync failure escape (deploy must not fail)', async () => {
    await markInitialised();
    const c = ctx('production');
    await expect(
      syncAfterDeploy(c, root, async () => {
        throw new Error('PDS is down');
      }),
    ).resolves.toBeUndefined();
    expect(c.lines.some((l) => l.startsWith('warn:') && l.includes('PDS is down'))).toBe(true);
  });
});
