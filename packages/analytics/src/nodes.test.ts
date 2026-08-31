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
  analyticsErrorBucketNode,
  analyticsFirehoseRoleNode,
  analyticsFirehoseStreamNode,
  analyticsLogDeliveryNode,
  analyticsLogDestinationNode,
  analyticsNamespaceNode,
  analyticsSaltSecretNode,
  analyticsTableBucketNode,
  analyticsTableNode,
  analyticsTransformFunctionNode,
  analyticsTransformRoleNode,
  transformUpdate,
} from './nodes.js';
import { ANALYTICS_PACKAGE_DIR } from './paths.js';
import { CLOUDFRONT_RECORD_FIELDS } from './schema.js';
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

/** CloudWatch Logs is AWS-JSON: every operation is `POST /`, told apart by `x-amz-target`. */
const LOGS_TARGET = 'Logs_20140328';

const LOGS_HOST = 'https://logs.us-east-1.amazonaws.com';
const LOGS_ENDPOINT = `${LOGS_HOST}/`;

/**
 * A `delivery-destination` ARN. Its final `:`-separated segment is the
 * destination's name, which is the only thing distinguishing two deliveries
 * hanging off one shared source - so this form is what both the site's guard
 * (`packages/cli/src/nodes.ts`'s `isOwnDelivery`) and the plugin's own
 * attribution read.
 */
function destinationArn(name: string): string {
  return `arn:aws:logs:us-east-1:${ACCOUNT_ID}:delivery-destination:${name}`;
}

/** `deriveNames`' `<prefix>-cf-source`: the delivery source the SITE owns and this plugin only reads. */
const SITE_DELIVERY_SOURCE = `${PREFIX}-cf-source`;

/** `deriveNames`' `<prefix>-cf-dest`: the site's OWN delivery destination, never this plugin's. */
const SITE_DELIVERY_DESTINATION = `${PREFIX}-cf-dest`;

/**
 * The plugin's delivery destination name, spelled out here rather than derived
 * from the module under test - and deliberately compared against
 * {@link SITE_DELIVERY_DESTINATION} below, because the two being different is
 * the single property the site's teardown guard rests on.
 */
const LOG_DESTINATION = `${PREFIX}-analytics-cf-dest`;
const LOG_DESTINATION_ARN = destinationArn(LOG_DESTINATION);

/** The site's own CloudWatch delivery, seeded on the shared source by every case below. */
const SITE_DELIVERY = {
  id: 'site-d',
  deliveryDestinationArn: destinationArn(SITE_DELIVERY_DESTINATION),
};

/** This plugin's delivery, as AWS lists it beside the site's on the same source. */
const PLUGIN_DELIVERY = { id: 'analytics-d', deliveryDestinationArn: LOG_DESTINATION_ARN };

/** The site's CloudFront distribution ARN, as its own node records it in `state/<env>.json`. */
const DISTRIBUTION_ARN = `arn:aws:cloudfront::${ACCOUNT_ID}:distribution/E2ABCDEF`;

/** A site that has been bootstrapped: the one recorded output this plugin reads off it. */
const BOOTSTRAPPED_SITE: Record<string, ResourceOutputs> = {
  'cloudfront-distribution': { arn: DISTRIBUTION_ARN },
};

/**
 * The CloudWatch Logs half of AWS as these two nodes meet it: one shared
 * delivery source carrying any number of deliveries, and a set of delivery
 * destinations.
 *
 * Stateful rather than a scripted queue, modelled on the recording fake at
 * `packages/cli/src/nodes.test.ts:36-77` and for that fake's stated reason -
 * **the refusals AWS actually makes are what a guard-less implementation would
 * sail straight through.** `DeleteDeliverySource` is rejected while any
 * delivery is still attached, and so is `DeleteDeliveryDestination`; neither
 * `deleteDeliverySource` nor `deleteDeliveryDestination` catches that Conflict,
 * since both swallow only a not-found. A fake answering 200 to either would let
 * a destination replacement that never detached its delivery pass every
 * assertion below.
 */
interface LogsWorld {
  /** Every delivery on the site's shared source, in the order AWS lists them. */
  deliveries: { id: string; deliveryDestinationArn: string }[];
  /** The delivery destinations that exist, by name. */
  destinations: string[];
  /** True while the site's shared delivery source exists. */
  sourcePresent: boolean;
  /** Failures to answer the next `PutDeliveryDestination` calls with, one each, oldest first. */
  putFailures: { code: string; message: string }[];
  /** The id the next delivery this fake creates is given. */
  nextDeliveryId: number;
}

/** A {@link LogsWorld} with an empty shared source, before any case seeds it. */
function logsWorld(overrides: Partial<LogsWorld> = {}): LogsWorld {
  return {
    deliveries: [],
    destinations: [],
    sourcePresent: true,
    putFailures: [],
    nextDeliveryId: 1,
    ...overrides,
  };
}

/**
 * The failure shape CloudWatch Logs puts on the wire - AWS-JSON 1.1, like Glue
 * and Firehose, so the exception name travels in the body's `__type` and
 * reaches `AwsError.code`. HTTP 400 throughout: `AwsError.isNotFound` matches
 * `ResourceNotFoundException` on the code, and `isAlreadyExists` matches
 * `/Conflict/i` on it, so the status separates nothing here.
 */
