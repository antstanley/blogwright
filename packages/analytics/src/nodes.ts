/**
 * The analytics plugin's resource graph. It owns the AWS resources the
 * CloudFront-logs-to-Iceberg pipeline is built from and nothing else: the
 * site's own bucket, distribution and log group stay in the CLI's graph
 * (`packages/cli/src/nodes.ts`) and are never touched from here. This module
 * carries all fourteen of them, in four chains. The table chain - the S3 Tables bucket,
 * the namespace inside it, the `page_views` table, and the Glue federation
 * Firehose reads that table through - runs `analytics-table-bucket` ->
 * `analytics-namespace` -> `analytics-table` ->
 * `analytics-catalog-integration`. The transform chain - the long-lived
 * `visitor_key` salt, the log group the function's own output lands in, the
 * Lambda execution role whose policy names that secret's ARN, and the
 * record-transform function itself - runs `analytics-salt-secret` ->
 * `analytics-transform-role` -> `analytics-transform-function`, with
 * `analytics-transform-log-group` a second edge into that function. The
 * delivery chain - the bucket every record Firehose cannot deliver lands in,
 * the log group Firehose's delivery errors land in, the role it assumes, and
 * the stream itself - runs `analytics-error-bucket` ->
 * `analytics-firehose-role` -> `analytics-firehose-stream`, with
 * `analytics-firehose-log-group` a second edge into that stream, and joins the
 * other two chains through the role's five grants and the stream's
 * destination. The vended-delivery chain -
 * the CloudWatch delivery destination pointing at that stream and the delivery
 * joining it to the site's log source - runs `analytics-log-destination` ->
 * `analytics-log-delivery` and hangs off the stream. All four are wired through
 * `dependsOn`, and a node depends on every node whose recorded ARN it
 * interpolates - plus the two writers whose log group has to exist before the
 * first line they write, which is an ordering with nothing read back. {@link buildAnalyticsNodes} at the foot of this module returns
 * the assembled set, and `plugin.ts` hands it to the SPI's `Plugin.nodes`;
 * assembling an array is all it does - nothing here reconciles anything.
 *
 * **The delivery source the last chain hangs off is the site's, and this module
 * only ever reads it.** AWS permits exactly one delivery source per
 * distribution, so the site's CloudWatch delivery and this plugin's Firehose
 * delivery necessarily share one, and `packages/cli/src/nodes.ts`'s
 * `logDeliveryNode` owns it. Nothing here calls `putDeliverySource` or
 * `deleteDeliverySource`; the source's name is read off `ctx.names` and the
 * evidence that the site has been bootstrapped off `ctx.siteState`, the SPI's
 * read-only view of the site's state.
 *
 * **Everything in this graph is created in `us-east-1`, whatever
 * `config.region` says.** CloudFront standard logging accepts a Firehose
 * delivery stream only in that region, so the whole pipeline - and therefore
 * the table the stream writes into - has to live there too. The pin is
 * enforced in exactly one place, `aws/clients.ts`, which builds every client
 * over the host's `signingUsEast1` signer; no node here picks a region for a
 * request. {@link ANALYTICS_REGION} below is the same region as *text*, needed
 * only because an ARN spells its region out and because every node `title`
 * states the pin, so the bootstrap output an operator reads carries it. Twelve
 * of the fourteen titles state it as the region they are created in; the two IAM
 * role nodes state it as the pipeline they serve, because IAM is global and
 * "created in us-east-1" is not a property a role has (§Region pinning says so
 * in as many words) - a title claiming otherwise would be the pin stated
 * falsely rather than stated.
 *
 * The nodes are core's {@link ResourceNode} over {@link PluginContext}, so the
 * CLI's own engine (`topoSort`/`applyGraph`/`destroyGraph`,
 * `packages/cli/src/graph.ts`) reconciles them unchanged - this package
 * contributes nodes, never a second engine.
 *
 * **Creating the namespace and the table through the S3 Tables control-plane
 * API is a supported Firehose source.** Verified 2026-07-26 against AWS's S3
 * Tables + Firehose walkthrough, which creates both with `aws s3tables
 * create-namespace` and `aws s3tables create-table` and then points the
 * delivery stream at them. This is worth recording because Firehose's
 * considerations page carries a limitation that reads as if it forbids exactly
 * that - "only tables created through Iceberg's GlueCatalog API". That
 * limitation applies to plain Iceberg-on-S3 tables registered in Glue, not to
 * S3 Tables reached through the `s3tablescatalog` federation
 * (`analytics-catalog-integration`), which is how this pipeline reaches them.
 * Without this note the next reader re-litigates it.
 */

import { join } from 'node:path';

import {
  AwsError,
  pollUntil,
  REPRODUCIBLE_ZIP_MTIME,
  withRetry,
  type DeliveryOutputFormat,
  type DeliverySummary,
  type LogsClient,
  type PluginContext,
  type ResourceNode,
  type ResourceOutputs,
  type S3Client,
  type SecretsManagerClient,
} from 'blogwright-core';
import { zipSync } from 'fflate';

import { createAnalyticsClients } from './aws/clients.js';
import {
  STREAM_APPEND_ONLY,
  type DeliveryStreamStatus,
  type FirehoseClient,
  type IcebergDestinationInput,
} from './aws/firehose.js';
import type { CatalogFederation, GlueClient } from './aws/glue.js';
import type { FunctionConfigurationInput, LambdaClient } from './aws/lambda.js';
import type {
  IcebergSchemaField,
  IcebergTableSchema,
  PartitionTransform,
  S3TablesClient,
} from './aws/s3tables.js';
import { resolveAnalyticsConfig, type AnalyticsConfig } from './config.js';
import { ANALYTICS_PACKAGE_DIR } from './paths.js';
import {
  CLOUDFRONT_RECORD_FIELDS,
  PAGE_VIEWS_COLUMNS,
  PAGE_VIEWS_PARTITION_COLUMN,
} from './schema.js';
import { SALT_SECRET_NAME_ENV } from './transform/handler.js';
import {
  TRANSFORM_BUNDLE_DIR,
  TRANSFORM_BUNDLE_FILE,
  TRANSFORM_LAMBDA_HANDLER,
  TRANSFORM_MANIFEST_FILE,
  transformZipKey,
} from './transform-hash.js';

/**
 * The context every node in this module runs against: core's `PluginContext`
 * narrowed to this plugin's own validated config block, which is what makes
 * {@link resolveAnalyticsConfig} reachable from a node. `ResourceNode`'s own
 * parameter is unconstrained (see core's `plugin.ts`), and the SPI's
 * `Plugin.nodes` returns the bare `ResourceNode[]`; a node typed here is
 * assignable to that, because `read`/`create`/`delete` are method-declared and
 * therefore bivariant in their parameter type.
 */
type AnalyticsContext = PluginContext<AnalyticsConfig>;

/** One node of the analytics graph. */
type AnalyticsNode = ResourceNode<AnalyticsContext>;

/** The `analytics-table-bucket` node id, shared by its `id`, its state key and the edge into it. */
const TABLE_BUCKET_NODE = 'analytics-table-bucket';

/** The `analytics-namespace` node id. */
const NAMESPACE_NODE = 'analytics-namespace';

/** The `analytics-table` node id. */
const TABLE_NODE = 'analytics-table';

/** The `analytics-catalog-integration` node id. */
const CATALOG_NODE = 'analytics-catalog-integration';

/** The `analytics-salt-secret` node id, shared by its `id`, its state key and the edge into it. */
const SALT_SECRET_NODE = 'analytics-salt-secret';

/**
 * The `analytics-transform-log-group` node id. The group the transform Lambda
 * writes its own output to, owned here rather than left to the implicit
 * creation Lambda would otherwise do on first invocation - which is what makes
 * its retention a property at all.
 */
const TRANSFORM_LOG_GROUP_NODE = 'analytics-transform-log-group';

/** The `analytics-transform-role` node id. */
const TRANSFORM_ROLE_NODE = 'analytics-transform-role';

/** The `analytics-transform-function` node id. */
const TRANSFORM_FUNCTION_NODE = 'analytics-transform-function';

/** The `analytics-error-bucket` node id, shared by its `id`, its state key and the edge into it. */
const ERROR_BUCKET_NODE = 'analytics-error-bucket';

/**
 * The `analytics-firehose-log-group` node id. The group Firehose writes its
 * delivery errors to, and the one node in this module that owns a log stream as
 * well as a group: enabling error logging through the API requires both to
 * exist in advance.
 */
const FIREHOSE_LOG_GROUP_NODE = 'analytics-firehose-log-group';

/** The `analytics-firehose-role` node id. */
const FIREHOSE_ROLE_NODE = 'analytics-firehose-role';

/**
 * The `analytics-firehose-stream` node id. Exported, alone among the fourteen,
 * because `analytics status` reads this node's recorded outputs back out of
 * the scoped state its `read` hydrated - the stream's delivery health - and a
 * second copy of the string in `commands.ts` would be a state key with two
 * homes.
 */
export const FIREHOSE_STREAM_NODE = 'analytics-firehose-stream';

/** The `analytics-log-destination` node id. */
const LOG_DESTINATION_NODE = 'analytics-log-destination';

/**
 * The `analytics-log-delivery` node id. Exported for `backfill.ts`, which
 * reads {@link CREATED_DAY_KEY} out of this node's recorded outputs: the
 * backfill's idempotency bound and the node that writes it must name the same
 * state entry, and a second spelling of the id is the one way that could stop
 * being true without anything noticing.
 */
export const LOG_DELIVERY_NODE = 'analytics-log-delivery';

/**
 * The Glue catalog the S3 Tables integration registers itself under. The one
 * name in this module that carries neither the environment nor the site, and
 * deliberately: AWS's integration procedure creates exactly one catalog called
 * `s3tablescatalog` per account and Region, and every S3 Tables table in the
 * account is reached through it. A per-environment name derived here would not
 * buy a second, private integration - it would create a catalog the S3 Tables
 * integration itself never populates.
 */
const CATALOG_NAME = 's3tablescatalog';

/**
 * The bucket segment of {@link federationSource}: the wildcard naming every
 * table bucket in the account and Region rather than this environment's one.
 * Named rather than inlined so it does not read as a stray character in an ARN.
 */
const ALL_TABLE_BUCKETS = '*';

/**
 * The region every resource in this graph is created in - see the module
 * comment. This constant is *not* what enforces the pin: `aws/clients.ts`
 * does that, by building every client over `ctx.clients.signingUsEast1`. It
 * exists because an ARN carries its region as text and `SigningClient` does
 * not expose the region it signs in, so a node that has to name an ARN has to
 * name the region too - and, since task 54, because every node's `title` states
 * the pin out loud, which is how `applyGraph`'s `create <title>` lines carry
 * the divergence from `config.region` into the bootstrap output an operator
 * reads. Two different tests in `nodes.test.ts` pin the two
 * halves and they are not interchangeable. The credential-scope assertion
 * ("signs every call against us-east-1 while config.region says otherwise")
 * reads the region back out of the SigV4 `Authorization` header, so it catches
 * the *clients* drifting off the pin - but it is blind to this constant, and
 * stays green if only this string changes, because a signed region is not an
 * ARN. What catches that is every assertion that spells an S3 Tables bucket ARN
 * out - the recorded request URLs, the recorded outputs, and the account-wide
 * wildcard the catalog federation is registered over: setting this to
 * `eu-west-1` reddens nineteen tests while the credential-scope test passes.
 */
const ANALYTICS_REGION = 'us-east-1';

/**
 * Iceberg numbers schema fields from 1, so the nth column of
 * `PAGE_VIEWS_COLUMNS` takes id n. See {@link pageViewsFields} for why the
 * caller assigns ids at all.
 */
const FIRST_FIELD_ID = 1;

/**
 * The transform the `page_views` partition applies to
 * `PAGE_VIEWS_PARTITION_COLUMN`. `identity`, not Iceberg's `day` transform:
 * `day` is already a `date` column that the transform Lambda computes from
 * CloudFront's `timestamp(ms)` (`schema.ts`'s `DERIVED_COLUMNS`), so the
 * partition value *is* the column value. Iceberg's `day` transform truncates a
 * timestamp to a date, and would be right only if the table partitioned on
 * `event_time` instead. This is a fact about the S3 Tables API's partition
 * vocabulary rather than about the table's columns, which is why it lives here
 * and not in `schema.ts`.
 */
const PARTITION_TRANSFORM: PartitionTransform = 'identity';

/**
 * Record outputs under `nodeId` and hand back the live object, so a node
 * records each identifier *as* its resource is created rather than after the
 * chain completes - the discipline `packages/cli/src/nodes.ts:713-719` states
 * and `packages/cli/src/nodes.ts:20-22` provides for the site's own nodes. A
 * crash between two calls must still leave what was already created recorded
 * in state for `destroy` to clean up.
 *
 * Unlike the CLI's helper this writes through `ctx.record`, which the SPI names
 * as the only way a plugin's nodes may record outputs (core's `plugin.ts`),
 * rather than assigning into `ctx.state.resources` behind its back. An existing
 * entry is re-recorded rather than replaced, so a second call in the same run
 * adds to what the first one wrote instead of dropping it.
 *
 * The handle is read back out of `state` rather than returned directly. The
 * host that fills `record` today stores the object it is handed
 * (`packages/cli/src/plugin-commands.ts`'s `toPluginContext`), which makes the
 * two the same object - but one that stored a copy would leave every later
 * write landing on an orphan and silently record nothing. The read-back costs
 * a lookup and removes that dependency; `noUncheckedIndexedAccess` is why the
 * `??` is spelled twice rather than once.
 *
 * Called only where a value is about to be written. A `read` that finds
 * nothing must not call it: doing so would leave an empty entry in
 * `state/<env>.analytics.json` for a resource that does not exist.
 */
function output(ctx: AnalyticsContext, nodeId: string): ResourceOutputs {
  const outputs = ctx.state.resources[nodeId] ?? {};
  ctx.record(nodeId, outputs);
  return ctx.state.resources[nodeId] ?? outputs;
}

/**
 * The plugin's own S3 Tables client. Built through
 * {@link createAnalyticsClients}, never lifted off `ctx.clients`, which
 * enumerates only core's own services and signs them in `config.region`.
 */
function s3tables(ctx: AnalyticsContext): S3TablesClient {
  return createAnalyticsClients(ctx).s3tables;
}

/**
 * The plugin's own Glue client, built the same way {@link s3tables} is and for
 * the same reason: core's bundle enumerates no `glue` service at all, and the
 * one it does expose signs in `config.region`.
 */
function glue(ctx: AnalyticsContext): GlueClient {
  return createAnalyticsClients(ctx).glue;
}

/**
 * The table bucket's ARN, in the fixed
 * `arn:aws:s3tables:<region>:<accountId>:bucket/<name>` form. Derived rather
 * than read back from the API because `getTableBucket` is ARN-keyed with no
 * name-based lookup and `createTableBucket` deliberately returns no ARN
 * (`aws/s3tables.ts`): a caller has to compute this before it can make either
 * call, so there is nothing to hydrate it from.
 *
 * The name comes from {@link resolveAnalyticsConfig}, the only route to it -
 * `ctx.pluginConfig.tableBucket` does not compile, because the default carries
 * the environment and a bucket name derived without one makes staging and
 * production resolve to the same Iceberg table. `config.ts` owns that rule and
 * the test for it.
 */
function tableBucketArn(ctx: AnalyticsContext): string {
  return s3TablesBucketArn(ctx, resolveAnalyticsConfig(ctx).tableBucket);
}

/**
 * An S3 Tables bucket ARN, in the fixed
 * `arn:aws:s3tables:<region>:<accountId>:bucket/<bucket>` form - the one place
 * that form is spelled. {@link tableBucketArn} passes this environment's bucket
 * name and {@link federationSource} passes {@link ALL_TABLE_BUCKETS}; the two
 * have to agree on everything left of the last segment, because the catalog
 * federation is checked against the wildcard form of the very ARN the table
 * bucket is created under.
 */
function s3TablesBucketArn(ctx: AnalyticsContext, bucket: string): string {
  return `arn:aws:s3tables:${ANALYTICS_REGION}:${ctx.accountId}:bucket/${bucket}`;
}

/**
 * `PAGE_VIEWS_COLUMNS` in the shape `createTable` accepts, so no column name,
 * type or ordering is spelled a second time in this module.
 *
 * The ids are this function's own contribution, and it has to make one:
 * `IcebergSchemaField.id` is optional in the S3 Tables API (auto-assigned when
 * omitted) but required by the client, because the partition spec references a
 * schema field by id and both travel in the same `CreateTable` request - an
 * auto-assigned id would not exist yet for `sourceId` to name.
 *
 * The assignment is positional: the nth column of `PAGE_VIEWS_COLUMNS` gets id
 * n, counting from {@link FIRST_FIELD_ID}. That is stable because
 * `PAGE_VIEWS_COLUMNS` is an ordered `as const` tuple in the spec's own column
 * order, so the same source always produces the same ids. Appending a column
 * leaves every existing id untouched; reordering or removing one renumbers the
 * columns after it, which is harmless here because the ids only ever have to
 * agree *within one* `CreateTable` request - S3 Tables has no update-schema
 * operation this payload is ever compared against, and an already-existing
 * table's schema is not reconciled (`aws/s3tables.ts`'s `createTable`).
 */
function pageViewsFields(): IcebergSchemaField[] {
  return PAGE_VIEWS_COLUMNS.map((column, index) => ({
    name: column.name,
    type: column.icebergType,
    id: index + FIRST_FIELD_ID,
    required: column.required,
  }));
}

/**
 * The `page_views` schema and partition spec, both derived from `schema.ts`.
 * `fieldId` is left off the partition field: it is optional in the API and
 * auto-assigned, and nothing in this request or any later one references it,
 * so synthesising a second id would add a number with no reader.
 */
function pageViewsSchema(): IcebergTableSchema {
  const fields = pageViewsFields();
  const partitionSource = fields.find((field) => field.name === PAGE_VIEWS_PARTITION_COLUMN);
  if (partitionSource === undefined) {
    // Unreachable while `PAGE_VIEWS_PARTITION_COLUMN` is typed as a
    // `PageViewColumnName`, which is derived from `PAGE_VIEWS_COLUMNS`. Raised
    // rather than allowed to fall through to `sourceId: 0`, which would create
    // a table partitioned on whatever field id 0 turned out to mean.
    throw new Error(
      `analytics table schema has no "${PAGE_VIEWS_PARTITION_COLUMN}" column to partition by - PAGE_VIEWS_COLUMNS and PAGE_VIEWS_PARTITION_COLUMN in schema.ts have diverged`,
    );
  }
  return {
    fields,
    partitionSpec: [
      {
        name: partitionSource.name,
        sourceId: partitionSource.id,
        transform: PARTITION_TRANSFORM,
      },
    ],
  };
}

/**
 * Record the table bucket's identity. Shared by `read` and `create` because
 * both record the same two values from the same two sources: the resolved
 * config and {@link tableBucketArn}. `getTableBucket`'s response cannot
 * disagree with either - the lookup is keyed by that very ARN - so the read
 * path gains nothing by echoing the response back instead.
 */
function recordTableBucket(ctx: AnalyticsContext): void {
  const out = output(ctx, TABLE_BUCKET_NODE);
  out.name = resolveAnalyticsConfig(ctx).tableBucket;
  out.arn = tableBucketArn(ctx);
}

/** Record the namespace's identity - its name and the bucket it lives in, which is all a namespace is. */
function recordNamespace(ctx: AnalyticsContext): void {
  const out = output(ctx, NAMESPACE_NODE);
  out.name = resolveAnalyticsConfig(ctx).namespace;
  out.tableBucketArn = tableBucketArn(ctx);
}

