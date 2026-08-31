import {
  AwsError,
  SigningClient,
  staticCredentials,
  type RawResponse,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { S3TablesClient, type IcebergTableSchema } from './s3tables.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

const BUCKET_ARN = 'arn:aws:s3tables:us-east-1:123456789012:bucket/analytics-bucket';
const NAMESPACE = 'web';
const TABLE_NAME = 'page_views';
const TABLE_ARN = `${BUCKET_ARN}/table/abc123`;

/**
 * A minimal but representative schema, in the shape task 48's mapping from
 * `PAGE_VIEWS_COLUMNS`/`PAGE_VIEWS_PARTITION_COLUMN` (`packages/analytics/src/schema.ts`)
 * will produce: a couple of required primitive columns, one optional column, and an
 * identity partition on the required date column. Not derived from `schema.ts` here -
 * that mapping is task 48's, pinned by its own test.
 */
const TEST_SCHEMA: IcebergTableSchema = {
  fields: [
    { name: 'event_time', type: 'timestamp', id: 1, required: true },
    { name: 'day', type: 'date', id: 2, required: true },
    { name: 'host', type: 'string', id: 3 },
  ],
  partitionSpec: [{ name: 'day', sourceId: 2, transform: 'identity' }],
};

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function s3TablesWith(transport: Transport): S3TablesClient {
  return new S3TablesClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

/** Records the method, full request URL (path + query) and parsed JSON body of the one request the transport receives. */
function recordingTransport(
  replyStatus: number,
  replyBody: string,
): { transport: Transport; seen: () => { method: string; url: string; body: unknown } } {
  let seen: { method: string; url: string; body: unknown } | undefined;
  const transport: Transport = async (req) => {
    seen = {
      method: req.method,
      url: req.url,
      body: req.body === undefined ? undefined : JSON.parse(String(req.body)),
    };
    return response(replyStatus, replyBody);
  };
  return { transport, seen: () => seen! };
}

/**
 * The failure shape S3 Tables actually puts on the wire: the exception name in an
 * `x-amzn-ErrorType` header, and a body carrying `message` and nothing else. Probed
 * against the live endpoint - an unauthenticated `GET
 * https://s3tables.us-east-1.amazonaws.com/get-table` answers `403` with
 * `x-amzn-ErrorType: MissingAuthenticationTokenException:http://internal.amazon.com/coral/...`
 * and a body of exactly `{"message":"Missing Authentication Token"}`. There is no
 * `code`/`__type` key in the body, so core's `parseError` (which reads the body only)
 * derives `AwsError.code = "Http<status>"` for every S3 Tables failure. Tests below
 * therefore assert against that, not against the exception name - and the client's
 * not-found/already-exists narrowing has to turn on `statusCode`, which is the one
 * signal that survives.
 */
function errorResponse(status: number, code: string, message: string): RawResponse {
  return {
    ...response(status, JSON.stringify({ message })),
    headers: {
      'x-amzn-errortype': `${code}:http://internal.amazon.com/coral/com.amazonaws.s3tables/`,
    },
  };
}

describe('S3TablesClient table bucket operations', () => {
  it('pins CreateTableBucket to PUT /buckets with a {name} body', async () => {
    const { transport, seen } = recordingTransport(200, JSON.stringify({ arn: BUCKET_ARN }));
    await s3TablesWith(transport).createTableBucket('analytics-bucket');
    expect(seen()).toStrictEqual({
      method: 'PUT',
      url: 'https://s3tables.us-east-1.amazonaws.com/buckets',
      body: { name: 'analytics-bucket' },
    });
  });

  it('pins GetTableBucket to GET /buckets/{arn} and normalizes the response', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ arn: BUCKET_ARN, name: 'analytics-bucket', type: 'customer' }),
    );
    const bucket = await s3TablesWith(transport).getTableBucket(BUCKET_ARN);
    expect(seen()).toStrictEqual({
      method: 'GET',
      url: `https://s3tables.us-east-1.amazonaws.com/buckets/${encodeURIComponent(BUCKET_ARN)}`,
      body: undefined,
    });
    expect(bucket).toStrictEqual({ arn: BUCKET_ARN, name: 'analytics-bucket' });
  });

  it('pins DeleteTableBucket to DELETE /buckets/{arn}', async () => {
    const { transport, seen } = recordingTransport(204, '');
    await s3TablesWith(transport).deleteTableBucket(BUCKET_ARN);
    expect(seen()).toStrictEqual({
      method: 'DELETE',
      url: `https://s3tables.us-east-1.amazonaws.com/buckets/${encodeURIComponent(BUCKET_ARN)}`,
      body: undefined,
    });
  });
});