function logsFailure(code: string, message: string): RawResponse {
  const text = JSON.stringify({ __type: code, message });
  return {
    statusCode: 400,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** Narrow a recorded request body to its JSON object form - no cast. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Answer one CloudWatch Logs operation against {@link LogsWorld}, mutating it as AWS would. */
function answerLogs(
  world: LogsWorld,
  operation: string,
  body: Record<string, unknown>,
): RawResponse {
  switch (operation) {
    case 'DescribeDeliveries':
      // Every delivery in this fake hangs off the one shared source, which is
      // the situation under test: `DescribeDeliveries` takes no source filter,
      // and `deliveriesForSource` is what narrows the list.
      return ok({
        deliveries: world.deliveries.map((delivery) => ({
          id: delivery.id,
          deliverySourceName: SITE_DELIVERY_SOURCE,
          deliveryDestinationArn: delivery.deliveryDestinationArn,
        })),
      });
    case 'PutDeliveryDestination': {
      const name = String(body['name']);
      const scripted = world.putFailures.shift();
      if (scripted !== undefined) return logsFailure(scripted.code, scripted.message);
      if (!world.destinations.includes(name)) world.destinations.push(name);
      return ok({ deliveryDestination: { name, arn: destinationArn(name) } });
    }
    case 'PutDeliverySource':
      // Present so a node that called it would be recorded rather than crash
      // the fixture: `putSource` appearing in a call log is the failure this
      // plugin's tests are looking for, not an unscripted-request error.
      world.sourcePresent = true;
      return ok({
        deliverySource: { arn: `arn:aws:logs:us-east-1:${ACCOUNT_ID}:delivery-source:x` },
      });
    case 'CreateDelivery': {
      const arn = String(body['deliveryDestinationArn']);
      if (world.deliveries.some((delivery) => delivery.deliveryDestinationArn === arn)) {
        return logsFailure('ConflictException', 'A delivery to this destination already exists.');
      }
      world.deliveries.push({ id: `d-${world.nextDeliveryId}`, deliveryDestinationArn: arn });
      world.nextDeliveryId += 1;
      return ok({});
    }
    case 'DeleteDelivery': {
      const id = String(body['id']);
      if (!world.deliveries.some((delivery) => delivery.id === id)) {
        return logsFailure('ResourceNotFoundException', `No delivery ${id}.`);
      }
      world.deliveries = world.deliveries.filter((delivery) => delivery.id !== id);
      return ok({});
    }
    case 'DeleteDeliverySource':
      // AWS rejects this while a delivery is attached - see {@link LogsWorld}.
      // No case below asserts on this branch, because no call reaches it; it is
      // here so that one ever making it would fail loudly rather than pass.
      if (world.deliveries.length > 0) {
        return logsFailure('ConflictException', 'Delivery Source still has deliveries attached.');
      }
      world.sourcePresent = false;
      return ok({});
    case 'DeleteDeliveryDestination': {
      const name = String(body['name']);
      if (
        world.deliveries.some(
          (delivery) => delivery.deliveryDestinationArn === destinationArn(name),
        )
      ) {
        return logsFailure(
          'ConflictException',
          `Delivery destination ${name} still has deliveries attached.`,
        );
      }
      if (!world.destinations.includes(name)) {
        return logsFailure('ResourceNotFoundException', `No delivery destination ${name}.`);
      }
      world.destinations = world.destinations.filter((existing) => existing !== name);
      return ok({});
    }
    default:
      throw new Error(`the CloudWatch Logs fake has no answer for ${operation}`);
  }
}

/**
 * The vended-delivery call log, in the vocabulary
 * `packages/cli/src/nodes.test.ts`'s recording fake uses, so the two suites'
 * call logs read the same and the reviewable "no `deleteSource` entry in any
 * case" check is a literal one. Firehose's describe is named too, because the
 * wait for an `ACTIVE` stream is part of the sequence under test.
 */
const CALL_NAMES: Record<string, string> = {
  [`${LOGS_TARGET}.DescribeDeliveries`]: 'listDeliveries',
  [`${LOGS_TARGET}.PutDeliverySource`]: 'putSource',
  [`${LOGS_TARGET}.PutDeliveryDestination`]: 'putDest',
  [`${LOGS_TARGET}.CreateDelivery`]: 'createDelivery',
  [`${LOGS_TARGET}.DeleteDelivery`]: 'deleteDelivery',
  [`${LOGS_TARGET}.DeleteDeliverySource`]: 'deleteSource',
  [`${LOGS_TARGET}.DeleteDeliveryDestination`]: 'deleteDest',
  'Firehose_20150804.DescribeDeliveryStream': 'describeStream',
};

/** Every recorded request as a call-log entry; `deleteDelivery` carries the id it removed. */
function deliveryCalls(requests: RecordedRequest[]): string[] {
  return requests.map((request) => {
    const target = request.headers['x-amz-target'] ?? '';
    const name = CALL_NAMES[target];
    if (name === undefined) {
      throw new Error(`unnamed operation in the delivery call log: ${target || request.url}`);
    }
    if (name !== 'deleteDelivery') return name;
    const body = request.body;
    return `${name}:${isJsonObject(body) ? String(body['id']) : '?'}`;
  });
}

/**
 * The local-time day of an instant, `YYYY-MM-DD` - the value `createdDay` must
 * never take. Used to assert that a test's zone pin actually took effect, so
 * the pin cannot rot into a no-op without saying so.
 */
function localDay(at: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
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
    /**
     * The site's own recorded outputs, as `ctx.siteState` exposes them. Defaults
     * to `{}` - an unbootstrapped site - so every case that does not name one
     * exercises the absence.
     */
    site?: Record<string, ResourceOutputs>;
    /**
     * The stateful CloudWatch Logs fake. When present it answers every
     * `Logs_20140328.*` request instead of the scripted queue; see
     * {@link LogsWorld}.
     */
    logs?: LogsWorld;
  } = {},
): { ctx: PluginContext<AnalyticsConfig>; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];
  const world = overrides.logs;
  const transport: Transport = async (req) => {
    const recorded = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body === undefined ? undefined : parseBody(String(req.body)),
    };
    requests.push(recorded);
    // The CloudWatch Logs fake answers its own service statefully; every other
    // service still comes off the scripted queue, so nothing above this line
    // changes for the cases that do not pass one.
    const target = recorded.headers['x-amz-target'];
    if (world !== undefined && target !== undefined && target.startsWith(`${LOGS_TARGET}.`)) {
      if (!isJsonObject(recorded.body)) {
        throw new Error(`CloudWatch Logs request with no JSON body: ${String(recorded.body)}`);
      }
      return answerLogs(world, target.slice(LOGS_TARGET.length + 1), recorded.body);
    }
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
      siteState: { resources: overrides.site ?? {} },
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
          // `CreateLogGroup` is load-bearing, not boilerplate. Lambda creates
          // the group on first invocation and cannot without this: the first
          // real deployment ran the transform twice, reported zero errors, and
          // produced no log group at all - a function that works and cannot be
          // observed. Scoped to this function's own group like the other two,
          // so it grants nothing account-wide.
          Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
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

/**
 * Lambda's reply while IAM has not finished propagating the transform role.
 * The exception name is `InvalidParameterValueException`, which is also what a
 * malformed zip returns - so the message is the only thing separating a
 * transient from a permanent failure here.
 */
function roleNotYetAssumable(): RawResponse {
  return failure(
    400,
    'InvalidParameterValueException',
    'The role defined for the function cannot be assumed by Lambda.',
  );
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

  // AWS answers a CreateFunction naming a role it has not finished propagating
  // with this 400, and the message is the only thing that identifies it - the
  // code arrives as `Http400` like every other Lambda failure. This is not a
  // hypothetical: it is what the first real `analytics bootstrap` hit, at the
  // tenth of twelve nodes, because the role is created by the node immediately
  // before this one.
  it('retries CreateFunction while Lambda has not yet propagated the role', async () => {
    const { ctx, requests } = makeContext([roleNotYetAssumable(), ok({}), existingFunction()]);

    await analyticsTransformFunctionNode().create(withTransformRole(ctx));

    // Two POSTs, not one: the first was refused and the second succeeded.
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `POST ${LAMBDA_FUNCTIONS}`,
      `POST ${LAMBDA_FUNCTIONS}`,
      `GET ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}`,
    ]);
    expect(ctx.state.resources['analytics-transform-function']).toMatchObject({
      name: TRANSFORM_FUNCTION,
      arn: TRANSFORM_FUNCTION_ARN,
    });
  });

  // The other half of the same property, and the reason the predicate matches a
  // message rather than a status: almost every other 400 Lambda returns is
  // permanent - a malformed zip, a bad handler path, a role that genuinely
  // lacks the trust policy - and retrying those would turn a clear failure into
  // a slow one.
  it('does not retry a 400 that is not the role propagation window', async () => {
    const { ctx, requests } = makeContext([
      failure(400, 'InvalidParameterValueException', 'Unzipped size must be smaller than X bytes'),
    ]);

    await expect(analyticsTransformFunctionNode().create(withTransformRole(ctx))).rejects.toThrow(
      /Unzipped size/,
    );
    expect(requests).toHaveLength(1);
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

  // `updateFunctionConfiguration` sends `roleArn` too, so an environment whose
  // role was torn down and recreated hits the same propagation window on the
  // update path. Same helper, asserted separately rather than assumed from the
  // create case.
  it('retries UpdateFunctionConfiguration while Lambda has not yet propagated the role', async () => {
    const saltSecretName = 'override/analytics/salt';
    const { ctx, requests } = makeContext([roleNotYetAssumable(), ok({})], {
      analytics: { saltSecretName },
    });
    withTransformRole(ctx);
    ctx.record('analytics-transform-function', deployedFunction());

    await analyticsTransformFunctionNode().update?.(ctx);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}/configuration`,
      `PUT ${LAMBDA_FUNCTIONS}/${TRANSFORM_FUNCTION}/configuration`,
    ]);
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

/** `<env>-<siteName>-analytics-errors`, the bucket name `nodes.ts` derives off `ctx.names.prefix`. */
const ERROR_BUCKET = `${PREFIX}-analytics-errors`;

/** An S3 bucket ARN carries no region and no generated id, so this is a pure derivation. */
const ERROR_BUCKET_ARN = `arn:aws:s3:::${ERROR_BUCKET}`;

const FIREHOSE_ROLE = `${PREFIX}-analytics-firehose-role`;
const FIREHOSE_ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/${FIREHOSE_ROLE}`;

const STREAM = `${PREFIX}-analytics-firehose`;
const STREAM_ARN = `arn:aws:firehose:us-east-1:${ACCOUNT_ID}:deliverystream/${STREAM}`;

/** The service-generated id of the stream's one destination - not derivable, only readable. */
const DESTINATION_ID = 'destinationId-000000000001';

/**
 * The Glue catalog Firehose reaches this environment's table through: the
 * **child** catalog the S3 Tables integration creates per table bucket. Spelled
 * out here rather than derived from the module under test, and deliberately not
 * {@link CATALOG_ARN}, which is the account-wide federation root one level
 * above it - the form `CatalogConfiguration.CatalogARN`'s own prose names holds
 * no S3 Tables table at all.
 */
const FEDERATED_CATALOG_ARN = `arn:aws:glue:us-east-1:${ACCOUNT_ID}:catalog/${CATALOG}/${TABLE_BUCKET}`;

/** The five Glue resources the delivery role's catalog grant names, spelled out independently. */
const GLUE_GRANT_RESOURCES = [
  `arn:aws:glue:us-east-1:${ACCOUNT_ID}:catalog`,
  `arn:aws:glue:us-east-1:${ACCOUNT_ID}:catalog/${CATALOG}`,
  `arn:aws:glue:us-east-1:${ACCOUNT_ID}:catalog/${CATALOG}/${TABLE_BUCKET}`,
  `arn:aws:glue:us-east-1:${ACCOUNT_ID}:database/${CATALOG}/${TABLE_BUCKET}/${NAMESPACE}`,
  `arn:aws:glue:us-east-1:${ACCOUNT_ID}:table/${CATALOG}/${TABLE_BUCKET}/${NAMESPACE}/${TABLE}`,
];

/** Firehose is AWS-JSON: every operation is `POST /`, told apart by `x-amz-target`. */
const FIREHOSE_HOST = 'https://firehose.us-east-1.amazonaws.com';
const FIREHOSE_ENDPOINT = `${FIREHOSE_HOST}/`;

/** S3 is the one service in this file addressed by path rather than by target. */
const S3_HOST = 'https://s3.us-east-1.amazonaws.com';

/** The one error prefix both of Firehose's error surfaces share. */
const ERROR_PREFIX = 'firehose-errors/';

/**
 * The failure shape Firehose puts on the wire - AWS-JSON 1.1, so the exception
 * name travels in the body's `__type` and reaches `AwsError.code`. Every
 * documented Firehose exception is HTTP 400, `ResourceNotFoundException`
 * included, so the status separates nothing and these replies say 400 throughout.
 */
function firehoseFailure(code: string, message: string): RawResponse {
  const text = JSON.stringify({ __type: code, message });
  return {
    statusCode: 400,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/**
 * Firehose's reply while IAM has not finished propagating the delivery role.
 * The wording is nothing like Lambda's for the same condition, which is why the
 * predicate carries both.
 */
function firehoseRoleNotYetAssumable(): RawResponse {
  return firehoseFailure(
    'InvalidArgumentException',
    `Firehose is unable to assume role ${FIREHOSE_ROLE_ARN}. Please check the role provided.`,
  );
}

/** `DescribeDeliveryStream`'s reply for a stream that does not exist. */
function noSuchStream(): RawResponse {
  return firehoseFailure('ResourceNotFoundException', 'Firehose stream not found');
}

/** A `DescribeDeliveryStream` success body, in the service's own nesting. */
function streamDescription(
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    DeliveryStreamDescription: {
      DeliveryStreamName: STREAM,
      DeliveryStreamARN: STREAM_ARN,
      DeliveryStreamStatus: status,
      DeliveryStreamType: 'DirectPut',
      VersionId: '1',
      HasMoreDestinations: false,
      Destinations: [
        { DestinationId: DESTINATION_ID, IcebergDestinationDescription: { AppendOnly: true } },
      ],
      ...extra,
    },
  };
}

/** One `Destinations` entry carrying a given live `AppendOnly` flag. */
function destinationWith(appendOnly: boolean): Record<string, unknown>[] {
  return [
    { DestinationId: DESTINATION_ID, IcebergDestinationDescription: { AppendOnly: appendOnly } },
  ];
}

/** The failure shape S3 puts on the wire: REST-XML, with the code in an `<Error><Code>` element. */
function s3Failure(status: number, code: string): RawResponse {
  const text = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;
  return {
    statusCode: status,
    headers: {},
    body: new TextEncoder().encode(text),
    text: () => text,
  };
}

/** S3's reply for a bucket that does not exist. */
function noSuchBucket(): RawResponse {
  return s3Failure(404, 'NoSuchBucket');
}

/** A 2xx S3 reply with nothing in it - what every bucket-level PUT and DELETE answers. */
function s3Done(): RawResponse {
  return encode('');
}

/** A `ListObjectsV2` reply listing `keys`, or an empty bucket when none are given. */
function listing(keys: string[] = []): RawResponse {
  const contents = keys
    .map((key) => `<Contents><Key>${key}</Key><Size>10</Size></Contents>`)
    .join('');
  return encode(
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
  );
}

/** Record what `analytics-error-bucket` records, so its two readers have an ARN to interpolate. */
function withErrorBucket(
  ctx: PluginContext<AnalyticsConfig>,
  arn: string = ERROR_BUCKET_ARN,
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-error-bucket', { name: ERROR_BUCKET, arn });
  return ctx;
}

/** Record what `analytics-table` records - the ARN only `GetTable` can supply. */
function withTable(
  ctx: PluginContext<AnalyticsConfig>,
  arn: string = TABLE_ARN,
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-table', { name: TABLE, arn });
  return ctx;
}

/** Record what `analytics-transform-function` records, so the grant and the processor name it. */
function withTransformFunction(
  ctx: PluginContext<AnalyticsConfig>,
  arn: string = TRANSFORM_FUNCTION_ARN,
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-transform-function', { name: TRANSFORM_FUNCTION, arn });
  return ctx;
}

/** Record what `analytics-firehose-role` records, so the stream has a role to name. */
function withFirehoseRole(
  ctx: PluginContext<AnalyticsConfig>,
  arn: string = FIREHOSE_ROLE_ARN,
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-firehose-role', { name: FIREHOSE_ROLE, arn });
  return ctx;
}

/** The three recorded outputs `analytics-firehose-role`'s policy interpolates. */
function withRoleDependencies(ctx: PluginContext<AnalyticsConfig>): PluginContext<AnalyticsConfig> {
  return withTransformFunction(withTable(withErrorBucket(ctx)));
}

/** The three recorded outputs `analytics-firehose-stream`'s destination interpolates. */
function withStreamDependencies(
  ctx: PluginContext<AnalyticsConfig>,
): PluginContext<AnalyticsConfig> {
  return withTransformFunction(withErrorBucket(withFirehoseRole(ctx)));
}

/** Record what a live stream's `read` records, so `update` has a flag and a version to compare. */
function withRecordedStream(
  ctx: PluginContext<AnalyticsConfig>,
  overrides: ResourceOutputs = {},
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-firehose-stream', {
    name: STREAM,
    arn: STREAM_ARN,
    state: 'active',
    versionId: '3',
    destinationId: DESTINATION_ID,
    appendOnly: false,
    ...overrides,
  });
  return ctx;
}

/** One statement of a parsed inline policy document. */
interface PolicyStatement {
  Effect: string;
  Action: string[];
  Resource: string | string[];
}

/** The statements of the inline policy an IAM `PutRolePolicy` request carried. */
function policyStatements(request: RecordedRequest): PolicyStatement[] {
  const document = JSON.parse(formBody(request)['PolicyDocument'] ?? '') as {
    Version: string;
    Statement: PolicyStatement[];
  };
  expect(document.Version).toBe('2012-10-17');
  return document.Statement;
}

/**
 * The one statement whose every action is on `service` - the capability, found
 * by what it grants rather than by its position in the list, so reordering the
 * document does not silently move an assertion onto a different grant.
 */
function capability(statements: PolicyStatement[], service: string): PolicyStatement {
  const matched = statements.filter((statement) =>
    statement.Action.every((action) => action.startsWith(`${service}:`)),
  );
  if (matched.length !== 1) {
    throw new Error(
      `expected exactly one ${service} statement, found ${matched.length} in ${JSON.stringify(statements)}`,
    );
  }
  return matched[0] as PolicyStatement;
}

/** Every `Resource` in a policy document, flattened - a statement may name one ARN or several. */
function policyResources(statements: PolicyStatement[]): string[] {
  return statements.flatMap((statement) =>
    Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource],
  );
}

describe('the analytics delivery graph', () => {
  it('chains error-bucket -> firehose-role -> firehose-stream', () => {
    expect(analyticsErrorBucketNode().id).toBe('analytics-error-bucket');
    expect(analyticsErrorBucketNode().dependsOn).toStrictEqual([]);

    // The role's three edges are the three nodes whose recorded ARNs its four
    // grants interpolate. `topoSort` drains zero-indegree nodes alphabetically
    // (`packages/cli/src/graph.ts:35-38`), and here the accident does NOT save
    // it: `analytics-firehose-role` sorts before `analytics-transform-function`,
    // so with `dependsOn: []` the policy would be written with an unrecorded
    // function ARN interpolated - a wrong permission, never an error.
    expect(analyticsFirehoseRoleNode().id).toBe('analytics-firehose-role');
    expect(analyticsFirehoseRoleNode().dependsOn).toStrictEqual([
      'analytics-error-bucket',
      'analytics-table',
      'analytics-transform-function',
    ]);

    // The stream's role edge is the spec's own rule - its
    // `IcebergDestinationConfiguration` interpolates the role's recorded ARN -
    // and it carries `analytics-error-bucket` transitively, completing the
    // error-bucket -> firehose-role -> firehose-stream chain. Without it the
    // ordering would survive only on `…-role` sorting before `…-stream`.
    expect(analyticsFirehoseStreamNode().id).toBe('analytics-firehose-stream');
    expect(analyticsFirehoseStreamNode().dependsOn).toStrictEqual([
      'analytics-firehose-role',
      'analytics-table',
      'analytics-catalog-integration',
      'analytics-transform-function',
    ]);
  });

  it("is assignable to the SPI's own ResourceNode[], so the CLI engine runs it unchanged", () => {
    const nodes: ResourceNode[] = [
      analyticsErrorBucketNode(),
      analyticsFirehoseRoleNode(),
      analyticsFirehoseStreamNode(),
    ];
    expect(nodes.map((node) => node.id)).toStrictEqual([
      'analytics-error-bucket',
      'analytics-firehose-role',
      'analytics-firehose-stream',
    ]);
  });
});

describe('analytics-error-bucket', () => {
  it('reads an existing bucket and records its name and derived ARN', async () => {
    const { ctx, requests } = makeContext([s3Done()]);
    await expect(analyticsErrorBucketNode().read(ctx)).resolves.toBe(true);
    expect(onlyRequest(requests).method).toBe('HEAD');
    expect(onlyRequest(requests).url).toBe(`${S3_HOST}/${ERROR_BUCKET}`);
    expect(ctx.state.resources['analytics-error-bucket']).toStrictEqual({
      name: ERROR_BUCKET,
      arn: ERROR_BUCKET_ARN,
    });
  });

  it('reads false without throwing when the bucket is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([noSuchBucket()]);
    await expect(analyticsErrorBucketNode().read(ctx)).resolves.toBe(false);
    expect(requests).toHaveLength(1);
    expect(ctx.state.resources['analytics-error-bucket']).toBeUndefined();
  });

  it('creates the bucket, then tags it and blocks public access', async () => {
    const { ctx, requests } = makeContext([s3Done(), s3Done(), s3Done()]);
    await analyticsErrorBucketNode().create(ctx);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${S3_HOST}/${ERROR_BUCKET}`,
      `PUT ${S3_HOST}/${ERROR_BUCKET}?tagging=`,
      `PUT ${S3_HOST}/${ERROR_BUCKET}?publicAccessBlock=`,
    ]);
    // No LocationConstraint body: core's `createBucket` omits it in us-east-1,
    // and the pinned signer is what puts the request there. A body here would
    // mean the bucket had been created in `config.region` instead.
    expect(requests[0]?.body).toBeUndefined();
    expect(ctx.state.resources['analytics-error-bucket']).toStrictEqual({
      name: ERROR_BUCKET,
      arn: ERROR_BUCKET_ARN,
    });
  });

  it('records the bucket even when the tagging call after CreateBucket throws', async () => {
    // Pins the ORDER of the two writes in `create`, `bucketNode`'s ordering
    // (`packages/cli/src/nodes.ts:56-60`). Move the record below
    // `applyErrorBucketConfiguration` and this fails: the account then holds a
    // bucket no state file mentions, so `destroy` walks past it.
    const { ctx, requests } = makeContext([s3Done(), s3Failure(403, 'AccessDenied')]);
    await expect(analyticsErrorBucketNode().create(ctx)).rejects.toThrow(/AccessDenied/);
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources['analytics-error-bucket']).toStrictEqual({
      name: ERROR_BUCKET,
      arn: ERROR_BUCKET_ARN,
    });
  });

  it('reapplies the tagging and public-access block on update', async () => {
    const { ctx, requests } = makeContext([s3Done(), s3Done()]);
    await analyticsErrorBucketNode().update?.(ctx);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${S3_HOST}/${ERROR_BUCKET}?tagging=`,
      `PUT ${S3_HOST}/${ERROR_BUCKET}?publicAccessBlock=`,
    ]);
  });

  it('empties the bucket before removing it, and says how many records it discarded', async () => {
    const warnings: string[] = [];
    const { ctx, requests } = makeContext(
      [
        s3Done(),
        listing(['firehose-errors/2026/08/31/one', 'firehose-errors/2026/08/31/two']),
        s3Done(),
        s3Done(),
        s3Done(),
      ],
      { warnings },
    );
    await expect(analyticsErrorBucketNode().delete(ctx)).resolves.toBeUndefined();
    expect(requests.map((request) => request.method)).toStrictEqual([
      'HEAD',
      'GET',
      'DELETE',
      'DELETE',
      'DELETE',
    ]);
    expect(requests[4]?.url).toBe(`${S3_HOST}/${ERROR_BUCKET}`);
    // The records are the evidence of whatever went wrong, so the teardown says
    // how much of it went with the bucket rather than removing it silently.
    expect(warnings.join('\n')).toMatch(/discarded 2 failed-record object/);
  });

  it('deletes an already-absent bucket without listing it or throwing', async () => {
    // `deletePrefix` does NOT swallow a 404 - it lists first, and `listObjects`
    // rethrows - so without the existence check a re-run after a completed
    // teardown would fail on the half that was already done.
    const { ctx, requests } = makeContext([noSuchBucket()]);
    await expect(analyticsErrorBucketNode().delete(ctx)).resolves.toBeUndefined();
    expect(requests.map((request) => request.method)).toStrictEqual(['HEAD']);
  });

  it('carries the environment in the bucket name, so two environments never collide', async () => {
    const { ctx, requests } = makeContext([s3Done()], { env: OTHER_ENV });
    await analyticsErrorBucketNode().read(ctx);
    expect(onlyRequest(requests).url).toBe(`${S3_HOST}/${OTHER_ENV}-${SITE_NAME}-analytics-errors`);
  });
});