/**
 * The S3 Tables resource the catalog federates: **every** table bucket in this
 * account and Region, which is what AWS's own integration procedure registers
 * and what makes the catalog shared rather than this environment's own.
 *
 * Passing {@link tableBucketArn} here instead would look tidier and would break
 * the one thing this node exists to get right. A federation registered against
 * one environment's bucket is not one the next environment can adopt: staging
 * would find a catalog federating production's bucket, and either adopt a
 * federation that does not cover its own table or try to register a second one
 * under the same account-scoped name. Every environment in the account derives
 * this identical string, which is why two of them converge on one catalog
 * instead of fighting over it.
 */
function federationSource(ctx: AnalyticsContext): string {
  return s3TablesBucketArn(ctx, ALL_TABLE_BUCKETS);
}

/**
 * The federation's source, checked against the one this account's pipeline has
 * to be federated on - and a throw when it is not.
 *
 * This is the check that stops a successful *lookup* from standing in for a
 * working *federation*. `EntityNotFoundException` is documented on both of
 * `GlueClient`'s operations and means two different things. On `GetCatalog` it
 * is "no such catalog" - but a **source-level** miss answers with it too (the
 * S3 Tables resource the catalog federates does not exist, typically a wrong
 * ARN), and `getCatalogFederation` maps both to `undefined`. So a federation
 * that is broken at its source reads as one that is absent; `create` then runs,
 * and `createCatalogFederation` swallows `FederatedResourceAlreadyExistsException`
 * because a second environment genuinely must adopt what is there. Left
 * unchecked the reconcile converges silently: `analytics bootstrap` reports the
 * integration green over a federation that was never wired to a bucket, and the
 * first symptom is Firehose routing every record to the error bucket.
 *
 * `CatalogFederation.sourceIdentifier` is what closes it, and is a required key
 * of type `string | undefined` for this reason: it is `undefined` exactly when
 * the catalog carries no `FederatedCatalog` at all, so a same-named catalog
 * that is not federated, or is federated somewhere else, is distinguishable
 * from this plugin's own. Both of the node's paths run through here - an
 * adopted catalog is verified before it is recorded, and a created one is read
 * back and verified rather than assumed - so no path records this node as
 * satisfied on a catalog whose source was never checked.
 *
 * Only the source is checked, not `connectionName`. The source ARN is what
 * decides whether the federation covers this account's table buckets; a catalog
 * federating exactly those buckets through some connection other than
 * `aws:s3tables` is not a state AWS's integration can produce, so a second
 * condition would be a second way to fail with nothing new caught.
 */
function verifiedSource(ctx: AnalyticsContext, federation: CatalogFederation): string {
  const source = federationSource(ctx);
  if (federation.sourceIdentifier === source) return source;
  const found =
    federation.sourceIdentifier === undefined
      ? 'is not a federated catalog'
      : `federates "${federation.sourceIdentifier}"`;
  throw new Error(
    `Glue catalog "${federation.name}" ${found}, so it is not the S3 Tables integration this pipeline reads through - it has to federate "${source}". Adopting it would point Firehose at a catalog with no table behind it. Remove or rename that catalog, or enable the S3 Tables integration for this account and Region.`,
  );
}

/**
 * Record the adopted federation - after {@link verifiedSource} has passed, and
 * never before it. {@link output} writes an entry into
 * `state/<env>.analytics.json`, and an entry under this node's id is the claim
 * that the pipeline has a catalog to read the table through, so it must not
 * outlive the check that the catalog is the right one.
 */
function recordCatalogIntegration(ctx: AnalyticsContext, federation: CatalogFederation): void {
  const source = verifiedSource(ctx, federation);
  const out = output(ctx, CATALOG_NODE);
  out.name = federation.name;
  out.sourceIdentifier = source;
  // The same guard `analytics-table` puts on its ARN, for the same reason:
  // `normalizeCatalog` falls back to `''` for a body carrying no `ResourceArn`,
  // and an empty string recorded under `arn` reads downstream as a real one.
  if (federation.resourceArn) out.arn = federation.resourceArn;
}

/** The S3 Tables bucket every analytics table lives in. */
export function analyticsTableBucketNode(): AnalyticsNode {
  return {
    id: TABLE_BUCKET_NODE,
    dependsOn: [],
    title: 'S3 Tables bucket (us-east-1)',
    async read(ctx) {
      const bucket = await s3tables(ctx).getTableBucket(tableBucketArn(ctx));
      if (bucket === undefined) return false;
      recordTableBucket(ctx);
      return true;
    },
    async create(ctx) {
      await s3tables(ctx).createTableBucket(resolveAnalyticsConfig(ctx).tableBucket);
      recordTableBucket(ctx);
    },
    async delete(ctx) {
      // Already-gone is not an error: the client swallows the 404 so a
      // half-finished teardown is re-runnable.
      await s3tables(ctx).deleteTableBucket(tableBucketArn(ctx));
    },
  };
}

/** The Iceberg namespace inside the table bucket. */
export function analyticsNamespaceNode(): AnalyticsNode {
  return {
    id: NAMESPACE_NODE,
    dependsOn: [TABLE_BUCKET_NODE],
    title: 'S3 Tables namespace (us-east-1)',
    async read(ctx) {
      const namespace = await s3tables(ctx).getNamespace(
        tableBucketArn(ctx),
        resolveAnalyticsConfig(ctx).namespace,
      );
      if (namespace === undefined) return false;
      recordNamespace(ctx);
      return true;
    },
    async create(ctx) {
      await s3tables(ctx).createNamespace(
        tableBucketArn(ctx),
        resolveAnalyticsConfig(ctx).namespace,
      );
      recordNamespace(ctx);
    },
    async delete(ctx) {
      await s3tables(ctx).deleteNamespace(
        tableBucketArn(ctx),
        resolveAnalyticsConfig(ctx).namespace,
      );
    },
  };
}

/** The `page_views` table, carrying the schema and partition `schema.ts` owns. */
export function analyticsTableNode(): AnalyticsNode {
  return {
    id: TABLE_NODE,
    dependsOn: [NAMESPACE_NODE],
    title: 'Iceberg table (us-east-1)',
    async read(ctx) {
      const analytics = resolveAnalyticsConfig(ctx);
      const table = await s3tables(ctx).getTable(
        tableBucketArn(ctx),
        analytics.namespace,
        analytics.table,
      );
      if (table === undefined) return false;
      // The one identifier in this module that is genuinely unrecoverable from
      // its inputs: a table ARN carries an opaque generated id, not a name.
      const out = output(ctx, TABLE_NODE);
      out.name = table.name;
      // Guarded on the value, not just on the lookup having answered:
      // `normalizeTable` falls back to `''` for a body carrying no `tableARN`,
      // and an empty string recorded under `arn` reads downstream as a real
      // one. Unreachable under the service's response model; recording nothing
      // is the honest answer if it ever is reached.
      if (table.arn) out.arn = table.arn;
      return true;
    },
    async create(ctx) {
      const analytics = resolveAnalyticsConfig(ctx);
      const client = s3tables(ctx);
      const bucketArn = tableBucketArn(ctx);
      await client.createTable(bucketArn, analytics.namespace, analytics.table, pageViewsSchema());
      // Identity before the secondary call: `CreateTable` answers with no ARN,
      // so hydrating one takes a second request, and a crash in between must
      // still leave the table recorded for `destroy` to remove.
      const out = output(ctx, TABLE_NODE);
      out.name = analytics.table;
      const created = await client.getTable(bucketArn, analytics.namespace, analytics.table);
      // Same guard as `read`, for the same reason: an absent `tableARN`
      // normalizes to `''`, which must not land in state as though it were one.
      if (created?.arn) out.arn = created.arn;
    },
    async delete(ctx) {
      const analytics = resolveAnalyticsConfig(ctx);
      await s3tables(ctx).deleteTable(tableBucketArn(ctx), analytics.namespace, analytics.table);
    },
  };
}

/**
 * The Glue `s3tablescatalog` federation Firehose reads the `page_views` table
 * through - **the one node in this graph that adopts shared state rather than
 * owning it.**
 *
 * The integration is account-and-region scoped: a single catalog federates
 * every S3 Tables bucket in the account and Region (see
 * {@link federationSource}), so staging, production and anything else in the
 * account that enabled the S3 Tables integration all read through the same one.
 * Both halves of this node's behaviour follow from that. `read` adopts an
 * existing federation instead of creating a second one, so a second environment
 * converges on what is already there; `delete` removes nothing, so tearing one
 * environment down leaves every other environment's pipeline intact.
 *
 * It depends on `analytics-table` rather than on the bucket even though the
 * federation covers the account rather than any one table. Two reasons: the
 * whole table chain is then in place before anything is federated, so
 * `CreateCatalog`'s own `EntityNotFoundException` - which on that operation
 * means the federated entity is missing, not the catalog - cannot fire merely
 * because the bucket had not been created yet; and `destroyGraph` reverses the
 * order, so this node's `delete` is reached first, before the table it was
 * enabled for is removed.
 */
export function analyticsCatalogIntegrationNode(): AnalyticsNode {
  return {
    id: CATALOG_NODE,
    dependsOn: [TABLE_NODE],
    title: `Glue ${CATALOG_NAME} federation (shared - account-and-region scoped, ${ANALYTICS_REGION})`,
    async read(ctx) {
      const federation = await glue(ctx).getCatalogFederation(CATALOG_NAME);
      // Absent: `create` runs, and either creates the federation or adopts one
      // that appeared in between. A wrongly-federated or non-federated catalog
      // of this name is NOT absent - it fails inside `recordCatalogIntegration`
      // rather than falling through to a create that would be swallowed as a
      // duplicate.
      if (federation === undefined) return false;
      recordCatalogIntegration(ctx, federation);
      return true;
    },
    async create(ctx) {
      const client = glue(ctx);
      const source = federationSource(ctx);
      ctx.logger.step(
        `enabling the ${CATALOG_NAME} Glue federation over ${source} - account-and-region scoped, shared with every other environment in this account and never removed by a teardown`,
      );
      await client.createCatalogFederation(CATALOG_NAME, source);
      // Read back rather than assume. `createCatalogFederation` resolves both
      // when it created the federation and when one already existed - which is
      // what a second environment hits, deliberately - so its resolution says
      // nothing about what is now in the account. And the lookup that returned
      // "absent" just before it is exactly the shape a source-level
      // `EntityNotFoundException` takes, so this is the only place the two can
      // be told apart. See {@link verifiedSource}.
      const created = await client.getCatalogFederation(CATALOG_NAME);
      if (created === undefined) {
        throw new Error(
          `the ${CATALOG_NAME} Glue federation is still not readable after CreateCatalog reported success. GetCatalog answers EntityNotFoundException both for a missing catalog and for a federation whose own source is missing, so this is a catalog that was never wired to "${source}" rather than one that was just created - check that the S3 Tables integration is enabled for this account in ${ANALYTICS_REGION}.`,
        );
      }
      recordCatalogIntegration(ctx, created);
    },
    async delete() {
      // Deliberately inert, and the only `delete` in this graph that is.
      // `destroyGraph` calls every node's `delete` on teardown
      // (`packages/cli/src/graph.ts`), so anything written here would run on
      // every `analytics destroy`. The federation is account-and-region scoped
      // shared state: removing it while tearing down staging would leave
      // production's delivery stream with no catalog to write its Iceberg table
      // through, so production would go on accepting CloudFront logs and route
      // every record into its error bucket - with nothing in staging's output,
      // or production's, saying what had been taken away. The rule core already
      // states for the account-global OIDC provider it likewise never removes
      // (`packages/core/src/aws/iam.ts`, "Account-global; never deleted here").
      // `GlueClient` exposes no delete operation at all, which is the other half
      // of the guard: there is nothing here to call by accident.
    },
  };
}

/* ------------------------------------------------------------------------- *
 * The transform chain: the salt secret, the execution role, and the function.
 * ------------------------------------------------------------------------- */

/**
 * The suffix the transform Lambda's name carries, appended to
 * `ctx.names.prefix`. See {@link transformFunctionName} for why the prefix is
 * the source of the environment here and {@link resolveAnalyticsConfig} is not.
 */
const TRANSFORM_FUNCTION_SUFFIX = '-analytics-transform';

/** The suffix the transform Lambda's execution role carries. */
const TRANSFORM_ROLE_SUFFIX = '-analytics-transform-role';

/**
 * The longest name IAM accepts for a role - and, separately, the longest Lambda
 * accepts for a function. The two limits are the same number and are
 * deliberately two constants: they belong to two services and either could
 * move without the other.
 */
const ROLE_NAME_MAX_LENGTH = 64;

/** The longest name Lambda accepts for a function. See {@link ROLE_NAME_MAX_LENGTH}. */
const FUNCTION_NAME_MAX_LENGTH = 64;

/**
 * The Lambda runtime the transform is bundled for. Node, because the bundle is
 * this repo's own TypeScript compiled by rolldown to ESM
 * (`transform/rolldown.config.ts`); `22.x` because the package's `engines`
 * field declares `>=22` and the emitted bundle is checked against that
 * assumption by `transform/write-manifest.ts` on every build, running under the
 * developer's own Node.
 */
const TRANSFORM_RUNTIME = 'nodejs22.x';

/**
 * Memory for the transform, in MB. Lambda scales CPU with memory, and the
 * per-record work is CPU-bound rather than memory-bound - a JSON parse, a field
 * mapping, and one HMAC-SHA256 per record for `visitor_key` - so this number is
 * bought for the CPU share, not the heap. 256 doubles the 128 MB floor's share
 * for a fraction of a cent per million invocations; the whole batch a Firehose
 * transform invocation carries is bounded by Lambda's 6 MB synchronous payload
 * limit, which no amount of it can approach on a 256 MB heap.
 */
const TRANSFORM_MEMORY_MB = 256;

/**
 * The transform's timeout, in seconds. `aws/lambda.ts` records that the service
 * caps `Timeout` at 900; this is well inside it and is not chosen for headroom
 * against slow work but against a *stall*: Firehose invokes the transform
 * synchronously, so a function that hangs holds a delivery buffer open. One
 * minute is orders of magnitude more than mapping one buffer of small records
 * takes, and far less than the time an operator would spend not noticing.
 */
const TRANSFORM_TIMEOUT_SECONDS = 60;

/**
 * The largest deployment package Lambda accepts inline, in bytes.
 *
 * 50 MB, verified 2026-08-31 against Lambda's quotas page: "Deployment package
 * (.zip file archive) size - 50 MB (zipped, when uploaded through the Lambda
 * API or SDKs). Upload larger files with Amazon S3." That is the path
 * `CreateFunction`'s `Code.ZipFile` takes (`aws/lambda.ts` base64-encodes it),
 * and the arithmetic below is 1024-based because the same page states that
 * Lambda's documentation writes MB for 1,024 KB.
 *
 * **Why the code goes inline at all**, rather than through an S3 code bucket:
 * Lambda requires the code bucket to be in the *function's own* region. This
 * function is pinned to {@link ANALYTICS_REGION} (see the module comment) while
 * the site's bucket - the only bucket the CLI already owns and the only one a
 * deploy role is already granted on - is in `config.region`, which is
 * deliberately something else. An S3 code path would therefore mean a second
 * bucket in us-east-1 existing only to hold one zip, a second node to create
 * it, and a second grant; and the bundle is three orders of magnitude under
 * this limit. `analytics-error-bucket` is not that bucket either - it is
 * Firehose's failed-record output and is not a deploy artifact store.
 *
 * The guard below is a tripwire, not a budget: if the bundle ever grows past
 * this, the fix is the S3 code path, and the raise says so with the measured
 * size rather than letting AWS answer a 400 with the request body's length.
 */
const MAX_INLINE_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * The fixed timestamp every entry in the deployment package carries, so the
 * same bundle bytes always produce the same zip bytes - `packageAndUploadAgent`
 * uses the same one, for the same reason: a zip stamped with the current time
 * would differ on every build, and the deployment decision has to turn on task
 * 43's source hash rather than on whether two archives happen to compare equal.
 *
 * That sentence was false until this constant moved to core. The value here was
 * `new Date('1980-01-01T00:00:00Z')`, which a zip encodes as *local* time: it
 * threw `date not in range 1980-2099` west of Greenwich, and where it did not
 * throw it produced different bytes per zone - the opposite of the guarantee
 * claimed above. See {@link REPRODUCIBLE_ZIP_MTIME}.
 */
const ZIP_MTIME = REPRODUCIBLE_ZIP_MTIME;

/** The deflate level `packageAndUploadAgent` uses. */
const ZIP_LEVEL = 6;

/**
 * The prefix Lambda derives a function's log group from, and therefore the
 * prefix {@link transformLogGroupName} builds the one group this plugin owns
 * for its function from. `analytics-transform-log-group` creates that group; it
 * is not left to the implicit creation the Lambda service performs on a
 * function's first invocation, because a group created that way is retained
 * forever and carries none of the environment's tags.
 */
const LAMBDA_LOG_GROUP_PREFIX = '/aws/lambda/';

/** The name of the inline policy this plugin puts on its own transform role. */
const TRANSFORM_ROLE_POLICY = 'transform';

/** IAM's policy-language version, the only one there is. */
const POLICY_VERSION = '2012-10-17';

/**
 * Bytes of randomness in a freshly generated salt secret: 32, so the stored
 * seed is 256 bits - the width of the HMAC-SHA256 the transform derives each
 * day's salt with (`transform/visitor-key.ts`), so the seed is not the weak
 * half of that construction.
 */
const SALT_SECRET_BYTES = 32;

/**
 * The description stamped on the secret when this node creates it. It is
 * written for the operator who finds the secret in the Secrets Manager console
 * with no other context and is deciding whether it is safe to delete: the
 * answer is no, and the reason has to travel with the resource rather than live
 * only in this file.
 */
const SALT_SECRET_DESCRIPTION =
  'blogwright analytics: the long-lived seed the record-transform Lambda derives each day’s visitor_key salt from, as HMAC-SHA256(secret, day). Never rotate, replace or restore it from a different value - every visitor_key already written to the page_views table was derived from this seed, and a new one silently stops old rows comparing to new ones.';

/**
 * The trust document the transform's execution role is created with - the shape
 * `packages/cli/src/nodes.ts:106-115` declares as `LAMBDA_TRUST`, **restated
 * rather than imported, deliberately**.
 *
 * `LAMBDA_TRUST` is CLI-private: it is a module-level `const` in
 * `packages/cli/src/nodes.ts` with no export, and even were it exported a
 * plugin may not reach it. Core's `plugin.ts` states the rule this package
 * obeys - "a plugin is a package that depends on `blogwright-core` and never on
 * the CLI - it never imports from `blogwright` (the CLI package)". Core is no
 * home for it either: `IamClient.ensureRole` takes the document as an opaque
 * `object`, so a shared trust constant in core would be an export with no core
 * or CLI consumer, which `pnpm knip` reports as dead.
 *
 * So the two copies stand, and they are allowed to drift: this one names the
 * principal *this* function assumes, and the CLI's names the principal its
 * MicroVM builder assumes. Nothing reconciles one against the other, and
 * nothing should - a change to the site's builder trust is not a change to
 * this plugin's.
 */
const LAMBDA_TRUST = {
  Version: POLICY_VERSION,
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: ['sts:AssumeRole', 'sts:TagSession'],
    },
  ],
};

/**
 * The plugin's own Lambda client, built the same way {@link s3tables} and
 * {@link glue} are: core's bundle enumerates no `lambda` key at all (`microvms`
 * is a different API on the same host - see `aws/lambda.ts`), and every client
 * this plugin uses signs in {@link ANALYTICS_REGION}.
 */
function lambda(ctx: AnalyticsContext): LambdaClient {
  return createAnalyticsClients(ctx).lambda;
}

