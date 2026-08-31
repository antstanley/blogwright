# Done Certificate - Task 51: The Firehose delivery role and the Iceberg delivery stream nodes

**Task:** [51-nodes_firehose_role_and_stream.md](51-nodes_firehose_role_and_stream.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 51. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 51) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `analytics-error-bucket`, `analytics-firehose-role` and `analytics-firehose-stream` exist in `packages/analytics/src/nodes.ts` - a us-east-1 bucket for failed records, a delivery role holding exactly four concretely-scoped grants and declaring a dependency on each node whose recorded output those grants interpolate, and a stream writing the Iceberg destination through the transform, whose `read` surfaces the delivery state `analytics status` reports.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break tasks 48–50's nodes and their recorded outputs (the table, the catalog integration and the transform function ARN this role and stream read), nor touch the site's environment bucket at all - the failed-record prefix belongs to the plugin's own `analytics-error-bucket`, and `ctx.names.bucket` appears nowhere in the plugin's nodes.

## Validation history

This certificate has been discharged twice. The **first pass (2026-08-30/31)** verified the
whole change and returned PARTIAL, blocking on one defect (D1). The **second pass (2026-08-31,
this record)** is an independent gate over the *delta* that closes D1, run by an agent that
neither wrote the code nor performed the first pass.

### Inherited from the first pass (re-confirmed as untouched by the delta)

The wire format was read from AWS's published reference rather than from the suite: the request
key is `CurrentDeliveryStreamVersionId` and not the `VersionId` the describe answers with;
`IcebergDestinationUpdate` keeps the create's `S3Configuration` where all seven sibling
`*DestinationUpdate` members rename it to `S3Update`; `DestinationId` is service-generated and
`describeDeliveryStream` is its only source. `updateDestination` narrows **nothing** - the third
face of `ResourceInUseException` on this operation is "the stream is busy", not create's
"already exists" - and carries no `statusCode` limb, correctly, because all four of the
operation's exceptions are HTTP 400. The first pass's own 26 mutations were each killed on two
separate runs with a green control before every one and a proved byte-identical restore after:
`Resource: '*'` on each of the four grants, `sts:TagSession`, the trust-policy principal swap,
removal of the public-access block, removal of the bucket existence check in `delete`, the
`deleting`/`delete-failed` replacement guard, and both record orderings. The single edited
expected value in `firehose.test.ts` is the `versionId` field surfacing rather than a fixture
bent to fit, `nodes.test.ts` had zero deletions, and the `requireRecordedArn` refactor renders
byte-identical messages.

**The delta touches none of that.** Independently confirmed rather than accepted: the pre-delta
tree was recovered from `jj --at-op=fa5d16a93b5d file show` and `cmp`'d file by file -
`packages/analytics/src/aws/firehose.ts` and `packages/analytics/src/aws/firehose.test.ts` are
**byte-identical** to their pre-session state, and the `nodes.test.ts` delta is **purely
additive** (0 deleted lines, 30 added - one test).

### Second-pass method (the D1/D2 delta)

- **Fail-first evidence reproduced, both stages.** The unfixed shape was reconstructed and
  applied as a mutation, and the new test run against it twice - once with the two replies the
  test scripts, once with the three replacement replies added.
- **Three mutations of my own design** over the restructured block, each with a full-suite
  control run immediately before (640 green each time), a pre-mutation SHA-256 assertion, an
  assertion that the edit actually landed (hash changed *and* the new text present), and a
  proved byte-hash restore after.
- **One executable probe** for D2, appended to `nodes.test.ts`, run, then removed with the
  file's SHA-256 proved identical to its pre-probe value.
- **Restore proof.** All four files hash-match their pre-verification SHA-256, and
  `jj diff --git` in `/Users/ant/code/blogwright-task-51` hashes byte-identical to the snapshot
  taken before verification began (`b39c56e02dac…`).

## Obligations

