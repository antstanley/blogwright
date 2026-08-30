import { basename, isAbsolute, join } from 'node:path';

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
  type ResourceOutputs,
  type Terminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it, vi } from 'vitest';

import { resolveAnalyticsConfig, validateAnalyticsConfig, type AnalyticsConfig } from './config.js';
import {
  analyticsCatalogIntegrationNode,
  analyticsNamespaceNode,
  analyticsSaltSecretNode,
  analyticsTableBucketNode,
  analyticsTableNode,
  analyticsTransformFunctionNode,
  analyticsTransformRoleNode,
  transformUpdate,
} from './nodes.js';
import { ANALYTICS_PACKAGE_DIR } from './paths.js';
import { SALT_SECRET_NAME_ENV } from './transform/handler.js';
import {
  TRANSFORM_BUNDLE_DIR,
  TRANSFORM_BUNDLE_FILE,
  TRANSFORM_LAMBDA_HANDLER,
  TRANSFORM_MANIFEST_FILE,
} from './transform-hash.js';

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

/** `<siteName>/<env>/analytics-salt`, the `saltSecretName` default `config.ts` derives. */
const SALT_SECRET = 'example/test/analytics-salt';

/**
 * The salt secret's ARN. Its last segment is the six random characters Secrets
 * Manager appends to every secret's name - which is why the ARN is unreachable
 * without a `DescribeSecret`, and why the role node depends on the secret node
 * rather than deriving this.
 */
const SALT_SECRET_ARN = `arn:aws:secretsmanager:us-east-1:${ACCOUNT_ID}:secret:${SALT_SECRET}-AbCdEf`;

/** `<env>-<siteName>` - `deriveNames`' prefix, which both names below hang off. */
const PREFIX = `${ENV}-${SITE_NAME}`;

