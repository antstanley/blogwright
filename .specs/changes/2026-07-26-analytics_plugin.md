# Change: Analytics plugin — CloudFront logs to Iceberg, with a local dashboard

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** new package `blogwright-analytics` (its own service clients, nodes and dashboard) + packages/core (delivery-configuration parameters on the existing `LogsClient`, and `signingUsEast1` on `AwsClients`) + packages/cli (two guards on the shared log-delivery node)

A new plugin, `blogwright-analytics`, adds traffic analytics to a blogwright
site. It taps the CloudFront access logs blogwright already delivers, routes
them through Amazon Data Firehose into an Apache Iceberg table in an S3 Tables
bucket, and serves a local SvelteKit dashboard that queries that table with
DuckDB. The plugin is not shipped with the CLI: it is installed with
`blogwright plugin add analytics`, configured by `blogwright analytics init`,
and provisioned by `blogwright analytics bootstrap`.

---

## Motivation

A blogwright site produces CloudFront access logs today, delivered to a
CloudWatch log group by the vended-log-delivery trio in
[`nodes.ts:713`](../../packages/cli/src/nodes.ts). CloudWatch Logs is the wrong
store for this data: querying it means Logs Insights scans priced per GB, the
retention window is a blunt instrument (`retention.cloudfrontDays`), and there
is no way to aggregate across months or join a request to the page it hit. An
operator who wants to know which post was read last week has no answer short of
a bespoke query.

The pipeline this change adds is unusually cheap to reach, because the hardest
part already exists. CloudFront permits exactly one *delivery source* per
distribution — blogwright already owns it — but that one source may fan out to
many *deliveries*. Adding a second delivery to a new destination is therefore
additive: the existing CloudWatch delivery is untouched, and
[`LogsClient`](../../packages/core/src/aws/logs.ts) already implements most of
the calls involved.

---

## Affected spec pages