- **O1 - Four concretely-scoped grants.**
  - *Claim:* the role's inline policy grants exactly Glue catalog read, S3 Tables write, `lambda:InvokeFunction` on the transform function, and write to the plugin's own `analytics-error-bucket`, each against a concrete ARN, with no `*` resource and no fifth statement.
  - *Evidence collected:* `applyFirehoseRolePolicy` (`packages/analytics/src/nodes.ts:1806-1864`) builds exactly four statements. `Resource` values resolve to `glueGrantResources(ctx)`, `[tableBucketArn(ctx), requireTableArn(ctx)]`, `requireTransformFunctionArn(ctx, FIREHOSE_ROLE_NODE)` (recorded, unqualified) and `[errorBucketArn, ${errorBucketArn}/*]`. No hardcoded account or region string appears in any of them.
  - *Checks run:* `analytics-firehose-role > grants exactly four capabilities, each on concrete ARNs and none on a wildcard` enumerates **by capability** (`capability(statements, service)` throws unless exactly one statement matches), plus `toHaveLength(4)` and a loop rejecting `'*'`. `grep -n "Resource: '\*'" packages/analytics/src/nodes.ts` → no output. First-pass mutations M9–M13 each reddened the named test.
  - *Status:* ☑ SATISFIED - untouched by the delta.

- **O2 - Declared dependencies on both nodes, and the stream's destination.**
  - *Claim:* the role declares `dependsOn` on `analytics-error-bucket`, `analytics-table` and `analytics-transform-function`; the stream declares `dependsOn` on `analytics-firehose-role`, `analytics-table`, `analytics-catalog-integration` and `analytics-transform-function`, and configures the Iceberg destination plus the record-transform Lambda processor against the recorded function ARN.
  - *Evidence collected:* `nodes.ts:2120` and `nodes.ts:2201` carry exactly those arrays. `firehoseDestination` reads `requireFirehoseRoleArn`, `requireErrorBucketArn` and `requireTransformFunctionArn` - all recorded outputs - and the processor sends `ParameterValue: TRANSFORM_FUNCTION_ARN`, the value task 50 recorded, not a re-derivation.
  - *Checks run:* `the analytics delivery graph > chains error-bucket -> firehose-role -> firehose-stream` asserts both sets by `toStrictEqual`; first-pass M21/M22 reddened it. The `it.each` guard cases prove each unrecorded ARN throws before `PutRolePolicy` goes out.
  - *Status:* ☑ SATISFIED - untouched by the delta.

- **O3 - The error bucket is the plugin's own, in us-east-1.**
  - *Claim:* the error/backup prefix targets `analytics-error-bucket`, never the site's environment bucket, and a comment states why.
  - *Evidence collected:* the comment at `nodes.ts:1881-1892` names the undocumented cross-region behaviour verbatim and states that a schema mismatch sends *every* affected record there. The bucket is created through `s3(ctx)`, built over `ctx.clients.signingUsEast1`, never `ctx.clients.s3`.
  - *Checks run:* `grep -n "names.bucket" packages/analytics/src/nodes.ts` → **no output** (re-run this pass; the only `ctx.names.bucket` occurrences in the package are in `nodes.test.ts`, asserting its absence). The create-body test pins `S3Configuration.BucketARN` to `arn:aws:s3:::<env>-<site>-analytics-errors`; the us-east-1 pin is asserted through `credentialScope`.
  - *Status:* ☑ SATISFIED - untouched by the delta.

