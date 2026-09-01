# Done Certificate - Task 02: `LogsClient.ensureLogStream`, the second core operation this pipeline needs

**Task:** [02-core_ensure_log_stream.md](02-core_ensure_log_stream.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 02. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 02) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `LogsClient.ensureLogStream(logGroupName, logStreamName)` creates a log stream,
  sending `CreateLogStream` with exactly the two keys the API takes, returning normally on an
  already-exists response and rethrowing every other failure, with both directions asserted at
  the transport seam.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item,
  in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not change any existing `LogsClient` behaviour: `ensureLogGroup`
  (`packages/core/src/aws/logs.ts:61`), `putRetentionPolicy` (`:73`), `logGroupExists` (`:77`),
  `deleteLogGroup` (`:85`), `filterEvents` (`:95`) and the vended-delivery calls, nor the
  behaviour pinned by the four existing describes in `packages/core/src/aws/logs.test.ts`
  (`:28`, `:59`, `:137`, `:156`, `:184`). The site's log-delivery node
  (`packages/cli/src/nodes.ts:766`) is the downstream consumer of this class and must be untouched.

## Obligations

- **O1 - The method exists with the right shape and sends the right body.**
  - *Claim:* `ensureLogStream(logGroupName, logStreamName)` sits beneath `ensureLogGroup`, sends
    `CreateLogStream` with exactly `{ logGroupName, logStreamName }`, and a `toStrictEqual` body
    assertion pins both key spellings and the `x-amz-target` operation name.
  - *Evidence to collect:* read `packages/core/src/aws/logs.ts` around the new method; confirm it
    takes two positional parameters and no tags argument (`CreateLogStream` accepts none). Run
    `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose`; read the new body case
    and confirm it asserts the **whole** body with `toStrictEqual`, not `toMatchObject`, which would
    not catch an added key. Independently verify both key spellings and the operation name against
    the CloudWatch Logs `CreateLogStream` API reference rather than against the implementation.
  - *Checks:* resolve `this.call` in the new method - confirm it is `LogsClient`'s own private
    `call<T>` at `packages/core/src/aws/logs.ts:46` (enclosing class, step 2 of the resolution
    sequence), which is what supplies the `Logs_20140328.` target prefix and the AWS-JSON 1.1
    content type. A method that built its own request would pass the body assertion and miss the
    envelope.
  - *Collected:* `ensureLogStream(logGroupName: string, logStreamName: string): Promise<void>` at
    `packages/core/src/aws/logs.ts:78` (doc comment `:73-77`), directly beneath `ensureLogGroup`,
    whose closing brace is `:71`. Two positional parameters, no tags argument. Body assertion at
    `packages/core/src/aws/logs.test.ts:252` is `expect(captured?.body).toStrictEqual({...})` on the
    whole captured body, not `toMatchObject`; the `x-amz-target` assertion is at `:256`. Ran
    `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose` -> 17 passed (1 file).
    Verified the key spellings independently against the CloudWatch Logs `CreateLogStream` API
    reference (docs.aws.amazon.com API_CreateLogStream): request syntax is exactly
    `{"logGroupName": ..., "logStreamName": ...}`, both required, no `tags` parameter anywhere in
    the request, and the sample request carries `X-Amz-Target: Logs_20140328.CreateLogStream`. The
    implementation matches character for character.
  - *Checks:* `this.call` at `logs.ts:80` resolves by step 2 (enclosing class) to `LogsClient`'s own
    private `call<T>` at `logs.ts:46`. No local, module-level or imported `call` shadows it. That
    resolution is confirmed on the wire, not only by reading: the header assertion observes
    `Logs_20140328.CreateLogStream`, which only `call<T>`'s `${TARGET}.${op}` template produces, so
    a method that built its own request could not pass it.
  - *Status:* SATISFIED

