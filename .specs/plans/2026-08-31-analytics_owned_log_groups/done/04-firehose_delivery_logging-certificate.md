# Done Certificate - Task 04: Firehose writes its delivery errors, on streams that already exist

**Task:** [04-firehose_delivery_logging.md](04-firehose_delivery_logging.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 04. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 04) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a recorded request, a test result, or an execution trace) - not by
assertion. **O3 is the load-bearing obligation of this task and of this plan**: it is the one that
decides whether the change reaches an environment that already exists.

## Premises

- **P1 - Goal.** The delivery stream's Iceberg destination carries
  `CloudWatchLoggingOptions: { Enabled: true, LogGroupName, LogStreamName }` on both the create and
  the `UpdateDestination` path, the delivery role grants `logs:PutLogEvents` on the
  `DestinationDelivery` stream's concrete ARN, and the stream node's `update()` no longer returns
  with zero AWS calls on a stream whose recorded `appendOnly` already matches but whose logging is off.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item,
  in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break: the `AppendOnly` reconcile's two existing branches - the
  in-place `UpdateDestination` attempt and the delete-and-recreate fallback below it
  (`packages/analytics/src/nodes.ts:2337-2400`), including the role-propagation retry and the
  re-read that deliberately sits **outside** the `try`; the stream's ARN, on which task 53's
  CloudFront log delivery depends and which `UpdateDestination` preserves and a replacement does
  not; the four existing statements of the delivery role's inline policy, each on a concrete ARN;
  and `describeDeliveryStream`'s absent-stream contract (`undefined`, not a throw).

## Obligations

- **O1 - The destination carries `CloudWatchLoggingOptions` on both paths.**
  - *Claim:* `CloudWatchLoggingOptions: { Enabled: true, LogGroupName, LogStreamName }` appears in
    the recorded request body for `CreateDeliveryStream` **and** for `UpdateDestination`;
    `IcebergDestinationInput`'s two new fields are required; and the group and stream names come
    from the same helpers task 03's node and this task's role statement use.
  - *Evidence to collect:* run `pnpm --filter blogwright-analytics exec vitest run nodes
    --reporter=verbose`; read the create case's recorded body and the update case's recorded body
    and confirm both carry the block. Read
    `packages/analytics/src/aws/firehose.ts:94` and confirm `logGroupName` and `logStreamName` are
    `readonly` and **not** optional. Read the test that finds one group-name string in both the
    recorded destination body and the recorded policy document.
  - *Checks:* resolve `buildIcebergDestination` (`packages/analytics/src/aws/firehose.ts:304`) and
    confirm both `createDeliveryStream` (`:381`) and `updateDestination` (`:471`) go through it -
    the whole reason one assertion on the builder covers two paths. Independently verify the three
    key spellings (`CloudWatchLoggingOptions`, `LogGroupName`, `LogStreamName`) and that
    `IcebergDestinationUpdate` accepts the block, against the AWS reference rather than against the
    implementation: these tests assert the body the implementation itself constructs and cannot
    catch a wrong key.
  - *Status:* **SATISFIED**
  - *Discharged:* `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose`
    -> 190/190 pass. Create body: `analytics-firehose-stream > creates the stream with the Iceberg
    destination and the transform processor` asserts `CloudWatchLoggingOptions: { Enabled: true,
    LogGroupName: FIREHOSE_LOG_GROUP, LogStreamName: DESTINATION_DELIVERY }` on the recorded
    request body. Update body: `reconciles an already-deployed append-only stream into error
    logging, in place` asserts the same block under `IcebergDestinationUpdate`, also on the
    recorded body. `IcebergDestinationInput` carries `readonly logGroupName: string` and
    `readonly logStreamName: string`, neither optional. The one-string case is `each log group
    name has exactly one home > writes delivery errors to the very stream it creates and the very
    stream it grants on`.
  - *Checks run:* `buildIcebergDestination` resolves to `packages/analytics/src/aws/firehose.ts`
    module level (one definition), called at `:433` as `IcebergDestinationConfiguration` and at
    `:527` as `IcebergDestinationUpdate` - one builder, both paths, so one assertion on the
    builder does cover two paths. The three key spellings were verified against the AWS reference
    (`docs.aws.amazon.com/firehose/latest/APIReference`), not against the implementation:
    `IcebergDestinationUpdate` lists `CloudWatchLoggingOptions` (Required: No),
    `IcebergDestinationConfiguration` lists it, `IcebergDestinationDescription` lists it, and
    `CloudWatchLoggingOptions` has exactly `Enabled`, `LogGroupName` (pattern
    `[\.\-_/#A-Za-z0-9]*`) and `LogStreamName` (pattern `[^:*]*`). Both values this plugin sends
    satisfy those patterns. Mutation (drop `LogGroupName` from the builder) reddened four cases
    across both paths and both files - nodes `creates the stream...` and `reconciles an
    already-deployed...`, firehose `pins CreateDeliveryStream...` and `pins UpdateDestination...`.
    Restored; `shasum -a 256` matched the pre-mutation digest.

