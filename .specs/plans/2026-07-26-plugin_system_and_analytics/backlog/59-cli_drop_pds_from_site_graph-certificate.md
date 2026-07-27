# Done Certificate — Task 59: Remove the pds branch from the site's OIDC policy

**Task:** [59-cli_drop_pds_from_site_graph.md](59-cli_drop_pds_from_site_graph.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 59. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 59) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The CLI's resource graph carries no pds knowledge — no `config.pds` branch, no secret-name interpolation, and no inline `<siteName>/atproto` default — with the grant owned entirely by the plugin's node from task 23, and the pds spec's `Status:` flip deferred once more to task 60, which lands its true last outstanding block (§`bootstrap` warns while plugin state exists).
- **P2 — Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the rest of the OIDC policy document, the post-deploy pds sync, or `blogwright-pds` remaining a non-optional CLI dependency. Must not land before task 23, and must not ship in the same *release* as task 30.


## Obligations

- **O1 — No pds statement for any input.**
  - *Claim:* `oidcRolePolicyStatements` contains no `config.pds` reference, no `atproto` default and no `secretsmanager` statement even for a context that HAS a pds block.
  - *Evidence to collect:* read `packages/cli/src/nodes.ts:863-930`; run `pnpm test -- nodes`; read the new positive-looking test that passes a context with `config.pds` set.
  - *Checks:* the test must use a context WITH pds configured — a test with pds absent would pass whether or not the branch was removed and proves nothing.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O2 — No pds knowledge left in the site graph.**
  - *Claim:* `grep -nE "pds|atproto" packages/cli/src/nodes.ts` returns zero hits, closing the gap task 29's `cli.ts`-only gate left open and retiring task 27's deliberate duplication.
  - *Evidence to collect:* run the grep; also confirm the doc comment at `:823` no longer claims the role grants access to the PDS secret.
  - *Checks:* zero hits includes comments — a stale comment naming pds is a residue of the same coupling — and includes `atproto`, because task 27's inline default is the other half of what this task removes.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O3 — The grant is preserved end to end.**
  - *Claim:* with the pds plugin bootstrapped, the site role carries a `blogwright-pds` inline policy whose document matches what the site used to emit.
  - *Evidence to collect:* read task 23's assertion; confirm this task deleted the duplicate expectation at `packages/cli/src/nodes.test.ts:194-208`, and task 27's `undefined`-guard case beside it, rather than leaving coverage in two places.
  - *Checks:* if task 23 is not complete, this task must not land — the ordering is what prevents an access gap.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O4 — knip clean and the upgrade note written, with the right mechanism.**
  - *Claim:* `pnpm knip` passes and a changeset records the upgrade note.
  - *Evidence to collect:* run `pnpm knip`; run `grep -c blogwright-pds packages/cli/src/nodes.ts` and expect `0`; read the changeset.
  - *Checks:* there is no `blogwright-pds` import in `nodes.ts` to remove, and there never was — the grant moved by the plugin contributing its own node, not by the CLI importing the plugin. A change description claiming to have removed one has done something else; investigate before accepting. The changeset must state the mechanism correctly: the old grant is a *statement inside* the `<env>-deploy` inline policy, and `applyOidcRole` replaces that whole document on every `blogwright bootstrap` (`packages/cli/src/nodes.ts:840-842,962`), so it does NOT survive until the operator runs `blogwright pds bootstrap` — it survives until their next site bootstrap. A note asserting the former is wrong in the direction that costs an operator the grant.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O5 — Ships in a later release than task 30.**
  - *Claim:* the release carrying task 30 is out before this task lands, and the change description says so.
  - *Evidence to collect:* confirm a published release contains task 30's changeset and its `blogwright pds bootstrap` upgrade note; read this task's change description for the statement.
  - *Checks:* this is the whole of what "additive-first" means on a deployed stack. The plugin's policy reaches a real role only when an operator runs `blogwright pds bootstrap`; ordering the two commits proves nothing, and shipping both in one release means every stack whose operator deploys before reading the notes loses the grant. If task 30 is unreleased, this task is blocked, not merely early.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O6 — The pds change spec is correctly NOT merged, with the deferral recorded.**
  - *Claim:* the spec's `Status:` still reads `Proposed`, the file still lives at `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md`, its entry is still in `.specs/README.md`'s pending list, and the change description records the deferral naming task 60 — which lands §`bootstrap` warns while plugin state exists, the spec's last outstanding block.
  - *Evidence to collect:* run `ls .specs/changes .specs/changes/merged` and confirm the file has NOT moved; read its header line; read `.specs/README.md`'s pending list; read the change description for the deferral and the reason.
  - *Checks:* a flipped `Status:` here is a defect, not an overachievement — merging a spec with an outstanding `Proposed changes` block is the same finding that split tasks 20/58 and 30/59. If the file has moved, mark UNSATISFIED and name the outstanding block.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O7 — Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O8 — Reviewable.**
  - *Claim:* the reviewer can confirm the removal, the preserved grant and the recorded deferral directly.
  - *Evidence to collect:* run `pnpm test -- nodes` and `pnpm knip`; run `grep -nE "pds|atproto" packages/cli/src/nodes.ts`; read the pds spec's header and the change description; read `.specs/README.md`.
  - *Checks:* the with-pds context yields no secretsmanager statement, the grep is empty, the pds spec still reads `Status: Proposed` with the deferral naming task 60, and every link in `.specs/README.md` resolves.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

## Regression checks

- Every non-pds statement in the OIDC policy (s3, lambda MicroVM actions, logs, iam:PassRole, cloudfront:CreateInvalidation) is unchanged → expect the remaining `nodes.test.ts` OIDC assertions to pass untouched : ☐ (PRESERVED / REGRESSION)
- `blogwright deploy` for a production env with a pds block still runs the post-deploy sync (`packages/cli/src/commands.ts:2,97`) : ☐ (PRESERVED / REGRESSION)
- On a stack whose operator ran `blogwright pds bootstrap` in the previous release, the next `blogwright bootstrap` after this one rewrites `<env>-deploy` without the secretsmanager statement while the `blogwright-pds` inline policy stands → expect `pds sync` to keep reading and rotating the OAuth secret : ☐ (PRESERVED / REGRESSION)
- On a stack whose operator did NOT, the same bootstrap leaves no grant → expect the post-deploy sync to warn without failing the deploy (`packages/pds/src/commands.ts:220-221`) and `blogwright pds bootstrap` to heal it : ☐ (PRESERVED / REGRESSION)
- `packages/cli/package.json:28` still lists `blogwright-pds` as a non-optional dependency (the static `syncAfterDeploy` import depends on it) : ☐ (PRESERVED / REGRESSION)


## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☐ NOT DONE   <!-- validator sets -->
- **Gaps:**   <!-- validator lists any unsatisfied obligation or regression -->
