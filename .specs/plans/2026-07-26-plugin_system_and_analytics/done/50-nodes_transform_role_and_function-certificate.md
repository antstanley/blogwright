# Done Certificate - Task 50: The transform Lambda's execution role and function nodes

**Task:** [50-nodes_transform_role_and_function.md](50-nodes_transform_role_and_function.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 50. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 50) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `analytics-salt-secret`, `analytics-transform-role` and `analytics-transform-function` exist in `packages/analytics/src/nodes.ts` - a long-lived salt secret, a least-privilege execution role declaring a dependency on it because its policy names its ARN, and a function whose code is keyed by task 43's source hash, so identical source never redeploys the function.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's IAM nodes (`packages/cli/src/nodes.ts:151` `buildRoleNode` and `:219` `execRoleNode`), the `.oxlintrc.json` restricted-import overrides, or task 43's hash and derived zip key, which this task consumes and must not restate.

## Validation environment

Workspace `/Users/ant/code/blogwright-task-50` (jj), working copy `uquwmmwu fd633795`, parent
`rkmunnmw 3b6be522` (build 43). Five paths changed: `packages/analytics/package.json`,
`src/nodes.ts`, `src/nodes.test.ts`, `src/paths.ts` (new), `pnpm-lock.yaml` - 2148 insertions,
16 deletions.

**This is the second gate on this task, over a delta.** `jj evolog` places the previously reviewed
working copy at `e8322bac` (00:09) and the submitted one at `fd633795` (00:42).
`jj diff --from e8322bac --to fd633795` is **two files, 145 insertions, 15 deletions**: a doc
comment in `nodes.ts:857-878`, two comment rewrites in `nodes.test.ts`, and seven new `it(` blocks.
**No production statement changed in the delta.** Every finding the prior gate discharged over the
first submission therefore carries forward untouched, and this certificate re-derives only the two
delta items, the integration surface and the six gates.

Every mutation below was applied to `packages/analytics/src/nodes.ts` and reverted by rewriting the
byte-exact pre-mutation text. **Restore proven:** `shasum -a 256` of `nodes.ts` reads
`e27db3b1a3b34a51907089345242d26e73ff296f7daa74f6a45cd2b571beb55e` both before the first mutation
and after the last; `nodes.test.ts` was never written to; `jj diff --stat` is unchanged at
2148/16 over the same five paths, and `jj diff --from e8322bac --to @ --stat` is unchanged at 145/15.

## Obligations

- **O1 - Role trust, least-privilege policy, and the dependency that policy implies.**
  - *Claim:* the role is created with the Lambda trust shape at `packages/cli/src/nodes.ts:106-115`, restated with a comment saying why it is not imported; its inline policy is scoped to the function's own log group with no wildcard `Resource`; and it declares `dependsOn: ['analytics-salt-secret']`, the node whose recorded ARN that policy interpolates.
  - *Evidence collected:* `nodes.ts:740-753` restates `LAMBDA_TRUST` with the CLI-private reason. `nodes.ts:923-938` `applyTransformRolePolicy` is shared by `create` (`:1125`) and `update` (`:1128`) and builds exactly two statements. `nodes.ts:1097` declares `dependsOn: [SALT_SECRET_NODE]`. `nodes.test.ts:1395-1432` parses `PolicyDocument` off the recorded form-encoded body, asserts the whole document by `toStrictEqual`, then re-asserts every `Resource` independently (`startsWith('arn:aws:')`, `not.toBe('*')`, `not.toContain('*')`). `nodes.test.ts:1136` asserts the declared set. All inherited, all re-run green.
  - *DELTA - the false consequence, retracted and replaced.* The prior gate recorded that three comments claimed a role with `dependsOn: []` "would be reconciled *before* the secret", and that this is false. The delta rewrites all three (`nodes.ts:862-872`, `nodes.test.ts:1128-1134`, `nodes.test.ts:1435-1440`). **I verified every claim in the replacement against `packages/cli/src/graph.ts` myself, line by line, rather than inheriting the prior gate's reading:**
    - "`topoSort` drains its zero-indegree queue in alphabetical order (`graph.ts:46-49`)" - `graph.ts:46-49` is `[...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort()`. **Holds**, and the citation is now the sort rather than the indegree loop (`:34-37`) the retracted text pointed at. The drain stays sorted because `:59` re-sorts on every push.
    - "`analytics-salt-secret` sorts before `analytics-transform-role`" - common prefix `analytics-`, then `s` < `t`. **Holds.**
    - "a role declaring `dependsOn: []` would still be reconciled second today" - follows from the two above. **Holds**, and is the exact negation of the retracted claim.
    - "rename either node past the other and the implicit ordering flips in silence (in teardown too, which is this same order reversed - `graph.ts:107`)" - `destroyGraph` is `topoSort(nodes).reverse()` at `:107`. **Holds**, and the teardown limb is new and correct.
    - "whereas the declared edge either still holds or makes `topoSort` throw `depends on unknown node` (`graph.ts:40`) before a single API call is made" - `graph.ts:40` is that exact throw, inside the edge loop; `applyGraph:73` and `destroyGraph:107` both call `topoSort` before any `read`/`create`/`delete`. **Holds**, and the disjunction is exhaustive (rename both consistently → edge holds; rename one → throw).
    - *Judgement:* the replacement is not "differently wrong". It names the guarantee the edge actually buys, cites three line ranges that each say what they are claimed to say, and adds the teardown consequence the original never had. **The recorded divergence from the first gate is discharged.**
  - *Checks run (mine, this gate):* `Resource: requireSaltSecretArn(ctx)` → `'*'` reddens 4 tests; `Resource: transformLogGroupArn(ctx)` → `'*'` reddens 2; `ANALYTICS_REGION` → `'eu-west-1'` reddens 21.
  - *Carried forward, not a task defect:* the task contract still carries the retracted claim in its own words - step 3 (`50-nodes_transform_role_and_function.md:14`, "a role declaring `dependsOn: []` is reconciled before the secret") and DoD bullet 1 (`:24`, "an undeclared dependency reconciles the role first"). The code now contradicts its own task file. Out of this gate's write scope; recorded for the plan.
  - *Status:* ☑ SATISFIED

