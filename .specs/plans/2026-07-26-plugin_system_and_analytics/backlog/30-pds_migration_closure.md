# Task 30 — Ship the pds changeset and record the plugin manifest in DEVELOPMENT.md

**Plan:** [plan.md](../plan.md) · **Certificate:** [30-pds_migration_closure-certificate.md](30-pds_migration_closure-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §Merge plan](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) and §`blogwright-pds` → Package manifest (Add) and §`blogwright-cli` → Post-deploy sync (Modify) (steps 3–5 of the merge plan: the DEVELOPMENT.md note, the status flip, the move to `merged/`, the README update)
**Depends on:** 28, 29
**Produces:** the migration's changeset, the `blogwright.plugin` manifest recorded as the feature-package mechanism in `DEVELOPMENT.md`, and the change spec merged with its unanswered questions carried forward
**Pointers:** `.changeset/` (where the changeset lands; `.changeset/config.json` holds the release config), `DEVELOPMENT.md:100-103` (§Hexagonal architecture, "Features live in their own packages" — the paragraph naming `PdsContext` and `OpsContext`), [the pds migration change spec](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) (its `Status:` line, its §Merge plan and its three §Open questions), `.specs/README.md:19-34` (the pending list, where the pds entry at `:26-29` is removed), `.specs/changes/merged/` (the destination)

## Steps

- [ ] Write the changeset naming `blogwright-core`, `blogwright-pds` and `blogwright` with their intended bumps, stating that the on-disk config file shape is unchanged and only the location of the pds default and validation moved.
- [ ] Fold in whatever task 28 decided and whatever help text task 29 reshaped, so any behaviour divergence is stated in the changeset rather than left implied by the spec's "no user-visible change" claim.
- [ ] Update `DEVELOPMENT.md:100-103` so the feature-package paragraph names the `blogwright.plugin` manifest field as the mechanism, and re-read its `PdsContext`/`OpsContext` sentence against task 24's narrowing to confirm it still reads true.
- [ ] Execute merge-plan steps 4 and 5: flip the spec's `Status:` to `Merged` with a `Merged:` date, move the file to `.specs/changes/merged/`, and remove its entry from `.specs/README.md`'s pending list, renumbering the two remaining pending items. Re-point every relative link inside the moved file — `../../packages/…` and `../../DEVELOPMENT.md` gain a level, and its two sibling links to `2026-07-26-cli_plugin_system.md` become `../2026-07-26-cli_plugin_system.md`, because that spec is still pending here: task 20 defers its flip to task 58.
- [ ] Carry the three unanswered open questions forward — an `afterDeploy` hook, `OpsConfig` holding plugin blocks as an opaque map, shorter pds action aliases — into the merged file's own Open questions or the plugin-system spec, so they survive the move.

## Definition of done

- [ ] A changeset names `blogwright-core`, `blogwright-pds` and `blogwright` with their intended semver bumps and states that the on-disk config file shape is unchanged — only where the pds default and validation live moved.
- [ ] `DEVELOPMENT.md:100-103` (§Hexagonal architecture, "Features live in their own packages") names the `blogwright.plugin` manifest field as the mechanism, and its `PdsContext` example still reads true after task 24's narrowing.
- [ ] Any behaviour divergence surfaced by task 28 or the help-text reshaping in task 29 is named in the changeset — the spec claims no user-visible change, so an exception is stated rather than implied.
- [ ] Merge-plan bookkeeping is done: the spec's `Status:` is flipped with a `Merged:` date, the file is moved to `.specs/changes/merged/`, `.specs/README.md`'s pending list is updated, and the three open questions this work did not answer (an `afterDeploy` hook, `OpsConfig` holding plugin blocks as an opaque map, shorter pds aliases) are carried forward rather than lost in the move.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm changeset status` and `pnpm test` from the repo root, then read `DEVELOPMENT.md:100-103` and `.specs/README.md`; confirm the three packages are listed with bumps, the manifest field is named, and no pending entry points at a file that has moved.
