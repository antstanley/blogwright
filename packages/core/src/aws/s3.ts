import { createHash } from 'node:crypto';

import { allTags, encodeEntities, rawTextTag, textTag } from './xml.js';
import { encodeTagQuery, type ResourceTags } from '../tags.js';
import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';

/**
 * Base64 SHA-256 of a request body. The bucket-configuration APIs
 * (?publicAccessBlock, ?tagging, ?policy) reject requests that carry neither
 * a Content-MD5 nor an x-amz-checksum-* header; the SigV4 x-amz-content-sha256
 * header does not satisfy the requirement.
 */
function bodyChecksum(body: string): string {
  return createHash('sha256').update(body).digest('base64');
}

/** Base64 MD5 of a request body - DeleteObjects' required integrity header. */
function bodyMd5(body: string): string {
  return createHash('md5').update(body).digest('base64');
}

/** One noncurrent or current entry from ListObjectVersions. */
export interface S3ObjectVersion {
  key: string;
  /** `null` for an object written before versioning was enabled. */
  versionId: string;
  isDeleteMarker: boolean;
  size: number;
}

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

/** Object metadata written with a PUT; S3 records it only then, never for an unchanged object. */
export interface ObjectMetadata {
  /** Object tags, sent as `x-amz-tagging` (the role also needs `s3:PutObjectTagging`). */
  tags?: ResourceTags | undefined;
  /** Stored as the object's `Cache-Control` and returned with it on every GET. */
  cacheControl?: string | undefined;
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
      headers: { 'content-type': 'application/xml', 'x-amz-checksum-sha256': bodyChecksum(body) },
      body,
    });
  }

  async putObject(
    bucket: string,
    key: string,
    body: string | Uint8Array,
    contentType = 'application/octet-stream',
    metadata: ObjectMetadata = {},
  ): Promise<string | undefined> {
    const { tags, cacheControl } = metadata;
    const res = await this.client.send({
      service: 's3',
      method: 'PUT',
      path: this.objectPath(bucket, key),
      headers: {
        'content-type': contentType,
        ...(tags && Object.keys(tags).length > 0 ? { 'x-amz-tagging': encodeTagQuery(tags) } : {}),
        ...(cacheControl !== undefined ? { 'cache-control': cacheControl } : {}),
      },
      body,
    });
    // Present only on a versioned bucket; the Web Function artifact pin.
    return res.headers['x-amz-version-id'];
  }

  /**
   * Create an object only if the key is free (S3's conditional write,
   * `If-None-Match: *`): true when this call created it, false when an object
   * already exists there - or another conditional write to the key is in
   * flight - and was left untouched. For write-once records.
   */
  async putObjectIfAbsent(
    bucket: string,
    key: string,
    body: string | Uint8Array,
    contentType = 'application/octet-stream',
  ): Promise<boolean> {
    try {
      await this.client.send({
        service: 's3',
        method: 'PUT',
        path: this.objectPath(bucket, key),
        headers: { 'content-type': contentType, 'if-none-match': '*' },
        body,
      });
      return true;
    } catch (err) {
      if (
        err instanceof AwsError &&
        (err.statusCode === 412 || /PreconditionFailed|ConditionalRequestConflict/i.test(err.code))
      ) {
        return false;
      }
      throw err;
    }
  }

  /** Enable or suspend bucket versioning. Never suspended once enabled (see the SSR contract). */
  async putBucketVersioning(bucket: string, status: 'Enabled' | 'Suspended'): Promise<void> {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      `<Status>${status}</Status>` +
      '</VersioningConfiguration>';
    await this.client.send({
      service: 's3',
      method: 'PUT',
      path: `/${bucket}`,
      query: { versioning: '' },
      headers: { 'content-type': 'application/xml', 'x-amz-checksum-sha256': bodyChecksum(body) },
      body,
    });
  }

  /** Current versioning status of a bucket, or undefined when the API reports none. */
  async getBucketVersioning(bucket: string): Promise<'Enabled' | 'Suspended' | undefined> {
    try {
      const res = await this.client.send({
        service: 's3',
        method: 'GET',
        path: `/${bucket}`,
        query: { versioning: '' },
      });
      const status = textTag(res.text(), 'Status');
      return status === 'Enabled' || status === 'Suspended' ? status : undefined;
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Apply bucket tags (idempotent full replace). */
  async putBucketTagging(bucket: string, tags: ResourceTags): Promise<void> {
    const tagSet = Object.entries(tags)
      .map(
        ([k, v]) => `<Tag><Key>${encodeEntities(k)}</Key><Value>${encodeEntities(v)}</Value></Tag>`,
      )
      .join('');
    const body = `<?xml version="1.0" encoding="UTF-8"?><Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet>${tagSet}</TagSet></Tagging>`;
    await this.client.send({
      service: 's3',
      method: 'PUT',
      path: `/${bucket}`,
      query: { tagging: '' },
      headers: { 'content-type': 'application/xml', 'x-amz-checksum-sha256': bodyChecksum(body) },
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

  /** True when one specific object version still exists (rollback's artifact check). */
  async objectVersionExists(bucket: string, key: string, versionId: string): Promise<boolean> {
    try {
      await this.client.send({
        service: 's3',
        method: 'HEAD',
        path: this.objectPath(bucket, key),
        query: { versionId },
      });
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
        const key = rawTextTag(block, 'Key');
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
      headers: {
        'content-type': 'application/json',
        'x-amz-checksum-sha256': bodyChecksum(policy),
      },
      body: policy,
    });
  }

  /** The bucket's current policy document, or undefined when it has none. */
  async getBucketPolicy(bucket: string): Promise<string | undefined> {
    try {
      const res = await this.client.send({
        service: 's3',
        method: 'GET',
        path: `/${bucket}`,
        query: { policy: '' },
      });
      return res.text();
    } catch (err) {
      // NoSuchBucketPolicy is a 404; read it as "no policy yet" like a fresh bucket.
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /**
   * Every object version (and delete marker) under a prefix, following the
   * ListObjectVersions key/version-id markers. Only the bucket node's teardown
   * reads this - a plain `deletePrefix` cannot empty a versioned bucket.
   */
  async listObjectVersions(bucket: string, prefix: string): Promise<S3ObjectVersion[]> {
    const out: S3ObjectVersion[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (;;) {
      const res = await this.client.send({
        service: 's3',
        method: 'GET',
        path: `/${bucket}`,
        query: {
          versions: '',
          prefix,
          ...(keyMarker ? { 'key-marker': keyMarker } : {}),
          ...(versionIdMarker ? { 'version-id-marker': versionIdMarker } : {}),
        },
      });
      const xml = res.text();
      for (const tag of ['Version', 'DeleteMarker'] as const) {
        for (const block of allTags(xml, tag)) {
          const key = rawTextTag(block, 'Key');
          const versionId = textTag(block, 'VersionId') ?? '';
          if (key === undefined || versionId === '') continue;
          out.push({
            key,
            versionId,
            isDeleteMarker: tag === 'DeleteMarker',
            size: Number(textTag(block, 'Size') ?? '0'),
          });
        }
      }
      if (textTag(xml, 'IsTruncated') !== 'true') break;
      const nextKey = textTag(xml, 'NextKeyMarker');
      const nextVersion = textTag(xml, 'NextVersionIdMarker');
      if (!nextKey) break;
      keyMarker = nextKey;
      versionIdMarker = nextVersion;
    }
    return out;
  }

  /**
   * Remove every version and delete marker under a prefix with batched
   * DeleteObjects requests. Version-aware removal is deliberately NOT what
   * `deletePrefix` does: no role that deletes a prefix today holds
   * `s3:ListBucketVersions`/`s3:DeleteObjectVersion`, so only the bucket's own
   * teardown may call this. Returns the number of entries removed.
   */
  async deleteAllVersions(bucket: string, prefix: string): Promise<number> {
    const versions = await this.listObjectVersions(bucket, prefix);
    for (let i = 0; i < versions.length; i += 1000) {
      const batch = versions.slice(i, i + 1000);
      const objects = batch
        .map(
          (v) =>
            `<Object><Key>${encodeEntities(v.key)}</Key><VersionId>${encodeEntities(
              v.versionId,
            )}</VersionId></Object>`,
        )
        .join('');
      const body =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
        objects +
        '<Quiet>true</Quiet>' +
        '</Delete>';
      const res = await this.client.send({
        service: 's3',
        method: 'POST',
        path: `/${bucket}`,
        query: { delete: '' },
        headers: {
          'content-type': 'application/xml',
          'content-md5': bodyMd5(body),
        },
        body,
      });
      // DeleteObjects answers 200 even when entries were refused; in quiet mode
      // the body lists only those. Unread, a denied version surfaces later as an
      // unexplained BucketNotEmpty.
      const failures = allTags(res.text(), 'Error');
      const first = failures[0];
      if (first !== undefined) {
        throw new Error(
          `could not delete ${failures.length} object version(s) under s3://${bucket}/${prefix}: ` +
            `${textTag(first, 'Code') ?? 'error'} on ${rawTextTag(first, 'Key') ?? 'an entry'}` +
            `${textTag(first, 'Message') ? ` (${textTag(first, 'Message')})` : ''}`,
        );
      }
    }
    return versions.length;
  }

  /** Build an S3 REST-XML error-free marker; exported for callers needing entity-safe values. */
  static xmlValue(value: string): string {
    return encodeEntities(value);
  }
}