describe('analytics-firehose-role', () => {
  it('reads an existing role and records its ARN', async () => {
    const { ctx, requests } = makeContext([existingRole(FIREHOSE_ROLE_ARN)]);
    await expect(analyticsFirehoseRoleNode().read(ctx)).resolves.toBe(true);
    expect(actions(requests)).toStrictEqual(['GetRole']);
    expect(ctx.state.resources['analytics-firehose-role']).toStrictEqual({
      name: FIREHOSE_ROLE,
      arn: FIREHOSE_ROLE_ARN,
    });
  });

  it('reads false without throwing when the role is absent, recording nothing', async () => {
    const { ctx } = makeContext([noSuchRole()]);
    await expect(analyticsFirehoseRoleNode().read(ctx)).resolves.toBe(false);
    expect(ctx.state.resources['analytics-firehose-role']).toBeUndefined();
  });

  it('creates the role with the Firehose trust document, then applies its policy', async () => {
    const { ctx, requests } = makeContext([
      createdRole(FIREHOSE_ROLE_ARN),
      iamDone('PutRolePolicy'),
    ]);
    await analyticsFirehoseRoleNode().create(withRoleDependencies(ctx));

    expect(actions(requests)).toStrictEqual(['CreateRole', 'PutRolePolicy']);
    expect(formBody(requests[0] as RecordedRequest)['RoleName']).toBe(FIREHOSE_ROLE);
    // AWS's own trust document for a Firehose delivery role: one statement, the
    // firehose service principal, `sts:AssumeRole` and nothing else. Notably NOT
    // the transform role's document with a swapped principal - that one also
    // grants `sts:TagSession`, which Firehose never uses.
    expect(
      JSON.parse(formBody(requests[0] as RecordedRequest)['AssumeRolePolicyDocument'] ?? ''),
    ).toStrictEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'firehose.amazonaws.com' },
          Action: ['sts:AssumeRole'],
        },
      ],
    });
    expect(formBody(requests[1] as RecordedRequest)['PolicyName']).toBe('firehose-delivery');
    expect(ctx.state.resources['analytics-firehose-role']).toStrictEqual({
      name: FIREHOSE_ROLE,
      arn: FIREHOSE_ROLE_ARN,
    });
  });

  it('grants exactly four capabilities, each on concrete ARNs and none on a wildcard', async () => {
    // Enumerated by capability rather than counted, and asserted on the parsed
    // document rather than on the call: a `Resource: '*'` grants strictly more
    // than the correct document, so every functional test in this file still
    // passes with one. This role can read the Glue catalog, write the Iceberg
    // table, invoke a Lambda and write an S3 bucket - a wildcard on any of the
    // four would hand it every table, every function or every bucket in the
    // account, including the other environments' analytics data.
    const { ctx, requests } = makeContext([
      createdRole(FIREHOSE_ROLE_ARN),
      iamDone('PutRolePolicy'),
    ]);
    await analyticsFirehoseRoleNode().create(withRoleDependencies(ctx));
    const statements = policyStatements(requests[1] as RecordedRequest);

    expect(statements).toHaveLength(4);

    expect(capability(statements, 'glue')).toStrictEqual({
      Effect: 'Allow',
      Action: [
        'glue:GetDatabase',
        'glue:GetDatabases',
        'glue:GetTable',
        'glue:GetTables',
        'glue:UpdateTable',
      ],
      // Every level of the federation hierarchy, narrowed to this environment's
      // own table bucket, namespace and table - AWS's own policy writes the last
      // three as account-wide wildcards.
      Resource: GLUE_GRANT_RESOURCES,
    });

    expect(capability(statements, 's3tables')).toStrictEqual({
      Effect: 'Allow',
      Action: [
        's3tables:GetTableBucket',
        's3tables:GetNamespace',
        's3tables:GetTable',
        's3tables:GetTableData',
        's3tables:GetTableMetadataLocation',
        's3tables:PutTableData',
        's3tables:UpdateTableMetadataLocation',
      ],
      // The generated table ARN `analytics-table` recorded, not a re-derived name.
      Resource: [TABLE_BUCKET_ARN, TABLE_ARN],
    });

    expect(capability(statements, 'lambda')).toStrictEqual({
      Effect: 'Allow',
      Action: ['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'],
      // The UNQUALIFIED function ARN task 50 recorded - the exact string the
      // stream sends as `LambdaArn`. AWS's example writes a `:<version>`-qualified
      // ARN, which would not match an unqualified invoke.
      Resource: TRANSFORM_FUNCTION_ARN,
    });

    expect(capability(statements, 's3')).toStrictEqual({
      Effect: 'Allow',
      Action: [
        's3:AbortMultipartUpload',
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:ListBucketMultipartUploads',
        's3:PutObject',
      ],
      // Both ARNs: bucket actions authorise against the bucket and object
      // actions against the key, and neither matches the other. With only the
      // bucket named, `PutObject` is denied and every failed record is lost.
      Resource: [ERROR_BUCKET_ARN, `${ERROR_BUCKET_ARN}/*`],
    });

    for (const resource of policyResources(statements)) {
      expect(resource.startsWith('arn:aws:')).toBe(true);
      expect(resource).not.toBe('*');
    }
  });

  it("never names the site's environment bucket anywhere in the policy", async () => {
    // `ctx.names.bucket` sits in `config.region` while this whole pipeline is
    // pinned to us-east-1, and an S3 ARN carries no region for the API to reject
    // the mismatch with. The plugin owns its own error bucket precisely so the
    // site's is never reached for - and this asserts it on the document, where a
    // stray `${ctx.names.bucket}` would otherwise be a working grant nobody sees.
    const { ctx, requests } = makeContext([
      createdRole(FIREHOSE_ROLE_ARN),
      iamDone('PutRolePolicy'),
    ]);
    await analyticsFirehoseRoleNode().create(withRoleDependencies(ctx));
    const document = formBody(requests[1] as RecordedRequest)['PolicyDocument'] ?? '';
    expect(ctx.names.bucket).toBe(`${PREFIX}-${ACCOUNT_ID}`);
    expect(document).not.toContain(ctx.names.bucket);
    expect(document).toContain(ERROR_BUCKET_ARN);
  });

  it.each([
    ['error bucket', withTransformFunction, withTable, /analytics-error-bucket/],
    ['table', withErrorBucket, withTransformFunction, /analytics-table/],
    ['transform function', withErrorBucket, withTable, /analytics-transform-function/],
  ])(
    'refuses to write the policy when the %s ARN is not recorded',
    async (_what, first, second, expected) => {
      // The guard that holds however the graph is ordered. Without it the policy
      // would interpolate `undefined` into a live IAM grant: a wrong permission,
      // written silently, never an error, and one nothing notices until Firehose
      // starts routing every record to the error bucket.
      const { ctx, requests } = makeContext([createdRole(FIREHOSE_ROLE_ARN)]);
      await expect(analyticsFirehoseRoleNode().create(second(first(ctx)))).rejects.toThrow(
        expected,
      );
      // The role was created; the grant was NOT written on nothing.
      expect(actions(requests)).toStrictEqual(['CreateRole']);
    },
  );

  it('refuses to write the policy when the recorded error bucket ARN is empty', async () => {
    const { ctx, requests } = makeContext([createdRole(FIREHOSE_ROLE_ARN)]);
    await expect(
      analyticsFirehoseRoleNode().create(
        withTransformFunction(withTable(withErrorBucket(ctx, ''))),
      ),
    ).rejects.toThrow(/analytics-error-bucket/);
    expect(actions(requests)).toStrictEqual(['CreateRole']);
  });

  it('records the role ARN even when the policy PUT throws', async () => {
    // Pins the order of the two writes in `create`, the ordering
    // `analytics-transform-role` chose and for the same reason: the role is a
    // real IAM object the moment `ensureRole` returns, so a crash in the policy
    // call must still leave it recorded for `delete` to find.
    const { ctx, requests } = makeContext([
      createdRole(FIREHOSE_ROLE_ARN),
      iamFailure(403, 'AccessDenied', 'is not authorized to perform: iam:PutRolePolicy'),
    ]);
    await expect(analyticsFirehoseRoleNode().create(withRoleDependencies(ctx))).rejects.toThrow(
      /AccessDenied/,
    );
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources['analytics-firehose-role']).toStrictEqual({
      name: FIREHOSE_ROLE,
      arn: FIREHOSE_ROLE_ARN,
    });
  });

  it('reapplies the policy on update, so a recreated table reaches the grant', async () => {
    const { ctx, requests } = makeContext([iamDone('PutRolePolicy')]);
    await analyticsFirehoseRoleNode().update?.(withRoleDependencies(ctx));
    expect(actions(requests)).toStrictEqual(['PutRolePolicy']);
  });

  it('deletes the role, removing its inline policy first', async () => {
    const { ctx, requests } = makeContext([
      rolePolicies(['firehose-delivery']),
      iamDone('DeleteRolePolicy'),
      iamDone('DeleteRole'),
    ]);
    await expect(analyticsFirehoseRoleNode().delete(ctx)).resolves.toBeUndefined();
    expect(actions(requests)).toStrictEqual(['ListRolePolicies', 'DeleteRolePolicy', 'DeleteRole']);
  });

  it('deletes an already-absent role without throwing', async () => {
    const { ctx, requests } = makeContext([noSuchRole()]);
    await expect(analyticsFirehoseRoleNode().delete(ctx)).resolves.toBeUndefined();
    expect(actions(requests)).toStrictEqual(['ListRolePolicies']);
  });
});

