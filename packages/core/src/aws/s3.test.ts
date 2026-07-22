import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { S3Client } from './s3.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function s3With(transport: Transport): S3Client {
  return new S3Client(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

describe('S3Client.listObjects', () => {
  it('follows continuation tokens', async () => {
    const transport: Transport = async (req) => {
      if (req.url.includes('continuation-token')) {
        return response(
          200,
          '<ListBucketResult><Contents><Key>site/b.html</Key><Size>2</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>',
        );
      }
      return response(
        200,
        '<ListBucketResult><Contents><Key>site/a.html</Key><Size>1</Size></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken></ListBucketResult>',
      );
    };
    const keys = (await s3With(transport).listObjects('bucket', 'site/')).map((o) => o.key);
    expect(keys).toEqual(['site/a.html', 'site/b.html']);
  });
});

describe('S3Client.objectExists', () => {
  it('returns false on 404', async () => {
    const transport: Transport = async () =>
      response(404, '<Error><Code>NoSuchKey</Code><Message>no</Message></Error>');
    expect(await s3With(transport).objectExists('bucket', 'missing')).toBe(false);
  });

  it('returns true on 200', async () => {
    const transport: Transport = async () => response(200, '');
    expect(await s3With(transport).objectExists('bucket', 'there')).toBe(true);
  });
});

describe('S3Client tagging', () => {
  it('putObject sends x-amz-tagging when tags are given', async () => {
    let headers: Record<string, string> = {};
    const transport: Transport = async (req) => {
      headers = req.headers;
      return response(200, '');
    };
    await s3With(transport).putObject('b', 'site/index.html', 'x', 'text/html', {
      environment: 'preview-pr-42',
      app: 'mason',
    });
    expect(headers['x-amz-tagging']).toBe('environment=preview-pr-42&app=mason');
  });

  it('putBucketTagging sends an XML TagSet to ?tagging', async () => {
    let url = '';
    let body = '';
    const transport: Transport = async (req) => {
      url = req.url;
      body = String(req.body ?? '');
      return response(200, '');
    };
    await s3With(transport).putBucketTagging('b', { environment: 'staging', app: 'blog' });
    expect(url).toContain('tagging');
    expect(body).toContain('<Tag><Key>environment</Key><Value>staging</Value></Tag>');
    expect(body).toContain('<Tag><Key>app</Key><Value>blog</Value></Tag>');
  });
});

describe('S3Client bucket-configuration checksums', () => {
  // The ?publicAccessBlock, ?tagging, and ?policy APIs reject requests without
  // a Content-MD5 or x-amz-checksum-* header (the SigV4 x-amz-content-sha256
  // header does not count).
  async function captured(run: (s3: S3Client) => Promise<void>) {
    let headers: Record<string, string> = {};
    let body = '';
    const transport: Transport = async (req) => {
      headers = req.headers;
      body = String(req.body ?? '');
      return response(200, '');
    };
    await run(s3With(transport));
    return { headers, body };
  }

  function sha256Base64(body: string): string {
    return createHash('sha256').update(body).digest('base64');
  }

  it('putPublicAccessBlock sends x-amz-checksum-sha256 for its body', async () => {
    const { headers, body } = await captured((s3) => s3.putPublicAccessBlock('b'));
    expect(headers['x-amz-checksum-sha256']).toBe(sha256Base64(body));
  });

  it('putBucketTagging sends x-amz-checksum-sha256 for its body', async () => {
    const { headers, body } = await captured((s3) => s3.putBucketTagging('b', { app: 'blog' }));
    expect(headers['x-amz-checksum-sha256']).toBe(sha256Base64(body));
  });

  it('putBucketPolicy sends x-amz-checksum-sha256 for its body', async () => {
    const { headers, body } = await captured((s3) => s3.putBucketPolicy('b', '{"Version":"2012-10-17"}'));
    expect(body).toBe('{"Version":"2012-10-17"}');
    expect(headers['x-amz-checksum-sha256']).toBe(sha256Base64(body));
  });
});
