# Analytics pipeline and local dashboard

**Status:** Implemented · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [overview](00-overview.md), [domain model](01-domain-model.md) and [development guidelines](../../../DEVELOPMENT.md).

## Responsibilities and commands

`blogwright-analytics` is installed on demand with `plugin add analytics`.
Its manifest claims analytics; it declares status, dashboard and optional backfill,
contributes init, and receives generic bootstrap/destroy from the host. Status
walks all fourteen nodes, reports stream state/failure and table row count; missing
resources are reported without treating a never-bootstrapped environment as failure.
The plugin owns its clients, graph, transform, queries, adapters and static app;
it imports core and never the CLI. [plugin.ts](../../../packages/analytics/src/plugin.ts)
and [commands.ts](../../../packages/analytics/src/commands.ts) wire the boundaries.

## Data path and region

```text
CloudFront / site's delivery source --> existing CloudWatch Logs copy
                                  +--> analytics Firehose stream
                                          | transform Lambda
                                          v
                                      S3 Tables Iceberg
                                          ^
                           DuckDB query / optional backfill adapter
```

Every regional resource and plugin-created client uses us-east-1 regardless of
config.region; both IAM roles are global. Four plugin-local clients speak S3 Tables
REST JSON, Firehose, Glue and standard Lambda (not Lambda MicroVM paths). They use
service descriptors and the host signingUsEast1 to preserve credential provider,
endpoint override and transport substitution. Core S3 and Secrets Manager clients
are also constructed over signingUsEast1; host iam and logsUsEast1 are reused.
See [client factory/tests](../../../packages/analytics/src/aws/clients.ts).

The plugin never creates the site's delivery source. It reads names.deliverySource
and the cloudfront-distribution ARN in readonly siteState, and refuses a missing
site prerequisite with bootstrap guidance. The site's log node protects shared
sources on both ordinary delete and ConflictException retry: it compares delivery
destination ARNs, refuses foreign attachments before mutation and deletes only
its own delivery ids. The analytics node likewise deletes only its own deliveries.

## Fourteen resource nodes

All node outputs go through record into `state/<env>.analytics.json`. The
following ids all carry the `analytics-` prefix; dependencies in the table omit
that common prefix. Source and negative-space tests:
[nodes.ts](../../../packages/analytics/src/nodes.ts),
[nodes.test.ts](../../../packages/analytics/src/nodes.test.ts).

| Node suffix | Dependencies | Resource and recorded outputs |
| --- | --- | --- |
| `table-bucket` | None | S3 Tables bucket; name, arn |
| `namespace` | table-bucket | Namespace; name, tableBucketArn |
| `table` | namespace | Iceberg table/schema/day partition; name, optional arn |
| `catalog-integration` | table | Glue s3tablescatalog federation; name, sourceIdentifier, optional arn |
| `salt-secret` | None | Persistent random salt seed; name, optional arn, never secret value |
| `transform-log-group` | None | Lambda log group; name, arn |
| `transform-role` | salt-secret | Lambda execution role; name, arn |
| `transform-function` | transform-role, transform-log-group | Lambda; name, optional arn, sourceHash, codeKey, configuration fingerprint |
| `error-bucket` | None | Failed-record S3 bucket; name, arn |
| `firehose-log-group` | None | Firehose group + DestinationDelivery stream; group name, arn |
| `firehose-role` | error-bucket, table, transform-function | Delivery role; name, arn |
| `firehose-stream` | firehose-role, table, catalog-integration, transform-function, firehose-log-group | Stream; name, state, optional arn/versionId/destinationId/appendOnly/loggingEnabled/failure |
| `log-destination` | firehose-stream | CloudWatch delivery destination; name, arn, outputFormat |
| `log-delivery` | log-destination | Site source attachment; source, destination, distribution, delivery='configured', optional first-created createdDay |

The table schema comes from PAGE_VIEWS_COLUMNS, with field ids assigned in column
order and identity partition on day. Reads hydrate known resource outputs; ARN
consumers refuse absent recorded dependencies. Glue adoption verifies its
sourceIdentifier is the account/region wildcard S3 Tables source, not merely that
a catalog with the expected name exists. This shared federation has no delete.

Salt creation generates 32 random bytes, encoded as base64. Existing secrets are
adopted and never overwritten; teardown deliberately retains the salt with manual
cleanup guidance because surviving rows/backfill depend on it. The error bucket
is blocked from public access, tagged on create/update, emptied with a warning
and deleted on teardown. Neither the table nor failed-record bucket has an
automatic expiry policy in this implementation.

IAM grants are scoped to pipeline resources. The transform role reads only its
salt ARN and creates streams/writes events only in its Lambda log group; it lacks
logs:CreateLogGroup. The Firehose role grants Glue catalog/table access, S3 Tables
writes, transform invocation/config lookup, failed-record S3 writes and a fifth
statement permitting logs:PutLogEvents on the exact DestinationDelivery ARN.
Roles derive log ARNs, so they have no group dependency; writers explicitly do.