| Canonical page | Nature of change |
|---|---|
| *(none — no canonical page for the resource nodes or CLI surface yet)* | Adds a plugin package carrying eleven resource nodes and four plugin-owned AWS service clients; the only core change is delivery-configuration parameters on the existing `LogsClient` |
| *(none — no canonical page for the site's resource nodes yet)* | Two guards on `logDeliveryNode` so a shared delivery source is never torn out from under the plugin |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Toolchain | Vite/SvelteKit joins the toolchain for the dashboard build |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Hexagonal architecture | New `AnalyticsQuery` port joins the ports table |

Depends on [`2026-07-26-cli_plugin_system.md`](2026-07-26-cli_plugin_system.md)
and, for SPI confidence, on
[`2026-07-26-migrate_pds_to_plugin_system.md`](2026-07-26-migrate_pds_to_plugin_system.md).

---

## Proposed changes

### Analytics plugin → Namespace and commands (Add)

> `blogwright-analytics` declares the manifest field
> `{ "blogwright": { "plugin": "analytics" } }` and claims the `analytics`
> namespace with five actions:
>
> - `analytics init` — supplied as the plugin's `init` contributor, **not** as a
>   declared command, so the generic action renders and splices the config
>   block. A plugin that declares an `init` command owns the write itself; this
>   one does not declare one.
> - `analytics bootstrap` — reconciles the plugin's resource graph.
> - `analytics status` — the plugin's nodes against its scoped state, plus the
>   Firehose stream's delivery health and the table's current row count.
> - `analytics dashboard` — starts the local dashboard server.
> - `analytics destroy --yes` — tears the plugin's graph down in reverse order.
>
> The plugin's resources live in its own scoped state store
> (`state/<env>.analytics.json`), so `blogwright destroy` neither provisions nor
> removes them.

### Analytics pipeline → Shape (Add)

> Access logs reach the table without any component polling or scheduling:
>
> ```
> CloudFront ──(the site's existing delivery source)──┬─► CloudWatch Logs   [unchanged]
>                                                     └─► Firehose stream   [new, us-east-1]
>                                                              │  record-transform Lambda
>                                                              ▼
>                                                     Iceberg table in S3 Tables
>                                                              │
>                                            analytics dashboard (DuckDB, local)
> ```
>
> The plugin never creates a delivery source. It reads the site's
> `ctx.names.deliverySource` and the distribution ARN through `siteState` — the
> read-only view of `state/<env>.json` the plugin SPI provides — and fails with
> an actionable message if the site has not been bootstrapped. Its own nodes
> record their outputs through `record(nodeId, outputs)`, which writes to
> `state/<env>.analytics.json`; nothing the plugin does can write the site's
> state.

### CloudFront log delivery → Two guards on the site's node (Modify)

> AWS permits exactly one delivery source per distribution, so the site's
> delivery and the plugin's necessarily share one — and the site's node owns it.
> `logDeliveryNode` ([`nodes.ts:713`](../../packages/cli/src/nodes.ts)) gains two
> guards so the shared source cannot be torn out from under the plugin:
>
> - **`delete()` refuses to remove the delivery source** when
>   `deliveriesForSource` returns any delivery other than its own, failing with a
>   message naming `blogwright analytics destroy`. Today it deletes one delivery
>   found by `.find()` ([`logs.ts:131`](../../packages/core/src/aws/logs.ts)) and
>   then the source; with the analytics delivery still attached AWS returns a
>   Conflict that `deleteDeliverySource` does not catch (it handles only
>   `isNotFound`), so `blogwright destroy` throws partway through teardown.
> - **The `ConflictException` retry deletes only the site's own delivery id.**
>   Today it iterates `deliveriesForSource` and deletes every delivery
>   ([`nodes.ts:751-761`](../../packages/cli/src/nodes.ts)) before rewiring —
>   which silently removes the analytics delivery while the plugin's scoped state
>   still records it as `configured`, so `analytics status` reports healthy and
>   log delivery has stopped.
>
> Both are site-graph changes that the analytics plugin depends on but does not
> make. They are the concrete form of the ownership rule the plugin SPI states:
> a site node deletes only what it created.

### Analytics pipeline → Region pinning (Add)

> CloudFront standard logging accepts a Firehose stream only in `us-east-1`.
> The stream, its transform Lambda, its IAM roles, the S3 Tables bucket, and the
> Glue catalog integration are therefore all created in `us-east-1` regardless
> of `config.region`. The plugin states this at bootstrap rather than deriving
> it silently, because it is the one place its resources diverge from the
> site's.

### Analytics pipeline → Record transformation (Add)

> A Lambda function transforms every record before Firehose writes it. This is
> mandatory, not an optimisation. Firehose matches incoming JSON keys to Iceberg
> column names **exactly**: *"If the column names or data types do not match,
> then Firehose throws an error and delivers data to the S3 error bucket. If all
> the column names and data types match … but you have an additional field
> present in the source record, Firehose skips the new field."* CloudFront emits
> keys — `x-edge-location`, `cs(Referer)`, `timestamp(ms)` — that are not valid
> lowercase column names, so without a transform every record fails to the error
> bucket. The function:
>
> 1. maps each CloudFront field name to its column name;
> 2. derives `event_time` from `timestamp(ms)` and the partition day from it;
> 3. replaces the viewer IP with `visitor_key`, a SHA-256 hash of the IP, the
>    user agent, and a **secret** daily salt — the raw IP is never written. The
>    daily salt is derived, not stored: one long-lived random secret lives in
>    Secrets Manager and the per-day value is `HMAC-SHA256(secret, day)`. That
>    gives daily rotation with no rotation infrastructure — no rotation Lambda,
>    no schedule, no second resource — and the secret itself is created once and
>    never rewritten. Deriving from the date alone would not do: IPv4 is a 2^32
>    space, so a salt an attacker can compute makes the digest brute-forceable
>    in seconds and the pseudonymisation decorative. The function reads the
>    secret once at cold start and caches it for the life of the execution
>    environment;
> 4. sets `is_bot` from a user-agent match, so bot traffic is flagged in place
>    rather than discarded;
> 5. drops records the schema cannot accept, emitting them to the Firehose error
>    prefix rather than failing the batch.
>
> The function is bundled with rolldown into a single file, following the
> build-agent's precedent, and uploaded as a zip by its resource node.

### Analytics pipeline → Table schema (Add)

> One table, `page_views`, partitioned by `day`. Every column name is lowercase,
> a requirement of the S3 Tables catalog integration. Columns are
> `event_time`, `day`, `host`, `uri`, `query`, `method`, `status`,
> `referrer`, `user_agent`, `country`, `asn`, `edge_location`, `result_type`,
> `bytes_sent`, `time_taken`, `content_type`, `protocol`, `request_id`,
> `visitor_key`, and `is_bot`.
>
> The delivery selects only the CloudFront fields these columns need. Fields
> that carry personal data and have no analytic use — `cs(Cookie)` and
> `x-forwarded-for` — are never selected, so they do not leave CloudFront. The
> viewer IP is selected because the transform needs it to derive `visitor_key`,
> and is discarded there.

### Analytics pipeline → Resource nodes (Add)

> The plugin contributes eleven nodes, reconciled by the same engine as the site's:
>
> | Node | Resource |
> |---|---|
> | `analytics-table-bucket` | S3 Tables bucket (`CreateTableBucket`) |
> | `analytics-namespace` | Table namespace (`CreateNamespace`) |
> | `analytics-table` | The `page_views` table (`CreateTable`) |
> | `analytics-catalog-integration` | The Glue `s3tablescatalog` federation Firehose reads the table through |
> | `analytics-salt-secret` | Secrets Manager secret holding the `visitor_key` salt |
> | `analytics-transform-role` | Execution role for the transform Lambda, including `secretsmanager:GetSecretValue` on that secret alone |
> | `analytics-transform-function` | The record-transform Lambda |
> | `analytics-firehose-role` | Firehose delivery role (Glue, S3 Tables, Lambda invoke, error prefix) |
> | `analytics-firehose-stream` | The delivery stream with its Iceberg destination |
> | `analytics-log-destination` | CloudWatch delivery destination pointing at the stream |
> | `analytics-log-delivery` | The delivery joining the site's source to that destination |
>
> `analytics-catalog-integration` is account-and-region scoped rather than
> per-environment. Its `read()` treats an existing integration as satisfied and
> its `delete()` is a no-op, so two environments never fight over it and
> tearing one down never breaks the other.

### Analytics plugin → Its own service clients (Add)

> The four clients the pipeline needs live in `blogwright-analytics`, not in
> core. The plugin builds them over the `SigningClient` already on its context
> and supplies its own service descriptors through the transport seam the plugin
> SPI defines, so core gains no service that exists only for this plugin and its
> published surface does not move.
>
> `pnpm knip` is the check that keeps this honest: four clients exported from
> core and consumed by nothing in core or the CLI would be reported as dead.
> The clients expose only the operations the nodes need:
>
> - `S3TablesClient` — REST-JSON: create/get/delete for table buckets,
>   namespaces, and tables.
> - `FirehoseClient` — create/describe/delete delivery stream, and tagging.
> - `GlueClient` — the catalog federation create and lookup.
> - `LambdaClient` — create/get/update/delete function and its configuration.
>   This is the standard Lambda API, distinct from
>   [`MicrovmsClient`](../../packages/core/src/aws/microvms.ts), which shares the
>   host and signing name but addresses the `/2025-09-09/` MicroVM paths.
>
> `LogsClient` is the exception that stays in core, because the site graph owns
> it — see the next block.

### `blogwright-core` → `LogsClient` delivery configuration (Modify)

> `putDeliveryDestination` accepts an output format, and `createDelivery`
> accepts the record fields and field delimiter. Both are optional and default
> to today's behaviour, so the site's existing CloudWatch delivery is unchanged.
> The output format is immutable once a destination exists, so the delivery
> destination node replaces rather than updates when the configured format
> differs from the recorded one.

### Analytics dashboard → Local server (Add)

> `blogwright analytics dashboard` starts an HTTP server bound to `127.0.0.1`
> and serves a prebuilt SvelteKit application. The server attaches the S3 Tables
> catalog through DuckDB in read-only mode and answers a **fixed set of named,
> parameterised queries** — never SQL supplied by the client. The named set
> covers views over time, top paths, referrers, countries, status codes, cache
> hit ratio, and unique visitors by `visitor_key`. Each query takes a date range
> and a bot-inclusion flag.

### Analytics dashboard → Credentials (Add)

> DuckDB is given credentials explicitly rather than resolving its own. The
> plugin resolves them through blogwright's existing provider chain
> ([`credentials.ts`](../../packages/core/src/aws/credentials.ts)) and passes
> them into DuckDB's secret, so one credential source serves the whole CLI and
> a session that works for `deploy` works for the dashboard.

### Ports → `AnalyticsQuery` (Add)

> DuckDB is a vendor dependency and does not appear in domain code. The
> `AnalyticsQuery` port exposes `run(name, params)` returning rows; the named
> query definitions, the server's routing, and the dashboard's data shaping
> depend on the port. The real adapter wraps `@duckdb/node-api`, attaches the
> catalog, and maps DuckDB errors into the repo's own vocabulary at the
> boundary; tests substitute a fixture-backed fake.

### Configuration → The `analytics` block (Add)

> The plugin owns the `analytics` config key and validates it. Every field has a
> derived or literal default, so a block containing `{}` is valid:
>
> - `tableBucket` — S3 Tables bucket name; defaults to
>   `<env>-<siteName>-analytics`.
> - `namespace` — table namespace; defaults to `web`.
> - `table` — table name; defaults to `page_views`.
> - `bots` — `flag` (default) or `filter`: whether bot traffic is excluded from
>   dashboard queries by default. Records are always stored either way.
> - `saltSecretName` — Secrets Manager secret holding the `visitor_key` salt;
>   defaults to `<siteName>/<env>/analytics-salt`. Mirrors how `pds.secretName`
>   names its secret.
>
> Every default carries the environment, matching `deriveNames`' `<env>-<siteName>`
> prefix ([`config.ts:352`](../../packages/core/src/config.ts)). Without it two
> environments would write into one Iceberg table and
> `blogwright analytics destroy --yes` in staging would run `DeleteTableBucket`
> against production's data — scoped state (`state/<env>.analytics.json`) would
> not detect the collision. AWS gives a second reason: Firehose "does not
> recommend using multiple Firehose streams to write data to the same Apache
> Iceberg table", because Iceberg's optimistic concurrency makes the streams
> contend.
> - `dashboard.port` — local port; defaults to `4317`.
>
> A config carrying an `analytics` block when the plugin is not installed is
> valid and inert.

---

## Type changes

```json
{
  "$comment": "Fragment for 2026-07-26-analytics_plugin. AnalyticsConfig folds into the canonical config schema on merge; PageView documents the Iceberg table the transform Lambda writes.",
  "$defs": {
    "AnalyticsConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tableBucket": { "type": "string", "pattern": "^[0-9a-z-]{3,63}$" },
        "namespace": { "type": "string", "pattern": "^[a-z0-9_]+$" },
        "table": { "type": "string", "pattern": "^[a-z0-9_]+$" },
        "bots": { "enum": ["flag", "filter"], "default": "flag" },
        "saltSecretName": {
          "type": "string",
          "pattern": "^[\\w/+=.@-]+$",
          "description": "Defaults to `<siteName>/<env>/analytics-salt`."
        },
        "dashboard": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "port": { "type": "integer", "minimum": 1024, "maximum": 65535, "default": 4317 }
          }
        }
      }
    },
    "PageView": {
      "$comment": "The page_views Iceberg table, partitioned by `day`. Column names are lowercase — an S3 Tables catalog requirement.",
      "type": "object",
      "required": ["event_time", "day", "host", "uri", "status"],
      "additionalProperties": false,
      "properties": {
        "event_time": { "type": "string", "format": "date-time" },
        "day": { "type": "string", "format": "date" },
        "host": { "type": "string" },
        "uri": { "type": "string" },
        "query": { "type": "string" },
        "method": { "type": "string" },
        "status": { "type": "integer" },
        "referrer": { "type": "string" },
        "user_agent": { "type": "string" },
        "country": { "type": "string" },
        "asn": { "type": "string" },
        "edge_location": { "type": "string" },
        "result_type": { "type": "string" },
        "bytes_sent": { "type": "integer" },
        "time_taken": { "type": "number" },
        "content_type": { "type": "string" },
        "protocol": { "type": "string" },
        "request_id": { "type": "string" },
        "visitor_key": {
          "type": "string",
          "description": "SHA-256 of viewer IP + user agent + HMAC-SHA256(root secret, day). The root secret lives in Secrets Manager; the raw IP is never stored and the salt is not derivable from the row."
        },
        "is_bot": { "type": "boolean" }
      }
    }
  }
}
```

---

## Implementation notes

This is the largest of the three changes; it lands in four separable stages.

```
Stage 1 — the core seams (no plugin service client lands in core)
  1. packages/core/src/aws/endpoint.ts — resolveEndpoint and SendOptions.service
     accept a { service, signingName, global? } descriptor as well as a
     ServiceKey. SIGNING_NAMES gains NO keys: s3tables, firehose, glue and
     lambda are the plugin's, supplied as descriptors. canonicalHost's default
     branch (:63) already returns <service>.<region>.amazonaws.com.
  2. packages/core/src/clients.ts:21,42 — expose signingUsEast1 alongside
     signing. The us-east-1 SigningClient is a local const at :54 today, so a
     plugin cannot build a us-east-1 client without it — and every analytics
     service is us-east-1.
  3. packages/core/src/aws/logs.ts:106 — putDeliveryDestination takes an
     optional outputFormat; :114 createDelivery takes optional recordFields
     and fieldDelimiter. Defaults preserve today's behaviour exactly; assert
     that with a test against the site's existing delivery. This one is
     genuinely core's: the site graph owns LogsClient.
  4. packages/cli/src/nodes.ts:713 — the two guards on logDeliveryNode (refuse
     to delete a shared source; scope the Conflict retry to the site's own
     delivery id).
  5. The four clients live in packages/analytics/src/aws/, built over
     ctx.clients.signingUsEast1 with their own descriptors. Follow
     secretsmanager.ts for AWS-JSON services and s3.ts for REST ones;
     transport-level tests for each, per the existing pattern.

Stage 2 — the transform Lambda
  5. packages/analytics/src/transform/ — the handler plus a rolldown config,
     mirroring packages/build-agent (rolldown.config.ts, a source-hash
     manifest). The hash keys the uploaded zip so identical source never
     redeploys the function.
  6. Unit-test the mapping, the visitor_key derivation (injected salt in, known
     digest out), the bot match, and the drop path — this is the one place a
     silent mistake corrupts the whole dataset.

Stage 3 — the plugin and its graph
  7. packages/analytics/src/ — plugin.ts (the Plugin export), config.ts,
     schema.ts (the page_views DDL and the CloudFront field selection),
     nodes.ts (the eleven nodes).
  8. Node ordering: table-bucket → namespace → table → catalog-integration;
     transform-role → transform-function; firehose-role →
     firehose-stream (depends on table + catalog-integration +
     transform-function); log-destination → log-delivery.
  9. logDeliveryNode (packages/cli/src/nodes.ts:713) is the model for the
     delivery nodes, including its ConflictException retry (:751) and the
     teardown ordering comment (:764) — read both before writing them.

Stage 4 — the dashboard
 10. packages/analytics/app/ — SvelteKit + LayerChart 2.0.2 (Svelte 5 only),
     built to dist/app and shipped in the package's `files`.
 11. packages/analytics/src/queries.ts (the named set), server.ts (the edge
     adapter), adapters/duckdb-query.ts (the AnalyticsQuery adapter).
 12. Add the SvelteKit build to the package's build script; docs/ is the
     existing precedent for a non-tsc build in this workspace.
```

Risks worth naming before starting: the Firehose-to-Iceberg field mapping is
exact-match and fails silently, so stage 2's tests are load-bearing; and the
Glue catalog integration is account-scoped shared state, so its node must adopt
rather than create when it already exists.

---

## Merge plan

1. Apply the `Proposed changes` blocks to whichever canonical pages document the
   resource nodes, the AWS clients, and the CLI surface, once they exist.
2. Fold `AnalyticsConfig` and `PageView` into the canonical schema.
3. Add Vite/SvelteKit to the toolchain table and `AnalyticsQuery` to the ports
   table in [DEVELOPMENT.md](../../DEVELOPMENT.md).
4. Flip this file's **Status:** to `Merged`, add **Merged:** date, move to
   `.specs/changes/merged/`.
5. Update `.specs/README.md` (remove from pending change specs).

---

## Assumptions and open questions

**Assumptions**

- The site is bootstrapped before `analytics bootstrap` runs. The plugin reads
  the site's delivery source and distribution ARN from the site's state and
  fails with an actionable message when they are absent.
- One delivery source may carry multiple deliveries to different destination
  types. The CloudFront documentation states this and
  `deliveriesForSource` ([`logs.ts:139`](../../packages/core/src/aws/logs.ts))
  already returns a list; the site's existing CloudWatch delivery is expected to
  survive the addition untouched, and a test asserts it.
- Firehose's error/backup prefix may live in the site's existing environment
  bucket. That bucket is in `config.region` while the stream is in `us-east-1`,
  so error records cross a region boundary. Failed records are expected to be
  rare enough that the transfer cost is immaterial.
- S3 Tables is available in `us-east-1` and its Iceberg tables are readable by
  DuckDB's `ENDPOINT_TYPE 'S3_TABLES'` attach, which requires `s3tables`
  permissions but no Lake Formation grant. The Glue federation is needed for
  Firehose to write, not for DuckDB to read.
- Log volume for a blog is small enough that batched Firehose delivery produces
  files large enough not to make S3 Tables compaction the dominant cost.

**Decisions**

- *Firehose over an in-CLI DuckDB ingest.* **Ingestion is continuous and
  server-side.** The alternative — DuckDB in the CLI reading Parquet from S3 and
  inserting into Iceberg — needs one new client instead of four and no Lambda,
  but only ingests when an operator runs a command, and puts a native dependency
  on the ingestion path. Continuity was the requirement.
- *A transform Lambda, because there is no alternative.* **Firehose matches
  JSON keys to column names exactly and drops the rest silently.** CloudFront
  emits `cs(Referer)` and `timestamp(ms)`; Iceberg columns must be lowercase
  identifiers. This was established during research, not assumed.
- *Hash the IP in the Lambda; never store it.* **`visitor_key` is a daily-salted
  digest of IP and user agent.** The transform is the only component that ever
  sees the raw address, which makes unique-visitor counts possible without
  retaining personal data or setting a cookie.
- *The salt is a secret, not the date.* **One long-lived random secret in
  Secrets Manager; the daily salt is `HMAC-SHA256(secret, day)`.** Settled
  2026-07-26. A date-derived salt is computable by anyone holding the table, and
  IPv4 is a 2^32 space — brute-forcing every row back to its source address is
  seconds of GPU time, so the hash would provide no protection at all while
  appearing to.
- *The stored secret is never rotated; only the derived salt turns over.*
  **Deriving beats Secrets Manager rotation here.** Managed rotation would mean
  a rotation Lambda, a schedule, and a second execution role — more moving parts
  than the thing they protect. Deriving per-day values from one immutable secret
  gives the same daily turnover for a flat $0.40/month with nothing to operate.
  Total cost: one secret, one `secretsmanager:GetSecretValue` grant scoped to
  it, and a `saltSecretName` config field. `SecretsManagerClient` already exists
  in core, so no new client. (SSM Parameter Store's `SecureString` would be free,
  but it would cost a hand-rolled `ssm` client — a bad trade against $4.80/year.)
- *Flag bots, do not drop them.* **`is_bot` is a column; filtering is a query
  default.** A dropped record cannot be recovered when the bot heuristic turns
  out to be wrong, and it will be wrong.
- *DuckDB over Athena for the dashboard.* **No Lake Formation grants, no
  per-query billing floor, no results bucket.** The Glue federation this change
  provisions for Firehose would get Athena part of the way, but a local
  dashboard querying a blog-sized table does not need a distributed engine.
- *Named queries, never client-supplied SQL.* **The server exposes a fixed
  parameterised set.** The server binds to loopback, but a local-only listener
  that will execute arbitrary SQL against the operator's AWS credentials is a
  bad shape regardless of who can reach it.
- *The dashboard ships prebuilt.* **`dist/app` is in the package.** Requiring
  consumers to run Vite to see a chart would make the install heavier than the
  feature.
- *One table, partitioned by day.* **No rollup tables in this change.** Rollups
  are an optimisation for a dataset size a blog does not have yet, and they are
  additive later.

**Open questions**

- Historical logs already in the CloudWatch log group are not backfilled. Is a
  `analytics backfill` command wanted, and does it justify a second, DuckDB-based
  ingestion path that the Firehose decision otherwise avoids?
- Should the table carry a record-expiration configuration (the S3 Tables API
  supports one) so old rows age out, or is retention a manual concern? The
  site's `retention.cloudfrontDays` governs only the CloudWatch copy.
- The Glue catalog integration is account-and-region scoped while everything
  else the plugin owns is per-environment. Two environments therefore share it,
  and its node adopts rather than creates. Is adopt-and-never-delete the right
  contract, or should the last environment to be torn down remove it?
- Should `blogwright destroy` refuse while `state/<env>.analytics.json` shows
  live resources? The plugin's delivery references the site's distribution and
  its shared delivery source, so a site teardown leaves the plugin's delivery
  plumbing orphaned — the same failure mode
  [`nodes.ts:764`](../../packages/cli/src/nodes.ts) already documents. The
  general form of this question is open in the plugin-system change spec.
- Rotating the salt daily means `visitor_key` is not comparable across a day
  boundary, so a "unique visitors this month" figure is really the sum of daily
  uniques. Is that the intended semantic, or should the salt rotate less often
  (trading a longer correlation window for cross-day counts)?