- **O2 - Function code keyed by the source hash, with named limits.**
  - *Claim:* the function node depends on the role, uploads the bundled transform as a zip keyed by task 43's source hash, and declares runtime, handler, timeout and memory as named constants; an unchanged hash performs no update call and a changed hash performs one.
  - *Evidence collected:* `nodes.ts:1370` `dependsOn: [TRANSFORM_ROLE_NODE]`; `nodes.ts:1273-1283` `transformConfiguration` references `TRANSFORM_RUNTIME`, `TRANSFORM_LAMBDA_HANDLER` (task 43's, imported), `TRANSFORM_MEMORY_MB`, `TRANSFORM_TIMEOUT_SECONDS` - no literal at any call site. `nodes.test.ts:1677-1689` asserts the unchanged case with `expect(requests).toStrictEqual([])`; `:1691` exactly one code push; `:1719` exactly one configuration push.
  - *Checks run:* `transformUpdate.code` → `true` reddens 4; `.configuration` → `false` reddens 5; swapping the two update calls reddens 3; `TRANSFORM_MEMORY_MB` 256 → 128 reddens 8. All inherited findings reproduced independently.
  - *Status:* ☑ SATISFIED

- **O3 - Absence, recorded ARN, and re-runnable teardown.**
  - *Claim:* `read` reports absence without throwing, `create` records the function ARN, and `delete` removes the function then the role and is re-runnable when either is already gone.
  - *Evidence collected:* `nodes.test.ts:1957-1985` walks the reversed chain (`DELETE …/functions/<name>` then `ListRolePolicies`/`DeleteRolePolicy`/`DeleteRole`) and closes with the non-vacuity assertion the prior gate required - an empty Secrets Manager request list **alongside** three real deletes. `:1987-1994` and `:1996-2003` cover both partial-teardown directions.
  - *Checks run:* making `analytics-transform-role`'s `delete` a no-op reddens 5 tests; dropping `read`'s `Failed`-state refusal reddens 1.
  - *Status:* ☑ SATISFIED

- **O4 - The salt secret is created inside the us-east-1 pin.**
  - *Claim:* `analytics-salt-secret` goes through task 38's bundle client, never `ctx.clients.secrets`.
  - *Evidence collected:* `nodes.ts:775-777` returns `createAnalyticsClients(ctx).secrets`. `nodes.test.ts:1860-1899` asserts `CONFIG_REGION !== 'us-east-1'` first, then all three Secrets Manager requests' credential scope as `{region: 'us-east-1', service: 'secretsmanager'}`, then that every policy `Resource` contains `:us-east-1:` and **not** `CONFIG_REGION`.
  - *Checks run:* `ANALYTICS_REGION` → `'eu-west-1'` reddens 21 tests including this one.
  - *Status:* ☑ SATISFIED

- **O5 - Zip bytes cross the FileSystem port.**
  - *Claim:* the bundle is read through `ctx.ports.fs`, no domain module imports `node:fs`, and no analytics path joined the lint override list.
  - *Evidence collected:* `grep -rn "node:fs\|from 'fs'" packages/analytics/src/` → **no output, exit 1**. `nodes.ts:1241` `ctx.ports.fs.readBytes`; `:1200` `ctx.ports.fs.readText`. `grep -n analytics .oxlintrc.json` → **no output, exit 1**; the override list at `.oxlintrc.json:75-82` names only core/cli adapters, `cli/src/bin.ts`, `cli/src/context.ts`, the two `test-support.ts` files and `build-agent/**`. `import.meta.url` appears in exactly one non-comment position in `packages/analytics/src/` (`paths.ts:49`); the only other in-package hit is `vitest.config.ts`, outside `src/`.
  - *Status:* ☑ SATISFIED

- **O6 - Meets the repo definition of done.**
  - *Claim:* the six CI gates are green from the workspace root, in `.github/workflows/ci.yml:21-29` order.
  - *Evidence collected:* `pnpm build` exit 0 · `pnpm typecheck` exit 0 · `pnpm test` exit 0 (core 149 + 1 skipped, build-agent 27, pds 117, analytics 564, cli 346 - **1203 passing**) · `pnpm lint` exit 0, **zero warnings in `packages/analytics`** (the remaining `no-shadow` warnings are pre-existing in `packages/cli/src/nodes.test.ts`) · `pnpm exec oxfmt --check .` "All matched files use the correct format", 183 files · `pnpm knip` exit 0, no output.
  - *Status:* ☑ SATISFIED

- **O7 - Reviewable.**
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` inside `packages/analytics`: **87 passing, 0 failing** (34 inherited from tasks 48-49, 53 added by this task, 7 of them by this delta). The policy test asserts on the parsed document's `Resource` values (`nodes.test.ts:1400-1431`), not a call count. The unchanged-hash case asserts `expect(requests).toStrictEqual([])` (`:1687`). No analytics path in `.oxlintrc.json`. `pnpm lint` exit 0.
  - *Status:* ☑ SATISFIED

## The delta's second item - nine guard clauses, judged

**The seven pinned guards, each reproduced.** I ran my own mutation harness (36 mutants, all
reverted, restore hash-proven above). Every one of the seven dies, and each dies to its own single
test - the one-to-one claim holds:

| Guard | Mutation | Result |
| --- | --- | --- |
| `boundedName` (`nodes.ts:786`) | remove the raise | KILLED, 1 failed |
| `recordSaltSecret` (`:979`) | `if (arn)` removed | KILLED, 1 failed |
| salt `create` ARN record (`:1070`) | `if (created?.arn)` removed | KILLED, 1 failed |
| role `read` (`:1106`) | `!arn` → `=== undefined` | KILLED, 1 failed |
| role `read` (`:1106`) | guard removed entirely | KILLED, 3 failed |
| function `create` ARN record (`:1421`) | `if (created?.arn)` removed | KILLED, 1 failed |
| `requireTransformRoleArn` (`:897`) | `arn === ''` limb dropped | KILLED, 1 failed |
| `ZIP_MTIME` (`:684`) | → `new Date()` (wall clock) | KILLED, 1 failed |
| `requireSaltSecretArn` (`:886`) | `arn === ''` limb dropped | KILLED, 1 failed |
| function `read` ARN record (`:1392`) | `fn.arn` → `!== undefined` | KILLED, 1 failed |

**`boundedName` - the arithmetic, verified, and the reachability asserted rather than narrated.**
`packages/core/src/config.ts:303` validates `siteName`'s character class and **no length**.
`deriveNames` (`:384-409`) caps exactly one derived name: `bucket = ${prefix}-${accountId}` at 63
(`:391`). With `env='test'` and a 40-character `siteName`, `prefix` is 45, `bucket` is
45 + 1 + 12 = **58** (clears 63); `TRANSFORM_ROLE_SUFFIX` is 25 chars so the role is **70** and
`TRANSFORM_FUNCTION_SUFFIX` is 20 so the function is **65** - both over 64. Every number checks out.
`nodes.test.ts:1917-1938` pins this **as assertions**: `expect(siteName).toHaveLength(40)`,
`expect(ctx.names.prefix)`, `expect(ctx.names.bucket.length).toBeLessThanOrEqual(63)`, then the two
raises matched on their exact measured lengths (`is 70 characters` / `is 65 characters`), then
`expect(requests).toStrictEqual([])`. The reachability is in the assertion set, not the prose. The
guard is **live**, and the prior gate's call was right.

**The four empty-ARN guards - reachable, verified at the client layer (all three sources, not two).**
- `SecretsManagerClient.describeSecret` returns `{ arn: out.ARN, … }` with no validation
  (`packages/core/src/aws/secretsmanager.ts:84`), so a body without `ARN` reaches the node as
  `undefined` despite the declared `ARN: string`, and `"ARN": ""` reaches it as `''`. **Confirmed.**
- `IamClient.getRoleArn` returns `textTag(xml, 'Arn')` (`packages/core/src/aws/iam.ts:28`);
  `textTag` (`packages/core/src/aws/xml.ts:44-47`) returns `decodeEntities(inner.trim())` over
  `firstTag`'s capture group, which for `<Arn></Arn>` matches the empty string. So an empty element
  yields `''` and an absent one `undefined`. **Confirmed** - and pinned directly by
  `nodes.test.ts:1343-1352`, which scripts `existingRole('')`.
- `normalizeFunction` falls back to `arn: configuration?.FunctionArn ?? ''`
  (`packages/analytics/src/aws/lambda.ts:251`). **Confirmed.**
  These are reachable inputs, not hypotheticals: the guards are correct, the tests pin the value the
  respective client actually produces, and every guard-removal mutant dies.

**The three deliberate leaves, ruled on individually.**
1. **`MAX_INLINE_ZIP_BYTES` (`nodes.ts:674`, raise at `:1245`) - correctly LEFT, but not
   "unreachable".** Measured, not assumed: the real `dist/transform-bundle/index.mjs` is 806,821
   bytes and `zipSync` at level 6 with `ZIP_MTIME` produces **175,947 bytes**, exactly the figure
   reported and **298.0×** under the 50 MB guard. Removing the raise leaves all 87 tests green.
   Pinning it honestly does cost a ~50 MB allocation of incompressible bytes per run, so declining
   is the right call. But the classification is off by a category: this guard is **reachable in
   principle and merely untested**, not unreachable-by-construction - the code's own comment says
   so ("a tripwire … if the bundle ever grows past this, the fix is the S3 code path"), which is the
   honest wording, and it could have been pinned for free by extracting the comparison as a pure
   predicate, the move this very task mandated for `transformUpdate`. **Ruling: correctly left,
   mis-labelled.** Nit against the report's shorthand, not against the code.
2. **The CSPRNG (`newSaltSecret`, `nodes.ts:955-959`) - correctly classified as stated.** The claim
   is that no assertion *over outputs* can distinguish `crypto.getRandomValues` from a good PRNG,
   and that is true; I confirmed it by substituting `Math.random()` and watching all 87 tests pass.
   The two observable properties are pinned with real assertions, not prose:
   `expect(value).toMatch(/^[A-Za-z0-9+/]{43}=$/)` and
   `expect(Buffer.from(value, 'base64')).toHaveLength(32)` (`nodes.test.ts:1224-1226`), plus
   distinctness across two environments (`:1235-1245`) and `not.toContain(value)` over the state
   (`:1232`). `SALT_SECRET_BYTES` 32 → 16 dies. **Ruling: correct, with one qualification** - the
   mutant is killable by an assertion over the *call* (`vi.spyOn(globalThis.crypto,
   'getRandomValues')`; `vi` is already imported in this file), so the leaf is
   untested-by-choice rather than unkillable. The wording chosen ("over outputs") is precise enough
   that it does not misstate this.
3. **A different fixed `mtime` - correctly classified as equivalent.** Substituting
   `1991-02-03T04:05:06Z` for `1980-01-01T00:00:00Z` leaves all 87 green, and it should: nothing in
   the system compares zip bytes (the deploy gate is task 43's *source* hash, and `aws/lambda.ts`
   deliberately drops `CodeSha256`), so any fixed timestamp is behaviourally identical with respect
   to reproducibility. The mutant that matters - a *moving* mtime - dies at
   `nodes.test.ts:1626-1655`, which packs the real bundle twice across a moved `vi.setSystemTime`
   and asserts the two base64 payloads are `toBe` equal, with a comment explaining why the two packs
   must be separated in time (two-second zip timestamp granularity). **Ruling: correct.**

**On the numbers.** The implementer's first report ("45 killed, 0 survivors") was retracted rather
than defended, and that is the right disposition - a retraction of a number one did not re-run costs
nothing and buys the rest of the report its credibility. The replacement claim (a targeted re-sweep
of 15 mutants over the flagged sites, 12 killed / 3 surviving as the declared leaves, with no total
restated) is **corroborated**: my independent 36-mutant sweep kills every mutant at all seven pinned
sites and leaves exactly the three declared leaves standing. Declining to restate a total that was
not re-run is recorded here as correct practice, not as a gap.

**Two residual survivors of my own sweep, judged non-defects.** (a) `readTransformManifest`'s
`typeof hash !== 'string'` guard (`nodes.ts:1204-1208`) is unpinned - removing it leaves 87 green,
because the "malformed manifest hash" test (`nodes.test.ts:1806`) passes the *string* `'not-a-hash'`
and so exercises `transformZipKey`'s validation instead. Without the guard a manifest carrying no
`hash` key still raises, with `transformZipKey`'s message rather than this one: a worse error, never
a wrong deploy. Not one of the nine judged guards. (b) `boundedName`'s boundary mutant `>` → `>=`
survives; killing it needs a name of exactly 64 characters. Both are worth a line, neither is a
defect.

## Regression check - the integration surface

- **`nodes.test.ts`: 34 → 87 tests, no prior assertion weakened → PRESERVED.** Verified
  mechanically, not by reading: I extracted all 34 `it(` blocks from the parent revision
  (`jj file show -r @-`) and checked each as a **verbatim substring** of the submitted file.
  **34 found, 0 missing.** The diff's only deletions in this file are the 10 lines reported - one
  `vitest` import line (`describe, expect, it` → `+ vi`) and nine inside `makeContext`. No test body,
  expected value or assertion was touched. Judged individually: `env`, `files` and `warnings` are
  additive override fields; `env` defaults to `ENV`, `warnings` to `NOOP_LOGGER`; `files` changes
  the default memory filesystem from empty to `BUNDLED_ARTIFACTS`, which no task-48/49 test can
  observe because none of the four earlier nodes reads `ctx.ports.fs` at all. `JSON.parse` →
  `parseBody` (`:233-236`) is a widening, not a loosening: it still calls `JSON.parse` on every body
  whose first non-space character is `{` - which is every body the earlier tests script - and returns
  the raw string only for IAM's form-encoded query bodies, which `JSON.parse` would have thrown on.
  The file has grown three times and the assertions from the first two growths are byte-identical.
- **`packages/cli/src/nodes.ts:219` `execRoleNode` → PRESERVED.** No CLI path is in the diff; 346 CLI
  tests pass; `LAMBDA_TRUST` is restated, never edited.
- **Merge onto build 46 (`plugin-system-and-analytics` at `upprttuo 38f22dc9`, task 47) → CLEAN.**
  `jj diff --from 3b6be522 --to 38f22dc9` touches 35 files; the **only** overlap with this task's
  five paths is `packages/analytics/package.json`, and `pnpm-lock.yaml` is untouched by tasks 20/47.
  A three-way `git merge-file` (base = build 43's file, ours = task 50, theirs = build 46) exits **0**
  with no conflict region and yields valid JSON carrying both edits: task 47's `"blogwright": {"plugin":
  "analytics"}` immediately after `"name"`, and task 50's `"fflate": "^0.8.3"` inside `dependencies`.
  No semantic gap either - task 47's `plugin.ts` explicitly does not declare `nodes` (its comment
  assigns `buildAnalyticsNodes` to task 54), so nothing on the bookmark needs the three new factories.

## Residue

Carried forward from the first gate and unchanged by this delta: the missing `logs:CreateLogGroup`
is a recorded plan open question, sharpened by the observation that the CLI's precedent
(`packages/cli/src/nodes.ts:212`) grants the same two actions only because the CLI owns a
`microvm-log-group` node that `execRoleNode` depends on - so it is not self-sufficient here.
`nodes.ts:836-846` states it where the next reader meets it. The residual create/describe race and
the two-call update window are accurately disclosed and out of scope. Task 43's four settlements
remain consumed rather than restated, and the zip is byte-identical across packs (now pinned by a
test rather than by a gate's one-off execution).

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: Both delta items discharge - the three rewritten ordering comments were checked claim by
claim against `graph.ts:40`, `:46-49` and `:107` and every one holds, including the teardown limb the
retracted text never had; the seven newly pinned guards each die to their own single test under an
independent 36-mutant sweep whose restore is hash-proven; `boundedName`'s 40 → 58/70/65 arithmetic and
all three empty-ARN client-layer sources check out; and the three deliberate leaves are correctly
left, with `MAX_INLINE_ZIP_BYTES` mis-labelled "unreachable" when it is reachable-and-untested
(298× under a measured 175,947-byte artifact). The 34 inherited tests are verbatim intact, the six
root gates are green in CI order, and the merge onto build 46 is clean.
