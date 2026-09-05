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
      return response(200, '{"version":1,"env":"test","resources":{}}');
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

describe.each([undefined, 'analytics'])('StateStore persisted shape (scope %s)', (scope) => {
  const key = scope === undefined ? 'state/test.json' : 'state/test.analytics.json';
  const load = (body: string) =>
    new StateStore(
      s3With(async () => response(200, body)),
      'bucket',
      'test',
      scope,
    ).load();
  const valid = { version: 7, env: 'historical-env', resources: {} };

  it.each([
    ['null envelope', null, 'state'],
    ['array envelope', [], 'state'],
    ['string envelope', 'secret-value', 'state'],
    ['number envelope', 1, 'state'],
    ['boolean envelope', false, 'state'],
    ['missing version', { env: 'test', resources: {} }, 'version'],
    ['string version', { ...valid, version: 'secret-value' }, 'version'],
    ['missing env', { version: 1, resources: {} }, 'env'],
    ['numeric env', { ...valid, env: 2 }, 'env'],
    ['null timestamp', { ...valid, updatedAt: null }, 'updatedAt'],
    ['numeric timestamp', { ...valid, updatedAt: 2 }, 'updatedAt'],
    ['missing resources', { version: 1, env: 'test' }, 'resources'],
    ['null resources', { ...valid, resources: null }, 'resources'],
    ['array resources', { ...valid, resources: [] }, 'resources'],
    ['string resources', { ...valid, resources: 'secret-value' }, 'resources'],
    ...[null, [], 'secret-value', 42, false].map<[string, unknown, string]>((outputs) => [
      'invalid output object',
      { ...valid, resources: { node: outputs } },
      'resources["node"]',
    ]),
    ...[null, {}, [1], [false], [['nested']], ['secret-value', 1]].map<[string, unknown, string]>(
      (output) => [
        'invalid output value',
        { ...valid, resources: { node: { output } } },
        'resources["node"]["output"]',
      ],
    ),
  ])('rejects %s without leaking values', async (_name, state, field) => {
    await expect(load(JSON.stringify(state))).rejects.toThrow(
      `${key} in s3://bucket has invalid state field ${field}`,
    );
    await expect(load(JSON.stringify(state))).rejects.not.toThrow('secret-value');
  });

  it('preserves historical typed values, omitted timestamp and unknown fields', async () => {
    const state = {
      ...valid,
      version: -2.5,
      extra: { future: null },
      resources: {
        'arbitrary / node': {
          '': '',
          number: 3.5,
          yes: true,
          no: false,
          strings: ['a', 'b'],
          empty: [],
        },
      },
    };
    expect(await load(JSON.stringify(state))).toEqual(state);
    expect(await load(JSON.stringify({ ...state, updatedAt: 'not an ISO date' }))).toEqual({
      ...state,
      updatedAt: 'not an ISO date',
    });
    expect(await load(JSON.stringify(emptyState('test')))).toEqual({
      version: 1,
      env: 'test',
      resources: {},
    });
  });

  it('round-trips every supported output through save and load', async () => {
    let body = '';
    const transport: Transport = async (request) => {
      if (request.method === 'PUT')
        body =
          typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body);
      return response(200, body);
    };
    const store = new StateStore(s3With(transport), 'bucket', 'test', scope);
    const state = {
      ...emptyState('test'),
      resources: { node: { text: '', number: 0, yes: true, no: false, strings: ['a'], empty: [] } },
    };
    await store.save(state);
    expect(await store.load()).toEqual(state);
    expect(typeof state.updatedAt).toBe('string');
  });

  it.each(['NoSuchKey', 'NoSuchBucket'])('retains empty-state behavior for %s', async (code) => {
    const store = new StateStore(
      s3With(async () => response(404, `<Error><Code>${code}</Code></Error>`)),
      'bucket',
      'test',
      scope,
    );
    expect(await store.load()).toEqual(emptyState('test'));
  });

  it.each(['', 'not json'])('preserves syntax error context and cause for %j', async (body) => {
    await expect(load(body)).rejects.toMatchObject({
      message: `${key} in s3://bucket is not valid JSON - refusing to proceed with empty state`,
      cause: expect.any(SyntaxError),
    });
  });
});
