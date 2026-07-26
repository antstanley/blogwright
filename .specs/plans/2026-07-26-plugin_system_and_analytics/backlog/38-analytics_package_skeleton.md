# Task 38 — Scaffold the blogwright-analytics workspace package

**Plan:** [plan.md](../plan.md) · **Certificate:** [38-analytics_package_skeleton-certificate.md](38-analytics_package_skeleton-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics plugin → Namespace and commands](../../../changes/2026-07-26-analytics_plugin.md) (the plugin is a package installed with `blogwright plugin add analytics`, never a CLI dependency) and [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) ("Features live in their own packages" — a coherent feature with its own domain is its own workspace package depending on `blogwright-core`)
**Depends on:** —
**Produces:** a `packages/analytics` workspace package named `blogwright-analytics` that builds, typechecks, lints and tests through the same four scripts as `blogwright-pds`, is absent from the CLI's dependency list, and declares no plugin manifest field yet
**Pointers:** `packages/pds/package.json:19-24` (the four scripts to mirror: `tsc -p tsconfig.json`, `tsc -p tsconfig.typecheck.json`, `oxlint src`, `vitest run`), `packages/pds/package.json:6-8,47-49` (`files: ["dist"]` and `engines.node >= 22`), `packages/pds/tsconfig.json` (rootDir `src`, outDir `dist`, `types: ["node"]`, excludes `**/*.test.ts`), `packages/pds/tsconfig.typecheck.json` (`noEmit` with the exclusions cleared), `packages/pds/vitest.config.ts` (the `blogwright-core` → `../core/src/index.ts` source alias every package test resolves through), `knip.json:4-12` (the per-workspace `project` entries), `pnpm-workspace.yaml:2` (`packages/*` already globs the new directory), `packages/cli/package.json:26-30` (the dependency list that must stay free of `blogwright-analytics`), `packages/analytics/package.json` (new — the package manifest lives here)

## Steps

- [ ] Create `packages/analytics/package.json` as `blogwright-analytics`: `"type": "module"`, `"sideEffects": false`, `engines.node >= 22`, `dependencies` of exactly `blogwright-core: workspace:*`, devDependencies matching `packages/pds/package.json:29-34` (`@types/node`, `oxlint`, `typescript`, `vitest`), a `files` array shipping only `dist`, and a version matching the fixed changeset group at `.changeset/config.json:5`.
- [ ] Copy the four scripts verbatim from `packages/pds/package.json:19-24` — `build: tsc -p tsconfig.json`, `typecheck: tsc -p tsconfig.typecheck.json`, `lint: oxlint src`, `test: vitest run` — so the root `pnpm -r <script>` fan-out at `package.json:6-10` picks the package up with no root-level change.
- [ ] Add `packages/analytics/tsconfig.json` and `packages/analytics/tsconfig.typecheck.json` mirroring the pds pair: extend `../../tsconfig.base.json`, `rootDir: src`, `outDir: dist`, `types: ["node"]`, exclude `dist` and `**/*.test.ts` in the build config, and clear the exclusions under `noEmit` in the typecheck config.
- [ ] Add `packages/analytics/vitest.config.ts` with the `blogwright-core` source alias from `packages/pds/vitest.config.ts`, `environment: 'node'`, and `include: ['src/**/*.test.ts']` — task 40 widens the include to cover `transform/**` when the transform lands.
- [ ] Add a `packages/analytics` entry to the `workspaces` map at `knip.json:4-12` alongside the existing four, and seed `packages/analytics/src/index.ts` with the module doc comment stating what the package owns and no export knip would report unused.
- [ ] Deliberately omit the `blogwright.plugin` manifest field, leave `packages/cli/package.json:26-30` untouched, and state in the package `description` that the plugin is installed on demand rather than shipped with the CLI.

## Definition of done

- [ ] `packages/analytics/package.json` is named `blogwright-analytics`, is ESM (`"type": "module"`), sets `engines.node >= 22`, depends on `blogwright-core` at `workspace:*`, and carries the same four scripts as `packages/pds/package.json:19-24` plus a `files` array shipping only what consumers need.
- [ ] The `blogwright.plugin` manifest field is not declared here — it lands with the `Plugin` export at task 47, mirroring the pds ordering constraint that a package declaring the manifest without a conforming default export is a discovery error naming the package.
- [ ] `blogwright-analytics` is absent from the CLI's dependencies — `grep -n blogwright-analytics packages/cli/package.json` returns nothing, because the package is installed by `blogwright plugin add analytics`.
- [ ] `knip.json:4-12` gains a `packages/analytics` workspace entry, `pnpm knip` passes with no unused dependency and no unused export, and `pnpm -r build` and `pnpm -r test` from the repo root list the new package through the `packages/*` glob at `pnpm-workspace.yaml:2` with no `pnpm-workspace.yaml` change.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from the repo root; confirm `blogwright-analytics` appears in the per-package output and that `grep -n blogwright packages/analytics/package.json` shows the `blogwright-core` dependency but no `"blogwright": { "plugin": … }` manifest block.
