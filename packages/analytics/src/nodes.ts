/**
 * The analytics plugin's resource graph. It owns the AWS resources the
 * CloudFront-logs-to-Iceberg pipeline is built from and nothing else: the
 * site's own bucket, distribution and log group stay in the CLI's graph
 * (`packages/cli/src/nodes.ts`) and are never touched from here. This module
 * carries seven of them, in two chains. The table chain - the S3 Tables bucket,
 * the namespace inside it, the `page_views` table, and the Glue federation
 * Firehose reads that table through - runs `analytics-table-bucket` ->
 * `analytics-namespace` -> `analytics-table` ->
 * `analytics-catalog-integration`. The transform chain - the long-lived
 * `visitor_key` salt, the Lambda execution role whose policy names that
 * secret's ARN, and the record-transform function itself - runs
 * `analytics-salt-secret` -> `analytics-transform-role` ->
 * `analytics-transform-function`. Both chains are wired through `dependsOn`,
 * and a node depends on every node whose recorded ARN it interpolates. The
 * remaining five of the spec's twelve are appended to this module as later
 * tasks land,
 * and a later `buildAnalyticsNodes(ctx)` returns the assembled set to the SPI's
 * `Plugin.nodes`; nothing here assembles or reconciles anything itself.
 *
 * **Everything in this graph is created in `us-east-1`, whatever
 * `config.region` says.** CloudFront standard logging accepts a Firehose
 * delivery stream only in that region, so the whole pipeline - and therefore
 * the table the stream writes into - has to live there too. The pin is
 * enforced in exactly one place, `aws/clients.ts`, which builds every client
 * over the host's `signingUsEast1` signer; no node here picks a region for a
 * request. {@link ANALYTICS_REGION} below is the same region as *text*, needed
 * only because an ARN spells its region out.
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

import type {
  PluginContext,
  ResourceNode,
  ResourceOutputs,
  SecretsManagerClient,
} from 'blogwright-core';
import { zipSync } from 'fflate';

import { createAnalyticsClients } from './aws/clients.js';
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
import { PAGE_VIEWS_COLUMNS, PAGE_VIEWS_PARTITION_COLUMN } from './schema.js';
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

/** The `analytics-transform-role` node id. */
const TRANSFORM_ROLE_NODE = 'analytics-transform-role';

/** The `analytics-transform-function` node id. */
const TRANSFORM_FUNCTION_NODE = 'analytics-transform-function';

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
 * name the region too. Two different tests in `nodes.test.ts` pin the two
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
 * same bundle bytes always produce the same zip bytes -
 * `packageAndUploadAgent`'s `mtime` (`packages/cli/src/agent-package.ts:53`)
 * and the same reason: a zip stamped with the current time would differ on
 * every build, and the deployment decision has to turn on task 43's source
 * hash rather than on whether two archives happen to compare equal.
 */
const ZIP_MTIME = new Date('1980-01-01T00:00:00Z');

/** The deflate level `packageAndUploadAgent` uses. */
const ZIP_LEVEL = 6;

/**
 * The prefix Lambda derives a function's log group from. The group itself is
 * created by the Lambda service on first invocation and by no node in this
 * graph - see {@link transformLogGroupArn}.
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
 * The log group ARN the role's `logs:` grant is scoped to - the function's
 * **own** group and nothing else, the scoping
 * `packages/cli/src/nodes.ts:212` applies to the site's exec role.
 *
 * The region is {@link ANALYTICS_REGION} and not `ctx.config.region`, which is
 * the one place this ARN differs from the CLI's `logGroupArn` helper (whose
 * region parameter defaults to `ctx.config.region`, correctly, because the
 * function it scopes runs there). This function is pinned to us-east-1, so its
 * log group is too, and a grant naming the primary region would be a grant on a
 * group that never exists.
 *
 * **No node creates this group.** Lambda creates it implicitly on the
 * function's first invocation. That is worth stating because the policy below
 * grants `logs:CreateLogStream` and `logs:PutLogEvents` and *not*
 * `logs:CreateLogGroup`: the transform's own diagnostics therefore depend on
 * that implicit creation succeeding, and the pipeline's real failure signal is
 * elsewhere - a record the transform cannot map goes to Firehose's error prefix
 * (`transform/handler.ts`), and a batch that throws raises Firehose's own error
 * metric. Adding the group as a node of its own, with the retention the site's
 * log groups carry, is a coherent follow-up and is outside this node set.
 */
