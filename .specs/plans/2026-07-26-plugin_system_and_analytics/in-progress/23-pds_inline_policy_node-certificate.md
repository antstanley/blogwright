# Done Certificate - Task 23: pds attaches its own named inline policy to the site's deploy role

**Task:** [23-pds_inline_policy_node.md](23-pds_inline_policy_node.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 23. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 23) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright-pds` contributes one `ResourceNode` attaching a `blogwright-pds`-named inline policy to the site's GitHub-OIDC deploy role, granting Secrets Manager access to its own secret - a separately-named IAM object, so it coexists with the site's existing statement rather than replacing it, until task 59 removes that statement a release later.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's own OIDC policy document (`packages/cli/src/nodes.ts:863`), the six pds commands, or the pinned rkey vectors. The only permitted edit under `packages/cli/` is `githubOidcRoleNode` reading `ctx.names.githubRole` at `packages/cli/src/nodes.ts:826`.


## Obligations

- **O1 - The node exists and its policy is byte-identical to today's.**
  - *Claim:* `blogwright-pds` exports one resource node attaching a `blogwright-pds`-named inline policy to the site's OIDC role, and its document matches the statement `oidcRolePolicyStatements` produces today. The node is not yet reachable from the CLI - task 25 declares the `nodes(ctx)` member that returns it - so this obligation is discharged against the node's own tests.
  - *Evidence to collect:* read `packages/pds/src/nodes.ts`; run `pnpm --filter blogwright-pds test -- nodes`; diff the emitted policy document field by field against `packages/cli/src/nodes.ts:913-927` and the expectation at `packages/cli/src/nodes.test.ts:194-208`.
  - *Checks:* the three actions are exactly `secretsmanager:GetSecretValue`, `PutSecretValue`, `CreateSecret`; the Resource is `arn:aws:secretsmanager:<region>:<account>:secret:<name>-*` with the name from task 21's resolver, not from `config.pds.secretName` directly.
  - *Evidence collected:* `buildPdsNodes` (`packages/pds/src/nodes.ts:166-170`) returns exactly `['pds-oidc-policy']`. 15/15 tests green in `packages/pds/src/nodes.test.ts`. Byte-identity was verified **against the built `dist` of both packages**, not against source literals: a harness importing `oidcRolePolicyStatements` from `packages/cli/dist/nodes.js` and `buildPdsNodes` from `packages/pds/dist/nodes.js` over one `deriveNames('production', '123456789012', …)` produced, from both sides, the identical string
    `{"Effect":"Allow","Action":["secretsmanager:GetSecretValue","secretsmanager:PutSecretValue","secretsmanager:CreateSecret"],"Resource":"arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*"}`
    (`BYTE-IDENTICAL: true`), with `putRolePolicy` targeting `production-example-gh` under policy name `blogwright-pds`, and the plugin's `Statement` array of length 1. The name reaches the ARN through `resolvePdsSecretName(pds, ctx.config.siteName)` (`packages/pds/src/nodes.ts:169`), not a direct read.
  - *Mutation evidence:* `Resource` → `'*'` killed 3 named tests including "writes a blogwright-pds inline policy byte-identical to the site's statement today"; dropping `secretsmanager:CreateSecret` killed 3; `Version: '2012-10-17'` → `'2008-10-17'` killed 3; `Effect: 'Allow'` → `'Deny'` killed 3.
  - *Gap (recorded, not blocking):* replacing `resolvePdsSecretName(pds, …)` with a direct `pds.secretName` read **survives all 15 tests**. It is behaviour-equivalent today because core's `PdsConfig.secretName` is still required and `mergeConfig` always fills it, so no fixture can reach the resolver's `?? defaultSecretName` branch. The source satisfies the check; no executable test distinguishes it. Closing it needs a fixture whose `pds` block reaches the node with `secretName` unset.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O2 - Additive only - the site's own policy is never touched.**
  - *Claim:* the node calls `putRolePolicy` with policy name `blogwright-pds` and touches no other policy name.
  - *Evidence to collect:* read the recording-IAM-client test; confirm it asserts the policy name and that no other `putRolePolicy`/`deleteRolePolicy` call is made.
  - *Checks:* `read()` uses `listRolePolicies` and `delete()` uses `deleteRolePolicy`, both scoped to the `blogwright-pds` name.
  - *Evidence collected:* the fixture records every IAM call in one ordered array and models live policy state, so "no other policy name was touched" is asserted over the whole transcript (`calls.map((call) => call.policyName)).toEqual(['blogwright-pds'])`) and over the role's resulting policy list (`policiesOn()).toEqual([SITE_POLICY, 'blogwright-pds'])`). `read()` calls only `listRolePolicies`; `delete()` lists, then deletes only `POLICY_NAME`.
  - *Mutation evidence:* **the clobber defect** - rewriting `delete` to loop `for (const name of await listRolePolicies(roleName)) deleteRolePolicy(roleName, name)` - killed "removes only its own named policy, leaving the site's document on the role" and "deletes nothing when its grant is already gone". `POLICY_NAME` → `'pds'` killed 6 tests; the 3 survivors are exactly the name-independent ones. Dropping delete's presence guard killed 2 (the ordered transcript catches the missing `listRolePolicies`, not just the extra delete). Pointing `delete` at `ctx.names.execRole` killed 2.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O3 - The site's Secrets Manager statement is untouched by this task.**
  - *Claim:* `packages/cli/src/nodes.ts:913-927` is unchanged; the only edit to that file is `githubOidcRoleNode` reading `ctx.names.githubRole` at `:826`. The site's statement stays until task 59.
  - *Evidence to collect:* run `jj diff packages/cli/src/nodes.ts` and read every hunk - expect exactly one, at the role-name derivation.
  - *Checks:* if the `if (ctx.config.pds)` statement changed, the additive-first ordering has been broken and every deployed stack loses the grant at its next `blogwright bootstrap` - `applyOidcRole` rewrites the whole `<env>-deploy` document (`packages/cli/src/nodes.ts:840-842,962`), so the statement is not merely stale, it is gone; mark UNSATISFIED.
  - *Evidence collected:* `jj diff packages/cli/src/nodes.ts` shows exactly one hunk, one line, at `:884`: `` `${ctx.names.prefix}-gh` `` → `ctx.names.githubRole`. `jj diff --stat` reports `packages/cli/src/nodes.ts | 2 +-`. The edit is inside a pure name-deriving lambda: no AWS call is added or removed, so none of `nodes.test.ts`'s ordered call-sequence pins is disturbed - and `packages/cli/src/nodes.test.ts` does not appear in the diff at all, so no expected sequence was edited. All 304 CLI tests pass unchanged, including the `oidcRolePolicyStatements` assertions at `:288-301`.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED

- **O4 - The deploy role's name has one home.**
  - *Claim:* `deriveNames` returns `githubRole` as `<env>-<siteName>-gh`, `githubOidcRoleNode` reads it rather than deriving it at `packages/cli/src/nodes.ts:826`, and the derived value is unchanged so no existing role is renamed.
  - *Evidence to collect:* read `Names` (`packages/core/src/config.ts:333-345`) and `deriveNames` (`:360-372`); run `pnpm test -- config` in `packages/core` and confirm a case pins the derived value; run `grep -n 'prefix}-gh' packages/cli/src/nodes.ts` and expect no output.
  - *Checks:* resolve what the plugin's node passes to `putRolePolicy` - confirm it is `ctx.names.githubRole` and not a second derivation, since the whole point is that a derived AWS name has exactly one owner (DEVELOPMENT.md §Limits and bounds).
  - *Evidence collected:* `Names.githubRole` added (`packages/core/src/config.ts:374`), `deriveNames` returns `` `${prefix}-gh` `` where `prefix = `${env}-${cfg.siteName}`` (`:402`, `:390`), so `prefix` carries the environment. `grep -n 'prefix}-gh' packages/cli/src/nodes.ts` returns nothing (exit 1). The pin `deriveNames('production'…).githubRole === 'production-example-gh'` and `deriveNames('staging'…) === 'staging-example-gh'` passes (26/26 core config tests). The plugin passes `ctx.names.githubRole` - the dist harness shows `putRolePolicy` targeting `production-example-gh` and `names.githubRole === 'production-example-gh'`, the same string from both sides, with no second derivation in `packages/pds/src/nodes.ts`.
  - *Mutation evidence:* dropping the `-gh` suffix (`githubRole: `${prefix}``) killed the core pin plus 7 pds tests; dropping the environment (`githubRole: `${cfg.siteName}-gh``) killed the core pin plus 7 pds tests. Both halves are pinned. Note for the record: neither mutation moved the CLI suite (304/304 still green), so the role name's only executable pin now lives in `packages/core/src/config.test.ts` - which is exactly where this task placed it.
  - *`Names` consumers:* `Names` is produced only by `deriveNames`; the sole override site is `packages/cli/src/test-support.ts:216`, `{ ...deriveNames(env, accountId, config), ...overrides.names }` over a `Partial<Names>` (`:58`). No hand-rolled `Names` literal exists in any package, so a new required field cannot break a consumer.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O5 - Absent config, absent githubRepo and un-bootstrapped site behave as specified.**
  - *Claim:* the node is skipped (not failed) when `config.pds` is absent or `config.githubRepo` is unset - the latter because the site graph only adds `githubOidcRoleNode` when `githubRepo` is set (`packages/cli/src/nodes.ts:1082`), so a site without CI deploys has no role to attach to and is nonetheless fully bootstrapped - and fails with a message naming `blogwright bootstrap` when `githubRepo` is set but the role is absent from `siteState`.
  - *Evidence to collect:* run the three negative-space tests; read their assertions.
  - *Checks:* skipped means no IAM call at all, asserted on the recording client - not merely a caught error.
  - *Evidence collected:* all three pass. The two skip tests assert `buildPdsNodes(ctx)).toEqual([])` **and** drive `runEveryNode` (read/create/update/delete over every contributed node) before asserting `calls).toEqual([])` and `policiesOn()).toEqual([SITE_POLICY])`, so a skip that returned the node anyway would reach IAM - the empty transcript is non-vacuous. The two un-bootstrapped tests assert the throw AND `calls).toEqual([])`, so the guard is proved to land before any AWS call, never on the message alone.
  - *Mutation evidence:* removing the `!ctx.config.githubRepo` skip killed exactly its test; removing the `!pds` skip (returning the node anyway) killed exactly its test; removing `requireRoleName`'s throw killed both un-bootstrapped tests; shortening the message to drop `--env ${ctx.env}` killed both.
  - *Premise correction (recorded):* the parenthetical "the site graph only adds `githubOidcRoleNode` when `githubRepo` is set (`packages/cli/src/nodes.ts:1082`)" holds only for the **non-preview** branch. `buildNodes` (`packages/cli/src/nodes.ts:1138-1139`) pushes `githubOidcRoleNode(true)` for a preview stack unconditionally. The obligation as written is met by the implementation; the specification behind it is incomplete about the preview stack, which is where the correctness concern below sits.
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O6 - Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass; tests were written with the change, not after.
  - *Evidence collected:* run from the workspace root, all six gates green - `pnpm build` (all packages Done, 0 errors); `pnpm typecheck` (exit 0); `pnpm test` (core 144 passed/1 skipped, build-agent 27, pds 115, analytics 176, cli 304); `pnpm lint` (exit 0, 0 errors; the only warnings are pre-existing `no-shadow` in `packages/cli/src/nodes.test.ts`, a file this task does not touch); `pnpm exec oxfmt --check .` ("All matched files use the correct format", 156 files); `pnpm knip` (exit 0, no output). Tests ship with the change in the same working copy. A changeset exists (`.changeset/pds-owns-its-deploy-role-grant.md`) covering `blogwright-core` and `blogwright-pds` at minor; `blogwright` is correctly absent, the CLI edit being a non-user-facing swap to an identical derived value (DEVELOPMENT.md:320 requires a changeset for a user-facing change).
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED
- **O7 - Reviewable.**
  - *Claim:* the reviewer can confirm the policy match and the untouched CLI directly.
  - *Evidence to collect:* run `pnpm --filter blogwright-pds test -- nodes`; run `jj diff packages/cli/src/nodes.ts`.
  - *Checks:* the emitted document matches the site's current statement field for field, and the CLI diff holds exactly one hunk - the role-name read at `:826`.
  - *Evidence collected:* the three commands in the task's `Reviewable:` line were run as written. `pnpm --filter blogwright-pds exec vitest run nodes --reporter=verbose` - 15/15 passed. `pnpm --filter blogwright-core exec vitest run config --reporter=verbose` - 26/26 passed, including "pins the GitHub OIDC deploy role name so no existing role is renamed". `jj diff packages/cli/src/nodes.ts` - one hunk, line 884. Field-for-field match confirmed by execution against both packages' built `dist` (see O1).
  - *Status:* ☑ SATISFIED / ☐ UNSATISFIED

## Regression checks

- `oidcRolePolicyStatements` (`packages/cli/src/nodes.ts:863`) still emits its pds statement at this task → expect the existing assertion at `packages/cli/src/nodes.test.ts:194-208` to still pass : ☑ PRESERVED (`packages/cli/src/nodes.test.ts:288-301` green; 304/304 CLI tests)
- The six pds commands (`packages/pds/src/commands.ts`) are unaffected by the new node module → expect `pnpm --filter blogwright-pds test` green : ☑ PRESERVED (11 files, 115 tests)
- Pinned rkey vectors (`packages/pds/src/rkey.test.ts`) unchanged : ☑ PRESERVED (not in the diff; green)
- `packages/pds/src/config.ts` untouched, so task 27's routed `TS2345` finding is neither fixed nor worsened : ☑ PRESERVED (absent from the six-file diff)
- Integration at the build bookmark (build 32, `plugin-system-and-analytics`) : ☑ PRESERVED. `git merge-tree --write-tree` over base build 30 returns a clean tree, exit 0, no conflicted paths - builds 31 and 32 touch none of this task's six files. The merged tree was then materialised and exercised: `pnpm build` clean, `pnpm test` green across all packages (core 144, build-agent 27, pds 115, analytics 222, cli 317).

## Falsifiability sweep (validator, independent)

22 mutations run against the shipped tests, sampled adversarially rather than from the implementer's table. **20 killed, 2 survivors.** Every one of the 16 new `it` blocks (15 in `packages/pds/src/nodes.test.ts`, 1 in `packages/core/src/config.test.ts`) was killed by at least one mutation, so no assertion in this change is unfalsifiable. Assertions are made on the ordered recording IAM client and on live policy state, never on a message alone; the two throwing tests assert the message **and** an empty transcript.

Survivors, both non-defects in the shipped code, recorded so the claim of "no survivors" is not carried forward:

1. Bypassing `resolvePdsSecretName` for a direct `pds.secretName` read - see O1's gap.
2. `dependsOn: []` → `dependsOn: ['gh-oidc-role']` survives all 15 tests, yet would make `topoSort` throw `node "pds-oidc-policy" depends on unknown node "gh-oidc-role"` and abort every `pds bootstrap`/`destroy` once the node reaches the engine. The shipped value is correct; nothing pins it. A `topoSort(buildPdsNodes(ctx))` assertion closes it - naturally at task 25, where the node first reaches `applyGraph`.

All mutations were reverted and the restore proved by SHA-256 against a pre-mutation baseline of all five source files, by `jj diff --stat` (6 files, 569 insertions, 1 deletion), and by a clean re-run of every gate.

## Reviewed judgment calls

- **`delete()` returning with zero IAM calls when no role ARN is recorded (`packages/pds/src/nodes.ts:136`) - SOUND.** The claim about the engine was checked, not accepted: `destroyGraph` (`packages/cli/src/graph.ts:104-118`) calls `await node.delete(ctx)` unconditionally for every node, with no try/catch, so a throw aborts the whole teardown and skips both the remaining nodes and `ctx.store.delete()`. The apply path's message would be unactionable there: teardown reaches `delete` precisely when the site is already gone, and "run `blogwright bootstrap`" would tell an operator to rebuild the site in order to tear down a plugin. Nothing is orphaned by the silent return: `IamClient.deleteRole` (`packages/core/src/aws/iam.ts:126-135`) removes every inline policy before deleting the role, so the site's own destroy sweeps this document away; and `commands.ts`'s `assertNoScopedState` refuses `blogwright destroy` while a `state/<env>.<plugin>.json` exists, steering the operator to `pds destroy` first, where the role is still present and the normal path runs. The asymmetry with the apply path is justified and the comment says why.
- **`update` added though the Steps do not list it - CONSISTENCY, not scope creep.** `applyGraph` (`packages/cli/src/graph.ts:76-83`) logs `${node.title} (exists)` and performs no write when `node.update` is undefined, so without it a changed `secretName` would never reach the live policy. The site's own role node does re-apply: `githubOidcRoleNode.update` calls `applyOidcRole(ctx, roleName(ctx))`, the same function as `create` (`packages/cli/src/nodes.ts:895-900`). The plugin now matches. A named test pins it, and removing `update` kills exactly that test.

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☑ DONE-as-authored, pending the correctness decision below
- **Gaps:** No obligation is UNSATISFIED and no regression check failed. One correctness concern sits **outside** the authored obligations and must be decided before task 25 makes this node reachable, because resolving it will change `packages/pds/src/nodes.ts` and its tests and so require O1/O5/O6/O7 evidence to be re-collected:

  **The node grants the preview deploy role a privilege the site deliberately withholds from it.** `buildPdsNodes` skips only on `!pds` and `!githubRepo`, so `blogwright pds bootstrap --env preview` on a site with `githubRepo` set attaches `blogwright-pds` to `preview-example-gh`. Verified by execution against both packages' built `dist`: `putRolePolicy('preview-example-gh', 'blogwright-pds', …)` granting `GetSecretValue`/`PutSecretValue`/`CreateSecret` on `arn:aws:secretsmanager:us-east-1:…:secret:example/atproto-*`, while `oidcRolePolicyStatements` for that same stack returns **no secretsmanager action at all**.

  The site's `if (!ctx.preview)` is a deliberate privilege boundary, not an incidental one, on four independent pieces of evidence: (a) a named test pins it - `packages/cli/src/nodes.test.ts:263-266`, "keeps the preview statement set unchanged (no invalidation, no secret)", asserted with `pds: true` so it is the *preview* flag doing the withholding; (b) `githubOidcRoleNode`'s own doc comment (`packages/cli/src/nodes.ts:878-882`) enumerates the difference in words - previews "deploy/destroy previews", production additionally gets "CloudFront invalidation and read access to the PDS credentials secret"; (c) the trust policies are asymmetric by design - `oidcSubClaim` gives preview `repo:<owner>/<repo>:*` (**any ref**) against production's release-gated `repo:<owner>/<repo>:environment:production`; (d) the secret is environment-independent (`resolvePdsSecretName` → `<siteName>/atproto`), so there is one PDS credential for the whole site. The consequence of crossing it: anyone who can push a branch could assume the preview role and read and rotate the site's ATProto OAuth session - full control of the publishing identity. The exec role the preview role may `PassRole` carries no secretsmanager grant (`applyExecRolePolicy`, `packages/cli/src/nodes.ts:183-219`), so this boundary is today the only thing standing in the way. `staging` is unaffected: it is non-preview, and the site already grants it the same statement.

  This also falsifies the change's own stated invariant for one environment. The changeset says the node carries "the grant the site's `<env>-deploy` policy carries today"; the byte-identity test proves that only for a production context. For `--env preview` the node grants strictly more than the site does, and task 59's removal of the site statement will leave this node as the sole owner of the distinction, expressed nowhere.

  *Note for whoever fixes it:* `ctx.preview` is **not** the discriminator. `runPlugin` builds its context with `makeContext({ env, … })` and no preview flag (`packages/cli/src/plugin-commands.ts:677-683`), `createContext` defaults `preview: opts.preview ?? false` (`packages/cli/src/context.ts:185`), and `toPluginContext` copies it through (`:308`), so `ctx.preview` is `false` for **every** plugin context the CLI builds today - a `ctx.preview` skip would be both dead code and ineffective. The preview stack is identified by `ctx.env === 'preview'` (`packages/cli/src/cli.ts:526`, where `runPreview` hardcodes it). Either add that as the third skip condition with a comment pointing at the site's `!ctx.preview` branch, or decide deliberately - with a spec amendment and an edit to `packages/cli/src/nodes.test.ts:263-266` - that the preview role should carry the grant.
