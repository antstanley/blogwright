# Change: The analytics plugin owns its two CloudWatch log groups

**Status:** Merged · **Date:** 2026-08-31 · **Merged:** 2026-09-01 · **Owner:** Ant Stanley · **Target:** `packages/analytics` (two new resource nodes, the delivery role's fifth statement, the Firehose client's logging options, the stream node's update guard) + `packages/core` (one operation on the existing `LogsClient`)

The analytics pipeline is correct and undiagnosable. Its transform Lambda has
no log group, because no node creates one and the execution role cannot; its
Firehose stream sends no `CloudWatchLoggingOptions`, so delivery failures have
no destination to be explained in. This change gives the plugin **two more
resource nodes** - `analytics-transform-log-group` and
`analytics-firehose-log-group` - each owned with the read/create/update/delete
lifecycle and retention reconcile the site's own log groups have, both pinned
to `us-east-1` with the rest of the pipeline, both retained for 365 days. The
Firehose group's `update()` does one thing more than the site's: it re-ensures
the log stream Firehose writes to, so a group created by a run that stopped
short of its stream converges on the next apply rather than staying broken.
Firehose's error logging is enabled against the second of them, which also
means widening the stream node's update guard - it reconciles on the
`AppendOnly` flag alone today and would otherwise leave every existing stream
unlogged. Twelve nodes become fourteen.

---

## Motivation

The plugin's first production deployment established that the pipeline works
and cost a long diagnosis to establish it. Eleven CloudFront records went in,
eleven rows landed in `page_views`, the error bucket stayed empty, and
`DeliveryToIceberg.FailedRowCount` was zero - every one of those figures read
off CloudWatch metrics, because the two artifacts that say *why* a component
did what it did did not exist. `/aws/lambda/staging-iamstan-analytics-transform`
had never been created: the transform ran twice, reported nothing, and left no
trace. Firehose had no log group either, and would not have written to one.

Neither gap is a correctness bug, which is exactly what made them expensive.
The pipeline's record-level failure signals - the S3 error prefix and
Firehose's own error metric - both work, and both correctly reported zero
failures. But a record-level signal answers *which* records failed and never
*why*, and a system that can only report *that* something failed charges its
operator the diagnosis every time. `transformLogGroupArn`'s comment had noticed
the missing grant and reasoned it away
([`nodes.ts:912`](../../../packages/analytics/src/nodes.ts)); the reasoning was
wrong, and the comment is why the omission was read as cosmetic for a month.

---

## Affected spec pages

| Canonical page | Nature of change |
|---|---|
| [`changes/merged/2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) → Analytics pipeline → Resource nodes | Twelve nodes become fourteen; two rows added to the table and the ordering restated |
| [`changes/merged/2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) → Analytics pipeline → Region pinning | The sentence enumerating the pinned resources gains the two log groups and its count |
| [`changes/merged/2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) → Analytics plugin → Namespace and commands | "orphaning twelve resources" becomes fourteen |
| [`changes/merged/2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) → Analytics pipeline → Observability | **New block.** What each group holds, who writes to it, and the retention it carries |
| [`changes/merged/2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) → `blogwright-core` → `LogsClient` delivery configuration | `LogsClient` gains `ensureLogStream`, the second core operation this pipeline needs |

The repo has no canonical spec pages for resource nodes, AWS clients or the
CLI surface - the merged analytics change spec is the record, and its own
`Affected spec pages` table says so. This change therefore amends that merged
document in place, the mechanism it already used on itself when its
§Its own service clients block was corrected from four operations to five at
merge time. If canonical pages are created later, both documents fold into
them together.

---

## Proposed changes

### `merged/2026-07-26-analytics_plugin.md` → Analytics pipeline → Resource nodes (Modify)

> The plugin contributes fourteen nodes, reconciled by the same engine as the
> site's:
>
> | Node | Resource |
> |---|---|
> | `analytics-table-bucket` | S3 Tables bucket (`CreateTableBucket`) |
> | `analytics-namespace` | Table namespace (`CreateNamespace`) |
> | `analytics-table` | The `page_views` table (`CreateTable`) |
> | `analytics-catalog-integration` | The Glue `s3tablescatalog` federation Firehose reads the table through |
> | `analytics-salt-secret` | Secrets Manager secret holding the `visitor_key` salt |
> | `analytics-transform-log-group` | `/aws/lambda/<prefix>-analytics-transform`, the transform Lambda's own log group |
> | `analytics-transform-role` | Execution role for the transform Lambda, including `secretsmanager:GetSecretValue` on that secret alone |
> | `analytics-transform-function` | The record-transform Lambda |
> | `analytics-error-bucket` | S3 bucket in us-east-1 for Firehose's failed-record output |
> | `analytics-firehose-log-group` | `/aws/kinesisfirehose/<prefix>-analytics-firehose` and its `DestinationDelivery` stream, Firehose's delivery-error log |
> | `analytics-firehose-role` | Firehose delivery role (Glue, S3 Tables, Lambda invoke, error bucket, delivery logs) |
> | `analytics-firehose-stream` | The delivery stream with its Iceberg destination, created with `AppendOnly: true` |
> | `analytics-log-destination` | CloudWatch delivery destination pointing at the stream |
> | `analytics-log-delivery` | The delivery joining the site's source to that destination |
>
> `analytics-catalog-integration` is account-and-region scoped rather than
> per-environment. Its `read()` treats an existing integration as satisfied and
> its `delete()` is a no-op, so two environments never fight over it and
> tearing one down never breaks the other.
>
> The two log groups sit at the head of the chains that write to them:
> `transform-log-group → transform-function` and
> `firehose-log-group → firehose-stream`. Neither role declares an edge to a
> group, and that asymmetry is deliberate: a role's policy *derives* its log
> group ARN from the function or stream name rather than reading a recorded
> one, so there is no output to wait for. The two writers do declare one,
> because a group that does not exist when its writer first runs is a log line
> lost with nothing raised - and, on teardown, the reverse order the engine
> walks removes each writer before the group that holds its evidence.
>
> On this one point the plugin departs from the site graph rather than
> following it. The site's `iam-build-role` and `iam-exec-role` both declare
> `dependsOn: ['bucket', 'microvm-log-group']`
> ([`nodes.ts:157`](../../../packages/cli/src/nodes.ts) and
> [`:225`](../../../packages/cli/src/nodes.ts)) while deriving that group's ARN
> from a name in exactly the same way
> ([`nodes.ts:27-29`](../../../packages/cli/src/nodes.ts)). Those edges are
> harmless and stay; the plugin's two roles omit theirs because an edge that
> orders nothing states a dependency that does not exist.

### `merged/2026-07-26-analytics_plugin.md` → Analytics pipeline → Observability (Add)

> Two log groups are the plugin's, owned as nodes rather than left to implicit
> creation. Both are in `us-east-1` with the rest of the pipeline, both are
> created with the environment's tags, and both carry a **365-day** retention
> policy re-applied on every `update` - the `logGroupNode` contract the site's
> own groups have ([`nodes.ts:75`](../../../packages/cli/src/nodes.ts)).
>
> - **`/aws/lambda/<prefix>-analytics-transform`** holds the transform Lambda's
>   own output: the mapping decisions, the drop path, and the cold-start read
>   of the salt secret. Lambda writes into it under the execution role's
>   existing `logs:CreateLogStream` and `logs:PutLogEvents`, scoped to this
>   group and no other. The role is **not** granted `logs:CreateLogGroup`,
>   because it has nothing to create - the same shape the site's exec role has
>   ([`nodes.ts:214`](../../../packages/cli/src/nodes.ts)).
> - **`/aws/kinesisfirehose/<prefix>-analytics-firehose`** holds Firehose's
>   delivery errors, written to the log stream `DestinationDelivery`. Firehose
>   creates neither: enabling error logging through the API rather than the
>   console requires the group *and* the stream to exist in advance, so this
>   node creates both - and re-ensures the stream on every `update` alongside
>   the retention, which is the one place these two nodes depart from the
>   site's `logGroupNode`. A group created by a run that stopped between
>   `CreateLogGroup` and `CreateLogStream` is otherwise permanently one call
>   short, with `read()` reporting it present and `update()` doing nothing
>   about it. The delivery role's fifth statement grants
>   `logs:PutLogEvents` on that one stream's ARN. `BackupDelivery` is not
>   created, because the Iceberg destination configures no S3 backup.
>
> Owning the groups is what makes retention a property at all. A log group
> Lambda creates on its own is retained **forever**, and no reconcile ever
> notices. Reconciling retention on every apply also converts a group that
> already exists in that state - an environment provisioned before this
> change - without a teardown.
>
> These logs sit beside the pipeline's record-level failure signals rather than
> replacing them, and the distinction is load-bearing. A record the transform
> cannot map still goes to the Firehose error prefix and a failed batch still
> raises Firehose's error metric; both answer *which*, and only these two
> groups answer *why*.

### `merged/2026-07-26-analytics_plugin.md` → Analytics pipeline → Region pinning (Modify)

> **Every one of the plugin's fourteen nodes is therefore created in
> `us-east-1` regardless of `config.region`** - the stream, its transform
> Lambda, its two IAM roles, its two CloudWatch log groups, the S3 Tables
> bucket with its namespace and table, the Glue catalog integration, the
> Firehose error bucket, the `visitor_key` salt secret, and the log destination
> and delivery.

The closing paragraph on core's two pre-built clients keeps its argument, but
the sentence naming `ctx.clients.logsUsEast1` no longer describes what that
client serves - two of its four consumers are not delivery nodes. It becomes:

> `ctx.clients.logsUsEast1` serves the delivery nodes and the plugin's two log
> groups - four consumers where there were two - and is pinned to us-east-1 in
> core for the same CloudFront quirk this pipeline inherits
> ([`clients.ts:38-43`](../../../packages/core/src/clients.ts)).

No new client is constructed for the two groups, and the region pin needs no
new enforcement point, so the sentence that follows this one in that paragraph
is unchanged.

### `merged/2026-07-26-analytics_plugin.md` → Analytics plugin → Namespace and commands (Modify)

> The refusal is what keeps a site teardown from emptying the bucket the
> plugin's own record lives in and orphaning fourteen resources.

### `merged/2026-07-26-analytics_plugin.md` → `blogwright-core` → `LogsClient` delivery configuration (Modify)

> `LogsClient` also exposes `ensureLogStream(logGroupName, logStreamName)`,
> which swallows an already-exists response exactly as `ensureLogGroup` does
> ([`logs.ts:61`](../../../packages/core/src/aws/logs.ts)). It is core's rather
> than the plugin's for the reason `LogsClient` itself is: the site graph owns
> this client, and a second CloudWatch Logs client in the plugin would
> duplicate one `ctx.clients.logsUsEast1` already provides.

---

## Type changes

None, and the absence is the scope boundary. The merged spec's schema fragment
holds `AnalyticsConfig` and `PageView`; this change touches neither. Retention
is a plugin-owned constant, not a config key - see the open question below,
which is where making it one belongs.

`IcebergDestinationInput` ([`firehose.ts:94`](../../../packages/analytics/src/aws/firehose.ts))
gains two required fields, `logGroupName` and `logStreamName`. It is a
TypeScript interface internal to the plugin's Firehose client, not a canonical
entity, so it carries no schema fragment.

---

## Implementation notes

Line numbers are against `main` at `3d47969`. **The working tree currently
carries PR #27's diff uncommitted**: in `packages/analytics/src/nodes.ts` it is
a comment rewrite at `:911` that removes nine lines and adds nineteen, plus a
one-for-one edit to the policy line at `:1031`. The net shift is therefore
**ten** lines, not nineteen - every pointer below `:921` in this document sits
ten lines lower in the working tree than it does on `main`. Reset those paths
or land the supersession first (see the Merge plan) so these resolve.

```
1. packages/core/src/aws/logs.ts:61 - add ensureLogStream(group, stream)
   directly beneath ensureLogGroup, same shape: POST CreateLogStream, return
   on AwsError.isAlreadyExists, rethrow otherwise. Nothing else in core calls
   it; the plugin is its only consumer, which is why it sits beside the four
   operations the plugin already uses rather than in a new module.

2. packages/analytics/src/nodes.ts - two constants beside ERROR_OUTPUT_PREFIX
   (:1685):
     LOG_RETENTION_DAYS = 365
     DESTINATION_DELIVERY_STREAM = 'DestinationDelivery'
     FIREHOSE_LOG_GROUP_PREFIX = '/aws/kinesisfirehose/'
   LAMBDA_LOG_GROUP_PREFIX (:768) already exists and is what
   transformLogGroupArn derives from; the new node must reuse it, not a second
   copy, so the grant and the group can never name different strings.

3. packages/analytics/src/nodes.ts - the two node factories. Model them on
   packages/cli/src/nodes.ts:75 (logGroupNode) - read() is logGroupExists,
   create() is ensureLogGroup(name, ctx.tags) then putRetentionPolicy,
   update() is putRetentionPolicy alone, delete() is deleteLogGroup. Both use
   logs(ctx) (:2541), which is ctx.clients.logsUsEast1. Two deltas from that
   model:
     - the ARN is built with ANALYTICS_REGION (:218), never ctx.config.region;
     - analyticsFirehoseLogGroupNode's create() AND update() both call
       ensureLogStream(group, DESTINATION_DELIVERY_STREAM) after the retention
       call, so a group created before its stream converges on the next apply.
       This is the applyBucketConfiguration reconcile-on-every-apply pattern
       (packages/cli/src/nodes.ts), not the site logGroupNode's narrower update.

4. packages/analytics/src/nodes.ts:901-921 - rewrite transformLogGroupArn's
   comment. Line 912's "**No node creates this group.** Lambda creates it
   implicitly on the function's first invocation" is FALSE and production
   disproved it; it becomes a statement that analytics-transform-log-group owns
   the group and that the role is deliberately not granted logs:CreateLogGroup
   because of it. The function body (:922) does not change - the ARN it derives
   is already correct, and is now also the group the node creates.

5. packages/analytics/src/nodes.ts:1032 - applyTransformRolePolicy's logs
   statement stays exactly as it is: ['logs:CreateLogStream',
   'logs:PutLogEvents']. This is the whole point of the design and the reason
   it supersedes PR #27. Only the doc comment above applyTransformRolePolicy
   (:1026) needs its "Two statements" prose extended to say why the third
   action is absent.

6. packages/analytics/src/nodes.ts:1514 - analytics-transform-function's
   dependsOn gains TRANSFORM_LOG_GROUP_NODE.
   :2297 - analytics-firehose-stream's dependsOn gains FIREHOSE_LOG_GROUP_NODE.
   Neither role's dependsOn changes. topoSort drains zero-indegree nodes
   alphabetically (packages/cli/src/graph.ts:46-49, and again at :59 as the
   queue refills), so both groups would happen to drain early anyway - which is
   precisely why the edges are declared rather than left to that.

7. packages/analytics/src/nodes.ts:1902 - applyFirehoseRolePolicy gains a fifth
   statement: logs:PutLogEvents on
   arn:aws:logs:<ANALYTICS_REGION>:<account>:log-group:/aws/kinesisfirehose/
   <stream>:log-stream:DestinationDelivery - a concrete ARN, no wildcard, the
   discipline the other four keep. The doc comment at :1898 currently says
   "There is no fifth statement" and names CloudWatch Logs as one of three
   grants this pipeline does not need; correct that sentence - Kinesis and KMS
   are still true, CloudWatch Logs is not.

8. packages/analytics/src/aws/firehose.ts:94 - IcebergDestinationInput gains
   readonly logGroupName and logStreamName, both required (the plugin builds
   exactly one shape of destination and always enables logging, so an optional
   field would model a call site that does not exist).
   :304 - buildIcebergDestination emits
   CloudWatchLoggingOptions: { Enabled: true, LogGroupName, LogStreamName }.
   Both createDeliveryStream (:381) and updateDestination (:471) go through this
   builder, so an existing stream is reconfigured in place: UpdateDestination
   keeps the stream's ARN, so the CloudFront log delivery pointed at it is
   untouched.
   packages/analytics/src/nodes.ts:1972 - firehoseDestination supplies the two
   new fields.

9. **The stream node's `update()` currently short-circuits, and this change is
   dead on every already-provisioned environment without fixing it.**
   nodes.ts:2336 returns with zero AWS calls when the recorded appendOnly
   already equals STREAM_APPEND_ONLY - which it does on every stream this
   plugin created - so a new CloudWatchLoggingOptions would only ever reach a
   stream created from scratch. Production's staging-iamstan stream is exactly
   that case. Three edits, and they belong together:
     - firehose.ts:226 DestinationDescriptionResponse's
       IcebergDestinationDescription gains CloudWatchLoggingOptions?: { Enabled?:
       boolean }, and DeliveryStreamStatus (:174) gains
       readonly loggingEnabled?: boolean | undefined beside appendOnly, read back
       off the live destination for the same reason appendOnly is - it is what
       the node compares to decide whether to reconcile.
     - nodes.ts:2032 recordStream records it, through the same recordOptional
       that clears a stale entry when the describe stops reporting one.
     - nodes.ts:2336 the early return becomes two conditions: return only when
       appendOnly === STREAM_APPEND_ONLY AND loggingEnabled === true. undefined
       does not match either, which is already this node's stated rule.
   The AppendOnly fallback (replace the stream when the update is refused) sits
   below this guard and is unchanged. It should not fire for a logging-only
   delta - IcebergDestinationUpdate documents CloudWatchLoggingOptions among the
   fields it accepts - but if it ever did, the cost is a replaced stream and a
   repointed delivery for a log setting. Cover the logging-only update path with
   a test that asserts UpdateDestination ran and the fallback did not.

10. packages/analytics/src/nodes.ts:3048 - buildAnalyticsNodes returns fourteen,
   each group at the head of its chain:
     table-bucket, namespace, table, catalog-integration
     salt-secret, transform-log-group, transform-role, transform-function
     error-bucket, firehose-log-group, firehose-role, firehose-stream
     log-destination, log-delivery

11. Tests and prose that count the set:
     packages/analytics/src/commands.test.ts:283 ANALYTICS_NODE_IDS and :344
       toHaveLength(12) - the assertion that will fail first, and should.
       ANALYTICS_EDGES gains the two new edges.
     packages/analytics/src/nodes.test.ts - the transform role's policy is
       asserted whole with toStrictEqual, so it stays green under this change
       (it does not under PR #27's). Add coverage for the two groups' retention
       and for the Firehose destination's CloudWatchLoggingOptions.
     packages/analytics/README.md:10 - "the twelve resource nodes".
     packages/analytics/src/commands.ts:222 - a comment saying "all twelve
       nodes".
     packages/cli/src/plugin-commands.test.ts uses a "twelve-node stand-in for
       the analytics plugin". It is a stand-in, not the plugin, so its count
       need not follow - but its prose should stop claiming to mirror the real
       set if it does not.
```

The one risk worth naming: `ensureLogStream` is a new core operation added for
a plugin, and `pnpm knip` reports core exports nothing in core or the CLI
consumes as dead. It is a method on an existing exported class rather than a
new export, so knip does not see it - confirm that before assuming it.

---

## Merge plan

1. **Close PR #27 first, unmerged** ([antstanley/blogwright#27](https://github.com/antstanley/blogwright/pull/27),
   branch `fix/analytics-observability`). Its `logs:CreateLogGroup` grant is
   unnecessary under this design and, once landed, would leave the transform
   role permanently able to create a group that a node already owns. Its
   correction to `transformLogGroupArn`'s comment and its addition to the
   plan's open questions are both worth keeping - carry the prose across rather
   than the grant. Reset **that PR's three paths only** -
   `packages/analytics/src/nodes.ts`, `packages/analytics/src/nodes.test.ts`
   and `.changeset/transform-log-group-grant.md` - not the working tree, which
   also carries this spec's own `.specs/README.md` registration and the lessons
   block appended to
   [`plans/2026-07-26-plugin_system_and_analytics/plan.md`](../../plans/2026-07-26-plugin_system_and_analytics/plan.md).
   Both of those are kept. The lessons block needs one correction as it is
   carried across: it says enabling Firehose's logging "means a thirteenth
   node", which was written when the fix was one node. This change adds two and
   takes the set to fourteen, so reword that sentence when this lands.
2. Apply the `Proposed changes` blocks to
   [`merged/2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md),
   including the new §Observability block, and bump nothing else in that file's
   header - it is already `Merged`, and this change's own record is what dates
   the amendment. The relative links inside those blocks are written to resolve
   from `.specs/changes/`; each gains one `../` as it lands in
   `.specs/changes/merged/`.
3. Refresh the stale `file:line` citations in that document's **prose** while
   it is open. Each mapping below was verified by symbol against
   `main@3d47969`:
   - `logs.ts:131` → `:172` (the `.find()` in `findDeliveryIdBySource`, `:165`)
   - `logs.ts:164-171` → `:211-218` (`deleteDeliverySource`)
   - `logs.ts:139` → `:180` (`deliveriesForSource`, cited twice: §Two guards on
     the site's node, and the Assumptions block)
   - `logs.ts:114` → `:146` (`createDelivery`)
   - `logs.ts:71` → `:95` (`filterEvents`)
   - `clients.ts:68` → `:80` (`secrets`, built over the primary-region signer)
   - `clients.ts:28-33` → `:38-43` (`logsUsEast1` and the CloudFront quirk that
     pins it; `:28-33` now lands on `signingUsEast1`'s comment)
   - `endpoint.ts:36,43,65-66` → `:53,80,102-103` (`GLOBAL_SERVICES`, the
     `signingRegion` ternary, `canonicalHost`'s `iam.amazonaws.com`)
   - `cli/src/nodes.ts:713` → `:766` (`logDeliveryNode`, cited twice: §Motivation
     and §CloudFront log delivery → Two guards on the site's node)
   - `cli/src/nodes.ts:758` → `:817` (the `ConflictException` retry's
     `deleteDeliverySource` call, which is the one that sentence names;
     `delete()`'s own call to it is at `:831` and is not what is cited)
   - `cli/src/nodes.ts:753-757` → `:813-816` (the retry's delivery-deletion loop,
     which now reaches `deliveriesForSource` through `ownDeliveryIdsOrRefuse`
     at `:745` rather than calling it directly)
   - `cli/src/nodes.ts:732` → `:785` (the `createDelivery` call inside `wire`)
   - `core/src/config.ts:352` → `:383` (the `<env>-<siteName>` prefix inside
     `deriveNames`, which opens at `:379`)

   One prose citation is **not** refreshed and is exempt for the same reason the
   §Implementation notes are: `nodes.ts:751-761` at that document's `:130`
   annotates the sentence "Today it iterates `deliveriesForSource` and deletes
   every delivery", and no such loop exists on `main@3d47969` - the guard this
   very block proposed shipped, and the retry now filters through
   `ownDeliveryIdsOrRefuse`. There is nothing to renumber the pointer *to*, and
   pointing it at the guarded loop would make a sentence about superseded
   behaviour cite the code that superseded it. Leave the pointer and record the
   exemption; the count of refreshed citations is therefore thirteen mappings,
   not fourteen.

   That document's own §Implementation notes are **not** refreshed: they are a
   pre-implementation record whose pointers are against the tree as it was, and
   several say so outright ("the us-east-1 `SigningClient` is a local const at
   :54 today"). Renumbering them to the shipped tree would make a historical
   instruction describe a state it was written to change. This step refreshes
   pointers, not the prose they support - which is why the mappings above stand
   even where the sentence around them describes the pre-guard tree, and why
   `:130`, whose *referent* is gone rather than merely moved, is the one
   exception.
4. No schema fold: this change has no `Type changes`.
5. No `DEVELOPMENT.md` edit: no new port, no new toolchain entry, no change to
   the package split.
6. Flip this file's **Status:** to `Merged`, add **Merged:** date, move it to
   `.specs/changes/merged/`.
7. Update `.specs/README.md`: remove this file from the pending list and add it
   to the merged list beneath the analytics entry it amends.

**Execution record (2026-09-01).** Step 1 landed at task 01 of
[Analytics-owned log groups](../../plans/2026-08-31-analytics_owned_log_groups/plan.md);
steps 2, 3, 6 and 7 landed at task 05. Steps 4 and 5 are recorded as **not
applicable** rather than passed over, because a step nobody executed is
indistinguishable from a step nobody needed once the header reads `Merged`:

- **Step 4 - no schema fold. Not applicable.** This change has no `Type changes`
  entry carrying a schema fragment. `IcebergDestinationInput` is a TypeScript
  interface internal to the plugin's Firehose client rather than a canonical
  entity, so it has no `$def` to fold and the merged analytics spec's own
  fragment (`AnalyticsConfig`, `PageView`) is untouched. Owner: Ant Stanley.
- **Step 5 - no `DEVELOPMENT.md` edit. Not applicable.** No new port, no new
  toolchain entry, and no change to the package split: the two nodes and
  `ensureLogStream` land inside packages that page already counts.
  Owner: Ant Stanley.

One correction to step 3's mappings, recorded rather than rewritten: they were
resolved against `main@3d47969`, before this change's own `ensureLogStream`
inserted fourteen lines into `packages/core/src/aws/logs.ts`. All five `logs.ts`
targets therefore landed fourteen lines lower than listed - `:186`, `:225-232`,
`:194`, `:160` and `:109` - each re-resolved by symbol against the shipped tree
before it was written. The eight targets in the other four files were unaffected
and stand as listed.

---

## Assumptions and open questions

**Assumptions**

- Firehose creates neither the log group nor the log stream when error logging
  is enabled through the API. AWS states it directly: *"You can enable Amazon
  Data Firehose error logging through the AWS CLI, the API, or CloudFormation
  using the `CloudWatchLoggingOptions` configuration. To do so, create a log
  group and a log stream in advance … Also ensure that the associated IAM
  policy has `"logs:putLogEvents"` permission."* The console path creates both
  on the operator's behalf; this pipeline has no console path. Verified
  2026-08-31 against `firehose/latest/dev/monitoring-with-cloudwatch-logs.html`.
- `logs:PutLogEvents` alone is what the delivery role needs. That is the only
  action AWS's own text names, and it is consistent with the node creating the
  stream: a principal that never creates one needs no `logs:CreateLogStream`.
- Lambda **does** create its own log stream, given `logs:CreateLogStream` on
  the group - which the transform role already grants. Only the group was ever
  missing, which is what the production evidence shows: the role held
  `CreateLogStream` and `PutLogEvents` and no group appeared at all.
- `365` is an accepted `retentionInDays` value. CloudWatch Logs takes a fixed
  set and 365 is in it; `putRetentionPolicy`
  ([`logs.ts:73`](../../../packages/core/src/aws/logs.ts)) passes the number
  through unvalidated, so an unaccepted value would fail at the API.
- Deleting a log group deletes the log streams inside it, so
  `analytics-firehose-log-group`'s `delete()` needs no separate stream
  teardown.

**Decisions**

- *Two nodes, not one shared group.* **Each writer gets its own group.** They
  have different names AWS's own conventions fix
  (`/aws/lambda/<function>` and `/aws/kinesisfirehose/<stream>`), different
  writers, and different teardown positions in the graph. Collapsing them would
  mean overriding one convention to satisfy the other and would put two
  principals' `PutLogEvents` grants on one resource.
- *365 days, as a plugin-owned constant.* **Matching core's
  `retention.microvmDays` default ([`config.ts:148`](../../../packages/core/src/config.ts))
  by value, not by reading it.** Core's other default is `cloudfrontDays: 90`
  ([`config.ts:149`](../../../packages/core/src/config.ts)); a year was asked for,
  so 365 is the number. It is not read from `ctx.config.retention` because that
  block's two keys each name one of the site's two log groups - a third and
  fourth consumer would make one of them silently govern resources it was never
  named for, and changing the builder's retention would move the analytics
  pipeline's with it.
- *Own the group rather than grant `logs:CreateLogGroup`.* **The role keeps the
  two actions it has.** A node that owns the group gets a lifecycle, a
  retention policy and a teardown; a grant gets a group that appears at some
  unpredictable first invocation, retained forever, that nothing reconciles and
  nothing removes. This is what supersedes PR #27, and it is why that PR's diff
  becomes unnecessary rather than merely redundant.
- *The two writers declare edges to their groups; the two roles do not.*
  **An edge is declared where an ordering is needed, not where an ARN is
  spelled.** A role derives its log group ARN from a name it already knows
  ([`nodes.ts:922`](../../../packages/analytics/src/nodes.ts)), so it has nothing
  to wait for; a writer that runs before its group exists loses output with
  nothing raised. Declaring both would be noise, declaring neither would rest
  on `topoSort`'s alphabetical drain
  ([`graph.ts:46-49`](../../../packages/cli/src/graph.ts)) - which happens to
  produce the right order today and is not a fact any of these nodes states.
  **This is a deliberate departure from the site graph, not an application of
  it.** The site's two roles *do* declare the edge -
  `dependsOn: ['bucket', 'microvm-log-group']` on both `iam-build-role`
  ([`nodes.ts:157`](../../../packages/cli/src/nodes.ts)) and `iam-exec-role`
  ([`nodes.ts:225`](../../../packages/cli/src/nodes.ts)) - even though
  `logGroupArn` ([`nodes.ts:27-29`](../../../packages/cli/src/nodes.ts)) derives
  that ARN from `ctx.names.microvmLogGroup` and leaves them nothing to wait for
  either. The rule above is the one this change follows; tightening the site's
  edges to match is a site-graph change and is not proposed here.
- *`ensureLogStream` lands in core, not in a plugin-local Logs client.* **The
  plugin has no CloudWatch Logs client of its own and should not gain one.**
  §Its own service clients settles the general rule - `LogsClient` stays in
  core because the site graph owns it - and `ctx.clients.logsUsEast1` is
  already the instance every delivery node in this plugin uses.
- *The stream node reconciles on logging as well as `AppendOnly`.* **Two
  conditions in the early return, not one.** A guard that names one field of a
  destination silently stops reconciling every other field that destination
  grows, and this change is the first to grow one. Comparing the live value
  read back off the stream - rather than assuming a stream this plugin created
  has the configuration this plugin sends - is the rule `appendOnly` already
  follows ([`firehose.ts:198-204`](../../../packages/analytics/src/aws/firehose.ts));
  the new field follows it for the same reason.
- *The Firehose group's `update()` re-ensures the stream.* **Reconcile on every
  apply, the bucket node's pattern rather than the site log group's.** A group
  created by a run that crashed between `CreateLogGroup` and `CreateLogStream`
  is otherwise permanently one call short, with `read()` reporting it present
  and `update()` doing nothing about it.

**Open questions**

- **Should the stream node's guard compare the whole live destination rather
  than a growing list of fields?** Carried from the plan's own open questions
  ([`plan.md`](../../plans/2026-08-31-analytics_owned_log_groups/plan.md)).
  The guard this change widens is a field allowlist, and the next field the
  destination grows pays the same cost again - silently, because the symptom is
  a reconcile that does nothing rather than one that fails. Comparing the built
  destination against the described one would end the class, but it also needs a
  normalisation layer, since `DescribeDeliveryStream` does not echo an
  `IcebergDestinationConfiguration` back field for field. Out of scope here and
  worth its own change spec. Owner: Ant Stanley.
- **Should retention be configurable?** Deliberately out of scope here. Adding
  a `retentionDays` key to `AnalyticsConfig` would change a shape the merged
  analytics spec documents in its `Type changes` fragment, which makes it a
  change spec of its own rather than a field appended to this one - and the
  question it really asks (should the plugin's two groups share one knob with
  the site's two, or hold a third?) is the same question this change answers
  with a constant. Owner: Ant Stanley.
- Should the site's `iam-build-role` lose its own `logs:CreateLogGroup`? It
  grants it on `microvm-log-group`
  ([`nodes.ts:147`](../../../packages/cli/src/nodes.ts)) even though that group is
  a node the site owns and the role declares an edge to it - the same
  redundancy this change removes the need for on the analytics side - while
  `iam-exec-role` on the same group does not
  ([`nodes.ts:214`](../../../packages/cli/src/nodes.ts)). The two disagree, and
  the exec role is the one this change follows. Tightening the build role is a
  site-graph change and is outside this one's scope. Owner: Ant Stanley.
- Should `analytics status` report the two groups' presence, or is the generic
  node walk it already does enough? The nodes appear in it for free; whether a
  missing log group deserves more prominence than a missing bucket is a
  judgement this change does not make. Owner: Ant Stanley.
