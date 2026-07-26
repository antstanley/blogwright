# Task 20 — Document the plugin surface and close the plugin-system change spec

**Plan:** [plan.md](../plan.md) · **Certificate:** [20-plugin_system_docs_and_closure-certificate.md](20-plugin_system_docs_and_closure-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §Merge plan](../../../changes/2026-07-26-cli_plugin_system.md) (all five steps) and §Ports → `ModuleLoader` and §Ports → `PackageManager` (the two rows the ports table gains)
**Depends on:** 05, 06, 11, 14, 16, 18, 19
**Produces:** consumer docs for `blogwright plugin add|list|remove` and `blogwright <plugin> <action>`, the two new ports recorded in DEVELOPMENT.md's ports table, a changeset for the whole user-facing surface, and the change spec merged with its unanswered questions carried forward
**Pointers:** `README.md:40-56` (the Commands block that gains the plugin lines), `DEVELOPMENT.md:72-81` (§Hexagonal architecture's ports table), `DEVELOPMENT.md:356-366` (the lint-enforcement Decisions bullet listing the adapter exceptions), `.specs/changes/2026-07-26-cli_plugin_system.md:3` (the `Status:` header line to flip), `.specs/changes/2026-07-26-cli_plugin_system.md:291-302` (the merge plan), `.specs/changes/2026-07-26-cli_plugin_system.md:351-367` (the open questions to triage), `.specs/README.md:19-34` (the pending list), `.specs/README.md:35-43` (the merged list)

## Steps

- [ ] Add the plugin commands to `README.md`'s Commands block (`README.md:40-56`) beside the existing `preview` and `pds` lines, and add a short paragraph stating that the plugin SPI is internal and unversioned so no third party should write against it yet.
- [ ] Add the `ModuleLoader` and `PackageManager` rows to the ports table at `DEVELOPMENT.md:72-81`, each naming the port file, the real adapter and the test substitute, in the same column shape as the `Vcs` and `PingBuilder` rows.
- [ ] Write the changeset covering the user-facing surface this spec adds — the `plugin` namespace, generic plugin dispatch, the plugin lifecycle verbs, and the help output's Plugins section — with the semver impact stated.
- [ ] Execute the merge plan: flip `Status:` to `Merged` with a `Merged:` date on `.specs/changes/2026-07-26-cli_plugin_system.md`, move the file to `.specs/changes/merged/`, and update both lists in `.specs/README.md` so the pending list drops to two proposals and the merged list gains this one.
- [ ] Carry the unanswered questions forward in writing rather than dropping them: SPI version declaration (task 18's pinning is the only mechanism today), `destroy` versus live plugin resources, whether `plugin remove` should offer teardown, and whether `preview` becomes a plugin — plus the lifecycle-verb precedence decision recorded at task 16.

## Definition of done

- [ ] `README.md` documents `blogwright plugin add|list|remove` and `blogwright <plugin> <action>` alongside the existing command list, and states that the SPI is internal and unversioned so no third party writes against it yet.
- [ ] `DEVELOPMENT.md` §Hexagonal architecture's ports table contains the `ModuleLoader` and `PackageManager` rows added by tasks 05 and 06, each naming the port file, the real adapter and the test substitute.
- [ ] A changeset covers the user-facing surface added by this spec with the semver impact stated, and the change spec's merge plan is executed: `Status:` flipped to `Merged` with a `Merged:` date, the file moved to `.specs/changes/merged/`, and `.specs/README.md`'s pending and merged lists updated.
- [ ] The spec's open questions this work did not answer are carried forward in writing rather than dropped — SPI version declaration, `destroy` versus live plugin resources, whether `plugin remove` should offer teardown, and whether `preview` becomes a plugin — as is the lifecycle-verb precedence decision recorded at task 16.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`, then confirm `.specs/changes/2026-07-26-cli_plugin_system.md` no longer exists at that path, that `.specs/changes/merged/` holds it with a `Merged:` date, and that no link in `.specs/README.md` is broken.