/**
 * The plugin's own Secrets Manager client - **not the host bundle's own copy**,
 * which core builds over the primary-region signer
 * (`packages/core/src/clients.ts:68`).
 *
 * This is the one client choice in the module where reaching for the host's
 * copy fails silently rather than loudly. The secret would be created in
 * `config.region`; the transform Lambda runs in {@link ANALYTICS_REGION}; and
 * the grant the role carries names an ARN that spells its region out
 * ({@link requireSaltSecretArn}), so the function's `GetSecretValue` would be
 * denied against a secret that exists, in a region no other node in this graph
 * is in. `aws/clients.ts` builds this one over `ctx.clients.signingUsEast1` for
 * exactly that reason.
 */
function secrets(ctx: AnalyticsContext): SecretsManagerClient {
  return createAnalyticsClients(ctx).secrets;
}

/**
 * Reject a derived AWS name longer than the service accepts, naming the
 * measured length rather than letting the service answer a validation error at
 * create time. The same guard `resolveAnalyticsConfig` puts on the derived
 * table bucket and `deriveNames` puts on the site bucket, applied where these
 * two names are derived.
 */
function boundedName(name: string, limit: number, what: string): string {
  if (name.length > limit) {
    throw new Error(
      `derived analytics ${what} name "${name}" is ${name.length} characters, over AWS's ${limit}-character limit; shorten env or siteName`,
    );
  }
  return name;
}

/**
 * The transform Lambda's name.
 *
 * Derived from `ctx.names.prefix` - core's own `<env>-<siteName>`
 * (`packages/core/src/config.ts:388`) - and **not** from
 * {@link resolveAnalyticsConfig}, because there is nothing there to resolve:
 * the `analytics` block owns six settings and neither this name nor the role's
 * is one of them (`config.ts`), so an operator has no override to honour. What
 * `config.ts`'s seal exists to prevent is a *private, env-less* derivation - a
 * `${ctx.config.siteName}-analytics-transform` that would make staging and
 * production reconcile the same function. This is the opposite: the
 * environment is the first thing in the string, and the derivation is core's
 * own, shared with every name the site graph already uses.
 */
function transformFunctionName(ctx: AnalyticsContext): string {
  return boundedName(
    `${ctx.names.prefix}${TRANSFORM_FUNCTION_SUFFIX}`,
    FUNCTION_NAME_MAX_LENGTH,
    'transform function',
  );
}

/** The transform Lambda's execution role name. See {@link transformFunctionName}. */
function transformRoleName(ctx: AnalyticsContext): string {
  return boundedName(
    `${ctx.names.prefix}${TRANSFORM_ROLE_SUFFIX}`,
    ROLE_NAME_MAX_LENGTH,
    'transform role',
  );
}

/**
 * The transform Lambda's log group name - **the one home this string has.**
 *
 * `analytics-transform-log-group` creates the group under this name and
 * {@link transformLogGroupArn} scopes the role's grant to the ARN built from
 * it, so the group that exists and the group the function is allowed to write
 * to are one string by construction rather than two literals that happen to
 * agree. Derived from {@link transformFunctionName} rather than re-derived from
 * `ctx.names.prefix` for the same reason: Lambda's own group name is that
 * function's name under {@link LAMBDA_LOG_GROUP_PREFIX}, so a second derivation
 * could name a group Lambda never writes to.
 */
function transformLogGroupName(ctx: AnalyticsContext): string {
  return `${LAMBDA_LOG_GROUP_PREFIX}${transformFunctionName(ctx)}`;
}

/**
 * The log group ARN the role's `logs:` grant is scoped to - the function's
 * **own** group and nothing else, the scoping the site's exec role applies
 * (`packages/cli/src/nodes.ts`).
 *
 * The region is {@link ANALYTICS_REGION} and not `ctx.config.region`, which is
 * the one place this ARN differs from the CLI's `logGroupArn` helper (whose
 * region parameter defaults to `ctx.config.region`, correctly, because the
 * function it scopes runs there). This function is pinned to us-east-1, so its
 * log group is too, and a grant naming the primary region would be a grant on a
 * group that never exists.
 *
 * **`analytics-transform-log-group` creates this group**, which is why the
 * policy below grants `logs:CreateLogStream` and `logs:PutLogEvents` and *not*
 * `logs:CreateLogGroup`: the role has nothing to create, the shape the site's
 * exec role has. An earlier version of this comment said no node creates the
 * group and that Lambda's implicit creation on the function's first invocation
 * was enough; production disproved it - the group never appeared, the transform
 * ran and reported nothing, and the pipeline's record-level signals (a record
 * the transform cannot map goes to Firehose's error prefix,
 * `transform/handler.ts`, and a batch that throws raises Firehose's own error
 * metric) answered *which* and never *why*.
 */
function transformLogGroupArn(ctx: AnalyticsContext): string {
  return analyticsLogGroupArn(ctx, transformLogGroupName(ctx));
}

/**
 * A log group's ARN in {@link ANALYTICS_REGION}, in the `:*` form both an IAM
 * grant and this plugin's recorded outputs use.
 *
 * Takes no region parameter, which is the one way it differs from the CLI's own
 * `logGroupArn` (`packages/cli/src/nodes.ts`) - that helper defaults to
 * `ctx.config.region`, correctly, because the site's groups live there. Every
 * group this plugin names lives in us-east-1 with the rest of the pipeline, so
 * there is no region for a caller to choose and no default for one to forget.
 */
function analyticsLogGroupArn(ctx: AnalyticsContext, group: string): string {
  return `arn:aws:logs:${ANALYTICS_REGION}:${ctx.accountId}:log-group:${group}:*`;
}

/**
 * What one node needs from another node's recorded output: whose ARN it is,
 * which node recorded it, which node is reading it, and what that reader cannot
 * do without it. Spelled as a record rather than four positional strings
 * because all four are prose and a transposition would typecheck.
 */
interface RecordedArnRequest {
  /** The resource in an operator's vocabulary, e.g. `salt secret`. */
  readonly what: string;
  /** The node id that records it - the reader's declared dependency. */
  readonly node: string;
  /** The node id doing the reading. */
  readonly dependent: string;
  /** What the reader has none of without it, e.g. `execution role to run as`. */
  readonly lack: string;
}

/**
 * An ARN another node recorded, or a throw naming the missing edge.
 *
 * Six nodes in this module interpolate an ARN they did not derive, and this is
 * the one place that read is done. What the declared `dependsOn` buys is the
 * ordering *as a stated fact*, not the ordering itself. `topoSort` drains its
 * zero-indegree queue in alphabetical order
 * (`packages/cli/src/graph.ts:46-49`), so several of these pairs would be
 * reconciled in the right order today even with no edge declared - by the
 * accident of how their ids sort, and by nothing else. The edge replaces the
 * accident with the constraint that is actually true: rename either node past
 * the other in sort order and the implicit ordering flips in silence (in
 * teardown too, which is this same order reversed - `graph.ts:107`), whereas
 * the declared edge either still holds or makes `topoSort` throw `depends on
 * unknown node` (`graph.ts:40`) before a single API call is made.
 *
 * The throw is the runtime backstop under either regime: whatever the order, no
 * policy is written with `undefined` interpolated into a live IAM grant and no
 * delivery stream is created against `undefined` - a wrong permission or a
 * misrouted stream written silently, never an error, and one nothing downstream
 * would notice until a record was denied or lost.
 *
 * The empty string is rejected as hard as `undefined`: several of these ARNs
 * are read straight off an AWS response, so a body carrying none would
 * otherwise leave a grant on `""`.
 */
function requireRecordedArn(ctx: AnalyticsContext, request: RecordedArnRequest): string {
  const arn = ctx.state.resources[request.node]?.arn;
  if (typeof arn !== 'string' || arn === '') {
    throw new Error(
      `the analytics ${request.what}'s ARN is not recorded in the "${ctx.env}" plugin state, so ${request.dependent} has no ${request.lack} - ${request.node} is this node's declared dependency and must be reconciled first; run \`blogwright analytics bootstrap --env ${ctx.env}\``,
    );
  }
  return arn;
}

/**
 * The salt secret's ARN as `analytics-salt-secret` recorded it. See
 * {@link requireRecordedArn} for what the throw is doing.
 *
 * This ARN cannot be derived: Secrets Manager appends six random characters to
 * the name, which is why `packages/pds/src/nodes.ts` has to glob `<name>-*` in
 * its own grant and why this node instead depends on the node that reads the
 * real one back.
 */
function requireSaltSecretArn(ctx: AnalyticsContext): string {
  return requireRecordedArn(ctx, {
    what: 'salt secret',
    node: SALT_SECRET_NODE,
    dependent: TRANSFORM_ROLE_NODE,
    lack: 'resource to grant secretsmanager:GetSecretValue on',
  });
}

/** The transform role's ARN as `analytics-transform-role` recorded it. See {@link requireRecordedArn}. */
function requireTransformRoleArn(ctx: AnalyticsContext): string {
  return requireRecordedArn(ctx, {
    what: 'transform role',
    node: TRANSFORM_ROLE_NODE,
    dependent: TRANSFORM_FUNCTION_NODE,
    lack: 'execution role to run as',
  });
}

/**
 * Apply the transform role's inline policy. Shared by `create` and `update` -
 * the `applyExecRolePolicy` pattern (`packages/cli/src/nodes.ts:180-216`) - so
 * a reconcile of an existing role rewrites the same document a fresh one gets,
 * and a changed secret ARN or a changed function name reaches the policy
 * without a teardown.
 *
 * **Two statements, two concrete resources, no `*` anywhere.** The `logs`
 * statement names the function's own log group ({@link transformLogGroupArn})
 * and carries two actions rather than three: `logs:CreateLogGroup` is
 * deliberately absent, because `analytics-transform-log-group` creates that
 * group and a role granted the creation of a group it never has to create is a
 * grant with no call behind it - the same shape the site's exec role has. What
 * Lambda needs at runtime is the stream inside that group and the events in it.
 * The `secretsmanager` statement names the one secret this pipeline owns and
 * nothing else. A `*` in the second would hand every secret in the account -
 * every other environment's salt, and `blogwright-pds`'s OAuth client key and
 * live session - to a role whose only job is to read one value, and nothing in
 * the suite would notice, because a policy with a wildcard grants strictly more
 * than a correct one and every functional test still passes. `nodes.test.ts`
 * parses the document back out of the request and asserts on the `Resource`
 * values for that reason.
 */
async function applyTransformRolePolicy(ctx: AnalyticsContext): Promise<void> {
  await ctx.clients.iam.putRolePolicy(transformRoleName(ctx), TRANSFORM_ROLE_POLICY, {
    Version: POLICY_VERSION,
    Statement: [
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: transformLogGroupArn(ctx),
      },
      {
        Effect: 'Allow',
        Action: ['secretsmanager:GetSecretValue'],
        Resource: requireSaltSecretArn(ctx),
      },
    ],
  });
}

/**
 * A fresh salt seed: {@link SALT_SECRET_BYTES} bytes from the platform CSPRNG,
 * base64-encoded so the value is a plain string on the wire and in the console.
 *
 * `crypto.getRandomValues` rather than `crypto.randomUUID` (which core's
 * `upsertSecret` uses for its idempotency token): a UUID carries 122 bits with
 * six of its characters fixed by the version and variant, which is a fine
 * request id and a poor key.
 *
 * The returned value is handed to `upsertSecret` and to nothing else. It is
 * never logged, never recorded in `state/<env>.analytics.json`, and never read
 * back by this module - `describeSecret` is used everywhere a value could have
 * been, precisely because it answers with metadata and never with the secret.
 */
function newSaltSecret(): string {
  const bytes = new Uint8Array(SALT_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}

/**
 * Record the salt secret's **identity** - the name it is addressed by and the
 * ARN the role's policy interpolates. Never its value: an entry in
 * `state/<env>.analytics.json` is written to the site's S3 bucket, which is not
 * a secret store, and the whole point of Secrets Manager holding this seed is
 * that the digest beside `user_agent` in the table cannot be reversed by
 * anyone who can read the analytics data.
 *
 * The name recorded is the resolved config's, not the one `DescribeSecret`
 * echoes back: it is the name every call in this module addresses the secret
 * by, and it cannot be empty. The ARN is the opposite - it is the one part that
 * cannot be derived, so it comes from the response, guarded on its value the
 * way `analytics-table` guards its own (an absent field would otherwise land in
 * state as an empty string that reads downstream as a real ARN).
 */
function recordSaltSecret(ctx: AnalyticsContext, name: string, arn: string | undefined): void {
  const out = output(ctx, SALT_SECRET_NODE);
  out.name = name;
  if (arn) out.arn = arn;
}

/**
 * The Secrets Manager secret holding the seed every `visitor_key` in the table
 * is derived from - **the one resource in this graph that must outlive its own
 * reconcile, and the one this module never overwrites or deletes.**
 *
 * `transform/visitor-key.ts` derives the per-day salt as
 * `HMAC-SHA256(secret, day)` and `map-record.ts` hashes the viewer's address
 * under it, so the stored value is the only thing standing between a row in
 * `page_views` and the address it came from - the table keeps `user_agent` in
 * the clear beside the key, and an unsalted SHA-256 over IPv4's 2^32 space is a
 * lookup table, not a pseudonym. Two consequences shape every method below.
 *
 * **It is created once and never rewritten.** Replacing the value does not
 * "rotate" anything: it orphans every `visitor_key` already written, because no
 * row from before the change ever compares equal to a row from after it. The
 * dashboard's unique-visitor figures would silently double at the boundary and
 * `analytics backfill` - which re-derives a historical day's salt from this
 * same seed - would produce rows that join to nothing. So `read` adopts, and
 * `create` re-checks and adopts rather than trusting that the `read` before it
 * is still true (see below). Daily turnover comes from the *derivation*, not
 * from the store, which is why **no Secrets Manager rotation is configured**:
 * managed rotation would mean a rotation Lambda, a schedule and a second
 * execution role, to replace the one value that must not change.
 *
 * **Its `delete` removes nothing.** This is the second inert `delete` in the
 * graph and it is inert for a different reason than
 * `analytics-catalog-integration`'s, which is inert because the federation is
 * shared. This one is inert because the act is asymmetric. Core's
 * `deleteSecret` sends `ForceDeleteWithoutRecovery: true`, so there is no
 * recovery window and nothing to undo with; keeping a secret costs cents a
 * month and one command to remove by hand, while deleting one is unrecoverable
 * and destroys the ability to interpret any `page_views` data that outlived the
 * teardown - an exported copy, a table bucket whose own delete failed, or an
 * environment torn down and re-bootstrapped, which is a routine recovery move
 * and would otherwise come back with a different seed and no sign that
 * anything had changed. The teardown says what it kept and how to remove it.
 */
export function analyticsSaltSecretNode(): AnalyticsNode {
  return {
    id: SALT_SECRET_NODE,
    dependsOn: [],
    title: `visitor_key salt secret (${ANALYTICS_REGION} - created once, never replaced, kept on teardown)`,
    async read(ctx) {
      const name = resolveAnalyticsConfig(ctx).saltSecretName;
      // `describeSecret`, not `getSecretValue`: existence is the question, and
      // the value is not this process's business at any point.
      const secret = await secrets(ctx).describeSecret(name);
      if (secret === undefined) return false;
      recordSaltSecret(ctx, name, secret.arn);
      return true;
    },
    async create(ctx) {
      const name = resolveAnalyticsConfig(ctx).saltSecretName;
      const client = secrets(ctx);
      // The guard that makes "created if absent, never overwritten" true rather
      // than merely intended. `applyGraph` calls `create` only after `read`
      // answered false, so this lookup is redundant on the happy path - and it
      // is here because the call below is `upsertSecret`, which falls back to
      // `PutSecretValue` when `CreateSecret` reports the secret already exists.
      // That fallback is right for `pds keygen`, which owns a value it means to
      // replace, and catastrophic here. Two concurrent bootstraps of the same
      // environment are all it takes to reach it, and the damage - every
      // visitor_key written so far orphaned - is silent and unrepairable. One
      // extra DescribeSecret, once in an environment's lifetime, closes all but
      // the microseconds between these two calls.
      const existing = await client.describeSecret(name);
      if (existing !== undefined) {
        ctx.logger.warn(
          `adopting the existing analytics salt secret "${name}" rather than creating a new one - every visitor_key already written was derived from its value, so it is never replaced`,
        );
        recordSaltSecret(ctx, name, existing.arn);
        return;
      }
      // No rotation configuration is sent, deliberately: see this node's doc
      // comment. `upsertSecret` sends `Name`, `SecretString`, an idempotency
      // token, the description and the tags, and nothing else.
      await client.upsertSecret(name, newSaltSecret(), SALT_SECRET_DESCRIPTION, ctx.tags);
      // Identity before the ARN lookup, the discipline `analytics-table`'s
      // `create` follows: `CreateSecret`'s response is discarded by
      // `upsertSecret`, so hydrating the ARN takes a second request, and a
      // crash in between must still leave a record that this environment now
      // owns a secret under this name. The role's own guard
      // ({@link requireSaltSecretArn}) is what stops a half-recorded entry
      // becoming a wrong grant: without the ARN it raises rather than
      // interpolating nothing.
      const out = output(ctx, SALT_SECRET_NODE);
      out.name = name;
      const created = await client.describeSecret(name);
      if (created?.arn) out.arn = created.arn;
    },
    async delete(ctx) {
      // Deliberately removes nothing - see this node's doc comment for why the
      // asymmetry between keeping and deleting decides it. Said out loud rather
      // than left to the title, because `destroyGraph` prints "deleted <title>"
      // for every node it walks and an operator tearing an environment down is
      // owed the one line that says what is still in the account.
      const name = resolveAnalyticsConfig(ctx).saltSecretName;
      ctx.logger.warn(
        `keeping the analytics salt secret "${name}" - it is the only thing that makes an already-written visitor_key meaningful, and deleting it is not reversible. Remove it by hand once no page_views data derived from it survives: aws secretsmanager delete-secret --region ${ANALYTICS_REGION} --secret-id ${name}`,
      );
    },
  };
}

/**
 * A CloudWatch log group this plugin owns, on the read/create/update/delete
 * contract the site's own groups have (`logGroupNode`,
 * `packages/cli/src/nodes.ts`): `read` reports presence and records the ARN,
 * `create` ensures the group with the environment's tags and then applies
 * {@link LOG_RETENTION_DAYS}, `update` re-applies that retention on every
 * apply, and `delete` removes the group.
 *
 * Owning the group is what makes retention a property at all. A group a service
 * creates for itself is retained **forever** and no reconcile ever notices;
 * re-applying the policy on every `update` also converts a group that already
 * exists in that state - an environment provisioned before these two nodes
 * existed - without a teardown.
 *
 * `stream`, when given, is a log stream the group must also hold. It is ensured
 * on `create` **and re-ensured on every `update`**, which is the one place these
 * nodes depart from the site's `logGroupNode` and is the
 * {@link applyErrorBucketConfiguration} reconcile-on-every-apply pattern rather
 * than the site's narrower update. The reason is concrete: `read()` answers on
 * the group alone, so a group left by a run that stopped between
 * `CreateLogGroup` and `CreateLogStream` reports present forever while an
 * `update` that only re-applied retention would do nothing about the stream it
 * is missing. Deleting a group deletes the streams inside it, so `delete` needs
 * no counterpart.
 *
 * `dependsOn: []` on both: a group is the head of the chain that writes to it
 * and reads no other node's output.
 */
function analyticsLogGroupNode(spec: {
  readonly id: string;
  readonly title: string;
  readonly name: (ctx: AnalyticsContext) => string;
  readonly stream?: string;
}): AnalyticsNode {
  const { id, title, name, stream } = spec;
  const record = (ctx: AnalyticsContext, group: string): void => {
    const out = output(ctx, id);
    out.name = group;
    out.arn = analyticsLogGroupArn(ctx, group);
  };
  return {
    id,
    dependsOn: [],
    title,
    async read(ctx) {
      const group = name(ctx);
      if (!(await logs(ctx).logGroupExists(group))) return false;
      record(ctx, group);
      return true;
    },
    async create(ctx) {
      const group = name(ctx);
      const client = logs(ctx);
      await client.ensureLogGroup(group, ctx.tags);
      // Identity before the secondary calls, the ordering `analytics-error-bucket`
      // and the site's own `bucketNode` follow: a crash between CreateLogGroup and
      // the retention or the stream must still leave the group recorded in state.
      record(ctx, group);
      await client.putRetentionPolicy(group, LOG_RETENTION_DAYS);
      if (stream !== undefined) await client.ensureLogStream(group, stream);
    },
    async update(ctx) {
      const group = name(ctx);
      const client = logs(ctx);
      await client.putRetentionPolicy(group, LOG_RETENTION_DAYS);
      if (stream !== undefined) await client.ensureLogStream(group, stream);
    },
    async delete(ctx) {
      // `deleteLogGroup` swallows its own not-found, so a re-run after a
      // completed teardown is a no-op rather than a failure.
      await logs(ctx).deleteLogGroup(name(ctx));
    },
  };
}

/**
 * The transform Lambda's own log group: the mapping decisions, the drop path,
 * and the cold-start read of the salt secret - the only place this pipeline
 * says *why* a record went where it did.
 *
 * Lambda writes into it under the execution role's existing
 * `logs:CreateLogStream` and `logs:PutLogEvents`, scoped to this group and no
 * other ({@link transformLogGroupArn}). The role is deliberately not granted
 * `logs:CreateLogGroup`, because this node is what creates the group.
 *
 * It is at the head of the chain that writes to it -
 * `analytics-transform-function` declares the edge - and the role does not,
 * because the role's policy *derives* this group's ARN from the function's name
 * rather than reading a recorded one, so there is no output to wait for.
 */
export function analyticsTransformLogGroupNode(): AnalyticsNode {
  return analyticsLogGroupNode({
    id: TRANSFORM_LOG_GROUP_NODE,
    title: `Transform Lambda log group (${ANALYTICS_REGION})`,
    name: transformLogGroupName,
  });
}

/**
 * The transform Lambda's execution role: permission to write its own logs and
 * to read the one secret it needs, and nothing else.
 *
 * It declares `dependsOn: ['analytics-salt-secret']` because its policy
 * interpolates that node's *recorded* ARN - the implementation notes' rule that
 * "a node depends on every node whose recorded ARN it interpolates" - and
 * {@link requireSaltSecretArn} explains what an undeclared edge would produce.
 */
export function analyticsTransformRoleNode(): AnalyticsNode {
  return {
    id: TRANSFORM_ROLE_NODE,
    dependsOn: [SALT_SECRET_NODE],
    title: `IAM transform execution role (global - IAM is not regional; it serves the ${ANALYTICS_REGION} pipeline)`,
    async read(ctx) {
      const name = transformRoleName(ctx);
      const arn = await ctx.clients.iam.getRoleArn(name);
      // Falsy rather than `=== undefined`: `getRoleArn` reads the ARN out of
      // the response XML, so a body without one answers `undefined` while an
      // empty tag would answer `""`, and neither is a role to record.
      if (!arn) return false;
      const out = output(ctx, TRANSFORM_ROLE_NODE);
      out.name = name;
      out.arn = arn;
      return true;
    },
    async create(ctx) {
      const name = transformRoleName(ctx);
      // `ctx.clients.iam`, the host's own client, not the plugin's bundle: IAM
      // is a global service (`packages/core/src/aws/endpoint.ts`'s
      // GLOBAL_SERVICES), so core's instance already signs us-east-1 and there
      // is no region for the pin to get wrong.
      const arn = await ctx.clients.iam.ensureRole(
        name,
        LAMBDA_TRUST,
        `Execution role for the ${ctx.config.siteName} analytics record-transform Lambda`,
        ctx.tags,
      );
      // Recorded before the policy PUT - which is the opposite order to
      // `execRoleNode` (`packages/cli/src/nodes.ts:219-246`), and deliberately.
      // The role is a real IAM object the moment `ensureRole` returns; if the
      // policy call then fails, an entry recorded here is what tells the next
      // reconcile it exists. Nothing reads a role ARN as "the role is
      // configured": the function node reads it to *run as*, and it cannot be
      // reached before this node's own `update` has reapplied the policy,
      // because `applyGraph` reconciles this node to completion first.
      const out = output(ctx, TRANSFORM_ROLE_NODE);
      out.name = name;
      out.arn = arn;
      await applyTransformRolePolicy(ctx);
    },
    async update(ctx) {
      await applyTransformRolePolicy(ctx);
    },
    async delete(ctx) {
      // Idempotent, and removes the inline policy first - `deleteRole`
      // (`packages/core/src/aws/iam.ts:128`) lists and deletes them, because
      // IAM refuses to delete a role that still carries one, and swallows the
      // not-found so a half-finished teardown is re-runnable.
      await ctx.clients.iam.deleteRole(transformRoleName(ctx));
    },
  };
}

/**
 * Where this package's build put the transform's artifacts: the bundle and the
 * manifest stamped beside it. The package root comes from `paths.ts`, the one
 * module here allowed to resolve it; the directory under it is task 43's
 * {@link TRANSFORM_BUNDLE_DIR}, so neither half of the location is spelled
 * twice.
 */
function transformArtifactDir(): string {
  return join(ANALYTICS_PACKAGE_DIR, TRANSFORM_BUNDLE_DIR);
}

/** Raise for an artifact this package ships and does not have, naming what would produce it. */
function missingArtifact(file: string, cause: unknown): Error {
  return new Error(
    `the analytics transform artifact "${file}" is not in ${transformArtifactDir()}, so there is no code to deploy - the package ships it, so this is an unbuilt checkout or a partial install; run \`pnpm --filter blogwright-analytics build\``,
    { cause },
  );
}

/** Narrow parsed JSON to an object before reading a field off it - no cast, no `any`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Task 43's source hash and the zip key it derives, read from the manifest
 * beside the bundle.
 *
 * The manifest is read *beside* the zip and is never packed inside it: the
 * deployment package holds exactly one file (see
 * {@link TRANSFORM_BUNDLE_FILE}), and this is deploy-time metadata, not code.
 *
 * Only `hash` is read off the file. The manifest also carries `key`, and it is
 * deliberately not trusted: `transformZipKey` is the single derivation
 * (`transform-hash.ts`), and reading a stored key back would let the two
 * disagree - which is invisible, because a key that disagrees with its hash
 * still looks like a key. Calling the derivation is also what validates the
 * hash's shape, so a manifest carrying `"hash": "nope"` fails here rather than
 * producing a stable key that pins the deployed function at whatever code
 * shipped first.
 *
 * A hash is only ever compared to another hash from this same function, so the
 * *value* is never asserted against a literal anywhere - what matters is that
 * it moves when the source does, which `transform-hash.test.ts` owns.
 */
async function readTransformManifest(
  ctx: AnalyticsContext,
): Promise<{ hash: string; key: string }> {
  const path = join(transformArtifactDir(), TRANSFORM_MANIFEST_FILE);
  let raw: string;
  try {
    raw = await ctx.ports.fs.readText(path);
  } catch (cause) {
    throw missingArtifact(TRANSFORM_MANIFEST_FILE, cause);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${path} is not valid JSON - rebuild the package to regenerate it`, { cause });
  }
  const hash = isRecord(parsed) ? parsed['hash'] : undefined;
  if (typeof hash !== 'string') {
    throw new Error(
      `${path} carries no "hash" string, so there is nothing to key the deployed function's code by - rebuild the package to regenerate it`,
    );
  }
  return { hash, key: transformZipKey(hash) };
}

