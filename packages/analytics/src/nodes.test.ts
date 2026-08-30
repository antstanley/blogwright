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

import { resolveAnalyticsConfig, validateAnalyticsConfig, type AnalyticsConfig } from './config.js';
import {
  analyticsCatalogIntegrationNode,
  analyticsNamespaceNode,
  analyticsTableBucketNode,
  analyticsTableNode,
} from './nodes.js';

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

/** The one Glue catalog AWS's S3 Tables integration creates per account and Region. */
const CATALOG = 's3tablescatalog';
const CATALOG_ARN = `arn:aws:glue:us-east-1:${ACCOUNT_ID}:catalog/${CATALOG}`;

/**
 * The S3 Tables resource the federation is registered over. Spelled out here
 * rather than derived from the module under test, and deliberately NOT
 * {@link TABLE_BUCKET_ARN}: the integration covers every table bucket in the
 * account and Region, which is the whole reason two environments can share it.
 */
const FEDERATION_SOURCE = `arn:aws:s3tables:us-east-1:${ACCOUNT_ID}:bucket/*`;

/** The same wildcard over a different account - a federation this account must not adopt. */
const OTHER_ACCOUNT_SOURCE = 'arn:aws:s3tables:us-east-1:210987654321:bucket/*';

const GLUE_HOST = 'https://glue.us-east-1.amazonaws.com';

/** Glue is AWS-JSON: every operation is `POST /`, told apart by `x-amz-target`. */
const GLUE_ENDPOINT = `${GLUE_HOST}/`;

/** A second environment in the SAME account, sharing the account-scoped federation. */
const OTHER_ENV = 'production';

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
 * The failure shape Glue puts on the wire, which is not the one S3 Tables uses
 * (see {@link failure}). Glue is AWS-JSON 1.1, so the exception name travels in
 * the body's `__type` and core's `parseError` reads it into `AwsError.code` -
 * which is why `glue.ts` narrows on core's `isNotFound`/`isAlreadyExists`
 * unmodified while its S3 Tables sibling has to narrow on the status. Every
 * documented Glue exception is HTTP 400 except `InternalServiceException`, so
 * the status never separates them.
 */
