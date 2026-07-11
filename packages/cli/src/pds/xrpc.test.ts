import { describe, expect, it } from 'vitest';

import { PdsClient, XrpcError, rkeyFromUri } from './xrpc.js';

type Handler = (pathname: string, init: RequestInit) => { status: number; body: unknown };

function client(handler: Handler): PdsClient {
  const transport = async (pathname: string, init?: RequestInit) => {
    const { status, body } = handler(pathname, init ?? {});
    return new Response(JSON.stringify(body), { status });
  };
  return new PdsClient('did:plc:me', transport);
}

describe('PdsClient', () => {
  it('sends PDS-relative pathnames with the repo DID in the query', async () => {
    let seen: string | undefined;
    const c = client((pathname) => {
      seen = pathname;
      return { status: 200, body: { records: [] } };
    });
    await c.listRecords('site.standard.document');
    expect(seen).toBe(
      '/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Ame&collection=site.standard.document&limit=100',
    );
  });

  it('paginates listRecords with the cursor until exhausted', async () => {
    const pages = [
      { records: [{ uri: 'at://x/c/r1', cid: 'c', value: {} }], cursor: 'next' },
      { records: [{ uri: 'at://x/c/r2', cid: 'c', value: {} }] },
    ];
    let call = 0;
    const c = client((pathname) => {
      const cursor = new URLSearchParams(pathname.split('?')[1]).get('cursor');
      expect(cursor).toBe(call === 0 ? null : 'next');
      return { status: 200, body: pages[call++] };
    });
    const records = await c.listRecords('c');
    expect(records.map((r) => r.uri)).toEqual(['at://x/c/r1', 'at://x/c/r2']);
  });

  it('posts JSON bodies with the repo DID', async () => {
    let seenBody: string | undefined;
    let seenType: string | null = null;
    const c = client((_pathname, init) => {
      seenBody = String(init.body);
      seenType = new Headers(init.headers).get('content-type');
      return { status: 200, body: { uri: 'at://x/c/r' } };
    });
    await c.putRecord('c', 'r', { $type: 'c' });
    expect(seenType).toBe('application/json');
    expect(JSON.parse(seenBody!)).toEqual({
      repo: 'did:plc:me',
      collection: 'c',
      rkey: 'r',
      record: { $type: 'c' },
    });
  });

  it('maps error bodies to XrpcError and treats RecordNotFound as undefined', async () => {
    const c = client(() => ({
      status: 400,
      body: { error: 'RecordNotFound', message: 'nope' },
    }));
    expect(await c.getRecord('c', 'r')).toBeUndefined();
    await expect(c.putRecord('c', 'r', {})).rejects.toThrow(XrpcError);
  });

  it('surfaces auth failures with the PDS error code', async () => {
    const c = client(() => ({
      status: 401,
      body: { error: 'InvalidToken', message: 'expired' },
    }));
    await expect(c.listRecords('c')).rejects.toThrow(/InvalidToken/);
  });
});

describe('rkeyFromUri', () => {
  it('takes the trailing segment', () => {
    expect(rkeyFromUri('at://did:plc:x/site.standard.publication/3abc')).toBe('3abc');
  });
});