/**
 * The deployment package: the bundled transform, read through the FileSystem
 * port and zipped the way `packageAndUploadAgent` zips the build agent
 * (`packages/cli/src/agent-package.ts:48-53`) - `zipSync` with a fixed `mtime`,
 * so identical bundle bytes always produce identical archive bytes.
 *
 * **Exactly one entry, under the bundle's own name**, never the artifact
 * directory wholesale. The `Handler` string the function is configured with is
 * `<module base name>.<export>` resolved against the root of the archive
 * (`TRANSFORM_LAMBDA_HANDLER`), and the manifest sitting next to the bundle on
 * disk is not code - packing it would put a stray file in the runtime's module
 * root for no reader.
 *
 * The bytes cross `ctx.ports.fs`, never Node's own filesystem module: this is a
 * domain module under DEVELOPMENT.md §Hexagonal architecture, and no
 * `packages/analytics/src/` path is in `.oxlintrc.json`'s
 * `no-restricted-imports` override list.
 */
async function packTransformBundle(ctx: AnalyticsContext): Promise<Uint8Array> {
  const path = join(transformArtifactDir(), TRANSFORM_BUNDLE_FILE);
  let bundle: Uint8Array;
  try {
    bundle = await ctx.ports.fs.readBytes(path);
  } catch (cause) {
    throw missingArtifact(TRANSFORM_BUNDLE_FILE, cause);
  }
  const zip = zipSync({ [TRANSFORM_BUNDLE_FILE]: bundle }, { level: ZIP_LEVEL, mtime: ZIP_MTIME });
  if (zip.length > MAX_INLINE_ZIP_BYTES) {
    throw new Error(
      `the analytics transform's deployment package is ${zip.length} bytes, over the ${MAX_INLINE_ZIP_BYTES}-byte limit Lambda accepts for a zip sent inline - the code would have to move to an S3 code bucket in ${ANALYTICS_REGION}, which this pipeline deliberately does not have (see MAX_INLINE_ZIP_BYTES)`,
    );
  }
  return zip;
}

/**
 * The function's version-specific settings, in the shape `CreateFunction` and
 * `UpdateFunctionConfiguration` share (`aws/lambda.ts`). Built in one place so
 * the create payload and the update payload cannot drift, and so
 * {@link configurationFingerprint} compares exactly what would be sent.
 *
 * Every value is a named module constant or a resolved input: the runtime, the
 * handler (task 43's `TRANSFORM_LAMBDA_HANDLER`, derived from the bundle's own
 * file name and export and spelled only there), the memory and the timeout are
 * constants; the role ARN comes from the node this one depends on; and the
 * environment carries the salt secret's **name** under
 * {@link SALT_SECRET_NAME_ENV} - `transform/handler.ts`'s own constant, so the
 * variable the function reads and the variable this node sets are one string.
 *
 * The *name* travels; the value never does. A function's configuration is
 * readable by anyone with `lambda:GetFunctionConfiguration`, so a secret in an
 * environment variable would be a secret in the console.
 */
function transformConfiguration(ctx: AnalyticsContext): FunctionConfigurationInput {
  return {
    roleArn: requireTransformRoleArn(ctx),
    runtime: TRANSFORM_RUNTIME,
    handler: TRANSFORM_LAMBDA_HANDLER,
    memoryMb: TRANSFORM_MEMORY_MB,
    timeoutSeconds: TRANSFORM_TIMEOUT_SECONDS,
    environment: { [SALT_SECRET_NAME_ENV]: resolveAnalyticsConfig(ctx).saltSecretName },
  };
}

/**
 * The deployed configuration, as one recorded value the next reconcile compares
 * against.
 *
 * One value rather than six recorded fields, because the question the update
 * asks is "is what is deployed what we would send now", and six fields compared
 * one by one is six chances to forget the seventh the day
 * `FunctionConfigurationInput` grows one. `JSON.stringify` over the very object
 * the client is handed is that question, spelled once; the key order is fixed
 * because {@link transformConfiguration} is the single literal that builds it.
 *
 * It is safe to write into `state/<env>.analytics.json` because the
 * configuration holds no secret - only the salt secret's *name*.
 */
function configurationFingerprint(input: FunctionConfigurationInput): string {
  return JSON.stringify(input);
}

/** A string previously recorded under `key` for `nodeId`, or `undefined` if there is none. */
function recordedText(ctx: AnalyticsContext, nodeId: string, key: string): string | undefined {
  const value = ctx.state.resources[nodeId]?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** What a reconcile of the deployed transform has to push. Both false is the common case. */
export interface TransformUpdate {
  /** Send `UpdateFunctionCode` - the source hash moved. */
  readonly code: boolean;
  /** Send `UpdateFunctionConfiguration` - the settings the function runs under moved. */
  readonly configuration: boolean;
}

/**
 * Decide what an existing transform function's reconcile has to send, from what
 * is recorded against what the package now holds. Pure, so the decision is
 * testable without the AWS calls - `builderImageAction`'s shape
 * (`packages/cli/src/nodes.ts:311-321`) and its reason.
 *
 * **Two independent comparisons, not one.** An unchanged hash performs no code
 * call, which is the whole point of hashing the *source*: a rebuild on another
 * machine emits different bundle bytes from the same source, and keying the
 * decision on those bytes would redeploy the function on every platform switch
 * (`transform-hash.ts` argues this at length). Everything a code push could
 * need to accompany it is covered by that hash too, because `analytics/src` is
 * one of the hash's inputs - so the module constants above cannot change
 * without moving it.
 *
 * The configuration is compared separately because one of its inputs is *not*
 * in the hash and cannot be: `analytics.saltSecretName` comes from
 * `blogwright.config.json`, which nothing hashes. An operator who repoints it
 * gets a new secret, a role granted on the new ARN, and - without this
 * comparison - a function still reading the old name out of its environment:
 * every batch failing `GetSecretValue`, every record in Firehose's error
 * prefix. That is the same gap `builderImageAction` carries its second `logGroup`
 * limb for.
 *
 * Keeping them separate is also what keeps the common cases to a single call
 * each, which matters more than it looks: Lambda refuses a second update while
 * the first is still settling, so two calls in one reconcile have a window the
 * one-call cases do not.
 */
export function transformUpdate(
  recorded: { sourceHash: string | undefined; configuration: string | undefined },
  desired: { sourceHash: string; configuration: string },
): TransformUpdate {
  return {
    code: recorded.sourceHash !== desired.sourceHash,
    configuration: recorded.configuration !== desired.configuration,
  };
}

/**
 * The 400s AWS returns while a role this graph just created is still
 * propagating. Each service words it differently and none of them puts anything
 * machine-readable in the code - Lambda's arrives as `Http400`, Firehose's as
 * `InvalidArgumentException` - so the message is all there is to match on:
 *
 *   Lambda:   The role defined for the function cannot be assumed by Lambda.
 *   Firehose: Firehose is unable to assume role arn:... Please check the role
 *             provided.
 *
 * Deliberately not a loose "retry 400s". Almost every other 400 these services
 * return is permanent - a malformed zip, a bad handler path, a role that
 * genuinely lacks the trust policy - and retrying those turns a clear failure
 * into a slow one. The negative case is asserted in the suite for that reason.
 *
 * **If a future node consumes a role from a third service, add its wording
 * here.** This pattern was fixed for Lambda alone first, and Firehose failed
 * the very next run - the class has two members today and both are listed.
 */
const ROLE_NOT_YET_ASSUMABLE = /cannot be assumed by|unable to assume role/i;

/**
 * Retry `call` while IAM has not finished propagating a role it just created.
 *
 * IAM is eventually consistent, and this graph creates each role in the node
 * immediately before the one that assumes it - the tightest window the ordering
 * can produce. Both pairings are affected: transform-role -> transform-function
 * and firehose-role -> firehose-stream. The failure is purely timing; the same
 * request succeeds seconds later with nothing changed.
 *
 * The update paths are wrapped too, because both send the role ARN: an
 * environment whose role was torn down and recreated hits the identical window
 * on `updateFunctionConfiguration` and `updateDestination`.
 */
function whileRoleIsPropagating<T>(call: () => Promise<T>): Promise<T> {
  return withRetry(call, {
    retryable: (err) =>
      err instanceof AwsError && err.statusCode === 400 && ROLE_NOT_YET_ASSUMABLE.test(err.message),
  });
}

/**
 * The record-transform Lambda: the function Firehose runs over every CloudFront
 * record before it reaches the `page_views` table.
 *
 * Its code is keyed by task 43's hash of the transform's **source**, recorded
 * in the plugin's own state, so identical source never redeploys it - and the
 * key that hash derives (`transformZipKey`) is recorded beside it as the
 * artifact's name, even though the zip travels inline rather than through a
 * bucket (see {@link MAX_INLINE_ZIP_BYTES} for why inline).
 *
 * It depends on `analytics-transform-role`, whose recorded ARN it runs as, and
 * on `analytics-transform-log-group`, whose ARN it reads nothing of: a group
 * that does not exist when the function first runs is a log line lost with
 * nothing raised, and on teardown the reverse order the engine walks removes
 * the function before the group holding the evidence of what it did.
 */
export function analyticsTransformFunctionNode(): AnalyticsNode {
  return {
    id: TRANSFORM_FUNCTION_NODE,
    dependsOn: [TRANSFORM_ROLE_NODE, TRANSFORM_LOG_GROUP_NODE],
    title: `Record-transform Lambda (${ANALYTICS_REGION})`,
    async read(ctx) {
      const name = transformFunctionName(ctx);
      const fn = await lambda(ctx).getFunction(name);
      if (fn === undefined) return false;
      if (fn.state === 'failed') {
        // Not adopted as reconciled, and not reported as absent either.
        // Reporting absence would send `applyGraph` to `create`, whose 409 is
        // swallowed as "already exists" (`aws/lambda.ts`), and the reconcile
        // would go green over a function that cannot run - with every record
        // landing in Firehose's error prefix and an empty dashboard as the only
        // symptom.
        throw new Error(
          `the analytics transform Lambda "${name}" exists but is in the Failed state, so Firehose would route every record to the error prefix. Delete it (\`aws lambda delete-function --region ${ANALYTICS_REGION} --function-name ${name}\`) and re-run \`blogwright analytics bootstrap --env ${ctx.env}\` to recreate it.`,
        );
      }
      const out = output(ctx, TRANSFORM_FUNCTION_NODE);
      out.name = name;
      // Guarded on the value: `normalizeFunction` falls back to `''` for a
      // response carrying no `Configuration.FunctionArn`, and an empty string
      // recorded under `arn` reads downstream as a real one.
      if (fn.arn) out.arn = fn.arn;
      // The source hash and the configuration fingerprint are deliberately NOT
      // hydrated here. They are this repo's record of what it deployed, and
      // Lambda cannot answer either: `CodeSha256` digests the built zip, which
      // is a different thing from a hash of the source (`aws/lambda.ts` drops
      // it for exactly this reason). Losing the state file therefore means the
      // next reconcile pushes both again - wasteful, never wrong.
      return true;
    },
    async create(ctx) {
      const name = transformFunctionName(ctx);
      const manifest = await readTransformManifest(ctx);
      const configuration = transformConfiguration(ctx);
      const zipFile = await packTransformBundle(ctx);
      const client = lambda(ctx);
      await whileRoleIsPropagating(() =>
        client.createFunction({ name, zipFile, ...configuration }),
      );
      // Identity and code identity before the ARN lookup, the discipline
      // `analytics-table`'s `create` follows and for the same reason:
      // `createFunction` returns `void` by design (`aws/lambda.ts`), so the ARN
      // takes a second request, and a crash in between must not leave a
      // deployed function that state has no record of. Recording the hash here
      // rather than after the lookup is what stops the next reconcile
      // re-uploading identical code.
      const out = output(ctx, TRANSFORM_FUNCTION_NODE);
      out.name = name;
      out.sourceHash = manifest.hash;
      out.codeKey = manifest.key;
      out.configuration = configurationFingerprint(configuration);
      const created = await client.getFunction(name);
      if (created?.arn) out.arn = created.arn;
    },
    async update(ctx) {
      const manifest = await readTransformManifest(ctx);
      const configuration = transformConfiguration(ctx);
      const fingerprint = configurationFingerprint(configuration);
      const update = transformUpdate(
        {
          sourceHash: recordedText(ctx, TRANSFORM_FUNCTION_NODE, 'sourceHash'),
          configuration: recordedText(ctx, TRANSFORM_FUNCTION_NODE, 'configuration'),
        },
        { sourceHash: manifest.hash, configuration: fingerprint },
      );
      // Nothing moved: no AWS call at all, which is what makes reconciling on
      // every deploy cheap. The manifest read above is a local file.
      if (!update.code && !update.configuration) return;

      const name = transformFunctionName(ctx);
      const client = lambda(ctx);
      const out = output(ctx, TRANSFORM_FUNCTION_NODE);
      // Configuration first when both moved. Lambda refuses a second update
      // while the first is settling (`ResourceConflictException`, which
      // `aws/lambda.ts` deliberately does not swallow - on this operation it
      // means "in progress", not "already done"), so if one of the two is going
      // to fail it is the second, and the survivable half-state is the one
      // where the old code runs under the new settings: the old code reading
      // the new secret name works, while new code reading the old name is
      // denied by the very role this graph just narrowed. Each half is recorded
      // as soon as it is true, so the retry after such a failure sends only the
      // half that did not land.
      if (update.configuration) {
        await whileRoleIsPropagating(() => client.updateFunctionConfiguration(name, configuration));
        out.configuration = fingerprint;
      }
      if (update.code) {
        await client.updateFunctionCode(name, await packTransformBundle(ctx));
        out.sourceHash = manifest.hash;
        out.codeKey = manifest.key;
      }
    },
    async delete(ctx) {
      // No-op when the function is already gone (`aws/lambda.ts` swallows the
      // 404 and nothing else), so a half-finished teardown is re-runnable.
      // `destroyGraph` walks the chain in reverse, so this runs before
      // `analytics-transform-role` removes the role it runs as.
      await lambda(ctx).deleteFunction(transformFunctionName(ctx));
    },
  };
}

/* ------------------------------------------------------------------------- *
 * The delivery chain: the error bucket, the delivery role, and the stream.
 * ------------------------------------------------------------------------- */

/**
 * The suffix the Firehose failed-record bucket's name carries, appended to
 * `ctx.names.prefix`. See {@link transformFunctionName} for why the prefix is
 * the source of the environment here and {@link resolveAnalyticsConfig} is not:
 * the `analytics` block owns six settings and this is not one of them, so there
 * is no operator override to honour and the environment still leads the name.
 */
const ERROR_BUCKET_SUFFIX = '-analytics-errors';

/** The suffix the Firehose delivery role carries. See {@link ERROR_BUCKET_SUFFIX}. */
const FIREHOSE_ROLE_SUFFIX = '-analytics-firehose-role';

/** The suffix the delivery stream carries. See {@link ERROR_BUCKET_SUFFIX}. */
const FIREHOSE_STREAM_SUFFIX = '-analytics-firehose';

/**
 * The longest name S3 accepts for a bucket - the same limit `deriveNames`
 * enforces on the site's own bucket (`packages/core/src/config.ts:355`) and
 * `resolveAnalyticsConfig` on the table bucket, restated here because this is a
 * third bucket name derived in a third place.
 */
const ERROR_BUCKET_NAME_MAX_LENGTH = 63;

/** The longest name Firehose accepts for a delivery stream. */
const STREAM_NAME_MAX_LENGTH = 64;

/** The name of the inline policy this plugin puts on its own Firehose delivery role. */
const FIREHOSE_ROLE_POLICY = 'firehose-delivery';

/**
 * The trust document the Firehose delivery role is created with, verified
 * against AWS's own "Allow Firehose to assume an IAM role"
 * (`firehose/latest/dev/controlling-access.html`), which is one statement
 * granting `sts:AssumeRole` to `firehose.amazonaws.com`.
 *
 * Deliberately **not** {@link LAMBDA_TRUST} with a swapped principal, and
 * deliberately without that document's `sts:TagSession`: Firehose assumes this
 * role on its own schedule with no session tags to pass, so granting the action
 * would widen the trust for a caller that never uses it. The two documents are
 * allowed to drift for the same reason the transform's own copy is allowed to
 * drift from the CLI's - each one names the principal *its* resource assumes.
 */
const FIREHOSE_TRUST = {
  Version: POLICY_VERSION,
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'firehose.amazonaws.com' },
      Action: ['sts:AssumeRole'],
    },
  ],
};

