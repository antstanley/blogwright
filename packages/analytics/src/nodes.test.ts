import {
  createClients,
  createMemoryFileSystem,
  deriveNames,
  emptyState,
  mergeConfig,
  staticCredentials,
  StateStore,
  type OpsConfig,
  type PluginContext,
  type PluginLogger,
  type RawResponse,
  type ResourceNode,
  type Terminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { validateAnalyticsConfig, type AnalyticsConfig } from './config.js';
import { analyticsNamespaceNode, analyticsTableBucketNode, analyticsTableNode } from './nodes.js';

const ENV = 'test';
const SITE_NAME = 'example';
const ACCOUNT_ID = '123456789012';

/**
 * The region a site carries in `config.region`. Deliberately not us-east-1:
 * every region assertion below would pass vacuously if it were, because the
 * pinned signer and the host's own would then be the same region. It is also
 * what makes the whole file a check on the pin rather than an accident - a
 * node reaching `ctx.clients` instead of the plugin's bundle would sign here.
 */
const CONFIG_REGION = 'eu-west-1';

/** `<env>-<siteName>-analytics`, the `tableBucket` default `config.ts` derives. */
const TABLE_BUCKET = 'test-example-analytics';
const TABLE_BUCKET_ARN = `arn:aws:s3tables:us-east-1:${ACCOUNT_ID}:bucket/${TABLE_BUCKET}`;
const NAMESPACE = 'web';
const TABLE = 'page_views';
/** A table ARN's trailing segment is an opaque generated id, not the table's name. */
const TABLE_ARN = `${TABLE_BUCKET_ARN}/table/60d1f8a2`;

const HOST = 'https://s3tables.us-east-1.amazonaws.com';

/** One request the transport saw, in the form the assertions below read it. */
interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const SILENT_TERMINAL: Terminal = {
  isInteractive: false,
  write: () => undefined,
  error: () => undefined,
  status: () => undefined,
  question: async (prompt) => {
    throw new Error(`unexpected terminal prompt in test: ${prompt}`);
  },
};

const NOOP_LOGGER: PluginLogger = {
  info: () => undefined,
  step: () => undefined,
  ok: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function encode(text: string): RawResponse {
  return {
    statusCode: 200,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** A 2xx reply carrying `body` as JSON. */
function ok(body: unknown): RawResponse {
  return encode(JSON.stringify(body));
}

/**
 * The failure shape S3 Tables actually puts on the wire (see
 * `aws/s3tables.test.ts`): the exception name in an `x-amzn-ErrorType` header
 * and a body of `{"message": ...}` and nothing else. Core's `parseError` reads
 * only the body, so every failure from this service reaches the client as
 * `AwsError.code === "Http<status>"` and its not-found narrowing turns on the
 * status. Building the reply this way rather than with a `code` in the body
 * keeps these tests honest about that.
 */
function failure(status: number, exception: string, message: string): RawResponse {
  const text = JSON.stringify({ message });
  return {
    statusCode: status,
    headers: {
      'x-amzn-errortype': `${exception}:http://internal.amazon.com/coral/com.amazonaws.s3tables/`,
    },
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** The reply S3 Tables sends for a resource that does not exist. */
function notFound(): RawResponse {
  return failure(404, 'NotFoundException', 'The specified resource does not exist.');
}

/**
 * A `PluginContext<AnalyticsConfig>` over a transport that records every
 * request and answers them from `replies`, in order.
 *
 * Scripted rather than blanket-answering, deliberately: a node that made more
 * calls than the test accounted for hits the throw below instead of being
 * silently fed another `{}`, and a node that made none leaves `requests` empty
 * for the assertions to notice. Both are how a transport fixture goes vacuous.
 *
 * The clients are the host's own bundle in {@link CONFIG_REGION}; the nodes
 * build their own us-east-1 bundle from it through `createAnalyticsClients`.
 * Nothing is injected in their place - the transport is the seam.
 */
function makeContext(
  replies: RawResponse[],
  overrides: { config?: Partial<OpsConfig>; analytics?: Record<string, unknown> } = {},
): { ctx: PluginContext<AnalyticsConfig>; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];
  const transport: Transport = async (req) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body === undefined ? undefined : JSON.parse(String(req.body)),
    });
    const reply = queue.shift();
    if (reply === undefined) {
      throw new Error(
        `unscripted AWS request in test: ${req.method} ${req.url} - the node made more calls than the test scripted a reply for`,
      );
    }
    return reply;
  };

  const config = mergeConfig({ siteName: SITE_NAME, region: CONFIG_REGION, ...overrides.config });
  const clients = createClients({
    region: config.region,
    credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
    transport,
  });
  const names = deriveNames(ENV, ACCOUNT_ID, config);
  const state = emptyState(ENV);

  return {
    requests,
    ctx: {
      env: ENV,
      domain: undefined,
      preview: false,
      config,
      pluginConfig: validateAnalyticsConfig(overrides.analytics ?? {}),
      names,
      accountId: ACCOUNT_ID,
      clients,
      ports: { fs: createMemoryFileSystem(), terminal: SILENT_TERMINAL },
      logger: NOOP_LOGGER,
      store: new StateStore(clients.s3, names.bucket, ENV, 'analytics'),
      state,
      siteState: { resources: {} },
      // The same one-line implementation the CLI's `toPluginContext` supplies
      // (`packages/cli/src/plugin-commands.ts`): outputs are stored under the
      // node id in the plugin's OWN state, never the site's.
      record: (nodeId, outputs) => {
        state.resources[nodeId] = outputs;
      },
      save: async () => undefined,
    },
  };
}

/** The one request a test scripted exactly one reply for. */
function onlyRequest(requests: RecordedRequest[]): RecordedRequest {
  if (requests.length !== 1) {
    throw new Error(`expected exactly one AWS request, recorded ${requests.length}`);
  }
  return requests[0] as RecordedRequest;
}

/**
 * The `<date>/<region>/<service>/aws4_request` credential scope out of a SigV4
 * `Authorization` header - the only observable that carries the region a
 * request was signed for. Throws rather than returning a sentinel: a request
 * that was never signed must fail the test that expected a scope, not compare
 * unequal to one.
 */
function credentialScope(headers: Record<string, string>): { region: string; service: string } {
  const authorization = headers['authorization'];
  if (authorization === undefined) {
    throw new Error(`recorded request carried no authorization header: ${JSON.stringify(headers)}`);
  }
  const match = /Credential=[^/]+\/\d{8}\/([^/]+)\/([^/]+)\/aws4_request/.exec(authorization);
  if (!match) throw new Error(`no SigV4 credential scope in: ${authorization}`);
  return { region: match[1] as string, service: match[2] as string };
}

const ENCODED_BUCKET_ARN = encodeURIComponent(TABLE_BUCKET_ARN);

describe('the analytics table graph', () => {
  it('chains table bucket -> namespace -> table', () => {
    expect(analyticsTableBucketNode().id).toBe('analytics-table-bucket');
    expect(analyticsTableBucketNode().dependsOn).toStrictEqual([]);
    expect(analyticsNamespaceNode().id).toBe('analytics-namespace');
    expect(analyticsNamespaceNode().dependsOn).toStrictEqual(['analytics-table-bucket']);
    expect(analyticsTableNode().id).toBe('analytics-table');
    expect(analyticsTableNode().dependsOn).toStrictEqual(['analytics-namespace']);
  });

  it("is assignable to the SPI's own ResourceNode[], so the CLI engine runs it unchanged", () => {
    // The compile-time half is the annotation: `Plugin.nodes` returns the bare
    // `ResourceNode[]` (`PluginContext<never>`), and these are typed over
    // `PluginContext<AnalyticsConfig>`. It only assigns because the node
    // methods are method-declared and therefore bivariant.
    const nodes: ResourceNode[] = [
      analyticsTableBucketNode(),
      analyticsNamespaceNode(),
      analyticsTableNode(),
    ];
    expect(nodes.map((node) => node.id)).toStrictEqual([
      'analytics-table-bucket',
      'analytics-namespace',
      'analytics-table',
    ]);
  });
});

describe('analytics-table-bucket', () => {
  it('reads an existing bucket and hydrates its ARN into the plugin state', async () => {
    const { ctx, requests } = makeContext([ok({ arn: TABLE_BUCKET_ARN, name: TABLE_BUCKET })]);
    await expect(analyticsTableBucketNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).method).toBe('GET');
    expect(onlyRequest(requests).url).toBe(`${HOST}/buckets/${ENCODED_BUCKET_ARN}`);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-table-bucket': { name: TABLE_BUCKET, arn: TABLE_BUCKET_ARN },
    });
  });

  it('reads false without throwing when the bucket is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([notFound()]);
    await expect(analyticsTableBucketNode().read(ctx)).resolves.toBe(false);
    expect(onlyRequest(requests).url).toBe(`${HOST}/buckets/${ENCODED_BUCKET_ARN}`);
    // An empty entry here would claim a resource that does not exist.
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('creates the bucket and records its ARN', async () => {
    const { ctx, requests } = makeContext([ok({ arn: TABLE_BUCKET_ARN })]);
    await analyticsTableBucketNode().create(ctx);
    expect(onlyRequest(requests)).toMatchObject({
      method: 'PUT',
      url: `${HOST}/buckets`,
      body: { name: TABLE_BUCKET },
    });
    expect(ctx.state.resources).toStrictEqual({
      'analytics-table-bucket': { name: TABLE_BUCKET, arn: TABLE_BUCKET_ARN },
    });
  });

  it('deletes an already-absent bucket without throwing', async () => {
    const { ctx, requests } = makeContext([notFound()]);
    await expect(analyticsTableBucketNode().delete(ctx)).resolves.toBeUndefined();
    expect(onlyRequest(requests).method).toBe('DELETE');
    expect(onlyRequest(requests).url).toBe(`${HOST}/buckets/${ENCODED_BUCKET_ARN}`);
  });
});