const TRANSFORM_ROLE = `${PREFIX}-analytics-transform-role`;
const TRANSFORM_ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/${TRANSFORM_ROLE}`;

const TRANSFORM_FUNCTION = `${PREFIX}-analytics-transform`;
const TRANSFORM_FUNCTION_ARN = `arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:${TRANSFORM_FUNCTION}`;

/**
 * The log group the role's `logs:` grant is scoped to, spelled out here rather
 * than derived from the module under test. `us-east-1`, not
 * {@link CONFIG_REGION}: the function is pinned, so its log group is too.
 */
const TRANSFORM_LOG_GROUP_ARN = `arn:aws:logs:us-east-1:${ACCOUNT_ID}:log-group:/aws/lambda/${TRANSFORM_FUNCTION}:*`;

/** IAM is a global service, so core's own client already signs and addresses us-east-1. */
const IAM_HOST = 'https://iam.amazonaws.com';
const IAM_ENDPOINT = `${IAM_HOST}/`;

/** Secrets Manager is AWS-JSON: every operation is `POST /`, told apart by `x-amz-target`. */
const SECRETS_HOST = 'https://secretsmanager.us-east-1.amazonaws.com';
const SECRETS_ENDPOINT = `${SECRETS_HOST}/`;

/** The standard Lambda function API, on the same host `MicrovmsClient` uses and a different path prefix. */
const LAMBDA_HOST = 'https://lambda.us-east-1.amazonaws.com';
const LAMBDA_FUNCTIONS = `${LAMBDA_HOST}/2015-03-31/functions`;

/**
 * The source hash the fixture manifest carries. Any twelve hex characters: the
 * node compares it to what it recorded and never to a literal, and what makes
 * the real hash move when the source does is `transform-hash.test.ts`.
 */
const BUNDLE_HASH = 'a1b2c3d4e5f6';

/** The key that hash derives - `transformZipKey`'s form, restated so the test does not derive it from the module under test. */
const BUNDLE_ZIP_KEY = `analytics/transform/transform-${BUNDLE_HASH}.zip`;

/** Stand-in bundle bytes. Never loaded or executed here - it is the zip's one entry and nothing more. */
const BUNDLE_SOURCE = 'export const handler = async () => ({ records: [] });\n';

/** Where the built artifacts sit: the package root `paths.ts` resolves, then task 43's directory. */
const ARTIFACT_DIR = join(ANALYTICS_PACKAGE_DIR, TRANSFORM_BUNDLE_DIR);

/**
 * The two files this package ships for its own function node to deploy - the
 * bundle, and the manifest stamped *beside* it. The manifest is never packed
 * into the zip, which is what the create case asserts on the wire.
 */
const BUNDLED_ARTIFACTS: Record<string, string> = {
  [join(ARTIFACT_DIR, TRANSFORM_BUNDLE_FILE)]: BUNDLE_SOURCE,
  [join(ARTIFACT_DIR, TRANSFORM_MANIFEST_FILE)]: JSON.stringify({
    hash: BUNDLE_HASH,
    key: BUNDLE_ZIP_KEY,
  }),
};

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
 * A recorded request's body, parsed where it is JSON and left as the raw string
 * where it is not.
 *
 * IAM is the reason this is not a bare `JSON.parse`: it is a *query-protocol*
 * service, so `IamClient` puts a form-encoded body on the wire
 * (`packages/core/src/aws/form.ts`) and a blanket parse would throw inside the
 * fixture before any assertion ran. Every JSON body still arrives parsed, so
 * nothing above this line changes; {@link formBody} is how the IAM cases read
 * theirs.
 */
function parseBody(body: string): unknown {
  if (body.trimStart().startsWith('{')) return JSON.parse(body);
  return body;
}

/** One recorded form-encoded request body (IAM's query protocol) as its parameter map. */
function formBody(request: RecordedRequest): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of String(request.body).split('&')) {
    const [key, value] = pair.split('=');
    if (key === undefined) continue;
    params[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
  }
  return params;
}

/** The `Action` of each recorded IAM request - how a query-protocol operation is named. */
function actions(requests: RecordedRequest[]): (string | undefined)[] {
  return requests.map((request) => formBody(request)['Action']);
}

/** An IAM (query-protocol) success body. */
function iamXml(body: string): RawResponse {
  return encode(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
}

/** `CreateRole`'s reply - the one operation whose response this plugin reads an ARN out of. */
function createdRole(arn: string): RawResponse {
  return iamXml(
    `<CreateRoleResponse><CreateRoleResult><Role><RoleName>${TRANSFORM_ROLE}</RoleName><Arn>${arn}</Arn></Role></CreateRoleResult></CreateRoleResponse>`,
  );
}

/** `GetRole`'s reply. */
function existingRole(arn: string): RawResponse {
  return iamXml(
    `<GetRoleResponse><GetRoleResult><Role><RoleName>${TRANSFORM_ROLE}</RoleName><Arn>${arn}</Arn></Role></GetRoleResult></GetRoleResponse>`,
  );
}

/** `ListRolePolicies`' reply - the inline policy names `deleteRole` removes before the role. */
function rolePolicies(names: string[]): RawResponse {
  const members = names.map((name) => `<member>${name}</member>`).join('');
  return iamXml(
    `<ListRolePoliciesResponse><ListRolePoliciesResult><PolicyNames>${members}</PolicyNames><IsTruncated>false</IsTruncated></ListRolePoliciesResult></ListRolePoliciesResponse>`,
  );
}

/** A reply for an IAM operation that answers with nothing this client reads. */
function iamDone(action: string): RawResponse {
  return iamXml(
    `<${action}Response><ResponseMetadata><RequestId>req</RequestId></ResponseMetadata></${action}Response>`,
  );
}

/**
 * The failure shape IAM puts on the wire: REST-XML, so core's `parseError`
 * reads the code out of the `<Code>` element and `AwsError.isNotFound` matches
 * `NoSuchEntity` on the code rather than on the status.
 */
function iamFailure(status: number, code: string, message: string): RawResponse {
  const text = `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>req</RequestId></ErrorResponse>`;
  return {
    statusCode: status,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** IAM's reply for a role that does not exist. */
function noSuchRole(): RawResponse {
  return iamFailure(404, 'NoSuchEntity', `The role with name ${TRANSFORM_ROLE} cannot be found.`);
}

/**
 * The failure shape Secrets Manager puts on the wire - AWS-JSON 1.1, like Glue
 * and unlike S3 Tables, so the exception name travels in the body's `__type`
 * and reaches `AwsError.code`.
 */
function secretsFailure(status: number, code: string, message: string): RawResponse {
  const text = JSON.stringify({ __type: code, message });
  return {
    statusCode: status,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** `DescribeSecret`'s reply for a secret that does not exist. */
function noSuchSecret(): RawResponse {
  return secretsFailure(
    400,
    'ResourceNotFoundException',
    "Secrets Manager can't find the specified secret.",
  );
}

/** `DescribeSecret`'s reply for one that does - metadata only; the value is never in it. */
function existingSecret(arn = SALT_SECRET_ARN): RawResponse {
  return ok({ ARN: arn, Name: SALT_SECRET, LastChangedDate: 1_756_000_000 });
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
  overrides: {
    config?: Partial<OpsConfig>;
    analytics?: Record<string, unknown>;
    env?: string;
    /** The package's own shipped files, as `analytics-transform-function` reads them off the FileSystem port. Defaults to {@link BUNDLED_ARTIFACTS}; pass `{}` for an unbuilt checkout. */
    files?: Record<string, string>;
    /** Collected `logger.warn` lines, when a test asserts on them. */
    warnings?: string[];
  } = {},
): { ctx: PluginContext<AnalyticsConfig>; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];
  const transport: Transport = async (req) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body === undefined ? undefined : parseBody(String(req.body)),
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
  const env = overrides.env ?? ENV;
  const names = deriveNames(env, ACCOUNT_ID, config);
  const state = emptyState(env);
  const warnings = overrides.warnings;

  return {
    requests,
    ctx: {
      env,
      domain: undefined,
      preview: false,
      config,
      pluginConfig: validateAnalyticsConfig(overrides.analytics ?? {}),
      names,
      accountId: ACCOUNT_ID,
      clients,
      ports: {
        fs: createMemoryFileSystem(overrides.files ?? BUNDLED_ARTIFACTS),
        terminal: SILENT_TERMINAL,
      },
      logger:
        warnings === undefined
          ? NOOP_LOGGER
          : { ...NOOP_LOGGER, warn: (msg) => warnings.push(msg) },
      store: new StateStore(clients.s3, names.bucket, env, 'analytics'),
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

/**
 * The file names inside a zip, read out of its local file headers: each starts
 * with the `PK\x03\x04` signature, carries the name's length as a 16-bit
 * little-endian field at offset 26, and the name itself at offset 30.
 *
 * Scanning every offset for the signature could in principle match compressed
 * bytes rather than a header; it cannot here, because the fixture bundle is one
 * short ASCII line whose deflate output is shorter than the signature is rare.
 * What this buys is the assertion that matters: the deployment package holds
 * exactly the bundle, under the name the configured `Handler` resolves against.
 */
function zipEntryNames(base64: string): string[] {
  const bytes = Buffer.from(base64, 'base64');
  const names: string[] = [];
  for (let at = 0; at + 30 <= bytes.length; at++) {
    if (bytes.readUInt32LE(at) !== 0x0403_4b50) continue;
    names.push(bytes.toString('utf8', at + 30, at + 30 + bytes.readUInt16LE(at + 26)));
  }
  return names;
}

/** Record what `analytics-salt-secret` records, so the role node has an ARN to interpolate. */
function withSaltSecret(
  ctx: PluginContext<AnalyticsConfig>,
  arn: string = SALT_SECRET_ARN,
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-salt-secret', { name: SALT_SECRET, arn });
  return ctx;
}

/** Record what `analytics-transform-role` records, so the function node has a role to run as. */
function withTransformRole(ctx: PluginContext<AnalyticsConfig>): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-transform-role', { name: TRANSFORM_ROLE, arn: TRANSFORM_ROLE_ARN });
  return ctx;
}

/**
 * The configuration fingerprint `analytics-transform-function` records, spelled
 * out here rather than taken off the module under test - so the runtime, the
 * handler, the memory and the timeout are asserted values rather than whatever
 * the module happens to hold, and so the update gate has a recorded value to
 * compare against.
 *
 * The key order is the order `transformConfiguration` builds them in, and it is
 * load-bearing by construction: the fingerprint is a `JSON.stringify` of that
 * literal, so reordering it makes every already-deployed function take one
 * (harmless) configuration update on the next reconcile. Pinning it here is
 * what makes that visible rather than silent.
 */
function deployedConfiguration(secretName: string = SALT_SECRET): string {
  return JSON.stringify({
    roleArn: TRANSFORM_ROLE_ARN,
    runtime: 'nodejs22.x',
    handler: TRANSFORM_LAMBDA_HANDLER,
    memoryMb: 256,
    timeoutSeconds: 60,
    environment: { [SALT_SECRET_NAME_ENV]: secretName },
  });
}

/** What the function node records once it has deployed the fixture bundle. */
function deployedFunction(secretName: string = SALT_SECRET): ResourceOutputs {
  return {
    name: TRANSFORM_FUNCTION,
    arn: TRANSFORM_FUNCTION_ARN,
    sourceHash: BUNDLE_HASH,
    codeKey: BUNDLE_ZIP_KEY,
    configuration: deployedConfiguration(secretName),
  };
}

describe('the analytics transform graph', () => {
  it('chains salt-secret -> transform-role -> transform-function', () => {
    expect(analyticsSaltSecretNode().id).toBe('analytics-salt-secret');
    expect(analyticsSaltSecretNode().dependsOn).toStrictEqual([]);
    expect(analyticsTransformRoleNode().id).toBe('analytics-transform-role');
    // The edge this task exists to get right: the role's policy interpolates
    // the ARN the secret node records. `dependsOn: []` here would happen to
    // reconcile in the same order anyway - `topoSort` sorts its zero-indegree
    // queue and `analytics-salt-secret` sorts first - so what this pins is the
    // dependency stated rather than left to the ids: rename either node past
    // the other and an implicit ordering flips in silence, while this edge
    // either still holds or makes `topoSort` throw.
    expect(analyticsTransformRoleNode().dependsOn).toStrictEqual(['analytics-salt-secret']);
    expect(analyticsTransformFunctionNode().id).toBe('analytics-transform-function');
    expect(analyticsTransformFunctionNode().dependsOn).toStrictEqual(['analytics-transform-role']);
  });

  it("is assignable to the SPI's own ResourceNode[], so the CLI engine runs it unchanged", () => {
    const nodes: ResourceNode[] = [
      analyticsSaltSecretNode(),
      analyticsTransformRoleNode(),
      analyticsTransformFunctionNode(),
    ];
    expect(nodes.map((node) => node.id)).toStrictEqual([
      'analytics-salt-secret',
      'analytics-transform-role',
      'analytics-transform-function',
    ]);
  });

  it('resolves its own package directory rather than the source directory it is compiled from', () => {
    // `paths.ts` is the only module in this package allowed to touch
    // `import.meta.url`, and the artifacts it locates sit under the PACKAGE
    // root - `<package>/dist/transform-bundle` - not under `src/` or under
    // `packages/`. One `..` too few resolves to the compiled/source directory
    // and one too many to the workspace's `packages/`, and both fail here.
    expect(isAbsolute(ANALYTICS_PACKAGE_DIR)).toBe(true);
    expect(basename(ANALYTICS_PACKAGE_DIR)).toBe('analytics');
  });
});

describe('analytics-salt-secret', () => {
  it('reads an existing secret, recording its ARN and never its value', async () => {
    const { ctx, requests } = makeContext([existingSecret()]);
    await expect(analyticsSaltSecretNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).url).toBe(SECRETS_ENDPOINT);
    // DescribeSecret, never GetSecretValue: existence is the question, and the
    // value is not this process's business at any point.
    expect(targets(requests)).toStrictEqual(['secretsmanager.DescribeSecret']);
    expect(onlyRequest(requests).body).toStrictEqual({ SecretId: SALT_SECRET });
    expect(ctx.state.resources).toStrictEqual({
      'analytics-salt-secret': { name: SALT_SECRET, arn: SALT_SECRET_ARN },
    });
  });

  it('reads false without throwing when the secret is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([noSuchSecret()]);
    await expect(analyticsSaltSecretNode().read(ctx)).resolves.toBe(false);
    expect(targets(requests)).toStrictEqual(['secretsmanager.DescribeSecret']);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('reads a secret whose body carries no ARN without recording an empty one', async () => {
    // `describeSecret` reads `ARN` straight off the response and does not
    // validate it (`core/src/aws/secretsmanager.ts`), so a body missing the
    // field reaches this node as `undefined` despite the declared type - and an
    // ARN recorded as `""` is what `requireSaltSecretArn` would then have to
    // catch on the far side of a state write.
    const { ctx } = makeContext([ok({ Name: SALT_SECRET, LastChangedDate: 1_756_000_000 })]);
    await expect(analyticsSaltSecretNode().read(ctx)).resolves.toBe(true);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-salt-secret': { name: SALT_SECRET } });
  });

  it('creates the secret with a random value, configuring no rotation', async () => {
    const { ctx, requests } = makeContext([noSuchSecret(), ok({}), existingSecret()]);
    await analyticsSaltSecretNode().create(ctx);

    expect(targets(requests)).toStrictEqual([
      // The guard read - see the adopt case below for what it prevents.
      'secretsmanager.DescribeSecret',
      'secretsmanager.CreateSecret',
      // The ARN, which CreateSecret's response is discarded by `upsertSecret`.
      'secretsmanager.DescribeSecret',
    ]);

    const created = requests[1]?.body;
    expect(created).toMatchObject({ Name: SALT_SECRET, Description: expect.any(String) });
    // Asserted as the whole key set, not with `not.toHaveProperty`: rotation is
    // configured through several keys and a new one could be added, so the
    // check is "these keys and no others". Daily turnover comes from
    // HMAC-SHA256(secret, day) in the transform, so a rotation Lambda, its
    // schedule and its own role would exist to replace the one value that must
    // never change.
    expect(Object.keys(created as Record<string, unknown>).sort()).toStrictEqual([
      'ClientRequestToken',
      'Description',
      'Name',
      'SecretString',
    ]);

    // 32 bytes of CSPRNG output, base64-encoded.
    const value = (created as { SecretString: string }).SecretString;
    expect(value).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(value, 'base64')).toHaveLength(32);

    expect(ctx.state.resources).toStrictEqual({
      'analytics-salt-secret': { name: SALT_SECRET, arn: SALT_SECRET_ARN },
    });
    // The value reaches Secrets Manager and nothing else - not the state file,
    // which is written to the site's S3 bucket.
    expect(JSON.stringify(ctx.state)).not.toContain(value);
  });

  it('generates a different value every time, so two environments never share a salt', async () => {
    const values: string[] = [];
    for (const env of [ENV, OTHER_ENV]) {
      const { ctx, requests } = makeContext([noSuchSecret(), ok({}), existingSecret()], { env });
      await analyticsSaltSecretNode().create(ctx);
      const created = requests[1]?.body as { SecretString: string };
      values.push(created.SecretString);
    }
    expect(values[0]).not.toBe(values[1]);
  });

  it('adopts a secret that exists when create runs, issuing no write at all', async () => {
    // The guard that makes "created if absent, never overwritten" true rather
    // than merely intended. `create` runs only after `read` answered false, so
    // this is the concurrent-bootstrap window - and the call it guards is
    // `upsertSecret`, which falls back to PutSecretValue when CreateSecret
    // reports the secret already exists. Drop the DescribeSecret below and the
    // call log becomes [CreateSecret, PutSecretValue]: every visitor_key
    // already written orphaned, silently and unrepairably.
    const warnings: string[] = [];
    const { ctx, requests } = makeContext([existingSecret()], { warnings });
    await analyticsSaltSecretNode().create(ctx);

    expect(targets(requests)).toStrictEqual(['secretsmanager.DescribeSecret']);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-salt-secret': { name: SALT_SECRET, arn: SALT_SECRET_ARN },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(SALT_SECRET);
    expect(warnings[0]).toContain('adopting');
  });

  it('records the secret name even when the ARN lookup after CreateSecret throws', async () => {
    // Pins the ORDER of the two writes in `create`. `upsertSecret` discards
    // CreateSecret's response, so the ARN takes a second request; a failure
    // there that is not a not-found rethrows straight out of `create`, so only
    // a recording made BEFORE the lookup survives. Without it the account holds
    // a secret no state file mentions.
    //
    // 403 rather than a 5xx, as elsewhere in this file: DescribeSecret is a
    // POST, which core's signer retries only on a network-level failure, and a
    // 403 is the likelier failure anyway - a deploy role without
    // `secretsmanager:DescribeSecret`.
    const { ctx, requests } = makeContext([
      noSuchSecret(),
      ok({}),
      secretsFailure(403, 'AccessDeniedException', 'is not authorized to perform'),
    ]);
    await expect(analyticsSaltSecretNode().create(ctx)).rejects.toThrow(/AccessDenied/);
    expect(requests).toHaveLength(3);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-salt-secret': { name: SALT_SECRET } });
  });

  it('records no ARN when the lookup after CreateSecret answers without one', async () => {
    // The same unvalidated `ARN` as the read case, on the write path: the
    // secret exists and its name is recorded, and the one field that could not
    // be derived is simply absent rather than present and empty.
    const { ctx } = makeContext([noSuchSecret(), ok({}), ok({ Name: SALT_SECRET })]);
    await analyticsSaltSecretNode().create(ctx);
    expect(ctx.state.resources).toStrictEqual({ 'analytics-salt-secret': { name: SALT_SECRET } });
  });

  it('deletes nothing on teardown and says what it kept', async () => {
    // Deliberately inert, and the second inert `delete` in this graph for a
    // different reason than the catalog federation's. Core's `deleteSecret`
    // sends ForceDeleteWithoutRecovery, so there is no recovery window: keeping
    // the secret costs cents and one command, deleting it destroys the ability
    // to interpret any page_views data that outlived the teardown - including
    // an environment torn down and re-bootstrapped, which would come back with
    // a different seed and no sign anything had changed.
    const warnings: string[] = [];
    const { ctx, requests } = makeContext([], { warnings });
    await expect(analyticsSaltSecretNode().delete(ctx)).resolves.toBeUndefined();
    expect(requests).toStrictEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(SALT_SECRET);
    expect(warnings[0]).toContain('delete-secret');
    expect(analyticsSaltSecretNode().title).toContain('kept on teardown');
  });

  it('takes the secret name from the resolved analytics config, never from ctx.names', async () => {
    const saltSecretName = 'override/analytics/salt';
    const { ctx, requests } = makeContext([existingSecret()], { analytics: { saltSecretName } });
    await expect(analyticsSaltSecretNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).body).toStrictEqual({ SecretId: saltSecretName });
  });
});

describe('analytics-transform-role', () => {
  it('reads an existing role and records its ARN', async () => {
    const { ctx, requests } = makeContext([existingRole(TRANSFORM_ROLE_ARN)]);
    await expect(analyticsTransformRoleNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).url).toBe(IAM_ENDPOINT);
    expect(actions(requests)).toStrictEqual(['GetRole']);
    expect(formBody(onlyRequest(requests))['RoleName']).toBe(TRANSFORM_ROLE);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-transform-role': { name: TRANSFORM_ROLE, arn: TRANSFORM_ROLE_ARN },
    });
  });

  it('reads false without throwing when the role is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([noSuchRole()]);
    await expect(analyticsTransformRoleNode().read(ctx)).resolves.toBe(false);
    expect(actions(requests)).toStrictEqual(['GetRole']);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('reads false for a role whose body carries an empty ARN, recording nothing', async () => {
    // `getRoleArn` returns `textTag(xml, 'Arn')`, which answers `''` for an
    // empty element and `undefined` for an absent one. The guard is falsy
    // rather than `=== undefined` because neither is a role - and recording
    // `arn: ''` here is exactly what `requireSaltSecretArn`'s sibling guard on
    // the role ARN exists to catch one node later.
    const { ctx, requests } = makeContext([existingRole('')]);
    await expect(analyticsTransformRoleNode().read(ctx)).resolves.toBe(false);
    expect(actions(requests)).toStrictEqual(['GetRole']);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('creates the role with the Lambda trust document, then applies its policy', async () => {
    const { ctx, requests } = makeContext([
      createdRole(TRANSFORM_ROLE_ARN),
      iamDone('PutRolePolicy'),
    ]);
    await analyticsTransformRoleNode().create(withSaltSecret(ctx));

    expect(actions(requests)).toStrictEqual(['CreateRole', 'PutRolePolicy']);
    // The trust shape restated from `packages/cli/src/nodes.ts:106-115` -
    // written out here rather than imported for the same reason the module
    // restates it: a plugin may not import the CLI, so nothing but this
    // assertion holds the two copies to the same shape.
    expect(
      JSON.parse(formBody(requests[0] as RecordedRequest)['AssumeRolePolicyDocument'] ?? ''),
    ).toStrictEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: ['sts:AssumeRole', 'sts:TagSession'],
        },
      ],
    });
    expect(formBody(requests[1] as RecordedRequest)['PolicyName']).toBe('transform');
    expect(ctx.state.resources['analytics-transform-role']).toStrictEqual({
      name: TRANSFORM_ROLE,
      arn: TRANSFORM_ROLE_ARN,
    });
  });

  it('grants on two concrete ARNs and no wildcard resource', async () => {
    // The assertion is on the parsed policy document, not on the call count: a
    // `Resource: '*'` grants strictly more than the correct document, so every
    // functional test in this file still passes with one. That defect was
    // caught by mutation elsewhere in this build and this is what catches it
    // here - the transform's role would otherwise be able to read every secret
    // in the account, including the other environments' salts and
    // blogwright-pds's OAuth client key.
    const { ctx, requests } = makeContext([
      createdRole(TRANSFORM_ROLE_ARN),
      iamDone('PutRolePolicy'),
    ]);
    await analyticsTransformRoleNode().create(withSaltSecret(ctx));

    const document: unknown = JSON.parse(
      formBody(requests[1] as RecordedRequest)['PolicyDocument'] ?? '',
    );
    expect(document).toStrictEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: TRANSFORM_LOG_GROUP_ARN,
        },
        {
          Effect: 'Allow',
          Action: ['secretsmanager:GetSecretValue'],
          Resource: SALT_SECRET_ARN,
        },
      ],
    });

    const resources = (document as { Statement: { Resource: string }[] }).Statement.map(
      (statement) => statement.Resource,
    );
    // Stated separately from the document equality above so the rule survives a
    // future statement being added: every resource is a concrete ARN, none is a
    // wildcard, and the secret grant names one secret with no `*` in it at all.
    expect(resources).toHaveLength(2);
    for (const resource of resources) {
      expect(resource.startsWith('arn:aws:')).toBe(true);
      expect(resource).not.toBe('*');
    }
    expect(resources[1]).toBe(SALT_SECRET_ARN);
    expect(resources[1]).not.toContain('*');
  });

  it('refuses to write the policy when the salt secret ARN is not recorded', async () => {
    // The guard that holds however the graph is ordered, made loud. Today the
    // role cannot outrun the secret even with no edge declared (`topoSort`
    // sorts its zero-indegree queue and `analytics-salt-secret` sorts first),
    // but nothing about that survives a rename - and this throw does. Without
    // it the policy would interpolate `undefined` into a live IAM grant: a
    // wrong permission, written silently, never an error.
    const { ctx, requests } = makeContext([createdRole(TRANSFORM_ROLE_ARN)]);
    await expect(analyticsTransformRoleNode().create(ctx)).rejects.toThrow(/analytics-salt-secret/);
    // The role was created; the grant was NOT written on nothing.
    expect(actions(requests)).toStrictEqual(['CreateRole']);
  });

  it('refuses to write the policy when the recorded salt secret ARN is empty', async () => {
    const { ctx, requests } = makeContext([createdRole(TRANSFORM_ROLE_ARN)]);
    await expect(analyticsTransformRoleNode().create(withSaltSecret(ctx, ''))).rejects.toThrow(
      /analytics-salt-secret/,
    );
    expect(actions(requests)).toStrictEqual(['CreateRole']);
  });

  it('records the role ARN even when the policy PUT throws', async () => {
    // Pins the ORDER of the two writes in `create`, and pins it the opposite way
    // round from `analytics-catalog-integration`. The role is a real IAM object
    // the moment `ensureRole` returns, and `delete` is what removes it, so a
    // crash in the policy call must still leave it recorded. Move the `output`
    // call below `applyTransformRolePolicy` and this fails - the account then
    // holds a role no state file mentions.
    const { ctx, requests } = makeContext([
      createdRole(TRANSFORM_ROLE_ARN),
      iamFailure(403, 'AccessDenied', 'is not authorized to perform: iam:PutRolePolicy'),
    ]);
    await expect(analyticsTransformRoleNode().create(withSaltSecret(ctx))).rejects.toThrow(
      /AccessDenied/,
    );
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources['analytics-transform-role']).toStrictEqual({
      name: TRANSFORM_ROLE,
      arn: TRANSFORM_ROLE_ARN,
    });
  });

  it('reapplies the policy on update, so a changed grant reaches an existing role', async () => {
    const { ctx, requests } = makeContext([iamDone('PutRolePolicy')]);
    await analyticsTransformRoleNode().update?.(withSaltSecret(ctx));
    expect(actions(requests)).toStrictEqual(['PutRolePolicy']);
  });

  it('deletes the role, removing its inline policy first', async () => {
    const { ctx, requests } = makeContext([
      rolePolicies(['transform']),
      iamDone('DeleteRolePolicy'),
      iamDone('DeleteRole'),
    ]);
    await expect(analyticsTransformRoleNode().delete(ctx)).resolves.toBeUndefined();
    expect(actions(requests)).toStrictEqual(['ListRolePolicies', 'DeleteRolePolicy', 'DeleteRole']);
  });

  it('deletes an already-absent role without throwing', async () => {
    const { ctx, requests } = makeContext([noSuchRole()]);
    await expect(analyticsTransformRoleNode().delete(ctx)).resolves.toBeUndefined();
    expect(actions(requests)).toStrictEqual(['ListRolePolicies']);
  });
});

/** `GetFunction`'s reply, whose configuration is nested - unlike create's and update's. */
function existingFunction(overrides: Record<string, unknown> = {}): RawResponse {
  return ok({
    Configuration: {
      FunctionName: TRANSFORM_FUNCTION,
      FunctionArn: TRANSFORM_FUNCTION_ARN,
      State: 'Active',
      ...overrides,
    },
  });
}

/** Lambda's reply for a function that does not exist - the status is what `isNotFound` narrows on. */
function noSuchFunction(): RawResponse {
  return failure(404, 'ResourceNotFoundException', `Function not found: ${TRANSFORM_FUNCTION_ARN}`);
}

describe('analytics-transform-function', () => {
  it('reads an existing function and records its ARN', async () => {
    const { ctx, requests } = makeContext([existingFunction()]);
    await expect(analyticsTransformFunctionNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).method).toBe('GET');
    expect(onlyRequest(requests).url).toBe(`${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}`);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-transform-function': { name: TRANSFORM_FUNCTION, arn: TRANSFORM_FUNCTION_ARN },
    });
  });

  it('reads false without throwing when the function is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([noSuchFunction()]);
    await expect(analyticsTransformFunctionNode().read(ctx)).resolves.toBe(false);
    expect(onlyRequest(requests).method).toBe('GET');
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('reads a function whose body carries no ARN without recording an empty one', async () => {
    // `normalizeFunction` falls back to `''` when the response omits
    // `Configuration.FunctionArn`, and an empty string recorded under `arn`
    // reads downstream as a real one.
    const { ctx } = makeContext([ok({ Configuration: { FunctionName: TRANSFORM_FUNCTION } })]);
    await expect(analyticsTransformFunctionNode().read(ctx)).resolves.toBe(true);
    expect(ctx.state.resources).toStrictEqual({
      'analytics-transform-function': { name: TRANSFORM_FUNCTION },
    });
  });

  it('refuses to adopt a function in the Failed state', async () => {
    // Neither adopted nor reported absent. Reporting absence would send
    // `applyGraph` to `create`, whose 409 is swallowed as "already exists", and
    // the reconcile would go green over a function that cannot run - every
    // record in Firehose's error prefix, an empty dashboard, and nothing said.
    const { ctx } = makeContext([existingFunction({ State: 'Failed' })]);
    await expect(analyticsTransformFunctionNode().read(ctx)).rejects.toThrow(/Failed state/);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('creates the function from the bundled zip and records what it deployed', async () => {
    const { ctx, requests } = makeContext([ok({}), existingFunction()]);
    await analyticsTransformFunctionNode().create(withTransformRole(ctx));

    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `POST ${LAMBDA_FUNCTIONS}`,
      `GET ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}`,
    ]);

    const body = requests[0]?.body as { Code: { ZipFile: string } } & Record<string, unknown>;
    expect(body).toMatchObject({
      FunctionName: TRANSFORM_FUNCTION,
      PackageType: 'Zip',
      Role: TRANSFORM_ROLE_ARN,
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      MemorySize: 256,
      Timeout: 60,
      // The env var is spelled as a literal here on purpose: it is the one
      // string the deployed function and this node have to agree on, and
      // `handler.ts` owns the constant both sides read.
      Environment: { Variables: { ANALYTICS_SALT_SECRET_NAME: SALT_SECRET } },
    });
    expect(SALT_SECRET_NAME_ENV).toBe('ANALYTICS_SALT_SECRET_NAME');

    // One entry, under the name the configured Handler resolves against - the
    // manifest sits BESIDE the zip and is never packed into it.
    expect(zipEntryNames(body.Code.ZipFile)).toStrictEqual([TRANSFORM_BUNDLE_FILE]);
    expect(Buffer.from(body.Code.ZipFile, 'base64').toString('latin1')).not.toContain(
      TRANSFORM_MANIFEST_FILE,
    );

    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(deployedFunction());
  });

  it('records the deployed code even when the ARN lookup after CreateFunction throws', async () => {
    // Pins the ORDER of the two writes in `create`, as `analytics-table` does:
    // `createFunction` returns void by design, so the ARN takes a second
    // request, and only a recording made BEFORE it survives a rethrow. Without
    // it the account holds a deployed function state has no record of - and the
    // next reconcile re-uploads identical code because no hash was recorded.
    //
    // 403 rather than a 5xx: GetFunction is a GET, so core's `withRetry` would
    // retry a 5xx five times with backoff, and a 403 is the likelier failure -
    // a deploy role without `lambda:GetFunction`.
    const { ctx, requests } = makeContext([
      ok({}),
      failure(403, 'AccessDeniedException', 'is not authorized to perform: lambda:GetFunction'),
    ]);
    await expect(analyticsTransformFunctionNode().create(withTransformRole(ctx))).rejects.toThrow(
      /getFunction/,
    );
    expect(requests).toHaveLength(2);
    const { arn: _arn, ...withoutArn } = deployedFunction();
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(withoutArn);
  });

  it('records no ARN when the lookup after CreateFunction answers without one', async () => {
    // `normalizeFunction` falls back to `''` for a body carrying no
    // `Configuration.FunctionArn`, and `''` recorded under `arn` reads
    // downstream as a real one. The deployed code is still recorded: what the
    // repo pushed is known even when the ARN lookup came back thin.
    const { ctx } = makeContext([
      ok({}),
      ok({ Configuration: { FunctionName: TRANSFORM_FUNCTION } }),
    ]);
    await analyticsTransformFunctionNode().create(withTransformRole(ctx));
    const { arn: _arn, ...withoutArn } = deployedFunction();
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(withoutArn);
  });

  it('packs identical bytes whatever the clock says, so a redeploy is not a code change', async () => {
    // `zipSync` is handed a fixed `mtime` - `packageAndUploadAgent`'s
    // discipline. Without it the archive carries the wall clock, so identical
    // source would put different bytes on the wire on every deploy and move
    // Lambda's CodeSha256 each time. Nothing in this node compares zip bytes,
    // which is precisely why the drift would never be reported: the artifact
    // stops being reproducible and no assertion anywhere notices.
    //
    // The two packs are separated in time rather than merely repeated: a zip
    // stores its timestamps at two-second granularity, so two packs in one test
    // run would compare equal even under a live clock.
    async function packedZip(): Promise<string> {
      const { ctx, requests } = makeContext([ok({}), existingFunction()]);
      await analyticsTransformFunctionNode().create(withTransformRole(ctx));
      const body = requests[0]?.body as { Code: { ZipFile: string } };
      return body.Code.ZipFile;
    }

    // `Date` only: the clients under this call retry through real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
      const first = await packedZip();
      vi.setSystemTime(new Date('2027-06-07T08:09:10Z'));
      expect(await packedZip()).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to create the function when the role ARN is not recorded', async () => {
    const { ctx, requests } = makeContext([]);
    await expect(analyticsTransformFunctionNode().create(ctx)).rejects.toThrow(
      /analytics-transform-role/,
    );
    expect(requests).toStrictEqual([]);
  });

  it('refuses to create the function when the recorded role ARN is empty', async () => {
    // The sibling of `analytics-transform-role`'s own empty-ARN case, and
    // rejected as hard: `Role: ""` is not a validation error the caller sees as
    // a missing dependency, and the empty string is what every ARN reader in
    // this graph can produce from a thin response.
    const { ctx, requests } = makeContext([]);
    ctx.record('analytics-transform-role', { name: TRANSFORM_ROLE, arn: '' });
    await expect(analyticsTransformFunctionNode().create(ctx)).rejects.toThrow(
      /analytics-transform-role/,
    );
    expect(requests).toStrictEqual([]);
  });

  it('performs no update call when neither the source hash nor the configuration moved', async () => {
    // The whole point of hashing the SOURCE: a rebuild on another machine emits
    // different bundle bytes from identical source, and keying on those bytes
    // would redeploy on every platform switch. Asserted as an empty call log
    // rather than as "no throw" - an update that went out and was accepted
    // would leave this list non-empty.
    const { ctx, requests } = makeContext([]);
    withTransformRole(ctx);
    ctx.record('analytics-transform-function', deployedFunction());
    await analyticsTransformFunctionNode().update?.(ctx);
    expect(requests).toStrictEqual([]);
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(deployedFunction());
  });

  it('performs one update call when the source hash moved', async () => {
    const { ctx, requests } = makeContext([ok({})]);
    withTransformRole(ctx);
    ctx.record('analytics-transform-function', {
      ...deployedFunction(),
      sourceHash: 'ffffffffffff',
    });
    await analyticsTransformFunctionNode().update?.(ctx);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}/code`,
    ]);
    // Top-level `ZipFile`, not nested under `Code` - `UpdateFunctionCode` and
    // `CreateFunction` do not share a body shape.
    const body = requests[0]?.body as { ZipFile: string };
    expect(zipEntryNames(body.ZipFile)).toStrictEqual([TRANSFORM_BUNDLE_FILE]);
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(deployedFunction());
  });

  it('performs one update call when only the salt secret name moved', async () => {
    // The input the source hash cannot see: `analytics.saltSecretName` comes
    // from blogwright.config.json, which nothing hashes. Without this
    // comparison the function keeps reading the old secret's name out of its
    // environment while the role grants only the new ARN - every batch denied,
    // every record in the error prefix.
    const saltSecretName = 'override/analytics/salt';
    const { ctx, requests } = makeContext([ok({})], { analytics: { saltSecretName } });
    withTransformRole(ctx);
    ctx.record('analytics-transform-function', deployedFunction());
    await analyticsTransformFunctionNode().update?.(ctx);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}/configuration`,
    ]);
    expect(requests[0]?.body).toMatchObject({
      Environment: { Variables: { ANALYTICS_SALT_SECRET_NAME: saltSecretName } },
    });
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(
      deployedFunction(saltSecretName),
    );
  });

  it('sends the configuration before the code when both moved', async () => {
    // Lambda refuses a second update while the first is settling, so if either
    // fails it is the second - and the survivable half-state is old code under
    // new settings, never new code under the old secret name.
    const saltSecretName = 'override/analytics/salt';
    const { ctx, requests } = makeContext([ok({}), ok({})], { analytics: { saltSecretName } });
    withTransformRole(ctx);
    ctx.record('analytics-transform-function', {
      ...deployedFunction(),
      sourceHash: 'ffffffffffff',
    });
    await analyticsTransformFunctionNode().update?.(ctx);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}/configuration`,
      `PUT ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}/code`,
    ]);
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual(
      deployedFunction(saltSecretName),
    );
  });

  it('records the configuration as soon as it lands, so a failed code push is not re-sent whole', async () => {
    const saltSecretName = 'override/analytics/salt';
    const { ctx, requests } = makeContext(
      [ok({}), failure(409, 'ResourceConflictException', 'An update is in progress')],
      { analytics: { saltSecretName } },
    );
    withTransformRole(ctx);
    ctx.record('analytics-transform-function', {
      ...deployedFunction(),
      sourceHash: 'ffffffffffff',
    });
    await expect(analyticsTransformFunctionNode().update?.(ctx)).rejects.toThrow(
      /updateFunctionCode/,
    );
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources['analytics-transform-function']).toStrictEqual({
      ...deployedFunction(saltSecretName),
      // The code did not land, so its hash is still the old one and the next
      // reconcile sends the code alone.
      sourceHash: 'ffffffffffff',
      codeKey: BUNDLE_ZIP_KEY,
    });
  });

  it('raises naming the manifest when the package ships no artifacts at all', async () => {
    // An unbuilt checkout or a partial install. The raise names the missing
    // file and the command that produces it, and no AWS call goes out - a
    // function created from bytes this node could not read is worse than one
    // that was never created.
    const { ctx, requests } = makeContext([], { files: {} });
    await expect(analyticsTransformFunctionNode().create(withTransformRole(ctx))).rejects.toThrow(
      new RegExp(`${TRANSFORM_MANIFEST_FILE}.*pnpm --filter blogwright-analytics build`, 's'),
    );
    expect(requests).toStrictEqual([]);
  });

  it('raises naming the bundle when the manifest is there and the bundle is not', async () => {
    // The other half of the pair, and it needs its own case: the manifest is
    // read first, so a fixture missing both never reaches the bundle's own
    // read at all.
    const { ctx, requests } = makeContext([], {
      files: {
        [join(ARTIFACT_DIR, TRANSFORM_MANIFEST_FILE)]: JSON.stringify({ hash: BUNDLE_HASH }),
      },
    });
    await expect(analyticsTransformFunctionNode().create(withTransformRole(ctx))).rejects.toThrow(
      new RegExp(`${TRANSFORM_BUNDLE_FILE}.*pnpm --filter blogwright-analytics build`, 's'),
    );
    expect(requests).toStrictEqual([]);
  });

  it('raises rather than deploying under a malformed manifest hash', async () => {
    // `transform-undefined.zip` is a key that compares equal to itself forever,
    // which would pin the deployed function at whatever code shipped first.
    const { ctx, requests } = makeContext([], {
      files: {
        ...BUNDLED_ARTIFACTS,
        [join(ARTIFACT_DIR, TRANSFORM_MANIFEST_FILE)]: JSON.stringify({ hash: 'not-a-hash' }),
      },
    });
    await expect(analyticsTransformFunctionNode().create(withTransformRole(ctx))).rejects.toThrow(
      /12 lowercase hex characters/,
    );
    expect(requests).toStrictEqual([]);
  });

  it('deletes an already-absent function without throwing', async () => {
    const { ctx, requests } = makeContext([noSuchFunction()]);
    await expect(analyticsTransformFunctionNode().delete(ctx)).resolves.toBeUndefined();
    expect(onlyRequest(requests).method).toBe('DELETE');
    expect(onlyRequest(requests).url).toBe(`${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}`);
  });
});