/**
 * The key prefix under {@link errorBucketName} that failed records land at.
 *
 * One prefix serves both of Firehose's two distinct error surfaces - the
 * stream-level `S3Configuration.ErrorOutputPrefix` for a record that never
 * reached a table, and the table-level
 * `DestinationTableConfiguration.S3ErrorOutputPrefix` for one the table's
 * schema rejected (`aws/firehose.ts` spells out the difference). One stream
 * writes to one table, so separating them would sort records by a distinction
 * that has no second case on this side of it.
 */
const ERROR_OUTPUT_PREFIX = 'firehose-errors/';

/**
 * Days both of this plugin's log groups retain what is written to them,
 * re-applied on every `update` the way the site's own groups re-apply theirs.
 *
 * 365, matching the site's `retention.microvmDays` default - a year of the
 * build's own output, and a year of this pipeline's. It is a plugin-owned
 * constant and **not** read from `ctx.config.retention`, deliberately: that
 * block holds exactly two keys, `microvmDays` and `cloudfrontDays`, and each
 * one names one of the site's own two log groups. A third and fourth consumer
 * reading either would make an operator's setting for a group they named
 * silently govern two resources it was never named for, so that an environment
 * shortening its CloudFront retention would shorten the transform's diagnostics
 * with it and nothing would say so. Making retention configurable per plugin is
 * a config change with a name of its own, not a key borrowed here.
 */
const LOG_RETENTION_DAYS = 365;

/**
 * The log stream inside {@link firehoseLogGroupName} that Firehose writes its
 * delivery errors to. Firehose's own name for that stream - enabling error
 * logging through the API names it explicitly, and the service creates neither
 * the group nor the stream.
 *
 * `BackupDelivery`, the stream Firehose uses for a destination configured with
 * S3 backup, is deliberately not created: the Iceberg destination this pipeline
 * builds configures none, so a second stream would be an empty one forever.
 */
const DESTINATION_DELIVERY_STREAM = 'DestinationDelivery';

/**
 * The prefix a Firehose delivery stream's log group is conventionally named
 * under, the counterpart of {@link LAMBDA_LOG_GROUP_PREFIX}. Firehose derives
 * nothing from it - it writes to whatever group the stream's
 * `CloudWatchLoggingOptions` names - so the convention is this plugin's to keep,
 * and {@link firehoseLogGroupName} is where it is kept.
 */
const FIREHOSE_LOG_GROUP_PREFIX = '/aws/kinesisfirehose/';

/**
 * Seconds Firehose buffers records before writing a file, and the size in MiB
 * that would flush one sooner. Both are sent, because the service requires the
 * pair when either is given (`BufferingHints`); both are at the service's
 * documented maximum (900 seconds, 128 MiB), and the pair is chosen together.
 *
 * At a blog's volume the size bound is unreachable, so the interval alone
 * governs and every flush is time-driven. The maximum interval therefore
 * produces the largest files this stream can produce, which is exactly what the
 * change spec's own cost assumption wants - "log volume for a blog is small
 * enough that batched Firehose delivery produces files large enough not to make
 * S3 Tables compaction the dominant cost". Fifteen minutes of delivery latency
 * is far inside what a day-partitioned dashboard needs; trading it for smaller,
 * more numerous Iceberg data files would buy freshness nothing here reads.
 */
const STREAM_BUFFER_INTERVAL_SECONDS = 900;

/** See {@link STREAM_BUFFER_INTERVAL_SECONDS} - the two are chosen as a pair. */
const STREAM_BUFFER_SIZE_MB = 128;

/**
 * The plugin's own S3 client - **core's `S3Client` built over the pinned
 * signer, never `ctx.clients.s3`**, which core constructs over the
 * primary-region signer (`packages/core/src/clients.ts`). The same choice
 * {@link secrets} makes and for a sharper reason: an S3 bucket is created in
 * the region its request is signed for, so reaching for the host's copy would
 * put the error bucket in `config.region` while the stream writing to it is
 * pinned to {@link ANALYTICS_REGION}.
 */
function s3(ctx: AnalyticsContext): S3Client {
  return createAnalyticsClients(ctx).s3;
}

/**
 * The plugin's own Firehose client, built the same way {@link s3tables},
 * {@link glue} and {@link lambda} are: core's bundle enumerates no `firehose`
 * key at all, and every client this plugin uses signs in
 * {@link ANALYTICS_REGION}.
 */
function firehose(ctx: AnalyticsContext): FirehoseClient {
  return createAnalyticsClients(ctx).firehose;
}

/** The Firehose failed-record bucket's name. See {@link ERROR_BUCKET_SUFFIX}. */
function errorBucketName(ctx: AnalyticsContext): string {
  return boundedName(
    `${ctx.names.prefix}${ERROR_BUCKET_SUFFIX}`,
    ERROR_BUCKET_NAME_MAX_LENGTH,
    'error bucket',
  );
}

/** The Firehose delivery role's name. See {@link ERROR_BUCKET_SUFFIX}. */
function firehoseRoleName(ctx: AnalyticsContext): string {
  return boundedName(
    `${ctx.names.prefix}${FIREHOSE_ROLE_SUFFIX}`,
    ROLE_NAME_MAX_LENGTH,
    'Firehose delivery role',
  );
}

/** The delivery stream's name. See {@link ERROR_BUCKET_SUFFIX}. */
function streamName(ctx: AnalyticsContext): string {
  return boundedName(
    `${ctx.names.prefix}${FIREHOSE_STREAM_SUFFIX}`,
    STREAM_NAME_MAX_LENGTH,
    'delivery stream',
  );
}

/**
 * The log group Firehose writes its delivery errors to - **the one home this
 * string has**, for {@link transformLogGroupName}'s reason and with more riding
 * on it. `analytics-firehose-log-group` creates the group under this name
 * today; the delivery role's grant on the stream inside it and the stream's own
 * `CloudWatchLoggingOptions` are the two readers that follow, and each is meant
 * to reach the name through this helper rather than spell a third literal of
 * it. Firehose writes to whatever group its logging options name, so three
 * spellings would fail as an empty group rather than as an error.
 *
 * Derived from {@link streamName} rather than from `ctx.names.prefix`, so the
 * group is named after the stream whose errors it holds even if that stream's
 * suffix ever changes.
 */
function firehoseLogGroupName(ctx: AnalyticsContext): string {
  return `${FIREHOSE_LOG_GROUP_PREFIX}${streamName(ctx)}`;
}

/**
 * The ARN of the one log stream Firehose writes its delivery errors to, which
 * the delivery role's `logs:PutLogEvents` grant is scoped to.
 *
 * Not {@link analyticsLogGroupArn}'s `:*` form, and the difference is the whole
 * point of a separate helper: the group ARN's trailing wildcard grants every
 * stream the group will ever hold, while `PutLogEvents` authorises against a
 * stream ARN and this role writes to exactly one. Both halves come from the
 * same two helpers the log-group node and the stream's own
 * `CloudWatchLoggingOptions` reach for, so the grant cannot name a stream that
 * is not the one being written to.
 */
function firehoseLogStreamArn(ctx: AnalyticsContext): string {
  const group = firehoseLogGroupName(ctx);
  return `arn:aws:logs:${ANALYTICS_REGION}:${ctx.accountId}:log-group:${group}:log-stream:${DESTINATION_DELIVERY_STREAM}`;
}

/**
 * The error bucket's ARN as `analytics-error-bucket` recorded it. See
 * {@link requireRecordedArn}.
 *
 * Read back rather than re-derived even though an S3 bucket ARN *is* derivable
 * from its name, and that is the point: the read is what makes the declared
 * edge load-bearing. The role declares `analytics-error-bucket` directly; the
 * stream inherits the same ordering transitively through its edge on the role,
 * which is the spec's own `error-bucket -> firehose-role -> firehose-stream`
 * chain. Deriving here instead would let either of them name a bucket that does
 * not exist yet - and Firehose accepts a `BucketARN` for a bucket it cannot
 * write to, so the first symptom would be records failing to a bucket that was
 * never created.
 */
function requireErrorBucketArn(ctx: AnalyticsContext, dependent: string): string {
  return requireRecordedArn(ctx, {
    what: 'error bucket',
    node: ERROR_BUCKET_NODE,
    dependent,
    lack: "bucket to write Firehose's failed records to",
  });
}

/** The `page_views` table's ARN as `analytics-table` recorded it. See {@link requireRecordedArn}. */
function requireTableArn(ctx: AnalyticsContext): string {
  return requireRecordedArn(ctx, {
    what: 'page_views table',
    node: TABLE_NODE,
    dependent: FIREHOSE_ROLE_NODE,
    lack: 'table to grant s3tables write access on',
  });
}

/**
 * The transform function's ARN as `analytics-transform-function` recorded it.
 * See {@link requireRecordedArn}. Read rather than re-derived from
 * {@link transformFunctionName}: the recorded value is the ARN Lambda itself
 * answered with, and it is what both readers need - the role grants
 * `lambda:InvokeFunction` on it and the stream's processor names it as
 * `LambdaArn`, so a derivation that drifted would produce a grant on one ARN
 * and an invoke of another.
 */
function requireTransformFunctionArn(ctx: AnalyticsContext, dependent: string): string {
  return requireRecordedArn(ctx, {
    what: 'transform function',
    node: TRANSFORM_FUNCTION_NODE,
    dependent,
    lack: 'record-transform Lambda to run every record through',
  });
}

/** The delivery role's ARN as `analytics-firehose-role` recorded it. See {@link requireRecordedArn}. */
function requireFirehoseRoleArn(ctx: AnalyticsContext): string {
  return requireRecordedArn(ctx, {
    what: 'Firehose delivery role',
    node: FIREHOSE_ROLE_NODE,
    dependent: FIREHOSE_STREAM_NODE,
    lack: 'role for Firehose to assume',
  });
}

/**
 * The Glue catalog ARN Firehose reaches this environment's Iceberg table
 * through: the **child** catalog the S3 Tables integration creates per table
 * bucket, `arn:aws:glue:<region>:<account>:catalog/s3tablescatalog/<bucket>`.
 *
 * Derived rather than read off `analytics-catalog-integration`'s recorded ARN,
 * which is a different string - that node adopts the account-wide federation
 * root (`.../catalog/s3tablescatalog`), one level above this. So the stream's
 * edge on that node is an *existence* dependency, not an interpolation one: the
 * federation has to be enabled before Firehose can resolve this child catalog,
 * and there is nothing recorded there to interpolate.
 *
 * The bare `arn:aws:glue:<region>:<account>:catalog` form - which is what
 * `CatalogConfiguration.CatalogARN`'s prose names - is the account's own Data
 * Catalog and holds no S3 Tables table at all. The field's pattern allows up to
 * two further segments precisely so this form fits; `aws/firehose.ts` records
 * that on the field itself.
 */
function federatedCatalogArn(ctx: AnalyticsContext): string {
  const bucket = resolveAnalyticsConfig(ctx).tableBucket;
  return `arn:aws:glue:${ANALYTICS_REGION}:${ctx.accountId}:catalog/${CATALOG_NAME}/${bucket}`;
}

/**
 * The five concrete Glue resources the delivery role's catalog grant names,
 * following AWS's own S3 Tables delivery policy - which writes the last three
 * with account-wide wildcards for the child catalog, the database and the
 * table, and is narrowed here to this environment's own table bucket, namespace
 * and table.
 *
 * Every level of the hierarchy has to be named because Glue authorises the walk
 * down it, not just the leaf: the account catalog, the federation root, this
 * table bucket's child catalog, the namespace as a database, and the table.
 * Dropping a level does not produce a smaller working grant - it produces a
 * `GetTable` that is denied, which Firehose reports by routing every record to
 * the error bucket.
 */
function glueGrantResources(ctx: AnalyticsContext): string[] {
  const analytics = resolveAnalyticsConfig(ctx);
  const glueArn = `arn:aws:glue:${ANALYTICS_REGION}:${ctx.accountId}`;
  const child = `${CATALOG_NAME}/${analytics.tableBucket}`;
  return [
    `${glueArn}:catalog`,
    `${glueArn}:catalog/${CATALOG_NAME}`,
    `${glueArn}:catalog/${child}`,
    `${glueArn}:database/${child}/${analytics.namespace}`,
    `${glueArn}:table/${child}/${analytics.namespace}/${analytics.table}`,
  ];
}

/**
 * Apply the delivery role's inline policy. Shared by `create` and `update` -
 * the `applyExecRolePolicy` pattern (`packages/cli/src/nodes.ts:180-216`) - so
 * a reconcile of an existing role rewrites the same document a fresh one gets,
 * and a table recreated under a new generated ARN reaches the policy without a
 * teardown.
 *
 * **Exactly five statements, one per capability the change spec names, every
 * `Resource` a concrete ARN and none of them `*`.** The action lists are AWS's
 * own, from the "Grant Firehose access to Amazon S3 Tables" policy under IAM
 * access control; what is narrowed is the resources, which that policy writes
 * with wildcards over the whole account.
 *
 * Three of the five are easy to get subtly wrong and are worth stating:
 *
 * - the error-bucket statement names the bucket **and** `<bucket>/*`. Bucket
 *   actions (`s3:ListBucket`, `s3:GetBucketLocation`) authorise against the
 *   bucket ARN and object actions (`s3:PutObject`) against the key ARN, and
 *   neither ARN matches the other. With only the bucket named, `PutObject`
 *   would be denied and every failed record would be lost outright - which is
 *   the one failure this whole bucket exists to make recoverable.
 * - the lambda statement names the transform's **unqualified** function ARN,
 *   the one `analytics-transform-function` recorded, because that is the exact
 *   string the stream sends as `LambdaArn`. AWS's example writes a
 *   `:<version>`-qualified ARN; a qualified resource does not match an
 *   unqualified invoke, so copying it would deny every transform call and send
 *   every record to the error bucket.
 *
 * - the CloudWatch Logs statement names the **one log stream** Firehose writes
 *   its delivery errors to, `<firehose log group>:log-stream:DestinationDelivery`,
 *   and not the group's `:*` form. `logs:PutLogEvents` authorises against the
 *   stream ARN, and this role writes to exactly one stream, so the wildcard the
 *   group ARN carries would grant every stream a future group ever holds. Only
 *   `PutLogEvents`: `analytics-firehose-log-group` creates the group *and* the
 *   stream, so the role has nothing to create - the shape
 *   `analytics-transform-role`'s grant has, one action shorter.
 *
 * That fifth statement is the only one of the three AWS's own policy adds that
 * this pipeline needs. The other two stay out: Kinesis (this stream is
 * `DirectPut`) and KMS (no customer-managed key is configured anywhere in this
 * pipeline), each conditional on a feature this pipeline does not use.
 */