describe('analytics-firehose-stream', () => {
  it('reads an existing stream and hydrates the delivery state analytics status reports', async () => {
    const { ctx, requests } = makeContext([
      ok(
        streamDescription('CREATING_FAILED', {
          VersionId: '2',
          Destinations: destinationWith(false),
          FailureDescription: { Type: 'CREATE_KMS_GRANT_FAILED', Details: 'no grant' },
        }),
      ),
    ]);
    await expect(analyticsFirehoseStreamNode().read(ctx)).resolves.toBe(true);
    expect(targets(requests)).toStrictEqual(['Firehose_20150804.DescribeDeliveryStream']);
    // Everything task 55 needs to report health, hydrated by the same `read` the
    // reconcile runs - so `analytics status` needs no second describe path.
    expect(ctx.state.resources['analytics-firehose-stream']).toStrictEqual({
      name: STREAM,
      arn: STREAM_ARN,
      state: 'create-failed',
      versionId: '2',
      destinationId: DESTINATION_ID,
      appendOnly: false,
      failure: 'CREATE_KMS_GRANT_FAILED: no grant',
    });
  });

  it('clears a recorded failure once the stream reports healthy again', async () => {
    // `output` re-records rather than replaces, so a `failure` from a create that
    // failed on a KMS error would outlive the recovery and `analytics status`
    // would go on reporting a stream that is fine.
    const { ctx } = makeContext([
      ok(
        streamDescription('CREATING_FAILED', {
          FailureDescription: { Type: 'CREATE_KMS_GRANT_FAILED', Details: 'no grant' },
        }),
      ),
      ok(streamDescription('ACTIVE')),
    ]);
    await analyticsFirehoseStreamNode().read(ctx);
    expect(ctx.state.resources['analytics-firehose-stream']?.['failure']).toBeDefined();
    await analyticsFirehoseStreamNode().read(ctx);
    expect(Object.keys(ctx.state.resources['analytics-firehose-stream'] ?? {})).not.toContain(
      'failure',
    );
  });

  it('reads false without throwing when the stream is absent, recording nothing', async () => {
    const { ctx, requests } = makeContext([noSuchStream()]);
    await expect(analyticsFirehoseStreamNode().read(ctx)).resolves.toBe(false);
    expect(requests).toHaveLength(1);
    expect(ctx.state.resources['analytics-firehose-stream']).toBeUndefined();
  });

  // The same IAM propagation window the transform function hits, one node
  // later. This is the failure a real `analytics bootstrap` produced on the
  // run AFTER the Lambda retry shipped - the fix had been applied to one of
  // the graph's two role consumers, and the other failed immediately.
  it('retries CreateDeliveryStream while Firehose cannot yet assume the role', async () => {
    const { ctx, requests } = makeContext([
      firehoseRoleNotYetAssumable(),
      ok({ DeliveryStreamARN: STREAM_ARN }),
      ok(streamDescription('CREATING')),
    ]);

    await analyticsFirehoseStreamNode().create(withStreamDependencies(ctx));

    // Two CreateDeliveryStream calls: the first refused, the second accepted.
    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.CreateDeliveryStream',
      'Firehose_20150804.CreateDeliveryStream',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
  });

  // Firehose words this differently from Lambda and puts nothing
  // machine-readable in the code, so the predicate matches on message. This
  // pins that a permanent InvalidArgumentException at the same status is NOT
  // retried - the property that keeps the retry from hiding real failures.
  it('does not retry a Firehose 400 that is not the role propagation window', async () => {
    const { ctx, requests } = makeContext([
      firehoseFailure('InvalidArgumentException', 'AppendOnly cannot be updated'),
    ]);

    await expect(analyticsFirehoseStreamNode().create(withStreamDependencies(ctx))).rejects.toThrow(
      /AppendOnly cannot be updated/,
    );
    expect(requests).toHaveLength(1);
  });

  it('creates the stream with the Iceberg destination and the transform processor', async () => {
    const { ctx, requests } = makeContext([
      ok({ DeliveryStreamARN: STREAM_ARN }),
      ok(streamDescription('CREATING')),
    ]);
    await analyticsFirehoseStreamNode().create(withStreamDependencies(ctx));

    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.CreateDeliveryStream',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
    expect(requests[0]?.url).toBe(FIREHOSE_ENDPOINT);
    expect(requests[0]?.body).toMatchObject({
      DeliveryStreamName: STREAM,
      DeliveryStreamType: 'DirectPut',
      IcebergDestinationConfiguration: {
        RoleARN: FIREHOSE_ROLE_ARN,
        // The CHILD catalog for this environment's table bucket, not the
        // account-wide federation root `analytics-catalog-integration` records.
        CatalogConfiguration: { CatalogARN: FEDERATED_CATALOG_ARN },
        S3Configuration: {
          // The plugin's own us-east-1 bucket. Never `ctx.names.bucket`.
          BucketARN: ERROR_BUCKET_ARN,
          RoleARN: FIREHOSE_ROLE_ARN,
          ErrorOutputPrefix: ERROR_PREFIX,
        },
        AppendOnly: true,
        BufferingHints: { IntervalInSeconds: 900, SizeInMBs: 128 },
        DestinationTableConfigurationList: [
          {
            DestinationDatabaseName: NAMESPACE,
            DestinationTableName: TABLE,
            S3ErrorOutputPrefix: ERROR_PREFIX,
          },
        ],
        ProcessingConfiguration: {
          Enabled: true,
          Processors: [
            {
              Type: 'Lambda',
              Parameters: [
                // The ARN task 50 recorded, not a re-derived function name.
                { ParameterName: 'LambdaArn', ParameterValue: TRANSFORM_FUNCTION_ARN },
              ],
            },
          ],
        },
      },
    });
    expect(ctx.state.resources['analytics-firehose-stream']).toStrictEqual({
      name: STREAM,
      arn: STREAM_ARN,
      state: 'creating',
      versionId: '1',
      destinationId: DESTINATION_ID,
      appendOnly: true,
    });
  });

  it("never names the site's environment bucket in the destination", async () => {
    const { ctx, requests } = makeContext([
      ok({ DeliveryStreamARN: STREAM_ARN }),
      ok(streamDescription('CREATING')),
    ]);
    await analyticsFirehoseStreamNode().create(withStreamDependencies(ctx));
    expect(JSON.stringify(requests[0]?.body)).not.toContain(ctx.names.bucket);
  });

  it('records the stream name even when the describe after create throws', async () => {
    // `createDeliveryStream` answers with no ARN by design, so hydrating one
    // takes a second request - and a crash in between must still leave the
    // stream recorded for `destroy` to remove.
    const { ctx, requests } = makeContext([
      ok({ DeliveryStreamARN: STREAM_ARN }),
      firehoseFailure('InternalFailure', 'try again later'),
    ]);
    await expect(analyticsFirehoseStreamNode().create(withStreamDependencies(ctx))).rejects.toThrow(
      /InternalFailure|try again later/,
    );
    expect(requests).toHaveLength(2);
    expect(ctx.state.resources['analytics-firehose-stream']).toStrictEqual({ name: STREAM });
  });

  it('refuses to create the stream when the delivery role ARN is not recorded', async () => {
    const { ctx, requests } = makeContext([]);
    await expect(
      analyticsFirehoseStreamNode().create(withTransformFunction(withErrorBucket(ctx))),
    ).rejects.toThrow(/analytics-firehose-role/);
    // Nothing went out at all: the destination is built before the create call.
    expect(requests).toStrictEqual([]);
  });

  it('performs no AWS call at all when the live AppendOnly flag already matches', async () => {
    const { ctx, requests } = makeContext([]);
    await analyticsFirehoseStreamNode().update?.(
      withRecordedStream(withStreamDependencies(ctx), { appendOnly: true }),
    );
    expect(requests).toStrictEqual([]);
  });

  it('updates the destination in place when the recorded AppendOnly flag differs', async () => {
    // Branch one of the reconcile AWS's own documentation makes necessary: the
    // considerations page says AppendOnly is settable only at create, the
    // IcebergDestinationUpdate reference lists it among the fields
    // UpdateDestination accepts. This is the reading that holds if the reference
    // is right - and it is tried first because it keeps the stream's ARN.
    const warnings: string[] = [];
    const { ctx, requests } = makeContext(
      [
        encode(''),
        ok(streamDescription('ACTIVE', { VersionId: '4', Destinations: destinationWith(true) })),
      ],
      { warnings },
    );
    await analyticsFirehoseStreamNode().update?.(withRecordedStream(withStreamDependencies(ctx)));

    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.UpdateDestination',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
    expect(requests[0]?.body).toMatchObject({
      DeliveryStreamName: STREAM,
      // The recorded version, under the key UpdateDestination wants - not the
      // `VersionId` the describe answered with.
      CurrentDeliveryStreamVersionId: '3',
      DestinationId: DESTINATION_ID,
      IcebergDestinationUpdate: { AppendOnly: true, RoleARN: FIREHOSE_ROLE_ARN },
    });
    // The re-read matters: the update bumps VersionId, so a state file holding
    // the old one would fail the NEXT update on a conflict it did not cause.
    expect(ctx.state.resources['analytics-firehose-stream']).toMatchObject({
      versionId: '4',
      appendOnly: true,
    });
    // No replacement happened, so nothing warned about a new ARN.
    expect(warnings.join('\n')).not.toMatch(/NEW ARN/);
  });

  // The most consequential of the four retry cases. The fallback below is
  // deliberately NOT narrowed to one exception - any refused update reaches it -
  // so before the retry a transient role-propagation 400 was indistinguishable
  // from a genuine refusal, and the node answered it by DELETING and recreating
  // the stream: a new ARN, task 53's CloudFront log delivery orphaned, and the
  // records in flight lost. Retrying the timing failure is what keeps a
  // destructive fallback for the case that actually warrants it.
  it('retries a role-propagation refusal on UpdateDestination instead of replacing the stream', async () => {
    const warnings: string[] = [];
    const { ctx, requests } = makeContext(
      [
        firehoseRoleNotYetAssumable(),
        encode(''),
        ok(streamDescription('ACTIVE', { VersionId: '4', Destinations: destinationWith(true) })),
      ],
      { warnings },
    );

    await analyticsFirehoseStreamNode().update?.(withRecordedStream(withStreamDependencies(ctx)));

    // Two updates and a re-read - and crucially NO CreateDeliveryStream, which
    // is what a replacement would have issued.
    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.UpdateDestination',
      'Firehose_20150804.UpdateDestination',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
    expect(targets(requests)).not.toContain('Firehose_20150804.CreateDeliveryStream');
    expect(warnings.join('\n')).not.toMatch(/NEW ARN/);
  });

  it('falls back to replacing the stream when UpdateDestination is refused', async () => {
    // Branch two: the reading that holds if the considerations page is right.
    // The fallback is what makes the node correct under either, and it is second
    // because a replacement gets a new ARN - the CloudFront log delivery has to
    // be repointed and records in flight are lost.
    const warnings: string[] = [];
    const { ctx, requests } = makeContext(
      [
        firehoseFailure('InvalidArgumentException', 'AppendOnly cannot be updated'),
        encode(''),
        ok({ DeliveryStreamARN: STREAM_ARN }),
        ok(streamDescription('CREATING', { VersionId: '1', Destinations: destinationWith(true) })),
      ],
      { warnings },
    );
    await analyticsFirehoseStreamNode().update?.(withRecordedStream(withStreamDependencies(ctx)));

    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.UpdateDestination',
      'Firehose_20150804.DeleteDeliveryStream',
      'Firehose_20150804.CreateDeliveryStream',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
    // Which path ran is in the log, so an operator can see it - and the cost of
    // the path that ran is stated rather than left to be discovered.
    expect(warnings.join('\n')).toMatch(/UpdateDestination was refused/);
    expect(warnings.join('\n')).toMatch(/NEW ARN/);
    expect(ctx.state.resources['analytics-firehose-stream']).toMatchObject({ appendOnly: true });
  });

  it('does not replace the stream when the re-read after a successful update fails', async () => {
    // The update LANDED: the stream is configured and keeps its ARN. A transient
    // failure on the describe that follows it is not a refusal, and must not be
    // read as one - the replacement path deletes and recreates, which hands out a
    // NEW ARN, orphans the CloudFront log delivery task 53 points at this stream,
    // and loses the records in flight, all over a stream that was updated
    // correctly. `describeDeliveryStream` swallows only the not-found
    // (`aws/firehose.ts`), so every other failure arrives here.
    //
    // Asserted on the recording transport rather than on the log line: it is the
    // calls that do the damage, and a node that logged the right thing while
    // issuing a delete would still have destroyed the stream.
    const warnings: string[] = [];
    const { ctx, requests } = makeContext(
      [encode(''), firehoseFailure('LimitExceededException', 'too many requests')],
      { warnings },
    );
    await analyticsFirehoseStreamNode().update?.(withRecordedStream(withStreamDependencies(ctx)));

    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.UpdateDestination',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
    expect(warnings.join('\n')).not.toMatch(/UpdateDestination was refused/);
    expect(warnings.join('\n')).not.toMatch(/NEW ARN/);
    // The recorded version is now stale - the update bumped it and the re-read
    // that would have refreshed it failed - so the warning says so and the next
    // reconcile's `read` re-hydrates it. Stale-but-recoverable beats replaced.
    expect(ctx.state.resources['analytics-firehose-stream']).toMatchObject({ versionId: '3' });
    expect(warnings.join('\n')).toMatch(/could not be re-read/);
  });

  it('replaces the stream when there is no recorded version to update against', async () => {
    const { ctx, requests } = makeContext([
      encode(''),
      ok({ DeliveryStreamARN: STREAM_ARN }),
      ok(streamDescription('CREATING', { Destinations: destinationWith(true) })),
    ]);
    await analyticsFirehoseStreamNode().update?.(
      withRecordedStream(withStreamDependencies(ctx), { versionId: '', destinationId: '' }),
    );
    // UpdateDestination is not even attempted: it requires both, and sending an
    // empty CurrentDeliveryStreamVersionId fails the service's own `[0-9]+`.
    expect(targets(requests)).toStrictEqual([
      'Firehose_20150804.DeleteDeliveryStream',
      'Firehose_20150804.CreateDeliveryStream',
      'Firehose_20150804.DescribeDeliveryStream',
    ]);
  });

  it('raises rather than reporting success when the replacement races the old stream', async () => {
    // `createDeliveryStream` swallows ResourceInUseException as "already exists",
    // which is right for a re-run and wrong straight after a delete - there the
    // same exception means the OLD stream is still DELETING. Without the check
    // the reconcile would go green over an account holding no live stream, and
    // the first symptom would be an empty dashboard.
    const { ctx } = makeContext([
      firehoseFailure('InvalidArgumentException', 'AppendOnly cannot be updated'),
      encode(''),
      firehoseFailure('ResourceInUseException', 'Firehose stream is DELETING'),
      ok(streamDescription('DELETING')),
    ]);
    await expect(
      analyticsFirehoseStreamNode().update?.(withRecordedStream(withStreamDependencies(ctx))),
    ).rejects.toThrow(/still deleting/);
  });

  it('deletes an already-absent stream without throwing', async () => {
    const { ctx, requests } = makeContext([noSuchStream()]);
    await expect(analyticsFirehoseStreamNode().delete(ctx)).resolves.toBeUndefined();
    expect(targets(requests)).toStrictEqual(['Firehose_20150804.DeleteDeliveryStream']);
  });
});

