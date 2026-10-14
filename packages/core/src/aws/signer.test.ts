import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { staticCredentials } from './credentials.js';
import { THROTTLE_RETRY, SigningClient, type Transport } from './signer.js';

function capture(): {
  transport: Transport;
  last: () => { url: string; headers: Record<string, string> };
} {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const transport: Transport = async (req) => {
    seen = { url: req.url, headers: req.headers };
    return { statusCode: 200, headers: {}, body: new Uint8Array(), text: () => '' };
  };
  return { transport, last: () => seen! };
}

const credentials = staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' });

describe('SigningClient', () => {
  it('signs with a SigV4 Authorization header scoped to the service/region', async () => {
    const cap = capture();
    const client = new SigningClient({
      region: 'us-east-1',
      credentials,
      transport: cap.transport,
    });
    await client.send({ service: 's3', method: 'GET', path: '/my-bucket/key.txt' });

    const { headers, url } = cap.last();
    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers['authorization']).toContain('/us-east-1/s3/aws4_request');
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(url).toBe('https://s3.us-east-1.amazonaws.com/my-bucket/key.txt');
  });

  it('routes to an override origin and serialises query params', async () => {
    const cap = capture();
    const client = new SigningClient({
      region: 'us-east-1',
      endpointOverride: 'http://localhost:4566',
      credentials,
      transport: cap.transport,
    });
    await client.send({
      service: 's3',
      method: 'GET',
      path: '/b',
      query: { 'list-type': '2', prefix: 'site/' },
    });
    expect(cap.last().url).toBe('http://localhost:4566/b?list-type=2&prefix=site%2F');
  });

  it('throws a structured AwsError on 4xx', async () => {
    const transport: Transport = async () => ({
      statusCode: 404,
      headers: {},
      body: new Uint8Array(),
      text: () => '<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>',
    });
    const client = new SigningClient({ region: 'us-east-1', credentials, transport });
    await expect(client.send({ service: 's3', method: 'GET', path: '/b/k' })).rejects.toMatchObject(
      {
        code: 'NoSuchKey',
        statusCode: 404,
      },
    );
  });

  it('labels the AwsError with the service NAME, not its signing name', async () => {
    // `microvms` is the only core key where the two differ - SIGNING_NAMES
    // maps it to 'lambda' because MicroVMs is served off the standard Lambda
    // endpoint. Everywhere else they coincide, so swapping resolved.name for
    // resolved.signingName at signer.ts's parseError call passes the entire
    // core suite while silently relabelling every MicroVM AwsError as
    // 'lambda' - the wrong service in the one field an operator reads first.
    const transport: Transport = async () => ({
      statusCode: 400,
      headers: {},
      body: new Uint8Array(),
      text: () => '<Error><Code>ValidationException</Code><Message>bad</Message></Error>',
    });
    const client = new SigningClient({ region: 'us-east-1', credentials, transport });
    await expect(
      client.send({ service: 'microvms', method: 'GET', path: '/2025-09-09/microvm-images' }),
    ).rejects.toMatchObject({ service: 'microvms', code: 'ValidationException' });
  });
});

describe('SigningClient with a plugin-supplied service descriptor', () => {
  // Frozen so a ServiceKey request and its equivalent-descriptor request sign
  // against the same x-amz-date; every other input (path, query, body,
  // credentials) is already identical, so a frozen clock is what makes the
  // two Authorization headers provably byte-identical rather than merely
  // "usually" identical.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces a byte-identical canonical request and Authorization header to the equivalent ServiceKey - s3', async () => {
    const capKey = capture();
    await new SigningClient({ region: 'us-east-1', credentials, transport: capKey.transport }).send(
      { service: 's3', method: 'GET', path: '/my-bucket/key.txt' },
    );

    const capDescriptor = capture();
    await new SigningClient({
      region: 'us-east-1',
      credentials,
      transport: capDescriptor.transport,
    }).send({
      service: { service: 's3', signingName: 's3' },
      method: 'GET',
      path: '/my-bucket/key.txt',
    });

    expect(capDescriptor.last()).toEqual(capKey.last());
  });

  it('produces a byte-identical canonical request and Authorization header to the equivalent ServiceKey - logs', async () => {
    const capKey = capture();
    await new SigningClient({ region: 'eu-west-1', credentials, transport: capKey.transport }).send(
      { service: 'logs', method: 'POST', path: '/', body: '{}' },
    );

    const capDescriptor = capture();
    await new SigningClient({
      region: 'eu-west-1',
      credentials,
      transport: capDescriptor.transport,
    }).send({
      service: { service: 'logs', signingName: 'logs' },
      method: 'POST',
      path: '/',
      body: '{}',
    });

    expect(capDescriptor.last()).toEqual(capKey.last());
  });

  it('signs a descriptor named "s3" without path escaping, and every other descriptor with it', async () => {
    const path = '/bucket/a%20b.txt';

    const capS3Key = capture();
    await new SigningClient({
      region: 'us-east-1',
      credentials,
      transport: capS3Key.transport,
    }).send({ service: 's3', method: 'GET', path });

    const capS3Descriptor = capture();
    await new SigningClient({
      region: 'us-east-1',
      credentials,
      transport: capS3Descriptor.transport,
    }).send({ service: { service: 's3', signingName: 's3' }, method: 'GET', path });

    const capOtherDescriptor = capture();
    await new SigningClient({
      region: 'us-east-1',
      credentials,
      transport: capOtherDescriptor.transport,
    }).send({ service: { service: 'glue', signingName: 'glue' }, method: 'GET', path });

    // uriEscapePath: false for the s3 descriptor, same as the s3 ServiceKey - the
    // regression this guards is `opts.service !== 's3'` comparing the descriptor
    // object itself, which is never === 's3' and would silently flip this to true.
    expect(capS3Descriptor.last().headers['authorization']).toBe(
      capS3Key.last().headers['authorization'],
    );
    // uriEscapePath: true for a descriptor whose service name isn't 's3'.
    expect(capOtherDescriptor.last().headers['authorization']).not.toBe(
      capS3Descriptor.last().headers['authorization'],
    );
  });

  it('raises an AwsError carrying the descriptor service name, not "[object Object]"', async () => {
    const transport: Transport = async () => ({
      statusCode: 400,
      headers: {},
      body: new Uint8Array(),
      text: () => '{"code":"ValidationException","message":"bad table name"}',
    });
    const client = new SigningClient({ region: 'us-east-1', credentials, transport });

    await expect(
      client.send({
        service: { service: 's3tables', signingName: 's3tables' },
        method: 'GET',
        path: '/tables',
      }),
    ).rejects.toMatchObject({
      name: 'AwsError',
      service: 's3tables',
      code: 'ValidationException',
      statusCode: 400,
      message: 's3tables: ValidationException - bad table name (HTTP 400)',
    });
  });
});