async function applyFirehoseRolePolicy(ctx: AnalyticsContext): Promise<void> {
  const errorBucketArn = requireErrorBucketArn(ctx, FIREHOSE_ROLE_NODE);
  await ctx.clients.iam.putRolePolicy(firehoseRoleName(ctx), FIREHOSE_ROLE_POLICY, {
    Version: POLICY_VERSION,
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'glue:GetDatabase',
          'glue:GetDatabases',
          'glue:GetTable',
          'glue:GetTables',
          'glue:UpdateTable',
        ],
        Resource: glueGrantResources(ctx),
      },
      {
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
        Resource: [tableBucketArn(ctx), requireTableArn(ctx)],
      },
      {
        // `lambda:GetFunctionConfiguration` travels with the invoke in AWS's own
        // single statement for this capability: Firehose reads the function's
        // timeout before it invokes, so an invoke-only grant leaves the
        // processor unusable rather than merely unobservable.
        Effect: 'Allow',
        Action: ['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'],
        Resource: requireTransformFunctionArn(ctx, FIREHOSE_ROLE_NODE),
      },
      {
        // The plugin's OWN error bucket, never the site's environment bucket -
        // the one the CLI's `bucketNode` creates off `ctx.names`. That one sits
        // in `config.region` while this stream is pinned to us-east-1, and an S3
        // ARN carries no region, so the API can neither express nor reject the
        // mismatch. See `analyticsErrorBucketNode`. A schema mismatch sends
        // *every* affected record here, so this is a normal path, not a rare one.
        Effect: 'Allow',
        Action: [
          's3:AbortMultipartUpload',
          's3:GetBucketLocation',
          's3:GetObject',
          's3:ListBucket',
          's3:ListBucketMultipartUploads',
          's3:PutObject',
        ],
        Resource: [errorBucketArn, `${errorBucketArn}/*`],
      },
      {
        // Without this the destination's `CloudWatchLoggingOptions` are inert:
        // Firehose is told where to write its delivery errors and is not allowed
        // to, so the failure it was meant to explain stays as silent as before.
        Effect: 'Allow',
        Action: ['logs:PutLogEvents'],
        Resource: firehoseLogStreamArn(ctx),
      },
    ],
  });
}

/**
 * The Iceberg destination the stream is created and reconciled against, built
 * in one place so the create payload and the `UpdateDestination` payload cannot
 * drift - the reason {@link transformConfiguration} exists for the transform
 * function, and the same reason.
 *
 * Every resource in it is either a recorded output of a node this one declares
 * an edge to, or a derivation from the resolved analytics config; nothing is a
 * re-derived name.
 */
function firehoseDestination(ctx: AnalyticsContext): IcebergDestinationInput {
  const analytics = resolveAnalyticsConfig(ctx);
  return {
    catalogArn: federatedCatalogArn(ctx),
    roleArn: requireFirehoseRoleArn(ctx),
    namespace: analytics.namespace,
    tableName: analytics.table,
    // The plugin's own bucket, in us-east-1 with the rest of the pipeline -
    // never the site's environment bucket, the one the CLI's `bucketNode` owns,
    // which lives in `config.region`. `S3DestinationConfiguration.BucketARN` matches
    // `arn:.*:s3:::[\w\.\-]{1,255}`: an S3 ARN carries no region, so the API can
    // neither express the mismatch nor reject it, and Firehose's cross-region
    // documentation covers only HTTP endpoint destinations. A schema mismatch
    // sends *every* affected record here, so this is a normal path rather than a
    // rare one, and resting it on undocumented behaviour is what the plugin's
    // own bucket exists to avoid.
    errorBucketArn: requireErrorBucketArn(ctx, FIREHOSE_STREAM_NODE),
    errorOutputPrefix: ERROR_OUTPUT_PREFIX,
    bufferIntervalSeconds: STREAM_BUFFER_INTERVAL_SECONDS,
    bufferSizeMb: STREAM_BUFFER_SIZE_MB,
    transformLambdaArn: requireTransformFunctionArn(ctx, FIREHOSE_STREAM_NODE),
    // Both through the helpers `analytics-firehose-log-group` creates the group and
    // the stream under, and the delivery role grants on - one string each. Firehose
    // writes to whatever group its logging options name and creates nothing, so a
    // second spelling of either would fail as an empty group rather than as an error.
    logGroupName: firehoseLogGroupName(ctx),
    logStreamName: DESTINATION_DELIVERY_STREAM,
  };
}

/**
 * Record `value` under `key`, or remove a stale entry when the response carried
 * none.
 *
 * The removal is the half that matters. {@link output} re-records rather than
 * replaces, so a `failure` left over from a create that failed on a KMS error
 * would outlive the recovery and `analytics status` would go on reporting it;
 * an `appendOnly` left over from a describe that stopped reporting the flag
 * would make the reconcile below skip work it should do. Absent in the response
 * has to mean absent in state, which is the same rule the ARN guards in this
 * module state as "never record `''` as though it were an ARN" - one direction
 * each of the same discipline.
 */
function recordOptional(
  out: ResourceOutputs,
  key: string,
  value: string | boolean | undefined,
): void {
  if (value === undefined) delete out[key];
  else out[key] = value;
}

/**
 * What the reconcile is about to change, named for the operator reading the log
 * line, and only what actually differs.
 *
 * A single "AppendOnly <recorded> -> <desired>" would report a transition on
 * every reconcile, including the logging-only one where `AppendOnly` is `true`
 * on both sides - "AppendOnly true -> true", an operator told the reason for a
 * call is a field that did not move. The caller reaches this only past a guard
 * that returned on both flags matching, so at least one clause always fires and
 * the result is never empty.
 */
function destinationDrift(
  appendOnly: boolean | undefined,
  loggingEnabled: boolean | undefined,
): string {
  const parts: string[] = [];
  if (appendOnly !== STREAM_APPEND_ONLY) {
    parts.push(`AppendOnly ${String(appendOnly)} -> ${String(STREAM_APPEND_ONLY)}`);
  }
  if (loggingEnabled !== true) {
    parts.push(`error logging ${loggingEnabled === false ? 'off' : 'unrecorded'} -> on`);
  }
  return parts.join(', ');
}

/**
 * Record the delivery stream's identity and health from a `DescribeDeliveryStream`.
 *
 * `state` and `failure` are what `analytics status` reports (task 55), so the
 * stream's health is hydrated by the same `read` the reconcile runs and there is
 * no second describe path. `versionId` and `destinationId` are what
 * `UpdateDestination` cannot be called without, and `appendOnly` and
 * `loggingEnabled` are the two live flags the reconcile compares - the first
 * against {@link STREAM_APPEND_ONLY}, the second against error logging simply
 * being on. Both go through {@link recordOptional}, so a describe that stops
 * reporting one clears it rather than leaving a stale `true` that would make the
 * reconcile skip work it should do.
 *
 * The ARN is guarded on its value, the guard `analytics-table` and
 * `analytics-catalog-integration` both put on theirs: `describeDeliveryStream`
 * falls back to `''` for a body carrying no `DeliveryStreamARN`, and an empty
 * string recorded under `arn` reads downstream as a real one.
 */
function recordStream(ctx: AnalyticsContext, status: DeliveryStreamStatus): void {
  const out = output(ctx, FIREHOSE_STREAM_NODE);
  out.name = status.name;
  out.state = status.state;
  recordOptional(out, 'arn', status.arn === '' ? undefined : status.arn);
  recordOptional(out, 'versionId', status.versionId);
  recordOptional(out, 'destinationId', status.destinationId);
  recordOptional(out, 'appendOnly', status.appendOnly);
  recordOptional(out, 'loggingEnabled', status.loggingEnabled);
  recordOptional(out, 'failure', status.failure);
}

/**
 * Create the stream, record what exists as soon as it exists, then hydrate
 * everything only a describe can supply - and refuse to report success over a
 * stream that is not actually being created.
 *
 * **Record ordering**, which this module deliberately decides per node: the
 * name goes into state the moment `createDeliveryStream` returns, before the
 * describe, because `createDeliveryStream` answers with no ARN by design
 * (`aws/firehose.ts`) and a crash between the two calls must still leave the
 * stream recorded for `destroy` to remove. That is `analytics-table`'s ordering
 * and its reason. It is *not* `analytics-transform-function`'s, which also
 * records its source hash and configuration fingerprint before the lookup -
 * those are inputs it must not re-send, and this node has no equivalent to
 * protect. It is also not `analytics-catalog-integration`'s, which records
 * nothing at all until a check has passed, because that node adopts shared
 * state and this one owns what it creates.
 *
 * The guard at the end closes a hole that `createDeliveryStream`'s own
 * idempotency opens on the replacement path. That method swallows
 * `ResourceInUseException` as "already exists", which is right when a re-run
 * finds the stream it made last time - and wrong immediately after a delete,
 * where the same exception means the *old* stream is still `DELETING`. Without
 * this check the reconcile would report a replacement as done while the account
 * held a stream that was on its way out, and the first symptom would be an
 * empty dashboard. Re-running the bootstrap once the delete has settled is the
 * fix, and the message says so.
 */
async function createStream(
  ctx: AnalyticsContext,
  client: FirehoseClient,
  name: string,
  destination: IcebergDestinationInput,
): Promise<void> {
  await whileRoleIsPropagating(() => client.createDeliveryStream(name, destination, ctx.tags));
  output(ctx, FIREHOSE_STREAM_NODE).name = name;
  const created = await client.describeDeliveryStream(name);
  if (created !== undefined) recordStream(ctx, created);
  if (created === undefined || created.state === 'deleting' || created.state === 'delete-failed') {
    throw new Error(
      `the analytics delivery stream "${name}" is ${created === undefined ? 'not readable' : `still ${created.state}`} after CreateDeliveryStream reported success, so no stream is accepting records - a delete of the previous stream has not settled yet. Re-run \`blogwright analytics bootstrap --env ${ctx.env}\` in a minute.`,
    );
  }
}

/**
 * The S3 bucket every record Firehose cannot deliver is written to - **the
 * physical place a silent pipeline failure becomes visible.**
 *
 * Firehose matches incoming JSON keys to the Iceberg column names exactly and
 * *errors* the records that do not match to this bucket rather than dropping
 * them (the change spec quotes the behaviour). So a missing column, a table
 * whose catalog cannot be read, a Glue grant one level too narrow - none of
 * them raise anything an operator sees. They fill this bucket while the
 * dashboard stays empty, and this bucket is the only place the records
 * themselves still exist. Two properties follow.
 *
 * **It is in {@link ANALYTICS_REGION}, with the rest of the pipeline**, created
 * through the plugin's own {@link s3} client rather than `ctx.clients.s3`,
 * which signs in `config.region`.
 *
 * **It is not the site's environment bucket.** The bucket the CLI's own
 * `bucketNode` creates lives in
 * `config.region` and `S3DestinationConfiguration.BucketARN` matches
 * `arn:.*:s3:::[\w\.\-]{1,255}` - an S3 ARN carries no region, so the API can
 * neither express a cross-region bucket nor reject one, and Firehose's
 * cross-region documentation covers only HTTP endpoint destinations. Pointing
 * at the site's bucket would therefore rest the pipeline's one recovery surface
 * on undocumented behaviour, and would put failed-record objects - which carry
 * the raw CloudFront fields, the viewer IP among them, precisely because the
 * transform did not run on them - inside a bucket the site serves from.
 */
export function analyticsErrorBucketNode(): AnalyticsNode {
  return {
    id: ERROR_BUCKET_NODE,
    dependsOn: [],
    title: `Firehose failed-record bucket (${ANALYTICS_REGION})`,
    async read(ctx) {
      const name = errorBucketName(ctx);
      if (!(await s3(ctx).bucketExists(name))) return false;
      recordErrorBucket(ctx, name);
      return true;
    },
    async create(ctx) {
      const name = errorBucketName(ctx);
      const client = s3(ctx);
      await client.createBucket(name);
      // Identity before the secondary mutations, `bucketNode`'s ordering
      // (`packages/cli/src/nodes.ts:56-60`): a crash between CreateBucket and
      // the tagging/public-access calls must still leave the bucket recorded.
      recordErrorBucket(ctx, name);
      await applyErrorBucketConfiguration(ctx, name);
    },
    async update(ctx) {
      // Reconcile on every apply, for `bucketNode`'s reason: a bucket left by a
      // run that crashed before its tagging/PAB calls converges on the next one.
      await applyErrorBucketConfiguration(ctx, errorBucketName(ctx));
    },
    async delete(ctx) {
      const name = errorBucketName(ctx);
      const client = s3(ctx);
      // The existence check is what makes a re-run after a completed teardown a
      // no-op. `deleteBucket` swallows its own not-found, but `deletePrefix`
      // does not: it lists first, and `listObjects` rethrows, so a second
      // `analytics destroy` would fail on the half that was already done.
      if (!(await client.bucketExists(name))) return;
      // S3 refuses to delete a bucket that still holds objects, so the failed
      // records go first - and are counted, because they are the evidence of
      // whatever went wrong and an operator tearing the environment down is
      // owed the line that says how much of it was discarded.
      const removed = await client.deletePrefix(name, '');
      if (removed > 0) {
        ctx.logger.warn(
          `discarded ${removed} failed-record object(s) from "${name}" - these were the records Firehose could not deliver, and they are not recoverable after this`,
        );
      }
      await client.deleteBucket(name);
    },
  };
}

/**
 * Record the error bucket's identity. Shared by `read` and `create` for
 * {@link recordTableBucket}'s reason: both record the same two values from the
 * same two sources, and `bucketExists` answers with nothing to echo back.
 *
 * The ARN is derived rather than read off a response - an S3 bucket ARN carries
 * no region and no generated id, so it is a pure function of the name - which is
 * why it needs none of the "never record `''`" guards the response-derived ARNs
 * in this module carry. Recording it at all, rather than letting the two readers
 * derive it themselves, is what makes their declared edges load-bearing; see
 * {@link requireErrorBucketArn}.
 */
function recordErrorBucket(ctx: AnalyticsContext, name: string): void {
  const out = output(ctx, ERROR_BUCKET_NODE);
  out.name = name;
  out.arn = `arn:aws:s3:::${name}`;
}

/**
 * Tagging and the public-access block, both idempotent PUTs, shared by `create`
 * and `update` - `applyBucketConfiguration`'s shape
 * (`packages/cli/src/nodes.ts:38-42`).
 *
 * The public-access block is not decoration here. The objects in this bucket
 * are the records the transform Lambda did *not* successfully process, so they
 * carry CloudFront's raw fields - the viewer's IP address among them, the one
 * value the whole `visitor_key` derivation exists to keep out of storage. A
 * bucket that could be made public by a later policy or ACL would undo that for
 * exactly the records where it was never applied.
 */
async function applyErrorBucketConfiguration(ctx: AnalyticsContext, name: string): Promise<void> {
  const client = s3(ctx);
  await client.putBucketTagging(name, ctx.tags ?? {});
  await client.putPublicAccessBlock(name);
}

/**
 * The log group Firehose writes its delivery errors to, and the log stream
 * inside it that they are written to.
 *
 * **Firehose creates neither.** Enabling error logging through the API rather
 * than the console requires the group *and* the stream to exist in advance, so
 * this node creates both - and re-ensures the stream on every `update` beside
 * the retention, which is why {@link analyticsLogGroupNode} takes a stream at
 * all. Without that, a group left by a run that stopped between
 * `CreateLogGroup` and `CreateLogStream` is permanently one call short, with
 * `read()` reporting it present and `update()` doing nothing about it, and the
 * symptom is a delivery failure with nowhere to be explained.
 *
 * {@link DESTINATION_DELIVERY_STREAM} is the only stream created:
 * `BackupDelivery` belongs to a destination configured with S3 backup, and the
 * Iceberg destination this pipeline builds configures none.
 *
 * It is at the head of the chain that writes to it -
 * `analytics-firehose-stream` declares the edge - while the delivery role does
 * not, for the reason `analytics-transform-log-group`'s counterpart does not.
 */
export function analyticsFirehoseLogGroupNode(): AnalyticsNode {
  return analyticsLogGroupNode({
    id: FIREHOSE_LOG_GROUP_NODE,
    title: `Firehose delivery-error log group (${ANALYTICS_REGION})`,
    name: firehoseLogGroupName,
    stream: DESTINATION_DELIVERY_STREAM,
  });
}

/**
 * The role Firehose assumes to read the catalog, write the table, invoke the
 * transform, store what it could not deliver and say so in one log stream -
 * five grants, five concrete resources, no `*`.
 *
 * It declares `dependsOn` on the three nodes whose recorded ARNs those grants
 * interpolate. `topoSort` drains zero-indegree nodes alphabetically
 * (`packages/cli/src/graph.ts:35-38`), so a role declaring `dependsOn: []`
 * would be reconciled *before* `analytics-transform-function` - `f` sorts before
 * `t` - and the policy would interpolate an unrecorded output: a wrong
 * permission written silently, never an error. `githubOidcRoleNode`
 * (`packages/cli/src/nodes.ts:830`) is the precedent, declaring
 * `cloudfront-distribution` for exactly this reason.
 */
export function analyticsFirehoseRoleNode(): AnalyticsNode {
  return {
    id: FIREHOSE_ROLE_NODE,
    dependsOn: [ERROR_BUCKET_NODE, TABLE_NODE, TRANSFORM_FUNCTION_NODE],
    title: `IAM Firehose delivery role (global - IAM is not regional; it serves the ${ANALYTICS_REGION} pipeline)`,
    async read(ctx) {
      const name = firehoseRoleName(ctx);
      const arn = await ctx.clients.iam.getRoleArn(name);
      // Falsy rather than `=== undefined`, `analytics-transform-role`'s guard:
      // `getRoleArn` reads the ARN out of the response XML, so a body without
      // one answers `undefined` while an empty tag would answer `""`.
      if (!arn) return false;
      const out = output(ctx, FIREHOSE_ROLE_NODE);
      out.name = name;
      out.arn = arn;
      return true;
    },
    async create(ctx) {
      const name = firehoseRoleName(ctx);
      // `ctx.clients.iam`, the host's own client: IAM is a global service
      // (`packages/core/src/aws/endpoint.ts`'s GLOBAL_SERVICES), so core's
      // instance already signs us-east-1 and there is no region to get wrong.
      const arn = await ctx.clients.iam.ensureRole(
        name,
        FIREHOSE_TRUST,
        `Delivery role for the ${ctx.config.siteName} analytics Firehose stream`,
        ctx.tags,
      );
      // Recorded before the policy PUT, `analytics-transform-role`'s ordering
      // and its reason: the role is a real IAM object the moment `ensureRole`
      // returns, and if the policy call then fails, this entry is what tells the
      // next reconcile - and `delete` - that it exists. Nothing reads a role ARN
      // as "the role is configured": the stream reads it to name in its
      // destination, and `applyGraph` reconciles this node to completion first
      // (`packages/cli/src/graph.ts:74-97` rethrows, so the stream is never
      // reached after a failure here).
      const out = output(ctx, FIREHOSE_ROLE_NODE);
      out.name = name;
      out.arn = arn;
      await applyFirehoseRolePolicy(ctx);
    },
    async update(ctx) {
      await applyFirehoseRolePolicy(ctx);
    },
    async delete(ctx) {
      // Idempotent, and removes the inline policy first - `deleteRole`
      // (`packages/core/src/aws/iam.ts:128`) lists and deletes them, because IAM
      // refuses to delete a role that still carries one, and swallows the
      // not-found so a half-finished teardown is re-runnable.
      await ctx.clients.iam.deleteRole(firehoseRoleName(ctx));
    },
  };
}

/**
 * The delivery stream itself: CloudFront's records in, the transform Lambda in
 * front of the write, the `page_views` Iceberg table out, and the plugin's own
 * error bucket for everything that does not make it.
 *
 * Its four edges are the ones its payload actually reads. The role edge is the
 * spec's own rule - the `IcebergDestinationConfiguration` interpolates the
 * role's recorded ARN - and it also carries `analytics-error-bucket`
 * transitively, completing the `error-bucket -> firehose-role ->
 * firehose-stream` chain. Without the role edge the ordering would survive only
 * on `topoSort`'s alphabetical accident (`…-role` sorts before `…-stream`), the
 * exact coincidence-reliance the spec's implementation notes warn against.
 *
 * **The `AppendOnly` reconcile is written against neither AWS document.** The
 * Firehose considerations page says the flag is settable only with
 * `CreateDeliveryStream`; the `IcebergDestinationUpdate` API reference lists it
 * among the fields `UpdateDestination` accepts. They cannot both be right, and a
 * node written against either alone is a defect whichever one turns out to be.
 * So `update` attempts the in-place update first and falls back to replacing the
 * stream when it is refused - and only when it is refused: the re-read that
 * follows a successful update sits outside that `try`, because failing it is not
 * a rejection and replacing a stream that was updated correctly would be pure
 * loss. The order matters: `UpdateDestination` keeps the stream's ARN, while a
 * replacement gets a new one - so the CloudFront log delivery task 53 builds
 * would have to be repointed, and the records arriving during the gap are lost.
 * Which path ran is in the log line.
 */