- **O2 - The delivery role has a fifth statement on one concrete stream ARN.**
  - *Claim:* `applyFirehoseRolePolicy` emits five statements, the fifth granting `logs:PutLogEvents`
    on `arn:aws:logs:us-east-1:<account>:log-group:/aws/kinesisfirehose/<stream>:log-stream:DestinationDelivery`,
    with no wildcard; the doc comment no longer claims there is no fifth statement or that
    CloudWatch Logs is a grant this pipeline does not need.
  - *Evidence to collect:* read the `analytics-firehose-role` policy case; confirm it parses the
    document and checks **capability by capability** rather than counting to five, and that its
    "no `*` resource" assertion still covers the new statement. Read the corrected doc comment at
    `packages/analytics/src/nodes.ts:1898` and quote it.
  - *Checks:* confirm the ARN ends `:log-stream:DestinationDelivery` with no trailing `:*` - a
    log-stream ARN takes no wildcard suffix, unlike the log-group ARN
    `transformLogGroupArn` builds. Confirm `ANALYTICS_REGION` and not `ctx.config.region` supplies
    the region, and that the role's `dependsOn` did **not** change: the grant derives the ARN from
    a name, so there is nothing to wait for.
  - *Status:* **SATISFIED**
  - *Discharged:* `analytics-firehose-role > grants exactly five capabilities, each on concrete
    ARNs and none on a wildcard` parses the document and asserts capability by capability:
    `capability(statements, 'logs')` `toStrictEqual` `{ Effect: 'Allow', Action:
    ['logs:PutLogEvents'], Resource: FIREHOSE_LOG_STREAM_ARN }`, with `FIREHOSE_LOG_STREAM_ARN`
    spelled out in the test file rather than imported from the module under test. The `for (const
    resource of policyResources(statements))` wildcard sweep runs over all five statements, so it
    covers the new one. The corrected doc now reads, in part: "the CloudWatch Logs statement names
    the **one log stream** Firehose writes its delivery errors to,
    `<firehose log group>:log-stream:DestinationDelivery`, and not the group's `:*` form" and
    "That fifth statement is the only one of the three AWS's own policy adds that this pipeline
    needs. The other two stay out: Kinesis (this stream is `DirectPut`) and KMS". The "There is no
    fifth statement" sentence is gone and CloudWatch Logs is no longer listed among grants this
    pipeline does not need.
  - *Checks run:* the ARN ends `:log-stream:DestinationDelivery`; two explicit guards back this up
    (`not.toMatch(/:\*$/)` and `not.toBe(FIREHOSE_LOG_GROUP_ARN)`). `firehoseLogStreamArn`
    interpolates `ANALYTICS_REGION` (module constant `'us-east-1'`), not `ctx.config.region`. The
    role node's `dependsOn` is untouched - the only diff hunk in that node is its doc comment.
    Two mutations, both reproduced: deleting the fifth statement reddened the count assertion
    (`to have a length of 5 but got 4`) and the one-string case; widening the `Resource` to the
    group's `:*` ARN left the count green and reddened the capability `toStrictEqual` plus the
    one-string case. The count and capability assertions are therefore each independently
    load-bearing rather than one dominating the other. Restored, checksums matched.

