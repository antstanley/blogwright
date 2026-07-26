# Done Certificate — Task 23: pds attaches its own named inline policy to the site's deploy role

**Task:** [23-cli_pds_secret_arn_default.md](23-cli_pds_secret_arn_default.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 23. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 23) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `blogwright-pds` contributes one `ResourceNode` attaching a `blogwright-pds`-named inline policy to the site's GitHub-OIDC deploy role, granting Secrets Manager access to its own secret — additive, so it coexists with the site's existing statement until task 58 removes it.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's own OIDC policy document (`packages/cli/src/nodes.ts:863`), the six pds commands, or the pinned rkey vectors. Must not modify `packages/cli/` at all.


## Obligations

- **O1 — The node exists and its policy is byte-identical to today's.**
  - *Claim:* `blogwright-pds` exports one resource node attaching a `blogwright-pds`-named inline policy to the site's OIDC role, and its document matches the statement `oidcRolePolicyStatements` produces today.
  - *Evidence to collect:* read `packages/pds/src/nodes.ts`; run `pnpm --filter blogwright-pds test -- nodes`; diff the emitted policy document field by field against `packages/cli/src/nodes.ts:913-927` and the expectation at `packages/cli/src/nodes.test.ts:194-211`.
  - *Checks:* the three actions are exactly `secretsmanager:GetSecretValue`, `PutSecretValue`, `CreateSecret`; the Resource is `arn:aws:secretsmanager:<region>:<account>:secret:<name>-*` with the name from task 21's resolver, not from `config.pds.secretName` directly.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O2 — Additive only — the site's own policy is never touched.**
  - *Claim:* the node calls `putRolePolicy` with policy name `blogwright-pds` and touches no other policy name.
  - *Evidence to collect:* read the recording-IAM-client test; confirm it asserts the policy name and that no other `putRolePolicy`/`deleteRolePolicy` call is made.
  - *Checks:* `read()` uses `listRolePolicies` and `delete()` uses `deleteRolePolicy`, both scoped to the `blogwright-pds` name.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O3 — The CLI is untouched by this task.**
  - *Claim:* `packages/cli/src/nodes.ts` is unchanged; the site's statement stays until task 58.
  - *Evidence to collect:* run `git diff packages/cli/` (or `jj diff packages/cli/`) for this task's commit — expect no output.
  - *Checks:* if `packages/cli/src/nodes.ts` changed, the additive-first ordering has been broken and the migration has a window where CI deploys lose the grant; mark UNSATISFIED.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O4 — Absent config, absent githubRepo and un-bootstrapped site behave as specified.**
  - *Claim:* the node is skipped (not failed) when `config.pds` is absent or `githubRepo` is unset, and fails with a message naming `blogwright bootstrap` when the site is not bootstrapped.
  - *Evidence to collect:* run the three negative-space tests; read their assertions.
  - *Checks:* skipped means no IAM call at all, asserted on the recording client — not merely a caught error.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O5 — Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass; tests were written with the change, not after.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O6 — Reviewable.**
  - *Claim:* the reviewer can confirm the policy match and the untouched CLI directly.
  - *Evidence to collect:* run `pnpm --filter blogwright-pds test -- nodes`; run `git diff packages/cli/`.
  - *Checks:* the emitted document matches the site's current statement field for field and the CLI diff is empty.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

## Regression checks

- `oidcRolePolicyStatements` (`packages/cli/src/nodes.ts:863`) still emits its pds statement at this task → expect the existing assertion at `packages/cli/src/nodes.test.ts:194-211` to still pass : ☐ (PRESERVED / REGRESSION)
- The six pds commands (`packages/pds/src/commands.ts`) are unaffected by the new node module → expect `pnpm --filter blogwright-pds test` green : ☐ (PRESERVED / REGRESSION)
- Pinned rkey vectors (`packages/pds/src/rkey.test.ts`) unchanged : ☐ (PRESERVED / REGRESSION)


## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☐ NOT DONE   <!-- validator sets -->
- **Gaps:**   <!-- validator lists any unsatisfied obligation or regression -->