function transformLogGroupArn(ctx: AnalyticsContext): string {
  const group = `${LAMBDA_LOG_GROUP_PREFIX}${transformFunctionName(ctx)}`;
  return `arn:aws:logs:${ANALYTICS_REGION}:${ctx.accountId}:log-group:${group}:*`;
}

/**
 * The salt secret's ARN as `analytics-salt-secret` recorded it, or a throw
 * naming the missing edge.
 *
 * This ARN cannot be derived: Secrets Manager appends six random characters to
 * the name, which is why `packages/pds/src/nodes.ts` has to glob `<name>-*` in
 * its own grant and why this node instead depends on the node that reads the
 * real one back.
 *
 * What the declared `dependsOn` buys is that ordering *as a stated fact*, not
 * the ordering itself. `topoSort` drains its zero-indegree queue in
 * alphabetical order (`packages/cli/src/graph.ts:46-49`) and
 * `analytics-salt-secret` sorts before `analytics-transform-role`, so a role
 * declaring `dependsOn: []` would still be reconciled second today - by that
 * accident of the two ids, and by nothing else. The edge replaces the accident
 * with the constraint that is actually true: rename either node past the other
 * in sort order and the implicit ordering flips in silence (in teardown too,
 * which is this same order reversed - `graph.ts:107`), whereas the declared
 * edge either still holds or makes `topoSort` throw `depends on unknown node`
 * (`graph.ts:40`) before a single API call is made.
 *
 * The throw below is the runtime backstop under either regime: whatever the
 * order, the policy is never written with `undefined` interpolated into a live
 * IAM grant - a wrong permission written silently, never an error, and one
 * nothing downstream would notice until the transform's first
 * `GetSecretValue` was denied.
 *
 * The empty string is rejected as hard as `undefined`: `describeSecret` reads
 * the ARN straight off the response, so a body carrying none would leave a
 * grant on `""`.
 */
function requireSaltSecretArn(ctx: AnalyticsContext): string {
  const arn = ctx.state.resources[SALT_SECRET_NODE]?.arn;
  if (typeof arn !== 'string' || arn === '') {
    throw new Error(
      `the analytics salt secret's ARN is not recorded in the "${ctx.env}" plugin state, so ${TRANSFORM_ROLE_NODE} has no resource to grant secretsmanager:GetSecretValue on - ${SALT_SECRET_NODE} is this node's declared dependency and must be reconciled first; run \`blogwright analytics bootstrap --env ${ctx.env}\``,
    );
  }
  return arn;
}

/** The transform role's ARN as `analytics-transform-role` recorded it, or a throw. See {@link requireSaltSecretArn}. */
function requireTransformRoleArn(ctx: AnalyticsContext): string {
  const arn = ctx.state.resources[TRANSFORM_ROLE_NODE]?.arn;
  if (typeof arn !== 'string' || arn === '') {
    throw new Error(
      `the analytics transform role's ARN is not recorded in the "${ctx.env}" plugin state, so ${TRANSFORM_FUNCTION_NODE} has no execution role to run as - ${TRANSFORM_ROLE_NODE} is this node's declared dependency and must be reconciled first; run \`blogwright analytics bootstrap --env ${ctx.env}\``,
    );
  }
  return arn;
}

/**
 * Apply the transform role's inline policy. Shared by `create` and `update` -
 * the `applyExecRolePolicy` pattern (`packages/cli/src/nodes.ts:180-216`) - so
 * a reconcile of an existing role rewrites the same document a fresh one gets,
 * and a changed secret ARN or a changed function name reaches the policy
 * without a teardown.
 *
 * **Two statements, two concrete resources, no `*` anywhere.** The `logs`
 * statement names the function's own log group ({@link transformLogGroupArn});
 * the `secretsmanager` statement names the one secret this pipeline owns and
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
    title: 'IAM transform execution role',
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
 * The record-transform Lambda: the function Firehose runs over every CloudFront
 * record before it reaches the `page_views` table.
 *
 * Its code is keyed by task 43's hash of the transform's **source**, recorded
 * in the plugin's own state, so identical source never redeploys it - and the
 * key that hash derives (`transformZipKey`) is recorded beside it as the
 * artifact's name, even though the zip travels inline rather than through a
 * bucket (see {@link MAX_INLINE_ZIP_BYTES} for why inline).
 *
 * It depends on `analytics-transform-role`, whose recorded ARN it runs as.
 */
export function analyticsTransformFunctionNode(): AnalyticsNode {
  return {
    id: TRANSFORM_FUNCTION_NODE,
    dependsOn: [TRANSFORM_ROLE_NODE],
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
      await client.createFunction({ name, zipFile, ...configuration });
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
        await client.updateFunctionConfiguration(name, configuration);
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