describe('the delivery chain region pin and names', () => {
  it('signs the bucket, the role and the stream against us-east-1 while config.region says otherwise', async () => {
    const { ctx, requests } = makeContext([
      s3Done(),
      createdRole(FIREHOSE_ROLE_ARN),
      iamDone('PutRolePolicy'),
      ok({ DeliveryStreamARN: STREAM_ARN }),
      ok(streamDescription('CREATING')),
    ]);
    await analyticsErrorBucketNode().read(ctx);
    await analyticsFirehoseRoleNode().create(withRoleDependencies(ctx));
    await analyticsFirehoseStreamNode().create(withStreamDependencies(ctx));

    expect(ctx.config.region).toBe(CONFIG_REGION);
    expect(requests.map((request) => credentialScope(request.headers))).toStrictEqual([
      { region: 'us-east-1', service: 's3' },
      // IAM is global: core's own client already signs us-east-1, so the role is
      // the one resource in this chain the pin cannot get wrong.
      { region: 'us-east-1', service: 'iam' },
      { region: 'us-east-1', service: 'iam' },
      { region: 'us-east-1', service: 'firehose' },
      { region: 'us-east-1', service: 'firehose' },
    ]);
  });

  it("raises on a derived name over the service's limit, before any call goes out", async () => {
    // Long enough that the two derived names below overrun, and short enough
    // that `deriveNames`' own 63-char check on the site bucket does not fire
    // first - the guard under test is this module's, not core's.
    const longName = 'a'.repeat(45);
    const { ctx, requests } = makeContext([], { config: { siteName: longName } });
    await expect(analyticsErrorBucketNode().read(ctx)).rejects.toThrow(
      /derived analytics error bucket name .* over AWS's 63-character limit/,
    );
    await expect(analyticsFirehoseStreamNode().delete(ctx)).rejects.toThrow(
      /derived analytics delivery stream name .* over AWS's 64-character limit/,
    );
    expect(requests).toStrictEqual([]);
  });
});

