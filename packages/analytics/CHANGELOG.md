# blogwright-analytics

## 0.4.0-beta.4

### Patch Changes

- [#31](https://github.com/antstanley/blogwright/pull/31) [`d154c30`](https://github.com/antstanley/blogwright/commit/d154c3087a6d850d07a3189b83be40573528c5e7) Thanks [@antstanley](https://github.com/antstanley)! - Place the theme selector at the top right on desktop and mobile, and reduce its height to 42px.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`a2ff05c`](https://github.com/antstanley/blogwright/commit/a2ff05c689645f99e4fea00b4c24ba9f8a62d827) Thanks [@antstanley](https://github.com/antstanley)! - Make Countries full width and add an offline world map alongside the bar view, with a colour scale, full country data, and disclosure of unmapped codes.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`6fa0991`](https://github.com/antstanley/blogwright/commit/6fa09915d31eb8d0d200787ea038ec2524bcb640) Thanks [@antstanley](https://github.com/antstanley)! - Add a Path filter across all reports, matching the exact path and its slash-delimited descendants. Bind literal path values in SQL alongside UTC time and bot filters. Support trailing slashes and clearing the filter, reject malformed paths, and update mock reports to demonstrate scoped results.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`030a298`](https://github.com/antstanley/blogwright/commit/030a298a15376afe9f98374d089a86634276e893) Thanks [@antstanley](https://github.com/antstanley)! - Show Top paths as a pie chart with request shares, a full-label legend, and an Other paths slice retaining the remaining traffic.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`b111675`](https://github.com/antstanley/blogwright/commit/b111675d92fac335b1694c8d8ad23cf504430a37) Thanks [@antstanley](https://github.com/antstanley)! - Add an accessible icon-only Refresh button beneath the theme control. Refresh all report queries while preserving dates, selected presets, traffic options, granularity, and country view.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`030a298`](https://github.com/antstanley/blogwright/commit/030a298a15376afe9f98374d089a86634276e893) Thanks [@antstanley](https://github.com/antstanley)! - Add UTC minute-precision reporting windows and rolling presets from three hours to one year, anchored to the current minute on each selection. Apply exact start-inclusive/end-exclusive event-time filtering to every query while preserving the existing inclusive date-only API. Calendar month/year presets clamp month ends and leap days. Update mock time series to cover the selected window.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`a2ff05c`](https://github.com/antstanley/blogwright/commit/a2ff05c689645f99e4fea00b4c24ba9f8a62d827) Thanks [@antstanley](https://github.com/antstanley)! - Add a keyboard-accessible System, Dark, and Light theme selector that remembers the dashboard preference locally.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`654b9a4`](https://github.com/antstanley/blogwright/commit/654b9a4bd33e43fad87f3fddce4c8edb9074410b) Thanks [@antstanley](https://github.com/antstanley)! - Make All traffic explicitly include bots and show bot/non-bot contributions in stacked area and bar charts. Preserve aggregate totals, count overlapping visitor keys once, and stack cache-hit contributions against the common request denominator. Include contributions in accessible tables and the opt-in splitBots API response.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`030a298`](https://github.com/antstanley/blogwright/commit/030a298a15376afe9f98374d089a86634276e893) Thanks [@antstanley](https://github.com/antstanley)! - Add 15-minute, 1-hour, 6-hour, 12-hour, and 24-hour granularity for Views over time using UTC event-time buckets, with an animated, keyboard-accessible radio pill, validated API options, and matching mock preview data. The selection animation respects reduced-motion preferences.

  Extract the compact animated selector into a reusable PillRadio component, and use it for Bot traffic above the reporting date inputs.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`030a298`](https://github.com/antstanley/blogwright/commit/030a298a15376afe9f98374d089a86634276e893) Thanks [@antstanley](https://github.com/antstanley)! - Render Views over time as an area chart with local brush zoom and a reset control, retaining the full reporting-period data table.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`21b41ce`](https://github.com/antstanley/blogwright/commit/21b41ce1b85e13a45e5249be89ffc40148d424be) Thanks [@antstanley](https://github.com/antstanley)! - Refine dashboard hierarchy, responsive filters and report spacing, with visible keyboard focus and theme-aware error feedback.

- [`55869df`](https://github.com/antstanley/blogwright/commit/55869dfb1e02b7a4bb8df12ee1b412ca50efc07e) Thanks [@antstanley](https://github.com/antstanley)! - Capture the initial log-delivery UTC day before sending CreateDelivery, while recording it only after success. Requests that cross midnight now keep the earlier backfill bound, preventing duplicate ingestion of the day live delivery may have started.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`a2ff05c`](https://github.com/antstanley/blogwright/commit/a2ff05c689645f99e4fea00b4c24ba9f8a62d827) Thanks [@antstanley](https://github.com/antstanley)! - Normalize dashboard date and bot-filter dimensions across browsers, with consistent calendar and dropdown icons.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`2ab21a4`](https://github.com/antstanley/blogwright/commit/2ab21a4db44f91ccf57a41ebfb6f59f72a5a89ad) Thanks [@antstanley](https://github.com/antstanley)! - Open country detail dialogs from the map or search results, showing daily unique viewers for the selected reporting period and filters. Add parameterized country filtering to reporting queries, accessible area-chart details, and country-scoped preview data.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`738fbd6`](https://github.com/antstanley/blogwright/commit/738fbd6ffefd27019fff41f5564f5a6c62dbcc3b) Thanks [@antstanley](https://github.com/antstanley)! - Replace native reporting date/time pickers with themed, keyboard-accessible calendars and editable UTC date/time segments. Add collapsible reporting filters, compact controls, higher-contrast selections, and tighter chart headings. Highlight Top Paths pie slices on legend hover or keyboard focus while preserving reporting presets and range validation.

- [`dc310a1`](https://github.com/antstanley/blogwright/commit/dc310a19219d8ef2a98c7dd248f5fea503acdf52) Thanks [@antstanley](https://github.com/antstanley)! - Emit bounded transform mapping and ProcessingFailed counts and uncached salt-read outcomes in the transform Lambda log group, without logging record or secret data.

- [#31](https://github.com/antstanley/blogwright/pull/31) [`2ab21a4`](https://github.com/antstanley/blogwright/commit/2ab21a4db44f91ccf57a41ebfb6f59f72a5a89ad) Thanks [@antstanley](https://github.com/antstanley)! - Add offline fuzzy country search to the Countries map, with keyboard-accessible suggestions, a highlighted matching country, and request counts for the selected reporting range.

- Updated dependencies [[`a57b3ff`](https://github.com/antstanley/blogwright/commit/a57b3ffaca704a75bc548014f2c5510936935446)]:
  - blogwright-core@0.4.0-beta.4

## 0.4.0-beta.3

### Minor Changes

- [#28](https://github.com/antstanley/blogwright/pull/28) [`e3548bb`](https://github.com/antstanley/blogwright/commit/e3548bb9bdb79fb3d12c7affd1e1b4e3d532b493) Thanks [@antstanley](https://github.com/antstanley)! - The analytics plugin owns the two CloudWatch log groups its pipeline writes to. `analytics-transform-log-group` is `/aws/lambda/<prefix>-analytics-transform`, the group the transform Lambda never had - no node created it and its execution role could not - and `analytics-firehose-log-group` is `/aws/kinesisfirehose/<prefix>-analytics-firehose` with the `DestinationDelivery` stream Firehose writes its delivery errors to. Both are pinned to `us-east-1` with the rest of the pipeline, created with the environment's tags, and retained for 365 days, re-applied on every apply. Twelve nodes become fourteen.

  On an environment provisioned before this change, the next `blogwright analytics bootstrap` does five things, and needs no teardown to do any of them: it creates the two log groups, applies the 365-day retention to each, creates the `DestinationDelivery` log stream, adds a fifth statement to the Firehose delivery role granting `logs:PutLogEvents` on that one stream's ARN, and issues one `UpdateDestination` against the live delivery stream to turn error logging on. The two groups appear as two new nodes in the bootstrap output and in `blogwright analytics status`; the role and stream updates are reported against the nodes that already existed. `UpdateDestination` keeps the stream's ARN, so the CloudFront log delivery pointed at it is untouched and no access log is lost.

  The stream node's update guard was widened to make that last step reachable at all. It reconciled on the `AppendOnly` flag alone, which every stream this plugin created already matches, so it would otherwise have returned without a single AWS call and left every deployed stream unlogged. It now returns early only when `AppendOnly` matches **and** logging is already enabled on the live destination, read back off the stream rather than assumed.

  `blogwright-core` gains `LogsClient.ensureLogStream(logGroupName, logStreamName)`, which swallows an already-exists response exactly as `ensureLogGroup` does. It is the second core operation this pipeline needs; the plugin has no CloudWatch Logs client of its own and gains none.

### Patch Changes

- Updated dependencies [[`e3548bb`](https://github.com/antstanley/blogwright/commit/e3548bb9bdb79fb3d12c7affd1e1b4e3d532b493)]:
  - blogwright-core@0.4.0-beta.3

## 0.4.0-beta.2

### Patch Changes

- [#25](https://github.com/antstanley/blogwright/pull/25) [`c7e7b53`](https://github.com/antstanley/blogwright/commit/c7e7b5341878cb78a9ddab4e0436a25c0610b014) Thanks [@antstanley](https://github.com/antstanley)! - Retry `CreateDeliveryStream` while IAM propagates the Firehose delivery role, and stop a transient refusal from replacing the stream

  The previous release fixed this for the transform Lambda. The graph has **two** role-to-consumer pairings, and the next `analytics bootstrap` failed on the other one node later:

  ```
  × firehose: InvalidArgumentException - createDeliveryStream "<env>-<site>-analytics-firehose":
    Firehose is unable to assume role arn:aws:iam::…:role/<env>-<site>-analytics-firehose-role.
    Please check the role provided. (HTTP 400)
  ```

  Same cause: IAM is eventually consistent and each role is created in the node immediately before the one that assumes it. Firehose words the failure nothing like Lambda does and puts nothing machine-readable in the code, so the predicate now carries both phrasings and is documented as the place to add a third if a future node consumes a role from another service.

  `UpdateDestination` matters more than consistency here. Its refusal handler is deliberately un-narrowed, so _any_ failed update falls back to deleting and recreating the stream. That meant a transient propagation 400 was indistinguishable from a genuine refusal, and answering it destroyed a healthy stream: a new ARN, the CloudFront log delivery pointed at the old one orphaned, and the records in flight lost. Retrying the timing failure keeps the destructive fallback for the case that warrants it.

  Four tests, each watched failing first, including that a role-propagation refusal on update issues no `CreateDeliveryStream` at all.

- Updated dependencies []:
  - blogwright-core@0.4.0-beta.2

## 0.4.0-beta.1

### Patch Changes

- [#23](https://github.com/antstanley/blogwright/pull/23) [`d9c7fd5`](https://github.com/antstanley/blogwright/commit/d9c7fd5d05a9c4d19c712b35d8ef3616c3bdb4bd) Thanks [@antstanley](https://github.com/antstanley)! - Retry `CreateFunction` while IAM has not finished propagating the transform role

  `blogwright analytics bootstrap` failed on a fresh environment at the tenth of twelve nodes:

  ```
  × lambda: Http400 - createFunction "<env>-<site>-analytics-transform":
    The role defined for the function cannot be assumed by Lambda. (HTTP 400)
  ```

  IAM is eventually consistent, and this graph creates the transform role in the node immediately before the one that uses it — the tightest possible window. AWS refuses a `CreateFunction` naming a role it has not finished propagating, and the same request succeeds seconds later with nothing changed.

  Both `CreateFunction` and `UpdateFunctionConfiguration` now retry with exponential backoff while that specific failure is what came back. `UpdateFunctionConfiguration` is included because it sends `roleArn` too, so an environment whose role was torn down and recreated hits the identical window on the update path.

  The retry predicate is deliberately narrow — this message, at HTTP 400, on this service — rather than "retry 400s". Almost every other 400 Lambda returns is permanent (a malformed zip, a bad handler path, a role that genuinely lacks the trust policy), and retrying those would turn a clear failure into a slow one.

  A bootstrap interrupted by this needed no cleanup: the graph persists state on the failure path, so re-running resumed at the Lambda and skipped the nine resources already created.

- Updated dependencies []:
  - blogwright-core@0.4.0-beta.1

## 0.4.0-beta.0

### Minor Changes

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright analytics backfill [env]` fills the history that predates the Firehose delivery. It is optional, run by hand and one-shot, never part of the steady-state pipeline: it reads the CloudWatch log group the site's existing CloudFront delivery already writes, through `LogsClient.filterEvents` over the pinned us-east-1 client, and maps every event through the same code the transform Lambda runs - the same field mapping, the same `visitor_key` derivation from the same stored secret, and the same drop rules - so one CloudFront record produces the same `page_views` row whichever path carried it. Rows are written through a new `AnalyticsIngest` port whose DuckDB adapter attaches the catalog writable; the dashboard's own attach stays read-only.

  It cannot double-count, by construction rather than by de-duplication. The `analytics-log-delivery` node records the UTC day it first created its delivery, written once and never advanced, and the backfill inserts only whole days strictly before it - Firehose received nothing before its delivery existed. Each day is one transaction, a day the table already holds rows for is skipped, and a mapped row whose own `day` is not the day being written is left for that day's own pass, so a re-run inserts nothing and a crashed run resumes cleanly. The boundary day itself is never backfilled: up to one day of history at the seam is the accepted precision limit.

  With no recorded day there is no safe range, so the command refuses before it calls AWS - both when the plugin's state carries no delivery record and when it carries one with no recorded day, which is what a state file that lost the key looks like. The report names every day inserted, every day skipped and why, the records it could not map, and the boundary day it left alone.

  The `backfill` action was declared but not implemented until now, and reported that it was not available yet.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright analytics bootstrap` and `blogwright analytics destroy --yes` now answer. The plugin contributes the twelve resource nodes the pipeline is built from - the S3 Tables bucket, its namespace and the `page_views` table, the Glue `s3tablescatalog` federation, the `visitor_key` salt secret, the transform Lambda and its execution role, the Firehose error bucket, delivery role and delivery stream, and the CloudWatch delivery destination and delivery - and the CLI's own graph engine reconciles them. Until now the plugin declared no `nodes`, so both verbs were unanswered and unadvertised in `blogwright --help`.

  Two things an operator should know. Every node's title states the `us-east-1` pin, so `analytics bootstrap` says out loud that these resources diverge from `config.region` rather than deriving it silently; the two IAM roles state it as the pipeline they serve, because IAM is global. And the plugin's resources are recorded in their own state object, `state/<env>.analytics.json`: `blogwright bootstrap` provisions none of them and `blogwright destroy --yes` removes none of them - it refuses while that object exists and tells you to run `blogwright analytics destroy <env> --yes` first.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright-analytics` is a new package: an optional blogwright plugin that routes a second CloudFront access-log delivery through Amazon Data Firehose into an Apache Iceberg table in an S3 Tables bucket, and serves a local SvelteKit dashboard that reads that table through DuckDB. It is never shipped with the CLI - `blogwright plugin add analytics` installs it at the running CLI's own version, `blogwright analytics init` writes its config block, and `blogwright analytics bootstrap` provisions the twelve resources it owns. Everything it creates is pinned to `us-east-1`, because CloudFront standard logging accepts a Firehose delivery stream only there. The site's existing CloudWatch delivery is untouched, and the plugin's resources live in their own state object (`state/<env>.analytics.json`), so `blogwright bootstrap` provisions none of them and `blogwright destroy --yes` refuses while that object exists.

  Three surfaces on `blogwright-core` exist for it, and each is a minor: `AwsClients.signingUsEast1`, the plugin-supplied service descriptor `SendOptions.service` and `resolveEndpoint` accept, and the delivery-configuration parameters on `LogsClient` (`putDeliveryDestination`'s `outputFormat`, `createDelivery`'s `recordFields` and `fieldDelimiter`). Core gains no service it does not use itself: the plugin's own four clients - S3 Tables, Firehose, Glue and Lambda - live in `blogwright-analytics` and sign through that descriptor seam, and `SIGNING_NAMES` is unchanged.

  Personal data is not retained. The raw viewer IP is selected from CloudFront only so the transform Lambda can derive `visitor_key` from it - a SHA-256 digest over the IP, the user agent and a daily salt, where the salt is `HMAC-SHA256(secret, day)` over one long-lived secret in Secrets Manager - and no column holds the address. `cs(Cookie)` and `x-forwarded-for` are never selected, so they never leave CloudFront for this pipeline, and no cookie is set.

  The `backfill` action is declared but not yet implemented: it reports that it is not available yet, and lands with its body in a later change.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright analytics status <env>` now answers. It reads each of the plugin's twelve nodes against `state/<env>.analytics.json` and reports it present or missing - a drift tree on a terminal, one stable line per node otherwise - and then adds the two figures the generic `status` verb cannot: the Firehose stream's delivery health, taken from the state the stream node's own read hydrated rather than from a second describe, and the current row count of the `page_views` table.

  Three things worth knowing. The row count crosses the `AnalyticsQuery` port as a named query (`row-count`, new in the plugin's query set) over the whole `day` range with bot rows counted, so it is the table's row count and not the dashboard's filtered view; reaching the table needs the same AWS session `analytics dashboard` needs, and a session that cannot reach it degrades to a warning rather than failing the command. A stream that is absent, unreadable, or in any state other than `active` is reported as a warning too, on the same principle - a status line that stayed silent about a stream delivering nothing would read as healthy. And an environment that was never bootstrapped is not an error: every node reports missing, the two extras warn, and the command exits 0.

### Patch Changes

- [#21](https://github.com/antstanley/blogwright/pull/21) [`2c6d96b`](https://github.com/antstanley/blogwright/commit/2c6d96bca906227ed5652774159ce4066326d79b) Thanks [@antstanley](https://github.com/antstanley)! - Fix `bootstrap`, `deploy` and `analytics bootstrap` throwing `date not in range 1980-2099` outside UTC

  Every zip this CLI builds stamped its entries with `new Date('1980-01-01T00:00:00Z')`. A zip's DOS timestamp is **local** time, so west of Greenwich that value is 1979 and `fflate` refuses it outright. `blogwright bootstrap`, `blogwright deploy` and `blogwright analytics bootstrap` therefore failed for operators across most of the Americas, on the first command a new user runs.

  The crash was also hiding a second defect: in zones where it did not throw, the encoded timestamp still varied, so identical input produced different archive bytes — the exact opposite of the reproducibility the fixed timestamp exists to provide.

  `blogwright-core` now exports `REPRODUCIBLE_ZIP_MTIME`, a locally-constructed 1980-01-02 that is in range and byte-identical in every zone, and the three sites that hand-rolled the old value use it: `packages/cli/src/repo.ts`, `packages/cli/src/agent-package.ts` and the analytics transform bundle.

  Nothing about the archives changes for anyone already on UTC except the stamped date.

  The coverage was never missing — seven analytics tests already drove the failing path. CI ran `TZ=UTC`, the one setting where the bug is invisible, so the test job now runs in a negative-offset zone instead.

- Updated dependencies [[`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`2c6d96b`](https://github.com/antstanley/blogwright/commit/2c6d96bca906227ed5652774159ce4066326d79b), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a)]:
  - blogwright-core@0.4.0-beta.0
