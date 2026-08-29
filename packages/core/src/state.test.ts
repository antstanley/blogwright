import { describe, expect, it } from 'vitest';

import { staticCredentials } from './aws/credentials.js';
import { S3Client } from './aws/s3.js';
import { SigningClient, type RawResponse, type Transport } from './aws/signer.js';
import { emptyState, StateStore } from './state.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function s3With(transport: Transport): S3Client {
  return new S3Client(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

interface Captured {
  method: string;
  path: string;
}

/** GET returns a valid (empty-resources) document; PUT/DELETE just succeed. */
function capturingTransport(): { transport: Transport; requests: Captured[] } {
  const requests: Captured[] = [];
  const transport: Transport = async (req) => {
    requests.push({ method: req.method, path: new URL(req.url).pathname });
    if (req.method === 'GET') {
      return response(200, '{"version":1,"env":"test","updatedAt":null,"resources":{}}');
    }
    return response(200, '');
  };
  return { transport, requests };
}

describe('StateStore key routing', () => {
  it('an unscoped store addresses state/test.json for load, save and delete', async () => {
    const { transport, requests } = capturingTransport();
    const store = new StateStore(s3With(transport), 'bucket', 'test');

    await store.load();
    await store.save(emptyState('test'));
    await store.delete();

    expect(requests).toEqual([
      { method: 'GET', path: '/bucket/state/test.json' },
      { method: 'PUT', path: '/bucket/state/test.json' },
      { method: 'DELETE', path: '/bucket/state/test.json' },
    ]);
  });

  it('a store scoped to a plugin addresses state/test.analytics.json for load, save and delete', async () => {
    const { transport, requests } = capturingTransport();
    const store = new StateStore(s3With(transport), 'bucket', 'test', 'analytics');

    await store.load();
    await store.save(emptyState('test'));
    await store.delete();

    expect(requests).toEqual([
      { method: 'GET', path: '/bucket/state/test.analytics.json' },
      { method: 'PUT', path: '/bucket/state/test.analytics.json' },
      { method: 'DELETE', path: '/bucket/state/test.analytics.json' },
    ]);
  });
});

describe('StateStore corrupt state', () => {
  it('a scoped store fed non-JSON reports its own key, not the site key', async () => {
    const transport: Transport = async () => response(200, 'not json');
    const store = new StateStore(s3With(transport), 'bucket', 'test', 'analytics');

    await expect(store.load()).rejects.toThrow('state/test.analytics.json');
  });

  it('an unscoped store fed non-JSON reports the unscoped key', async () => {
    const transport: Transport = async () => response(200, 'not json');
    const store = new StateStore(s3With(transport), 'bucket', 'test');

    await expect(store.load()).rejects.toThrow('state/test.json');
  });
});

describe('StateStore scope validation', () => {
  function build(scope: string): () => StateStore {
    return () =>
      new StateStore(
        s3With(async () => response(200, '')),
        'the-bucket',
        'test',
        scope,
      );
  }

  it('rejects a scope containing a slash, naming it', () => {
    expect(build('a/b')).toThrow('"a/b"');
  });

  it('rejects a scope of "..", naming it', () => {
    expect(build('..')).toThrow('".."');
  });

  it('rejects an empty scope, naming it', () => {
    expect(build('')).toThrow('""');
  });

  it('names the store bucket alongside the offending scope', () => {
    expect(build('a/b')).toThrow('the-bucket');
  });

  it('accepts a lowercase alphanumeric/dash scope', () => {
    expect(build('analytics-2')).not.toThrow();
  });
});