function glueFailure(status: number, code: string, message: string): RawResponse {
  const text = JSON.stringify({ __type: code, Message: message });
  return {
    statusCode: status,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/**
 * `GetCatalog`'s reply for a catalog that does not exist - and, unavoidably,
 * the same reply it gives when the catalog exists but the S3 Tables source it
 * federates does not. Telling those two apart is what the node's read-back
 * after `CreateCatalog` is for.
 */
function entityNotFound(): RawResponse {
  return glueFailure(400, 'EntityNotFoundException', 'Entity Not Found');
}

/** A `GetCatalog` success body in the service's own shape, wrapping `catalog`. */
function catalogBody(catalog: Record<string, unknown>): Record<string, unknown> {
  return { Catalog: { Name: CATALOG, CatalogId: CATALOG, ...catalog } };
}

/** The `FederatedCatalog` member of a catalog federated over `source`. */
function federatedOver(source: string): Record<string, unknown> {
  return { Identifier: source, ConnectionName: 'aws:s3tables' };
}

/** The reply for this account's own, correctly federated `s3tablescatalog`. */
function existingFederation(): RawResponse {
  return ok(
    catalogBody({ ResourceArn: CATALOG_ARN, FederatedCatalog: federatedOver(FEDERATION_SOURCE) }),
  );
}

/** The `x-amz-target` of each recorded request, which is how a Glue operation is named. */
function targets(requests: RecordedRequest[]): (string | undefined)[] {
  return requests.map((request) => request.headers['x-amz-target']);
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

describe('analytics-catalog-integration', () => {
  const ADOPTED = {
    'analytics-catalog-integration': {
      name: CATALOG,
      sourceIdentifier: FEDERATION_SOURCE,
      arn: CATALOG_ARN,
    },
  };

  it("hangs off analytics-table and assigns to the SPI's own ResourceNode[]", () => {
    const node = analyticsCatalogIntegrationNode();
    expect(node.id).toBe('analytics-catalog-integration');
    expect(node.dependsOn).toStrictEqual(['analytics-table']);
    const nodes: ResourceNode[] = [node];
    expect(nodes[0]?.id).toBe('analytics-catalog-integration');
  });

  it('names the integration as shared, account-and-region scoped state where an operator sees it', async () => {
    // Both halves of the same requirement: `analytics bootstrap` prints the
    // title through `applyGraph` and the create line through the node itself,
    // and an operator has to be able to tell from either that this resource is
    // not their environment's own.
    const node = analyticsCatalogIntegrationNode();
    expect(node.title).toContain(CATALOG);
    expect(node.title).toContain('account-and-region scoped');
    expect(node.title).toContain('shared');

    const steps: string[] = [];
    const { ctx } = makeContext([ok({}), existingFederation()]);
    await node.create({
      ...ctx,
      logger: { ...NOOP_LOGGER, step: (msg) => steps.push(msg) },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain('account-and-region scoped');
    expect(steps[0]).toContain(FEDERATION_SOURCE);
  });

  it('reads false without throwing when no federation exists, recording nothing', async () => {
    const { ctx, requests } = makeContext([entityNotFound()]);
    await expect(analyticsCatalogIntegrationNode().read(ctx)).resolves.toBe(false);
    expect(onlyRequest(requests).url).toBe(GLUE_ENDPOINT);
    expect(targets(requests)).toStrictEqual(['AWSGlue.GetCatalog']);
    expect(onlyRequest(requests).body).toStrictEqual({ CatalogId: CATALOG });
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('creates the federation over every table bucket in the account, then reads it back', async () => {
    const { ctx, requests } = makeContext([ok({}), existingFederation()]);
    await analyticsCatalogIntegrationNode().create(ctx);
    expect(targets(requests)).toStrictEqual(['AWSGlue.CreateCatalog', 'AWSGlue.GetCatalog']);
    // The account-and-region wildcard, not this environment's table bucket:
    // the catalog federates every bucket in the account, which is what lets a
    // second environment adopt the same one.
    expect(requests[0]?.body).toMatchObject({
      Name: CATALOG,
      CatalogInput: { FederatedCatalog: { Identifier: FEDERATION_SOURCE } },
    });
    expect(requests[0]?.body).not.toMatchObject({
      CatalogInput: { FederatedCatalog: { Identifier: TABLE_BUCKET_ARN } },
    });
    expect(ctx.state.resources).toStrictEqual(ADOPTED);
  });

  it('adopts an existing federation and issues no CreateCatalog', async () => {
    const { ctx, requests } = makeContext([existingFederation()]);
    await expect(analyticsCatalogIntegrationNode().read(ctx)).resolves.toBe(true);
    // Asserted as the whole call log rather than as "no error": a create that
    // went out and was swallowed as a duplicate would leave this list longer.
    expect(targets(requests)).toStrictEqual(['AWSGlue.GetCatalog']);
    expect(ctx.state.resources).toStrictEqual(ADOPTED);
  });

  it('adopts a federation whose body carries no catalog ARN without recording an empty one', async () => {
    // `normalizeCatalog` falls back to `''` when the body omits `ResourceArn`,
    // and an empty string recorded under `arn` reads downstream as a real one.
    const { ctx } = makeContext([
      ok(catalogBody({ FederatedCatalog: federatedOver(FEDERATION_SOURCE) })),
    ]);
    await expect(analyticsCatalogIntegrationNode().read(ctx)).resolves.toBe(true);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-catalog-integration': { name: CATALOG, sourceIdentifier: FEDERATION_SOURCE },
    });
  });

  it('refuses a same-named catalog that carries no federation at all', async () => {
    // `CatalogInput` has no required members, so a `CreateCatalog` that omitted
    // `FederatedCatalog` leaves an empty catalog of the right name behind. A
    // successful lookup is therefore not evidence of a federation.
    const { ctx, requests } = makeContext([ok(catalogBody({ ResourceArn: CATALOG_ARN }))]);
    await expect(analyticsCatalogIntegrationNode().read(ctx)).rejects.toThrow(
      /is not a federated catalog/,
    );
    expect(targets(requests)).toStrictEqual(['AWSGlue.GetCatalog']);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it("refuses a catalog federated over some other account's table buckets", async () => {
    const { ctx } = makeContext([
      ok(
        catalogBody({
          ResourceArn: CATALOG_ARN,
          FederatedCatalog: federatedOver(OTHER_ACCOUNT_SOURCE),
        }),
      ),
    ]);
    await expect(analyticsCatalogIntegrationNode().read(ctx)).rejects.toThrow(OTHER_ACCOUNT_SOURCE);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('fails loudly when the federation is still unreadable after CreateCatalog reported success', async () => {
    // The routed finding, end to end, and the reason `create` reads back at all.
    // `GetCatalog` answers `EntityNotFoundException` both for a catalog that is
    // absent and for one whose own S3 Tables source is absent, so a federation
    // broken at its source reads as "no catalog" and `create` runs;
    // `createCatalogFederation` then swallows
    // `FederatedResourceAlreadyExistsException`, because a second environment
    // genuinely does have to adopt what is already there. Delete the read-back
    // and this reconcile converges green on a federation wired to nothing, with
    // Firehose routing every record to the error bucket as the first symptom.
    const { ctx, requests } = makeContext([
      glueFailure(
        400,
        'FederatedResourceAlreadyExistsException',
        'Federated resource already exists',
      ),
      entityNotFound(),
    ]);
    await expect(analyticsCatalogIntegrationNode().create(ctx)).rejects.toThrow(
      /never wired to "arn:aws:s3tables:us-east-1:\d+:bucket\/\*"/,
    );
    expect(targets(requests)).toStrictEqual(['AWSGlue.CreateCatalog', 'AWSGlue.GetCatalog']);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('records nothing when the read-back after CreateCatalog throws', async () => {
    // Pins the ORDER of the two writes in `create`, and pins it the opposite way
    // round from `analytics-table`. There the identity is recorded BEFORE the
    // follow-up lookup, so a crash still leaves the table in state for `destroy`
    // to remove. Here `delete` removes nothing, so an early record protects
    // nothing - while an entry under this node's id is the claim that the
    // pipeline has a verified catalog to read through, which is exactly what has
    // not been established yet. Move the `output` call above the lookup and this
    // fails.
    //
    // 403 rather than a 5xx, as elsewhere in this file - though here the retry
    // budget is not even in play: Glue's lookup is a `POST`, and core's signer
    // retries a non-idempotent method only on a network-level failure
    // (`packages/core/src/aws/signer.ts`). The request count below pins that.
    const { ctx, requests } = makeContext([
      ok({}),
      glueFailure(
        403,
        'AccessDeniedException',
        'User is not authorized to perform: glue:GetCatalog',
      ),
    ]);
    await expect(analyticsCatalogIntegrationNode().create(ctx)).rejects.toThrow(
      /getCatalogFederation/,
    );
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('lets a second environment in the same account adopt the same federation, creating nothing', async () => {
    // Convergence, which is the point of the whole node. Two environments, one
    // account: both derive the same account-and-region wildcard, both find the
    // one catalog, and neither issues a CreateCatalog for the other to fight
    // with.
    const staging = makeContext([existingFederation()]);
    const other = makeContext([existingFederation()]);
    const production: PluginContext<AnalyticsConfig> = { ...other.ctx, env: OTHER_ENV };

    // The two contexts really are different environments - their table buckets
    // differ, which is what would make a per-bucket federation unadoptable.
    expect(resolveAnalyticsConfig(production).tableBucket).not.toBe(
      resolveAnalyticsConfig(staging.ctx).tableBucket,
    );

    await expect(analyticsCatalogIntegrationNode().read(staging.ctx)).resolves.toBe(true);
    await expect(analyticsCatalogIntegrationNode().read(production)).resolves.toBe(true);

    expect(targets(staging.requests)).toStrictEqual(['AWSGlue.GetCatalog']);
    expect(targets(other.requests)).toStrictEqual(['AWSGlue.GetCatalog']);
    expect(staging.ctx.state.resources).toStrictEqual(ADOPTED);
    expect(production.state.resources).toStrictEqual(ADOPTED);
  });

  it('issues no Glue call at all when the whole node set is torn down', async () => {
    // `destroyGraph` calls every node's `delete` in reverse topological order
    // (`packages/cli/src/graph.ts`), so the catalog node's runs first. The engine
    // lives in the CLI package, which this one cannot import, so the reverse walk
    // is spelled out here; the three S3 Tables deletes are what keep the sweep
    // from being vacuous - they prove the loop ran and the transport was
    // recording while the Glue call log stayed empty.
    const nodes = [
      analyticsTableBucketNode(),
      analyticsNamespaceNode(),
      analyticsTableNode(),
      analyticsCatalogIntegrationNode(),
    ];
    const { ctx, requests } = makeContext([notFound(), notFound(), notFound()]);
    for (const node of [...nodes].reverse()) {
      await expect(node.delete(ctx)).resolves.toBeUndefined();
    }
    expect(requests.filter((request) => request.url.startsWith(GLUE_HOST))).toStrictEqual([]);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `DELETE ${HOST}/tables/${ENCODED_BUCKET_ARN}/${NAMESPACE}/${TABLE}`,
      `DELETE ${HOST}/namespaces/${ENCODED_BUCKET_ARN}/${NAMESPACE}`,
      `DELETE ${HOST}/buckets/${ENCODED_BUCKET_ARN}`,
    ]);
  });
});
