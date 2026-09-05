> Historical evidence only; the active certificate was re-authored for the resumed build.

# Done Certificate - Task 59: Remove the pds branch from the site's OIDC policy

**Task:** 59-cli_drop_pds_from_site_graph.md (historical task identity)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 59. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 59) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The CLI's resource graph carries no pds knowledge - no `config.pds` branch, no secret-name interpolation, and no inline `<siteName>/atproto` default - with the grant owned entirely by the plugin's node from task 23, and the pds spec's `Status:` flip deferred once more to task 60, which lands its true last outstanding block (§`bootstrap` warns while plugin state exists).
- **P2 - Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the rest of the OIDC policy document, the post-deploy pds sync, or `blogwright-pds` remaining a non-optional CLI dependency. Must not land before task 23, and must not ship in the same *release* as task 30.

## Validation environment

Workspace `/Users/ant/code/blogwright-task-59` (jj), working copy `zpstzynv ed1e1864`, parent
`tvmyyxwv 40177c14` (build 53/62, task 27). Diff is exactly seven paths; no `package.json`,
lockfile, tsconfig or `.changeset/config.json` change, so **no pin moved**.

Baseline `jj diff --git` digest `sha256:3c9fe72e878205c088161c3d1e8292529312d10669623c9a6c026f9d73acad28`.
Every mutation below was applied to the working tree, observed, and reverted; the digest was
recomputed after each revert and matched the baseline byte for byte (final check after the last
revert: identical, and `jj status` still lists the same seven paths).

## Obligations

- **O1 - No pds statement for any input.**
  - *Claim:* `oidcRolePolicyStatements` contains no `config.pds` reference, no `atproto` default and no `secretsmanager` statement even for a context that HAS a pds block.
  - *Evidence collected:* `packages/cli/src/nodes.ts:924-978` - the function now ends at the `cloudfront:CreateInvalidation` push inside `if (!ctx.preview)`; the `if (ctx.config.pds)` block and its ARN interpolation are gone. The replacement test is `packages/cli/src/nodes.test.ts:305-322`, *"is blind to config.pds - a configured site gets the statements of an unconfigured one"*, which builds a **production** context WITH a `pds` block (both shapes: explicit `secretName`, and `{ name: 'x' }`) and deep-equals the result against the unconfigured output. `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` → 33 passed, the named test among them.
  - *Checks:* the fixture is `ctx({ preview: false, pds })`, i.e. pds present - not the vacuous absent-pds case. Non-vacuity proven by three independent mutations, each run from the workspace root and each reverted:
    - **M1** - the deleted branch re-added *verbatim* (`?? \`${ctx.config.siteName}/atproto\`` included) → FAIL `is blind to config.pds`, `expected [ …(3) ] to deeply equal []` listing `secretsmanager:GetSecretValue/PutSecretValue/CreateSecret` at `nodes.test.ts:319`. 1 failed | 32 passed.
    - **M2** - the same branch with the `??` default stripped, so the ARN would interpolate `undefined` → FAIL, same test, same assertion. An `undefined` residue cannot hide.
    - **M-reorder** - `if (ctx.config.pds) statements.reverse();`, which emits **no** secretsmanager action at all → FAIL on the *second* assertion, `expected [ { Effect: 'Allow', …(2) }, …(6) ] to deeply equal [ … ]`, diffing `sts:GetCallerIdentity` against `cloudfront:CreateInvalidation`. This is the reordering case the test's own comment claims, and it holds: the deep equality, not the `secretsmanager:` filter, is what makes the assertion total.
  - *Status:* ☑ SATISFIED
