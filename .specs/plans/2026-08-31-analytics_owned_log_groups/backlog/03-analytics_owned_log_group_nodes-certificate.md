# Done Certificate - Task 03: The two plugin-owned log group nodes, and twelve nodes become fourteen

**Task:** [03-analytics_owned_log_group_nodes.md](03-analytics_owned_log_group_nodes.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-08-31 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 03. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 03) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a recorded request, a test result, or an execution trace) - not by
assertion.

## Premises

- **P1 - Goal.** `analytics-transform-log-group` and `analytics-firehose-log-group` reconcile on
  the site's `logGroupNode` contract with 365-day retention re-applied on every apply, the second
  also converging its `DestinationDelivery` log stream; `buildAnalyticsNodes` returns fourteen with
  each group at the head of its chain, the two writers declare the edges their output depends on,
  and neither role's `dependsOn` changes.
- **P2 - Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item,
  in DoD order; O8 is the `Reviewable:` item.
- **P3 - Invariants.** Must not change the transform role's inline policy - two statements,
  `['logs:CreateLogStream', 'logs:PutLogEvents']` on the derived group ARN - nor any of the twelve
  existing nodes' behaviour, `dependsOn` sets or recorded outputs; must not change the plugin's
  scoped state key or the site graph; must leave `packages/analytics/CHANGELOG.md` untouched
  (a record of what shipped, not a statement of what is).

## Obligations

- **O1 - Both nodes reconcile on the `logGroupNode` contract, in `us-east-1`, at 365 days.**
  - *Claim:* `read` reports presence and records an ARN built with `ANALYTICS_REGION`, `create`
    ensures the group with the environment's tags then applies `LOG_RETENTION_DAYS = 365`, `update`
    re-applies the retention on every apply, and `delete` removes the group.
  - *Evidence to collect:* run `pnpm --filter blogwright-analytics exec vitest run nodes
    --reporter=verbose`; read the two new describes and confirm each asserts on **recorded
    requests** (the operation targets and their bodies) rather than on the node object. Confirm one
    case runs against a context whose `config.region` is not `us-east-1` and asserts the recorded
    ARN still names `us-east-1` - without that, the region pin is asserted by a fixture that agrees
    with either value.
  - *Checks:* resolve the client the nodes call. Confirm it is `logs(ctx)` at
    `packages/analytics/src/nodes.ts:2541`, which returns `ctx.clients.logsUsEast1` - **not**
    `ctx.clients.logs`, which signs in `config.region`, where neither group exists. Confirm
    `LOG_RETENTION_DAYS` is a named constant beside `ERROR_OUTPUT_PREFIX` and not a literal at the
    call site (DEVELOPMENT.md §Definition of done: limits are named constants).
  - *Status:* ☐ unverified

- **O2 - The Firehose group's `create` AND `update` both ensure the `DestinationDelivery` stream.**
  - *Claim:* a fresh create issues `CreateLogGroup`, `PutRetentionPolicy`, `CreateLogStream` in
    that order; an update over a group that already exists issues `PutRetentionPolicy` then
    `CreateLogStream`.
  - *Evidence to collect:* read both cases and confirm each asserts the recorded operation
    **sequence**, not merely that a `CreateLogStream` happened somewhere. Confirm the stream name
    comes from `DESTINATION_DELIVERY_STREAM` and that `delete` issues no separate stream teardown
    (deleting a group deletes the streams in it).
  - *Checks:* resolve `ensureLogStream` to `LogsClient`'s method landed at task 02 (imported
    through `ctx.clients.logsUsEast1`, step 4), not to a plugin-local helper of the same name. The
    update case is the one that distinguishes this node from the site's `logGroupNode`: without it
    a group created by a run that crashed between `CreateLogGroup` and `CreateLogStream` is
    permanently one call short, with `read()` reporting it present and `update()` doing nothing.
    If only the create case exists, this obligation is UNSATISFIED.
  - *Status:* ☐ unverified

- **O3 - Each group's name has exactly one home, shared with the ARN the role's grant derives.**
  - *Claim:* the transform group's name is built by the helper `transformLogGroupArn` now also
    calls, and the Firehose group's by one helper over `streamName`; a test finds the same string
    in the recorded `CreateLogGroup` body and in the recorded `PutRolePolicy` document.
  - *Evidence to collect:* read the two name helpers and confirm each has exactly one definition
    and that `transformLogGroupArn` (`packages/analytics/src/nodes.ts:922`) calls the shared one
    rather than re-interpolating `LAMBDA_LOG_GROUP_PREFIX` itself. Read the test that cross-checks
    the two recorded strings.
  - *Checks:* `boundedName` (`packages/analytics/src/nodes.ts:860`) **throws** rather than
    truncating, so the risk here is duplication, not silent divergence - a validator should not
    accept "the two literals agree" as discharging this. Two literals that agree today are exactly
    what one helper exists to prevent, and three spellings of the Firehose group name arrive at
    task 04.
  - *Status:* ☐ unverified

- **O4 - Fourteen nodes, two new edges, and neither role's `dependsOn` changed.**
  - *Claim:* `buildAnalyticsNodes` returns fourteen ids in the spec's order with each group at the
    head of its chain; `ANALYTICS_NODE_IDS` and `toHaveLength(14)` agree; `ANALYTICS_EDGES` gains
    exactly two edges - transform-log-group before transform-function, firehose-log-group before
    firehose-stream.
  - *Evidence to collect:* run `pnpm --filter blogwright-analytics exec vitest run commands
    --reporter=verbose`; read the set case and the edge case. Confirm `ANALYTICS_EDGES` is asserted
    with `toEqual` on the whole map (equality, not containment), so a changed role edge fails, and
    confirm the table is still hand-typed rather than read off `buildAnalyticsNodes` - a table
    derived from `dependsOn` agrees with any `dependsOn`, including a wrong one.
  - *Checks:* confirm `analytics-transform-role`'s and `analytics-firehose-role`'s `dependsOn` are
    unchanged from `main@3d47969`. The spec's Decision is explicit that the two roles do **not**
    declare edges to their groups (a role derives its group ARN from a name it already knows), and
    a task that added them would pass a containment assertion while contradicting the design.
  - *Status:* ☐ unverified

