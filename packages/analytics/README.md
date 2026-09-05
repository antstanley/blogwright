# blogwright-analytics

Traffic analytics for [blogwright](https://github.com/antstanley/blogwright): a second
CloudFront access-log delivery routed through Amazon Data Firehose into an Apache Iceberg
table in an S3 Tables bucket, with a local SvelteKit dashboard that reads that table
through DuckDB. The site's existing CloudWatch log delivery is untouched - one CloudFront
delivery source carries several deliveries, so this one is added beside it.

This package owns the whole pipeline: its own four AWS service clients (S3 Tables,
Firehose, Glue, Lambda), the fourteen resource nodes those clients reconcile, the
record-transform Lambda, the named query set, and the dashboard application. It depends
on `blogwright-core` (ports, the SigV4 transport and signer, the S3 and Secrets Manager
clients) and on DuckDB, which is reached only through the `AnalyticsQuery` port's one
adapter. It never imports the CLI.

## Install

The plugin is not shipped with the CLI. A repo that never installs it pays nothing:

```sh
blogwright plugin add analytics
```

`analytics` resolves to the package `blogwright-analytics`, installed at the running
CLI's own version and pinned exactly, so each checkout installs the recorded pair. This is an install-time pin, not an
upgrade mechanism: updating the CLI alone can still leave a plugin at an older version. `blogwright plugin list` shows it once installed,
and `blogwright plugin remove analytics` offers to tear its resources down first.

## Commands

Once installed, the plugin answers `blogwright analytics <action> [env]`. The environment
defaults to `production` and `--env` overrides the positional, exactly as for a built-in
command. Five actions are the steady state:

| Action | What it does |
| --- | --- |
| `blogwright analytics init [env]` | Asks for the `analytics` config block - namespace, table, bot handling, dashboard port - and splices it into `config/<env>.jsonc`. `blogwright init` asks the same questions as part of the first-run wizard. |
| `blogwright analytics bootstrap [env]` | Provisions the pipeline: the S3 Tables bucket, its namespace and the `page_views` table, the Glue `s3tablescatalog` federation, the `visitor_key` salt secret, the transform Lambda and its execution role, the Firehose error bucket, delivery role and delivery stream, and the CloudWatch delivery destination and delivery. |
| `blogwright analytics status [env]` | Reports each node present or missing, then the Firehose stream's delivery health and the table's current row count. An environment that was never bootstrapped is not an error: every node reports missing and the command exits 0. |
| `blogwright analytics dashboard [env]` | Serves the prebuilt dashboard from `dist/app` on `127.0.0.1` (port 4317 by default) and answers its named queries against the table. |
| `blogwright analytics destroy [env] --yes` | Removes the plugin's own resources. The Glue federation and salt secret are retained - see below. |

Two things the table does not say. The plugin's resources are recorded in their own state
object, `state/<env>.analytics.json`: `blogwright bootstrap` provisions none of them, and
`blogwright destroy --yes` refuses while that object exists and names
`blogwright analytics destroy <env> --yes` as the way through. And the dashboard's server
answers only the queries this package defines by name - the seven the dashboard charts
(`views-over-time`, `unique-visitors`, `top-paths`, `referrers`, `countries`,
`status-codes`, `cache-hit-ratio`) plus the `row-count` that `analytics status` reads.
It never executes SQL supplied over its socket, and it binds loopback only.

### `blogwright analytics backfill [env]` - optional, one-shot

A sixth action, deliberately not in the table above, because it is not part of
the steady state. Firehose only carries what CloudFront produced after its
delivery existed; `backfill` is the hand-run pull of the history that came
before it, and once it has run there is no reason to run it again.

It reads the CloudWatch log group the site's own delivery already writes -
`/<siteName>/<env>/cloudfront`, bounded by `retention.cloudfrontDays` - and
maps every event through the same code the transform Lambda runs, so a record
produces the same `page_views` row whichever path carried it, `visitor_key`
included: the day's salt is `HMAC-SHA256(secret, day)` over the same stored
secret, so a historical day's salt is derivable. Successful table rows contain
no raw viewer-IP column; the source CloudWatch copy remains separate.

**It cannot double-count, and not by de-duplicating.** The
`analytics-log-delivery` node records the UTC day it first created the
delivery, once and never again, and the backfill inserts only whole days
*strictly before* that day - Firehose received nothing before its delivery
existed, so the two paths never write the same day. Within that range each day
is one transaction, a day the table already holds rows for is skipped, and a
row whose own `day` is not the day being written is not inserted. So a re-run
inserts nothing, and a run that crashed resumes where it stopped.

The boundary day itself is never backfilled. Up to one day of history at the
seam is lost, which is the accepted precision limit rather than an oversight:
buying it back would mean comparing rows, and comparing rows is the thing this
design does not do.

The command refuses, before it calls AWS at all, when the plugin's state
carries no delivery record - run `blogwright analytics bootstrap <env>` first -
and also when it carries a delivery with no recorded day, which is what a state
file that lost the key looks like. There is no default in that case: assuming
"everything" would insert days Firehose has already delivered and double every
row in them, so the command says what to supply instead. Its report names every
day it inserted, every day it skipped and why, and the boundary day it left
alone.

## Everything is created in us-east-1

Every resource this plugin owns is created in `us-east-1` regardless of `config.region`,
and every node's title says so rather than diverging silently.

CloudFront forces it. CloudFront is a global service whose logging control plane lives in
`us-east-1` alone, and standard logging accepts a Firehose delivery stream only there, so
the stream has to be in that region. Everything the stream reaches has to follow: the
table bucket and its Iceberg table, the Glue federation the stream writes through, the
transform Lambda the stream invokes, the Firehose error bucket, and the salt secret the
Lambda reads. The two IAM roles are global, and state the pipeline they serve instead.

That is why this package builds its own S3 and Secrets Manager clients over the host's
`signingUsEast1` signer rather than reusing `ctx.clients.s3` and `ctx.clients.secrets`:
the host's pair signs in `config.region`, which would put the error bucket, and the salt,
in a region the transform function cannot read from.

## Privacy

**The `page_views` table has no raw viewer-IP column.** `c-ip` is selected from CloudFront only so the
transform Lambda can derive `visitor_key` from it, and no column of the `page_views` table
holds it: it has no entry in the field-to-column map, and the transform discards it after
hashing. `visitor_key` is a SHA-256 digest over the viewer IP, the user agent and that
day's salt, and the salt is `HMAC-SHA256(secret, day)` over one long-lived random secret
held in Secrets Manager - never the date alone, which anyone holding the table could
compute and then brute-force back across a 32-bit address space. The consequence is
deliberate and stated where it matters: a `visitor_key` is not comparable across days, so
a monthly unique-visitor figure is the sum of daily uniques rather than a distinct count.

**`cs(Cookie)` and `x-forwarded-for` are never selected**, so they never leave CloudFront
for this pipeline: they reach neither Firehose, nor the transform, nor the table. This
governs the analytics delivery only. The site's existing CloudWatch delivery is created
with no field list, so AWS's default set - which includes both - still applies to that
copy; narrowing it is a change to the site's own node, not this one.

No cookie is set and no identifier is written to a visitor's browser. Bot traffic is
flagged rather than dropped (`is_bot` is a column, and filtering is a query default), so
a heuristic that turns out to be wrong is a query change and not lost data.

Failed transformation records are different: `ProcessingFailed` sends the original
record to Firehose's failed-record S3 output. Its `rawData` can therefore retain
`c-ip`, even though successful table rows do not. This is deliberate failure
visibility, not a `Dropped` response. See [AWS failure handling](https://docs.aws.amazon.com/firehose/latest/dev/data-transformation-failure-handling.html).
The error bucket has no automatic expiry policy and is emptied during plugin teardown.
The site's existing CloudWatch log copy is a separate store with its own retention.

## Shared state, and what teardown leaves behind

One resource is account-and-region scoped rather than per-environment: the Glue
`s3tablescatalog` federation that Firehose reaches S3 Tables through. Two environments of
the same site share it. Its node therefore adopts an existing federation rather than
failing, and its `delete()` is a no-op - tearing down staging must not break production,
and the Glue API this package speaks exposes no delete operation at all. The long-lived salt secret is also retained: replacing it would break comparison
with surviving rows and historical backfill. Teardown prints manual cleanup guidance.
Other plugin-created resources are per-environment and removed by
`blogwright analytics destroy <env> --yes`; the table and failed-record objects are deleted.

Rows are never aged out. The table is append-only and partitioned by `day`, so expiring
old data would mean whole-partition deletes issued on a schedule; S3 Tables offers no
row-retention setting for a table you create. The site's `retention.cloudfrontDays`
governs only the CloudWatch copy of the logs.

## Configuration

The `analytics` block in `config/<env>.jsonc`, all of it optional:

| Key | Default | Meaning |
| --- | --- | --- |
| `namespace` | `web` | Iceberg namespace holding the table. |
| `table` | `page_views` | Iceberg table the page views land in. |
| `bots` | `flag` | `flag` keeps bot rows and marks them; `filter` excludes them from queries. |
| `dashboard.port` | `4317` | Port the local dashboard binds on `127.0.0.1`. |
| `tableBucket` | `<env>-<siteName>-analytics` | S3 Tables bucket holding the namespace. |
| `saltSecretName` | `<siteName>/<env>/analytics-salt` | Secrets Manager secret the daily salt is derived from. |

The last two carry the environment in their defaults and are not asked by the wizard: a
prompt whose default is wrong for every environment but one is worse than no prompt. Write
them into the block by hand to override either, where the same validator still checks
them. Do not take the environment out of either default: without it two environments
resolve to the same Iceberg table and the same salt, and `blogwright analytics destroy`
in staging would delete production's data.

## Diagnostic logs

The pipeline has fourteen resource nodes, including two log groups in us-east-1:
`/aws/lambda/<env>-<siteName>-analytics-transform` and
`/aws/kinesisfirehose/<env>-<siteName>-analytics-firehose`. Both retain logs for
365 days, reconciled on each bootstrap. The Firehose node ensures its
`DestinationDelivery` stream on create and update; delivery errors are enabled
on both new and existing streams. Transform diagnostics report per-batch mapped
and failed counts with fixed failure categories, plus success/failure of uncached
salt reads. They contain no original record fields or secret/error details.
These bounded diagnostics are separate from Firehose failed-record objects,
which can retain raw payloads. No retention config field is added.

`blogwright plugin remove analytics --yes` keeps provisioned resources. To remove
them first, run `blogwright analytics destroy <env> --yes`, then uninstall; config
is preserved. A noninteractive remove of the loadable node plugin without `--yes`
refuses because it cannot ask about teardown.

Dashboard presentation follows the [design guidelines](../../.specs/blogwright/specs/05-design.md).

## Local dashboard development

From the repository root, after `pnpm install`, run:

```sh
pnpm dev:analytics
```

This builds analytics and its workspace dependencies, then serves the real dashboard
at http://127.0.0.1:4318 with synthetic data for all seven reports. No AWS account,
credentials, DuckDB connection, or deployed infrastructure is needed. The server
binds to loopback only. Stop it with Ctrl+C; the port is released on shutdown.

Edit the dashboard under `app/src/`, then stop and rerun the command to rebuild.
This is a built-app preview, without hot reload. If the artifacts are already
current, `pnpm --filter blogwright-analytics dev:mock` skips the build.

Fixtures live in `scripts/dev-dashboard.mjs`. Time-series rows are generated for
the selected UTC window and granularity, including partial buckets. These counts
are synthetic; production queries aggregate actual event timestamps. Ranking
fixtures and bot filtering remain static. Remove a fixture entry to inspect an
isolated query error. Restart after fixture edits.
Port 4318 must be free; an occupied port fails instead of silently selecting another.

### Reusable pill radio selector

The dashboard's `app/src/lib/PillRadio.svelte` component provides the compact,
animated radio selector. Pass a group `label`, an `options` array of unique
`{ value, label, accessibleLabel? }` entries, and bind the selected `value`:

```svelte
<PillRadio label="Interval" options={intervalOptions} bind:value={interval} />
```

Option counts determine the pill width and highlight position. Set the inherited
`--pill-option-width` CSS property to adjust the default 60px option width. `accessibleLabel`
can expand an abbreviated caption. Each instance uses an independent radio name
by default; an optional `name` supports form integration. Native keyboard controls,
focus styling, and reduced-motion support are included.

### Reporting windows

Date/time inputs use UTC at minute precision. Presets from 3hrs to 1 year end at
the current minute when clicked; click again to refresh the anchor. Manual edits
select Custom; clicking Custom keeps the current bounds for editing. Calendar month/year presets clamp month-end dates.
The API also accepts `from`/`to` as `YYYY-MM-DDTHH:mmZ`: start is inclusive and
end exclusive. Existing date-only requests retain inclusive-day behavior.

The mock now generates time-series rows across the selected window, including
partial buckets. These are synthetic counts; ranking fixtures and bot filtering
remain static. Production queries filter actual event timestamps for every chart.