- **O2 - Already-exists is swallowed and everything else is rethrown.**
  - *Claim:* a `ResourceAlreadyExistsException` reply resolves without throwing; a different
    failure rejects. One case each.
  - *Evidence to collect:* run the `logs` suite and read both cases. Confirm the swallow case's
    reply carries `__type: 'ResourceAlreadyExistsException'` at HTTP 400 (CloudWatch Logs answers
    at 400, not 409), and that the rethrow case uses a code that is neither an already-exists nor
    a not-found. Read the `catch` and confirm it is the `ensureLogGroup` shape:
    `if (err instanceof AwsError && err.isAlreadyExists) return; throw err;`.
  - *Checks:* resolve `isAlreadyExists` to `packages/core/src/aws/errors.ts:32-34` (imported, step
    4) and confirm its regex `/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i`
    matches `ResourceAlreadyExistsException` on the `AlreadyExists` alternative. If the task added
    a second, narrower predicate for this one case, record it: the DoD asks for the same guard
    `ensureLogGroup` uses, and a parallel predicate is a second home for the same rule.
  - *Collected:* swallow case at `logs.test.ts:259-268` replies HTTP 400 with
    `{"__type":"ResourceAlreadyExistsException","message":"exists"}` and asserts
    `.resolves.toBeUndefined()`. Rethrow case at `:270-276` replies HTTP 400 with
    `ValidationException`, which is neither an already-exists nor a not-found code
    (`isNotFound`'s regex does not match it), and asserts `.rejects.toThrow(...)`. The catch at
    `logs.ts:81-84` is character for character `ensureLogGroup`'s
    (`if (err instanceof AwsError && err.isAlreadyExists) return; throw err;`). Both cases green.
  - *Checks:* `isAlreadyExists` resolves by step 4 (imported `AwsError` at `logs.ts:1` from
    `./errors.js`) to the getter at `packages/core/src/aws/errors.ts:32-34`, whose regex
    `/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i` matches
    `ResourceAlreadyExistsException` on the `AlreadyExists` alternative. Confirmed at runtime, not
    only by reading the regex: the guard-deletion mutation printed
    `Serialized Error: { code: 'ResourceAlreadyExistsException', ..., isAlreadyExists: true }`.
    No second, narrower predicate was added; there is exactly one guard and it is the shared one.
  - *Status:* SATISFIED

- **O3 - Each new assertion has been watched to fail.**
  - *Claim:* the task's report names, for every claim, the line that was mutated, the named failure
    that was observed, and the restore.
  - *Evidence to collect:* read the task's report and confirm it names at least three mutations -
    a deleted body key, a deleted `isAlreadyExists` guard, and a widened catch - each with the test
    name that went red and its output. **Reproduce at least one** of them yourself: apply the
    mutation, run `pnpm --filter blogwright-core exec vitest run logs`, confirm the named case
    fails, then restore and confirm the file is byte-identical (`git diff` empty for that path).
  - *Checks:* the widened-catch mutation is the load-bearing one. Without a rethrow case, a method
    that swallowed every error would pass the already-exists case alone, and the swallow assertion
    would prove nothing. If the report names no mutation for the rethrow case, this obligation is
    UNSATISFIED rather than UNVERIFIED.
  - *Collected:* the report names six mutations, each with the case that reddened and the restore.
    The validator reproduced **all six** independently rather than the one required, confirming for
    each that the mutated line actually ran (the mutated value appears in the assertion diff), that
    the failure is an `AssertionError` and not a crash, and that exactly the named case reddened:
    1. drop `logGroupName` from the body -> body case fails at `logs.test.ts:252`, received
       `{ logStreamName: 'firehose' }`, expected two keys.
    2. add a third key `tags: {}` -> body case fails at `:252` with `+ "tags": {}` in the diff.
       This is the mutation that proves the matcher: `toMatchObject` would have passed it.
    3. misspell the key as `logstreamName` -> body case fails at `:252`, received
       `"logstreamName"` against expected `"logStreamName"`.
    4. rename the operation to `CreateLogStreams` -> fails at the **header** assertion,
       `logs.test.ts:256`, `expected 'Logs_20140328.CreateLogStreams' to be
       'Logs_20140328.CreateLogStream'`. The body assertion at `:252` passed first, so the header
       claim is independently killed and not dominated by a stronger sibling.
    5. delete the `isAlreadyExists` guard -> only the swallow case fails
       (`promise rejected "AwsError: logs: ResourceAlreadyExistsExce..." instead of resolving`).
    6. widen the catch to `return;` -> only the rethrow case fails
       (`promise resolved "undefined" instead of rejecting`); the swallow case still passed,
       which is exactly the negative space the DoD asks the rethrow case to supply.
    Each mutation was reverted from a pre-mutation copy and the restore proved byte-exact by
    `shasum -a 256` against a checksum taken **before** the first mutation
    (`logs.ts` 605df85f..., `logs.test.ts` 72d90d17...), both `OK` after the final restore.
  - *Checks:* the widened-catch mutation is present and load-bearing, so this obligation is not
    UNSATISFIED on the rethrow case. Mutations 5 and 6 were also run against the whole
    `blogwright-core` suite, not only the `logs` slice, so neither survives on a narrow filter.
  - *Deviation recorded:* the obligation names `git diff` for the restore proof. The task ran in a
    non-colocated `jj` workspace with no `.git`, where every `git` command fails with "not a
    repository"; the check was routed through `shasum -a 256` taken before the mutation instead,
    which is the stronger proof here because the file legitimately differs from the parent revision
    by this task's own additions and a parent diff would therefore answer a different question.
  - *Status:* SATISFIED

- **O4 - The existing suite passes unmodified and the test diff is additive.**
  - *Claim:* no line inside `LogsClient.findDeliveryIdBySource`, `LogsClient.deliveriesForSource`,
    `LogsClient delete* idempotency` or the two request-body describes is altered.
  - *Evidence to collect:* run `git diff packages/core/src/aws/logs.test.ts` and confirm the diff
    is additive only - new lines appended, none removed or changed inside the pre-existing
    describes. Run the `logs` suite and confirm the pre-existing cases pass.
  - *Collected:* `jj diff --stat` reports `2 files changed, 51 insertions(+), 0 deletions(-)`
    (`logs.test.ts` +37, `logs.ts` +14). Stronger than a hunk read: the parent revision's
    `logs.test.ts` is exactly 240 lines, and `head -240` of the working copy has the identical
    SHA-256 (`01a9b250e307f0451b...`) as the whole parent file, so the parent content is a
    byte-exact **prefix** of the new file and the change is strictly append-only. No line inside
    `LogsClient.findDeliveryIdBySource` (`:28`), `LogsClient.deliveriesForSource` (`:59`),
    `LogsClient delete* idempotency` (`:137`), `LogsClient.putDeliveryDestination request body`
    (`:156`) or `LogsClient.createDelivery request body` (`:184`) can have been altered. For
    `logs.ts`: parent lines 1-71 are identical to working-copy lines 1-71, and parent lines 72+ are
    identical to working-copy lines 86+, so the only edit is the 14-line insertion at `:72-85`.
    All 14 pre-existing cases in the file are named and green.
  - *Deviation recorded:* `git diff` is unavailable in the non-colocated `jj` workspace; the
    equivalent `jj diff --git` / `jj diff --stat` against the workspace parent was used, which is
    the same baseline the task branched from.
  - *Status:* SATISFIED

- **O5 - Meets the repo definition of done, and knip is not cited as evidence.**
  - *Claim:* the six gates are green, and the task's report does not treat a green `pnpm knip` as
    evidence that `ensureLogStream` is reachable.
  - *Evidence to collect:* run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`,
    `pnpm exec oxfmt --check .` and `pnpm knip` from the repo root and record each result. Read
    the task's report for how it treats knip.
  - *Checks:* `ensureLogStream` is a member of an already-exported class, and knip does not inspect
    class members - so the gate **cannot** report it as unconsumed and its silence is not evidence
    of anything. Equally, confirm the task did not manufacture a consumer to make the gate look
    meaningful: a test that only mentions the symbol, a type-annotation-only line, or production
    code written to be imported. The method's real consumer is task 03's node, and having none yet
    is the honest state.
  - *Collected:* all six gates run by the validator from the workspace root, in CI order.
    `pnpm build` green; `pnpm typecheck` green (0 errors across all packages);
    `TZ=America/New_York pnpm test` green (core 156 passed + 1 skipped, analytics 800, cli 376,
    pds 150, build-agent 27); `pnpm lint` exit 0 (the only output is pre-existing `no-shadow`
    **warnings** in `packages/cli/src/nodes.test.ts`, a file this task does not touch);
    `pnpm exec oxfmt --check .` "All matched files use the correct format" over 208 files;
    `pnpm knip` exit 0 with no findings. The report states plainly that knip proves nothing here
    and that `ensureLogStream` has no consumer until task 03.
  - *Checks:* no consumer was manufactured. `grep -rn "ensureLogStream"` across the repo, excluding
    `packages/core/dist/` (generated build output, where `aws/logs.d.ts` carries the declaration and
    is not a caller) and `node_modules`, finds only: the definition at `logs.ts:78`; the new
    describe and its three real invocations at `logs.test.ts:242,249,266,274`, each of which calls
    the method and asserts on its behaviour rather than merely naming the symbol; and prose in the
    plan and the change spec. There is no production import, no type-annotation-only line and no
    symbol-mentioning test. No changeset is expected of this task: the plan assigns the change's
    single changeset to task 05, which is where the operator-visible consequence lands.
  - *Status:* SATISFIED

- **O6 - Reviewable: three named cases, a whole-body assertion, and an untouched suite.**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-core exec vitest run logs
    --reporter=verbose` and see the three new cases named and green, the body assertion using
    `toStrictEqual`, and the pre-existing cases unchanged.
  - *Evidence to collect:* run that exact command (the filter names `blogwright-core`, the package
    whose tests these are) and record the pass counts and case names; read the body assertion and
    confirm the matcher.
  - *Collected:* ran `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose`
    verbatim. Result: `Test Files 1 passed (1)`, `Tests 17 passed (17)`. The three new cases are
    named and green: `LogsClient.ensureLogStream > sends CreateLogStream carrying exactly the log
    group and log stream names`, `> returns normally when the stream already exists, so creating it
    is re-runnable`, and `> rethrows every other failure instead of swallowing it`. The body
    assertion at `logs.test.ts:252` is `toStrictEqual` on the whole captured body, proven to be so
    by the `tags: {}` mutation, which `toMatchObject` would have let through. The 14 pre-existing
    cases are all named, green and byte-identical to the parent revision.
  - *Note (deviation from a Step, not from the DoD):* the task's fourth Step says to write the body
    case "using `capturingTransport`". The implementation defines its own inline transport in the
    new describe instead, because `capturingTransport` (`logs.test.ts:19-26`) records the body but
    not the headers, and the DoD requires the `x-amz-target` assertion as well. Extending the shared
    helper would have made the diff non-additive and put O4 at risk. The DoD wording is satisfied as
    written; the Step and the DoD are in mild tension and the implementation resolved it the right
    way round.
  - *Status:* SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:766` `logDeliveryNode` calls `LogsClient`'s delivery methods with
  their existing arguments → expect every request body byte-identical and the node's tests green
  with no edit to their client fakes : PRESERVED. `logDeliveryNode` resolves by symbol to
  `packages/cli/src/nodes.ts:766`. None of the delivery methods it calls changed: `logs.ts` lines
  1-71 and 86+ are byte-identical to the parent revision, so every request body is unchanged by
  construction. `packages/cli` 376 tests green with no fixture edit (the diff touches two files,
  both in `packages/core`).
- `packages/cli/src/nodes.ts:75` `logGroupNode` calls `ensureLogGroup`, `putRetentionPolicy`,
  `logGroupExists` and `deleteLogGroup` → expect all four unchanged; a method inserted between
  them must not have altered any : PRESERVED. `logGroupNode` resolves by symbol to
  `packages/cli/src/nodes.ts:75`; its `create` calls `ensureLogGroup(name(ctx), ctx.tags)` then
  `putRetentionPolicy`, `read` calls `logGroupExists`, `delete` calls `deleteLogGroup`. The
  insertion sits between `ensureLogGroup` (ends `:71`) and `putRetentionPolicy` (now `:87`) and
  altered neither: the byte-identity check above covers all four. `packages/cli` 376 tests green.
- `packages/analytics/src/nodes.ts:2541` `logs(ctx)`, which returns `ctx.clients.logsUsEast1`, is
  the plugin's handle on this class → expect the plugin's existing delivery-node tests green with
  no fixture change : PRESERVED. `logs(ctx)` resolves by symbol to
  `packages/analytics/src/nodes.ts:2541`. The class gains a member and loses nothing, so every
  existing call site keeps its behaviour. `packages/analytics` 800 tests green with no fixture or
  `LogsWorld` change.

## Residue

Notes for the validator, not obligations. `ensureLogGroup` itself has no test in
`packages/core/src/aws/logs.test.ts`, so this task's cases are the first coverage of the
create-and-swallow idiom in that file; adding a case for `ensureLogGroup` while there would be
welcome but is not this task's obligation. Task 05 refreshes stale `file:line` citations in the
merged analytics change spec, several of which are into this very file - inserting a method here
shifts everything below it, so a citation that was correct before this task may not be after, which
is why task 05's DoD requires re-verification by symbol rather than by the recorded mapping.

## Conclusion

VERDICT: DONE
CONFIDENCE: high
SUMMARY: O1 through O6 are all SATISFIED with evidence the validator collected and commands the
validator ran, all six mutations were reproduced and each killed exactly its named case with an
assertion failure before a byte-exact restore, and the three named downstream callers are PRESERVED
because the diff is provably additive only.

**Validator deviations from the authored protocol, recorded rather than failed.** O3 and O4 both
name `git diff`. The task was implemented in a non-colocated `jj` workspace, which has no `.git`, so
every `git` invocation there fails with "not a git repository" regardless of the state of the code.
Failing correct work over that would be another check that cannot fail in the environment the build
actually runs in. Both were routed around with strictly stronger evidence: `jj diff --git` and
`jj diff --stat` against the workspace parent for the additive-only claim, plus a byte-exact prefix
comparison of the parent file against the working copy; and `shasum -a 256` captured **before** the
first mutation, compared after each restore, for the restore claim (a parent diff cannot answer
that question, because the file legitimately differs from the parent by this task's own additions).

**Notes outside the obligations.** (1) The task's fourth Step asks for `capturingTransport` while
its first DoD item asks for an `x-amz-target` assertion that helper cannot make; the implementation
followed the DoD and defined its own transport, which is the right resolution and is recorded under
O6. (2) The certificate's own `file:line` pointers all still resolve by symbol, but P3's citations
into `packages/core/src/aws/logs.ts` (`putRetentionPolicy :73`, `logGroupExists :77`,
`deleteLogGroup :85`, `filterEvents :95`) are pre-insertion numbers and are each 14 lines low after
this task, exactly the drift the Residue block warns task 05 about. (3) `ensureLogGroup` still has
no test of its own in this file, as the Residue notes; the new cases are the first coverage of the
create-and-swallow idiom here.