- **O2 - No pds knowledge left in the site graph.**
  - *Claim:* `grep -nE "pds|atproto" packages/cli/src/nodes.ts` returns zero hits, closing the gap task 29's `cli.ts`-only gate left open and retiring task 27's deliberate duplication.
  - *Evidence collected:* `grep -nE "pds|atproto" packages/cli/src/nodes.ts` → no output, exit 1. The wider sweep `grep -niE "pds|atproto|secretsmanager|secret" packages/cli/src/nodes.ts` is **also** empty, so not even a case-variant or a bare `secret` survives. The doc comment is now `packages/cli/src/nodes.ts:878-888`: the parenthetical reads "(preview stack, any ref) or to deploy production (main branch only, plus CloudFront invalidation)" - the "read access to the PDS credentials secret" clause is gone, replaced by a paragraph stating that the role carries the site's own grants only and that a plugin attaches its own **named** inline policy from its own graph.
  - *Checks:* zero hits includes comments and includes `atproto` - both verified. The replacement comment's load-bearing claim was checked against code rather than accepted: `applyOidcRole` writes `putRolePolicy(roleName, \`${ctx.env}-deploy\`, …)` (`packages/cli/src/nodes.ts:1011`) and `IamClient.putRolePolicy` issues `PutRolePolicy` with that `PolicyName` (`packages/core/src/aws/iam.ts:84-91`), so a wholesale rewrite of `<env>-deploy` genuinely cannot disturb `blogwright-pds`.
  - *Status:* ☑ SATISFIED
- **O3 - The grant is preserved end to end.**
  - *Claim:* with the pds plugin bootstrapped, the site role carries a `blogwright-pds` inline policy whose document matches what the site used to emit.
  - *Evidence collected:* task 23's frozen literal `SITE_SECRET_STATEMENT` (`packages/pds/src/nodes.test.ts:213-221`) - the three actions in order plus `arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*` - and `SITE_EQUIVALENT_DOCUMENT`, asserted by *"writes a blogwright-pds inline policy byte-identical to the statement the site used to emit"*. It matches the producing code: `policyDocument` (`packages/pds/src/nodes.ts:82-92`) emits `SECRET_ACTIONS` and `arn:aws:secretsmanager:${ctx.config.region}:${ctx.accountId}:secret:${secretName}-*`. The explicit-`secretName` path is guarded separately by *"scopes the ARN to the block's own secretName, not to the derived default"* (`nodes.test.ts:333-337`); the derived default by `resolvePdsSecretName` (`packages/pds/src/config.ts:73-75`) and `packages/pds/src/config.test.ts:83-85`. Both deleted cli tests are gone (`packages/cli/src/nodes.test.ts`, `-64/+…`), not duplicated.
  - *Checks:* the deletion is **obsolescence, not inconvenience** - proven, not argued. Re-adding both deleted tests verbatim against the current code (**M0**) makes them fail with `TypeError: Cannot read properties of undefined (reading 'Action')` and `(reading 'Resource')`: `statements.find(...)` returns `undefined` because no secretsmanager statement exists for any input, so neither test is satisfiable in its old location. Reverted; digest restored.
    The properties they guarded survive independently on the plugin side, each with its own falsification:
    - **M3a** - explicit operand dropped (`resolvePdsSecretName` → `defaultSecretName(siteName)`) → 8 pds failures, including `config.test.ts > resolvePdsSecretName > keeps an explicit secretName instead of the default` and `nodes.test.ts > scopes the ARN to the block's own secretName`.
    - **M3b** - `??` default dropped (`return pds.secretName as string`) → 8 pds failures, including `nodes.test.ts > still contributes on staging` and `nodes.test.ts > writes a blogwright-pds inline policy byte-identical to …`, both carrying task 27's exact signature `"Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:undefined-*"` (2 occurrences in the transcript).
    Both reverted; digest restored. **Note:** the implementer's table claims *3* failures for each of M3a/M3b; the observed count is *8* each. The named guards are inside that set and the `undefined-*` signature is present, so this is a bookkeeping inaccuracy in the table, not a coverage gap - but it is why the table was not accepted.
    Task 23 is complete and in `done/`, so the ordering precondition holds.
  - *Status:* ☑ SATISFIED
