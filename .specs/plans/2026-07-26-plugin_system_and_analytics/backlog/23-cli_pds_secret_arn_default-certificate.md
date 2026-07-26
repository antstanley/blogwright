# Done Certificate — Task 23: Derive the OIDC role's pds secret ARN from the shared default, not from config.pds.secretName

**Task:** [23-cli_pds_secret_arn_default.md](23-cli_pds_secret_arn_default.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 23. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 23) ≡ every obligation O1…O5 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The GitHub OIDC deploy role's Secrets Manager statement derives its ARN through `blogwright-pds`'s secret-name resolver, so the policy is identical for every input valid today and cannot degrade to `secret:undefined-*` once core stops defaulting.
- **P2 — Obligations.** The task is done iff O1…O5 all hold. One Oi per definition-of-done item, in DoD order; O5 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `oidcRolePolicyStatements` (`packages/cli/src/nodes.ts:863`), its caller `applyOidcRole` (`packages/cli/src/nodes.ts:964`, which feeds the statements to `ensureRolePolicy`), or the preview branch that deliberately emits neither the invalidation nor the secrets statement.

## Obligations

- **O1 — The defaulted case is pinned to the exact ARN.**
  - *Claim:* a `pds` block with no `secretName` produces `Resource: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*'` — the same string today's code produces via core's default.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/cli`; locate the new case in the `oidcRolePolicyStatements` describe block and record its name and the asserted string; confirm the fixture omits `secretName` rather than setting it to `undefined` explicitly.
  - *Status:* ☐ unverified

- **O2 — The explicit-`secretName` and preview assertions are unchanged.**
  - *Claim:* `packages/cli/src/nodes.test.ts:194-211` ("grants secret read/write scoped to the pds secret when configured") passes with no edit, and the preview case at `:168-173` still asserts no `secretsmanager:GetSecretValue` action.
  - *Evidence to collect:* run `git diff packages/cli/src/nodes.test.ts` and confirm the diff is additive only in that region; run `pnpm test -- nodes` and record both results.
  - *Status:* ☐ unverified

- **O3 — The name comes from the owning package and is total.**
  - *Claim:* the value interpolated at `packages/cli/src/nodes.ts:925` is produced by `blogwright-pds`'s secret-name resolver, its type is `string`, and the CLI holds no default of its own.
  - *Evidence to collect:* read `packages/cli/src/nodes.ts:913-927` and the import block at the top of the file; run `grep -rn "atproto" packages/cli/src --include=*.ts` and confirm every hit is a test assertion or fixture, never a derivation.
  - *Checks:* resolve the resolver call at `packages/cli/src/nodes.ts:925` — confirm it binds to the export from `blogwright-pds`, not to a locally declared helper or a template literal, and that hovering its return type yields `string` rather than `string | undefined`.
  - *Status:* ☐ unverified

- **O4 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm derived AWS resource names are unchanged for existing inputs (O2 is the evidence) so no changeset is required.
  - *Status:* ☐ unverified

- **O5 — Reviewable: `pnpm test -- nodes` plus a read of `nodes.ts:925` (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- nodes` in `packages/cli` and observe both ARN assertions passing, then read `packages/cli/src/nodes.ts:925` and see a resolver call rather than a bare property read.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/cli` and capture the `oidcRolePolicyStatements` results; capture `packages/cli/src/nodes.ts:913-927` verbatim.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:964` (`applyOidcRole`) calls `oidcRolePolicyStatements(ctx)` with the production fixture carrying `pds: { name: 'x', secretName: 'example/atproto' }` → expect the same statement list, in the same order, with the same `Resource` : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:964` (`applyOidcRole`) calls `oidcRolePolicyStatements(ctx)` with `preview: true` → expect no `secretsmanager:*` statement at all : ☐ (PRESERVED / REGRESSION)

## Residue

This task is ordering-critical and the ordering is the risk, not the code. `oidcRolePolicyStatements`
runs on the bootstrap path, which under lazy plugin discovery never loads the pds plugin — so nothing
there would apply the default on its own. If task 27 (core stops defaulting) landed before this task,
the GitHub OIDC deploy role would be granted `secret:undefined-*`, silently breaking the post-deploy
PDS sync in CI. That is a wrong permission grant, not a crash, and the pre-existing test at
`nodes.test.ts:194-211` would not catch it because its fixture names `secretName` explicitly. The
validator should confirm this task is recorded as landing before task 27, not merely that its tests
pass. Not covered by the DoD: whether a live bootstrap re-applies the policy for an environment
provisioned before the change.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
