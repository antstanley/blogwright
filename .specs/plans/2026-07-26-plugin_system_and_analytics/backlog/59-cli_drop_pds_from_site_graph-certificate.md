# Done Certificate — Task 52: Remove the pds branch from the site's OIDC policy

**Task:** [59-cli_drop_pds_from_site_graph.md](59-cli_drop_pds_from_site_graph.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 59. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 52) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The CLI's resource graph carries no pds knowledge — no `config.pds` branch, no `blogwright-pds` import in `nodes.ts` — with the grant owned entirely by the plugin's node from task 23.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the rest of the OIDC policy document, the post-deploy pds sync, or `blogwright-pds` remaining a non-optional CLI dependency. Must not land before task 23.


## Obligations

- **O1 — No pds statement for any input.**
  - *Claim:* `oidcRolePolicyStatements` contains no `config.pds` reference and emits no `secretsmanager` statement even for a context that HAS a pds block.
  - *Evidence to collect:* read `packages/cli/src/nodes.ts:863-930`; run `pnpm test -- nodes`; read the new positive-looking test that passes a context with `config.pds` set.
  - *Checks:* the test must use a context WITH pds configured — a test with pds absent would pass whether or not the branch was removed and proves nothing.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O2 — No pds knowledge left in the site graph.**
  - *Claim:* `grep -n "pds" packages/cli/src/nodes.ts` returns zero hits, closing the gap task 29's `cli.ts`-only gate left open.
  - *Evidence to collect:* run the grep; also confirm the doc comment at `:823` no longer claims the role grants access to the PDS secret.
  - *Checks:* zero hits includes comments — a stale comment naming pds is a residue of the same coupling.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O3 — The grant is preserved end to end.**
  - *Claim:* with the pds plugin bootstrapped, the site role carries a `blogwright-pds` inline policy whose document matches what the site used to emit.
  - *Evidence to collect:* read task 23's assertion; confirm this task deleted the duplicate expectation at `packages/cli/src/nodes.test.ts:194-211` rather than leaving coverage in two places.
  - *Checks:* if task 23 is not complete, this task must not land — the ordering is what prevents an access gap.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O4 — knip clean and the upgrade note written.**
  - *Claim:* the `blogwright-pds` import is gone from `nodes.ts`, `pnpm knip` passes, and a changeset records the upgrade note.
  - *Evidence to collect:* run `pnpm knip`; read the changeset.
  - *Checks:* the changeset states that an operator who upgrades and never runs `blogwright pds bootstrap` keeps the old inline policy until they do.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O5 — Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O6 — Reviewable.**
  - *Claim:* the reviewer can confirm the removal and the preserved grant directly.
  - *Evidence to collect:* run `pnpm test -- nodes` and `pnpm knip`; run `grep pds packages/cli/src/nodes.ts`.
  - *Checks:* the with-pds context yields no secretsmanager statement and the grep is empty.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

## Regression checks

- Every non-pds statement in the OIDC policy (s3, lambda MicroVM actions, logs, iam:PassRole, cloudfront:CreateInvalidation) is unchanged → expect the remaining `nodes.test.ts` OIDC assertions to pass untouched : ☐ (PRESERVED / REGRESSION)
- `blogwright deploy` for a production env with a pds block still runs the post-deploy sync (`packages/cli/src/commands.ts:2,97`) : ☐ (PRESERVED / REGRESSION)
- `packages/cli/package.json:28` still lists `blogwright-pds` as a non-optional dependency (the static `syncAfterDeploy` import depends on it) : ☐ (PRESERVED / REGRESSION)


## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☐ NOT DONE   <!-- validator sets -->
- **Gaps:**   <!-- validator lists any unsatisfied obligation or regression -->
