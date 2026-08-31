# Done Certificate - Task 02: `LogsClient.ensureLogStream`, the second core operation this pipeline needs

**Task:** [02-core_ensure_log_stream.md](02-core_ensure_log_stream.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-08-31 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

- **O4 - The existing suite passes unmodified and the test diff is additive.**
  - *Claim:* no line inside `LogsClient.findDeliveryIdBySource`, `LogsClient.deliveriesForSource`,
    `LogsClient delete* idempotency` or the two request-body describes is altered.
  - *Evidence to collect:* run `git diff packages/core/src/aws/logs.test.ts` and confirm the diff
    is additive only - new lines appended, none removed or changed inside the pre-existing
    describes. Run the `logs` suite and confirm the pre-existing cases pass.
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

- **O6 - Reviewable: three named cases, a whole-body assertion, and an untouched suite.**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-core exec vitest run logs
    --reporter=verbose` and see the three new cases named and green, the body assertion using
    `toStrictEqual`, and the pre-existing cases unchanged.
  - *Evidence to collect:* run that exact command (the filter names `blogwright-core`, the package
    whose tests these are) and record the pass counts and case names; read the body assertion and
    confirm the matcher.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:766` `logDeliveryNode` calls `LogsClient`'s delivery methods with
  their existing arguments → expect every request body byte-identical and the node's tests green
  with no edit to their client fakes : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:75` `logGroupNode` calls `ensureLogGroup`, `putRetentionPolicy`,
  `logGroupExists` and `deleteLogGroup` → expect all four unchanged; a method inserted between
  them must not have altered any : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/nodes.ts:2541` `logs(ctx)`, which returns `ctx.clients.logsUsEast1`, is
  the plugin's handle on this class → expect the plugin's existing delivery-node tests green with
  no fixture change : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations. `ensureLogGroup` itself has no test in
`packages/core/src/aws/logs.test.ts`, so this task's cases are the first coverage of the
create-and-swallow idiom in that file; adding a case for `ensureLogGroup` while there would be
welcome but is not this task's obligation. Task 05 refreshes stale `file:line` citations in the
merged analytics change spec, several of which are into this very file - inserting a method here
shifts everything below it, so a citation that was correct before this task may not be after, which
is why task 05's DoD requires re-verification by symbol rather than by the recorded mapping.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
