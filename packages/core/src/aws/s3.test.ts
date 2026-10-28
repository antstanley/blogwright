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

function responseWithHeaders(
  status: number,
  body: string,
  headers: Record<string, string>,
): RawResponse {
  return { ...response(status, body), headers };
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
      tags: { environment: 'preview-pr-42', app: 'mason' },
    });
    expect(headers['x-amz-tagging']).toBe('environment=preview-pr-42&app=mason');
    expect(headers['cache-control']).toBeUndefined();
  });

  it('putObject sends Cache-Control when one is given, alongside the tags', async () => {
    let headers: Record<string, string> = {};
    const transport: Transport = async (req) => {
      headers = req.headers;
      return response(200, '');
    };
    await s3With(transport).putObject('b', 'site/index.html', 'x', 'text/html', {
      tags: { app: 'mason' },
      cacheControl: 'public, max-age=0, must-revalidate',
    });
    expect(headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(headers['x-amz-tagging']).toBe('app=mason');
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
    const { headers, body } = await captured((s3) =>
      s3.putBucketPolicy('b', '{"Version":"2012-10-17"}'),
    );
    expect(body).toBe('{"Version":"2012-10-17"}');
    expect(headers['x-amz-checksum-sha256']).toBe(sha256Base64(body));
  });
});