describe('transformUpdate', () => {
  const deployed = { sourceHash: BUNDLE_HASH, configuration: deployedConfiguration() };

  it('sends nothing when both halves match', () => {
    expect(transformUpdate(deployed, deployed)).toStrictEqual({
      code: false,
      configuration: false,
    });
  });

  it('sends the code alone when only the hash moved', () => {
    expect(transformUpdate({ ...deployed, sourceHash: 'ffffffffffff' }, deployed)).toStrictEqual({
      code: true,
      configuration: false,
    });
  });

  it('sends the configuration alone when only it moved', () => {
    expect(
      transformUpdate({ ...deployed, configuration: '{"roleArn":"other"}' }, deployed),
    ).toStrictEqual({ code: false, configuration: true });
  });

  it('sends both when nothing is recorded, which is what a lost state file looks like', () => {
    expect(
      transformUpdate({ sourceHash: undefined, configuration: undefined }, deployed),
    ).toStrictEqual({ code: true, configuration: true });
  });
});

describe('the transform chain region pin and names', () => {
  it('creates the secret in us-east-1 and grants on the us-east-1 ARN while config.region says otherwise', async () => {
    // Reusing the host bundle's own Secrets Manager client - core's, built over
    // the primary-region signer - would put the salt in `config.region`: a
    // secret the us-east-1 transform Lambda cannot read, in the one region no
    // other node in this graph is in, and one the ARN below does not name. Both
    // halves are checked here because they fail independently: the credential
    // scope catches the wrong client, and the ARN catches a region written as
    // text.
    expect(CONFIG_REGION).not.toBe('us-east-1');
    const { ctx, requests } = makeContext([
      noSuchSecret(),
      ok({}),
      existingSecret(),
      createdRole(TRANSFORM_ROLE_ARN),
      iamDone('PutRolePolicy'),
    ]);
    expect(ctx.config.region).toBe(CONFIG_REGION);

    await analyticsSaltSecretNode().create(ctx);
    await analyticsTransformRoleNode().create(ctx);

    const secretsRequests = requests.filter((request) => request.url.startsWith(SECRETS_HOST));
    expect(secretsRequests).toHaveLength(3);
    for (const request of secretsRequests) {
      expect(credentialScope(request.headers)).toStrictEqual({
        region: 'us-east-1',
        service: 'secretsmanager',
      });
    }

    const document = JSON.parse(
      formBody(requests[4] as RecordedRequest)['PolicyDocument'] ?? '',
    ) as { Statement: { Resource: string }[] };
    const resources = document.Statement.map((statement) => statement.Resource);
    for (const resource of resources) {
      expect(resource).toContain(':us-east-1:');
      expect(resource).not.toContain(CONFIG_REGION);
    }
    expect(resources[1]).toBe(SALT_SECRET_ARN);
  });

  it('carries the environment in the role and function names, so two environments never collide', async () => {
    const { ctx, requests } = makeContext([noSuchRole(), noSuchFunction()], { env: OTHER_ENV });
    expect(ctx.names.prefix).toBe(`${OTHER_ENV}-${SITE_NAME}`);

    await expect(analyticsTransformRoleNode().read(ctx)).resolves.toBe(false);
    await expect(analyticsTransformFunctionNode().read(ctx)).resolves.toBe(false);

    expect(formBody(requests[0] as RecordedRequest)['RoleName']).toBe(
      `${OTHER_ENV}-${SITE_NAME}-analytics-transform-role`,
    );
    expect(requests[1]?.url).toBe(
      `${LAMBDA_FUNCTIONS}/${OTHER_ENV}-${SITE_NAME}-analytics-transform`,
    );
    expect(requests[1]?.url).not.toContain(TRANSFORM_FUNCTION);
  });

  it("raises on a derived name over AWS's 64-character limit, before any call goes out", async () => {
    // Reachable from a config core accepts, which is what makes this guard live
    // rather than defensive: `siteName` carries no length cap of its own
    // (`core/src/config.ts` checks only the character class), and `deriveNames`
    // caps one derived name, the 63-character site bucket - which a
    // 40-character site name clears with room to spare. Both names below then
    // exceed 64, and IAM's and Lambda's own answer would be a ValidationError
    // from the middle of a bootstrap, naming neither the setting to change nor
    // the length it came out at.
    const siteName = 'a-very-long-analytics-site-name-for-caps';
    expect(siteName).toHaveLength(40);
    const { ctx, requests } = makeContext([], { config: { siteName } });
    expect(ctx.names.prefix).toBe(`${ENV}-${siteName}`);
    expect(ctx.names.bucket.length).toBeLessThanOrEqual(63);

    await expect(analyticsTransformRoleNode().read(ctx)).rejects.toThrow(
      /transform role name .* is 70 characters, over AWS's 64-character limit; shorten env or siteName/,
    );
    await expect(analyticsTransformFunctionNode().read(ctx)).rejects.toThrow(
      /transform function name .* is 65 characters, over AWS's 64-character limit; shorten env or siteName/,
    );
    expect(requests).toStrictEqual([]);
  });
});

