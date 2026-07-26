# Done Certificate — Task 30: Ship the pds changeset and record the plugin manifest in DEVELOPMENT.md

**Task:** [30-pds_migration_closure.md](30-pds_migration_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 30. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 30) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The migration ships with a changeset stating its semver impact, `DEVELOPMENT.md` records the `blogwright.plugin` manifest as the feature-package mechanism, and the change spec is merged with its unanswered questions carried forward.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the release pipeline's changeset consumption (`.changeset/config.json`), the link targets in `.specs/README.md`, or `DEVELOPMENT.md`'s existing §Hexagonal architecture content beyond the one paragraph being amended.

## Obligations

- **O1 — The changeset names three packages, their bumps, and the unchanged file shape.**
  - *Claim:* a `.changeset/*.md` file names `blogwright-core`, `blogwright-pds` and `blogwright` with intended semver bumps and states that the on-disk config file shape is unchanged — only where the pds default and validation live moved.
  - *Evidence to collect:* read the new `.changeset/*.md` front matter and body; run `pnpm changeset status` from the repo root and record the three packages and their bump levels; confirm the core bump reflects the removed validation and the now-optional `PdsConfig.secretName` (task 27's O4).
  - *Status:* ☐ unverified

- **O2 — `DEVELOPMENT.md` names the manifest field and its example still reads true.**
  - *Claim:* the "Features live in their own packages" paragraph at `DEVELOPMENT.md:100-103` names the `blogwright.plugin` manifest field as the mechanism, and its `PdsContext`/`OpsContext` sentence remains accurate after task 24's narrowing.
  - *Evidence to collect:* read `DEVELOPMENT.md` §Hexagonal architecture and capture the amended paragraph; read `packages/pds/src/context.ts` and confirm the sentence "satisfied structurally by the CLI's `OpsContext`" still describes the type as written.
  - *Status:* ☐ unverified

- **O3 — Every divergence is stated, not implied.**
  - *Claim:* whatever task 28 decided and whatever help text task 29 reshaped is named in the changeset, because the spec's headline is "no user-visible change".
  - *Evidence to collect:* read task 28's recorded decision (commit description, spec Open questions, or its own changeset) and task 29's commit description listing lost help guidance; confirm each appears in this task's changeset body; if neither task produced a divergence, confirm the changeset says so explicitly rather than being silent.
  - *Status:* ☐ unverified

- **O4 — Merge-plan bookkeeping is complete and the open questions survive.**
  - *Claim:* the spec's `Status:` is `Merged` with a `Merged:` date, the file lives at `.specs/changes/merged/2026-07-26-migrate_pds_to_plugin_system.md`, `.specs/README.md`'s pending list no longer lists it, and the three unanswered questions (an `afterDeploy` hook, `OpsConfig` holding plugin blocks as an opaque map, shorter pds aliases) are carried forward.
  - *Evidence to collect:* run `ls .specs/changes .specs/changes/merged` and confirm the file moved; read the moved file's header line and its Open questions section; read `.specs/README.md` and confirm the pending list is renumbered with no dangling link.
  - *Checks:* resolve every relative link in the moved file — `../../packages/...` and `../../DEVELOPMENT.md` gain a directory level under `merged/`, and the two sibling links to `2026-07-26-cli_plugin_system.md` must have become `../2026-07-26-cli_plugin_system.md`, since that spec is still in `.specs/changes/` at this point (task 20 defers its flip to task 58). Confirm each resolves rather than silently rotting.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; confirm the changeset from O1 exists.
  - *Status:* ☐ unverified

- **O6 — Reviewable: `pnpm changeset status` plus the two documents (Reviewable).**
  - *Claim:* a reviewer can run `pnpm changeset status` and `pnpm test` from the repo root and read `DEVELOPMENT.md:100-103` and `.specs/README.md`, seeing three packages with bumps, the manifest field named, and no pending entry pointing at a moved file.
  - *Evidence to collect:* run both commands and capture the output; capture the amended `DEVELOPMENT.md` paragraph and the updated `.specs/README.md` pending list.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `.specs/README.md:26-29` linked `changes/2026-07-26-migrate_pds_to_plugin_system.md` → expect the entry removed from the pending list and the remaining two renumbered, with no broken link left behind : ☐ (PRESERVED / REGRESSION)
- `.specs/changes/2026-07-26-cli_plugin_system.md` §Affected spec pages and `2026-07-26-analytics_plugin.md` reference the migration spec by relative path → expect those links updated or still resolving after the move : ☐ (PRESERVED / REGRESSION)
- `DEVELOPMENT.md` §Error handling table and §Assumptions reference `blogwright-pds` as a feature package → expect both still consistent with the amended paragraph : ☐ (PRESERVED / REGRESSION)

## Residue

The migration's own spec claims "no user-visible change", so the changeset is where that claim is
either confirmed or qualified — O3 is the obligation that keeps the two honest, and it is the one
most readily discharged by assertion rather than evidence. The carried-forward questions are not
idle: whether the SPI gains an `afterDeploy` hook decides whether `packages/cli/src/commands.ts:2`'s
static import stays a recorded wart or becomes a bug, and whether `OpsConfig` should hold plugin
blocks as an opaque map is a breaking change to a published type that this migration deliberately
did not make. Not covered by the DoD: whether a canonical spec page now exists for CLI dispatch, in
which case merge-plan steps 1 and 2 (folding the Proposed changes blocks and the `PdsConfig` `$def`
into it) become live rather than no-ops.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
