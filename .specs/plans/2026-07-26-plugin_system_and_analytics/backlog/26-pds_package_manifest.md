# Task 26 — Declare the plugin manifest field in packages/pds/package.json

**Plan:** [plan.md](../plan.md) · **Certificate:** [26-pds_package_manifest-certificate.md](26-pds_package_manifest-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Package manifest (Add)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) (`{ "blogwright": { "plugin": "pds" } }`; the package name is unchanged and `blogwright/rkey` keeps re-exporting `blogwright-pds/rkey`)
**Depends on:** 08, 25
**Produces:** `blogwright-pds` is discoverable as the `pds` plugin from a consuming repo that depends only on `blogwright`, with `blogwright plugin list` reporting it — while `blogwright pds <action>` still runs through the hardcoded branch, so nothing user-visible moves yet
**Pointers:** `packages/pds/package.json:2` (`"name": "blogwright-pds"`, unchanged), `packages/pds/package.json:8-17` (the `.` and `./rkey` export conditions that must stay byte-identical), `packages/cli/src/plugins.ts` (new at task 08 — discovery, including the bundled-plugin path), `packages/cli/src/plugins.test.ts` (task 08's discovery tests, extended here), `packages/cli/package.json:28` (`"blogwright-pds": "workspace:*"` — why pds is in the CLI's own bundle), `packages/cli/src/rkey.ts:7` and `packages/cli/src/rkey.test.ts` (the subpath contract), `packages/cli/src/cli.ts:114` (the hardcoded branch that still wins)

## Steps

- [ ] Delete the static `pds` block from the `USAGE` string (`packages/cli/src/cli.ts:33-47`) in THIS task, not in task 29. The manifest field added here makes `blogwright-pds` discoverable, so task 11's dynamic help section starts rendering pds immediately; leaving the static block until 29 would list every pds action twice in `blogwright --help` for the whole span 26→29. That is a user-visible change inside a migration whose spec forbids one. Removing it here keeps help correct at every commit, because the dynamic section replaces it in the same step that creates it.

- [ ] Add `"blogwright": { "plugin": "pds" }` to `packages/pds/package.json`, changing nothing else — `name`, `version`, `files`, `exports`, `scripts`, `dependencies` and `engines` all stay as they are.
- [ ] Extend `packages/cli/src/plugins.test.ts` with a discovery case whose fake consuming repo `package.json` lists only `blogwright` as a dependency, and assert `blogwright-pds` is discovered through the CLI's own bundle rather than the consumer's dependency list.
- [ ] Add the `blogwright plugin list` assertion covering the `pds` row: namespace, package version, and the `pds` config key.
- [ ] Verify `blogwright/rkey` is untouched by running `packages/cli/src/rkey.test.ts` unmodified, and confirm `npm pack --dry-run` on `packages/pds` still ships the same `files` set.
- [ ] Confirm the migration is still inert: `blogwright pds sync` and the other five actions continue to run through `runPds` at `packages/cli/src/cli.ts:114`, since the built-in branch is checked before plugin dispatch.

## Definition of done

- [ ] `packages/pds/package.json` contains `"blogwright": { "plugin": "pds" }`, its `name` is still `blogwright-pds`, and the `.` and `./rkey` export conditions are byte-identical to before.
- [ ] A discovery test proves the CLI discovers `blogwright-pds` from a consuming repo whose `package.json` depends only on `blogwright` — the bundled-plugin path added at task 08; this is the concrete assertion the migration's "no install step" guarantee rests on.
- [ ] `blogwright plugin list` reports `pds` with its namespace, version and the `pds` config key — asserted by a test, not by manual inspection.
- [ ] `blogwright/rkey` still re-exports `blogwright-pds/rkey` (`packages/cli/src/rkey.test.ts` passes unchanged), and there is no behaviour change for `blogwright pds <action>` yet — the hardcoded branch at `packages/cli/src/cli.ts:114` still handles every action and the existing pds command paths are unaffected.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- plugins` and `pnpm test -- rkey` in `packages/cli`; confirm the bundled-discovery case passes, the `plugin list` row names `pds`, and the rkey vectors are untouched.
