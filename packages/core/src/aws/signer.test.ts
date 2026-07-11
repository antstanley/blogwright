import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { SigningClient, type Transport } from './signer.js';

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
});