- **O3 - An already-deployed stream reconciles into logging. (Load-bearing.)**
  - *Claim:* `DeliveryStreamStatus.loggingEnabled` is read back off
    `IcebergDestinationDescription.CloudWatchLoggingOptions.Enabled` by `describeDeliveryStream`,
    recorded by `recordStream` through `recordOptional`, and the early return at
    `packages/analytics/src/nodes.ts:2336` requires **both** `appendOnly === STREAM_APPEND_ONLY`
    **and** `loggingEnabled === true`. A context recording `{ appendOnly: true }` with no logging
    issues `UpdateDestination`; a context recording `{ appendOnly: true, loggingEnabled: true }`
    issues nothing at all.
  - *Evidence to collect:* read the guard and quote it. Read **both** cases in the
    `analytics-firehose-stream` describe and confirm their fixtures are exactly those two recorded
    states - built through `withRecordedStream` (`packages/analytics/src/nodes.test.ts:2529`) with
    those overrides - and that the reconciling case's recorded requests are exactly
    `['Firehose_20150804.UpdateDestination', 'Firehose_20150804.DescribeDeliveryStream']`: the
    update plus the mandatory post-update re-read, with no delete/create pair. **Two requests, not
    one.** The re-read sits deliberately outside the update's `try` and runs whenever the update
    did not throw (`nodes.ts:2376-2390`), which is the trace O4 below walks; the existing in-place
    case at `nodes.test.ts:3155-3158` already asserts exactly that pair on `main@3d47969`. A
    validator expecting a single request would fail this obligation on correct code. Read
    `describeDeliveryStream`
    (`packages/analytics/src/aws/firehose.ts:406-432`) and confirm the new field is parsed off the
    live destination and conditionally spread, exactly as `appendOnly` is. Read `recordStream`
    (`nodes.ts:2032`) and confirm it uses `recordOptional`, which clears a stale entry when the
    describe stops reporting one.
  - *Checks:* **This obligation is not discharged by a test against a newly created stream.** A
    stream created after this change comes back with `loggingEnabled: true` and takes the early
    return, which exercises the guard's other branch. The proof this task exists for is the
    recorded-state case - production's `staging-iamstan` stream is `appendOnly: true` with no
    recorded logging, and before this change that state took a zero-call return. Confirm the
    reconciling case's fixture is a **recorded state**, not a describe response.
    Then run the mandatory mutation: restore
    `if (appendOnly === STREAM_APPEND_ONLY) return;`, run
    `pnpm --filter blogwright-analytics exec vitest run nodes`, record which case goes red and its
    output, restore, and confirm `git diff` is clean for that path. If that mutation leaves the
    suite green, this obligation is UNSATISFIED whatever the code says.
  - *Status:* **SATISFIED**
  - *Discharged:* the guard now reads, verbatim:
    `if (appendOnly === STREAM_APPEND_ONLY && loggingEnabled === true) return;`
    Both cases are built on **recorded state** through `withRecordedStream`, not on a describe
    response: `reconciles an already-deployed append-only stream into error logging, in place`
    uses `withRecordedStream(withStreamDependencies(ctx), { appendOnly: true })` and guards its own
    non-vacuity with
    `expect(Object.keys(recorded.state.resources['analytics-firehose-stream'] ?? {})).not.toContain('loggingEnabled')`;
    `performs no AWS call at all once both live flags already match` uses
    `{ appendOnly: true, loggingEnabled: true }` and asserts `expect(requests).toStrictEqual([])`.
    A third case, `reconciles a stream whose recorded logging flag is explicitly false`, pins
    `{ appendOnly: true, loggingEnabled: false }`, so a guard written `loggingEnabled !== undefined`
    would not survive. The reconciling case asserts `targets(requests)` `toStrictEqual`
    `['Firehose_20150804.UpdateDestination', 'Firehose_20150804.DescribeDeliveryStream']` - two
    requests, the update plus the mandatory post-update re-read, with no delete/create pair.
    `describeDeliveryStream` parses `destination?.IcebergDestinationDescription?.CloudWatchLoggingOptions?.Enabled`
    off the live destination and spreads it `...(loggingEnabled !== undefined ? { loggingEnabled } : {})`,
    exactly as `appendOnly` is. `recordStream` records it through `recordOptional`.
  - *Checks run:* **the mandatory guard mutation was reproduced.** Restoring
    `if (appendOnly === STREAM_APPEND_ONLY) return;` - instrumented with a `process.stdout.write`
    immediately above it, so a line that ran is distinguished from a file that changed - produced:

    ```
    [MUT1] guard ran: appendOnly=true loggingEnabled=undefined
    [MUT1] guard ran: appendOnly=true loggingEnabled=false
    [MUT1] guard ran: appendOnly=true loggingEnabled=true
     x analytics-firehose-stream > reconciles an already-deployed append-only stream into error logging, in place
     x analytics-firehose-stream > reconciles a stream whose recorded logging flag is explicitly false
    AssertionError: expected [] to strictly equal [ ...(2) ]
      Tests  2 failed | 188 passed (190)
    ```

    The first instrumentation line is the load-bearing one: `appendOnly=true
    loggingEnabled=undefined` is production's `staging-iamstan`, and under the one-condition guard
    it produced an empty request list - zero AWS calls - which is the defect this task exists to
    remove. Restored; `shasum -a 256 packages/analytics/src/nodes.ts` returned the pre-mutation
    digest `205df0b8...66de0` and `jj diff --stat` returned to 516 insertions / 52 deletions.
    **Deviation on the evidence instruction:** the certificate names `git diff` for the restore
    proof, but this isolated jj workspace has no `.git`, so `git` cannot run in it. Byte-exact
    restore was proven instead by a `shasum -a 256` digest taken before each mutation and
    re-checked after, plus `jj diff --stat` against the workspace parent. This is a stronger
    proof than `git diff`, not a weaker one, and is recorded here rather than failing the
    obligation over a tool that does not exist in the workspace.