describe('S3TablesClient namespace operations', () => {
  it('pins CreateNamespace to PUT /namespaces/{arn} with a {namespace: [name]} body', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ namespace: [NAMESPACE], tableBucketARN: BUCKET_ARN }),
    );
    await s3TablesWith(transport).createNamespace(BUCKET_ARN, NAMESPACE);
    expect(seen()).toStrictEqual({
      method: 'PUT',
      url: `https://s3tables.us-east-1.amazonaws.com/namespaces/${encodeURIComponent(BUCKET_ARN)}`,
      body: { namespace: [NAMESPACE] },
    });
  });

  it('pins GetNamespace to GET /namespaces/{arn}/{namespace} and normalizes the response', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ namespace: [NAMESPACE], tableBucketId: 'tb-1', namespaceId: 'ns-1' }),
    );
    const ns = await s3TablesWith(transport).getNamespace(BUCKET_ARN, NAMESPACE);
    expect(seen()).toStrictEqual({
      method: 'GET',
      url: `https://s3tables.us-east-1.amazonaws.com/namespaces/${encodeURIComponent(BUCKET_ARN)}/${encodeURIComponent(NAMESPACE)}`,
      body: undefined,
    });
    // GetNamespace's response carries no tableBucketARN field - the client fills it
    // in from what the caller already passed, not from the (absent) response field.
    expect(ns).toStrictEqual({ name: NAMESPACE, tableBucketArn: BUCKET_ARN });
  });

  it('pins DeleteNamespace to DELETE /namespaces/{arn}/{namespace}', async () => {
    const { transport, seen } = recordingTransport(204, '');
    await s3TablesWith(transport).deleteNamespace(BUCKET_ARN, NAMESPACE);
    expect(seen()).toStrictEqual({
      method: 'DELETE',
      url: `https://s3tables.us-east-1.amazonaws.com/namespaces/${encodeURIComponent(BUCKET_ARN)}/${encodeURIComponent(NAMESPACE)}`,
      body: undefined,
    });
  });
});

