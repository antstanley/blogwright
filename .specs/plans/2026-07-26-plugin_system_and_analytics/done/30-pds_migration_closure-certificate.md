# Done Certificate - Task 30: Ship the pds changeset and record the plugin manifest in DEVELOPMENT.md

**Task:** [30-pds_migration_closure.md](30-pds_migration_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 30. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 30) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The migration ships with a changeset stating its semver impact and carrying the spec's five operator-visible changes, `DEVELOPMENT.md` records the `blogwright.plugin` manifest as the feature-package mechanism, and the change spec's `Status:` flip is deliberately deferred to task 60, its two outstanding blocks landing at tasks 59 and 60.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the release pipeline's changeset consumption (`.changeset/config.json`), the link targets in `.specs/README.md`, or `DEVELOPMENT.md`'s existing §Hexagonal architecture content beyond the one paragraph being amended. Must not move or flip the pds change spec: task 60 does that.

## Obligations

- **O1 - The changeset names three packages, their bumps, and the unchanged file shape.**
  - *Claim:* a `.changeset/*.md` file names `blogwright-core`, `blogwright-pds` and `blogwright` with intended semver bumps and states that the on-disk config file shape is unchanged - only where the pds default and validation live moved.
  - *Evidence to collect:* read the new `.changeset/*.md` front matter and body; run `pnpm changeset status` from the repo root and record the three packages and their bump levels; confirm the core bump reflects the removed validation and the now-optional `PdsConfig.secretName` (task 27's O4).
  - *Status:* ☐ unverified

- **O2 - `DEVELOPMENT.md` names the manifest field and its example still reads true.**
  - *Claim:* the "Features live in their own packages" paragraph at `DEVELOPMENT.md:100-103` names the `blogwright.plugin` manifest field as the mechanism, and its `PdsContext`/`OpsContext` sentence remains accurate after task 24's narrowing.
  - *Evidence to collect:* read `DEVELOPMENT.md` §Hexagonal architecture and capture the amended paragraph; read `packages/pds/src/context.ts` and confirm the sentence "satisfied structurally by the CLI's `OpsContext`" still describes the type as written.
  - *Status:* ☐ unverified

- **O3 - The five operator-visible changes are stated, and every divergence with them.**
  - *Claim:* the changeset carries the spec's §Upgrading a deployed stack list in full - `blogwright pds bootstrap` first and marked required, the three new `pds` lifecycle verbs, `blogwright destroy` refusing while `state/<env>.pds.json` exists, the shorter help section, and the built-in commands no longer rejecting a malformed `pds` block - plus whatever task 28's tests pinned beyond that and whatever help text task 29 reshaped.
  - *Evidence to collect:* read the changeset body and check off all five items; read task 28's pinned outcome (its tests and commit description) and task 29's commit description listing lost help guidance; confirm each appears; if neither task produced a further divergence, confirm the changeset says so explicitly rather than being silent.
  - *Checks:* the first item is the load-bearing one, and it is easy to soften into a suggestion. This is the release the instruction travels in: task 59 removes the site's own grant in a later one, and a stack that never ran the verb loses it at its next `blogwright bootstrap` after that release, because `applyOidcRole` rewrites the whole `<env>-deploy` document (`packages/cli/src/nodes.ts:840-842,962`). A changeset that omits it, or files it under "nice to have", is UNSATISFIED.
  - *Status:* ☐ unverified

- **O4 - Merge-plan bookkeeping is correctly incomplete, and the open questions survive.**
  - *Claim:* merge-plan step 3 is done; steps 4 and 5 are NOT - the spec's `Status:` still reads `Proposed`, the file is still at `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md`, and `.specs/README.md` still lists it as pending - with the deferral to task 60 recorded in the change description and the three unanswered questions (an `afterDeploy` hook, `OpsConfig` holding plugin blocks as an opaque map, shorter pds aliases) recorded so task 60's move carries them forward.
  - *Evidence to collect:* run `ls .specs/changes .specs/changes/merged` and confirm the file has NOT moved; read its header line and confirm `Status: Proposed`; read `.specs/README.md` and confirm the entry is present; read the change description for the deferral and the reason.
  - *Checks:* a flipped `Status:` here is a defect, not an overachievement. Two of the spec's blocks have not landed - §The site graph drops its pds branch (task 59, a release later) and §`bootstrap` warns while plugin state exists (task 60) - and merging a spec with an outstanding `Proposed changes` block is exactly the finding that split task 20 from task 58. If the file has moved, mark UNSATISFIED and name the block.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; confirm the changeset from O1 exists.
  - *Status:* ☐ unverified

- **O6 - Reviewable: `pnpm changeset status` plus the two documents (Reviewable).**
  - *Claim:* a reviewer can run `pnpm changeset status` and `pnpm test` from the repo root and read `DEVELOPMENT.md:100-103` and `.specs/README.md`, seeing three packages with bumps, the manifest field named, `blogwright pds bootstrap` as the changeset's first upgrade step, and the pds spec still listed as pending with `Status: Proposed`.
  - *Evidence to collect:* run both commands and capture the output; capture the amended `DEVELOPMENT.md` paragraph and the updated `.specs/README.md` pending list.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `.specs/README.md`'s pending list links `changes/2026-07-26-migrate_pds_to_plugin_system.md` → expect the entry still present and still resolving, since the move belongs to task 60 : ☐ (PRESERVED / REGRESSION)
- `.specs/changes/2026-07-26-cli_plugin_system.md` §Affected spec pages and `2026-07-26-analytics_plugin.md` reference the migration spec by relative path → expect those links untouched and still resolving, since nothing moves in this task : ☐ (PRESERVED / REGRESSION)
- `DEVELOPMENT.md` §Error handling table and §Assumptions reference `blogwright-pds` as a feature package → expect both still consistent with the amended paragraph : ☐ (PRESERVED / REGRESSION)

## Residue

The migration's own spec lists five operator-visible changes, so the changeset is where that list is
either confirmed or qualified - O3 is the obligation that keeps the two honest, and it is the one
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