describe('tearing the delivery chain down', () => {
  /** The chain in `dependsOn` order; `destroyGraph` walks the reverse. */
  const CHAIN = [
    analyticsErrorBucketNode(),
    analyticsFirehoseRoleNode(),
    analyticsFirehoseStreamNode(),
  ];

  async function teardown(replies: RawResponse[]): Promise<RecordedRequest[]> {
    const { ctx, requests } = makeContext(replies);
    for (const node of [...CHAIN].reverse()) {
      await expect(node.delete(ctx)).resolves.toBeUndefined();
    }
    return requests;
  }

  it('removes the stream, then the role, then the bucket', async () => {
    // The stream has to go first: it assumes the role, and the role's policy is
    // what lets it write. `destroyGraph` reverses the topological order
    // (`packages/cli/src/graph.ts`); the engine lives in the CLI package, which
    // this one cannot import, so the reverse walk is spelled out here.
    const requests = await teardown([
      encode(''),
      rolePolicies(['firehose-delivery']),
      iamDone('DeleteRolePolicy'),
      iamDone('DeleteRole'),
      s3Done(),
      listing(),
      s3Done(),
    ]);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `POST ${FIREHOSE_ENDPOINT}`,
      `POST ${IAM_ENDPOINT}`,
      `POST ${IAM_ENDPOINT}`,
      `POST ${IAM_ENDPOINT}`,
      `HEAD ${S3_HOST}/${ERROR_BUCKET}`,
      `GET ${S3_HOST}/${ERROR_BUCKET}?list-type=2&prefix=`,
      `DELETE ${S3_HOST}/${ERROR_BUCKET}`,
    ]);
    expect(targets(requests.slice(0, 1))).toStrictEqual(['Firehose_20150804.DeleteDeliveryStream']);
    expect(actions(requests.slice(1, 4))).toStrictEqual([
      'ListRolePolicies',
      'DeleteRolePolicy',
      'DeleteRole',
    ]);
  });

  it('is re-runnable when the stream is already gone', async () => {
    // The partial-teardown case: a run that died after the stream delete landed.
    // The role delete still goes out - a swallowed not-found on the stream must
    // not abandon the rest of the walk.
    const requests = await teardown([
      noSuchStream(),
      rolePolicies([]),
      iamDone('DeleteRole'),
      noSuchBucket(),
    ]);
    expect(targets(requests.slice(0, 1))).toStrictEqual(['Firehose_20150804.DeleteDeliveryStream']);
    expect(actions(requests.slice(1, 3))).toStrictEqual(['ListRolePolicies', 'DeleteRole']);
    expect(requests[3]?.method).toBe('HEAD');
  });

  it('is re-runnable when the role is already gone', async () => {
    const requests = await teardown([encode(''), noSuchRole(), s3Done(), listing(), s3Done()]);
    expect(actions(requests.slice(1, 2))).toStrictEqual(['ListRolePolicies']);
    expect(requests.map((request) => request.method)).toStrictEqual([
      'POST',
      'POST',
      'HEAD',
      'GET',
      'DELETE',
    ]);
  });
});

/** Record what `analytics-log-destination` records, so the delivery has a destination to name. */
function withLogDestination(
  ctx: PluginContext<AnalyticsConfig>,
  overrides: ResourceOutputs = {},
): PluginContext<AnalyticsConfig> {
  ctx.record('analytics-log-destination', {
    name: LOG_DESTINATION,
    arn: LOG_DESTINATION_ARN,
    outputFormat: 'json',
    ...overrides,
  });
  return ctx;
}

/** A `DescribeDeliveryStream` reply for a stream in `status`, which the wait below reads. */
function stream(status: string): RawResponse {
  return ok(streamDescription(status));
}

describe('the analytics vended-delivery graph', () => {
  it('chains firehose-stream -> log-destination -> log-delivery', () => {
    // The destination's edge is the ARN it interpolates, and the accident does
    // NOT save it: `analytics-firehose-stream` sorts AFTER
    // `analytics-log-destination`, so with `dependsOn: []` `topoSort` would run
    // the destination first and point it at an unrecorded stream ARN.
    expect(analyticsLogDestinationNode().id).toBe('analytics-log-destination');
    expect(analyticsLogDestinationNode().dependsOn).toStrictEqual(['analytics-firehose-stream']);
    expect(analyticsLogDeliveryNode().id).toBe('analytics-log-delivery');
    expect(analyticsLogDeliveryNode().dependsOn).toStrictEqual(['analytics-log-destination']);
  });

  it("is assignable to the SPI's own ResourceNode[], so the CLI engine runs it unchanged", () => {
    const nodes: ResourceNode[] = [analyticsLogDestinationNode(), analyticsLogDeliveryNode()];
    expect(nodes.map((node) => node.id)).toStrictEqual([
      'analytics-log-destination',
      'analytics-log-delivery',
    ]);
  });

  it("names its destination something the site's own delivery guard will not claim", async () => {
    // The one property task 52's guards rest on. `isOwnDelivery`
    // (`packages/cli/src/nodes.ts`) attributes a delivery by the final
    // `:`-separated segment of its destination ARN, compared against
    // `names.deliveryDestination`; if the plugin's destination resolved to that
    // name, `blogwright destroy` would treat this delivery as the site's own and
    // remove the shared source without refusing.
    //
    // Asserted against the name the node actually PUT, not against this file's
    // own constants: the relationship has to hold for what `nodes.ts` derives.
    const world = logsWorld({ deliveries: [SITE_DELIVERY] });
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    await analyticsLogDestinationNode().create(withRecordedStream(ctx));
    const put = isJsonObject(requests[1]?.body) ? String(requests[1]?.body['name']) : '';

    expect(ctx.names.deliveryDestination).toBe(SITE_DELIVERY_DESTINATION);
    expect(put).not.toBe(ctx.names.deliveryDestination);
    // What the site's guard would attribute the plugin's delivery to, and what
    // it attributes the site's own to - the two must not be the same string.
    expect(destinationArn(put).split(':').pop()).not.toBe(ctx.names.deliveryDestination);
    expect(SITE_DELIVERY.deliveryDestinationArn.split(':').pop()).toBe(
      ctx.names.deliveryDestination,
    );
  });
});

