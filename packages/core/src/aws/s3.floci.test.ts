import { afterAll, describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { S3Client } from './s3.js';
import { SigningClient } from './signer.js';

/**
 * Integration tests against the floci emulator. Gated on FLOCI=1 so the default
 * `pnpm test` run needs no Docker/cloud. Start floci first:
 *   docker run -d -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock floci/floci:latest
 */
const RUN = process.env.FLOCI === '1';
const endpointOverride = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const bucket = `floci-test-${Date.now()}`;

const s3 = new S3Client(
  new SigningClient({
    region: 'us-east-1',
    endpointOverride,
    credentials: staticCredentials({ accessKeyId: 'test', secretAccessKey: 'test' }),
  }),
);

describe.skipIf(!RUN)('S3 against floci', () => {
  afterAll(async () => {
    await s3.deletePrefix(bucket, '').catch(() => undefined);
    await s3.deleteBucket(bucket).catch(() => undefined);
  });

  it('creates a bucket, round-trips an object, lists and deletes it', async () => {
    await s3.createBucket(bucket);
    expect(await s3.bucketExists(bucket)).toBe(true);

    await s3.putObject(bucket, 'site/index.html', '<h1>hi</h1>', 'text/html');
    expect(await s3.getObjectText(bucket, 'site/index.html')).toBe('<h1>hi</h1>');

    const listed = await s3.listObjects(bucket, 'site/');
    expect(listed.map((o) => o.key)).toContain('site/index.html');

    await s3.deleteObject(bucket, 'site/index.html');
    expect(await s3.objectExists(bucket, 'site/index.html')).toBe(false);
  });

  it('copies an object server-side with identical bytes and ETag', async () => {
    await s3.createBucket(bucket);
    await s3.putObject(bucket, 'releases/h1/a.css', 'body{}', 'text/css', {
      tags: { app: 'floci' },
      cacheControl: 'no-store',
    });
    await s3.copyObject(bucket, 'releases/h1/a.css', 'site/a.css');
    expect(await s3.getObjectText(bucket, 'site/a.css')).toBe('body{}');
    const [source] = await s3.listObjects(bucket, 'releases/h1/');
    const [copy] = await s3.listObjects(bucket, 'site/a.css');
    expect(copy?.etag).toBe(source?.etag);
  });
});