- **O4 - The logging-only reconcile takes the in-place path, not the replacement.**
  - *Claim:* the logging-only case asserts `UpdateDestination` was issued, that no
    `DeleteDeliveryStream` or `CreateDeliveryStream` followed it, and that no "UpdateDestination
    was refused" warning was logged; the `AppendOnly` fallback's own cases still pass.
  - *Evidence to collect:* read the case and confirm it asserts on the **recorded request targets**
    (absence of the delete/create pair), not only on the presence of the update; confirm it asserts
    on the collected warnings. Run the suite and confirm the three pre-existing fallback cases
    (`falls back to replacing the stream when UpdateDestination is refused`, the role-propagation
    retry, and the missing-version-id case) are green.
  - *Checks:* trace the update path for the logging-only input:
    `recorded { appendOnly: true, versionId: '3', destinationId } → guard falls through
    (loggingEnabled undefined) → versionId && destinationId both truthy → whileRoleIsPropagating(
    updateDestination) → no throw → refusal undefined → re-read → logger.ok → return`. Confirm the
    fallback below is not reached. The cost if it ever were is a replaced stream, a new ARN and a
    repointed CloudFront delivery for a log setting.
  - *Status:* **SATISFIED**
  - *Discharged:* the logging-only case asserts on the recorded request targets, not only on the
    presence of the update: `expect(targets(requests)).not.toContain('Firehose_20150804.DeleteDeliveryStream')`,
    the same for `CreateDeliveryStream`, and the exact two-element `toStrictEqual` above already
    excludes them. It collects warnings and asserts
    `expect(warnings.join('\n')).not.toMatch(/UpdateDestination was refused/)` and
    `not.toMatch(/NEW ARN/)`. The AppendOnly fallback below the guard is unmodified - no diff hunk
    touches it - and its cases are green: `retries a role-propagation refusal on UpdateDestination
    instead of replacing the stream`, `falls back to replacing the stream when UpdateDestination is
    refused`, `does not replace the stream when the re-read after a successful update fails`, and
    `replaces the stream when there is no recorded version to update against`.
  - *Checks run:* execution trace on the logging-only input, against the real code: recorded
    `{ appendOnly: true, versionId: '3', destinationId: DESTINATION_ID }`, no `loggingEnabled`
    -> `appendOnly = true`, `loggingEnabled = undefined` -> guard `true && false` = `false`, falls
    through -> `versionId && destinationId` both truthy -> `logger.step("... in place (error
    logging unrecorded -> on) ...")` -> `whileRoleIsPropagating(() => client.updateDestination(...))`
    sending `IcebergDestinationUpdate.CloudWatchLoggingOptions` -> no throw -> `refusal === undefined`
    -> re-read outside the `try` -> `recordStream` writes `versionId: '4'`, `loggingEnabled: true`
    -> `logger.ok` -> `return`. The `deleteDeliveryStream`/`createStream` pair below is never
    reached. The test's state assertion confirms the convergence, which is what makes this
    reconcile run exactly once rather than on every apply.