export function analyticsFirehoseStreamNode(): AnalyticsNode {
  return {
    id: FIREHOSE_STREAM_NODE,
    dependsOn: [
      FIREHOSE_ROLE_NODE,
      TABLE_NODE,
      CATALOG_NODE,
      TRANSFORM_FUNCTION_NODE,
      // Not an ARN this node interpolates: the group has to exist before the
      // stream can report a delivery failure into it, and on teardown the
      // stream goes before the group that holds its errors.
      FIREHOSE_LOG_GROUP_NODE,
    ],
    title: `Firehose delivery stream (${ANALYTICS_REGION})`,
    async read(ctx) {
      const status = await firehose(ctx).describeDeliveryStream(streamName(ctx));
      // Absent: `create` runs. Note that a stream in any *live* state - including
      // `CREATING_FAILED` and `DELETING` - is present, not absent, and is
      // reported so deliberately. Answering `false` for one would send
      // `applyGraph` to `create`, whose `ResourceInUseException` is swallowed as
      // "already exists", and the reconcile would go green over a stream that
      // accepts nothing.
      //
      // What `update` then does with such a stream may be *nothing*: it branches
      // on the two recorded flags and nothing else, so a `CREATING_FAILED` or
      // `DELETING` stream that is already append-only with error logging on is
      // reconciled with zero AWS calls and reported done - the state is not part
      // of the comparison. That is stated rather than guarded because this
      // `read` is the hydration path - `recordStream` puts `state` and `failure`
      // into the plugin's scoped state, and reporting an unusable stream from
      // them is `analytics status`' job (task 55). Do not read this comment as a
      // promise that the reconcile refuses over a dead stream; it does not.
      if (status === undefined) return false;
      recordStream(ctx, status);
      return true;
    },
    async create(ctx) {
      const name = streamName(ctx);
      ctx.logger.step(
        `creating the analytics delivery stream "${name}" with AppendOnly ${STREAM_APPEND_ONLY}`,
      );
      await createStream(ctx, firehose(ctx), name, firehoseDestination(ctx));
    },
    async update(ctx) {
      const recorded = ctx.state.resources[FIREHOSE_STREAM_NODE];
      const appendOnly =
        typeof recorded?.['appendOnly'] === 'boolean' ? recorded['appendOnly'] : undefined;
      const loggingEnabled =
        typeof recorded?.['loggingEnabled'] === 'boolean' ? recorded['loggingEnabled'] : undefined;
      // Both live flags already match what this pipeline wants, so there is
      // nothing to reconcile and no AWS call at all. `undefined` does NOT match
      // either: a stream whose destination reported no flag, or a state file that
      // lost one, is a stream this node cannot claim is configured, and pushing
      // the desired configuration is the safe direction.
      //
      // **The logging half is what reaches the installed base.** Every stream
      // this plugin has created is append-only, so on `appendOnly` alone this
      // return fires for all of them and no already-deployed stream would ever
      // be switched from silent delivery failures to logged ones. The second
      // condition is what makes an existing stream reconcile exactly once: the
      // update sends `CloudWatchLoggingOptions`, the re-read records
      // `loggingEnabled: true`, and the next apply returns here.
      if (appendOnly === STREAM_APPEND_ONLY && loggingEnabled === true) return;

      const name = streamName(ctx);
      const client = firehose(ctx);
      const destination = firehoseDestination(ctx);
      const versionId = recordedText(ctx, FIREHOSE_STREAM_NODE, 'versionId');
      const destinationId = recordedText(ctx, FIREHOSE_STREAM_NODE, 'destinationId');

      // Falsy rather than `!== undefined`, the guard `analytics-transform-role`'s
      // `read` and `analytics-table`'s ARN both use: an empty recorded string is
      // no more a version id than a missing one, and an empty
      // `CurrentDeliveryStreamVersionId` fails the service's own `[0-9]+` pattern.
      if (versionId && destinationId) {
        // **Only the update call is in this `try`.** The re-read below is not,
        // and must never be: it runs *after* `UpdateDestination` returned 200,
        // so the stream is already reconfigured and still carries its ARN. A
        // transient failure there - `LimitExceededException`, a throttle,
        // anything `describeDeliveryStream` does not swallow as a not-found - is
        // not a refusal, and reaching the fallback on one would delete and
        // recreate a stream that was updated correctly: a NEW ARN, task 53's
        // CloudFront log delivery orphaned, the records in flight lost, and an
        // operator told the update was rejected when it succeeded.
        let refusal: string | undefined;
        try {
          ctx.logger.step(
            `updating the analytics delivery stream "${name}" in place (${destinationDrift(appendOnly, loggingEnabled)}) - UpdateDestination keeps the stream's ARN, so the CloudFront log delivery pointed at it is untouched`,
          );
          await whileRoleIsPropagating(() =>
            client.updateDestination(name, destination, { versionId, destinationId }),
          );
        } catch (err) {
          // The branch the contradicting documentation makes necessary. Not
          // narrowed to one exception: whichever way AWS resolves it, a refused
          // update has to reach the fallback rather than abort the reconcile.
          // `String(err)` rather than the error itself, so the sentinel is set
          // even for a thrown `undefined`.
          refusal = String(err);
        }

        if (refusal === undefined) {
          try {
            // Re-read: the update bumps `VersionId`, so a state file still
            // holding the old one would fail the next `UpdateDestination` on a
            // ConcurrentModificationException it did not cause.
            const updated = await client.describeDeliveryStream(name);
            if (updated !== undefined) recordStream(ctx, updated);
          } catch (err) {
            // Warn and carry on rather than rethrow: the update is done, and the
            // only casualty is a recorded version id that is now one behind.
            // `read` re-hydrates it on the next reconcile, which is the same
            // path that would recover a state file that never had one.
            ctx.logger.warn(
              `the analytics delivery stream "${name}" could not be re-read after UpdateDestination succeeded (${String(err)}) - the update is applied and the stream keeps its ARN, but the recorded version id is now stale until the next reconcile refreshes it`,
            );
          }
          ctx.logger.ok(`updated the analytics delivery stream "${name}" in place`);
          return;
        }

        ctx.logger.warn(
          `UpdateDestination was refused for the analytics delivery stream "${name}" (${refusal}) - falling back to replacing it`,
        );
      } else {
        ctx.logger.warn(
          `the analytics delivery stream "${name}" has no recorded version id and destination id, which UpdateDestination requires - falling back to replacing it`,
        );
      }

      ctx.logger.warn(
        `replacing the analytics delivery stream "${name}": the new stream carries a NEW ARN, so the CloudFront log delivery has to be reconciled against it, and records arriving during the gap are lost`,
      );
      await client.deleteDeliveryStream(name);
      await createStream(ctx, client, name, destination);
    },
    async delete(ctx) {
      // No-op when the stream is already gone (`aws/firehose.ts` swallows the
      // not-found and nothing else - including `ResourceInUseException`, which on
      // this operation means "still CREATING", not "already deleted"), so a
      // half-finished teardown is re-runnable. `destroyGraph` walks the chain in
      // reverse, so this runs before `analytics-firehose-role` removes the role
      // the stream assumes.
      await firehose(ctx).deleteDeliveryStream(streamName(ctx));
    },
  };
}

/**
 * The suffix the plugin's own CloudWatch delivery destination carries,
 * appended to `ctx.names.prefix`. See {@link ERROR_BUCKET_SUFFIX} for why the
 * prefix rather than {@link resolveAnalyticsConfig} is the source of the
 * environment: the `analytics` block owns six settings and this is not one of
 * them, so there is no operator override to honour.
 *
 * **It must not resolve to `ctx.names.deliveryDestination`, and that single
 * property is what the site's own teardown guard rests on.** AWS permits
 * exactly one delivery source per distribution, so this plugin's delivery
 * necessarily hangs off the source the site created, and
 * `packages/cli/src/nodes.ts`'s `isOwnDelivery` tells the two apart by the one
 * thing that distinguishes them: the final `:`-separated segment of a
 * delivery's `deliveryDestinationArn`, which is the destination's name,
 * compared against `ctx.names.deliveryDestination` (`<env>-<siteName>-cf-dest`,
 * `packages/core/src/config.ts`). A suffix that made the two names equal would
 * make `blogwright destroy` treat this plugin's delivery as the site's own and
 * tear the shared source out from under it without refusing - the exact
 * failure task 52's two guards exist to prevent, and the reason this name is
 * `-analytics-cf-dest` and not `-cf-dest`.
 */
const LOG_DESTINATION_SUFFIX = '-analytics-cf-dest';

/**
 * The longest name CloudWatch Logs accepts for a delivery destination
 * (`PutDeliveryDestination`'s `name`: 1..60 characters, `[\w-]*`). Checked
 * where the name is derived, the guard {@link boundedName} applies to every
 * other derived name in this module - `ctx.names.prefix` is bounded only by
 * the site bucket's 63, so an environment and site name that fit everywhere
 * else can still overrun this one.
 */
const LOG_DESTINATION_NAME_MAX_LENGTH = 60;

/**
 * The format CloudWatch Logs renders each CloudFront record in before handing
 * it to the Firehose stream, and the one value here the transform Lambda makes
 * non-negotiable: `transform/handler.ts` base64-decodes each record and
 * `JSON.parse`s it, and `transform/map-record.ts` reads CloudFront field names
 * (`timestamp(ms)`, `c-ip`, `cs-uri-stem`) off the parsed object. `plain`,
 * `w3c` and `raw` all deliver delimited text that `JSON.parse` throws on, which
 * the handler reports as `ProcessingFailed` for every record: the error bucket
 * fills, the dashboard stays empty, and nothing names this constant as the
 * cause. `parquet` is an S3-destination format and has no meaning for a
 * Firehose destination at all.
 *
 * Because the format is `json`, `createDelivery`'s `fieldDelimiter` is
 * deliberately **not** sent - see {@link analyticsLogDeliveryNode}'s `create`.
 *
 * It is recorded beside the destination's ARN because it is immutable once the
 * destination exists; {@link analyticsLogDestinationNode}'s `update` is what
 * that recording is for.
 */
const DELIVERY_OUTPUT_FORMAT: DeliveryOutputFormat = 'json';

/**
 * How often {@link requireActiveStream} re-describes a delivery stream that is
 * still `CREATING`, and how long it waits before refusing. Firehose brings a
 * `DirectPut` stream to `ACTIVE` in well under a minute, so five minutes is
 * generous enough that a first bootstrap does not fail on a slow account and
 * short enough that a stream which is never going to become active is reported
 * rather than waited on indefinitely.
 */
const STREAM_ACTIVE_POLL_INTERVAL_MS = 5_000;

/** See {@link STREAM_ACTIVE_POLL_INTERVAL_MS} - the two are chosen as a pair. */
const STREAM_ACTIVE_TIMEOUT_MS = 5 * 60_000;

/**
 * The site's CloudFront distribution node, as `packages/cli/src/nodes.ts`
 * names it. A node id from the **site's** graph, spelled here rather than
 * imported because this package does not depend on `blogwright` and never
 * will: the site's outputs are reached read-only through
 * {@link requireSiteDeliverySource}.
 */
const SITE_DISTRIBUTION_NODE = 'cloudfront-distribution';

/**
 * The state key holding the UTC day this plugin's delivery was **first**
 * created - the idempotency bound the change spec's §Backfill of historical
 * logs defines and task 61 reads.
 *
 * Written once and never advanced. Backfill inserts only whole days *strictly
 * before* it, on the reasoning that Firehose received nothing before its
 * delivery existed, so the two paths' row sets are disjoint. The two error
 * directions are not symmetric, which is why the rule is write-once rather
 * than keep-current: a bound that is too *early* loses at most the day at the
 * seam, which the spec states and accepts, while a bound that moved *later*
 * would let backfill insert days Firehose had already delivered and silently
 * double every row in them. So a second reconcile, a re-created delivery and
 * the destination node's Conflict retry all leave it exactly as it was.
 *
 * `read` never writes it either, even though it hydrates the rest of this
 * node's outputs off the live delivery: `DescribeDeliveries` reports no
 * creation date, so a delivery found already attached to a state file that
 * lost this key leaves task 61 with no bound and an actionable refusal. That
 * is the loud direction, and it is preferred to today's date, which would be a
 * bound that moved later.
 *
 * Exported since task 61, which reads it. It was deliberately module-private
 * while nothing consumed it - an exported constant with no consumer is what
 * `pnpm knip` catches - but a private constant restated in its reader is worse
 * than an exported one: the two spellings would have to agree and nothing
 * would check that they did.
 */
export const CREATED_DAY_KEY = 'createdDay';

/** `YYYY-MM-DD` - the leading characters of an ISO-8601 timestamp that are its UTC day. */
const ISO_DAY_LENGTH = 10;

/**
 * The CloudWatch Logs client, taken off `ctx.clients` unchanged rather than
 * built by {@link createAnalyticsClients}, and the only client in this module
 * that is core's own instance. The change spec says why: `LogsClient` stays in
 * core because the *site* graph owns it, and `logsUsEast1` is already the
 * us-east-1 instance core built for CloudFront vended log delivery - the same
 * reason `ctx.clients.iam` is used unchanged for this plugin's two roles.
 * `ctx.clients.logs` would sign in `config.region`, where neither the site's
 * delivery source nor this plugin's stream exists.
 */
function logs(ctx: AnalyticsContext): LogsClient {
  return ctx.clients.logsUsEast1;
}

/** The plugin's own CloudWatch delivery destination name. See {@link LOG_DESTINATION_SUFFIX}. */
function logDestinationName(ctx: AnalyticsContext): string {
  return boundedName(
    `${ctx.names.prefix}${LOG_DESTINATION_SUFFIX}`,
    LOG_DESTINATION_NAME_MAX_LENGTH,
    'log delivery destination',
  );
}

/**
 * True when `delivery` is the one this plugin created.
 *
 * The mirror image of `packages/cli/src/nodes.ts`'s `isOwnDelivery`, and
 * deliberately the same test, because the two have to partition one shared
 * list: the final `:`-separated segment of a `delivery-destination` ARN is the
 * destination's name, and the destination a delivery feeds is the only thing
 * that distinguishes two deliveries hanging off one source. The names the two
 * predicates compare against are kept distinct by
 * {@link LOG_DESTINATION_SUFFIX}, so each selects exactly what the other
 * rejects.
 *
 * Position cannot stand in for it - `findDeliveryIdBySource` returns whichever
 * delivery AWS lists first, which on this source may well be the site's - and
 * neither can this node's recorded destination ARN, which is empty precisely
 * when the Conflict retry needs it, because `putDeliveryDestination` threw
 * before anything was recorded. A delivery AWS reports without a destination
 * ARN matches no name and so is not this plugin's: fail-closed, which here
 * means this plugin deletes only what it can attribute to itself.
 */
function isPluginDelivery(delivery: DeliverySummary, destinationName: string): boolean {
  return delivery.deliveryDestinationArn.split(':').pop() === destinationName;
}

/**
 * The ids of this plugin's own deliveries on the site's shared delivery
 * source. Every other delivery on it - the site's own CloudWatch copy above
 * all - is filtered out and left exactly as it was found.
 *
 * There is no refusal here, and the asymmetry with
 * `packages/cli/src/nodes.ts`'s `ownDeliveryIdsOrRefuse` is the point rather
 * than an omission. That function refuses outright when the shared source
 * carries a delivery the site does not own, because both of its callers go on
 * to delete the *source*, which AWS rejects while any delivery is still
 * attached - so a foreign delivery forecloses what it was about to do.
 * Nothing in this module ever deletes that source, so a delivery this plugin
 * does not own obstructs nothing here; it is simply not this plugin's to
 * touch, and the filter is the whole of the answer.
 */
async function pluginDeliveryIds(ctx: AnalyticsContext): Promise<string[]> {
  const destinationName = logDestinationName(ctx);
  const deliveries = await logs(ctx).deliveriesForSource(ctx.names.deliverySource);
  return deliveries.filter((d) => isPluginDelivery(d, destinationName)).map((d) => d.id);
}

/** Remove every delivery this plugin owns off the shared source, and nothing else. */
async function clearPluginDeliveries(ctx: AnalyticsContext): Promise<void> {
  for (const id of await pluginDeliveryIds(ctx)) {
    await logs(ctx).deleteDelivery(id);
  }
}

/**
 * The delivery stream's ARN as `analytics-firehose-stream` recorded it. See
 * {@link requireRecordedArn}.
 *
 * Read back rather than derived, which is what makes this node's one declared
 * edge load-bearing: `analytics-firehose-stream` sorts *after*
 * `analytics-log-destination` alphabetically, so `topoSort`'s zero-indegree
 * ordering would run this node first if the edge were dropped, and the
 * destination would be created pointing at `undefined`.
 */
function requireStreamArn(ctx: AnalyticsContext): string {
  return requireRecordedArn(ctx, {
    what: 'delivery stream',
    node: FIREHOSE_STREAM_NODE,
    dependent: LOG_DESTINATION_NODE,
    lack: 'stream to point the CloudWatch delivery destination at',
  });
}

/**
 * The delivery destination's ARN as `analytics-log-destination` recorded it.
 * See {@link requireRecordedArn}.
 */
function requireLogDestinationArn(ctx: AnalyticsContext): string {
  return requireRecordedArn(ctx, {
    what: 'log delivery destination',
    node: LOG_DESTINATION_NODE,
    dependent: LOG_DELIVERY_NODE,
    lack: 'destination to deliver the CloudFront records to',
  });
}

/**
 * Wait for the delivery stream to reach `ACTIVE`, and refuse rather than build
 * a delivery over one that never got there.
 *
 * **This is task 51's routed finding, discharged here rather than left
 * implicit.** `createStream` rejects only `deleting` and `delete-failed`, so
 * `applyGraph` reports `analytics-firehose-stream` done over a stream that is
 * still `CREATING`. That is right for *that* node - the stream is being
 * created, and nothing it does needs the stream to accept a record - and wrong
 * for this one, which is the first consumer that cares. The destination and
 * the delivery are where CloudWatch starts pushing records at the stream:
 * pointed at one that is not yet accepting them, the records are refused, no
 * node fails, `analytics status` reports every resource present, and the only
 * symptom is an empty dashboard with no error anywhere.
 *
 * **Waiting rather than refusing outright is the deliberate half.** A fresh
 * `analytics bootstrap` creates the stream and reaches this node seconds
 * later, so a bare refusal would fail every first run and be re-run into
 * success - which teaches an operator to re-run past this message rather than
 * read it. `pollUntil` is the precedent task 51's contract names, and the
 * CLI's own (`packages/cli/src/nodes.ts:705`, the distribution's deployment
 * wait).
 *
 * The `done` predicate settles on anything that is no longer `creating`, not
 * on `active` alone, so a stream that has already failed to create is reported
 * at once instead of being waited out for {@link STREAM_ACTIVE_TIMEOUT_MS}.
 * The check after it is what turns every non-`active` outcome into one message:
 * a `create-failed` stream, a stream deleted from under the run, and a stream
 * still `creating` when the deadline passed - `pollUntil` returns its last
 * value rather than throwing, so without this check a timeout would fall
 * straight through into creating the delivery.
 */