describe('analytics-log-destination', () => {
  it('reads false without an AWS call when nothing is recorded', async () => {
    const { ctx, requests } = makeContext([]);
    await expect(analyticsLogDestinationNode().read(ctx)).resolves.toBe(false);
    expect(requests).toStrictEqual([]);
    // An empty entry here would claim a destination that does not exist.
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('reads true off the recorded ARN, and false over an empty one', async () => {
    const { ctx, requests } = makeContext([]);
    await expect(analyticsLogDestinationNode().read(withLogDestination(ctx))).resolves.toBe(true);
    await expect(
      analyticsLogDestinationNode().read(withLogDestination(ctx, { arn: '' })),
    ).resolves.toBe(false);
    expect(requests).toStrictEqual([]);
  });

  it('creates the destination against the stream, in JSON, once the stream is active', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [] });
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    await analyticsLogDestinationNode().create(withRecordedStream(ctx));

    expect(deliveryCalls(requests)).toStrictEqual(['describeStream', 'putDest']);
    expect(requests[1]?.url).toBe(LOGS_ENDPOINT);
    // `toStrictEqual`, not `toMatchObject`: an added key is a body this test
    // must not pass, and `fieldDelimiter` is deliberately not one of them.
    expect(requests[1]?.body).toStrictEqual({
      name: LOG_DESTINATION,
      deliveryDestinationConfiguration: { destinationResourceArn: STREAM_ARN },
      outputFormat: 'json',
    });
    expect(ctx.state.resources['analytics-log-destination']).toStrictEqual({
      name: LOG_DESTINATION,
      arn: LOG_DESTINATION_ARN,
      outputFormat: 'json',
    });
    // The site's delivery is still there and nothing was deleted at all.
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d']);
    expect(deliveryCalls(requests)).not.toContain('deleteSource');
  });

  it('signs the destination against us-east-1 while config.region says otherwise', async () => {
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: logsWorld(),
    });
    await analyticsLogDestinationNode().create(withRecordedStream(ctx));
    expect(ctx.config.region).toBe(CONFIG_REGION);
    expect(credentialScope(requests[1]?.headers ?? {})).toStrictEqual({
      region: 'us-east-1',
      service: 'logs',
    });
  });

  it('waits for a stream that is still creating before pointing a destination at it', async () => {
    // Task 51's routed finding: `createStream` reports a `CREATING` stream as
    // created, so without this wait the destination and the delivery would be
    // built over a stream accepting no records - and nothing would say so.
    const world = logsWorld();
    const { ctx, requests } = makeContext([stream('CREATING'), stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    vi.useFakeTimers();
    try {
      const pending = analyticsLogDestinationNode().create(withRecordedStream(ctx));
      // The interval `nodes.ts` polls on, restated rather than imported.
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
    expect(deliveryCalls(requests)).toStrictEqual(['describeStream', 'describeStream', 'putDest']);
    expect(world.destinations).toStrictEqual([LOG_DESTINATION]);
  });

  it('refuses rather than pointing a destination at a stream that never became active', async () => {
    const world = logsWorld();
    const { ctx, requests } = makeContext([stream('CREATING_FAILED')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    await expect(analyticsLogDestinationNode().create(withRecordedStream(ctx))).rejects.toThrow(
      /is create-failed rather than active/,
    );
    // Nothing was wired: the refusal lands before the put, so no destination
    // exists to be found later and believed healthy.
    expect(deliveryCalls(requests)).toStrictEqual(['describeStream']);
    expect(world.destinations).toStrictEqual([]);
    expect(ctx.state.resources['analytics-log-destination']).toBeUndefined();
  });

  it('refuses to create the destination when the stream ARN is not recorded', async () => {
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: logsWorld() });
    await expect(analyticsLogDestinationNode().create(ctx)).rejects.toThrow(
      /analytics-firehose-stream/,
    );
    // Nothing went out at all - not even the describe the wait would make.
    expect(requests).toStrictEqual([]);
  });

  it('clears its own delivery and destination on a Conflict, never the shared source', async () => {
    // The self-heal, and the deliberate divergence from
    // `packages/cli/src/nodes.ts:751-759`: the site's retry deletes the delivery
    // SOURCE at `:758`, which here would take the site's own CloudWatch delivery
    // with it. The site's delivery is listed FIRST, so a guard picking by
    // position would remove the wrong one.
    const world = logsWorld({
      deliveries: [SITE_DELIVERY, PLUGIN_DELIVERY],
      destinations: [SITE_DELIVERY_DESTINATION, LOG_DESTINATION],
      putFailures: [
        { code: 'ConflictException', message: 'Output format cannot be changed for a destination' },
      ],
    });
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    await analyticsLogDestinationNode().create(withRecordedStream(ctx));

    expect(deliveryCalls(requests)).toStrictEqual([
      'describeStream',
      'putDest',
      'listDeliveries',
      'deleteDelivery:analytics-d',
      'deleteDest',
      'putDest',
    ]);
    expect(deliveryCalls(requests)).not.toContain('deleteSource');
    expect(deliveryCalls(requests)).not.toContain('deleteDelivery:site-d');
    // The site's delivery, its destination and the shared source are untouched.
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d']);
    expect(world.destinations).toStrictEqual([SITE_DELIVERY_DESTINATION, LOG_DESTINATION]);
    expect(world.sourcePresent).toBe(true);
    expect(ctx.state.resources['analytics-log-destination']?.['arn']).toBe(LOG_DESTINATION_ARN);
  });

  it('rethrows a non-conflict failure from the put untouched', async () => {
    const world = logsWorld({
      deliveries: [SITE_DELIVERY],
      putFailures: [{ code: 'AccessDeniedException', message: 'no logs:PutDeliveryDestination' }],
    });
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    await expect(analyticsLogDestinationNode().create(withRecordedStream(ctx))).rejects.toThrow(
      /AccessDenied/,
    );
    expect(deliveryCalls(requests)).toStrictEqual(['describeStream', 'putDest']);
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d']);
  });

  it('replaces the destination when the recorded output format differs', async () => {
    // The output format is immutable once a destination exists, so this is a
    // delete-then-create and not a second put. The plugin's own delivery has to
    // come off first: the fake rejects `DeleteDeliveryDestination` while a
    // delivery points at it, exactly as AWS does.
    const world = logsWorld({
      deliveries: [SITE_DELIVERY, PLUGIN_DELIVERY],
      destinations: [SITE_DELIVERY_DESTINATION, LOG_DESTINATION],
    });
    const warnings: string[] = [];
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
      warnings,
    });
    await analyticsLogDestinationNode().update?.(
      withLogDestination(withRecordedStream(ctx), { outputFormat: 'w3c' }),
    );

    expect(deliveryCalls(requests)).toStrictEqual([
      'listDeliveries',
      'deleteDelivery:analytics-d',
      'deleteDest',
      'describeStream',
      'putDest',
    ]);
    expect(deliveryCalls(requests)).not.toContain('deleteSource');
    expect(warnings.join('\n')).toMatch(/cannot be changed in place - replacing it/);
    expect(ctx.state.resources['analytics-log-destination']?.['outputFormat']).toBe('json');
    // The site's delivery and its own destination survive the replacement.
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d']);
    expect(world.destinations).toStrictEqual([SITE_DELIVERY_DESTINATION, LOG_DESTINATION]);
  });

  it('re-puts the destination on a matching format, so a replaced stream is repointed', async () => {
    // `analytics-firehose-stream`'s own fallback replaces the stream, and a
    // replacement carries a NEW ARN. This reconcile is what points the
    // destination at it; nothing is deleted on this path.
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [LOG_DESTINATION] });
    const replaced = `${STREAM_ARN}-2`;
    const { ctx, requests } = makeContext([stream('ACTIVE')], {
      site: BOOTSTRAPPED_SITE,
      logs: world,
    });
    await analyticsLogDestinationNode().update?.(
      withLogDestination(withRecordedStream(ctx, { arn: replaced })),
    );
    expect(deliveryCalls(requests)).toStrictEqual(['describeStream', 'putDest']);
    expect(requests[1]?.body).toStrictEqual({
      name: LOG_DESTINATION,
      deliveryDestinationConfiguration: { destinationResourceArn: replaced },
      outputFormat: 'json',
    });
  });

  it("deletes only its own destination, leaving the site's delivery and source alone", async () => {
    const world = logsWorld({
      deliveries: [SITE_DELIVERY],
      destinations: [SITE_DELIVERY_DESTINATION, LOG_DESTINATION],
    });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await expect(analyticsLogDestinationNode().delete(ctx)).resolves.toBeUndefined();
    expect(deliveryCalls(requests)).toStrictEqual(['deleteDest']);
    expect(requests[0]?.body).toStrictEqual({ name: LOG_DESTINATION });
    expect(world.destinations).toStrictEqual([SITE_DELIVERY_DESTINATION]);
    expect(world.sourcePresent).toBe(true);
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d']);
  });

  it('deletes an already-absent destination without throwing', async () => {
    const world = logsWorld({ destinations: [] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await expect(analyticsLogDestinationNode().delete(ctx)).resolves.toBeUndefined();
    expect(deliveryCalls(requests)).toStrictEqual(['deleteDest']);
  });
});

