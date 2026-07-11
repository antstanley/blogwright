import { allTags, encodeEntities, textTag } from './xml.js';
import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';

export interface S3Object {
  key: string;
  size: number;
  lastModified: string | undefined;
  /** S3 ETag with surrounding quotes stripped (MD5 hex for single-part objects). */
  etag: string | undefined;
}

/** Percent-encode an object key for a path-style URL, preserving '/' separators. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

/** Thin S3 client (path-style addressing) built on the shared signing transport. */
export class S3Client {
  constructor(private readonly client: SigningClient) {}

  private objectPath(bucket: string, key: string): string {
    return `/${bucket}/${encodeKey(key)}`;
  }

  async bucketExists(bucket: string): Promise<boolean> {
    try {
      await this.client.send({ service: 's3', method: 'HEAD', path: `/${bucket}` });
      return true;
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return false;
      throw err;
    }
  }

  /** Create a bucket. Regions other than us-east-1 require a LocationConstraint body. */
  async createBucket(bucket: string): Promise<void> {
    const region = this.client.region;
    const body =
      region && region !== 'us-east-1'
        ? `<?xml version="1.0" encoding="UTF-8"?><CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`
        : undefined;
    try {
      await this.client.send({
        service: 's3',
        method: 'PUT',
        path: `/${bucket}`,
        ...(body ? { headers: { 'content-type': 'application/xml' }, body } : {}),
      });
    } catch (err) {
      if (err instanceof AwsError && err.isAlreadyExists) return;
      throw err;
    }
  }

  async deleteBucket(bucket: string): Promise<void> {
    try {
      await this.client.send({ service: 's3', method: 'DELETE', path: `/${bucket}` });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async putPublicAccessBlock(bucket: string): Promise<void> {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      '<BlockPublicAcls>true</BlockPublicAcls>' +
      '<IgnorePublicAcls>true</IgnorePublicAcls>' +
      '<BlockPublicPolicy>true</BlockPublicPolicy>' +
      '<RestrictPublicBuckets>true</RestrictPublicBuckets>' +
      '</PublicAccessBlockConfiguration>';
    await this.client.send({
      service: 's3',
      method: 'PUT',
      path: `/${bucket}`,
      query: { publicAccessBlock: '' },
      headers: { 'content-type': 'application/xml' },
      body,
    });
  }

  async putObject(
    bucket: string,
    key: string,
    body: string | Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.client.send({
      service: 's3',
      method: 'PUT',
      path: this.objectPath(bucket, key),
      headers: { 'content-type': contentType },
      body,
    });
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    const res = await this.client.send({
      service: 's3',
      method: 'GET',
      path: this.objectPath(bucket, key),
    });
    return res.body;
  }

  async getObjectText(bucket: string, key: string): Promise<string | undefined> {
    try {
      const bytes = await this.getObject(bucket, key);
      return new TextDecoder().decode(bytes);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send({ service: 's3', method: 'HEAD', path: this.objectPath(bucket, key) });
      return true;
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return false;
      throw err;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send({
      service: 's3',
      method: 'DELETE',
      path: this.objectPath(bucket, key),
    });
  }

  /** List all objects under a prefix, following continuation tokens. */
  async listObjects(bucket: string, prefix: string): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send({
        service: 's3',
        method: 'GET',
        path: `/${bucket}`,
        query: {
          'list-type': '2',
          prefix,
          ...(token ? { 'continuation-token': token } : {}),
        },
      });
      const xml = res.text();
      for (const block of allTags(xml, 'Contents')) {
        const key = textTag(block, 'Key');
        if (key === undefined) continue;
        out.push({
          key,
          size: Number(textTag(block, 'Size') ?? '0'),
          lastModified: textTag(block, 'LastModified'),
          etag: textTag(block, 'ETag')?.replace(/"/g, ''),
        });
      }
      token =
        textTag(xml, 'IsTruncated') === 'true' ? textTag(xml, 'NextContinuationToken') : undefined;
    } while (token);
    return out;
  }

  /** Delete every object under a prefix. Returns the number deleted. */
  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const objects = await this.listObjects(bucket, prefix);
    for (const obj of objects) {
      await this.deleteObject(bucket, obj.key);
    }
    return objects.length;
  }

  async putBucketPolicy(bucket: string, policy: string): Promise<void> {
    await this.client.send({
      service: 's3',
      method: 'PUT',
      path: `/${bucket}`,
      query: { policy: '' },
      headers: { 'content-type': 'application/json' },
      body: policy,
    });
  }

  /** Build an S3 REST-XML error-free marker; exported for callers needing entity-safe values. */
  static xmlValue(value: string): string {
    return encodeEntities(value);
  }
}