async function requireActiveStream(ctx: AnalyticsContext): Promise<void> {
  const name = streamName(ctx);
  const settled = await pollUntil(
    () => firehose(ctx).describeDeliveryStream(name),
    (status) => status === undefined || status.state !== 'creating',
    { intervalMs: STREAM_ACTIVE_POLL_INTERVAL_MS, timeoutMs: STREAM_ACTIVE_TIMEOUT_MS },
  );
  if (settled?.state === 'active') return;
  throw new Error(
    `the analytics delivery stream "${name}" is ${settled === undefined ? 'not readable' : settled.state} rather than active, so a CloudFront log delivery pointed at it would accept no records and nothing would report it - refusing to wire one. ${settled?.state === 'creating' ? `The stream is still being created; re-run \`blogwright analytics bootstrap ${ctx.env}\` in a minute.` : `Check the stream in the Firehose console, then re-run \`blogwright analytics bootstrap ${ctx.env}\`.`}`,
  );
}

/**
 * Create or repoint the delivery destination and record what it is.
 *
 * **Record ordering**, which this module decides per node: all three values
 * land after the one call returns, because there is exactly one call. The
 * incremental recording `packages/cli/src/nodes.ts:717-719` performs - which
 * `analytics-table` and `analytics-firehose-stream` both copy - exists to
 * survive a crash *between* two mutating calls, and this node makes no such
 * pair. Recording earlier would only claim a destination the service has not
 * confirmed; recording later is impossible, since the ARN arrives in the
 * response.
 *
 * The ARN carries this module's standing guard against recording `''` as
 * though it were an ARN (`putDeliveryDestination` falls back to the empty
 * string for a body carrying none). An unrecorded ARN makes `read` answer
 * false and the next reconcile re-put the destination, which is idempotent; an
 * empty one recorded under `arn` reads downstream as a real one, and
 * `analytics-log-delivery` would create its delivery against it.
 */
async function putLogDestination(
  ctx: AnalyticsContext,
  name: string,
  streamArn: string,
): Promise<void> {
  const arn = await logs(ctx).putDeliveryDestination(name, streamArn, {
    outputFormat: DELIVERY_OUTPUT_FORMAT,
  });
  const out = output(ctx, LOG_DESTINATION_NODE);
  out.name = name;
  recordOptional(out, 'arn', arn === '' ? undefined : arn);
  out.outputFormat = DELIVERY_OUTPUT_FORMAT;
}

/**
 * The CloudWatch delivery destination the site's CloudFront records are
 * delivered to - **this plugin's own, alongside the site's and never in place
 * of it.**
 *
 * Its one edge is the node whose recorded ARN it points at. `PutDeliveryDestination`
 * accepts a `destinationResourceArn` for a resource that does not exist yet, so
 * without the edge the destination would be created against `undefined` and the
 * first symptom would be records going nowhere - see {@link requireStreamArn}.
 *
 * The output format is the one thing about a destination that cannot be
 * changed once it exists, which is why `update` replaces rather than mutates
 * and why the configured format is recorded beside the ARN in the first place.
 */
export function analyticsLogDestinationNode(): AnalyticsNode {
  return {
    id: LOG_DESTINATION_NODE,
    dependsOn: [FIREHOSE_STREAM_NODE],
    title: `CloudWatch delivery destination (${ANALYTICS_REGION})`,
    async read(ctx) {
      // State, not AWS: core's `LogsClient` exposes no describe for a delivery
      // destination, and adding one is a change to core this task does not own.
      // `update` is what makes that safe rather than merely cheap - it re-puts
      // unconditionally, so a destination deleted outside this tool is restored
      // on the next reconcile instead of being believed present forever on the
      // strength of this answer. No `output()` call here: a `read` that finds
      // nothing must not leave an empty entry in the state file.
      const arn = ctx.state.resources[LOG_DESTINATION_NODE]?.arn;
      return typeof arn === 'string' && arn !== '';
    },
    async create(ctx) {
      const name = logDestinationName(ctx);
      // Resolved before the wait, so a missing edge fails with no AWS call at all.
      const streamArn = requireStreamArn(ctx);
      await requireActiveStream(ctx);
      try {
        await putLogDestination(ctx, name, streamArn);
      } catch (err) {
        // A destination left behind by a previous stack carries an output format
        // that cannot be changed, and `PutDeliveryDestination` answers a Conflict
        // rather than replacing it. Clear this plugin's own delivery and its own
        // destination and retry once - the shape of
        // `packages/cli/src/nodes.ts:743-761`, minus the one call in it that
        // would take the site down too.
        //
        // **The deliberate divergence is the absent `deleteDeliverySource`.**
        // The site's retry deletes the source at
        // `packages/cli/src/nodes.ts:758` because removing the source *is* its
        // retry: `PutDeliverySource` will not repoint an existing one. This
        // plugin never creates, repoints or deletes that source - it is the
        // site's, and the site's own CloudWatch delivery hangs off it. Copying
        // that line here would either throw (AWS rejects the delete while the
        // site's delivery is attached, and `deleteDeliverySource` swallows only
        // a not-found) or, once the site's delivery had gone with it, stop the
        // site's log delivery while the site's state still recorded it as
        // `configured`.
        //
        // The delivery is cleared before the destination for the same reason
        // the site's teardown deletes deliveries before the source
        // (`packages/cli/src/nodes.ts:763-768`): AWS rejects
        // `DeleteDeliveryDestination` while a delivery still points at it, and
        // `deleteDeliveryDestination` swallows only a not-found.
        if (!(err instanceof AwsError && /Conflict/i.test(err.code))) throw err;
        ctx.logger.step(
          `stale analytics delivery destination "${name}" from a previous stack - removing it and its delivery, and retrying`,
        );
        await clearPluginDeliveries(ctx);
        await logs(ctx).deleteDeliveryDestination(name);
        await putLogDestination(ctx, name, streamArn);
      }
    },
    async update(ctx) {
      const name = logDestinationName(ctx);
      const recorded = recordedText(ctx, LOG_DESTINATION_NODE, 'outputFormat');
      // A state file carrying no recorded format is NOT treated as a mismatch,
      // which is the opposite of `analytics-firehose-stream`'s `undefined`
      // handling and for the opposite reason. There, pushing the desired
      // configuration is an in-place `UpdateDestination` that costs nothing;
      // here it is a delete and a re-create that drops the delivery and loses
      // the records arriving in the gap. Destructive on a guess is the wrong
      // direction, and the re-put below still converges everything mutable.
      if (recorded !== undefined && recorded !== DELIVERY_OUTPUT_FORMAT) {
        // **The output format is immutable once a destination exists**, so this
        // is a replacement and not an update: `PutDeliveryDestination` over a
        // live destination does not change the format it renders records in
        // (the change spec's §`LogsClient` delivery configuration says so in as
        // many words). Delete, then re-create.
        //
        // This plugin's own delivery has to come off first - AWS rejects
        // `DeleteDeliveryDestination` while a delivery points at it. That
        // leaves the delivery missing, which is exactly what
        // `analytics-log-delivery`'s `read` is written to notice: it lists the
        // deliveries on the site's source rather than trusting its own state,
        // so the same reconcile pass re-creates it. This node is its declared
        // dependency, so it always runs first.
        ctx.logger.warn(
          `the analytics delivery destination "${name}" was created with output format "${recorded}" and this build needs "${DELIVERY_OUTPUT_FORMAT}", which cannot be changed in place - replacing it, and the records arriving during the gap are lost`,
        );
        await clearPluginDeliveries(ctx);
        await logs(ctx).deleteDeliveryDestination(name);
      }
      // Re-put on every reconcile, `bucketPolicyNode`'s discipline
      // (`packages/cli/src/nodes.ts`): `PutDeliveryDestination` is an
      // idempotent upsert and the resource ARN it carries is not fixed.
      // `analytics-firehose-stream`'s own `update` falls back to *replacing*
      // the stream, and a replacement carries a NEW ARN - "the CloudFront log
      // delivery has to be reconciled against it", in that node's own words.
      // This is the reconcile that does it.
      const streamArn = requireStreamArn(ctx);
      await requireActiveStream(ctx);
      await putLogDestination(ctx, name, streamArn);
    },
    async delete(ctx) {
      // Only this plugin's destination, and never the shared delivery source.
      // The delivery pointing at it is gone by now: `destroyGraph` walks the
      // topological order in reverse (`packages/cli/src/graph.ts`), so
      // `analytics-log-delivery` - which declares this node as its dependency -
      // has already run. That is the same delivery-before-destination ordering
      // the site's own teardown comment documents at
      // `packages/cli/src/nodes.ts:763-768`, expressed as an edge rather than
      // as two statements in one node, because here the two resources are two
      // nodes. `deleteDeliveryDestination` swallows a not-found, so a
      // half-finished teardown is re-runnable.
      await logs(ctx).deleteDeliveryDestination(logDestinationName(ctx));
    },
  };
}

/**
 * The site's half of the wiring: the shared delivery source, and the
 * distribution whose logs travel through it.
 */
interface SiteDeliverySource {
  /** `ctx.names.deliverySource` - the source the site's own node created. */
  readonly source: string;
  /** The site's CloudFront distribution ARN, read from the site's recorded outputs. */
  readonly distribution: string;
}

/**
 * The site's delivery source and the distribution behind it, or a throw naming
 * `blogwright bootstrap` as the fix.
 *
 * **Both are read off the site and neither is written.** The name comes from
 * `ctx.names`, the deterministic set core derived for this environment, and
 * the distribution ARN from `ctx.siteState` - the read-only view of
 * `state/<env>.json` the SPI provides, every property `readonly` all the way
 * into the map values. Never from a `StateStore` constructed over the site's
 * key: `ctx.store`, `ctx.state` and `ctx.save()` are all scoped to
 * `state/<env>.analytics.json`, and `siteState` is the only route to the
 * site's own file. That distinction typechecks either way, so it is stated
 * here rather than left to be noticed in an S3 key.
 *
 * The distribution ARN is what makes this a bootstrap check rather than a
 * derivation. `ctx.names.deliverySource` is a pure function of the
 * environment, so it names a source whether or not one exists; the site's
 * recorded distribution ARN is the observable saying the site graph has
 * actually run, and the site's node creates the delivery source in the same
 * `wire()` that records it (`packages/cli/src/nodes.ts:713-734`).
 *
 * The source is checked too, even though `deriveNames` cannot produce an empty
 * one, so that the guard's name and its body agree on their own - the same
 * re-application `packages/cli/src/nodes.ts`'s `ownDeliveryIdsOrRefuse` makes
 * of its own predicate, and for the same reason.
 */
function requireSiteDeliverySource(ctx: AnalyticsContext): SiteDeliverySource {
  const source = ctx.names.deliverySource;
  const distribution = ctx.siteState.resources[SITE_DISTRIBUTION_NODE]?.arn;
  if (source === '' || typeof distribution !== 'string' || distribution === '') {
    const missing =
      source === ''
        ? 'no delivery source name was derived for this environment'
        : `${SITE_DISTRIBUTION_NODE} has no recorded ARN in the site's state`;
    throw new Error(
      `the "${ctx.env}" site's CloudFront log delivery source is not available (${missing}), and this plugin never creates one - it hangs its delivery off the source the site already owns; run \`blogwright bootstrap ${ctx.env}\` first`,
    );
  }
  return { source, distribution };
}

/**
 * Today's UTC day as `YYYY-MM-DD`. `Date.prototype.toISOString` renders in UTC
 * by definition, so the day recorded here is in the same calendar as the
 * table's `day` partition, which `transform/map-record.ts` derives from
 * CloudFront's `timestamp(ms)` - also UTC. The two have to agree, because task
 * 61's backfill compares partition days against this bound.
 */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, ISO_DAY_LENGTH);
}

/**
 * The delivery joining the site's existing delivery source to this plugin's
 * destination - **a second delivery on a source the plugin reads, never
 * creates, never repoints and never deletes.**
 *
 * `putDeliverySource` is not called here and must never be. AWS permits one
 * delivery source per distribution and the site's node owns it
 * (`packages/cli/src/nodes.ts`'s `logDeliveryNode`); this node reads its name
 * off `ctx.names` and attaches a second delivery beside the site's CloudWatch
 * one. The site's copy is left with the field list AWS defaults to, which is
 * deliberate and is `schema.ts`'s to explain.
 *
 * There is no `update`. CloudWatch Logs has no `UpdateDelivery`: the record
 * fields a delivery selects are fixed when it is created, exactly as the
 * `page_views` table's schema is fixed when *it* is created
 * (`aws/s3tables.ts`'s `createTable` reconciles no existing schema). Changing
 * the column set is a rebuild of this pipeline in both places, not a
 * reconcile, and pretending otherwise in one of the two would be worse than
 * saying so in both.
 */
export function analyticsLogDeliveryNode(): AnalyticsNode {
  return {
    id: LOG_DELIVERY_NODE,
    dependsOn: [LOG_DESTINATION_NODE],
    title: `CloudFront log delivery to the analytics stream (${ANALYTICS_REGION})`,
    async read(ctx) {
      // AWS, not state, and for a reason the state cannot cover: this
      // delivery lives on a source two stacks share, so it can go missing
      // without this plugin doing anything - the destination replacement below
      // detaches it on purpose, and a site re-bootstrap can reach it too.
      // Listing is also what `delete` has to do anyway (`createDelivery`
      // returns no id, so there is nothing to record and look up later), so
      // this costs one call that the teardown path already pays.
      const site = requireSiteDeliverySource(ctx);
      const destinationName = logDestinationName(ctx);
      const found = (await logs(ctx).deliveriesForSource(site.source)).find((delivery) =>
        isPluginDelivery(delivery, destinationName),
      );
      if (found === undefined) return false;
      const out = output(ctx, LOG_DELIVERY_NODE);
      out.source = site.source;
      out.destination = found.deliveryDestinationArn;
      out.distribution = site.distribution;
      out.delivery = 'configured';
      // `createdDay` is deliberately absent from this hydration - see
      // {@link CREATED_DAY_KEY}. `output` re-records rather than replaces, so
      // one already in state survives this untouched.
      return true;
    },
    async create(ctx) {
      // Both reads happen before the call, so an unbootstrapped site and a
      // missing destination each fail with nothing sent.
      const site = requireSiteDeliverySource(ctx);
      const destinationArn = requireLogDestinationArn(ctx);
      const requestDay = utcDay(new Date());
      await logs(ctx).createDelivery(site.source, destinationArn, {
        // `CLOUDFRONT_RECORD_FIELDS`, never a list restated here: `schema.ts`
        // owns which CloudFront fields exist, which ones fill a column, and
        // which two (`cs(Cookie)`, `x-forwarded-for`) are excluded because they
        // carry personal data with no analytic use.
        //
        // No `fieldDelimiter`, deliberately. AWS documents `createDelivery`'s
        // delimiter as applying "when the final output format of a delivery is
        // in plain, w3c, or raw format", and {@link DELIVERY_OUTPUT_FORMAT} is
        // `json` because the transform Lambda parses each record with
        // `JSON.parse`. Sending a delimiter with a JSON delivery would be a
        // request field with no meaning for this delivery at best, and a
        // `ValidationException` that fails every bootstrap at worst.
        recordFields: CLOUDFRONT_RECORD_FIELDS,
      });
      // **Record ordering.** Everything lands after the one call returns, for
      // {@link putLogDestination}'s reason: this node makes a single mutating
      // call, so there is no interval between two of them for a crash to fall
      // into, and the incremental recording at
      // `packages/cli/src/nodes.ts:717-719` is answering a problem this node
      // does not have. `createdDay` in particular must not be written ahead of
      // the call: a day recorded for a delivery that was never created is a
      // backfill bound covering records Firehose never received.
      const out = output(ctx, LOG_DELIVERY_NODE);
      out.source = site.source;
      out.destination = destinationArn;
      out.distribution = site.distribution;
      out.delivery = 'configured';
      // Write-once, and the only place this key is ever written. See
      // {@link CREATED_DAY_KEY} for why moving it later is the one direction
      // that corrupts data rather than merely losing some.
      if (typeof out[CREATED_DAY_KEY] !== 'string') out[CREATED_DAY_KEY] = requestDay;
    },
    async delete(ctx) {
      // This plugin's own deliveries and nothing else - **never
      // `deleteDeliverySource`**. The site's teardown deletes the source
      // (`packages/cli/src/nodes.ts:773`) because the site owns it; this one
      // must not, and task 52's guard on that node is what stops the site's
      // teardown running while this delivery still exists. Removing the source
      // from here would take the site's own CloudWatch delivery with it.
      //
      // Looked up by destination rather than recorded at create time, because
      // `createDelivery` answers with nothing - there is no id to record - and
      // rather than by `findDeliveryIdBySource`, which returns whichever
      // delivery AWS lists first and on this shared source may well return the
      // site's. `deleteDelivery` swallows a not-found, so a half-finished
      // teardown is re-runnable.
      await clearPluginDeliveries(ctx);
    },
  };
}

/**
 * The plugin's fourteen resource nodes, assembled in the order the change spec's
 * §Analytics pipeline → Resource nodes table lists them. This is what
 * `Plugin.nodes` (`plugin.ts`) hands the CLI's generic `analytics bootstrap`
 * and `analytics destroy` verbs, and it is the whole of what this package
 * contributes to a reconcile: the engine that walks them - `topoSort`,
 * `applyGraph`, `destroyGraph` - is the CLI's own and is never reimplemented
 * here.
 *
 * **The returned order is itself a topological order**, and that is a property
 * of this array rather than a coincidence of the table's layout: every node's
 * `dependsOn` names only nodes that appear EARLIER in it. That is worth stating
 * because it is exactly the witness `topoSort`'s two failure modes are the
 * absence of - a dependency naming a node outside the set, and a cycle - so a
 * test that checks it has proved the set passes `topoSort` without running a
 * second copy of `topoSort` to find out. `applyGraph` sorts the array again
 * regardless and does not rely on the order it arrives in; nothing here may
 * assume the reconcile follows this sequence, only that this sequence is a
 * legal one.
 *
 * **No `ctx` parameter, deliberately.** The SPI declares `nodes?(ctx)` and the
 * CLI calls it with one, so this function is assignable to it as written - a
 * zero-argument function satisfies a one-argument signature. None of the fourteen
 * factories needs a context to be *built*: each reads `ctx` inside `read`,
 * `create`, `update` and `delete`, when the reconcile is actually running. A
 * parameter accepted and ignored here would be an unused binding and, worse, a
 * claim that the SET varies with the context - it does not, and `analytics
 * status` and `analytics destroy` both depend on it not doing so. (The plan's
 * task 54 spells this function `buildAnalyticsNodes(ctx)`; the argument is what
 * changed, not the wiring.)
 *
 * A fresh array of fresh nodes on every call, matching `buildNodes`
 * (`packages/cli/src/nodes.ts`): a node object carries no state between
 * reconciles, and two calls in one process must not share one.
 */
export function buildAnalyticsNodes(): AnalyticsNode[] {
  return [
    // The table chain.
    analyticsTableBucketNode(),
    analyticsNamespaceNode(),
    analyticsTableNode(),
    analyticsCatalogIntegrationNode(),
    // The transform chain.
    analyticsSaltSecretNode(),
    analyticsTransformLogGroupNode(),
    analyticsTransformRoleNode(),
    analyticsTransformFunctionNode(),
    // The delivery chain.
    analyticsErrorBucketNode(),
    analyticsFirehoseLogGroupNode(),
    analyticsFirehoseRoleNode(),
    analyticsFirehoseStreamNode(),
    // The vended-delivery chain.
    analyticsLogDestinationNode(),
    analyticsLogDeliveryNode(),
  ];
}
