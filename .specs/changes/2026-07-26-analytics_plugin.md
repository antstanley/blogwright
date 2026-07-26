# Change: Analytics plugin — CloudFront logs to Iceberg, with a local dashboard

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** new package `blogwright-analytics` + packages/core (four new service clients, delivery-configuration parameters)

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
| *(none — no canonical page for the resource nodes or CLI surface yet)* | Adds a plugin package, eleven resource nodes, four AWS service clients, and delivery-configuration parameters on `LogsClient` |
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

### Analytics pipeline → Region pinning (Add)

> CloudFront standard logging accepts a Firehose stream only in `us-east-1`.
> The stream, its transform Lambda, its IAM roles, the S3 Tables bucket, and the
> Glue catalog integration are therefore all created in `us-east-1` regardless
> of `config.region`. The plugin states this at bootstrap rather than deriving
> it silently, because it is the one place its resources diverge from the
> site's.

### Analytics pipeline → Record transformation (Add)

> A Lambda function transforms every record before Firehose writes it. This is
> mandatory, not an optimisation: Firehose matches incoming JSON keys to Iceberg
> column names exactly and silently discards fields that do not match, and
> CloudFront emits keys — `x-edge-location`, `cs(Referer)`, `timestamp(ms)` —
> that are not valid lowercase column names. The function:
>
> 1. maps each CloudFront field name to its column name;
> 2. derives `event_time` from `timestamp(ms)` and the partition day from it;
> 3. replaces the viewer IP with `visitor_key`, a SHA-256 hash of the IP, the
>    user agent, and a **secret** salt that rotates daily — the raw IP is never
>    written. The salt is random and held in Secrets Manager, not derived from
>    the date: IPv4 is a 2^32 space, so a hash whose salt an attacker can compute
>    is reversible by brute force in seconds, and the pseudonymisation would be
>    decorative. The function reads the salt at cold start and caches it for the
>    life of the execution environment;
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

### `blogwright-core` → New service clients (Add)

> Four service keys join `SIGNING_NAMES`
> ([`endpoint.ts:19`](../../packages/core/src/aws/endpoint.ts)) — `s3tables`,
> `firehose`, `glue`, and `lambda` — each with a client alongside the existing
> ones. `canonicalHost`'s default branch already produces the correct host for
> all four. The clients expose only the operations the nodes need:
>
> - `S3TablesClient` — REST-JSON: create/get/delete for table buckets,
>   namespaces, and tables.
> - `FirehoseClient` — create/describe/delete delivery stream, and tagging.
> - `GlueClient` — the catalog federation create and lookup.
> - `LambdaClient` — create/get/update/delete function and its configuration.
>   This is the standard Lambda API, distinct from
>   [`MicrovmsClient`](../../packages/core/src/aws/microvms.ts), which shares the
>   host and signing name but addresses the `/2025-09-09/` MicroVM paths.

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
> - `tableBucket` — S3 Tables bucket name; defaults to `<siteName>-analytics`.
> - `namespace` — table namespace; defaults to `web`.
> - `table` — table name; defaults to `page_views`.
> - `bots` — `flag` (default) or `filter`: whether bot traffic is excluded from
>   dashboard queries by default. Records are always stored either way.
> - `saltSecretName` — Secrets Manager secret holding the `visitor_key` salt;
>   defaults to `<siteName>/analytics-salt`. Mirrors how `pds.secretName` names
>   its secret.
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
          "description": "Defaults to `<siteName>/analytics-salt`."
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
          "description": "SHA-256 of viewer IP + user agent + a daily-rotating secret salt held in Secrets Manager. The raw IP is never stored, and the salt is not derivable from the row."
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
Stage 1 — core clients (no plugin code yet)
  1. packages/core/src/aws/endpoint.ts:19 — add s3tables, firehose, glue,
     lambda to SIGNING_NAMES. canonicalHost (:60) needs no change.
  2. New clients in packages/core/src/aws/: s3tables.ts (REST-JSON,
     PUT /buckets etc.), firehose.ts, glue.ts, lambda.ts. Follow
     secretsmanager.ts for AWS-JSON services and s3.ts for REST ones.
     Transport-level tests for each, per the existing pattern.
  3. packages/core/src/aws/logs.ts:106 — putDeliveryDestination takes an
     optional outputFormat; :114 createDelivery takes optional recordFields
     and fieldDelimiter. Defaults preserve today's behaviour exactly; assert
     that with a test against the site's existing delivery.
  4. packages/core/src/clients.ts:21,42 — add the four to AwsClients and
     createClients. Firehose/Glue/Lambda/S3Tables for analytics are all
     us-east-1, so they are constructed against the existing usEast1 signer
     (:54).

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
- *The salt is a secret, not the date.* **Random, held in Secrets Manager,
  rotated daily.** Settled 2026-07-26. A date-derived salt is computable by
  anyone holding the table, and IPv4 is a 2^32 space — brute-forcing every row
  back to its source address is seconds of GPU time, so the hash would provide
  no protection at all while appearing to. The cost is one more node, one
  `secretsmanager:GetSecretValue` grant scoped to that secret, and a
  `saltSecretName` config field. `SecretsManagerClient` already exists in core,
  so no new client is needed.
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
- One table bucket per environment, or one bucket with a namespace per
  environment? Per-environment buckets are proposed because teardown is then
  unambiguous, at the cost of duplicating the shared catalog integration's
  reasoning.
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
