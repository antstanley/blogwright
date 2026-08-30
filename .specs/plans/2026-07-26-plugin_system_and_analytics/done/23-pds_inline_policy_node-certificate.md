# Done Certificate - Task 23: pds attaches its own named inline policy to the site's deploy role

**Task:** [23-pds_inline_policy_node.md](23-pds_inline_policy_node.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 23. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

> **This revision discharges the DELTA gate.** The first gate (2026-08-30, earlier) recorded a
> correctness concern outside the authored obligations - a privilege escalation on the preview
> stack - and the task contract gained a **third skip condition** in response. This revision
> re-derives the whole certificate over the amended contract, verifies the fix and both of its
> traps independently, and samples the untouched security mutations to confirm the delta did not
> weaken them. Evidence inherited from the first gate is marked *(inherited)*; everything else
> was re-executed here.

## Definition

DONE(Task 23) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright-pds` contributes one `ResourceNode` attaching a `blogwright-pds`-named inline policy to the site's GitHub-OIDC deploy role, granting Secrets Manager access to its own secret - a separately-named IAM object, so it coexists with the site's existing statement rather than replacing it, until task 59 removes that statement a release later.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's own OIDC policy document (`packages/cli/src/nodes.ts:863`), the six pds commands, or the pinned rkey vectors. The only permitted edit under `packages/cli/` is `githubOidcRoleNode` reading `ctx.names.githubRole` at `packages/cli/src/nodes.ts:884`.
- **P4 - The delta.** `jj diff --from a875dbf1f6dc --to @` isolates it to four changes across three files: the guard gains `|| ctx.env === PREVIEW_ENV` plus its constant and doc comment (`packages/pds/src/nodes.ts:59-67,157-196`); the fixture gains a settable `env` and derives its `siteState` role ARN from `names.githubRole` (`packages/pds/src/nodes.test.ts:38,81-87,97-98,120,146,168,176`); two `it` blocks are added (`:264-303`); the changeset's second paragraph is corrected and a third added. No production file outside `packages/pds/src/nodes.ts` changed in the delta.

## Obligations

- **O1 - The node exists and its policy is byte-identical to today's.**
  - *Claim:* `blogwright-pds` exports one resource node attaching a `blogwright-pds`-named inline policy to the site's OIDC role, and its document matches the statement `oidcRolePolicyStatements` produces today. The node is not yet reachable from the CLI - task 25 declares the `nodes(ctx)` member that returns it - so this obligation is discharged against the node's own tests.
  - *Evidence to collect:* read `packages/pds/src/nodes.ts`; run `pnpm --filter blogwright-pds test -- nodes`; diff the emitted policy document field by field against `packages/cli/src/nodes.ts:913-927` and the expectation at `packages/cli/src/nodes.test.ts:194-208`.
  - *Checks:* the three actions are exactly `secretsmanager:GetSecretValue`, `PutSecretValue`, `CreateSecret`; the Resource is `arn:aws:secretsmanager:<region>:<account>:secret:<name>-*` with the name from task 21's resolver, not from `config.pds.secretName` directly.
  - *Evidence collected:* `buildPdsNodes` (`packages/pds/src/nodes.ts:194-197`) returns exactly `['pds-oidc-policy']` on a non-preview stack. **17/17** tests green in `packages/pds/src/nodes.test.ts` (15 at the first gate, +2 from the delta). Byte-identity was **re-verified at the artifact level, independently of the implementer**: a harness importing `oidcRolePolicyStatements` from `packages/cli/dist/nodes.js` and `buildPdsNodes` from `packages/pds/dist/nodes.js` over `deriveNames(env, '123456789012', …)`, **per environment**, produced

    | env | site statements | plugin statements | identical |
    |---|---|---|---|
    | `production` | 1 secretsmanager statement | same | **true** |
    | `staging` | 1 secretsmanager statement | same | **true** |
    | `preview` | `[]` | `[]` | **true** |

    the shared string on both non-preview sides being
    `{"Effect":"Allow","Action":["secretsmanager:GetSecretValue","secretsmanager:PutSecretValue","secretsmanager:CreateSecret"],"Resource":"arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*"}`,
    with `putRolePolicy` targeting `production-example-gh` / `staging-example-gh` under policy name `blogwright-pds`. The name reaches the ARN through `resolvePdsSecretName(pds, ctx.config.siteName)` (`packages/pds/src/nodes.ts:196`), not a direct read. The harness ran against **built `dist`**, not source literals, and was deleted afterwards (`jj status` shows the same six files).
  - *Mutation evidence (re-executed here, not inherited):* `Resource` → `'*'` killed **4** named tests (3 at the first gate; the new staging test also catches it); `Effect: 'Allow'` → `'Deny'` killed **4** (was 3). No kill count fell.
  - *Gap (recorded, not blocking - unchanged by the delta):* replacing `resolvePdsSecretName(pds, …)` with a direct `pds.secretName` read still survives every test. It is behaviour-equivalent today because core's `PdsConfig.secretName` is required and `mergeConfig` always fills it, so no fixture can reach the resolver's `?? defaultSecretName` branch. The source satisfies the check; no executable test distinguishes it.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O2 - Additive only - the site's own policy is never touched.**
  - *Claim:* the node calls `putRolePolicy` with policy name `blogwright-pds` and touches no other policy name.
  - *Evidence to collect:* read the recording-IAM-client test; confirm it asserts the policy name and that no other `putRolePolicy`/`deleteRolePolicy` call is made.
  - *Checks:* `read()` uses `listRolePolicies` and `delete()` uses `deleteRolePolicy`, both scoped to the `blogwright-pds` name.
  - *Evidence collected:* the fixture records every IAM call in one ordered array and models live policy state, so "no other policy name was touched" is asserted over the whole transcript (`calls.map((call) => call.policyName)).toEqual(['blogwright-pds'])`, `packages/pds/src/nodes.test.ts:321`) and over the role's resulting policy list (`policiesOn()).toEqual([SITE_POLICY, 'blogwright-pds'])`, `:320`). `read()` calls only `listRolePolicies`; `delete()` lists, then deletes only `POLICY_NAME`.
  - *Mutation evidence (re-executed here):* **the clobber defect** - rewriting `delete` to loop `for (const name of await listRolePolicies(roleName)) deleteRolePolicy(roleName, name)` - killed **2**, exactly "removes only its own named policy, leaving the site's document on the role" (`:386`) and "deletes nothing when its grant is already gone" (`:396`). `POLICY_NAME` → `'pds'` killed **7** (6 at the first gate; the new staging test adds one); the 10 survivors are exactly the name-independent ones. Both counts are ≥ the first gate's, so the delta did not weaken either.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O3 - The site's Secrets Manager statement is untouched by this task.**
  - *Claim:* `packages/cli/src/nodes.ts:913-927` is unchanged; the only edit to that file is `githubOidcRoleNode` reading `ctx.names.githubRole`. The site's statement stays until task 59.
  - *Evidence to collect:* run `jj diff packages/cli/src/nodes.ts` and read every hunk - expect exactly one, at the role-name derivation.
  - *Checks:* if the `if (ctx.config.pds)` statement changed, the additive-first ordering has been broken and every deployed stack loses the grant at its next `blogwright bootstrap` - `applyOidcRole` rewrites the whole `<env>-deploy` document - so mark UNSATISFIED.
  - *Evidence collected:* `jj diff packages/cli/src/nodes.ts` shows exactly one hunk, one line, at **`:884`**: `` `${ctx.names.prefix}-gh` `` → `ctx.names.githubRole`. `jj diff --stat` reports `packages/cli/src/nodes.ts | 2 +-`. The edit is inside a pure name-deriving lambda: no AWS call is added or removed, so none of `nodes.test.ts`'s ordered call-sequence pins is disturbed - and `packages/cli/src/nodes.test.ts` **does not appear in the diff at all**, so no expected sequence was edited. All 304 CLI tests pass unchanged. The site's `if (!ctx.preview) { … if (ctx.config.pds) { … } }` block (`packages/cli/src/nodes.ts:963-987`) is verbatim as it was, and the delta touched nothing under `packages/cli/`.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED

- **O4 - The deploy role's name has one home.**
  - *Claim:* `deriveNames` returns `githubRole` as `<env>-<siteName>-gh`, `githubOidcRoleNode` reads it rather than deriving it privately, and the derived value is unchanged so no existing role is renamed.
  - *Evidence to collect:* read `Names` and `deriveNames`; run `pnpm test -- config` in `packages/core` and confirm a case pins the derived value; run `grep -n 'prefix}-gh' packages/cli/src/nodes.ts` and expect no output.
  - *Checks:* resolve what the plugin's node passes to `putRolePolicy` - confirm it is `ctx.names.githubRole` and not a second derivation.
  - *Evidence collected:* `Names.githubRole` added (`packages/core/src/config.ts:365-374`), `deriveNames` returns `` `${prefix}-gh` `` where `prefix = `${env}-${cfg.siteName}`` (`:402`), so `prefix` carries the environment. `grep -n 'prefix}-gh' packages/cli/src/nodes.ts` returns nothing (exit 1). The pin `deriveNames('production'…).githubRole === 'production-example-gh'` and `deriveNames('staging'…) === 'staging-example-gh'` passes (**26/26** core config tests). The plugin passes `ctx.names.githubRole`; the dist harness shows `putRolePolicy` targeting `production-example-gh` and `staging-example-gh` from both sides, with no second derivation in `packages/pds/src/nodes.ts`.
  - *Mutation evidence (re-executed here):* `githubRole: `${prefix}`` (drop `-gh`) killed the core pin **plus 9** pds tests (was 7); `githubRole: `${cfg.siteName}-gh`` (drop the environment) killed the core pin **plus 9** (was 7). The delta's preview test (`:274`, ARN contains `preview-example-gh`) and staging test (`:288`, `role === 'staging-example-gh'`) are the two extra kills, so the delta **strengthened** this pin.
  - **M9 - the CLI's blindness, verified and judged.** With `-gh` dropped from `deriveNames`, the CLI's own suite is **33/33 green** (`pnpm --filter blogwright exec vitest run nodes`) - it derives the name through `deriveNames` on both sides of every assertion, so it cannot see a rename. Verified by execution, not by inspection. **Judgment: the core pin is sufficient, and the CLI blindness is pre-existing rather than introduced.** `grep -rn -- "-gh'" packages/*/src/*.ts` over the whole repo returns only lines this task added: `packages/core/src/config.test.ts:211-212` and `packages/pds/src/nodes.test.ts:41,274,288,296`. **Before this change no literal pin on the deploy role's name existed anywhere** - the CLI's own `` `${ctx.names.prefix}-gh` `` was equally derived-through in its tests. So coverage strictly increases, and the one literal pin now sits in the module that owns the derivation, where a rename cannot land green. Recorded, not a defect.
  - *`Names` consumers:* `Names` is produced only by `deriveNames`; the sole override site is `packages/cli/src/test-support.ts:220`, `{ ...deriveNames(env, accountId, config), ...overrides.names }` over a `Partial<Names>` (`:58`). No hand-rolled `Names` literal exists in any package - re-checked against the **current bookmark head** (build 34), where task 38 had touched that same file - so a new required field cannot break a consumer.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O5 - Absent config, absent githubRepo, THE PREVIEW STACK, and un-bootstrapped site behave as specified.** *(amended 2026-08-30 - third skip condition)*
  - *Claim:* the node is skipped (not failed) when `config.pds` is absent, when `config.githubRepo` is unset, **or when the target environment is the shared preview stack**; and it fails with a message naming `blogwright bootstrap` when `githubRepo` is set but the role is absent from `siteState`. Negative-space tests for all four.
  - *Evidence to collect:* run the four negative-space tests; read their assertions; verify the discriminator.
  - *Checks:* skipped means no IAM call at all, asserted on the recording client - not merely a caught error. The preview discriminator must be `ctx.env`, not `ctx.preview`, and must not degenerate into "not production".
  - *Evidence collected:* all pass (17/17). The **three** skip tests each assert `buildPdsNodes(ctx)).toEqual([])` **and** drive `runEveryNode` (read/create/update/delete over every contributed node) before asserting `calls).toEqual([])` and `policiesOn()).toEqual([SITE_POLICY])`, so a skip that returned the node anyway would reach IAM - the empty transcript is non-vacuous. The two un-bootstrapped tests assert the throw AND `calls).toEqual([])`, so the guard is proved to land before any AWS call.
  - **The preview skip - the discriminator, verified independently.** `runPlugin` calls `makeContext({ env, configPath, domain, endpointOverride, ports })` with **no `preview` key** (`packages/cli/src/plugin-commands.ts:686-692`); `createContext` sets `preview: opts.preview ?? false` (`packages/cli/src/context.ts:185`); `toPluginContext` copies `ops.preview` (`packages/cli/src/plugin-commands.ts:317`). The only site that ever sets `preview: true` is `runPreview` (`packages/cli/src/cli.ts:547-548`), which sets it together with the hardcoded `env: 'preview'` - and `runPreview` is on the site path, never the plugin path. **So `ctx.preview` is `false` for every plugin context the CLI builds, and would be dead code as a guard.** Re-checked at the **current bookmark head** (build 34), not only at this workspace's base, because task 17 added 172 lines to `plugin-commands.ts`: unchanged there. The shipped guard is `ctx.env === PREVIEW_ENV` (`packages/pds/src/nodes.ts:196`, `PREVIEW_ENV = 'preview'` at `:67`).
  - **The preview test pins the premise (`packages/pds/src/nodes.test.ts:264-284`).** It asserts, in order: `ctx.config.pds` is defined, `ctx.config.githubRepo === 'antstanley/example'`, `ctx.siteState.resources['gh-oidc-role']?.arn` contains `preview-example-gh` (the role exists **and is bootstrapped**), and **`ctx.preview === false`**. Every other skip path and the failure path are therefore ruled out by assertion: nothing but the environment check can be what withholds the grant.
  - *Mutation evidence (all re-executed here):*

    | # | mutation | result |
    |---|---|---|
    | M1 | `ctx.env === PREVIEW_ENV` → **`ctx.preview`** | **KILLED**, exactly 1 - "contributes nothing … for the preview stack" (`:280`). The "simplification" a future reader would reach for is closed. |
    | M2 | `ctx.env === PREVIEW_ENV` → `ctx.env !== 'production'` | **KILLED**, 14 - including the named staging test (`:289`). |
    | M2b | add `|| ctx.env === 'staging'` to the guard | **KILLED**, exactly 1 - "still contributes on staging" (`:289`). Staging is pinned in isolation, not merely as collateral. |
    | M3 | drop `|| ctx.env === PREVIEW_ENV` (**the original defect**) | **KILLED**, exactly 1 - the preview test (`:280`). |

    Both directions are pinned by distinct named tests: withholding the grant from preview (M1/M3) and *not* withholding it from staging (M2/M2b).
  - **Artifact-level counterfactual (reproduced, not accepted).** With M3 applied and `blogwright-pds` rebuilt, the dist harness reports for `env=preview`: site `[]`, plugin `[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue","secretsmanager:PutSecretValue","secretsmanager:CreateSecret"],"Resource":"arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*"}]` on role `preview-example-gh` - **`IDENTICAL: false`**. Restoring the guard and rebuilding returns all three environments to `IDENTICAL: true`. The fix is proved at the artifact level in both directions.
  - *Residual, fail-closed (recorded, not a defect):* the site's boundary is `!ctx.preview` and the plugin's is `ctx.env === 'preview'`. These agree on every path the CLI produces, because `runPreview` is the only place either is set and it sets both together. The single hypothetical divergence - a *non-preview* stack an operator names literally `preview` via `blogwright bootstrap --env preview` - would have the site grant the statement while the plugin withholds it. That is the safe direction (the plugin grants strictly less), and such a stack already collides with the shared preview stack on every derived name (same `prefix`), so it is not a viable configuration regardless.
  - *Premise correction (retained from the first gate, now reflected in the contract):* `buildNodes` pushes `githubOidcRoleNode(true)` for a preview stack **unconditionally** (`packages/cli/src/nodes.ts:1138-1139`); the `githubRepo` condition governs only the non-preview branch. The node's doc comment states this correctly (`packages/pds/src/nodes.ts:163-166,170-172`).
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O6 - Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all gates pass; tests were written with the change, not after.
  - *Evidence collected:* run from the **workspace root**, all six gates green - `pnpm build` (all packages Done, exit 0); `pnpm typecheck` (exit 0); `pnpm test` (exit 0 - core 144 passed/1 skipped, build-agent 27, pds **117**, analytics 176, cli 304); `pnpm lint` (exit 0, 0 errors; the only warnings are 11 pre-existing `no-shadow` in `packages/cli/src/nodes.test.ts`, a file this task does not touch); `pnpm exec oxfmt --check .` ("All matched files use the correct format", 156 files); `pnpm knip` (exit 0, no output). Tests ship with the change in the same working copy.
  - *Changeset:* `.changeset/pds-owns-its-deploy-role-grant.md` covers `blogwright-core` and `blogwright-pds` at minor; `blogwright` is correctly absent, the CLI edit being a non-user-facing swap to an identical derived value. **The delta's correction is present and correct:** the second paragraph no longer over-claims - it now reads "byte for byte the statement the site's `<env>-deploy` policy carries **on a non-preview stack** today", which is exactly what the per-environment dist comparison proves and no longer asserts what the preview case falsifies; and a new third paragraph names **all three** skips and states explicitly that "`staging` is unaffected and still gets the grant".
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O7 - Reviewable.**
  - *Claim:* the reviewer can confirm the policy match and the untouched CLI directly.
  - *Evidence to collect:* the three commands on the task's `Reviewable:` line.
  - *Checks:* the emitted document matches the site's current statement field for field, and the CLI diff holds exactly one hunk - the role-name read.
  - *Evidence collected:* all three run as written. `pnpm --filter blogwright-pds exec vitest run nodes --reporter=verbose` - **17/17** passed. `pnpm --filter blogwright-core exec vitest run config --reporter=verbose` - **26/26** passed, including "pins the GitHub OIDC deploy role name so no existing role is renamed". `jj diff packages/cli/src/nodes.ts` - one hunk, line 884. Field-for-field match confirmed by execution against both packages' built `dist`, **per environment** (see O1).
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED

## Regression checks

- `oidcRolePolicyStatements` (`packages/cli/src/nodes.ts:963-987`) still emits its pds statement at this task → expect the existing assertions to still pass : ☑ PRESERVED (304/304 CLI tests; `packages/cli/src/nodes.test.ts` absent from the diff)
- The six pds commands (`packages/pds/src/commands.ts`) are unaffected by the new node module → ☑ PRESERVED (11 files, 117 tests)
- Pinned rkey vectors (`packages/pds/src/rkey.test.ts`) unchanged : ☑ PRESERVED (not in the diff; green)
- `packages/pds/src/config.ts` untouched, so task 27's routed `TS2345` finding is neither fixed nor worsened : ☑ PRESERVED (absent from the six-file diff; `jj diff --name-only` re-checked after the delta)
- The delta did not weaken any pre-existing assertion : ☑ PRESERVED. The fixture's only behavioural change is `siteState`'s role ARN moving from `${ROLE}` to `${names.githubRole}`; for the default `env = 'test'` those are the same string, so all 15 pre-existing tests are byte-identical in effect. Confirmed empirically: every re-run security mutation killed **at least as many** tests as at the first gate (Resource→`*` 3→4, POLICY_NAME 6→7, Effect Deny 3→4, `-gh` dropped 8→10, env dropped 8→10, delete-clobber 2→2). No kill count fell.
- No temporary artefact left behind : ☑ PRESERVED. `jj status` shows exactly the six files; `find` for probe/harness files under the workspace returns nothing; the validator's own dist harness (`packages/cli/__gate23_probe.mjs`) was deleted and the deletion proved by `jj diff --stat` returning `6 files changed, 655 insertions(+), 1 deletion(-)`.
- **Integration at the build bookmark** : ☑ PRESERVED. The bookmark has advanced to **build 34** (`a858abf`, task 41) since this workspace's base (`5efddf8`, build 30); builds 31-34 landed tasks 40, 17, 38 and 41. **A plain merge is clean:** `git merge-tree --write-tree 9d8d0cd8 a858abf` returns a single tree OID, exit 0, with no conflict messages, and `git diff --name-only 5efddf8 a858abf` has **zero overlap** with this task's six files. The merged tree was then materialised in a throwaway worktree and exercised end to end: `pnpm build` clean, `pnpm typecheck` clean, `pnpm test` green across all packages (core 149, build-agent 27, pds 117, analytics 306, cli 317). No call sequence another landed task pins is disturbed: the only CLI edit is inside a pure name-deriving lambda and adds/removes no AWS call, and `packages/core/src/config.ts`'s new field is additive on a type produced solely by `deriveNames`. Task 38's own touched files (`packages/core/src/clients.ts`, `packages/cli/src/test-support.ts`) and task 17's (`packages/cli/src/plugin-commands.ts`) were each re-inspected at head: the `Names` spread-override at `test-support.ts:220` still tolerates a new required field, and `runPlugin` at head still passes no `preview` key, so O5's dead-code finding holds against the current bookmark and not merely against this base.

## Falsifiability sweep (delta gate, independent)

The implementer ran 11 mutations on the new guard and fixture and stated plainly that it did not re-run
the 22 the first gate had already executed against unchanged parts. That scope is reasonable, so this
gate ran **10 mutations of its own**: the four that target the delta directly (M1, M2, M2b, M3) and six
sampled from the first gate's security set, re-executed to prove the delta did not weaken them (Resource
→ `*`; the delete-clobber loop; `POLICY_NAME` → `'pds'`; `Effect` → `Deny`; `-gh` dropped; env dropped).
**All 10 killed.** Every one of the two `it` blocks the delta adds was killed in isolation by a distinct
mutation (M3/M1 → the preview test; M2b → the staging test), so neither new assertion is unfalsifiable.

Both `it` blocks the delta adds were walked line by line:

1. *"contributes nothing, and calls no IAM, for the preview stack - whose role any ref can assume"*
   (`:264-284`) - four preconditions asserted before the skip is checked (pds present, githubRepo set,
   role ARN in state, **`ctx.preview === false`**), then `toEqual([])`, then a full `runEveryNode`
   lifecycle over the contributed nodes and an empty IAM transcript. The `ctx.preview` assertion is the
   one that makes M1 legible as dead code rather than a working alternative.
2. *"still contributes on staging - staging is a real stack, not the preview one"* (`:286-303`) - pins
   the derived role literally (`'staging-example-gh'`), the node id, and the single `putRolePolicy` call
   with the full `SITE_EQUIVALENT_DOCUMENT`, which is the same document on staging as on production
   because `resolvePdsSecretName` is environment-independent - the very property the security argument
   rests on.

The two survivors the first gate recorded are **untouched by the delta and still open**, repeated here
so the claim of "no survivors" is not carried forward:

1. Bypassing `resolvePdsSecretName` for a direct `pds.secretName` read - see O1's gap. Behaviour-equivalent
   today; closing it needs a fixture whose `pds` block reaches the node with `secretName` unset.
2. `dependsOn: []` → `dependsOn: ['gh-oidc-role']` survives every test, yet would make `topoSort` throw
   `node "pds-oidc-policy" depends on unknown node "gh-oidc-role"` and abort every `pds bootstrap`/`destroy`
   once the node reaches the engine. The shipped value is correct; nothing pins it. Pinned at **task 25**,
   where the node first reaches `applyGraph`.

All mutations were reverted and the restore proved three ways: SHA-256 of all six files against a
pre-mutation baseline (6/6 `OK`), `jj status` back to exactly the six expected paths, and
`jj diff --stat` back to `6 files changed, 655 insertions(+), 1 deletion(-)`. Every gate was re-run
green after the restore.

## Reviewed judgment calls

- **The preview skip discriminator - `ctx.env`, not `ctx.preview` - CORRECT.** Derived from source at the current bookmark head and confirmed by mutation (M1 kills). See O5.
- **`delete()` returning with zero IAM calls when no role ARN is recorded (`packages/pds/src/nodes.ts:181`) - SOUND** *(inherited, unchanged by the delta)*. `destroyGraph` (`packages/cli/src/graph.ts:104-118`) calls `await node.delete(ctx)` unconditionally with no try/catch, so a throw would abort the whole teardown and skip `ctx.store.delete()`. Nothing is orphaned by the silent return: `IamClient.deleteRole` strips every inline policy before deleting the role, and `assertNoScopedState` refuses `blogwright destroy` while a scoped state file exists.
- **`update` added though the Steps do not list it - CONSISTENCY, not scope creep** *(inherited, unchanged by the delta)*. `applyGraph` performs no write when `node.update` is undefined, so without it a changed `secretName` would never reach the live policy; the site's own role node re-applies the same way. A named test pins it.
- **The CLI suite's blindness to a role rename - RECORDED, NOT A DEFECT.** See O4's M9 paragraph: verified by execution (33/33 green under the mutation), and shown to be pre-existing rather than introduced, since no literal pin on the role name existed anywhere before this task.

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☑ DONE / ☐ NOT DONE
- **Gaps:** None blocking. The privilege-escalation concern the first gate raised outside the authored
  obligations is **closed**: the task contract gained the third skip condition on 2026-08-30, the
  implementation carries it as `ctx.env === PREVIEW_ENV`, and the fix is proved in both directions at
  the artifact level and by four mutations. Two non-blocking survivors remain open and are recorded
  above; the second is scheduled to be pinned at task 25, where the node first reaches the engine.