- **O5 - The prose describing the single-condition reconcile is corrected.**
  - *Claim:* `read()`'s comment no longer says `update` branches on the recorded `AppendOnly` flag
    alone, `recordStream`'s doc names both compared flags, and the `UpdateDestination` log line no
    longer reports an AppendOnly transition on a reconcile where AppendOnly did not change.
  - *Evidence to collect:* read `packages/analytics/src/nodes.ts:2305-2315`, `:2019-2026` and the
    `logger.step` line in the update path; quote each as it now stands. Confirm the log line names
    what actually differs rather than interpolating `appendOnly -> STREAM_APPEND_ONLY`
    unconditionally, which on a logging-only reconcile would print "AppendOnly true -> true".
  - *Checks:* a comment that describes a guard the code no longer has is the exact defect class
    this whole change spec exists to correct - `transformLogGroupArn`'s comment reasoned a missing
    grant away and was read as cosmetic for a month. Treat a stale comment here as UNSATISFIED, not
    as a style note.
  - *Status:* **SATISFIED**
  - *Discharged:* `read()`'s comment now reads "What `update` then does with such a stream may be
    *nothing*: it branches on the two recorded flags and nothing else, so a `CREATING_FAILED` or
    `DELETING` stream that is already append-only with error logging on is reconciled with zero
    AWS calls and reported done - the state is not part of the comparison." The stale "branches on
    the recorded `AppendOnly` flag alone" clause is gone and the comment's separate, still-true
    point about a dead stream survives, as the Residue asks. `recordStream`'s doc now names both:
    "`appendOnly` and `loggingEnabled` are the two live flags the reconcile compares - the first
    against {@link STREAM_APPEND_ONLY}, the second against error logging simply being on. Both go
    through {@link recordOptional}". The `logger.step` line interpolates
    `${destinationDrift(appendOnly, loggingEnabled)}` rather than an unconditional
    `AppendOnly <recorded> -> <desired>`.
  - *Checks run:* `destinationDrift` names only what differs, and this is asserted rather than
    read: the logging-only case asserts `steps` matches `/error logging unrecorded -> on/` **and**
    `not.toMatch(/AppendOnly/)`; the explicitly-false case asserts `/error logging off -> on/`; the
    pre-existing AppendOnly case asserts `/AppendOnly false -> true/`; and a new fourth case,
    `names only AppendOnly when logging is already on and only the flag differs`, asserts
    `/AppendOnly false -> true/` and `not.toMatch(/error logging/)` - the same fault in the other
    direction. The "never empty" claim in `destinationDrift`'s doc holds by construction: the
    caller is past a guard that returned on `appendOnly === true && loggingEnabled === true`, so
    at least one of the two clauses fires. No stale comment survives in the changed region.

