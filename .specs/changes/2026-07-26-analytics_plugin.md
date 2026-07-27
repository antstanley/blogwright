# Change: Analytics plugin — CloudFront logs to Iceberg, with a local dashboard

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** new package `blogwright-analytics` (its own service clients, nodes, dashboard and a one-shot backfill action) + packages/core (delivery-configuration parameters on the existing `LogsClient`) + packages/cli (two guards on the shared log-delivery node)

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
| *(none — no canonical page for the resource nodes or CLI surface yet)* | Adds a plugin package carrying twelve resource nodes and four plugin-owned AWS service clients. The only core change this spec owns is delivery-configuration parameters on the existing `LogsClient`; the plugin-supplied service descriptor on the transport seam and `signingUsEast1` on `AwsClients` are owned by the plugin-system change spec and consumed here |
| *(none — no canonical page for the site's resource nodes yet)* | Two guards on `logDeliveryNode` so a shared delivery source is never torn out from under the plugin |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Toolchain | Vite/SvelteKit joins the toolchain for the dashboard build; the pnpm row's "workspace of four packages" becomes five |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Hexagonal architecture | New `AnalyticsQuery` and `AnalyticsIngest` ports join the ports table |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Assumptions | The four-package-split assumption names `blogwright-analytics` as the second instance of its own feature-package exception |

Depends on [`2026-07-26-cli_plugin_system.md`](2026-07-26-cli_plugin_system.md)
and, for SPI confidence, on
[`2026-07-26-migrate_pds_to_plugin_system.md`](2026-07-26-migrate_pds_to_plugin_system.md).

---

## Proposed changes

### Analytics plugin → Namespace and commands (Add)

> `blogwright-analytics` declares the manifest field
> `{ "blogwright": { "plugin": "analytics" } }` and claims the `analytics`
> namespace. It **declares three commands** and contributes an `init`; the
> remaining two actions are the CLI's generic lifecycle verbs, under the
> precedence rule the plugin SPI states in §CLI → Plugin lifecycle:
>
> - `analytics status` — **declared**, because it does strictly more than the
>   generic verb: the plugin's nodes against its scoped state, plus the Firehose
>   stream's delivery health and the table's current row count.
> - `analytics dashboard` — **declared**; starts the local dashboard server.
> - `analytics backfill` — **declared**, optional, and run by hand: a one-shot
>   pull of history that predates the Firehose delivery, from the site's
>   CloudWatch log group into the table (§Backfill of historical logs). It is
>   never part of the steady-state pipeline, and it is idempotent, so running
>   it again cannot double-count. Declaring it is legal under the precedence
>   rule: only `bootstrap` and `destroy` are reserved to the generic verbs.
> - `analytics init` — supplied as the plugin's `init` contributor, **not** as a
>   declared command, so the generic action renders and splices the config
>   block. A plugin that declares an `init` command owns the write itself; this
>   one does not declare one.
> - `analytics bootstrap` and `analytics destroy --yes` — **generic**, never
>   declared. They reconcile and tear down the plugin's resource graph through
>   the CLI's own engine, which a plugin cannot run itself. Declaring either is
>   rejected at discovery.
>
> The plugin's resources live in its own scoped state store
> (`state/<env>.analytics.json`), so `blogwright destroy` neither provisions nor
> removes them — and, per the plugin SPI's §State → Scoped state stores, it
> refuses while that object exists, naming `blogwright analytics destroy --yes`.
> The refusal is what keeps a site teardown from emptying the bucket the
> plugin's own record lives in and orphaning twelve resources.

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
>   then the source; with the analytics delivery still attached AWS rejects the
>   delete, and `deleteDeliverySource` catches only `isNotFound`
>   ([`logs.ts:164-171`](../../packages/core/src/aws/logs.ts)), so whatever the
>   error code, `blogwright destroy` throws partway through teardown. The guard
>   turns that into an early, actionable refusal and does not depend on the code
>   AWS returns.
> - **The `ConflictException` retry deletes only the site's own delivery id.**
>   Today it iterates `deliveriesForSource` and deletes every delivery
>   ([`nodes.ts:751-761`](../../packages/cli/src/nodes.ts)) before rewiring —
>   which silently removes the analytics delivery while the plugin's scoped state
>   still records it as `configured`, so `analytics status` reports healthy and
>   log delivery has stopped.
>
> Both guards have to tell the site's delivery from the plugin's, and neither
> lookup the CLI has can express that: `deliveriesForSource`
> ([`logs.ts:139`](../../packages/core/src/aws/logs.ts)) returns bare ids, and
> `findDeliveryIdBySource` returns whichever AWS lists first. So
> `deliveriesForSource` returns each delivery's destination ARN alongside its
> id — `DescribeDeliveries` already carries the field — and the site's node
> matches on `names.deliveryDestination`. The retry loop
> ([`nodes.ts:753-757`](../../packages/cli/src/nodes.ts)) is its only caller, so
> the widening moves with the guards that need it rather than ahead of them.
>
> Both are site-graph changes that the analytics plugin depends on but does not
> make. They are the concrete form of the ownership rule the plugin SPI states:
> a site node deletes only what it created.

### Analytics pipeline → Region pinning (Add)

> CloudFront standard logging accepts a Firehose stream only in `us-east-1`.
> **Every one of the plugin's twelve nodes is therefore created in `us-east-1`
> regardless of `config.region`** — the stream, its transform Lambda, its two
> IAM roles, the S3 Tables bucket with its namespace and table, the Glue catalog
> integration, the Firehose error bucket, the `visitor_key` salt secret, and the
> log destination and delivery. The plugin states this at bootstrap rather than
> deriving it silently, because it is the one place its resources diverge from
> the site's.
>
> The pin is enforced at one place: every **regional** client the plugin uses is
> built over `ctx.clients.signingUsEast1`, never over a client core pre-built
> for the site's region. The salt secret is where that matters and would
> otherwise be missed — `ctx.clients.secrets` is constructed over the
> primary-region signer
> ([`clients.ts:68`](../../packages/core/src/clients.ts)), so reusing it would
> put the secret in `config.region` while the transform Lambda that reads it and
> the role ARN that grants `secretsmanager:GetSecretValue` on it are both
> `us-east-1`. The plugin constructs its own `SecretsManagerClient` over
> `signingUsEast1` instead.
>
> Two of core's pre-built clients are used as they are, and both are already
> us-east-1 by construction, so neither weakens the rule. `ctx.clients.iam`
> serves the two IAM roles: IAM is in `GLOBAL_SERVICES`, so it signs us-east-1
> whatever the site's region is and `canonicalHost` returns `iam.amazonaws.com`
> ([`endpoint.ts:36,43,65-66`](../../packages/core/src/aws/endpoint.ts)) — and a
> role is a global resource, so "created in us-east-1" is not a property it has.
> `ctx.clients.logsUsEast1` serves the delivery nodes and is pinned to us-east-1
> in core for the same CloudFront quirk this pipeline inherits
> ([`clients.ts:28-33`](../../packages/core/src/clients.ts)). Building either
> over `signingUsEast1` would change nothing on the wire and would duplicate a
> client that already exists.

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
> `x-forwarded-for` — are never selected, so they never reach Firehose, the
> transform, or the table. This governs the analytics delivery only: the site's
> existing CloudWatch delivery is created with no `recordFields`
> ([`logs.ts:114`](../../packages/core/src/aws/logs.ts),
> [`nodes.ts:732`](../../packages/cli/src/nodes.ts)), so AWS's default field
> list — which includes both — still applies to the CloudWatch copy. Narrowing
> that is a separate change to the site's node, not this one. The viewer IP is
> selected for the analytics delivery because the transform needs it to derive
> `visitor_key`, and is discarded there.

### Analytics pipeline → Backfill of historical logs (Add)

> `analytics backfill` is a declared, optional, one-shot action — run by hand
> when an operator wants history that predates the Firehose delivery — and is
> explicitly not part of the steady-state pipeline, which stays the push path
> §Shape draws.
>
> What it reads is the CloudWatch log group the site's existing delivery
> already writes — `names.cloudfrontLogGroup`, created in us-east-1 by the
> site graph and bounded by `retention.cloudfrontDays` — through core's
> existing `LogsClient.filterEvents`
> ([`logs.ts:71`](../../packages/core/src/aws/logs.ts)) over
> `ctx.clients.logsUsEast1`: no new client and no new core operation. Each
> event runs through the same field mapping, `visitor_key` derivation and drop
> rules as the transform Lambda — a historical day's salt is derivable because
> the per-day salt is `HMAC-SHA256(secret, day)` and the stored secret never
> changes — so one CloudFront record produces the identical row whichever path
> carried it. Rows are written through the DuckDB dependency the dashboard
> already ships, behind a write port of its own: `AnalyticsIngest`
> (`insertDay(day, rows)`), declared beside `AnalyticsQuery`, implemented by
> the same DuckDB adapter and substituted in tests, so the vendor stays at the
> boundary for writes exactly as §Ports → `AnalyticsQuery` keeps it for reads.
> The dashboard's own attach stays read-only.
>
> It must not double-insert rows the Firehose path already wrote, and the
> guarantee is by construction rather than by de-duplication. The
> `analytics-log-delivery` node records, in the plugin's scoped state, the UTC
> day it first created its delivery — written once and never advanced, so the
> bound can only be conservative. Backfill inserts only whole days strictly
> before that day: Firehose received nothing before its delivery existed, so
> the two paths' row sets are disjoint. Within that range each day is one
> transactional insert, and a day that already holds rows is skipped, so
> re-running the command is a no-op and a crashed run resumes cleanly. The
> boundary day itself is never backfilled — up to one day of history at the
> seam is the stated precision limit, accepted rather than patched with a
> row-level de-duplication pass.
>
> The command fails with an actionable message naming
> `blogwright analytics bootstrap` when the plugin's scoped state carries no
> delivery record, and reports the day range it inserted and the days it
> skipped.

### Analytics pipeline → Resource nodes (Add)

> The plugin contributes twelve nodes, reconciled by the same engine as the site's:
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
> | `analytics-error-bucket` | S3 bucket in us-east-1 for Firehose's failed-record output |
> | `analytics-firehose-role` | Firehose delivery role (Glue, S3 Tables, Lambda invoke, error bucket) |
> | `analytics-firehose-stream` | The delivery stream with its Iceberg destination, created with `AppendOnly: true` |
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
> Four is the count of *new* clients, not of clients in the plugin's bundle.
> `analytics-error-bucket` is a plain S3 bucket and `analytics-salt-secret` a
> plain Secrets Manager secret, so neither needs a new client: the plugin
> constructs core's existing `S3Client` and `SecretsManagerClient` over
> `signingUsEast1`, which is why that signer is on the context. Reusing
> `ctx.clients.s3` or `ctx.clients.secrets` would put those two resources in
> `config.region`, outside the region pin every other node obeys.
>
> Two of core's clients are taken from `ctx.clients` unchanged, and §Region
> pinning says why neither breaks the pin. `IamClient` builds the transform and
> Firehose roles: IAM is global, so `ctx.clients.iam` already signs us-east-1.
> `LogsClient` builds the delivery destination and delivery, and stays in core
> because the site graph owns it — `ctx.clients.logsUsEast1` is core's own
> us-east-1 instance of it, see the next block.

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
> hit ratio, and unique visitors by `visitor_key` — reported as daily uniques
> and, over a range, as their sum, never as a distinct count across days: the
> salt rotates daily (§Record transformation), so `visitor_key` does not
> correlate across a day boundary, and the named set exposes no query that
> implies a cross-day unique count it cannot compute. A "unique visitors this
> month" figure is the sum of daily uniques and is labelled as such. Each query
> takes a date range and a bot-inclusion flag.

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
> - `dashboard.port` — local port; defaults to `4317`.
>
> Every derived default carries the environment, matching `deriveNames`'
> `<env>-<siteName>` prefix ([`config.ts:352`](../../packages/core/src/config.ts)).
> Without it two environments would write into one Iceberg table and
> `blogwright analytics destroy --yes` in staging would run `DeleteTableBucket`
> against production's data — scoped state (`state/<env>.analytics.json`) would
> not detect the collision. AWS gives a second reason: Firehose "does not
> recommend using multiple Firehose streams to write data to the same Apache
> Iceberg table", because Iceberg's optimistic concurrency makes the streams
> contend.
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
     lambda are the plugin's, supplied as descriptors. canonicalHost (:63) keeps
     every branch it has, and its default (:75-76) already returns
     <service>.<region>.amazonaws.com, though its parameter widens to
     `string`; four other
     sites key off `service` and read the resolved value through one helper:
     GLOBAL_SERVICES (endpoint.ts:36, a Set<ServiceKey>),
     SIGNING_NAMES[opts.service] (signer.ts:124, the signing name),
     `uriEscapePath: opts.service !== 's3'` (signer.ts:135, the service name),
     and parseError(opts.service, response) (signer.ts:163, the service name —
     it feeds AwsError's `service` field, so the raw union would print
     [object Object]). Owned by the plugin-system change spec; listed here
     because this is its first consumer.
  2. packages/core/src/clients.ts:21,42 — expose signingUsEast1 alongside
     signing. The us-east-1 SigningClient is a local const at :54 today, so
     without it a plugin cannot build a us-east-1 client that shares the host's
     credential provider, endpoint override and injected transport
     (signer.ts:85-86 keeps the last two private) — and every analytics service
     is us-east-1. Owned by the plugin-system change spec; listed here
     because this is its first consumer.
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
     transport-level tests for each, per the existing pattern. Core's S3Client
     and SecretsManagerClient join the same bundle over the same signer — no
     new client, but the error bucket and the salt secret must be created in
     us-east-1 like everything else the plugin owns.

Stage 2 — the transform Lambda
  6. packages/analytics/src/transform/ — the handler plus a rolldown config,
     mirroring packages/build-agent (rolldown.config.ts, a source-hash
     manifest). The hash keys the uploaded zip so identical source never
     redeploys the function.
  7. Unit-test the mapping, the visitor_key derivation (injected salt in, known
     digest out), the bot match, and the drop path — this is the one place a
     silent mistake corrupts the whole dataset.

Stage 3 — the plugin and its graph
  8. packages/analytics/src/ — plugin.ts (the Plugin export), config.ts,
     schema.ts (the page_views DDL and the CloudFront field selection),
     nodes.ts (the twelve nodes).
  9. Node ordering, all twelve: table-bucket → namespace → table →
     catalog-integration; salt-secret → transform-role → transform-function;
     error-bucket → firehose-role → firehose-stream; log-destination →
     log-delivery. A node depends on every node whose recorded ARN it
     interpolates, so transform-role also depends on salt-secret (its
     GetSecretValue grant), firehose-role also on table and
     transform-function (its S3 Tables and lambda:InvokeFunction grants),
     and firehose-stream also on table, catalog-integration and
     transform-function. topoSort drains zero-indegree nodes alphabetically
     (cli/src/graph.ts:35-38), so a role that declares dependsOn: [] is
     reconciled before its grants' targets and writes an undefined ARN into
     the policy — a wrong permission, never an error.
 10. logDeliveryNode (packages/cli/src/nodes.ts:713) is the model for the
     delivery nodes, including its ConflictException retry (:751) and the
     teardown ordering comment (:764) — read both before writing them.

Stage 4 — the dashboard
 11. packages/analytics/app/ — SvelteKit + LayerChart 2.0.2 (Svelte 5 only),
     built to dist/app and shipped in the package's `files`.
 12. packages/analytics/src/queries.ts (the named set), server.ts (the edge
     adapter), adapters/duckdb-query.ts (the AnalyticsQuery adapter).
 13. Add the SvelteKit build to the package's build script; docs/ is the
     existing precedent for a non-tsc build in this workspace.

Stage 5 — the backfill (optional action)
 14. packages/analytics/src/backfill.ts plus adapters/duckdb-ingest.ts (the
     AnalyticsIngest adapter beside the AnalyticsQuery one). The command body
     fills the stub the plugin export declares; the delivery node records the
     creation-day bound it reads. Tests are the load-bearing part: the
     identical-row property (one fixture event through the Firehose envelope
     and through backfill yields deep-equal rows), the whole-days-only bound,
     the occupied-day skip, and the re-run no-op.
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
4. Correct the two places [DEVELOPMENT.md](../../DEVELOPMENT.md) counts the
   workspace: the pnpm toolchain row's "workspace of four packages under
   `packages/`", and the Assumption that "the four-package split (core / cli /
   pds / build-agent) is stable". `packages/analytics` is picked up by
   `pnpm-workspace.yaml`'s `packages/*` glob with no edit, so nothing fails —
   both statements simply go quietly stale. The Assumption's own exception is
   what admits the package; it gains `blogwright-analytics` beside
   `blogwright-pds` as the second worked instance.
5. Flip this file's **Status:** to `Merged`, add **Merged:** date, move to
   `.specs/changes/merged/`.
6. Update `.specs/README.md` (remove from pending change specs).

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
- The Firehose error bucket is created by the plugin in `us-east-1`, not reused
  from the site's environment bucket. `S3DestinationConfiguration.BucketARN`
  matches `arn:.*:s3:::[\w\.\-]{1,255}` — an S3 ARN carries no region, so the
  API can neither express nor reject a cross-region bucket, and Firehose's
  cross-region documentation covers only HTTP endpoint destinations. Rather than
  rest the pipeline on an undocumented behaviour, the plugin owns a bucket in
  its own region.
- Creating the namespace and table through the S3 Tables control-plane API is a
  supported Firehose source, verified 2026-07-26: AWS's own S3 Tables + Firehose
  walkthrough uses `aws s3tables create-namespace` and `aws s3tables create-table`
  and then configures the stream against them. Firehose's "only tables created
  through Iceberg's GlueCatalog API" limitation applies to plain Iceberg-on-S3
  tables registered in Glue, not to S3 Tables reached through the
  `s3tablescatalog` federation. Resource links, required until 2025-07-31, are
  no longer needed.
- S3 Tables is available in `us-east-1` and its Iceberg tables are readable by
  DuckDB's `ENDPOINT_TYPE 'S3_TABLES'` attach, which requires `s3tables`
  permissions but no Lake Formation grant. The Glue federation is needed for
  Firehose to write, not for DuckDB to read. Two dependencies this rests on and
  neither is under blogwright's control: the "no Lake Formation grant" half
  holds only while the table bucket stays in IAM access-control mode — AWS
  documents S3 Tables under either IAM *or* Lake Formation access control, and
  switching the account to the latter would need a grant the plugin does not
  provision; and DuckDB's iceberg extension is documented as preview, so the
  attach syntax may move. The `AnalyticsQuery` port is what contains both: the
  named queries and the dashboard depend on the port, not on DuckDB.
  `analytics backfill` leans on the same preview surface in the write
  direction (§Backfill of historical logs), and the `AnalyticsIngest` port
  contains that the same way.
- Log volume for a blog is small enough that batched Firehose delivery produces
  files large enough not to make S3 Tables compaction the dominant cost.

**Decisions**

- *Firehose over an in-CLI DuckDB ingest.* **Ingestion is continuous and
  server-side.** The alternative — DuckDB in the CLI reading Parquet from S3 and
  inserting into Iceberg — needs one new client instead of four and no Lambda,
  but only ingests when an operator runs a command, and puts a native dependency
  on the ingestion path. Continuity was the requirement.
- *`analytics backfill` is a declared, optional action.* **A hand-run, one-shot
  pull of pre-Firehose history — not a second steady-state ingestion path.**
  Settled 2026-07-27. The objection the open question recorded — that backfill
  re-introduces the DuckDB ingestion path the Firehose decision avoided — is
  weaker than it looks: the package already depends on DuckDB for the
  dashboard's `AnalyticsQuery` adapter, so a one-shot backfill reuses a
  dependency that is present rather than adding one, and what the Firehose
  decision actually protects — continuous ingestion with no operator in the
  loop — is untouched, because backfill runs once and stops. It reads the
  CloudWatch log group the site's existing delivery writes, maps records
  through the same code the transform Lambda runs so both paths produce
  identical rows, and is idempotent by construction (§Backfill of historical
  logs): only whole days strictly before the recorded start of the Firehose
  delivery, one transactional insert per day, occupied days skipped.
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
  in core, so no new client — but the plugin builds its own instance over
  `signingUsEast1` rather than reusing the primary-region `ctx.clients.secrets`,
  so the secret lands inside the region pin with the Lambda that reads it.
  (SSM Parameter Store's `SecureString` would be free,
  but it would cost a hand-rolled `ssm` client — a bad trade against $4.80/year.)
- *Daily salt rotation stands.* **The per-day salt turns over at every UTC day
  boundary, and the consequence is accepted: `visitor_key` is not comparable
  across days.** Settled 2026-07-27. A "unique visitors this month" figure is
  therefore the sum of daily uniques — an over-count whenever the same visitor
  returns on different days — and the dashboard's named queries state that
  semantic rather than implying a distinct count they cannot compute (§Local
  server). The short window is the point, not a cost: one day bounds what
  anyone holding the table and a brute-forced day of salt could ever
  correlate, and trading that bound for cross-day counts would spend the
  pseudonymisation on a nicer-looking metric.
- *The error bucket is the plugin's own, in us-east-1.* **Not the site's
  environment bucket.** Two reasons beyond the undocumented cross-region
  behaviour: a schema mismatch sends *every* affected record there (see the
  Firehose behaviour quoted above), so it is a normal path rather than a rare
  one; and it is the only resource that would otherwise sit outside the
  region-pinning decision.
- *The stream is created `AppendOnly`.* **`page_views` is insert-only by
  design.** Firehose scales throughput automatically for append-only Iceberg
  streams. Whether the flag can be changed afterwards is not settled: the
  Firehose considerations page says "Currently, you can set this flag only with
  the CreateDeliveryStream API operation", while the `IcebergDestinationUpdate`
  API reference lists `AppendOnly` among the fields `UpdateDestination` accepts.
  The stream node is therefore written defensively rather than against either
  reading — it attempts the update, and falls back to replacing the stream when
  the update is rejected. Both branches are covered by tests; neither
  documentation claim is treated as fact.
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
- *`blogwright-analytics` joins the fixed changeset group.* **It versions in
  lockstep with the CLI.** `blogwright plugin add` installs the plugin at the
  running CLI's own version, and the group at
  [`.changeset/config.json:5`](../../.changeset/config.json) today is
  `["blogwright", "blogwright-core", "blogwright-pds"]` — without adding the
  package, `blogwright-analytics@<cli version>` would never exist on the
  registry and the documented install path would fail. Joining the group is the
  smaller change; the alternative is teaching `plugin add` a second
  version-resolution rule.

**Open questions**

- Should old rows age out at all — and if so, the plugin must delete them
  itself, because S3 Tables offers no row-retention knob for a table you
  create. `PutTableRecordExpirationConfiguration` exists but applies only to
  AWS-managed tables (S3 Storage Lens, Amazon SageMaker Catalog): AWS
  documents "record expiration options aren't available for S3 tables that
  you create" (verified 2026-07-27). `PutTableMaintenanceConfiguration`, the
  per-table configuration that does apply to a table you create, governs
  snapshot expiry and file compaction — storage reclamation, not row
  retention. Row expiry is therefore partition-level deletes the plugin
  issues on its own schedule, and the design makes them cheap to shape: the
  table is append-only and partitioned by `day`, so deleting whole `day`
  partitions older than a cutoff is the natural form if aging out is wanted
  at all. The site's `retention.cloudfrontDays` governs only the CloudWatch
  copy.
- The Glue catalog integration is account-and-region scoped while everything
  else the plugin owns is per-environment. Two environments therefore share it,
  and its node adopts rather than creates. Is adopt-and-never-delete the right
  contract, or should the last environment to be torn down remove it?