describe('S3TablesClient table operations', () => {
  it('pins CreateTable to PUT /tables/{arn}/{namespace} with a {name, format: ICEBERG, metadata} body', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ tableARN: TABLE_ARN, versionToken: 'v1' }),
    );
    await s3TablesWith(transport).createTable(BUCKET_ARN, NAMESPACE, TABLE_NAME, TEST_SCHEMA);
    expect(seen()).toStrictEqual({
      method: 'PUT',
      url: `https://s3tables.us-east-1.amazonaws.com/tables/${encodeURIComponent(BUCKET_ARN)}/${encodeURIComponent(NAMESPACE)}`,
      body: {
        name: TABLE_NAME,
        format: 'ICEBERG',
        metadata: {
          iceberg: {
            schema: {
              fields: [
                { name: 'event_time', type: 'timestamp', id: 1, required: true },
                { name: 'day', type: 'date', id: 2, required: true },
                { name: 'host', type: 'string', id: 3 },
              ],
            },
            partitionSpec: {
              fields: [{ name: 'day', 'source-id': 2, transform: 'identity' }],
            },
          },
        },
      },
    });
  });

  it('omits partitionSpec entirely when the schema carries none, and never emits required/field-id as explicit undefined', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ tableARN: TABLE_ARN, versionToken: 'v1' }),
    );
    const schemaWithoutPartition: IcebergTableSchema = {
      fields: [{ name: 'request_id', type: 'string', id: 1 }],
    };
    await s3TablesWith(transport).createTable(
      BUCKET_ARN,
      NAMESPACE,
      TABLE_NAME,
      schemaWithoutPartition,
    );
    const body = seen().body as { metadata: { iceberg: Record<string, unknown> } };
    expect(body.metadata.iceberg).toStrictEqual({
      schema: { fields: [{ name: 'request_id', type: 'string', id: 1 }] },
    });
    expect(Object.keys(body.metadata.iceberg)).not.toContain('partitionSpec');
    expect(
      Object.keys((body.metadata.iceberg as { schema: { fields: object[] } }).schema.fields[0]!),
    ).not.toContain('required');
  });

  it('carries an explicit field-id through to the wire when the schema supplies one', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ tableARN: TABLE_ARN, versionToken: 'v1' }),
    );
    const schemaWithFieldId: IcebergTableSchema = {
      fields: [
        { name: 'day', type: 'date', id: 1, required: true },
        { name: 'host', type: 'string', id: 2 },
      ],
      partitionSpec: [{ name: 'day', sourceId: 1, transform: 'identity', fieldId: 100 }],
    };
    await s3TablesWith(transport).createTable(BUCKET_ARN, NAMESPACE, TABLE_NAME, schemaWithFieldId);
    const body = seen().body as {
      metadata: { iceberg: { partitionSpec: { fields: Record<string, unknown>[] } } };
    };
    expect(body.metadata.iceberg.partitionSpec.fields).toStrictEqual([
      { name: 'day', 'source-id': 1, transform: 'identity', 'field-id': 100 },
    ]);
  });

  it('reflects a changed column straight through to the request body', async () => {
    const baseline = recordingTransport(200, JSON.stringify({ tableARN: TABLE_ARN }));
    await s3TablesWith(baseline.transport).createTable(
      BUCKET_ARN,
      NAMESPACE,
      TABLE_NAME,
      TEST_SCHEMA,
    );

    const alteredSchema: IcebergTableSchema = {
      ...TEST_SCHEMA,
      fields: TEST_SCHEMA.fields.map((f) => (f.name === 'host' ? { ...f, type: 'long' } : f)),
    };
    const altered = recordingTransport(200, JSON.stringify({ tableARN: TABLE_ARN }));
    await s3TablesWith(altered.transport).createTable(
      BUCKET_ARN,
      NAMESPACE,
      TABLE_NAME,
      alteredSchema,
    );

    expect(baseline.seen().body).not.toStrictEqual(altered.seen().body);
    const alteredBody = altered.seen().body as {
      metadata: { iceberg: { schema: { fields: { name: string; type: string }[] } } };
    };
    expect(alteredBody.metadata.iceberg.schema.fields).toContainEqual({
      name: 'host',
      type: 'long',
      id: 3,
    });
  });

  it('pins GetTable to GET /get-table with query identifiers (not the nested path other operations use) and normalizes the response', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({
        tableARN: TABLE_ARN,
        name: TABLE_NAME,
        namespace: [NAMESPACE],
        metadataLocation: 's3://analytics-bucket/web/page_views/metadata/00001.metadata.json',
      }),
    );
    const table = await s3TablesWith(transport).getTable(BUCKET_ARN, NAMESPACE, TABLE_NAME);
    const { method, url, body } = seen();
    expect(method).toBe('GET');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://s3tables.us-east-1.amazonaws.com/get-table',
    );
    expect(Object.fromEntries(parsed.searchParams)).toStrictEqual({
      tableBucketARN: BUCKET_ARN,
      namespace: NAMESPACE,
      name: TABLE_NAME,
    });
    expect(body).toBeUndefined();
    expect(table).toStrictEqual({
      arn: TABLE_ARN,
      name: TABLE_NAME,
      metadataLocation: 's3://analytics-bucket/web/page_views/metadata/00001.metadata.json',
    });
  });

  it('normalizes a freshly-created table (no metadataLocation yet) to metadataLocation: undefined', async () => {
    const transport: Transport = async () =>
      response(200, JSON.stringify({ tableARN: TABLE_ARN, name: TABLE_NAME }));
    const table = await s3TablesWith(transport).getTable(BUCKET_ARN, NAMESPACE, TABLE_NAME);
    expect(table).toStrictEqual({ arn: TABLE_ARN, name: TABLE_NAME, metadataLocation: undefined });
  });

  it('pins DeleteTable to DELETE /tables/{arn}/{namespace}/{name}', async () => {
    const { transport, seen } = recordingTransport(204, '');
    await s3TablesWith(transport).deleteTable(BUCKET_ARN, NAMESPACE, TABLE_NAME);
    expect(seen()).toStrictEqual({
      method: 'DELETE',
      url: `https://s3tables.us-east-1.amazonaws.com/tables/${encodeURIComponent(BUCKET_ARN)}/${encodeURIComponent(NAMESPACE)}/${encodeURIComponent(TABLE_NAME)}`,
      body: undefined,
    });
  });
});

describe('S3TablesClient absent resources', () => {
  it('getTableBucket returns undefined on NotFoundException', async () => {
    const transport: Transport = async () =>
      errorResponse(404, 'NotFoundException', 'no such bucket');
    expect(await s3TablesWith(transport).getTableBucket(BUCKET_ARN)).toBeUndefined();
  });

  it('getNamespace returns undefined on NotFoundException', async () => {
    const transport: Transport = async () =>
      errorResponse(404, 'NotFoundException', 'no such namespace');
    expect(await s3TablesWith(transport).getNamespace(BUCKET_ARN, NAMESPACE)).toBeUndefined();
  });

  it('getTable returns undefined on NotFoundException', async () => {
    const transport: Transport = async () =>
      errorResponse(404, 'NotFoundException', 'no such table');
    expect(
      await s3TablesWith(transport).getTable(BUCKET_ARN, NAMESPACE, TABLE_NAME),
    ).toBeUndefined();
  });
});