describe('SigningClient retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A transport answering each call with the next scripted response, then 200. */
  function scripted(responses: { status: number; body: string }[]): {
    transport: Transport;
    calls: () => number;
  } {
    let calls = 0;
    const transport: Transport = async () => {
      const next = responses[calls++];
      const status = next?.status ?? 200;
      const body = next?.body ?? '';
      return { statusCode: status, headers: {}, body: new Uint8Array(), text: () => body };
    };
    return { transport, calls: () => calls };
  }

  /** Run a send to completion through every backoff delay. */
  async function settle(promise: Promise<unknown>): Promise<unknown> {
    const outcome = promise.then(
      () => 'ok',
      (err: unknown) => err,
    );
    await vi.runAllTimersAsync();
    return outcome;
  }

  const cloudFrontThrottle = {
    status: 400,
    body: '<ErrorResponse><Error><Type>Sender</Type><Code>Throttling</Code><Message>Rate exceeded</Message></Error></ErrorResponse>',
  };

  it('retries a throttled POST - a CloudFront create refused for its rate', async () => {
    const t = scripted([cloudFrontThrottle, cloudFrontThrottle]);
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    const outcome = await settle(
      client.send({
        service: 'cloudfront',
        method: 'POST',
        path: '/2020-05-31/origin-access-control',
      }),
    );

    expect(outcome).toBe('ok');
    expect(t.calls()).toBe(3);
  });

  it('retries a JSON service throttle (429 TooManyRequestsException) on a POST', async () => {
    const t = scripted([
      { status: 429, body: '{"__type":"TooManyRequestsException","message":"Rate exceeded"}' },
    ]);
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    expect(await settle(client.send({ service: 'logs', method: 'POST', path: '/' }))).toBe('ok');
    expect(t.calls()).toBe(2);
  });

  it("retries S3's SlowDown", async () => {
    const t = scripted([
      {
        status: 503,
        body: '<Error><Code>SlowDown</Code><Message>Reduce your request rate.</Message></Error>',
      },
    ]);
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    expect(await settle(client.send({ service: 's3', method: 'PUT', path: '/b/k' }))).toBe('ok');
    expect(t.calls()).toBe(2);
  });

  it('gives up after THROTTLE_RETRY.attempts when the throttling never stops', async () => {
    const t = scripted(
      Array.from<typeof cloudFrontThrottle>({ length: 20 }).fill(cloudFrontThrottle),
    );
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    const outcome = await settle(
      client.send({ service: 'cloudfront', method: 'POST', path: '/2020-05-31/function' }),
    );

    expect(outcome).toMatchObject({ name: 'AwsError', code: 'Throttling', isThrottling: true });
    expect(t.calls()).toBe(THROTTLE_RETRY.attempts);
  });

  it('never retries a POST that failed with a 5xx - the mutation may have been applied', async () => {
    const t = scripted([{ status: 500, body: '{"__type":"ServiceException","message":"boom"}' }]);
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    const outcome = await settle(
      client.send({ service: 'microvms', method: 'POST', path: '/2025-09-09/microvms' }),
    );

    expect(outcome).toMatchObject({ code: 'ServiceException' });
    expect(t.calls()).toBe(1);
  });

  it('does not retry a quota error or a validation error', async () => {
    for (const code of ['LimitExceededException', 'ValidationException']) {
      const t = scripted([{ status: 400, body: `{"__type":"${code}","message":"no"}` }]);
      const client = new SigningClient({
        region: 'us-east-1',
        credentials,
        transport: t.transport,
      });

      const outcome = await settle(client.send({ service: 'logs', method: 'POST', path: '/' }));

      expect(outcome).toMatchObject({ code });
      expect(t.calls()).toBe(1);
    }
  });

  it('recovers when a 5xx and a throttle arrive in the same request', async () => {
    const t = scripted([
      { status: 500, body: '<Error><Code>InternalError</Code></Error>' },
      cloudFrontThrottle,
    ]);
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    expect(
      await settle(client.send({ service: 'cloudfront', method: 'GET', path: '/2020-05-31/x' })),
    ).toBe('ok');
    expect(t.calls()).toBe(3);
  });

  it('still retries a 5xx on an idempotent method', async () => {
    const t = scripted([{ status: 503, body: '<Error><Code>ServiceUnavailable</Code></Error>' }]);
    const client = new SigningClient({ region: 'us-east-1', credentials, transport: t.transport });

    expect(await settle(client.send({ service: 's3', method: 'GET', path: '/b/k' }))).toBe('ok');
    expect(t.calls()).toBe(2);
  });
});
