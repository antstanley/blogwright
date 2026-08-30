# Done Certificate - Task 32: Scaffold the blogwright-analytics workspace package

**Task:** [32-analytics_package_skeleton.md](32-analytics_package_skeleton.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 32. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 32) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `packages/analytics` workspace package named `blogwright-analytics` builds, typechecks, lints and tests through the same four scripts as `blogwright-pds`, is absent from the CLI's dependency list, and declares no plugin manifest field yet.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the existing four-package workspace fan-out: `pnpm -r build`, `pnpm -r test`, `pnpm -r lint` and `pnpm -r typecheck` must still succeed for `packages/core`, `packages/cli`, `packages/pds` and `packages/build-agent`, and `pnpm knip` must stay clean for all four.

## Obligations

- **O1 - Package manifest shape.**
  - *Claim:* `packages/analytics/package.json` declares `name: "blogwright-analytics"`, `"type": "module"`, `engines.node >= 22`, a single `blogwright-core: "workspace:*"` dependency, the four scripts from `packages/pds/package.json:19-24`, and a `files` array shipping only the built output.
  - *Evidence to collect:* read `packages/analytics/package.json` in full and diff its `scripts`, `files`, `engines` and `dependencies` blocks field-by-field against `packages/pds/package.json:6-8,19-34,47-49`; confirm each of `build`, `typecheck`, `lint`, `test` is present with the same command shape.
  - *Evidence collected:* `packages/analytics/package.json` declares `name: "blogwright-analytics"`, `version: "0.3.3"` (identical to `blogwright`, `blogwright-core` and `blogwright-pds`), `"type": "module"`, `"sideEffects": false`, `files: ["dist"]`, an `exports` map with a single `.` entry (`types` then `default`), `engines.node: ">=22"`, `dependencies` of exactly `blogwright-core: "workspace:*"`, and devDependencies `@types/node ^26.1.0`, `oxlint ^1.72.0`, `typescript ^6.0.3`, `vitest ^4.1.9` - field-for-field the pds shape at `packages/pds/package.json:6-8,19-34,47-49`. All four scripts are byte-identical to pds: `build: tsc -p tsconfig.json`, `typecheck: tsc -p tsconfig.typecheck.json`, `lint: oxlint src`, `test: vitest run`. `tsconfig.json` and `tsconfig.typecheck.json` mirror the pds pair (the only divergence is the absent `src/test-support.ts` exclusion, which has no counterpart here). `vitest.config.ts` carries the `blogwright-core` -> `../core/src/index.ts` alias verbatim.
  - *Status:* ☑ SATISFIED

- **O2 - No manifest field yet.**
  - *Claim:* the `blogwright.plugin` manifest field is absent from `packages/analytics/package.json`, deferred to task 47 with the `Plugin` export.
  - *Evidence to collect:* run `grep -n '"blogwright"' packages/analytics/package.json` - expect no match for a `"blogwright": { "plugin": … }` object (a `blogwright-core` dependency line is not a match for the manifest field); confirm `packages/analytics/src/index.ts` exports no `Plugin` default.
  - *Evidence collected:* `grep -n blogwright packages/analytics/package.json` returns four lines only - `:2` the package name, `:22` the `blogwright-core` dependency, `:30` the description, `:40` the repository URL. No `"blogwright"` manifest key exists. `packages/analytics/src/index.ts` has one export, the named `ANALYTICS_NAMESPACE`, and no default export. Confirmed against the consuming path: `loadCandidate` (`packages/cli/src/plugins.ts:243-247`) returns `{ kind: 'not-a-plugin' }` for a manifest with no `blogwright` field and never loads the module, so the package is invisible to discovery until task 47.
  - *Status:* ☑ SATISFIED