- **O5 - The two false comments are corrected and the policy is not.**
  - *Claim:* `transformLogGroupArn`'s doc no longer claims no node creates the group and states why
    the role keeps two actions rather than three; `LAMBDA_LOG_GROUP_PREFIX`'s doc no longer says the
    group is created by no node in this graph; and
    `packages/analytics/src/nodes.test.ts:1668`'s whole-document `toStrictEqual` on the transform
    role's policy passes **unmodified**.
  - *Evidence to collect:* read both doc comments and quote what they now say. Run
    `git diff packages/analytics/src/nodes.test.ts` and confirm the `analytics-transform-role`
    describe is untouched - the `toStrictEqual` still asserts two statements with
    `['logs:CreateLogStream', 'logs:PutLogEvents']`. Read
    `packages/analytics/src/nodes.ts:1032` and confirm the array is unchanged.
  - *Checks:* this is the line that separates this design from PR #27, so an edited assertion here
    is a REGRESSION rather than a test update: the policy test staying green **without being
    touched** is the evidence. If the test was edited at all, investigate what changed and why
    before accepting it.
  - *Status:* ☐ unverified

- **O6 - The count is restated everywhere it is a node count and nowhere it is not.**
  - *Claim:* `grep -rn "twelve" packages/analytics/src packages/analytics/README.md | grep -vi hex`
    returns nothing; `packages/analytics/CHANGELOG.md` is untouched; the stand-in at
    `packages/cli/src/plugin-commands.test.ts` keeps its twelve nodes but drops the claim that it
    mirrors the analytics set.
  - *Evidence to collect:* run that exact grep and record its output. Run
    `git diff --stat packages/analytics/CHANGELOG.md` and expect empty. Read
    `packages/cli/src/plugin-commands.test.ts:2389-2421` and confirm the header comment no longer
    claims to mirror the real set.
  - *Checks:* the `-vi hex` exclusion is the only one sanctioned, and it exists because two
    statements in that tree ("twelve hex characters", at `nodes.test.ts:134` and
    `transform-hash.test.ts:90`) are about the source hash's length and are not this change's
    business. Confirm the grep is not further narrowed to make it pass, and confirm it can still
    fail - it matched roughly two dozen lines before this task.
  - *Status:* ☐ unverified

- **O7 - Meets the repo definition of done, with a mutation report.**
  - *Claim:* the six gates are green and every load-bearing claim names the line that was mutated,
    the named failure observed, and the restore.
  - *Evidence to collect:* run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`,
    `pnpm exec oxfmt --check .` and `pnpm knip` from the repo root, in
    `.github/workflows/ci.yml:21-40` order, and record each. Read the mutation report and confirm
    it covers at minimum: `LOG_RETENTION_DAYS` set to 90, the `ensureLogStream` call deleted from
    the Firehose group's `update`, one of the two new `dependsOn` entries removed, and the transform
    group's name built from a second literal. **Reproduce the second of those yourself**, since it
    is O2's load-bearing claim: delete the call, run the suite, confirm the named case fails,
    restore, confirm `git diff` is clean for that path.
  - *Status:* ☐ unverified

- **O8 - Reviewable: the two node describes, the fourteen-node set, the untouched policy case, and the grep.**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics exec vitest run nodes commands
    --reporter=verbose` and observe two new node describes each with a retention case and the
    Firehose one with both convergence cases, the set case reading fourteen with the edge table
    asserted by equality, the transform-role policy case green with no edit, and the count grep
    returning nothing.
  - *Evidence to collect:* run that exact command (the filter names `blogwright-analytics`, the
    package whose tests these are) and record the case names and pass counts; run
    `grep -rn "twelve" packages/analytics/src packages/analytics/README.md | grep -vi hex`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/plugin.ts`'s `nodes` contributor calls `buildAnalyticsNodes()` and the
  CLI's `applyGraph` reconciles what it returns → expect fourteen nodes reconciled in a legal
  topological order, with the twelve pre-existing ones behaving identically :
  ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/commands.ts`'s `analytics status` walks the same set → expect one line
  per node, now fourteen, with the stream-health and row-count additions unchanged :
  ☐ (PRESERVED / REGRESSION)
- `applyTransformRolePolicy` (`packages/analytics/src/nodes.ts:1026`), whose doc comment this task
  extends → expect the emitted policy document byte-identical to `main@3d47969` :
  ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/plugin-commands.test.ts`'s twelve-node stand-in, whose prose this task edits →
  expect every case in that file green with no behavioural edit : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations. Two test fixtures needed teaching before the new nodes
could run at all, and a task that skipped them would fail loudly rather than silently:
`answerLogs` in `packages/analytics/src/nodes.test.ts` throws for any operation it has no case for,
and `analyticsWorld`'s `logs.` branch in `packages/analytics/src/commands.test.ts:694-704` falls
through to `jsonReply({})`, which answers `DescribeLogGroups` with no `logGroups` key and therefore
reports both new nodes absent even in the bootstrapped case. If the reconcile tests are green but
the status tests report the two groups missing on a bootstrapped environment, that fixture is why.
The `analytics status` open question - whether a missing log group deserves more prominence than a
missing bucket - is recorded in plan.md and is not this task's to answer.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