- **O4 - The `AppendOnly` reconcile is defensive, not assumed.**
  - *Claim:* the stream node attempts `UpdateDestination` when the recorded flag differs from the configured one and falls back to replacing the stream when the update is rejected, with one test per branch.
  - *Evidence collected:* `analyticsFirehoseStreamNode().update` (`nodes.ts:2231-2313`). Both required branches exist and are covered (`updates the destination in place when the recorded AppendOnly flag differs`, `falls back to replacing the stream when UpdateDestination is refused`), plus the no-recorded-version path and the zero-call path when the flag already matches. The log line names which path ran.
  - *The first pass's deviation (D1) is now closed.* Only `updateDestination` remains in the refusal `try`; the post-update re-read runs in its own `try` whose `catch` warns and continues; the refusal is carried out on a `refusal: string | undefined` sentinel set from `String(err)`.
  - *Checks run this pass, by execution:*
    - **Fail-first, stage 1.** The unfixed shape restored (re-read inside the refusal `try`), the new test run against the two replies it scripts → `Error: unscripted AWS request in test: POST https://firehose.us-east-1.amazonaws.com/`, stack frames `FirehoseClient.deleteDeliveryStream (src/aws/firehose.ts:501:7)` ← `Object.update (src/nodes.ts:2285:7)`. The unfixed node does reach the destructive call.
    - **Fail-first, stage 2.** Same unfixed shape, the three replacement replies scripted → the **assertion** fires: `AssertionError: expected [ …(5) ] to strictly equal [ …(2) ]`, the received array carrying the extra `DeleteDeliveryStream`, `CreateDeliveryStream`, `DescribeDeliveryStream`. The test therefore fails against the unfixed shape for the right reason, and it asserts on `targets(requests)` - **the recording transport**, not a log message. (Its warning assertions are secondary; the transport assertion is the one that fires.)
    - **M3 - the refusal no longer sets the sentinel** (`refusal = String(err)` → `void String(err)`): exactly the two predicted tests fail - `falls back to replacing the stream when UpdateDestination is refused` with `expected [ …(2) ] to strictly equal [ …(4) ]`, and `raises rather than reporting success when the replacement races the old stream` with `promise resolved "undefined" instead of rejecting`. **The refusal path survived the restructure and is genuinely pinned.**
    - **M4 - the inner `catch` around the re-read removed:** the new test fails with the `LimitExceededException` propagating out of `update`. The warn-and-continue is load-bearing, not decoration.
    - **M5 - the sentinel guard inverted** (`refusal === undefined` → `!== undefined`): four tests fail.
    - Every mutation ran against a green 640-test control, asserted its pre-mutation hash, asserted it landed, and was restored with a proved byte-identical hash.
  - *Log text:* the refusal `logger.warn` is **byte-identical** to the pre-fix line. Proved executably - the pre-fix template interpolated `${String(err)}` at warn time, the post-fix one interpolates `${refusal}` where `refusal = String(err)` was captured in the catch; both rendered and compared, `===` and `Buffer.equals` both true. The `String(err)` sentinel also holds for a thrown `undefined` (`'undefined' !== undefined`), and for `null`, `''`, `0`, `false` and `NaN`.
  - *Status:* ☑ SATISFIED - both required branches present and tested, and the third, unrequired condition no longer fires.

- **O5 - Health readable, absence safe, teardown re-runnable.**
  - *Claim:* `read` hydrates the stream's delivery state into the plugin's scoped state and returns `false` without throwing when the stream is absent; `delete` is idempotent and completes after a partial teardown.
  - *Evidence collected:* `reads an existing stream and hydrates the delivery state analytics status reports` asserts `state`, `failure`, `versionId`, `destinationId` and `appendOnly` land in `ctx.state.resources['analytics-firehose-stream']`. `clears a recorded failure once the stream reports healthy again` covers the removal half; `reads false without throwing when the stream is absent, recording nothing` covers absence. `tearing the delivery chain down > is re-runnable when the stream is already gone` replies `ResourceNotFoundException` to the stream delete and asserts `ListRolePolicies, DeleteRole` still went out and the bucket `HEAD` followed.
  - *Checks run:* the hydration was re-confirmed this pass by the D2 probe - a `CREATING_FAILED` describe produces `{state: 'create-failed', failure: 'CREATE_KMS_GRANT_FAILED: the grant could not be created', versionId, destinationId, appendOnly}` in scoped state, which is exactly the input task 55's DoD names.
  - *Status:* ☑ SATISFIED.

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* re-run this pass from the workspace root, all six of `.github/workflows/ci.yml:21-29`, in order, each with its exit code checked: `pnpm build` ✅ (0) · `pnpm typecheck` ✅ (0) · `pnpm test` ✅ (0 - analytics **640**, cli 348, pds 145, core 149+1 skipped, build-agent 27) · `pnpm lint` ✅ (0; `packages/analytics` produces **zero** findings, and the 24 `no-shadow` warnings are all in `packages/cli/src/nodes.test.ts`, a file this diff does not touch) · `pnpm exec oxfmt --check .` ✅ (0, 188 files) · `pnpm knip` ✅ (0). Limits remain named constants with sourced rationale. No changeset, correctly: the nodes are not yet reachable from `Plugin.nodes` (task 54).
  - *Regression scope:* `packages/analytics/src/nodes.test.ts` still has **zero deleted lines** against the parent revision (0 deletions, 923 additions - re-counted this pass), so tasks 48–50's tests are byte-identical; all **87** of them were run by name and pass. The delta itself deleted nothing from the test file.
  - *Status:* ☑ SATISFIED.