describe('S3Client versioning and version-aware deletion', () => {
  it('putBucketVersioning PUTs the versioning subresource with the status', async () => {
    let url = '';
    let body = '';
    const transport: Transport = async (req) => {
      url = req.url;
      body = String(req.body ?? '');
      return response(200, '');
    };
    await s3With(transport).putBucketVersioning('bucket', 'Enabled');
    expect(url).toContain('versioning=');
    expect(body).toContain('<Status>Enabled</Status>');
  });

  it('getBucketVersioning reads the status, and 404 means no status', async () => {
    const enabled = s3With(async () =>
      response(200, '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'),
    );
    expect(await enabled.getBucketVersioning('bucket')).toBe('Enabled');
    const missing = s3With(async () =>
      response(404, '<ErrorResponse><Error><Code>NoSuchBucket</Code></Error></ErrorResponse>'),
    );
    expect(await missing.getBucketVersioning('bucket')).toBeUndefined();
  });

  it('putObject returns the x-amz-version-id a versioned bucket assigns', async () => {
    const transport: Transport = async () =>
      responseWithHeaders(200, '', { 'x-amz-version-id': 'v-42' });
    expect(await s3With(transport).putObject('b', 'web/artifacts/x.zip', 'z')).toBe('v-42');
    const unversioned: Transport = async () => response(200, '');
    expect(await s3With(unversioned).putObject('b', 'k', 'z')).toBeUndefined();
  });

  it('listObjectVersions parses versions and delete markers across marker pagination', async () => {
    const urls: string[] = [];
    const transport: Transport = async (req) => {
      urls.push(req.url);
      if (req.url.includes('key-marker=')) {
        return response(
          200,
          '<ListVersionsResult><IsTruncated>false</IsTruncated><DeleteMarker><Key>site/old.html</Key><VersionId>dm-2</VersionId></DeleteMarker></ListVersionsResult>',
        );
      }
      return response(
        200,
        '<ListVersionsResult><IsTruncated>true</IsTruncated>' +
          '<NextKeyMarker>site/a.html</NextKeyMarker><NextVersionIdMarker>v-1</NextVersionIdMarker>' +
          '<Version><Key>site/a.html</Key><VersionId>v-1</VersionId><Size>10</Size></Version>' +
          '<Version><Key>site/a.html</Key><VersionId>v-0</VersionId><Size>9</Size></Version>' +
          '</ListVersionsResult>',
      );
    };
    const versions = await s3With(transport).listObjectVersions('bucket', 'site/');
    expect(versions).toEqual([
      { key: 'site/a.html', versionId: 'v-1', isDeleteMarker: false, size: 10 },
      { key: 'site/a.html', versionId: 'v-0', isDeleteMarker: false, size: 9 },
      { key: 'site/old.html', versionId: 'dm-2', isDeleteMarker: true, size: 0 },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('key-marker=site%2Fa.html');
    expect(urls[1]).toContain('version-id-marker=v-1');
  });

  it('deleteAllVersions batch-deletes every version and delete marker with one POST per 1000', async () => {
    const posts: { body: string; md5: string | undefined }[] = [];
    const transport: Transport = async (req) => {
      if (req.method === 'GET') {
        const page = Array.from(
          { length: 3 },
          (_, i) => `<Version><Key>k${i}</Key><VersionId>v${i}</VersionId><Size>1</Size></Version>`,
        ).join('');
        return response(
          200,
          `<ListVersionsResult><IsTruncated>false</IsTruncated>${page}</ListVersionsResult>`,
        );
      }
      posts.push({ body: String(req.body ?? ''), md5: req.headers['content-md5'] });
      return response(200, '<DeleteResult></DeleteResult>');
    };
    const count = await s3With(transport).deleteAllVersions('bucket', 'web/');
    expect(count).toBe(3);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toContain('<VersionId>v0</VersionId>');
    expect(posts[0]?.body).toContain('<Quiet>true</Quiet>');
    // DeleteObjects requires an integrity header; a SigV4 hash does not satisfy it.
    expect(posts[0]?.md5).toBe(
      createHash('md5')
        .update(posts[0]?.body ?? '')
        .digest('base64'),
    );
  });

  it('deleteAllVersions fails on an entry the quiet response reports as refused', async () => {
    const transport: Transport = async (req) => {
      if (req.method === 'GET') {
        return response(
          200,
          '<ListVersionsResult><IsTruncated>false</IsTruncated>' +
            '<Version><Key>web/a.zip</Key><VersionId>v1</VersionId><Size>1</Size></Version>' +
            '</ListVersionsResult>',
        );
      }
      // DeleteObjects answers 200 and lists only the failures in quiet mode.
      return response(
        200,
        '<DeleteResult><Error><Key>web/a.zip</Key><VersionId>v1</VersionId>' +
          '<Code>AccessDenied</Code><Message>Access Denied</Message></Error></DeleteResult>',
      );
    };
    await expect(s3With(transport).deleteAllVersions('bucket', 'web/')).rejects.toThrow(
      /could not delete 1 object version\(s\) under s3:\/\/bucket\/web\/: AccessDenied on web\/a\.zip/,
    );
  });

  it('deletePrefix keeps issuing plain per-object deletes', async () => {
    const methods: string[] = [];
    const transport: Transport = async (req) => {
      methods.push(req.method);
      if (req.method === 'GET') {
        return response(
          200,
          '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>site/a</Key><Size>1</Size></Contents></ListBucketResult>',
        );
      }
      return response(204, '');
    };
    expect(await s3With(transport).deletePrefix('bucket', 'site/')).toBe(1);
    expect(methods).toEqual(['GET', 'DELETE']);
  });

  it('getBucketPolicy returns the document, and no-policy 404 reads as undefined', async () => {
    const withPolicy = s3With(async () => response(200, '{"Version":"2012-10-17"}'));
    expect(await withPolicy.getBucketPolicy('b')).toBe('{"Version":"2012-10-17"}');
    const without = s3With(async () =>
      response(
        404,
        '<ErrorResponse><Error><Code>NoSuchBucketPolicy</Code></Error></ErrorResponse>',
      ),
    );
    expect(await without.getBucketPolicy('b')).toBeUndefined();
  });

  it('objectVersionExists HEADs the specific version and reads 404 as gone', async () => {
    let url = '';
    const there = s3With(async (req) => {
      url = req.url;
      return response(200, '');
    });
    expect(await there.objectVersionExists('b', 'web/artifacts/a.zip', 'v-9')).toBe(true);
    expect(url).toContain('versionId=v-9');
    const gone = s3With(async () => response(404, '<Error><Code>NoSuchVersion</Code></Error>'));
    expect(await gone.objectVersionExists('b', 'web/artifacts/a.zip', 'v-9')).toBe(false);
  });
});

describe('S3Client.copyObject', () => {
  it('PUTs to the destination with the encoded source, copying metadata and tags', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    const transport: Transport = async (req) => {
      url = req.url;
      headers = req.headers;
      return response(200, '<CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>');
    };
    await s3With(transport).copyObject('b', 'releases/h1/a b.html', 'site/a b.html');
    expect(url).toContain('/b/site/a%20b.html');
    expect(headers['x-amz-copy-source']).toBe('/b/releases/h1/a%20b.html');
    expect(headers['x-amz-metadata-directive']).toBe('COPY');
    expect(headers['x-amz-tagging-directive']).toBe('COPY');
  });

  it('replaces the tag set with none when told to drop tags', async () => {
    let headers: Record<string, string> = {};
    const transport: Transport = async (req) => {
      headers = req.headers;
      return response(200, '<CopyObjectResult/>');
    };
    await s3With(transport).copyObject('b', 'releases/h1/x', 'site/x', { tags: 'drop' });
    expect(headers['x-amz-tagging-directive']).toBe('REPLACE');
    expect(headers['x-amz-tagging']).toBeUndefined();
  });

  it('throws the error S3 returns in a 200 body', async () => {
    const transport: Transport = async () =>
      response(
        200,
        '<Error><Code>InternalError</Code><Message>We encountered an internal error</Message></Error>',
      );
    await expect(s3With(transport).copyObject('b', 'releases/h1/x', 'site/x')).rejects.toThrow(
      /InternalError - copying releases\/h1\/x to site\/x: We encountered an internal error/,
    );
  });

  it('surfaces a denied copy as an AwsError', async () => {
    const transport: Transport = async () =>
      response(403, '<Error><Code>AccessDenied</Code><Message>denied</Message></Error>');
    await expect(
      s3With(transport).copyObject('b', 'releases/h1/x', 'site/x'),
    ).rejects.toMatchObject({ code: 'AccessDenied', statusCode: 403 });
  });
});