describe('analytics-log-delivery', () => {
  it('reads false when the shared source carries no delivery of its own, recording nothing', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await expect(analyticsLogDeliveryNode().read(ctx)).resolves.toBe(false);
    expect(deliveryCalls(requests)).toStrictEqual(['listDeliveries']);
    expect(ctx.state.resources).toStrictEqual({});
  });

  it('reads its own delivery off the shared source and hydrates it, never createdDay', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY, PLUGIN_DELIVERY] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await expect(analyticsLogDeliveryNode().read(ctx)).resolves.toBe(true);
    expect(deliveryCalls(requests)).toStrictEqual(['listDeliveries']);
    // `DescribeDeliveries` reports no creation date, so a delivery found
    // already attached leaves the backfill bound absent rather than fabricated
    // at today's date - which would be a bound that had moved later.
    expect(ctx.state.resources['analytics-log-delivery']).toStrictEqual({
      source: SITE_DELIVERY_SOURCE,
      destination: LOG_DESTINATION_ARN,
      distribution: DISTRIBUTION_ARN,
      delivery: 'configured',
    });
  });

  it('leaves a createdDay already in state alone when it hydrates', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY, PLUGIN_DELIVERY] });
    const { ctx } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    ctx.record('analytics-log-delivery', { createdDay: '2024-05-06' });
    await analyticsLogDeliveryNode().read(ctx);
    expect(ctx.state.resources['analytics-log-delivery']?.['createdDay']).toBe('2024-05-06');
  });

  it("creates the delivery on the site's source with schema.ts's fields, and no putDeliverySource", async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [LOG_DESTINATION] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await analyticsLogDeliveryNode().create(withLogDestination(ctx));

    expect(deliveryCalls(requests)).toStrictEqual(['createDelivery']);
    expect(deliveryCalls(requests)).not.toContain('putSource');
    expect(requests[0]?.url).toBe(LOGS_ENDPOINT);
    // `toStrictEqual`, so an added key fails: `fieldDelimiter` is deliberately
    // absent, because AWS applies it only to a `plain`/`w3c`/`raw` delivery and
    // this one is `json` - the format the transform Lambda's `JSON.parse` needs.
    expect(requests[0]?.body).toStrictEqual({
      deliverySourceName: SITE_DELIVERY_SOURCE,
      deliveryDestinationArn: LOG_DESTINATION_ARN,
      recordFields: [...CLOUDFRONT_RECORD_FIELDS],
    });
    // The selection is `schema.ts`'s, not a list restated in `nodes.ts`: these
    // spot checks pin the two exclusions and the two derivation-only inputs
    // that make it that file's list rather than any other.
    const fields = [...CLOUDFRONT_RECORD_FIELDS];
    expect(fields).toContain('c-ip');
    expect(fields).toContain('timestamp(ms)');
    expect(fields).not.toContain('cs(Cookie)');
    expect(fields).not.toContain('x-forwarded-for');
    // The site's delivery is untouched and its own is now beside it.
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d', 'd-1']);
  });

  it('records the UTC day the delivery was created, in a pinned non-UTC zone', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [LOG_DESTINATION] });
    const { ctx } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    // **The zone is pinned, not inherited.** An instant late in the UTC day
    // separates a UTC derivation from a local one only where the host sits east
    // of Greenwich: on a `TZ=UTC` CI runner - the case this assertion has to
    // hold in, because that is where it runs unattended - the two days coincide
    // and a local-time derivation would pass it untouched. Pinned to
    // `Asia/Kolkata`, which is UTC+5:30 the whole year round so no DST
    // transition can move it, the separation holds on every host.
    // Restored by name rather than by deleting the key, which the host may
    // never have set: `Intl` reports the zone the runtime resolved, so putting
    // that back leaves every later test on the zone it would have had.
    const hostTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = 'Asia/Kolkata';
    let dayWhileCreating = '';
    vi.useFakeTimers();
    try {
      // 05:15 on 2026-09-01 in the pinned zone; 23:45 on 2026-08-31 in UTC.
      vi.setSystemTime(new Date('2026-08-31T23:45:00Z'));
      dayWhileCreating = localDay(new Date());
      await analyticsLogDeliveryNode().create(withLogDestination(ctx));
    } finally {
      vi.useRealTimers();
      process.env.TZ = hostTz;
    }
    // The pin carries the whole guard, so it is asserted rather than assumed:
    // were a runtime to stop honouring a mid-process `TZ` change, this test
    // would quietly go back to proving nothing and this line is what says so.
    expect(dayWhileCreating).toBe('2026-09-01');
    expect(ctx.state.resources['analytics-log-delivery']).toStrictEqual({
      source: SITE_DELIVERY_SOURCE,
      destination: LOG_DESTINATION_ARN,
      distribution: DISTRIBUTION_ARN,
      delivery: 'configured',
      createdDay: '2026-08-31',
    });
  });

  it('never advances createdDay when the delivery is created again', async () => {
    // A bound that moved later would let task 61's backfill insert days
    // Firehose had already delivered, doubling every row in them.
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [LOG_DESTINATION] });
    const { ctx } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    ctx.record('analytics-log-delivery', { createdDay: '2020-01-01' });
    await analyticsLogDeliveryNode().create(withLogDestination(ctx));
    await analyticsLogDeliveryNode().create(ctx);
    expect(ctx.state.resources['analytics-log-delivery']?.['createdDay']).toBe('2020-01-01');
  });

  it("never advances createdDay through the destination's Conflict retry", async () => {
    // The retry deletes this delivery so the destination can be replaced, and
    // the next reconcile re-creates it. The bound must survive that untouched.
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [LOG_DESTINATION] });
    const { ctx } = makeContext([stream('ACTIVE')], { site: BOOTSTRAPPED_SITE, logs: world });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-03-04T00:00:00Z'));
      await analyticsLogDeliveryNode().create(withLogDestination(withRecordedStream(ctx)));
      expect(ctx.state.resources['analytics-log-delivery']?.['createdDay']).toBe('2026-03-04');

      // Weeks later, a stale destination forces the retry.
      vi.setSystemTime(new Date('2026-04-20T00:00:00Z'));
      world.putFailures = [{ code: 'ConflictException', message: 'stale destination' }];
      await analyticsLogDestinationNode().create(ctx);
      // The retry removed this plugin's delivery, so `read` sees it gone and
      // the same reconcile pass re-creates it.
      await expect(analyticsLogDeliveryNode().read(ctx)).resolves.toBe(false);
      await analyticsLogDeliveryNode().create(ctx);
    } finally {
      vi.useRealTimers();
    }
    expect(ctx.state.resources['analytics-log-delivery']?.['createdDay']).toBe('2026-03-04');
    expect(world.deliveries.map((delivery) => delivery.id)).toStrictEqual(['site-d', 'd-2']);
  });

  it('refuses before any AWS call when the site has not been bootstrapped', async () => {
    const { ctx, requests } = makeContext([], { logs: logsWorld() });
    await expect(analyticsLogDeliveryNode().create(withLogDestination(ctx))).rejects.toThrow(
      'run `blogwright bootstrap test` first',
    );
    await expect(analyticsLogDeliveryNode().create(ctx)).rejects.toThrow(
      /cloudfront-distribution has no recorded ARN/,
    );
    expect(requests).toStrictEqual([]);
  });

  it('refuses before any AWS call when no delivery source name was derived', async () => {
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: logsWorld() });
    const sourceless: PluginContext<AnalyticsConfig> = {
      ...ctx,
      names: { ...ctx.names, deliverySource: '' },
    };
    await expect(analyticsLogDeliveryNode().create(withLogDestination(sourceless))).rejects.toThrow(
      /no delivery source name was derived/,
    );
    expect(requests).toStrictEqual([]);
  });

  it('refuses before any AWS call when the destination ARN is not recorded', async () => {
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: logsWorld() });
    await expect(analyticsLogDeliveryNode().create(ctx)).rejects.toThrow(
      /analytics-log-destination/,
    );
    expect(requests).toStrictEqual([]);
  });

  it("leaves the site's CloudWatch delivery listed and undeleted once its own exists", async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [LOG_DESTINATION] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await analyticsLogDeliveryNode().create(withLogDestination(ctx));
    // The read re-lists the shared source, which is `deliveriesForSource` itself.
    await expect(analyticsLogDeliveryNode().read(ctx)).resolves.toBe(true);
    expect(world.deliveries).toStrictEqual([
      SITE_DELIVERY,
      { id: 'd-1', deliveryDestinationArn: LOG_DESTINATION_ARN },
    ]);
    expect(deliveryCalls(requests)).toStrictEqual(['createDelivery', 'listDeliveries']);
    expect(deliveryCalls(requests)).not.toContain('deleteDelivery:site-d');
    expect(deliveryCalls(requests)).not.toContain('deleteSource');
    expect(world.sourcePresent).toBe(true);
  });

  it('deletes only its own delivery, never the shared source', async () => {
    // The site's delivery is listed FIRST, so a teardown taking whichever
    // delivery AWS lists first - which is what `findDeliveryIdBySource` does -
    // would remove the site's instead of its own.
    const world = logsWorld({ deliveries: [SITE_DELIVERY, PLUGIN_DELIVERY] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await expect(analyticsLogDeliveryNode().delete(ctx)).resolves.toBeUndefined();
    expect(deliveryCalls(requests)).toStrictEqual(['listDeliveries', 'deleteDelivery:analytics-d']);
    expect(deliveryCalls(requests)).not.toContain('deleteSource');
    expect(world.deliveries).toStrictEqual([SITE_DELIVERY]);
    expect(world.sourcePresent).toBe(true);
  });

  it('is re-runnable when its delivery is already gone', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await expect(analyticsLogDeliveryNode().delete(ctx)).resolves.toBeUndefined();
    expect(deliveryCalls(requests)).toStrictEqual(['listDeliveries']);
    expect(world.deliveries).toStrictEqual([SITE_DELIVERY]);
  });

  it('leaves a delivery it cannot attribute exactly where it found it', async () => {
    // The `?? ''` fallback in `deliveriesForSource` is fail-closed here too: a
    // delivery AWS reports without a destination ARN matches no name, so it is
    // not this plugin's and is not removed on a guess.
    const unattributable = { id: 'unknown-d', deliveryDestinationArn: '' };
    const world = logsWorld({ deliveries: [unattributable, SITE_DELIVERY, PLUGIN_DELIVERY] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    await analyticsLogDeliveryNode().delete(ctx);
    expect(deliveryCalls(requests)).toStrictEqual(['listDeliveries', 'deleteDelivery:analytics-d']);
    expect(world.deliveries).toStrictEqual([unattributable, SITE_DELIVERY]);
  });
});

describe('tearing the vended-delivery chain down', () => {
  /** The chain in `dependsOn` order; `destroyGraph` walks the reverse. */
  const CHAIN = [analyticsLogDestinationNode(), analyticsLogDeliveryNode()];

  it('removes the delivery, then the destination, and never the shared source', async () => {
    // The delivery has to go first: AWS rejects `DeleteDeliveryDestination`
    // while a delivery still points at it - the fake rejects it too - so the
    // reverse walk is what makes this teardown work at all. That is the
    // ordering `packages/cli/src/nodes.ts:763-768` documents for the site's own
    // trio, expressed here as an edge between two nodes. `destroyGraph` lives
    // in the CLI package, which this one cannot import, so the reverse walk is
    // spelled out.
    const world = logsWorld({
      deliveries: [SITE_DELIVERY, PLUGIN_DELIVERY],
      destinations: [SITE_DELIVERY_DESTINATION, LOG_DESTINATION],
    });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    for (const node of [...CHAIN].reverse()) {
      await expect(node.delete(ctx)).resolves.toBeUndefined();
    }
    expect(deliveryCalls(requests)).toStrictEqual([
      'listDeliveries',
      'deleteDelivery:analytics-d',
      'deleteDest',
    ]);
    expect(deliveryCalls(requests)).not.toContain('deleteSource');
    // Everything the site owns is exactly as it was.
    expect(world.deliveries).toStrictEqual([SITE_DELIVERY]);
    expect(world.destinations).toStrictEqual([SITE_DELIVERY_DESTINATION]);
    expect(world.sourcePresent).toBe(true);
  });

  it('is re-runnable once the whole chain is gone', async () => {
    const world = logsWorld({ deliveries: [SITE_DELIVERY], destinations: [] });
    const { ctx, requests } = makeContext([], { site: BOOTSTRAPPED_SITE, logs: world });
    for (const node of [...CHAIN].reverse()) {
      await expect(node.delete(ctx)).resolves.toBeUndefined();
    }
    expect(deliveryCalls(requests)).toStrictEqual(['listDeliveries', 'deleteDest']);
    expect(world.deliveries).toStrictEqual([SITE_DELIVERY]);
  });

  it("raises on a derived destination name over the service's limit, before any call", async () => {
    // Long enough that the derived destination name overruns 60, short enough
    // that `deriveNames`' own 63-char check on the site bucket does not fire
    // first - the guard under test is this module's, not core's.
    const longName = 'a'.repeat(45);
    const { ctx, requests } = makeContext([], {
      config: { siteName: longName },
      site: BOOTSTRAPPED_SITE,
      logs: logsWorld(),
    });
    await expect(analyticsLogDestinationNode().delete(ctx)).rejects.toThrow(
      /derived analytics log delivery destination name .* over AWS's 60-character limit/,
    );
    expect(requests).toStrictEqual([]);
  });
});