- **O4 - knip clean and the upgrade note written, with the right mechanism.**
  - *Claim:* `pnpm knip` passes and a changeset records the upgrade note.
  - *Evidence collected:* `pnpm knip` → exit 0, no findings. `grep -c blogwright-pds packages/cli/src/nodes.ts` → `0`. The change description states plainly that nothing was imported from `blogwright-pds` to replace the branch and that the grep was already `0` before - consistent with the diff, which adds no import to `nodes.ts`. The changeset is `.changeset/cli-site-graph-drops-pds.md` (`"blogwright": minor`; core and pds are comment-only here, so no bump is owed).
  - *Checks:* the mechanism is stated correctly and verified against code, not accepted on its word. The changeset says: *"What is removed is a `statement inside` the role's `<env>-deploy` document, not a policy of its own, and `applyOidcRole` rewrites that whole document on every `blogwright bootstrap`, create and update alike. So on an upgraded stack the grant survives until the next site bootstrap … and not until the operator acts."* Confirmed at `packages/cli/src/nodes.ts:1011` (single `putRolePolicy` on `<env>-deploy`) with `create` and `update` both routed through `applyOidcRole` (`:894-899`). The instruction is the required direction - *"run `blogwright pds bootstrap` once per environment, before your next `blogwright bootstrap`"* - not the wrong one. The degradation description is exact: the quoted warning `pds sync failed (deploy unaffected): <error>` is verbatim `packages/pds/src/commands.ts:221`, and it is inside a `catch` that does not rethrow, so the deploy is genuinely unaffected. The claim that the preview role is byte-identical holds - the deleted branch sat inside `if (!ctx.preview)`, and *"keeps the preview statement set unchanged (no invalidation, no secret)"* still passes. `docs/src/content/docs/guides/ci-github-oidc.md:61` is corrected in the same direction and is accurate.
  - *Status:* ☑ SATISFIED
- **O5 - Ships in a later release than task 30.**
  - *Claim:* the release carrying task 30 is out before this task lands, and the change description says so.
  - *Evidence collected:* the change description **does** say so, in a dedicated "Release ordering" paragraph, and the changeset opens its upgrade section with the constraint in bold: *"**This must not ship in the same release as the pds-to-plugin migration.**"* That half is discharged. The other half is not. **Task 30 is in `backlog/`** (`30-pds_migration_closure.md`, deps 28 - in flight - and 29), so task 30's changeset does not exist. No release has been cut in this build: `.changeset/` holds **19 unconsumed changesets**, and the newest entry in `packages/cli/CHANGELOG.md` is `0.3.3` from PR #13, which predates the plan.
  - *Checks:* the obligation's own check is unambiguous - *"If task 30 is unreleased, this task is blocked, not merely early."* It is unreleased and unimplemented. The consequence is concrete rather than formal: once task 30's changeset lands on this same branch, `changeset version` consumes the whole `.changeset/` directory into one release, so task 30's migration note and task 59's grant removal ship **together** unless a human deliberately holds `.changeset/cli-site-graph-drops-pds.md` back, cuts the migration release, and restores it. Nothing in the repo enforces that split, and merging task 59 before task 30 exists means the window has to be re-created by hand rather than simply used. Every stack whose operator deploys before reading the notes then loses the deploy role's Secrets Manager grant at its next `blogwright bootstrap` - exactly the failure the additive-first rule exists to prevent. This is a release-management gap, not a defect in the diff: no edit to these seven files can discharge it.
  - *Status:* ☐ SATISFIED / ☑ UNSATISFIED
- **O6 - The pds change spec is correctly NOT merged, with the deferral recorded.**
  - *Claim:* the spec's `Status:` still reads `Proposed`, the file still lives at `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md`, its entry is still in `.specs/README.md`'s pending list, and the change description records the deferral naming task 60.
  - *Evidence collected:* `.specs/` is untouched by the diff (seven paths, none under `.specs/`). `ls .specs/changes` shows the file in place beside `merged/`, and it is **not** in `merged/`. Its header reads `**Status:** Proposed · **Date:** 2026-07-26 · …`. `.specs/README.md:34` still lists it as pending item 2 of three. The change description's "Spec bookkeeping" paragraph states that merge-plan steps 4 and 5 are deliberately not executed, names task 60 as the owner of the `Status:` flip, the move to `merged/` and the README update, and gives the reason (§`bootstrap` warns while plugin state exists is still outstanding; a spec is not merged while one of its `Proposed changes` blocks is), citing the 20/58 precedent.
  - *Checks:* no premature flip, no premature move. Verified in the direction the check names.
  - *Status:* ☑ SATISFIED