describe('analytics-namespace', () => {
  it('reads an existing namespace and records it against its bucket', async () => {
    const { ctx, requests } = makeContext([ok({ namespace: [NAMESPACE] })]);
    await expect(analyticsNamespaceNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).method).toBe('GET');
    expect(onlyRequest(requests).url).toBe(`${HOST}/namespaces/${ENCODED_BUCKET_ARN}/${NAMESPACE}`);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-namespace': { name: NAMESPACE, tableBucketArn: TABLE_BUCKET_ARN },
    });
  });

  it('reads false without throwing when the namespace is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([notFound()]);
    await expect(analyticsNamespaceNode().read(ctx)).resolves.toBe(false);
    expect(onlyRequest(requests).url).toBe(`${HOST}/namespaces/${ENCODED_BUCKET_ARN}/${NAMESPACE}`);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('creates the namespace and records its identity', async () => {
    const { ctx, requests } = makeContext([ok({})]);
    await analyticsNamespaceNode().create(ctx);
    expect(onlyRequest(requests)).toMatchObject({
      method: 'PUT',
      url: `${HOST}/namespaces/${ENCODED_BUCKET_ARN}`,
      body: { namespace: [NAMESPACE] },
    });
    expect(ctx.state.resources).toStrictEqual({
      'analytics-namespace': { name: NAMESPACE, tableBucketArn: TABLE_BUCKET_ARN },
    });
  });

  it('deletes an already-absent namespace without throwing', async () => {
    const { ctx, requests } = makeContext([notFound()]);
    await expect(analyticsNamespaceNode().delete(ctx)).resolves.toBeUndefined();
    expect(onlyRequest(requests).method).toBe('DELETE');
    expect(onlyRequest(requests).url).toBe(`${HOST}/namespaces/${ENCODED_BUCKET_ARN}/${NAMESPACE}`);
  });
});

