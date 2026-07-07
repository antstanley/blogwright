import { describe, expect, it } from 'vitest';

import { PdsClient, XrpcError, rkeyFromUri } from './xrpc.js';

type Handler = (url: URL, init: RequestInit) => { status: number; body: unknown };

function client(handler: Handler): PdsClient {
  const transport = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const { status, body } = handler(new URL(String(input)), init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return new PdsClient('https://pds.example', transport);
}

async function authed(handler: Handler): Promise<PdsClient> {
  const c = client((url, init) => {
    if (url.pathname === '/xrpc/com.atproto.server.createSession') {
      return { status: 200, body: { did: 'did:plc:me', accessJwt: 'jwt-1' } };
    }
    return handler(url, init);
  });
  await c.createSession('me.example', 'pass');
  return c;
}

describe('PdsClient', () => {
  it('authenticates and sends the bearer token on subsequent calls', async () => {
    let seenAuth: string | undefined;
    const c = await authed((url, init) => {
      seenAuth = new Headers(init.headers).get('authorization') ?? undefined;
      return { status: 200, body: { records: [] } };
    });
    await c.listRecords('site.standard.document');
    expect(seenAuth).toBe('Bearer jwt-1');
  });

  it('requires a session before repo calls', async () => {
    const c = client(() => ({ status: 200, body: {} }));
    await expect(c.listRecords('x')).rejects.toThrow(/createSession/);
  });

  it('paginates listRecords with the cursor until exhausted', async () => {
    const pages = [
      { records: [{ uri: 'at://x/c/r1', cid: 'c', value: {} }], cursor: 'next' },
      { records: [{ uri: 'at://x/c/r2', cid: 'c', value: {} }] },
    ];
    let call = 0;
    const c = await authed((url) => {
      expect(url.searchParams.get('cursor')).toBe(call === 0 ? null : 'next');
      return { status: 200, body: pages[call++] };
    });
    const records = await c.listRecords('c');
    expect(records.map((r) => r.uri)).toEqual(['at://x/c/r1', 'at://x/c/r2']);
  });

  it('maps error bodies to XrpcError and treats RecordNotFound as undefined', async () => {
    const c = await authed(() => ({
      status: 400,
      body: { error: 'RecordNotFound', message: 'nope' },
    }));
    expect(await c.getRecord('c', 'r')).toBeUndefined();
    await expect(c.putRecord('c', 'r', {})).rejects.toThrow(XrpcError);
  });

  it('surfaces auth failures with the PDS error code', async () => {
    const c = client(() => ({
      status: 401,
      body: { error: 'AuthenticationRequired', message: 'Invalid identifier or password' },
    }));
    await expect(c.createSession('me', 'bad')).rejects.toThrow(/AuthenticationRequired/);
  });
});

describe('rkeyFromUri', () => {
  it('takes the trailing segment', () => {
    expect(rkeyFromUri('at://did:plc:x/site.standard.publication/3abc')).toBe('3abc');
  });
});