- **O7 - Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence collected:* all **six** gates run from the workspace root in `.github/workflows/ci.yml` order, on the unmutated tree: `pnpm build` 0 · `pnpm typecheck` 0 · `pnpm test` 0 (core 149 passed/1 skipped, build-agent 27, pds 146, analytics 701, cli 363) · `pnpm lint` 0 · `pnpm exec oxfmt --check .` 0 (201 files) · `pnpm knip` 0. `lint` emits only the pre-existing `no-shadow` warnings on `ctx` in `packages/cli/src/nodes.test.ts`, none of them on a line this diff wrote.
  - *Checks:* all gates pass. Behaviour is covered positively and negatively; a changeset ships. `packages/pds/src/nodes.ts` was verified **comment-only** mechanically - every changed line in its two hunks begins with ` *` (0 non-comment changed lines), so task 23's three skip conditions and its `ctx.env === PREVIEW_ENV` discriminator are textually untouched. `packages/pds/src/nodes.test.ts` changes are comments plus one `it(...)` title; no assertion moved.
  - *Status:* ☑ SATISFIED
- **O8 - Reviewable.**
  - *Claim:* the reviewer can confirm the removal, the preserved grant and the recorded deferral directly.
  - *Evidence collected:* the `Reviewable:` line run verbatim - `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` → exit 0, 1 file, 33 passed, including `✓ oidcRolePolicyStatements > is blind to config.pds - a configured site gets the statements of an unconfigured one`; `pnpm knip` → exit 0. `grep -nE "pds|atproto" packages/cli/src/nodes.ts` → empty. The pds spec header reads `Status: Proposed`; the change description carries the deferral naming task 60. Every relative link in `.specs/README.md` was resolved against the filesystem: **0 broken**.
  - *Checks:* all four sub-claims hold as stated.
  - *Status:* ☑ SATISFIED

## Regression checks