- **O3 - Not a CLI dependency.**
  - *Claim:* `blogwright-analytics` appears in no dependency or devDependency list of `packages/cli/package.json`.
  - *Evidence to collect:* run `grep -rn blogwright-analytics packages/cli/package.json packages/core/package.json packages/pds/package.json` - expect no output; read `packages/cli/package.json:26-36` and confirm the dependency and devDependency lists are byte-identical to their state before this task.
  - *Evidence collected:* `grep -n blogwright-analytics packages/cli/package.json packages/core/package.json packages/pds/package.json packages/build-agent/package.json` exits 1 with no output. `jj status` lists exactly nine paths - `.changeset/config.json`, `knip.json`, `pnpm-lock.yaml` and the six new `packages/analytics/*` files - so no package manifest outside `packages/analytics` was touched at all. The repo-wide `blogwright-analytics` occurrences outside those nine are pre-existing string literals in `packages/cli/src/test-support.test.ts` and `packages/cli/src/adapters/process-package-manager.test.ts`, which use the name as a package-manager argument fixture, not a dependency. `blogwright` itself appears in neither `dependencies` nor `devDependencies` of `packages/analytics/package.json`.
  - *Status:* ☑ SATISFIED

- **O4 - Workspace and knip wiring.**
  - *Claim:* `knip.json:4-12` carries a `packages/analytics` workspace entry, `pnpm knip` is clean, and the root recursive scripts pick the package up without a `pnpm-workspace.yaml` change.
  - *Evidence to collect:* read `knip.json` and confirm the new `packages/analytics` entry; run `pnpm knip` from the repo root - expect no unused dependency, export or file for the new workspace; run `pnpm -r build` and `pnpm -r test` and confirm `blogwright-analytics` appears in the per-package output; run `git diff --stat pnpm-workspace.yaml` - expect no change.
  - *Evidence collected:* `knip.json:7` now reads `"packages/analytics": { "project": "src/**/*.ts" }`, with no `ignoreDependencies` and no other exemption - the only `ignoreDependencies` in the file remains the pre-existing `blogwright-build-agent` entry under `packages/cli`. `pnpm knip` exits 0 with empty output. `pnpm -r build` runs `packages/analytics build$ tsc -p tsconfig.json` -> `Done`; `pnpm -r test` runs `packages/analytics test$ vitest run` -> `Test Files 1 passed (1) / Tests 2 passed (2)`; `pnpm -r lint` runs `packages/analytics lint$ oxlint src` -> `Done`; `pnpm -r typecheck` runs `packages/analytics typecheck$ tsc -p tsconfig.typecheck.json` -> `Done`. `pnpm-workspace.yaml` is unmodified (absent from `jj status`); the `packages/*` glob at line 2 picks the directory up. The lockfile diff is purely additive: 19 added lines, 0 removed.
  - *Negative control (the knip entry is load-bearing, and so is the dependency's consumer):* with the `blogwright-core` import removed from BOTH `src/index.ts` and `src/index.test.ts`, `pnpm knip` fails with `Unused dependencies (1) blogwright-core packages/analytics/package.json:22:6`. With the import present in only one of the two, `pnpm knip` exits 0 either way - so each consumer is independently sufficient. All temporary edits were reverted and the working copy restored byte-identically (`jj diff --git | shasum -a 256` = `edffcd8ae822ef8fd124c3012ca9eddb4139a3a1099484ab19e293e2a301bc9b` before and after).
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm no changeset is required, because nothing user-facing ships until the package has a `Plugin` export.
  - *Evidence collected:* all six `.github/workflows/ci.yml:20-29` gates run in CI order, WITH the package present and with nothing exempting it: `pnpm install --frozen-lockfile` (`Already up to date`), `pnpm build` (exit 0), `pnpm typecheck` (exit 0), `pnpm test` (exit 0; 2 + 96 + 27 + 234 + core's suite all passing), `pnpm lint` (exit 0; the only output is the pre-existing `no-shadow` warning set in `packages/cli/src/nodes.test.ts`, untouched by this task), `pnpm exec oxfmt --check .` (exit 0, `All matched files use the correct format`, 142 files), `pnpm knip` (exit 0). `.oxfmtrc.json` `ignorePatterns` and `.oxlintrc.json` `ignorePatterns`/`overrides` name no `packages/analytics` path, so the new files are genuinely covered by the format and lint gates rather than skipped. No changeset was added and none is required - no user-facing surface ships from this task.
  - *Typecheck coverage probe (the DEVELOPMENT.md gate that matters most for task 40):* a deliberate type error was planted at `packages/analytics/src/transform/probe.ts` and a second at `packages/analytics/src/transform/probe.test.ts`; `pnpm typecheck` failed with exit 2 and reported `src/transform/probe.test.ts(1,14): error TS2322` and `src/transform/probe.ts(1,14): error TS2322`. So `src/transform/` - source AND test files - is inside the typecheck tsconfig's reach through `include: ["src/**/*"]` with `exclude: []`, not merely inside the build's. Both probes were deleted and the working copy hash re-verified.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: fresh install, build, test and knip all list the new package (Reviewable).**
  - *Claim:* a reviewer can run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from the repo root and observe `blogwright-analytics` in the per-package output with every gate green.
  - *Evidence to collect:* run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from `/Users/ant/code/blogwright` and capture the output; then run `grep -n blogwright packages/analytics/package.json` and confirm it shows the `blogwright-core` dependency and no `"blogwright": { "plugin": … }` block.
  - *Evidence collected:* the command was run verbatim in the task workspace and exited 0. The captured log shows `packages/analytics build$ tsc -p tsconfig.json` / `Done` and `packages/analytics test$ vitest run` / `Test Files 1 passed (1)` / `Tests 2 passed (2)`, and `knip` produced no findings. `grep -n blogwright packages/analytics/package.json` returns lines 2, 22, 30 and 40 - name, `"blogwright-core": "workspace:*"`, description and repository URL - and no `"blogwright": { "plugin": … }` block.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `knip.json:4` (the `workspaces` map) is read by `pnpm knip` at the repo root with the four existing workspace entries → expect all four still resolve and report clean : ☑ PRESERVED - the edit is one added line at `knip.json:7`; the four existing entries are unchanged and `pnpm knip` exits 0 with no findings for any workspace.
- `package.json:6-10` (the root `pnpm -r` fan-out) invokes `build`/`test`/`lint`/`typecheck` across every workspace → expect `packages/core`, `packages/cli`, `packages/pds` and `packages/build-agent` still succeed : ☑ PRESERVED - all four report `Done` under `build`, `typecheck` and `lint`, and their suites pass unchanged (core, `packages/pds` 96/96, `packages/build-agent` 27/27, `packages/cli` 234/234). The lockfile diff removes no line, and no manifest outside `packages/analytics` was modified.
- `.changeset/config.json:5` (the fixed version group) is read by `changeset version` → expect the three existing members still grouped : ☑ PRESERVED - the array gains a fourth element and loses none; `blogwright-analytics` is at `0.3.3`, matching all three existing members, and is absent from the `ignore` list, so `changeset version` will keep it in lockstep.

## Residue

Notes for the validator: the package version chosen here joins the fixed changeset group at `.changeset/config.json:5` only when task 47 adds it; until then a mismatched version is a cosmetic issue, not an obligation. The `vitest.config.ts` `include` glob deliberately covers `src/**/*.test.ts` only - task 40's transform tests live outside `src/`, and widening that glob is that task's obligation, not this one's. Whether `packages/analytics` needs an entry in the oxlint `overrides` list at `.oxlintrc.json:71-84` is deferred to task 43, which introduces the first `node:fs` use in the package's build helper.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED against collected evidence and both regression checks are PRESERVED - the package builds, typechecks, lints, tests, formats and passes knip with nothing exempting it, carries no plugin manifest field, and is a dependency of nothing - so the task is DONE; the one open item is a design concern recorded below, not an unmet obligation.

## Validator notes - open design concern (does not falsify any obligation)

**The module-load validation in `packages/analytics/src/index.ts:14,25-29` is surplus, and it contradicts the package's own `sideEffects: false`.**

The import of `PLUGIN_NAME_PATTERN` plus the top-level `if (!PLUGIN_NAME_PATTERN.test(ANALYTICS_NAMESPACE)) throw` was taken in preference to a knip `ignoreDependencies` exception, on the stated ground that it gives the `blogwright-core` dependency a real consumer. Measured, that ground does not hold: `src/index.test.ts:11-13` already imports `PLUGIN_NAME_PATTERN` and asserts the same predicate, and `pnpm knip` exits 0 on that import alone (verified by removing the production import and re-running). knip needed one consumer; the test was already it.

What the runtime check adds over the test is nothing that can vary:

- Both operands are compile-time constants - a string literal 11 lines above and a fixed regex at `packages/core/src/plugin.ts:288`. No install-time or runtime state can make the predicate fail in production and pass in CI, so the only event it can catch is a source edit, which is exactly what `pnpm test` gates on every task.
- It is unreachable through the product's own path today: with no `blogwright.plugin` manifest field, `loadCandidate` (`packages/cli/src/plugins.ts:243-247`) classifies the package `not-a-plugin` and never imports it. Its only execution outside vitest begins at task 47.
- Once task 47 lands, it duplicates `packages/core/src/plugin.ts:413-417`, which rejects the same value through `rejectPlugin(packageName, …)` - a message naming the package and the field. The module-load throw fires first and is caught by `loadCandidate`'s try/catch, so it does not crash the CLI, but it substitutes a generic error for core's specific one on the same defect.

Against that, it makes a package the task requires to be **inert** into one whose import can throw, while `packages/analytics/package.json:5` declares `"sideEffects": false` - which tells a bundler the opposite. Demonstrated with esbuild against the built `dist/`: a consumer that imports `ANALYTICS_NAMESPACE` keeps the check, but a consumer that imports the module without using its exports has the module and the check erased entirely. The declaration and the code disagree, and the declaration is the one downstream tools believe.

*Preferred repair (2 lines deleted, no exception taken):* drop the import and the `if`/`throw` from `src/index.ts` and keep `src/index.test.ts` exactly as written. Verified to leave `pnpm knip` green. It is strictly better than the two alternatives on the table - it needs no `ignoreDependencies` entry, because the dependency keeps a genuine behaviour-asserting consumer; it keeps the fail-fast property, since drift reddens `pnpm test`, a gate every downstream task inherits; it restores `sideEffects: false` to truth; and it does not pull task 39's or task 44's modules forward into this one.

## Validator notes - out-of-scope finding for the plan, not for task 32

`.changeset/config.json:5` now carries `blogwright-analytics`, as the task's first step requires, and that is necessary for `blogwright-analytics@<cli version>` to exist on the registry. It is not sufficient. `.github/workflows/release.yml` enumerates the published set by hand in three places - the version-match loop at `:32`, the preflight at `:47`, and the three `stage …` calls at `:128-130` - and all three list `core pds cli` only. As things stand the fixed group will version-bump `blogwright-analytics` in lockstep and nothing will ever stage it to npm, so task 18's `blogwright plugin add analytics` would still resolve a version that was never published. No task in the plan currently owns `release.yml`; the natural home is task 58 or 61 alongside the other release-time work. Recorded here because the changeset entry's stated purpose is not achieved by the changeset entry alone.

*Stale note corrected:* the Residue section above states that the changeset group entry lands at task 47. That is superseded - the plan's own Decision log ("`blogwright-analytics` joins the fixed changeset group", plan.md:623-628) assigns it to task 32, the task's first step requires it, and it is present.

*Second stale note:* the Residue section above also says task 40's transform tests "live outside `src/`" and that task 40 must widen the vitest `include`. plan.md:742 places the transform at `packages/analytics/src/transform/`, which `include: ['src/**/*.test.ts']` already covers, and the typecheck probe above confirms `src/transform/*.test.ts` is type-checked as written. No widening is owed by task 40 on current evidence; nothing is owed by task 32 either way, since the config was copied from pds verbatim as instructed.