- **O7 - Run the node suite and confirm the enumerated policy and the partial-teardown case (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests and observe a policy test enumerating all four capabilities by action, and a partial-teardown case that deletes the role after the stream is already gone without throwing.
  - *Evidence collected:* `pnpm exec vitest run nodes --reporter=verbose` inside `packages/analytics` → **129 passed** (128 before the delta, +1 for the new re-read test), including `analytics-firehose-role > grants exactly four capabilities, each on concrete ARNs and none on a wildcard` ✓ and `tearing the delivery chain down > is re-runnable when the stream is already gone` ✓. The three greps: `grep -n "names.bucket" packages/analytics/src/nodes.ts` → nothing; `grep -rn "ctx.names.bucket" packages/analytics/src/` → test-file assertions of its absence only; `grep -n "Resource: '\*'" packages/analytics/src/nodes.ts` → nothing. The policy test enumerates by capability, not by position.
  - *Status:* ☑ SATISFIED.

## D2 - the comment over the guard

The first pass recorded D2: `read`'s comment claimed that a live-but-unhealthy stream is
"handled by `update` instead", which `update` does not do. The implementer corrected the
**comment** rather than adding a guard, on the grounds that a throw in `update` is a behaviour
change outside this DoD and that task 55 owns stream health.

**Probe reproduced** (`nodes.test.ts`, temporary, removed with its SHA-256 proved restored). A
`CREATING_FAILED` describe carrying `AppendOnly: true` and a `FailureDescription`:

- `read` returns `true`;
- scoped state hydrates to `{name, state: 'create-failed', arn, versionId: '1', destinationId, appendOnly: true, failure: 'CREATE_KMS_GRANT_FAILED: the grant could not be created'}`;
- `update` issues **zero** AWS calls and emits **zero** warnings;
- so `applyGraph` reports `reconcile Firehose delivery stream` done over a stream that accepts nothing.

**Judgment: the comment is now true, and the deferral is right.** The new wording states the
behaviour exactly - "a `CREATING_FAILED` or `DELETING` stream whose flag already matches is
reconciled with zero AWS calls and reported done… Do not read this comment as a promise that the
reconcile refuses over a dead stream; it does not" - and the probe matches it clause for clause.
The deferral is not hand-waving: task 55's own contract says *"Append the Firehose stream's
delivery health from the state the stream node's `read` hydrated (task 51) rather than issuing a
second describe path"*, and the probe proves that state carries `state` and `failure`. Nothing
is swallowed or lost; the signal reaches the place the plan puts it. A throw in `update` would
abort `applyGraph` for the whole plugin - a plugin-wide semantic no task authorizes - and the
shape here differs from the create-path guard the first pass approved: that guard exists because
`createDeliveryStream` *swallows* `ResourceInUseException`, so without it a call that did nothing
would report success; here no call is made and no exception is swallowed.

One asymmetry survives and is recorded as residue rather than a defect: `createStream` raises
over a `deleting`/`delete-failed` stream while `update` sails through a `create-failed` one. That
belongs with the `AppendOnly`-only reconcile asymmetry already routed to task 58.

## Regression check

- Tasks 48–50's nodes → all **87** of their tests run by name and pass; `nodes.test.ts` has zero deletions against the parent revision, and the delta added 30 lines and deleted none : ☑ **PRESERVED**
- Task 34's `FirehoseClient` → `packages/analytics/src/aws/firehose.ts` and `firehose.test.ts` are `cmp`-identical to the pre-delta snapshot recovered from `jj --at-op`; the implementer's claim verified independently rather than accepted : ☑ **PRESERVED**
- `packages/cli` → 348 tests green; the diff touches no `packages/cli` file : ☑ **PRESERVED**
- **Integration.** A plain merge onto `plugin-system-and-analytics` at **build 49/62** (`917c26eb`, task 56) is **clean**: performed in a throwaway `jj workspace`, `jj new` reported no conflict, `jj resolve --list` returned *"No conflicts found at this revision"*, `jj status` shows no working-copy changes, and all four touched files come through the merge byte-identical. Builds 48 (task 26) and 49 (task 56) touch none of the four files, and build 49's `server.ts`/`commands.ts`/`plugin.test.ts` reference **none** of this task's symbols (`analyticsFirehose*`, `analyticsErrorBucket*`, `STREAM_APPEND_ONLY`, `updateDestination`, or any import of `./nodes` / `./aws/firehose`) - `Plugin.nodes` is still undeclared, pending task 54. Task 29 (`packages/cli/**`) and task 57 (`packages/analytics/app/**` plus `server.ts`) are disjoint from this diff. Probe workspace forgotten and removed.

## Defects

- **D1 - CLOSED.** `packages/analytics/src/nodes.ts:2251-2299`. The post-update re-read now sits outside the refusal `try`, in its own `try` whose `catch` warns and continues; the refusal travels on a `refusal: string | undefined` sentinel. Verified by reproducing the fail-first failure in both of its staged forms and by three independent mutations, one of which (M3) confirms the refusal path itself still fires. The refusal warning text is byte-identical to before.
- **D2 - CLOSED as a documentation defect.** `packages/analytics/src/nodes.ts:2205-2220`. The false clause is gone and the replacement states the real behaviour, confirmed clause by clause against a probe. The underlying behaviour (a reconcile reported done over a dead stream whose flag matches) is left open deliberately and is recorded in Residue.

No open defects.

## Residue

- **No `pollUntil` to `ACTIVE`** - routed to **task 53**, which is the first consumer that cares: a CloudFront log delivery pointed at a stream not yet accepting records. Confirmed as genuinely routed, not merely asserted: task 53's contract carries it as a ROUTED FINDING with `pollUntil` named as the precedent, and 53 declares `Depends on: 37, 51, 52`.
- **The reconcile reports done over a live-but-dead stream** whose `AppendOnly` already matches (D2's behaviour). Task 55 reports the health from the state `read` hydrates; whether `update` should also warn - a smaller step than a guard - belongs with the asymmetry decision below.
- **Only `AppendOnly` is reconciled.** Drift in any other destination field is never pushed, a deliberate asymmetry with `analytics-firehose-role`, whose `update` reapplies its whole policy unconditionally. Task 58's closure pass.
- **Buffering hints are named constants at the service maxima** (900 s / 128 MiB); `RetryOptions.DurationInSeconds` and `CompressionFormat` are unsent, so service defaults apply - unpinned, and not required to be.
- **The role name's length guard is untested** - `raises on a derived name over the service's limit` exercises only the bucket (63) and the stream (64).
- The change spec's "four operations" line is stale by one; confirmed present in plan.md's open questions (`plan.md:793-804`) and routed to task 58.
- *Cosmetic, not defects, and all pre-existing rather than introduced by the delta:* `ctx.logger.step` sits inside the refusal `try`, so a throwing logger would send the node to replacement without attempting the update; `String(err)` can itself throw for an object with a null prototype, in which case the reconcile aborts rather than falling back; and a re-read that returns `undefined` (the stream deleted concurrently between the update and the describe) skips `recordStream` and still logs "updated in place", which the next reconcile's `read` corrects by returning `false`.

## Conclusion

VERDICT: ☑ **DONE**

CONFIDENCE: ☑ **high**

SUMMARY: All seven obligations are satisfied on collected evidence, and the delta closes the one defect that blocked the first pass - the fail-first failure was reproduced in both of its staged forms (`unscripted AWS request` at `deleteDeliveryStream`, then `expected [ …(5) ] to strictly equal [ …(2) ]` on the recording transport), three mutations of my own design over the restructured block each killed named tests against a green 640-test control with a proved byte-hash restore, and M3 in particular proves the refusal path survived the restructure by reddening exactly the two tests it should; the refusal log line is byte-identical to before, `firehose.ts` and `firehose.test.ts` are `cmp`-identical to their pre-session state, `nodes.test.ts` still has zero deletions, tasks 48–50's 87 tests pass, all six repo gates are green, the `Reviewable:` line discharges at 129 tests with its three greps clean, and a plain merge onto build 49 is conflict-free with zero symbol overlap.