- **O6 - Meets the repo definition of done, with a mutation report.**
  - *Claim:* the six gates are green and the mutation report names, for every claim, the line
    mutated, the named failure observed, and the restore - including the guard mutation, which is
    mandatory.
  - *Evidence to collect:* run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`,
    `pnpm exec oxfmt --check .` and `pnpm knip` from the repo root, in
    `.github/workflows/ci.yml:21-40` order, and record each. Read the mutation report and confirm
    it covers at minimum the guard, the fifth statement (deleted, policy case fails) and the
    destination fields (`LogGroupName` dropped from the builder, body case fails).
  - *Checks:* a verifier who cannot reproduce the guard mutation's named failure treats this task
    as undischarged, per the plan's baseline. That is stated in the task's own DoD and is not
    negotiable here.
  - *Status:* **SATISFIED**
  - *Discharged:* all six gates run from the workspace root in `.github/workflows/ci.yml:21-40`
    order: `pnpm build` green (exit 0); `pnpm typecheck` green (analytics 337 files, 0 errors);
    `TZ=America/New_York pnpm test` green - core, build-agent 27, pds 150, **analytics 824**,
    cli 376, no failures; `pnpm lint` green with **zero** warnings for `packages/analytics` (the
    seven `no-shadow` warnings it prints are pre-existing and in `packages/cli/src/nodes.test.ts`);
    `pnpm exec oxfmt --check .` "All matched files use the correct format" over 208 files;
    `pnpm knip` clean. The analytics count moves 818 -> 824, which the diff corroborates
    independently: nine `it(` blocks added, three removed, net +6.
  - *Checks run:* every mutation the obligation names was reproduced by this validator, not taken
    on report - the guard (O3, with its output quoted there), the fifth statement (deleted, the
    policy case fails on the count) and the destination fields (`LogGroupName` dropped, the create
    and update body cases fail in both test files). Two further mutations were run to test whether
    any assertion was merely dominated: widening the logs `Resource` to the group's `:*` form kills
    the capability assertion while the count survives, and drifting the shared
    `firehoseLogGroupName` helper kills eight cases including the literal-pinned ones. Every
    mutation was restored and each restore proven byte-exact by `shasum -a 256`. No changeset is
    in this diff, and that is correct scoping rather than a gap: plan.md line 130 assigns the
    changeset to task 05, and tasks 02 and 03 shipped none either.

- **O7 - Reviewable: both guard directions, five statements, and the builder.**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics exec vitest run nodes
    --reporter=verbose` and see the `analytics-firehose-stream` describe carrying both a zero-call
    case and a reconciling case, the reconciling one's fixture recording `appendOnly: true` with no
    `loggingEnabled` and its recorded requests exactly
    `['Firehose_20150804.UpdateDestination', 'Firehose_20150804.DescribeDeliveryStream']` - the
    update plus the mandatory post-update re-read, with no delete/create pair, per O3; the
    `analytics-firehose-role` case enumerating five
    statements with no `*` resource; and `grep -n "CloudWatchLoggingOptions"
    packages/analytics/src/aws/firehose.ts` showing it in the builder and the description type
    rather than in a comment alone.
  - *Evidence to collect:* run that exact command (the filter names `blogwright-analytics`, the
    package whose tests these are) and record the case names and pass counts; run the grep and read
    each hit's context.
  - *Checks:* the grep can fail as written - `CloudWatchLoggingOptions` appears nowhere in
    `packages/analytics/src/aws/firehose.ts` today, and its only occurrence in the package is a
    comment in `nodes.ts` saying the block is not sent. Reading each hit's context is what keeps it
    from being satisfied by a comment.
  - *Status:* **SATISFIED**
  - *Discharged:* `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose`
    runs and prints 190 passed / 190. The `analytics-firehose-stream` describe carries both
    directions - `performs no AWS call at all once both live flags already match` (zero-call) and
    `reconciles an already-deployed append-only stream into error logging, in place` (reconciling),
    the latter's fixture recording `appendOnly: true` with `loggingEnabled` asserted absent, and
    its recorded requests asserted `toStrictEqual` the two-element
    `['Firehose_20150804.UpdateDestination', 'Firehose_20150804.DescribeDeliveryStream']`. Two
    requests, as the obligation states; a one-element expectation would have been the defect.
    `analytics-firehose-role > grants exactly five capabilities, each on concrete ARNs and none on
    a wildcard` is green.
  - *Checks run:* the grep the obligation warns can fail as written was run and each hit's context
    read. `grep -n "CloudWatchLoggingOptions" packages/analytics/src/aws/firehose.ts` returns six
    hits: `:147`, `:159` and `:226` are doc comments, but `:261` is the description type
    (`DestinationDescriptionResponse.IcebergDestinationDescription`), `:354` is the builder
    (`buildIcebergDestination`) and `:464` is `describeDeliveryStream`'s read-back. Three of the
    six are executable code in exactly the two places the obligation names, so the grep is not
    satisfied by a comment alone.

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `analyticsFirehoseStreamNode().create` calls `createStream` → `createDeliveryStream` → expect the
  recorded `CreateDeliveryStream` body identical to `main@3d47969` except for the added
  `CloudWatchLoggingOptions` block, and the recorded state identical except for the added
  `loggingEnabled` : **PRESERVED**. `creates the stream with the Iceberg destination and the
  transform processor` is green, and its diff adds only the `CloudWatchLoggingOptions` block to the
  body `toMatchObject` and only `loggingEnabled: true` to the whole-state `toStrictEqual`.
- `analyticsFirehoseStreamNode().update` on a stream recorded `appendOnly: false` (the pre-existing
  AppendOnly-differs case, `withRecordedStream`'s default) → expect the in-place update attempt,
  the re-read outside the `try`, and the replacement fallback on refusal, all unchanged :
  **PRESERVED**. No diff hunk touches the fallback. All five pre-existing update cases are green:
  `updates the destination in place when the recorded AppendOnly flag differs`, `retries a
  role-propagation refusal on UpdateDestination instead of replacing the stream`, `falls back to
  replacing the stream when UpdateDestination is refused`, `does not replace the stream when the
  re-read after a successful update fails`, and `replaces the stream when there is no recorded
  version to update against`.
- `analyticsFirehoseStreamNode().read` on an absent stream → expect `false` with no throw, and on a
  live stream expect `recordStream` to hydrate `state` and `failure` for `analytics status` :
  **PRESERVED**. `reads false without throwing when the stream is absent, recording nothing`,
  `reads an existing stream and hydrates the delivery state analytics status reports` and `clears a
  recorded failure once the stream reports healthy again` are all green; the absent-stream contract
  is untouched - `describeDeliveryStream`'s `catch` still returns `undefined` on `isNotFound`.
- `packages/analytics/src/commands.ts`'s `analytics status`, which reports the stream's delivery
  health from the state `read` hydrated rather than from a second describe → expect its cases green
  with the widened `DeliveryStreamStatus` : **PRESERVED**. `vitest run commands` -> 25/25 pass.
- The delivery role's four existing statements, each on a concrete ARN → expect all four unchanged
  and `ctx.names.bucket` still absent from the document : **PRESERVED**. The four `capability(...)`
  assertions for `glue`, `s3tables`, `lambda` and `s3` are byte-identical in the diff, and `never
  names the site's environment bucket anywhere in the policy` is green.

One regression surface the certificate did not name, checked because the diff touches shared test
infrastructure: `makeContext`'s logger construction changed from
`warnings === undefined ? NOOP_LOGGER : {...}` to an unconditional
`{ ...NOOP_LOGGER, ...(warn), ...(step) }`, and a new local in the one-string case is named
`streamInside` rather than `stream`. **PRESERVED** on both. `NOOP_LOGGER` is a plain object literal
of five own enumerable arrow functions, so `{ ...NOOP_LOGGER }` is behaviourally identical to the
object itself, and no case compares the logger by identity (its only three references are the
definition, this spread, and an unrelated local spread). The rename is real and load-bearing:
`nodes.test.ts` defines a module-level `function stream(status: string)`, so the obvious name would
have shadowed it, and `pnpm lint` reports zero warnings for `packages/analytics`. Full suite
824/824.

## Residue

Notes for the validator, not obligations. The guard is now a two-field allowlist, and the next
field the destination grows pays the same cost again - silently, since the symptom is a reconcile
that does nothing rather than one that fails. That is recorded as an open question in plan.md,
owned by Ant Stanley, and is deliberately not an obligation here: the spec settles this change at
two conditions. The `read()` comment's separate point - that a `CREATING_FAILED` or `DELETING`
stream is reported present rather than absent, and that the reconcile does not refuse over a dead
stream - is still true after this change and should survive the rewrite O5 asks for; only the
"branches on the recorded `AppendOnly` flag alone" clause is stale. If `IcebergDestinationUpdate`
turns out **not** to accept `CloudWatchLoggingOptions` and the fallback fires, that is a finding to
report rather than to absorb: the cost is a replaced stream and a repointed delivery for a log
setting, and it changes the spec's assumption rather than this task's code.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: DONE
CONFIDENCE: high
SUMMARY: O1-O7 are all SATISFIED against evidence this validator collected and commands it ran
itself, the load-bearing O3 discharged against recorded state with the mandatory guard mutation
reproduced (the one-condition return printed `appendOnly=true loggingEnabled=undefined` and left the
reconciling case with zero AWS calls), and every named regression surface is PRESERVED with the full
suite at 824/824 and all six CI gates green.

**Validator's notes, not obligations.**

1. *Deviation on an evidence instruction.* O3 names `git diff` for the restore proof. The isolated
   jj workspace has no `.git`, so `git` cannot run there. Byte-exactness was proven instead by
   `shasum -a 256` digests taken before each mutation and re-checked after restore, plus
   `jj diff --stat` returning to 516 insertions / 52 deletions across the same four files. Recorded
   rather than failed: a check that errors because its tool is absent is not evidence of a defect,
   and treating it as one would reproduce the "check that cannot fail" class this plan's baseline
   names.

2. *Pointer drift, as the plan warned.* Every `file:line` in this certificate is against
   `main@3d47969` and none resolves today. `IcebergDestinationInput`'s new fields sit near
   `firehose.ts:151`, not `:94`; `buildIcebergDestination` at `:338`, not `:304`, with its two
   callers at `:433` and `:527`, not `:381` and `:471`; `applyFirehoseRolePolicy`'s doc near
   `nodes.ts:2106`, not `:1898`; the guard at `:2672`, not `:2336`; `recordStream` at `:2318`, not
   `:2032`; `withRecordedStream` at `:2566`, not `:2529`. Everything above was resolved by symbol.
   Drift in the certificate's pointers, not a defect in the implementation.

3. *One assertion is genuinely dominated, and it does not matter.* In the role policy case the
   `not.toMatch(/:\*$/)` and `not.toBe(FIREHOSE_LOG_GROUP_ARN)` guards sit after a `toStrictEqual`
   that fails first under every mutation tried, so they are belt-and-braces rather than
   independently load-bearing. The two assertions that do carry weight - the count and the
   capability `toStrictEqual` - were each shown load-bearing by a mutation the other survives:
   deleting the fifth statement kills the count while the capability check never runs, and widening
   its `Resource` to the group's `:*` form kills the capability check while the count stays green.

4. *The one-string case's division of labour is sound.* `writes delivery errors to the very stream
   it creates and the very stream it grants on` compares three separately recorded requests to each
   other rather than to any literal it was handed, so it survives a mutation to the shared
   `firehoseLogGroupName` helper that moves all three together - by design. The absolute values are
   pinned elsewhere by independent literals (`FIREHOSE_LOG_GROUP` in the create-body case,
   `FIREHOSE_LOG_STREAM_ARN` in the role case), and drifting that helper reddened eight cases
   including both of those. The two layers together leave no gap; neither alone would.

5. *The Residue's contingency did not fire.* `IcebergDestinationUpdate` does accept
   `CloudWatchLoggingOptions` per the AWS reference, so the replacement fallback has no reason to
   run and the spec's assumption stands. Nothing to report on that head.
