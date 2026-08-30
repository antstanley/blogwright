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

Workspace `/Users/ant/code/blogwright-task-50` (jj), working copy `uquwmmwu e8322bac`, parent
`rkmunnmw 3b6be522` (build 43). Five paths changed: `packages/analytics/package.json`,
`src/nodes.ts`, `src/nodes.test.ts`, `src/paths.ts` (new), `pnpm-lock.yaml`. Every mutation
below was applied to a copy-protected tree and reverted; `shasum -a 256 -c` against a
pre-mutation baseline reports OK for all three source files and `jj diff --stat` is unchanged
(2017 insertions, 15 deletions across the same five paths).

## Obligations

- **O1 - Role trust, least-privilege policy, and the dependency that policy implies.**
  - *Claim:* the role is created with the Lambda trust shape at `packages/cli/src/nodes.ts:106-115`, restated with a comment saying why it is not imported; its inline policy is scoped to the function's own log group with no wildcard `Resource`; and it declares `dependsOn: ['analytics-salt-secret']`, the node whose recorded ARN that policy interpolates.
  - *Evidence collected:* `nodes.ts:740-753` restates `LAMBDA_TRUST` with a doc comment naming the CLI-private reason (verified against `packages/cli/src/nodes.ts:108-118`, which is a module-level `const` with no `export` - shapes are identical). `nodes.ts:911-936` `applyTransformRolePolicy` is shared by `create` (`:1113`) and `update` (`:1119`) and builds exactly two statements: `logs:CreateLogStream`/`logs:PutLogEvents` on `transformLogGroupArn(ctx)` and `secretsmanager:GetSecretValue` on `requireSaltSecretArn(ctx)`. `nodes.ts:1085` declares `dependsOn: [SALT_SECRET_NODE]`. `nodes.test.ts:1350-1394` parses `PolicyDocument` off the recorded form-encoded body, asserts the whole document by `toStrictEqual`, then re-asserts every `Resource` independently (`startsWith('arn:aws:')`, `not.toBe('*')`, `not.toContain('*')`). `nodes.test.ts:1131-1133` asserts the declared set.
  - *Checks run:* `ensureRole`/`putRolePolicy` are reached through `ctx.clients.iam` (`nodes.ts:1094`, `:912`) - IAM is global so core's client already signs us-east-1; no CLI module is imported anywhere in `packages/analytics/src/`. Mutation: `Resource: requireSaltSecretArn(ctx)` → `'*'` reddens "grants on two concrete ARNs and no wildcard resource" plus 3 others; the sharper `arn:…:secret:*` variant also reddens it. `dependsOn: [SALT_SECRET_NODE]` → `[]` reddens the chain test. Trust `Principal` widened to an array reddens the trust test. Policy name `'transform'` → `'exec'` reddens.
  - *Recorded divergence, judged:* the comments at `nodes.ts:860`, `nodes.test.ts:1130` and `:1401` state that a role declaring `dependsOn: []` "would be reconciled *before* the secret". That consequence is false for these two ids: `topoSort` sorts the zero-indegree queue (`packages/cli/src/graph.ts:46-49`) and `'analytics-salt-secret' < 'analytics-transform-role'`, so the secret would still drain first. The claim is inherited verbatim from the task contract's step 3. The code is unaffected - the edge is declared and `requireSaltSecretArn` throws - and the hygiene argument (the ordering would be incidental rather than guaranteed, and a rename would break it silently) stands. Recorded as a comment-accuracy defect, not a behavioural one.
  - *Status:* ☑ SATISFIED

