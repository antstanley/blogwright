# Done Certificate - Task 03: The two plugin-owned log group nodes, and twelve nodes become fourteen

**Task:** [03-analytics_owned_log_group_nodes.md](03-analytics_owned_log_group_nodes.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

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
  - *Evidence collected (validator):* ran `TZ=America/New_York pnpm --filter blogwright-analytics
    exec vitest run nodes --reporter=verbose` - 186 passed, including seven `analytics-transform-log-group`
    cases and eight `analytics-firehose-log-group` cases. Every one asserts on **recorded requests**:
    `logsOperations(requests)` reads the `Logs_20140328.*` target off each recorded request and
    `jsonBody(requests[n])` its parsed body, never the node object. The region pin is exercised on a
    context whose `config.region` is `CONFIG_REGION = 'eu-west-1'` (`nodes.test.ts:61`), and both
    `reads an existing group and records the us-east-1 ARN while config.region says otherwise` cases
    assert the recorded ARN `toContain(':us-east-1:')` and `not.toContain(CONFIG_REGION)`. Create
    asserts `{logGroupName, tags: ENV_TAGS}` then `{logGroupName, retentionInDays: 365}`; update asserts
    `PutRetentionPolicy` alone (transform) and delete asserts `DeleteLogGroup`, including the
    already-absent re-run.
  - *Checks run:* `logs(ctx)` resolves at step 3 to the module-level `function logs(ctx): LogsClient`
    (now `nodes.ts:2797`, the certificate's `:2541` is pre-task pointer drift), whose body is
    `return ctx.clients.logsUsEast1` - **not** `ctx.clients.logs`. No local, class or imported binding
    named `logs` shadows it. `LOG_RETENTION_DAYS = 365` is a named constant at `nodes.ts:1863`,
    immediately after `ERROR_OUTPUT_PREFIX` at `:1846`, and both `create` and `update` pass the
    constant, not a literal. Validator mutation: `365` -> `90` reddened four named cases
    (both groups' create and update retention cases); restored, `shasum -a 256` identical.
  - *Status:* **SATISFIED**

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
  - *Evidence collected (validator):* both cases assert the recorded **sequence** by
    `toStrictEqual` on the whole operation list, not by containment. Create:
    `expect(logsOperations(requests)).toStrictEqual(['CreateLogGroup','PutRetentionPolicy','CreateLogStream'])`
    plus the three bodies, plus `filter(op => op === 'CreateLogStream')).toHaveLength(1)` pinning that
    `BackupDelivery` is not created. Update:
    `toStrictEqual(['PutRetentionPolicy','CreateLogStream'])` with both bodies, and a sibling case
    proving an already-existing stream is swallowed. `delete` asserts `['DeleteLogGroup']` alone -
    no stream teardown. The stream name reaches the node as
    `DESTINATION_DELIVERY_STREAM = 'DestinationDelivery'` (`nodes.ts:1878`).
  - *Checks run:* `ensureLogStream` resolves at step 4 to `LogsClient.ensureLogStream(logGroupName,
    logStreamName)` at `packages/core/src/aws/logs.ts:78` (task 02's method), reached through
    `ctx.clients.logsUsEast1`. There is no plugin-local definition of that name anywhere in
    `packages/analytics/src`. **Validator reproduced the certificate's named mutation**: deleted
    `if (stream !== undefined) await client.ensureLogStream(group, stream);` from `update`
    (`nodes.ts:1313`) and ran the full analytics suite - exactly the two **update** cases reddened
    (`re-ensures the DestinationDelivery stream on update, converging a group created without one`
    and `swallows an already-existing stream on update`), each on the sequence assertion
    (`expected [ 'PutRetentionPolicy' ] to strictly equal [ 'PutRetentionPolicy', ...(1) ]`), a real
    assertion failure and not a crash; the **create** case stayed green, which is the discrimination
    this obligation turns on. Restored; `shasum -a 256 packages/analytics/src/nodes.ts` byte-identical
    to the pre-mutation digest `1a396609e99e9e357c8d68a37adcd6c155160bec9597f9d012ea50f953225dbc`.
  - *Status:* **SATISFIED**

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
  - *Evidence collected (validator):* `transformLogGroupName` (`nodes.ts:934`) is the sole definition
    of the transform group string, and `transformLogGroupArn` (`nodes.ts:976`) is now a one-line
    `return analyticsLogGroupArn(ctx, transformLogGroupName(ctx));` - it no longer re-interpolates
    `LAMBDA_LOG_GROUP_PREFIX` itself. `firehoseLogGroupName` (`nodes.ts:1970`) is the sole definition
    of the Firehose group string, over `streamName`. The new `analyticsLogGroupArn(ctx, group)` takes
    **no region parameter at all**, so `ctx.config.region` has no way in. The cross-check case
    `each log group name has exactly one home > creates the very group the transform role's policy
    grants on` runs the group node's `create` and the role node's `create` against one context and
    compares `jsonBody(requests[0])['logGroupName']` (the recorded `CreateLogGroup` body) against
    `granted.Resource` parsed out of the recorded `PutRolePolicy` `PolicyDocument` - two different
    production paths, neither one a fixture the test handed in.
  - *Checks run:* non-vacuity is pinned separately and runs *before* the equality:
    `expect(typeof created).toBe('string')`, `expect(created).not.toBe('')`, and
    `expect(granted?.Action).toStrictEqual(['logs:CreateLogStream','logs:PutLogEvents'])`, so the
    comparison cannot hold by comparing nothing to nothing. **Validator reproduced the certificate's
    named mutation**: replaced `name: transformLogGroupName` with a second literal
    (`(ctx) => \`/aws/lambda/${ctx.names.prefix}-analytics-transform-fn\``). The case reddened with
    both sides non-empty and genuinely different -
    expected `arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/test-example-analytics-transform-fn:*`
    (from the recorded `CreateLogGroup`), received
    `...:/aws/lambda/test-example-analytics-transform:*` (from the recorded `PutRolePolicy`). Restored
    byte-identically. `boundedName` (`nodes.ts:876`) still throws rather than truncating, and a third
    case asserts both group names raise on an over-long derived name before any request is made
    (`expect(requests).toStrictEqual([])`).
  - *Status:* **SATISFIED**

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
  - *Evidence collected (validator):* ran `TZ=America/New_York pnpm --filter blogwright-analytics exec
    vitest run commands --reporter=verbose`. `buildAnalyticsNodes` returns the fourteen in the spec's
    order - table-bucket, namespace, table, catalog-integration; salt-secret,
    **transform-log-group**, transform-role, transform-function; error-bucket,
    **firehose-log-group**, firehose-role, firehose-stream; log-destination, log-delivery - and
    `ANALYTICS_NODE_IDS` lists the same fourteen with `toHaveLength(14)`. `plugin.test.ts`'s
    `ANALYTICS_NODE_COUNT` is 14. `ANALYTICS_EDGES` is still hand-typed (a literal
    `Record<string, string[]>` at `commands.test.ts:327`, not derived from `buildAnalyticsNodes`) and
    is asserted by whole-map equality: `expect(edges).toEqual(ANALYTICS_EDGES)`.
  - *Checks run:* `analytics-transform-role`'s `dependsOn` is unchanged at `[SALT_SECRET_NODE]` and
    `analytics-firehose-role`'s at its four existing entries - neither appears in any hunk of
    `jj diff --git packages/analytics/src/nodes.ts`, whose hunk ranges skip both role bodies. Two
    validator mutations prove the assertion is equality and not containment: removing
    `TRANSFORM_LOG_GROUP_NODE` from the transform function's `dependsOn` reddened the edge-table case
    and two siblings; **adding** `TRANSFORM_LOG_GROUP_NODE` to the transform *role*'s `dependsOn`
    also reddened the edge-table case, which a containment assertion would have passed. Both
    restored byte-identically.
  - *Status:* **SATISFIED**

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
  - *Evidence collected (validator):* `LAMBDA_LOG_GROUP_PREFIX`'s doc (`nodes.ts:782-790`) now reads
    "the prefix {@link transformLogGroupName} builds the one group this plugin owns for its function
    from. `analytics-transform-log-group` creates that group; it is not left to the implicit creation
    the Lambda service performs on a function's first invocation, because a group created that way is
    retained forever and carries none of the environment's tags." The sentence "created ... by no node
    in this graph" is gone. `transformLogGroupArn`'s doc (`nodes.ts:949-966`) now reads
    "**`analytics-transform-log-group` creates this group**, which is why the policy below grants
    `logs:CreateLogStream` and `logs:PutLogEvents` and *not* `logs:CreateLogGroup`: the role has
    nothing to create, the shape the site's exec role has", and records that production disproved the
    old claim. The "**No node creates this group.**" sentence is gone. `applyTransformRolePolicy`'s
    array is unchanged at `['logs:CreateLogStream', 'logs:PutLogEvents']` (now `nodes.ts:1091`; the
    certificate's `:1032` is pointer drift) - only the doc comment above it was extended.
  - *Checks run:* the certificate names `git diff`, which cannot run in this non-colocated jj
    workspace (no `.git`; `git status` answers "not a git repository"). **Deviation recorded, not an
    unsatisfied obligation** - routed through `jj diff --git packages/analytics/src/nodes.test.ts`
    against the workspace parent, the correct baseline. Its hunk ranges are old lines 23-29, 32-38,
    661-667, 715-721, 1399-1405, 1835-1842, 2607-2617 and 4003-4005. The transform-role policy
    `toStrictEqual` sits at old `:1668`, strictly between the 1399-1405 and 1835-1842 hunks, so it is
    in no hunk at all - the assertion body is untouched, not merely renumbered. Read directly at its
    current `:1685`, it still asserts a two-statement document with
    `Action: ['logs:CreateLogStream', 'logs:PutLogEvents']` on `TRANSFORM_LOG_GROUP_ARN` and
    `['secretsmanager:GetSecretValue']` on `SALT_SECRET_ARN`, and it passes green.
  - *Status:* **SATISFIED**

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
  - *Evidence collected (validator):* ran the exact grep
    `grep -rn "twelve" packages/analytics/src packages/analytics/README.md | grep -vi hex` - **no
    output** (exit 1). Unfiltered, that path holds exactly two "twelve" lines,
    `nodes.test.ts:136` and `transform-hash.test.ts:90`, both "twelve hex characters" about the source
    hash's length, so `-vi hex` is doing exactly the one job it is sanctioned for and no narrowing was
    added. `packages/analytics/CHANGELOG.md` is untouched: `jj diff --git packages/analytics/CHANGELOG.md`
    is empty and `jj diff --summary | grep -i changelog` matches nothing in any package. The stand-in
    at `packages/cli/src/plugin-commands.test.ts` still holds twelve ids (counted:
    table-bucket ... log-delivery) and its header now says "It does **not** track the real set - that
    set has grown since this graph was written, and this file is deliberately not the place a reader
    learns how large it is"; the `ANALYTICS_GRAPH` doc likewise now says "deliberately not kept in
    step with it. Nothing here asserts anything about the real set's contents."
  - *Checks run:* the grep is not a check that cannot fail - validator re-introduced "twelve" into
    `packages/analytics/README.md:10` and the same grep immediately matched
    (`packages/analytics/README.md:10: ... the twelve resource nodes those clients reconcile`);
    restored, `shasum -a 256` back to `f9fce9fe...`. The grep's path is `packages/analytics/src` and
    the README only, so it never reads generated `packages/analytics/dist/`. Note also that
    `grep -rn "logs:CreateLogGroup" packages/analytics/` is now permanently self-matching - this task
    adds three doc comments naming that action in order to say the role is deliberately not granted
    it - so the policy was verified by reading the array and by the untouched policy test instead.
  - *Status:* **SATISFIED**

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
  - *Evidence collected (validator):* all six gates run from the workspace root in
    `.github/workflows/ci.yml:21-40` order, each observed by the validator, not taken on report -
    `pnpm build` exit 0; `pnpm typecheck` exit 0 (0 errors, 337 files); `TZ=America/New_York pnpm test`
    exit 0 (core 156 passed/1 skipped, build-agent 27, pds 150, **analytics 818**, cli 376);
    `pnpm lint` exit 0 (two pre-existing `no-shadow` warnings in `packages/cli/src/nodes.test.ts`,
    a file this task does not touch); `pnpm exec oxfmt --check .` exit 0, "All matched files use the
    correct format"; `pnpm knip` exit 0. No mutation-report *file* exists in the workspace, so rather
    than read one the validator **reproduced seven mutations independently**, each against the full
    analytics suite, each restored and each confirmed byte-identical by `shasum -a 256`:
    (1) `LOG_RETENTION_DAYS` 365 -> 90: 4 failed / 814 passed, both groups' retention cases by name;
    (2) `ensureLogStream` deleted from `update`: 2 failed / 816 passed, the two **update** convergence
    cases only, on the sequence assertion, create still green;
    (3) `TRANSFORM_LOG_GROUP_NODE` removed from the transform function's `dependsOn`: 3 failed / 815;
    (4) the transform group's name from a second literal: 6 failed / 812, the name-sharing case among
    them with both sides non-empty and different;
    (5) `ANALYTICS_REGION` -> `ctx.config.region` in `analyticsLogGroupArn`: 7 failed / 811, the
    recorded ARN naming `eu-west-1` where `us-east-1` is required;
    (6) the `DescribeLogGroups` answer reverted out of `analyticsWorld`'s `logs.` branch: 3 failed /
    815, three `analytics status` cases reporting the two groups `missing` in a bootstrapped world -
    so the fixture fix is load-bearing, not decorative;
    (7) `update` removed from the factory entirely: 3 failed, proving the three
    `expect(node.update).toBeDefined()` guards are not themselves checks that cannot fail.
    An eighth, adding an edge to the transform *role*, reddened the edge table (O4).
  - *Deviation recorded:* `git` does not work in a jj workspace, so the certificate's two `git diff`
    instructions were served by `jj diff --git <path>` against the workspace parent (the integration
    point, and the right baseline for "was this file altered") plus `shasum -a 256` taken before each
    mutation for "restored byte-identically". No obligation was failed over the tooling.
  - *Status:* **SATISFIED**

- **O8 - Reviewable: the two node describes, the fourteen-node set, the untouched policy case, and the grep.**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics exec vitest run nodes commands
    --reporter=verbose` and observe two new node describes each with a retention case and the
    Firehose one with both convergence cases, the set case reading fourteen with the edge table
    asserted by equality, the transform-role policy case green with no edit, and the count grep
    returning nothing.
  - *Evidence to collect:* run that exact command (the filter names `blogwright-analytics`, the
    package whose tests these are) and record the case names and pass counts; run
    `grep -rn "twelve" packages/analytics/src packages/analytics/README.md | grep -vi hex`.
  - *Evidence collected (validator):* ran the exact command
    `pnpm --filter blogwright-analytics exec vitest run nodes commands --reporter=verbose` (under
    `TZ=America/New_York`) - **2 test files, 211 tests, all passed**. The two new describes appear as
    `analytics-transform-log-group` (7 cases: the empty `dependsOn`, the us-east-1 ARN read against
    `config.region = eu-west-1`, the absent read, the tagged create with the 365-day retention, the
    retention re-applied on update, the delete, and the already-absent delete) and
    `analytics-firehose-log-group` (8 cases: the same seven shapes plus **both** convergence cases -
    `creates the group, the 365-day retention and the DestinationDelivery stream, in that order` and
    `re-ensures the DestinationDelivery stream on update, converging a group created without one`,
    with a third swallowing an already-existing stream). A third describe,
    `each log group name has exactly one home`, carries the two cross-path name cases and the
    over-long-name case. The set case reads
    `returns the spec table's fourteen nodes, by id, in its order` and the edge case asserts
    `expect(edges).toEqual(ANALYTICS_EDGES)` on the whole map. The transform-role policy case
    `grants on two concrete ARNs and no wildcard resource` is green with no edit to it. The count grep
    returns nothing.
  - *Status:* **SATISFIED**

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/plugin.ts`'s `nodes` contributor calls `buildAnalyticsNodes()` and the
  CLI's `applyGraph` reconciles what it returns → expect fourteen nodes reconciled in a legal
  topological order, with the twelve pre-existing ones behaving identically :
  **PRESERVED**. `analyticsPlugin.nodes` is still `buildAnalyticsNodes` by identity
  (`plugin.test.ts`), and `buildAnalyticsNodes()` has length `ANALYTICS_NODE_COUNT = 14`.
  `commands.test.ts`'s `reconcile(buildAnalyticsNodes(), ctx)` case ran all fourteen to completion
  against the permissive world and its non-vacuity assertion -
  `expect(Object.keys(ctx.state.resources).sort()).toEqual([...ANALYTICS_NODE_IDS].sort())` - now
  holds over fourteen ids, so no node silently no-opped. `topoSort` accepted the two new edges (no
  cycle, no unknown id) and the twelve pre-existing nodes' `dependsOn`, recorded outputs and request
  sequences are unchanged - none of their bodies appears in any hunk of
  `jj diff --git packages/analytics/src/nodes.ts`.
- `packages/analytics/src/commands.ts`'s `analytics status` walks the same set → expect one line
  per node, now fourteen, with the stream-health and row-count additions unchanged :
  **PRESERVED**. The plain-form and pretty-form cases both assert the full listing and now carry
  `present  Transform Lambda log group (us-east-1)` after the salt secret and
  `present  Firehose delivery-error log group (us-east-1)` after the error bucket, in
  `buildAnalyticsNodes` order; the delivery-health line, the row-count line, the degrade-to-warning
  cases and the unbootstrapped all-missing case are unchanged in shape and green. The one code change
  in `commands.ts` is a single word of prose ("twelve" -> "fourteen") in `logRowCount`'s doc comment.
- `applyTransformRolePolicy` (`packages/analytics/src/nodes.ts:1026`, now `:1080`), whose doc comment
  this task extends → expect the emitted policy document byte-identical to `main@3d47969` :
  **PRESERVED**. The function body is in no hunk (the only hunk in its neighbourhood is old
  1013-1020, the doc comment); the `Action` array is still
  `['logs:CreateLogStream', 'logs:PutLogEvents']` and the `Resource` is still `transformLogGroupArn(ctx)`,
  whose value is unchanged because `transformLogGroupName` reproduces the exact string the old inline
  interpolation built. The whole-document `toStrictEqual` passes **unmodified**.
- `packages/cli/src/plugin-commands.test.ts`'s twelve-node stand-in, whose prose this task edits →
  expect every case in that file green with no behavioural edit : **PRESERVED**. `pnpm test` reports
  cli 376 passed / 22 files. The diff over that file is 19 insertions and 16 deletions (`jj diff
  --stat`'s "35 --" is a bar rendering of 35 changed lines, **not** 35 deletions and 0 insertions),
  and every one of them is inside a `/* */` or `/** */` comment: no `it(`, `expect(`, node entry or
  fixture line was removed. `ANALYTICS_GRAPH` still holds exactly twelve ids, counted.

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

VERDICT: **DONE**
CONFIDENCE: **high**
SUMMARY: O1-O8 are all SATISFIED with evidence the validator collected and commands the validator ran
itself - six green gates, 818 analytics tests, the two new describes with both Firehose convergence
cases, a fourteen-node set asserted against a hand-typed edge table by whole-map equality, the
transform-role policy `toStrictEqual` provably in no diff hunk, and a count grep that returns nothing
yet still fires when "twelve" is re-introduced - and all four named regression surfaces are PRESERVED,
with seven independently reproduced mutations (including the certificate's mandated `ensureLogStream`
deletion, which reddens the *update* cases and leaves the create case green) confirming the
load-bearing assertions can fail.

**Correctness gate (semi-formal review, same reading):** VERDICT **CORRECT**, CONFIDENCE **high**.
Function resolution: `logs(ctx)` resolves at step 3 to the module-level helper returning
`ctx.clients.logsUsEast1`, not `ctx.clients.logs`; `ensureLogStream` resolves at step 4 to core's
`LogsClient` method from task 02, with no plugin-local shadow; `output`, `analyticsLogGroupArn`,
`transformLogGroupName`, `firehoseLogGroupName`, `transformFunctionName`, `streamName` and
`boundedName` all resolve to single module-level definitions; the factory's `name` and `record` are
local bindings that shadow nothing (the module has `recordTableBucket`/`recordStream`/etc. but no bare
`record`, and `ctx.record` is a property access). Execution trace, fresh Firehose-group create on a
context with `config.region = 'eu-west-1'`: `firehoseLogGroupName` ->
`/aws/kinesisfirehose/test-example-analytics-firehose` -> `CreateLogGroup` with the environment's tags,
signed us-east-1 -> the identity recorded as
`arn:aws:logs:us-east-1:123456789012:log-group:/aws/kinesisfirehose/test-example-analytics-firehose:*`
-> `PutRetentionPolicy` 365 -> `CreateLogStream DestinationDelivery`; the `update` path over an
existing stream-less group yields `PutRetentionPolicy` then `CreateLogStream`, which is the
convergence the task's `Produces` promises. Edge cases: `create` records identity *before* the
retention and stream calls where the site's `logGroupNode` records it after - a deliberate,
documented departure matching `analytics-error-bucket`, strictly safer under a crash; `read` answers
on the group alone, which is why `update` carries the stream; `ctx.tags` is optional and an untagged
environment creates an untagged group, exactly as the site's node does. No scope creep: no
`CloudWatchLoggingOptions` is set and the delivery role's grants are untouched - task 04's work is
named in prose only.
