# Done Certificate - Task 04: Firehose writes its delivery errors, on streams that already exist

**Task:** [04-firehose_delivery_logging.md](04-firehose_delivery_logging.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-08-31 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `analyticsFirehoseStreamNode().create` calls `createStream` → `createDeliveryStream` → expect the
  recorded `CreateDeliveryStream` body identical to `main@3d47969` except for the added
  `CloudWatchLoggingOptions` block, and the recorded state identical except for the added
  `loggingEnabled` : ☐ (PRESERVED / REGRESSION)
- `analyticsFirehoseStreamNode().update` on a stream recorded `appendOnly: false` (the pre-existing
  AppendOnly-differs case, `withRecordedStream`'s default) → expect the in-place update attempt,
  the re-read outside the `try`, and the replacement fallback on refusal, all unchanged :
  ☐ (PRESERVED / REGRESSION)
- `analyticsFirehoseStreamNode().read` on an absent stream → expect `false` with no throw, and on a
  live stream expect `recordStream` to hydrate `state` and `failure` for `analytics status` :
  ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/commands.ts`'s `analytics status`, which reports the stream's delivery
  health from the state `read` hydrated rather than from a second describe → expect its cases green
  with the widened `DeliveryStreamStatus` : ☐ (PRESERVED / REGRESSION)
- The delivery role's four existing statements, each on a concrete ARN → expect all four unchanged
  and `ctx.names.bucket` still absent from the document : ☐ (PRESERVED / REGRESSION)

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
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