- **O2 - Function code keyed by the source hash, with named limits.**
  - *Claim:* the function node depends on the role, uploads the bundled transform as a zip keyed by task 43's source hash, and declares runtime, handler, timeout and memory as named constants; an unchanged hash performs no update call and a changed hash performs one.
  - *Evidence collected:* `nodes.ts:1358` `dependsOn: [TRANSFORM_ROLE_NODE]`. `nodes.ts:1261-1275` `transformConfiguration` references `TRANSFORM_RUNTIME` (`:626`), `TRANSFORM_LAMBDA_HANDLER` (task 43's constant, imported), `TRANSFORM_MEMORY_MB` (`:637`), `TRANSFORM_TIMEOUT_SECONDS` (`:647`) - no literal at any call site. `nodes.test.ts:1590-1594` asserts the unchanged case with `expect(requests).toStrictEqual([])`, not merely "no throw"; `:1596-1613` asserts exactly one `PUT …/code`; `:1615-1634` exactly one `PUT …/configuration`.
  - *Checks run:* both the hash and the key come from task 43 - `readTransformManifest` (`nodes.ts:1183-1206`) reads only `hash` off the manifest and derives the key through `transformZipKey`, deliberately not trusting the manifest's own `key` field. Mutations: `transformUpdate.code`→`false`, `.configuration`→`false`, both→`true`, and swapping the two update calls each redden 2-6 named tests. Runtime/memory/timeout/handler/env-var-name drift each redden 7. `transformZipKey(hash)` → `hash` reddens 5.
  - *Two-call window:* `update` sends configuration first and records each half as it lands (`nodes.ts:1435-1446`); `nodes.test.ts:1636-1683` pins the order and pins that a 409 on the code push leaves the new configuration and the *old* `sourceHash` recorded. Disclosure 3 (no `LastUpdateStatus` wait) is accurate: `packages/analytics/src/aws/lambda.ts` deliberately does not surface it.
  - *Status:* ☑ SATISFIED

- **O3 - Absence, recorded ARN, and re-runnable teardown.**
  - *Claim:* `read` reports absence without throwing, `create` records the function ARN into the plugin's scoped state, and `delete` removes the function then the role and is re-runnable when either is already gone.
  - *Evidence collected:* `nodes.test.ts:1489-1494` (absent read → `false`, nothing recorded); `:1518-1551` (create records `{name, arn, sourceHash, codeKey, configuration}`); `:1849-1857` (function already gone - the role delete still goes out); `:1859-1866` (role already gone). `nodes.test.ts:1825-1847` walks the reversed chain and asserts `DELETE …/functions/<name>` precedes `ListRolePolicies`/`DeleteRolePolicy`/`DeleteRole`.
  - *Checks run:* mutating either `delete` to a no-op reddens 4-5 tests. `read`'s empty-ARN guard (`if (fn.arn)`) removed reddens "reads a function whose body carries no ARN without recording an empty one". `read`'s `Failed`-state refusal removed reddens its own case.
  - *Status:* ☑ SATISFIED

- **O4 - The salt secret is created inside the us-east-1 pin.**
  - *Claim:* `analytics-salt-secret` goes through the `SecretsManagerClient` task 38's bundle builds over `ctx.clients.signingUsEast1`, never through `ctx.clients.secrets`.
  - *Evidence collected:* `grep -rn "ctx.clients.secrets" packages/analytics/src/` → no output (exit 1). `nodes.ts:775-777` returns `createAnalyticsClients(ctx).secrets`, which `aws/clients.ts:82` builds over `ctx.clients.signingUsEast1`. `nodes.test.ts:1765-1805` asserts `CONFIG_REGION !== 'us-east-1'` *first* (so the fixture cannot be vacuous), then asserts all three Secrets Manager requests carry credential scope `{region: 'us-east-1', service: 'secretsmanager'}` and that every policy `Resource` contains `:us-east-1:` and not `CONFIG_REGION`.
  - *Checks run:* swapping `createAnalyticsClients(ctx).secrets` → `ctx.clients.secrets` reddens 2 tests including the region case. Writing `ctx.config.region` into `transformLogGroupArn` reddens 2.
  - *Status:* ☑ SATISFIED

- **O5 - Zip bytes cross the FileSystem port.**
  - *Claim:* the bundle is read through `ctx.ports.fs`, no domain module in the package imports `node:fs`, and no analytics path joined the lint override list.
  - *Evidence collected:* `grep -rn "node:fs\|from 'fs'" packages/analytics/src/` → no output (exit 1). `nodes.ts:1233` `await ctx.ports.fs.readBytes(path)`; `:1189` `await ctx.ports.fs.readText(path)`. `pnpm lint` exit 0, `packages/analytics` clean. `jj diff .oxlintrc.json` empty; its override list (`.oxlintrc.json:73-86`) carries no `packages/analytics/` entry.
  - *`paths.ts` judged:* `import.meta.url` appears in exactly one non-comment position in the package (`paths.ts:49`), documented as the plugin's composition root for paths. `node:path`/`node:url` are not restricted imports, so no override was needed - which is precisely the DoD's condition. The confinement is the right call: the plugin has no wiring step of its own (`plugin.nodes(ctx)` reaches `nodes.ts` directly), so `paths.ts` is the closest thing to a composition root available, and it resolves a directory and nothing else. It is a mild deviation from the CLI's precedent in *form* (the CLI hands `agentDir` down on `ctx`; here `nodes.ts` imports a module constant) - documented in the module, and directed by the task's own step 1. Mutations to the `'..'` level in either direction redden the dedicated test. End-to-end resolution verified against the real compiled artifacts: `dist/paths.js` → `<package>/`, joined to `TRANSFORM_BUNDLE_DIR` finds the real `index.mjs` and `transform-manifest.json`.
  - *Status:* ☑ SATISFIED

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the workspace root, all six gates in `.github/workflows/ci.yml` order: `pnpm build` (all packages, analytics rolldown bundle 806.82 kB, `transform-manifest.json: 24a542e224bd`), `pnpm typecheck` exit 0, `pnpm test` (core 149, pds 117, build-agent 27, analytics 557, cli 346 - all passing), `pnpm lint` exit 0, `pnpm exec oxfmt --check .` "All matched files use the correct format", `pnpm knip` exit 0 with no output.
  - *Limits:* `MAX_INLINE_ZIP_BYTES` (50 MB, sourced with a dated verification note), `ROLE_NAME_MAX_LENGTH`/`FUNCTION_NAME_MAX_LENGTH`, `SALT_SECRET_BYTES`, `ZIP_MTIME`, `ZIP_LEVEL`, `TRANSFORM_RUNTIME`/`MEMORY_MB`/`TIMEOUT_SECONDS`, `LAMBDA_LOG_GROUP_PREFIX`, `POLICY_VERSION`, `TRANSFORM_ROLE_POLICY` - all named module constants. Measured against reality: the real zip is 175,947 bytes, 0.35% of the guard.
  - *Changeset:* none, correctly. The three nodes are not reachable from any user command until `buildAnalyticsNodes` and the plugin declaration land; task 49 shipped none for the same reason, and plan.md task 58 owns the analytics plugin's changeset coverage.
  - *Status:* ☑ SATISFIED

- **O7 - Run `pnpm test -- nodes` and `pnpm lint`, and confirm the policy assertion, the empty update log and the untouched lint config (Reviewable).**
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` inside `packages/analytics`: 80 tests passing, run twice with identical results. The policy test asserts on the parsed document's `Resource` values (`nodes.test.ts:1364-1394`), not on a call count. The unchanged-hash case asserts `expect(requests).toStrictEqual([])` (`:1592`). `jj diff .oxlintrc.json` is empty.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/analytics/src/nodes.ts` tasks 48–49 nodes reconciled through the same test harness → **PRESERVED**. The parent revision's `nodes.test.ts` carries 34 `it(` blocks; all 34 titles appear in the passing run, and the diff's only removals (8 lines, at diff offsets 242/259/268-269/278/287-289) are entirely inside `makeContext` and its transport: `JSON.parse` → `parseBody` (which still parses every `{`-prefixed body identically and exists only so IAM's form-encoded bodies do not throw in the fixture), and three additive override fields (`env`, `files`, `warnings`). No expected value in any pre-existing test was edited, and `createMemoryFileSystem(initialFiles?)` already accepted its argument (`packages/core/src/adapters/memory-fs.ts:21`) - no core fixture was loosened. Across 57 mutations, not one reddened a task-48 or task-49 test: every failure named `analytics-salt-secret`, `analytics-transform-role`, `analytics-transform-function`, `transformUpdate`, `the analytics transform graph`, `the transform chain region pin and names` or `tearing the transform chain down`.
- `packages/cli/src/nodes.ts:219` `execRoleNode` → **PRESERVED**. `jj diff` touches no CLI path; the CLI's 346 tests pass; `LAMBDA_TRUST` is restated, never edited.
- `packages/analytics/package.json` vs task 47 (in review) → **CLEAN**. Task 47 inserts a `blogwright` key immediately after `"name"`; task 50 adds `"fflate": "^0.8.3"` inside `dependencies`. A three-way `git merge-file` with build 44's file as the base and task 47's delta rebased onto it exits 0 and yields valid JSON carrying both changes. (Task 47's own working copy is based on build 41 and needs its own rebase regardless of this task.)

## Falsifiability - independent mutation run

The implementer's reported table (45 mutations, 45 killed, 0 survivors) was **not accepted**. An
independent harness - which aborts on a missing pattern or a no-op edit, and which it did abort on
once - applied **57 mutations**, each reverted and hash-verified. Result: **46 killed, 11 survivors**,
stable across two runs.

Every headline behaviour the task exists to protect is killed:

| Mutation | Killed by |
| --- | --- |
| Replace the `create`-time `describeSecret` guard with a bare `upsertSecret` | 5 tests inc. "adopts a secret that exists when create runs, issuing no write at all" |
| Keep the guard read, drop only the adopt short-circuit | that test alone |
| Make `delete` call `deleteSecret` | 4 tests, all by the *absence-of-a-call* assertion (`toStrictEqual([])` / empty Secrets-Manager request filter) |
| Record the generated value into `ctx.state` | "creates the secret with a random value…" - the `not.toContain(value)` assertion genuinely fails |
| `Resource: '*'`, and the subtler `arn:…:secret:*` | the named wildcard test |
| Drop `arn === ''` from `requireSaltSecretArn`; make it interpolate instead of throw | the two named ARN-guard tests |
| Record the role ARN *after* the policy PUT | "records the role ARN even when the policy PUT throws" |
| Record the secret name / the function's hash *after* the ARN lookup | the two 403-pinned ordering tests |
| Both `transformUpdate` limbs, jointly and severally; swap the update order | 2-6 tests each |
| Swap in `ctx.clients.secrets`; write `config.region` into the log-group ARN | the region-pin test |
| Drift the handler, the env var name, the zip entry name, the derived key, the runtime/memory/timeout | 2-7 tests each |
| `describeSecret` → `getSecretValue` in `read` | 3 tests |
| `paths.ts` resolving one level too few or too many | the package-directory test |

**The 11 survivors, all judged non-defects.** Two are equivalent mutants: removing `update`'s
no-change early return (the two guarded `if`s below already send nothing - the behaviour itself is
pinned, since forcing both flags true reddens the empty-log test), and dropping
`readTransformManifest`'s redundant `typeof hash !== 'string'` check (`transformZipKey` still
throws, only with a different message). The other nine are **defensive branches that are correct
but uncovered**: the fixed zip `mtime`; the `MAX_INLINE_ZIP_BYTES` raise; the four empty-ARN
guards (`recordSaltSecret`, the secret `create` path, the role `read`, and
`requireTransformRoleArn` - note the *salt* node's identical guard **is** covered); `boundedName`'s
raise; "the key is derived, not read from the manifest"; and "the seed comes from the CSPRNG"
(`Math.random` passes the base64-shape and distinctness assertions - an inherent limit, not a
fixable gap). I read each one and confirmed the shipped code is right in every case; I verified the
mtime claim by execution instead, packing the real 806 kB bundle twice and comparing bytes.

The finding to record is not a defect but an evidence one: **"0 survivors" overstates what the
suite pins.** The suite is strong exactly where the stakes are - the secret's lifecycle, the policy,
the ordering, the region pin, the update gate - and thin on its own guard clauses. One of those,
`boundedName`, is a live gap rather than a theoretical one: core imposes no length cap on
`siteName` (`packages/core/src/config.ts:303`), and the analogue this helper explicitly cites
(`packages/analytics/src/config.ts:468`) *is* covered, at `config.test.ts:274`.

## Residue

The inline-zip decision is stated with its reason at `nodes.ts:658-673` (Lambda requires a
same-region code bucket; the site's bucket is in `config.region`; `analytics-error-bucket` is not a
deploy artifact store), and the size guard is a named constant whose raise names the measured size.
The secret is created only when absent, never rewritten, and carries no rotation configuration -
asserted as a whole-key-set equality (`Name`, `SecretString`, `ClientRequestToken`, `Description`)
rather than a `not.toHaveProperty`, so a rotation key added later cannot slip through. The
`GetSecretValue` grant names that secret's ARN alone. The secret's name reaches the function under
`SALT_SECRET_NAME_ENV`, task 43's single spelling, and the *value* never does.

**The log group is created by no node.** Step 4 enumerates exactly `logs:CreateLogStream` and
`logs:PutLogEvents`, and Lambda's implicit creation of `/aws/lambda/<function>` needs
`logs:CreateLogGroup`, which is not granted - so the transform's own CloudWatch logs will not
appear. Confirmed and noted per this section's instruction. The analysis behind the disclosure is
correct, and the CLI comparison sharpens it: `applyExecRolePolicy` (`packages/cli/src/nodes.ts:212`)
grants the same two actions and no `CreateLogGroup` **because the CLI owns a `microvm-log-group`
node and `execRoleNode` declares `dependsOn: […, 'microvm-log-group']`**. This plugin has no such
node, so the CLI's precedent is not self-sufficient here. Writing what the step said rather than
widening a grant unilaterally was right; this is an open question for the plan, not a task defect,
and `nodes.ts:836-846` states it in the code where the next reader will meet it.

The residual create/describe race (closable only by a create-only operation in core) and the
two-call update window are both accurately disclosed and both out of scope.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All seven obligations are satisfied on collected evidence - six workspace-root gates green
in CI order, the `Reviewable:` command showing 80 passing tests with the policy assertion on parsed
`Resource` values and the unchanged-hash case asserting `toStrictEqual([])`, both DoD greps empty,
`.oxlintrc.json` untouched, and the 34 landed tests passing unmodified - and an independent 57-mutation
run kills every mutation that changes shipped behaviour, leaving only uncovered-but-correct guard
clauses and one comment whose stated ordering consequence does not hold.