## Reconciliation, artifacts and bounds

The transform bundle is built with rolldown and zipped deterministically with
fflate. The source manifest hash/codeKey govern code updates, and a serialized
configuration fingerprint separately governs configuration updates. Missing
artifacts refuse with rebuild guidance. Lambda configuration is nodejs22.x,
256 MB and 60 seconds. Inline zip size is capped at 50 MiB; role/function/stream
names at 64 characters, failed-record bucket at 63, delivery destination at 60.
Derived names use the site prefix `<env>-<siteName>` and fail with shortening
guidance when over bound. IAM role propagation failures use bounded retry.

Firehose uses an Iceberg destination with AppendOnly=true, 900-second/128-MiB
buffer hints, the transform Lambda, `firehose-errors/` output and enabled
CloudWatch logging. `read` records live appendOnly and loggingEnabled, clearing
stale optional fields when absent. Update is a no-op only when appendOnly=true
**and** loggingEnabled=true. Otherwise it attempts UpdateDestination with recorded
VersionId/DestinationId. On success it re-reads; a failed re-read warns without
replacing an updated stream. A refused update or missing ids triggers replacement
with an explicit records-lost-during-gap warning. A logging-only delta normally
updates in place and preserves ARN/delivery; tests pin that no replacement occurs.
The guard does not compare the whole destination configuration.

Delivery destination create/update waits for an active stream (5-second polls,
5-minute timeout). A failed/non-active stream refuses wiring. Its read currently
uses the recorded destination ARN rather than an independent live lookup; status
is therefore not an end-to-end delivery proof. Update re-puts the stream target.
Changing recorded output format replaces the immutable destination; conflict
recovery removes only this plugin's deliveries/destination before retry. Both
replacement paths can lose arrivals during the gap and report that limit.

The delivery uses JSON output and selects only schema-needed fields, including
c-ip for hashing and timestamp(ms) for time derivation. `createdDay` is captured
before first createDelivery and set only when no string is already recorded.
Read/adoption does not invent it and later re-creates preserve it.

## Record transformation and privacy

[map-record.ts](../../../packages/analytics/src/transform/map-record.ts) derives
UTC event_time/day, maps the sixteen input fields listed in the
[domain model](01-domain-model.md), hashes the viewer and marks bot user agents.
Empty strings, hyphen and null/undefined mean absent. Missing required columns
reject the record; missing optional fields are omitted. String columns accept
finite numbers rendered as text; numeric columns accept finite numeric strings.
Present but invalid optional values reject the record instead of silently
asserting absence. event_time must render a four-digit-year UTC instant. Seconds
supplied as milliseconds remain a known plausible-but-wrong timestamp, and
fractional int/long inputs are not separately rejected.

`visitor_key` is SHA-256 over viewer IP, normalized user agent and a daily salt
HMAC-SHA256(rootSecret, day). The same-day digest matches between streaming and
backfill. A missing viewer IP omits visitor_key; a missing user agent hashes as
empty string. The mapper always sets is_bot; bots are retained regardless of the
query filter. Daily rotation prevents meaningful cross-day distinct visitor
counts: a range reports the sum of daily uniques, explicitly labelled that way.