describe('tearing the transform chain down', () => {
  /** The chain in `dependsOn` order; `destroyGraph` walks the reverse. */
  const CHAIN = [
    analyticsSaltSecretNode(),
    analyticsTransformRoleNode(),
    analyticsTransformFunctionNode(),
  ];

  async function teardown(replies: RawResponse[]): Promise<RecordedRequest[]> {
    const { ctx, requests } = makeContext(replies);
    for (const node of [...CHAIN].reverse()) {
      await expect(node.delete(ctx)).resolves.toBeUndefined();
    }
    return requests;
  }

  it('removes the function, then the role, and leaves the secret alone', async () => {
    // `destroyGraph` calls every node's `delete` in reverse topological order
    // (`packages/cli/src/graph.ts`); the engine lives in the CLI package, which
    // this one cannot import, so the reverse walk is spelled out here. The
    // function has to go first: it runs as the role, and IAM will not delete a
    // role a live function still names.
    const requests = await teardown([
      ok({}),
      rolePolicies(['transform']),
      iamDone('DeleteRolePolicy'),
      iamDone('DeleteRole'),
    ]);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `DELETE ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}`,
      `POST ${IAM_ENDPOINT}`,
      `POST ${IAM_ENDPOINT}`,
      `POST ${IAM_ENDPOINT}`,
    ]);
    expect(actions(requests.slice(1))).toStrictEqual([
      'ListRolePolicies',
      'DeleteRolePolicy',
      'DeleteRole',
    ]);
    // The salt secret is the one resource a teardown keeps - and the three
    // deletes above are what keep this from being vacuous: they prove the walk
    // ran and the transport was recording while the Secrets Manager call log
    // stayed empty.
    expect(requests.filter((request) => request.url.startsWith(SECRETS_HOST))).toStrictEqual([]);
  });

  it('is re-runnable when the function is already gone', async () => {
    const requests = await teardown([noSuchFunction(), rolePolicies([]), iamDone('DeleteRole')]);
    expect(requests[0]?.method).toBe('DELETE');
    // The role delete still went out - a swallowed 404 on the function must not
    // abandon the rest of the walk.
    expect(actions(requests.slice(1))).toStrictEqual(['ListRolePolicies', 'DeleteRole']);
  });

  it('is re-runnable when the role is already gone', async () => {
    const requests = await teardown([ok({}), noSuchRole()]);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `DELETE ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}`,
      `POST ${IAM_ENDPOINT}`,
    ]);
    expect(actions(requests.slice(1))).toStrictEqual(['ListRolePolicies']);
  });
});
