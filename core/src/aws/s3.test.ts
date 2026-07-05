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