describe('analytics-table', () => {
  it('reads an existing table and hydrates the ARN only GetTable can supply', async () => {
    const { ctx, requests } = makeContext([
      ok({ tableARN: TABLE_ARN, name: TABLE, metadataLocation: 's3://bucket/metadata.json' }),
    ]);
    await expect(analyticsTableNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).method).toBe('GET');
    expect(onlyRequest(requests).url).toBe(
      `${HOST}/get-table?tableBucketARN=${ENCODED_BUCKET_ARN}&namespace=${NAMESPACE}&name=${TABLE}`,
    );
    expect(ctx.state.resources).toStrictEqual({
      'analytics-table': { name: TABLE, arn: TABLE_ARN },
    });
  });

  it('reads false without throwing when the table is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([notFound()]);
    await expect(analyticsTableNode().read(ctx)).resolves.toBe(false);
    expect(onlyRequest(requests).method).toBe('GET');
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('reads a table whose body carries no ARN without recording an empty one', async () => {
    // `getTable`'s `normalizeTable` falls back to `''` when the body omits
    // `tableARN`. Unreachable under the service's response model, but an empty
    // string recorded under `arn` would be read downstream as a real ARN, so
    // the node records nothing rather than something wrong.
    const { ctx } = makeContext([ok({ name: TABLE })]);
    await expect(analyticsTableNode().read(ctx)).resolves.toBe(true);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-table': { name: TABLE } });
  });

  it('creates the table, then hydrates its generated ARN with a second lookup', async () => {
    const { ctx, requests } = makeContext([ok({}), ok({ tableARN: TABLE_ARN, name: TABLE })]);
    await analyticsTableNode().create(ctx);
    expect(requests.map((req) => `${req.method} ${req.url}`)).toStrictEqual([
      `PUT ${HOST}/tables/${ENCODED_BUCKET_ARN}/${NAMESPACE}`,
      `GET ${HOST}/get-table?tableBucketARN=${ENCODED_BUCKET_ARN}&namespace=${NAMESPACE}&name=${TABLE}`,
    ]);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-table': { name: TABLE, arn: TABLE_ARN },
    });
  });

  it('records the table name even when the ARN lookup after CreateTable finds nothing', async () => {
    // The incremental-recording discipline: identity goes into state before the
    // secondary call, so a crash (or an eventually-consistent miss) between the
    // two still leaves the table recorded for `destroy` to remove.
    const { ctx } = makeContext([ok({}), notFound()]);
    await analyticsTableNode().create(ctx);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-table': { name: TABLE } });
  });

  it('records the table name even when the ARN lookup after CreateTable throws', async () => {
    // What pins the ORDER of the two writes in `create`, which the 404 case
    // above cannot: the client turns a not-found into `undefined`, so `create`
    // still returns normally and the recording would land wherever it was
    // written. A failure that is NOT a not-found rethrows straight out of
    // `create`, so only a recording made BEFORE the lookup survives - which is
    // the whole point of making it first. Move `output`/`out.name` below the
    // `getTable` call and this fails, and the real-world shape of that failure
    // is a table sitting in the account with no `analytics-table` entry for
    // the next `analytics destroy` to find.
    //
    // 403 rather than a 5xx, though both take the same rethrow path: GET is
    // idempotent, so core's `withRetry` retries a 5xx five times with
    // exponential backoff (`packages/core/src/util.ts`), which would make this
    // test script four more identical replies, sleep three seconds, and go
    // stale the day that retry budget changes. A 403 is not retryable and not
    // a not-found, so it rethrows on the first attempt - and it is the likelier
    // failure anyway: a deploy role missing `s3tables:GetTable`.
    const { ctx, requests } = makeContext([
      ok({}),
      failure(403, 'AccessDeniedException', 'User is not authorized to perform: s3tables:GetTable'),
    ]);
    await expect(analyticsTableNode().create(ctx)).rejects.toThrow(/getTable/);
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-table': { name: TABLE } });
  });

  it('records no ARN when the lookup after CreateTable answers without one', async () => {
    // The create-path half of the read-path case above: `arn: ''` must not be
    // recorded as though it were the generated ARN.
    const { ctx } = makeContext([ok({}), ok({ name: TABLE })]);
    await analyticsTableNode().create(ctx);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-table': { name: TABLE } });
  });

  it('records through ctx.record, not by assigning into ctx.state directly', async () => {
    // A host whose `record` stores a COPY rather than the object it is handed.
    // The SPI permits it - `record(nodeId, outputs)` promises the outputs are
    // recorded, not that the handle stays live - and both writes here still
    // have to land, which they only do because `output` reads the entry back
    // out of `state` instead of returning what it passed in.
    const { ctx } = makeContext([ok({}), ok({ tableARN: TABLE_ARN })]);
    const copyingHost: PluginContext<AnalyticsConfig> = {
      ...ctx,
      record: (nodeId, outputs) => {
        ctx.state.resources[nodeId] = { ...outputs };
      },
    };
    await analyticsTableNode().create(copyingHost);
    expect(copyingHost.state.resources).toStrictEqual({
      'analytics-table': { name: TABLE, arn: TABLE_ARN },
    });
  });

  it('deletes an already-absent table without throwing', async () => {
    const { ctx, requests } = makeContext([notFound()]);
    await expect(analyticsTableNode().delete(ctx)).resolves.toBeUndefined();
    expect(onlyRequest(requests).method).toBe('DELETE');
    expect(onlyRequest(requests).url).toBe(
      `${HOST}/tables/${ENCODED_BUCKET_ARN}/${NAMESPACE}/${TABLE}`,
    );
  });
});