No raw viewer-IP column enters page_views. This guarantee is specific to mapped
table rows: [handler.ts](../../../packages/analytics/src/transform/handler.ts)
returns one echoed recordId per input with Ok/base64 JSON for valid rows or
ProcessingFailed for invalid JSON/non-object/unmappable records. Dropped is unused.
Failed Firehose objects may retain the original payload, including c-ip, in
base64 rawData; [AWS failure handling](https://docs.aws.amazon.com/firehose/latest/dev/data-transformation-failure-handling.html)
defines that envelope. ProcessingFailed remains a visible data-quality signal,
not a privacy-preserving discard of the original record.

The analytics selection excludes cs(Cookie) and x-forwarded-for entirely. The
site's separate CloudWatch delivery uses AWS's default field set and is not
narrowed by this selection. The analytics salt is loaded on the first invocation
and cached for the execution environment; a failed read is not cached. Missing/
empty secret or hashing errors fail the invocation; there is no date-only or
unsalted fallback. Runtime failure logs and failed-record storage are distinct
from the successful table's privacy boundary.

## Observability

Two plugin-owned us-east-1 log groups use environment tags and 365-day retention,
reapplied on every update. `/aws/lambda/<prefix>-analytics-transform` precedes the
Lambda; `/aws/kinesisfirehose/<prefix>-analytics-firehose` precedes Firehose and
also ensures DestinationDelivery on create **and** update. A partial group-only
create therefore converges on the next apply. Reverse graph order removes the
writers before their log groups. BackupDelivery is not created.

Firehose create and update both enable CloudWatchLoggingOptions with the group
and stream names. These logs complement ProcessingFailed S3 records and Firehose
error metrics. The transform emits one `transform_batch` event for each completed batch with
mapped/processingFailed totals and fixed invalid_payload/schema_rejected counts
(including zeros). Each uncached salt read emits `salt_read` with success/failure;
cache hits emit no read event and failed reads remain retryable. Diagnostics
carry no payload, raw IP, URL, user agent, salt value/name or exception details.
An injected [TransformDiagnostics port](../../../packages/analytics/src/transform/diagnostics.ts)
reaches a JSON-line adapter wired to console.info in the Lambda entry. The
[adapter](../../../packages/analytics/src/adapters/transform-diagnostics.ts) JSON-serializes
the typed event; the handler constructs only the fixed diagnostic fields. A sink must return normally;
observation does not change the handler's Ok/ProcessingFailed response contract.
The [closure report](../../reviews/2026-09-05-specification-closure.md) records
current diagnostic, retry/cache and response regression evidence.
No retention configuration key or special log-group status action is added.

## Dashboard, queries and ports

`analytics dashboard [env]` serves prebuilt `dist/app` on 127.0.0.1:4317 by
default. The SvelteKit app uses a static adapter and Vite build. The server accepts
GET/HEAD only, validates Host against localhost/127.0.0.1 with its bound port,
serves only enumerated app files and exposes `/api/queries/<name>`.
Required from/to are inclusive UTC calendar dates; optional includeBots is the
literal true/false string. Unknown names return 404, bad parameters 400, foreign
Host 403, unsupported methods 405 and missing app output 503. Query responses
contain name, rowMeaning, resultColumns and rows; no SQL comes from the socket.

The fixed query names are views-over-time, unique-visitors, top-paths, referrers,
countries, status-codes, cache-hit-ratio, and row-count (used by status/backfill).
All take a date range and bot inclusion, whose absent default follows bots=flag
or filter. SQL uses module-private branded text/relation types and bound values;
only the adapter binds the fixed page_views relation to the configured table.
[queries.ts](../../../packages/analytics/src/queries.ts) and
[server.ts](../../../packages/analytics/src/server.ts) define these contracts.

`AnalyticsQuery.run(name, params)` returns readonly rows of string/number/boolean
values. `AnalyticsIngest.insertDay(day, rows)` writes through a separate port.
DuckDB vendor calls and errors stay in [adapters](../../../packages/analytics/src/adapters/duckdb-query.ts);
fixture/recording implementations support domain tests. Credentials resolve
through core's provider chain and are explicitly supplied to DuckDB's secret;
the query attachment is read-only and the ingest attachment permits transactions.
They do not use an unrelated DuckDB credential chain.

## Optional backfill and teardown limits

`analytics backfill [env]` is a manual import, not a poller or scheduled pipeline.
Before AWS work it requires an analytics-log-delivery record with a valid
YYYY-MM-DD createdDay. Missing delivery names bootstrap; missing day on an
existing delivery requires supplying its actual historical creation day because
bootstrap cannot reconstruct it. Guessing a later day risks overlap.

It considers retention.cloudfrontDays whole UTC days immediately before
createdDay, reads the site's CloudWatch group through filterEvents and maps with
the same retained salt/mapper. A row-count query with bots included skips occupied
days. Each unoccupied day inserts once in a transaction; malformed/foreign-day
rows are omitted with warnings. A crash resumes at unoccupied days; this is a
single-operator day-level guarantee, not row deduplication or cross-process
locking. The boundary day is excluded, losing up to one day at the streaming
seam; logs already expired from CloudWatch cannot be recovered. It reports
inserted, occupied, empty and boundary days. See [backfill](../../../packages/analytics/src/backfill.ts)
and [transaction adapter](../../../packages/analytics/src/adapters/duckdb-ingest.ts).

Destroy removes the plugin's graph/state while retaining the shared Glue
federation and the long-lived salt. Table rows and failed-record objects are
removed with their resources. Site teardown refuses until plugin scoped state
is gone. CloudWatch source-log retention is separate from plugin log retention
and from the Iceberg table, whose rows have no automatic ageing in this code.

## Assumptions and open questions

**Assumptions**

- The AWS account, credentials and installed packages are operator-controlled.

**Decisions**

- *Scope.* **Internal implementation contracts.** No supported third-party SPI is introduced.
- *Ownership.* **Separate graphs and state keys.** Each feature reconciles its own resources through shared vocabulary and the CLI engine.

**Open questions**

- How should Iceberg rows expire when operators require a retention policy?
- Should the shared Glue federation ever have an explicit account-wide cleanup command?
- Should the Firehose update guard compare a normalized complete live destination?
- Should the plugin's two log-group retention periods become configurable?
- Should the site's build role lose its redundant logs:CreateLogGroup grant?
- Should analytics status give missing diagnostic groups more prominence than the generic node walk?
- Should the mapper reject fractional int/long values and seconds-shaped timestamp inputs?