- Every non-pds statement in the OIDC policy (s3, lambda MicroVM actions, logs, iam:PassRole, cloudfront:CreateInvalidation) is unchanged → the remaining OIDC assertions in `nodes.test.ts` pass untouched (*"keeps the preview statement set unchanged"*, *"lets the deploy role rebuild the builder image"*, *"grants production invalidation on the distribution ARN"*), and the new test's deep equality pins the whole list : ☑ PRESERVED
- `blogwright deploy` for a production env with a pds block still runs the post-deploy sync → `import { syncAfterDeploy } from 'blogwright-pds'` (`packages/cli/src/commands.ts:26`), called at `:240`; both untouched : ☑ PRESERVED
- On a stack whose operator ran `blogwright pds bootstrap` in the previous release, the next `blogwright bootstrap` rewrites `<env>-deploy` without the secretsmanager statement while `blogwright-pds` stands → `PutRolePolicy` is per-`PolicyName` (`packages/core/src/aws/iam.ts:84-91`) and the plugin's document is written under `POLICY_NAME = 'blogwright-pds'` (`packages/pds/src/nodes.ts:50`), a separate IAM object : ☑ PRESERVED
- On a stack whose operator did NOT, the same bootstrap leaves no grant → the sync's failure path warns without rethrowing (`packages/pds/src/commands.ts:217-222`), and `pds bootstrap` re-puts the document (`applyPolicy`, `packages/pds/src/nodes.ts:118-124`) : ☑ PRESERVED
- `packages/cli/package.json:28` still lists `blogwright-pds` as a non-optional dependency : ☑ PRESERVED
- *(added by this gate)* Task 23's preview privilege boundary is intact → **M4** (`ctx.env === PREVIEW_ENV` → `ctx.preview`) makes exactly one test fail, *"contributes nothing, and calls no IAM, for the preview stack - whose role any ref can assume"*, at `nodes.test.ts:286` with `expected [ { id: 'pds-oidc-policy', …(6) } ] to deeply equal []`; the `expect(ctx.preview).toBe(false)` assertion two lines above still passes, which is what proves `ctx.preview` is dead code as a discriminator. Reverted; digest restored : ☑ PRESERVED
- *(added by this gate)* `packages/core/src/config.ts` is comment-only and its **replacement reason is true**, not merely different: `OpsConfig.pds` is a declared member at `packages/core/src/config.ts:133`, and the plugin reads the block through `ctx.config.pds` at `packages/pds/src/nodes.ts:216` (`buildPdsNodes`) : ☑ PRESERVED
- *(added by this gate)* Integration with task 28 (in flight, `wzuqozkx eb8ba726`): both commits share the parent `40177c14`, and their path sets are **disjoint** - task 28 touches `.changeset/pds-config-validation-timing.md`, `packages/cli/src/cli.test.ts`, `packages/cli/src/context.test.ts`, `packages/pds/src/config.{ts,test.ts}`, `packages/pds/src/sync.ts`; task 59 touches none of them. Both touch `packages/pds/`, but different files. `git merge-tree --write-tree --messages ed1e1864 eb8ba726` → exit 0, tree `c3ec018f`, no conflict messages. Semantically clean too: task 28 adds an absent/`null` guard to `validatePdsConfig` and shares `NO_PDS_SECTION_MESSAGE`, leaving `resolvePdsSecretName` and `defaultSecretName` - the functions this task's coverage depends on - unchanged : ☑ PRESERVED
- *(added by this gate)* The `packages/analytics/src/nodes.ts` citation drift is **not caused by this task**: this diff's only hunks in `packages/cli/src/nodes.ts` start at lines 878 and 968, while every one of the 11 `cli/src/nodes.ts:<line>` citations in `packages/analytics/src/nodes.ts` points at 830 or below. Confirmed directly rather than by arithmetic: `packages/cli/src/nodes.ts` lines 710-722 and 826-834 are **byte-identical** between the working copy and the parent `@-`, so both spot-checked citations were already drifted before this task ran : ☑ PRESERVED (finding confirmed, drift pre-existing)

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☑ NOT DONE
- **Gaps:**
  - **O5 UNSATISFIED - the release seam is open.** Task 30 is unimplemented (`backlog/30-pds_migration_closure.md`) and no release has been cut in this build; `.changeset/` holds 19 unconsumed changesets and `packages/cli/CHANGELOG.md` tops out at `0.3.3` from PR #13. The obligation's own check makes this blocking rather than early. The diff discharges the half it can - the constraint is stated in bold in `.changeset/cli-site-graph-drops-pds.md` and in a dedicated paragraph of the change description - so this is a release-management gate on the merge, not a code defect: **the branch must not cut a release containing both `.changeset/cli-site-graph-drops-pds.md` and task 30's changeset.** Nothing in the repo enforces that split; `changeset version` consumes the directory whole.
  - *Non-blocking observations, recorded so they are not lost:*
    - The implementer's mutation table states 3 pds failures for M3a and M3b; the reproduced counts are 8 each. Coverage is a superset of what was claimed, and M3b carries the exact `…:secret:undefined-*` signature, so no property is lost - but the table's numbers are wrong.
    - The reported "~15 cross-file line citations" in `packages/analytics/src/nodes.ts` is 11 (`grep -oE "cli/src/nodes\.ts:[0-9]…"`). The drift itself is confirmed; one characterisation is off - `packages/cli/src/nodes.ts:830` is `for (const id of deliveryIds) await ctx.clients.logsUsEast1.deleteDelivery(id);`, not a closing brace - but it is still not the `dependsOn: []` precedent it is cited as, and `:713-719` does span a closing brace, a blank line and the opening of an unrelated doc comment. Pre-existing; owned elsewhere.
    - `packages/cli/src/nodes.test.ts:23` - the `opts.pds === false` arm of the fixture ternary is now unreachable; no caller passes `false`. Cosmetic.
    - `docs/src/content/docs/guides/ci-github-oidc.md:61` is the **only** place in `docs/` that names `blogwright pds bootstrap`; the verb is absent from `docs/src/content/docs/reference/cli.md`. A reader following the new sentence has nowhere to go. Task 30's release-notes step is the natural owner.