describe('S3TablesClient delete* idempotency', () => {
  it('deleteTableBucket swallows NotFoundException so teardown is re-runnable', async () => {
    const transport: Transport = async () => errorResponse(404, 'NotFoundException', 'gone');
    await expect(s3TablesWith(transport).deleteTableBucket(BUCKET_ARN)).resolves.toBeUndefined();
  });

  it('deleteNamespace swallows NotFoundException so teardown is re-runnable', async () => {
    const transport: Transport = async () => errorResponse(404, 'NotFoundException', 'gone');
    await expect(
      s3TablesWith(transport).deleteNamespace(BUCKET_ARN, NAMESPACE),
    ).resolves.toBeUndefined();
  });

  it('deleteTable swallows NotFoundException so teardown is re-runnable', async () => {
    const transport: Transport = async () => errorResponse(404, 'NotFoundException', 'gone');
    await expect(
      s3TablesWith(transport).deleteTable(BUCKET_ARN, NAMESPACE, TABLE_NAME),
    ).resolves.toBeUndefined();
  });
});

describe('S3TablesClient create* already-exists idempotency', () => {
  it('createTableBucket resolves normally on ConflictException', async () => {
    const transport: Transport = async () =>
      errorResponse(409, 'ConflictException', 'already exists');
    await expect(
      s3TablesWith(transport).createTableBucket('analytics-bucket'),
    ).resolves.toBeUndefined();
  });

  it('createNamespace resolves normally on ConflictException', async () => {
    const transport: Transport = async () =>
      errorResponse(409, 'ConflictException', 'already exists');
    await expect(
      s3TablesWith(transport).createNamespace(BUCKET_ARN, NAMESPACE),
    ).resolves.toBeUndefined();
  });

  it('createTable resolves normally on ConflictException', async () => {
    const transport: Transport = async () =>
      errorResponse(409, 'ConflictException', 'already exists');
    await expect(
      s3TablesWith(transport).createTable(BUCKET_ARN, NAMESPACE, TABLE_NAME, TEST_SCHEMA),
    ).resolves.toBeUndefined();
  });
});

describe('S3TablesClient non-not-found / non-conflict failures', () => {
  it('rethrows a 500 rather than swallowing it', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'InternalServerErrorException', 'try again');
    await expect(s3TablesWith(transport).getTableBucket(BUCKET_ARN)).rejects.toThrow(AwsError);
  });

  it('rethrows a 500 on create rather than treating it as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'InternalServerErrorException', 'try again');
    await expect(s3TablesWith(transport).createTableBucket('analytics-bucket')).rejects.toThrow(
      AwsError,
    );
  });

  it('rethrows a 500 on delete rather than swallowing it as not-found', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'InternalServerErrorException', 'try again');
    await expect(s3TablesWith(transport).deleteTableBucket(BUCKET_ARN)).rejects.toThrow(AwsError);
  });
});

describe('S3TablesClient error context', () => {
  // `code` is `Http400`, not `ValidationException`, and that is the truth about this
  // service rather than a shortcut in the test: S3 Tables puts the exception name in
  // the `x-amzn-ErrorType` header (see `errorResponse` above) and core's `parseError`
  // reads only the body, which carries `message` alone. The same gap leaves
  // `requestId` permanently `undefined` here. Both would resolve on their own if
  // `parseError` learned to read those headers - see the note on `isAlreadyExists`.
  it('carries the s3tables service label (not "[object Object]"), the operation and the offending name, and preserves code/statusCode', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ValidationException', 'name must be lowercase');
    await expect(s3TablesWith(transport).createTableBucket('Bad Name')).rejects.toMatchObject({
      name: 'AwsError',
      service: 's3tables',
      code: 'Http400',
      statusCode: 400,
    });
    await expect(s3TablesWith(transport).createTableBucket('Bad Name')).rejects.toThrow(
      /createTableBucket "Bad Name": .*name must be lowercase/,
    );
  });

  it('does not repeat the AwsError framing when adding context', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ValidationException', 'name must be lowercase');
    await expect(s3TablesWith(transport).createTableBucket('Bad Name')).rejects.toMatchObject({
      message:
        's3tables: Http400 - createTableBucket "Bad Name": name must be lowercase (HTTP 400)',
    });
  });

  it('names the bucket/namespace/table path for a nested resource', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ValidationException', 'bad format');
    await expect(
      s3TablesWith(transport).createTable(BUCKET_ARN, NAMESPACE, TABLE_NAME, TEST_SCHEMA),
    ).rejects.toThrow(new RegExp(`createTable "${BUCKET_ARN}/${NAMESPACE}/${TABLE_NAME}"`));
  });
});
