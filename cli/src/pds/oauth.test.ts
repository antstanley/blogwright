import { JoseKey } from '@atproto/oauth-client-node';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from '../context.js';
import { login, openPdsRepo, publicClientJwk, verifyClientAssets } from './oauth.js';

const DID = 'did:plc:test';

function ctxWith(secret: object | undefined): OpsContext {
  const logged: string[] = [];
  return {
    domain: 'iamstan.dev',
    config: { pds: { name: 'Ant Stanley', secretName: 's' } },
    clients: {
      secrets: { getSecretValue: async () => (secret ? JSON.stringify(secret) : undefined) },
    },
    logger: {
      info: (m: string) => logged.push(m),
      ok: (m: string) => logged.push(m),
    },
  } as unknown as OpsContext;
}

async function generatedKey(): Promise<Record<string, unknown>> {
  const key = await JoseKey.generate(['ES256'], 'test-key');
  return key.privateJwk as Record<string, unknown>;
}

describe('publicClientJwk', () => {
  it('strips private material and keeps the public point', async () => {
    const privateJwk = await generatedKey();
    const publicJwk = await publicClientJwk(privateJwk);
    expect(publicJwk.d).toBeUndefined();
    expect(publicJwk.kty).toBe('EC');
    expect(publicJwk.x).toBe(privateJwk.x);
    expect(publicJwk.kid).toBe('test-key');
  });
});

describe('verifyClientAssets', () => {
  async function ctxAndDocs() {
    const clientKey = await generatedKey();
    const ctx = ctxWith({ version: 1, clientKey });
    const metadataUrl = 'https://iamstan.dev/oauth/client-metadata.json';
    const jwks = { keys: [await publicClientJwk(clientKey)] };
    return { ctx, metadataUrl, jwks };
  }

  function serving(docs: Record<string, unknown>): typeof fetch {
    return (async (input: string | URL | Request) => {
      const doc = docs[String(input)];
      if (!doc) return new Response('nope', { status: 404 });
      return Response.json(doc);
    }) as typeof fetch;
  }

  it('passes when the deployed documents match', async () => {
    const { ctx, metadataUrl, jwks } = await ctxAndDocs();
    // fetch the expected metadata by serving exactly what the CLI computes
    const { clientMetadata } = await import('./client-metadata.js');
    const docs = {
      [metadataUrl]: clientMetadata('iamstan.dev', { name: 'Ant Stanley', secretName: 's' }),
      'https://iamstan.dev/oauth/jwks.json': jwks,
    };
    await expect(verifyClientAssets(ctx, serving(docs))).resolves.toBeUndefined();
  });

  it('fails with a deploy hint when a document is missing', async () => {
    const { ctx } = await ctxAndDocs();
    await expect(verifyClientAssets(ctx, serving({}))).rejects.toThrow(/not deployed/);
  });

  it('fails with a drift hint when a document differs', async () => {
    const { ctx, metadataUrl, jwks } = await ctxAndDocs();
    const docs = {
      [metadataUrl]: { client_id: 'https://elsewhere.example/meta.json' },
      'https://iamstan.dev/oauth/jwks.json': jwks,
    };
    await expect(verifyClientAssets(ctx, serving(docs))).rejects.toThrow(/does not match/);
  });

  it('points at keygen when the secret has no client key', async () => {
    const ctx = ctxWith({ version: 1 });
    await expect(verifyClientAssets(ctx, serving({}))).rejects.toThrow(/pds keygen/);
  });
});

describe('login', () => {
  const noVerify = async () => undefined;

  it('authorizes, prompts for the callback URL, and completes the flow', async () => {
    const ctx = ctxWith({ version: 1 });
    const calls: string[] = [];
    const did = await login(ctx, 'ant.example', {
      promptLine: async () => 'https://iamstan.dev/oauth/callback?code=c1&state=s1&iss=i1',
      verifyAssets: noVerify,
      flow: {
        authorize: async (input) => {
          calls.push(`authorize:${input}`);
          return new URL('https://pds.example/authorize?request_uri=x');
        },
        callback: async (params) => {
          calls.push(`callback:${params.get('code')}:${params.get('state')}`);
          return { session: { did: DID } };
        },
      },
    });
    expect(did).toBe(DID);
    expect(calls).toEqual(['authorize:ant.example', 'callback:c1:s1']);
  });

  it('rejects a pasted value that is not a URL', async () => {
    const ctx = ctxWith({ version: 1 });
    await expect(
      login(ctx, 'ant.example', {
        promptLine: async () => 'c1',
        verifyAssets: noVerify,
        flow: {
          authorize: async () => new URL('https://pds.example/authorize'),
          callback: async () => ({ session: { did: DID } }),
        },
      }),
    ).rejects.toThrow(/not a URL/);
  });

  it('surfaces an authorization error from the callback params', async () => {
    const ctx = ctxWith({ version: 1 });
    await expect(
      login(ctx, 'ant.example', {
        promptLine: async () =>
          'https://iamstan.dev/oauth/callback?error=access_denied&error_description=nope',
        verifyAssets: noVerify,
        flow: {
          authorize: async () => new URL('https://pds.example/authorize'),
          callback: async () => ({ session: { did: DID } }),
        },
      }),
    ).rejects.toThrow(/access_denied/);
  });
});

describe('openPdsRepo', () => {
  it('points at login when the secret has no session', async () => {
    const ctx = ctxWith({ version: 1, clientKey: await generatedKey() });
    await expect(openPdsRepo(ctx)).rejects.toThrow(/pds login/);
  });

  it('points at keygen when the secret has no client key', async () => {
    const ctx = ctxWith({ version: 1, did: DID });
    await expect(openPdsRepo(ctx)).rejects.toThrow(/pds keygen/);
  });
});