describe('the page_views create payload', () => {
  /**
   * Written out in full rather than derived from `PAGE_VIEWS_COLUMNS`, which is
   * the whole point of the test: a mapping asserted against its own input
   * passes no matter what the input says. Altering a column in `schema.ts` has
   * to make this fail and name the column. Field ids are positional from 1 -
   * `nodes.ts`'s `pageViewsFields` synthesises them because
   * `IcebergSchemaField.id` is required by the client, so the partition spec
   * can reference a field id in the same `CreateTable` request.
   */
  const EXPECTED_FIELDS = [
    { name: 'event_time', type: 'timestamp', id: 1, required: true },
    { name: 'day', type: 'date', id: 2, required: true },
    { name: 'host', type: 'string', id: 3, required: true },
    { name: 'uri', type: 'string', id: 4, required: true },
    { name: 'query', type: 'string', id: 5, required: false },
    { name: 'method', type: 'string', id: 6, required: false },
    { name: 'status', type: 'int', id: 7, required: true },
    { name: 'referrer', type: 'string', id: 8, required: false },
    { name: 'user_agent', type: 'string', id: 9, required: false },
    { name: 'country', type: 'string', id: 10, required: false },
    { name: 'asn', type: 'string', id: 11, required: false },
    { name: 'edge_location', type: 'string', id: 12, required: false },
    { name: 'result_type', type: 'string', id: 13, required: false },
    { name: 'bytes_sent', type: 'long', id: 14, required: false },
    { name: 'time_taken', type: 'double', id: 15, required: false },
    { name: 'content_type', type: 'string', id: 16, required: false },
    { name: 'protocol', type: 'string', id: 17, required: false },
    { name: 'request_id', type: 'string', id: 18, required: false },
    { name: 'visitor_key', type: 'string', id: 19, required: false },
    { name: 'is_bot', type: 'boolean', id: 20, required: false },
  ];

  it('carries every schema.ts column, in order, with positional field ids', async () => {
    const { ctx, requests } = makeContext([ok({}), ok({ tableARN: TABLE_ARN })]);
    await analyticsTableNode().create(ctx);
    expect(requests[0]?.body).toStrictEqual({
      name: TABLE,
      format: 'ICEBERG',
      metadata: {
        iceberg: {
          schema: { fields: EXPECTED_FIELDS },
          // `source-id` is a genuinely hyphenated JSON key inside an otherwise
          // camelCase payload; `aws/s3tables.ts` owns that translation, and
          // this assertion is on the wire body, so it spells the wire's key.
          partitionSpec: { fields: [{ name: 'day', 'source-id': 2, transform: 'identity' }] },
        },
      },
    });
  });
});

