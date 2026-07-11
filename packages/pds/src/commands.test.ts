import { join } from 'node:path';

import { createNodeFileSystem, createScriptedTerminal } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { PdsContext } from './context.js';
import { createTestContext, makeTempDir, removeTempDir } from './test-support.js';
import { init, keygen, login, secretStatus, syncAfterDeploy } from './commands.js';
import type { LoginDeps } from './oauth.js';
import type { SyncSummary } from './sync.js';
import type { PdsClient } from './xrpc.js';

const ROOT = '/repo';

function ctx(
  env: string,
  pdsConfigured = true,
): PdsContext & { lines: string[]; stored: Record<string, string> } {
  const lines: string[] = [];
  const stored: Record<string, string> = {};
  const log = (prefix: string) => (msg: string) => lines.push(`${prefix}:${msg}`);
  const base = createTestContext({
    env,
    domain: 'example.com',
    config: pdsConfigured ? { pds: { name: 'Ant Stanley', secretName: 's' } } : {},
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
  });
  return Object.assign(base, { lines, stored });
}

async function markInitialised(c: PdsContext): Promise<void> {
  await c.ports.fs.writeText(
    `${ROOT}/public/.well-known/site.standard.publication`,
    'at://did:plc:me/site.standard.publication/r\n',
  );
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
    await keygen(c, ROOT, async () => CLIENT_KEY);

    const secret = JSON.parse(c.stored.s!);
    expect(secret.clientKey).toEqual(CLIENT_KEY);
    expect(secret.session).toBeUndefined();
    expect(secret.did).toBe('did:plc:me');

    const metadata = JSON.parse(
      await c.ports.fs.readText(`${ROOT}/public/oauth/client-metadata.json`),
    );
    expect(metadata.client_id).toBe('https://example.com/oauth/client-metadata.json');
    expect(metadata.token_endpoint_auth_method).toBe('private_key_jwt');

    const jwks = JSON.parse(await c.ports.fs.readText(`${ROOT}/public/oauth/jwks.json`));
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].d).toBeUndefined(); // never the private half
    expect(jwks.keys[0].x).toBe('x');
  });

  it('requires a configured domain', async () => {
    const c = ctx('production');
    (c as { domain: string | undefined }).domain = undefined;
    await expect(keygen(c, ROOT, async () => CLIENT_KEY)).rejects.toThrow(/domain/);
  });

  it('replaces a legacy app-password secret (the migration entry point)', async () => {
    const c = ctx('production');
    c.stored.s = JSON.stringify({ identifier: 'x', password: 'p' });
    await keygen(c, ROOT, async () => CLIENT_KEY);
    expect(JSON.parse(c.stored.s!)).toEqual({ version: 1, clientKey: CLIENT_KEY });
  });
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

describe('init', () => {
  it('creates the publication and writes both site files', async () => {
    const c = ctx('production');
    const { repo } = repoStub();
    await init(
      c,
      ROOT,
      async () => ({ did: 'did:plc:me', repo }),
      async () => undefined,
    );

    const wellKnown = await c.ports.fs.readText(
      `${ROOT}/public/.well-known/site.standard.publication`,
    );
    expect(wellKnown).toBe('at://did:plc:me/site.standard.publication/3new\n');
    const atproto = JSON.parse(await c.ports.fs.readText(`${ROOT}/src/data/atproto.json`));
    expect(atproto).toEqual({
      did: 'did:plc:me',
      publicationUri: 'at://did:plc:me/site.standard.publication/3new',
    });
  });

  it('updates in place when the well-known file already names a publication', async () => {
    const c = ctx('production');
    await markInitialised(c);
    const { repo, puts } = repoStub();
    await init(
      c,
      ROOT,
      async () => ({ did: 'did:plc:me', repo }),
      async () => undefined,
    );
    expect(puts).toEqual(['site.standard.publication/r']);
  });

  it('refuses a committed well-known that belongs to a different account', async () => {
    const c = ctx('production');
    await c.ports.fs.writeText(
      `${ROOT}/public/.well-known/site.standard.publication`,
      'at://did:plc:someone-else/site.standard.publication/r\n',
    );
    const { repo, puts } = repoStub();

    await expect(
      init(
        c,
        ROOT,
        async () => ({ did: 'did:plc:me', repo }),
        async () => undefined,
      ),
    ).rejects.toThrow(/different\s+account/);
    expect(puts).toEqual([]);
  });

  it('writes real files through the node adapter', async () => {
    const root = await makeTempDir('pds-init');
    try {
      const fs = createNodeFileSystem();
      const c = createTestContext({
        env: 'production',
        domain: 'example.com',
        config: { pds: { name: 'Ant Stanley', secretName: 's' } },
        ports: { fs },
      });
      const { repo } = repoStub();
      await init(
        c,
        root,
        async () => ({ did: 'did:plc:me', repo }),
        async () => undefined,
      );
      const wellKnown = await fs.readText(
        join(root, 'public/.well-known/site.standard.publication'),
      );
      expect(wellKnown).toBe('at://did:plc:me/site.standard.publication/3new\n');
      const atproto = JSON.parse(await fs.readText(join(root, 'src/data/atproto.json')));
      expect(atproto.did).toBe('did:plc:me');
    } finally {
      await removeTempDir(root);
    }
  });
});

describe('login', () => {
  it('round-trips the prompt through the terminal port, without a real stdin', async () => {
    const terminal = createScriptedTerminal({
      answers: ['https://example.com/oauth/callback?code=abc'],
    });
    const c = ctx('production');
    c.ports.terminal = terminal;
    let pasted: string | undefined;
    const runLogin = async (_c: PdsContext, identifier: string, deps: LoginDeps) => {
      pasted = await deps.promptLine(`Paste the callback URL for ${identifier}: `);
      return 'did:plc:me';
    };

    await login(c, { identifier: 'alice.example' }, runLogin);

    expect(terminal.prompts).toEqual(['Paste the callback URL for alice.example: ']);
    expect(pasted).toBe('https://example.com/oauth/callback?code=abc');
  });

  it('requires an identifier before touching the terminal', async () => {
    const c = ctx('production');
    const runLogin = async () => {
      throw new Error('must not be called');
    };

    await expect(login(c, {}, runLogin)).rejects.toThrow(
      'pds login requires --identifier <handle-or-did>',
    );
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
    await syncAfterDeploy(ctx('staging'), ROOT, count);
    await syncAfterDeploy(ctx('production', false), ROOT, count);
    expect(calls).toBe(0);
  });

  it('skips (with a note) when the site is not initialised', async () => {
    const c = ctx('production');
    let calls = 0;
    await syncAfterDeploy(c, ROOT, async () => ((calls += 1), SUMMARY));
    expect(calls).toBe(0);
    expect(c.lines.some((l) => l.includes('not initialised'))).toBe(true);
  });

  it('runs the sync and logs the summary when initialised', async () => {
    const c = ctx('production');
    await markInitialised(c);
    await syncAfterDeploy(c, ROOT, async () => SUMMARY);
    expect(c.lines.some((l) => l.startsWith('ok:') && l.includes('1 unchanged'))).toBe(true);
  });

  it('never lets a sync failure escape (deploy must not fail)', async () => {
    const c = ctx('production');
    await markInitialised(c);
    await expect(
      syncAfterDeploy(c, ROOT, async () => {
        throw new Error('PDS is down');
      }),
    ).resolves.toBeUndefined();
    expect(c.lines.some((l) => l.startsWith('warn:') && l.includes('PDS is down'))).toBe(true);
  });
});
