# Done Certificate — Task 23: pds attaches its own named inline policy to the site's deploy role

**Task:** [23-cli_pds_secret_arn_default.md](23-cli_pds_secret_arn_default.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 23. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 23) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `blogwright-pds` contributes one `ResourceNode` attaching a `blogwright-pds`-named inline policy to the site's GitHub-OIDC deploy role, granting Secrets Manager access to its own secret — a separately-named IAM object, so it coexists with the site's existing statement rather than replacing it, until task 59 removes that statement a release later.
- **P2 — Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's own OIDC policy document (`packages/cli/src/nodes.ts:863`), the six pds commands, or the pinned rkey vectors. The only permitted edit under `packages/cli/` is `githubOidcRoleNode` reading `ctx.names.githubRole` at `packages/cli/src/nodes.ts:826`.


## Obligations

- **O1 — The node exists and its policy is byte-identical to today's.**
  - *Claim:* `blogwright-pds` exports one resource node attaching a `blogwright-pds`-named inline policy to the site's OIDC role, and its document matches the statement `oidcRolePolicyStatements` produces today. The node is not yet reachable from the CLI — task 25 declares the `nodes(ctx)` member that returns it — so this obligation is discharged against the node's own tests.
  - *Evidence to collect:* read `packages/pds/src/nodes.ts`; run `pnpm --filter blogwright-pds test -- nodes`; diff the emitted policy document field by field against `packages/cli/src/nodes.ts:913-927` and the expectation at `packages/cli/src/nodes.test.ts:194-208`.
  - *Checks:* the three actions are exactly `secretsmanager:GetSecretValue`, `PutSecretValue`, `CreateSecret`; the Resource is `arn:aws:secretsmanager:<region>:<account>:secret:<name>-*` with the name from task 21's resolver, not from `config.pds.secretName` directly.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O2 — Additive only — the site's own policy is never touched.**
  - *Claim:* the node calls `putRolePolicy` with policy name `blogwright-pds` and touches no other policy name.
  - *Evidence to collect:* read the recording-IAM-client test; confirm it asserts the policy name and that no other `putRolePolicy`/`deleteRolePolicy` call is made.
  - *Checks:* `read()` uses `listRolePolicies` and `delete()` uses `deleteRolePolicy`, both scoped to the `blogwright-pds` name.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O3 — The site's Secrets Manager statement is untouched by this task.**
  - *Claim:* `packages/cli/src/nodes.ts:913-927` is unchanged; the only edit to that file is `githubOidcRoleNode` reading `ctx.names.githubRole` at `:826`. The site's statement stays until task 59.
  - *Evidence to collect:* run `jj diff packages/cli/src/nodes.ts` and read every hunk — expect exactly one, at the role-name derivation.
  - *Checks:* if the `if (ctx.config.pds)` statement changed, the additive-first ordering has been broken and every deployed stack loses the grant at its next `blogwright bootstrap` — `applyOidcRole` rewrites the whole `<env>-deploy` document (`packages/cli/src/nodes.ts:840-842,962`), so the statement is not merely stale, it is gone; mark UNSATISFIED.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

- **O4 — The deploy role's name has one home.**
  - *Claim:* `deriveNames` returns `githubRole` as `<env>-<siteName>-gh`, `githubOidcRoleNode` reads it rather than deriving it at `packages/cli/src/nodes.ts:826`, and the derived value is unchanged so no existing role is renamed.
  - *Evidence to collect:* read `Names` (`packages/core/src/config.ts:333-345`) and `deriveNames` (`:360-372`); run `pnpm test -- config` in `packages/core` and confirm a case pins the derived value; run `grep -n 'prefix}-gh' packages/cli/src/nodes.ts` and expect no output.
  - *Checks:* resolve what the plugin's node passes to `putRolePolicy` — confirm it is `ctx.names.githubRole` and not a second derivation, since the whole point is that a derived AWS name has exactly one owner (DEVELOPMENT.md §Limits and bounds).
  - *Status:* ☐ unverified
- **O5 — Absent config, absent githubRepo and un-bootstrapped site behave as specified.**
  - *Claim:* the node is skipped (not failed) when `config.pds` is absent or `config.githubRepo` is unset — the latter because the site graph only adds `githubOidcRoleNode` when `githubRepo` is set (`packages/cli/src/nodes.ts:1082`), so a site without CI deploys has no role to attach to and is nonetheless fully bootstrapped — and fails with a message naming `blogwright bootstrap` when `githubRepo` is set but the role is absent from `siteState`.
  - *Evidence to collect:* run the three negative-space tests; read their assertions.
  - *Checks:* skipped means no IAM call at all, asserted on the recording client — not merely a caught error.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O6 — Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass; tests were written with the change, not after.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O7 — Reviewable.**
  - *Claim:* the reviewer can confirm the policy match and the untouched CLI directly.
  - *Evidence to collect:* run `pnpm --filter blogwright-pds test -- nodes`; run `jj diff packages/cli/src/nodes.ts`.
  - *Checks:* the emitted document matches the site's current statement field for field, and the CLI diff holds exactly one hunk — the role-name read at `:826`.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

## Regression checks

- `oidcRolePolicyStatements` (`packages/cli/src/nodes.ts:863`) still emits its pds statement at this task → expect the existing assertion at `packages/cli/src/nodes.test.ts:194-208` to still pass : ☐ (PRESERVED / REGRESSION)
- The six pds commands (`packages/pds/src/commands.ts`) are unaffected by the new node module → expect `pnpm --filter blogwright-pds test` green : ☐ (PRESERVED / REGRESSION)
- Pinned rkey vectors (`packages/pds/src/rkey.test.ts`) unchanged : ☐ (PRESERVED / REGRESSION)


## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☐ NOT DONE   <!-- validator sets -->
- **Gaps:**   <!-- validator lists any unsatisfied obligation or regression -->
