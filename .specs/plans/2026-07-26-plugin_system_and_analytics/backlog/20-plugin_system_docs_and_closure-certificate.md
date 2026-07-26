# Done Certificate — Task 20: Document the plugin surface and execute the plugin-system spec's documentation steps

**Task:** [20-plugin_system_docs_and_closure.md](20-plugin_system_docs_and_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 20. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 20) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** Consumer docs for `blogwright plugin add|list|remove` and `blogwright <plugin> <action>`, the two new ports recorded in DEVELOPMENT.md's ports table, a changeset for the whole user-facing surface, and both merge-plan deferrals written down — the canonical-page fallback, and the `Status:` flip that waits for §Plugin-supplied AWS services at tasks 31 and 38 and lands at task 58 — with the spec's unanswered questions carried forward.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the existing `README.md` Commands block for `init`/`bootstrap`/`deploy`/`preview`/`pds`, the existing rows of DEVELOPMENT.md's ports table, or `.specs/README.md`'s pending list, which still holds all three change specs after this task.

## Obligations

- **O1 — README documents the plugin surface and the SPI's status.**
  - *Claim:* `README.md` lists `blogwright plugin add|list|remove` and `blogwright <plugin> <action>` alongside the existing commands, and states the SPI is internal and unversioned.
  - *Evidence to collect:* read `README.md`'s Commands block and confirm the new lines sit beside the existing `preview` and `pds` lines in the same code fence; locate the sentence stating the SPI is internal and unversioned and confirm it says no third party should write against it yet.
  - *Checks:* cross-check the documented command names against the actual dispatch table in `packages/cli/src/plugin-commands.ts` and `packages/cli/src/cli.ts` — every documented command must exist, and every user-facing command added by tasks 13, 16, 17 and 18 must be documented or deliberately omitted.
  - *Status:* ☐ unverified

- **O2 — The ports table carries `ModuleLoader` and `PackageManager`.**
  - *Claim:* DEVELOPMENT.md §Hexagonal architecture's table has both rows, each naming the port file, the real adapter and the test substitute.
  - *Evidence to collect:* read the table at `DEVELOPMENT.md:72-81` and confirm the two new rows; open each named file — the port declaration in `packages/cli/src/ports.ts`, the adapter under `packages/cli/src/adapters/`, and the test substitute — and confirm each exists at the path the row claims.
  - *Checks:* confirm the adapter paths named in the table are covered by `.oxlintrc.json`'s `overrides.files` globs, so the restricted-import exemption actually applies where the table says the side effect lives.
  - *Status:* ☐ unverified

- **O3 — Changeset written, step 2 executed, steps 4–5 deferred in writing.**
  - *Claim:* a changeset covers this spec's user-facing surface with the semver impact stated; merge-plan step 2 (the ports rows) is executed; and the `Status:` flip and move are deferred to task 58 with the reason recorded, not silently skipped.
  - *Evidence to collect:* read the new file(s) in `.changeset/` and confirm the package name, the bump level and a description naming the plugin commands; run `ls .specs/changes/` and confirm `2026-07-26-cli_plugin_system.md` is still there; read its header line and confirm it still says `Status: Proposed`; read `.specs/README.md` and confirm the pending list still holds three proposals; locate the written deferral in this task's decision note and in plan.md and confirm it names task 58 as the owner and §Plugin-supplied AWS services (tasks 31 and 38) as the reason.
  - *Checks:* a flipped header here is a REGRESSION, not an over-delivery — `SendOptions.service` does not yet accept a plugin-supplied descriptor and `AwsClients` has no `signingUsEast1` at this point in the order, so a `Merged` spec would document work that does not exist.
  - *Status:* ☐ unverified

- **O4 — Unanswered questions and the precedence decision carried forward.**
  - *Claim:* the four open questions and task 16's lifecycle-verb precedence decision are recorded in writing, not dropped.
  - *Evidence to collect:* for each of the four — SPI version declaration, `destroy` versus live plugin resources, whether `plugin remove` should offer teardown, whether `preview` becomes a plugin — locate the sentence that carries it forward and record where it landed (the merged spec, DEVELOPMENT.md §Assumptions and open questions, or the plan's Open questions); locate the recorded precedence decision and confirm it matches the module comment in `packages/cli/src/plugin-commands.ts`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm the changeset from O3 is present.
  - *Status:* ☐ unverified

- **O6 — Reviewable: gates green, the spec still pending, no broken links (Reviewable).**
  - *Claim:* a reviewer can run the five gates, then confirm `.specs/changes/2026-07-26-cli_plugin_system.md` is still at that path with `Status: Proposed`, that the deferral to task 58 is written in this task's decision note and in plan.md, and that no link in `.specs/README.md` is broken.
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`; run `ls .specs/changes/`; read the spec's header line; resolve every relative link in `.specs/README.md` and confirm each target exists.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md` §Motivation links to `2026-07-26-cli_plugin_system.md` as a sibling → expect the link untouched and still resolving, because the file has not moved : ☐ (PRESERVED / REGRESSION)
- `.specs/changes/2026-07-26-analytics_plugin.md` links to the plugin-system spec → expect the same : ☐ (PRESERVED / REGRESSION)
- Task 58's merge step, which inherits this deferral → expect it to name both specs and to gate the plugin-system flip on tasks 31 and 38 : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: the merge plan's step 1 ("apply the blocks to whichever canonical page first documents CLI dispatch") is vacuous while the repo has no canonical spec pages, and step 3 (folding the `PluginManifest` `$def` into a canonical schema) is likewise deferred — confirm the closure records that rather than silently skipping both; steps 4 and 5 are deferred for a different and harder reason, that §Plugin-supplied AWS services has not landed, and belong to task 58; task 30 closes the pds migration spec and task 58 closes both the analytics spec and this one, so this task moves no file at all; and DEVELOPMENT.md's own open-questions list is a reasonable home for the carried-forward items if the merged spec is not.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
