/**
 * The analytics plugin's resource graph. It owns the AWS resources the
 * CloudFront-logs-to-Iceberg pipeline is built from and nothing else: the
 * site's own bucket, distribution and log group stay in the CLI's graph
 * (`packages/cli/src/nodes.ts`) and are never touched from here. This module
 * carries the first four - the S3 Tables bucket, the namespace inside it, the
 * `page_views` table, and the Glue federation Firehose reads that table
 * through - chained `analytics-table-bucket` -> `analytics-namespace` ->
 * `analytics-table` -> `analytics-catalog-integration` through `dependsOn`. The
 * remaining eight of the spec's twelve are appended to this module as later
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

import type { PluginContext, ResourceNode, ResourceOutputs } from 'blogwright-core';

import { createAnalyticsClients } from './aws/clients.js';
import type { CatalogFederation, GlueClient } from './aws/glue.js';
import type {
  IcebergSchemaField,
  IcebergTableSchema,
  PartitionTransform,
  S3TablesClient,
} from './aws/s3tables.js';
import { resolveAnalyticsConfig, type AnalyticsConfig } from './config.js';
import { PAGE_VIEWS_COLUMNS, PAGE_VIEWS_PARTITION_COLUMN } from './schema.js';

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
