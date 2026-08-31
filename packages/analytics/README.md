# blogwright-analytics

Traffic analytics for [blogwright](https://github.com/antstanley/blogwright): a second
CloudFront access-log delivery routed through Amazon Data Firehose into an Apache Iceberg
table in an S3 Tables bucket, with a local SvelteKit dashboard that reads that table
through DuckDB. The site's existing CloudWatch log delivery is untouched - one CloudFront
delivery source carries several deliveries, so this one is added beside it.

This package owns the whole pipeline: its own four AWS service clients (S3 Tables,
Firehose, Glue, Lambda), the twelve resource nodes those clients reconcile, the
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
CLI's own version and pinned exactly, so the CLI and its plugins cannot drift apart
between two checkouts of the same repo. `blogwright plugin list` shows it once installed,
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
| `blogwright analytics destroy [env] --yes` | Removes the plugin's own resources. The Glue federation is the one exception and is never deleted - see below. |

Two things the table does not say. The plugin's resources are recorded in their own state
object, `state/<env>.analytics.json`: `blogwright bootstrap` provisions none of them, and
`blogwright destroy --yes` refuses while that object exists and names
`blogwright analytics destroy <env> --yes` as the way through. And the dashboard's server
answers only the queries this package defines by name - the seven the dashboard charts
(`views-over-time`, `unique-visitors`, `top-paths`, `referrers`, `countries`,
`status-codes`, `cache-hit-ratio`) plus the `row-count` that `analytics status` reads.
It never executes SQL supplied over its socket, and it binds loopback only.

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

**The raw viewer IP is never stored.** `c-ip` is selected from CloudFront only so the
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

## Shared state, and what teardown leaves behind

One resource is account-and-region scoped rather than per-environment: the Glue
`s3tablescatalog` federation that Firehose reaches S3 Tables through. Two environments of
the same site share it. Its node therefore adopts an existing federation rather than
failing, and its `delete()` is a no-op - tearing down staging must not break production,
and the Glue API this package speaks exposes no delete operation at all. Everything else
the plugin creates is per-environment and is removed by
`blogwright analytics destroy <env> --yes`.

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