describe('region pinning and name resolution', () => {
  it('signs every call against us-east-1 while config.region says otherwise', async () => {
    const { ctx, requests } = makeContext([
      ok({ arn: TABLE_BUCKET_ARN }),
      ok({}),
      ok({}),
      ok({ tableARN: TABLE_ARN }),
    ]);
    expect(ctx.config.region).toBe(CONFIG_REGION);

    await analyticsTableBucketNode().create(ctx);
    await analyticsNamespaceNode().create(ctx);
    await analyticsTableNode().create(ctx);

    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(credentialScope(request.headers)).toStrictEqual({
        region: 'us-east-1',
        service: 's3tables',
      });
      expect(request.url.startsWith(`${HOST}/`)).toBe(true);
    }
  });

  it('takes all three names from the resolved analytics config, never from ctx.names', async () => {
    // The environment-collision rule these defaults exist for lives with the
    // module that derives them (`config.test.ts`, "derives a different table
    // bucket and a different salt secret for each environment") and is not
    // restated here. What IS this module's concern: the names reaching AWS are
    // the resolved config's, so an operator override lands and `ctx.names`
    // (whose bucket is `test-example-123456789012`) never does.
    const analytics = {
      tableBucket: 'override-analytics',
      namespace: 'custom_ns',
      table: 'custom_table',
    };
    const overrideArn = encodeURIComponent(
      `arn:aws:s3tables:us-east-1:${ACCOUNT_ID}:bucket/${analytics.tableBucket}`,
    );
    const { ctx, requests } = makeContext([ok({}), ok({}), ok({}), ok({ tableARN: TABLE_ARN })], {
      analytics,
    });
    expect(ctx.names.bucket).not.toBe(analytics.tableBucket);

    await analyticsTableBucketNode().create(ctx);
    await analyticsNamespaceNode().create(ctx);
    await analyticsTableNode().create(ctx);

    expect(requests.map((req) => req.url)).toStrictEqual([
      `${HOST}/buckets`,
      `${HOST}/namespaces/${overrideArn}`,
      `${HOST}/tables/${overrideArn}/${analytics.namespace}`,
      `${HOST}/get-table?tableBucketARN=${overrideArn}&namespace=${analytics.namespace}&name=${analytics.table}`,
    ]);
    expect(requests[0]?.body).toStrictEqual({ name: analytics.tableBucket });
    expect(requests[1]?.body).toStrictEqual({ namespace: [analytics.namespace] });
    expect(requests[2]?.body).toMatchObject({ name: analytics.table });
  });
});
