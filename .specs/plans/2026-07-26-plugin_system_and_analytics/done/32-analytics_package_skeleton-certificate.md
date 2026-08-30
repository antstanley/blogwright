# Done Certificate - Task 32: Scaffold the blogwright-analytics workspace package

**Task:** [32-analytics_package_skeleton.md](32-analytics_package_skeleton.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 32. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

This is the **second** discharge, after a CONCERNS verdict returned two items (D1: a surplus
module-load validation in `src/index.ts`; D2: `release.yml` never staging the package). Both
were re-verified from scratch; the previous verdict was not treated as evidence.

## Definition

DONE(Task 32) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `packages/analytics` workspace package named `blogwright-analytics` builds, typechecks, lints and tests through the same four scripts as `blogwright-pds`, is absent from the CLI's dependency list, and declares no plugin manifest field yet.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the existing four-package workspace fan-out: `pnpm -r build`, `pnpm -r test`, `pnpm -r lint` and `pnpm -r typecheck` must still succeed for `packages/core`, `packages/cli`, `packages/pds` and `packages/build-agent`, and `pnpm knip` must stay clean for all four.

## Shared checkpoints

Established once and reused by every obligation below. Workspace `/Users/ant/code/blogwright-task-32`,
working copy `ec3cef78`, `jj diff --git | shasum -a 256` =
`cbe9900ebe582eea955dfb035ac4b1f33a14ba25a860cba2d181ba413574bb1e` at the start and, re-verified,
after every probe in this discharge.

- **C1 - The change surface is ten paths.** `jj status`: `M .changeset/config.json`, `M .github/workflows/release.yml`, `M knip.json`, `M pnpm-lock.yaml`, and six added `packages/analytics/*` files. No source file of any existing package is touched.
- **C2 - The retry delta is exactly D1 and D2.** `jj evolog` exposes the previously-reviewed snapshot `6791ad95`. `jj diff --from 6791ad95 --to ec3cef78` contains two files only: `packages/analytics/src/index.ts` (the `blogwright-core` import and the `if (!PLUGIN_NAME_PATTERN.test(...)) throw` deleted, doc comment rewritten) and `.github/workflows/release.yml` (seven hunks). `packages/analytics/src/index.test.ts` does not appear in that delta - it is byte-identical to the version the first gate reviewed, and still imports `PLUGIN_NAME_PATTERN` and asserts on it.
- **C3 - The six CI gates (`.github/workflows/ci.yml:20-29`) all pass with the package present.** `pnpm install --frozen-lockfile` (`Already up to date`), `pnpm build` (0), `pnpm typecheck` (0), `pnpm test` (0), `pnpm lint` (0), `pnpm exec oxfmt --check .` (0, 142 files), `pnpm knip` (0, empty output).
- **C4 - Regression: the four existing packages are unaffected.** Same run: `packages/core` 123 passed / 1 skipped, `packages/pds` 96/96, `packages/build-agent` 27/27, `packages/cli` 234/234; all four report `Done` under build, typecheck and lint. `pnpm-lock.yaml` diff is 19 content lines added, **0 removed**. `.changeset/config.json` gains a fourth `fixed` member and loses none. `knip.json` gains one line and the four existing workspace entries are unchanged.
- **C5 - Nothing exempts the package from any gate.** `knip.json:7` is `"packages/analytics": { "project": "src/**/*.ts" }` with no `ignoreDependencies`; `.oxfmtrc.json` `ignorePatterns` and `.oxlintrc.json` `ignorePatterns`/`overrides` name no `packages/analytics` path. Proved positively rather than by reading globs: a `node:fs` import planted at `packages/analytics/src/lintprobe.ts` made `pnpm -F blogwright-analytics lint` fail with `error eslint(no-restricted-imports)`, so the root oxlint ruleset genuinely reaches the new package; a mis-formatted `packages/analytics/src/fmtprobe.ts` made `pnpm exec oxfmt --check .` fail naming that file. Both probes deleted, hash re-verified.

## Obligations

- **O1 - Package manifest shape.**
  - *Claim:* `packages/analytics/package.json` declares `name: "blogwright-analytics"`, `"type": "module"`, `engines.node >= 22`, a single `blogwright-core: "workspace:*"` dependency, the four scripts from `packages/pds/package.json:19-24`, and a `files` array shipping only the built output.
  - *Evidence to collect:* read `packages/analytics/package.json` in full and diff its `scripts`, `files`, `engines` and `dependencies` blocks field-by-field against `packages/pds/package.json:6-8,19-34,47-49`; confirm each of `build`, `typecheck`, `lint`, `test` is present with the same command shape.
  - *Evidence collected:* `name: "blogwright-analytics"`, `version: "0.3.3"` (identical to `blogwright`, `blogwright-core` and `blogwright-pds` - all four confirmed at 0.3.3 by `jq` over every workspace manifest), `"type": "module"`, `"sideEffects": false`, `files: ["dist"]`, an `exports` map with a single `.` entry (`types` then `default`), `engines.node: ">=22"`, `dependencies` of exactly `blogwright-core: "workspace:*"`, devDependencies `@types/node ^26.1.0`, `oxlint ^1.72.0`, `typescript ^6.0.3`, `vitest ^4.1.9`. All four scripts byte-identical to pds. `tsconfig.json`/`tsconfig.typecheck.json` mirror the pds pair; `vitest.config.ts` carries the `blogwright-core` -> `../core/src/index.ts` alias verbatim. Packaging verified end to end rather than by inspection: `pnpm pack` produced `blogwright-analytics-0.3.3.tgz` containing `package/dist/index.js`, `package/dist/index.d.ts`, `package/package.json`, `package/LICENSE` - so `files: ["dist"]` and both `exports` targets resolve in the published artifact.
  - *Status:* ☑ SATISFIED

- **O2 - No manifest field yet.**
  - *Claim:* the `blogwright.plugin` manifest field is absent from `packages/analytics/package.json`, deferred to task 47 with the `Plugin` export.
  - *Evidence to collect:* run `grep -n '"blogwright"' packages/analytics/package.json` - expect no match for a `"blogwright": { "plugin": … }` object (a `blogwright-core` dependency line is not a match for the manifest field); confirm `packages/analytics/src/index.ts` exports no `Plugin` default.
  - *Evidence collected:* `grep -n blogwright packages/analytics/package.json` returns four lines only - `:2` name, `:22` the `blogwright-core` dependency, `:30` description, `:40` repository URL. No `"blogwright"` manifest key. `packages/analytics/src/index.ts` is 23 lines, of which 22 are comment: its whole executable surface is `export const ANALYTICS_NAMESPACE = 'analytics';`, with no default export. `packages/analytics/dist/index.js` confirms the emitted module is the same single `const` - **no top-level statement of any kind**, so `"sideEffects": false` at `package.json:5` is now true, which is what D1 was about. `blogwright` appears in neither `dependencies` nor `devDependencies`. Consuming path re-checked: `loadCandidate` (`packages/cli/src/plugins.ts:244-249`) returns `{ kind: 'not-a-plugin' }` and skips silently for a manifest with no `blogwright` field, never resolving or importing the module - so the package stays invisible to discovery until task 47.
  - *Status:* ☑ SATISFIED

- **O3 - Not a CLI dependency.**
  - *Claim:* `blogwright-analytics` appears in no dependency or devDependency list of `packages/cli/package.json`.
  - *Evidence to collect:* run `grep -rn blogwright-analytics packages/cli/package.json packages/core/package.json packages/pds/package.json` - expect no output; read `packages/cli/package.json:26-36` and confirm the dependency and devDependency lists are byte-identical to their state before this task.
  - *Evidence collected:* `grep -rn blogwright-analytics packages/cli/package.json packages/core/package.json packages/pds/package.json packages/build-agent/package.json package.json` exits 1 with no output. By C1 no manifest outside `packages/analytics` was modified at all, so the CLI's lists are byte-identical to their prior state. The name does occur in `.changeset/config.json`, `knip.json`, `.github/workflows/release.yml` and `pnpm-lock.yaml` - none of which is a dependency edge - and in two pre-existing CLI test fixtures that use it as a package-manager argument string.
  - *Status:* ☑ SATISFIED

- **O4 - Workspace and knip wiring.**
  - *Claim:* `knip.json:4-12` carries a `packages/analytics` workspace entry, `pnpm knip` is clean, and the root recursive scripts pick the package up without a `pnpm-workspace.yaml` change.
  - *Evidence to collect:* read `knip.json` and confirm the new `packages/analytics` entry; run `pnpm knip` from the repo root - expect no unused dependency, export or file for the new workspace; run `pnpm -r build` and `pnpm -r test` and confirm `blogwright-analytics` appears in the per-package output; run `git diff --stat pnpm-workspace.yaml` - expect no change.
  - *Evidence collected:* `knip.json:7` is the new entry (C5). `pnpm knip` exits 0 with empty output. `pnpm -r build` runs `packages/analytics build$ tsc -p tsconfig.json` -> `Done`; `pnpm -r test` runs `packages/analytics test$ vitest run` -> `Test Files 1 passed (1)` / `Tests 2 passed (2)`. `pnpm-workspace.yaml` is absent from `jj status`; the `packages/*` glob at line 2 picks the directory up.
  - *Negative control, re-run from scratch for D1:* with `packages/analytics/src/index.ts` carrying **no** `blogwright-core` import (its post-fix state) and the import additionally stripped from `src/index.test.ts`, `pnpm knip` fails: `Unused dependencies (1) blogwright-core packages/analytics/package.json:22:6`, exit 1. Restoring the test's import alone returns knip to exit 0. So the test is now the sole and sufficient consumer, the knip entry is load-bearing, and no `ignoreDependencies` exception was needed. Working copy restored byte-identically (hash re-verified against C1).
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm no changeset is required, because nothing user-facing ships until the package has a `Plugin` export.
  - *Evidence collected:* C3 - all six `DEVELOPMENT.md:306-325` / `ci.yml:20-29` gates run in CI order and pass, with C5 proving the package is inside the lint and format gates rather than skipped by them. The only `pnpm lint` output is the pre-existing `no-shadow` warning set in `packages/cli/src/nodes.test.ts`, a file this task does not touch. No changeset was added; none is required, because the package exports one namespace constant, declares no manifest field, and is a dependency of nothing, so no user-facing surface ships from this task. Its version still moves - see the O5 sub-check below.
  - *Typecheck coverage probe for `src/transform/` (re-run independently, not accepted from an `include` glob):* `packages/analytics/src/transform/probe.ts` and `packages/analytics/src/transform/probe.test.ts` were each given `export const x: number = "string"`. `pnpm typecheck` failed with exit 2, reporting `src/transform/probe.test.ts(1,14): error TS2322` **and** `src/transform/probe.ts(1,14): error TS2322`. So `src/transform/` - source and test files alike - is genuinely inside `tsconfig.typecheck.json`'s reach (`include: ["src/**/*"]` with `exclude: []`), which is what task 40 will depend on. Directory deleted, `pnpm typecheck` back to 0, hash re-verified.
  - *Changeset-group probe (the mechanism `.changeset/config.json:5` and D2 both rest on):* the fixed group's behaviour was proved rather than assumed. An isolated four-package scratch monorepo was built with this repo's `.changeset/config.json` (`fixed: [["blogwright", "blogwright-core", "blogwright-pds", "blogwright-analytics"]]`), all members at 0.3.3, and a single changeset naming only `blogwright`, `blogwright-core` and `blogwright-pds` - the shape of the real pending `.changeset/generic-plugin-dispatch.md`. `changeset version` bumped **all four**, including `blogwright-analytics`, to 0.4.0. So the group entry does deliver `blogwright-analytics@<cli version>` at the version task 18's `plugin add` will ask for, and `release.yml:34`'s version-match loop will find the package at the tag version.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: fresh install, build, test and knip all list the new package (Reviewable).**
  - *Claim:* a reviewer can run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from the repo root and observe `blogwright-analytics` in the per-package output with every gate green.
  - *Evidence to collect:* run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from the repo root and capture the output; then run `grep -n blogwright packages/analytics/package.json` and confirm it shows the `blogwright-core` dependency and no `"blogwright": { "plugin": … }` block.
  - *Evidence collected:* run verbatim as one command line; exit 0. The log shows `packages/analytics build$ tsc -p tsconfig.json` / `packages/analytics build: Done`, and `packages/analytics test$ vitest run` / `Test Files 1 passed (1)` / `Tests 2 passed (2)`, alongside all five other workspaces green; `knip` produced no findings. `grep -n blogwright packages/analytics/package.json` returns lines 2, 22, 30 and 40 and no manifest block (O2).
  - *Status:* ☑ SATISFIED

## D1 and D2 - the two returned items

- **D1 - the module-load validation is gone.** `packages/analytics/src/index.ts` contains no `blogwright-core` import and no top-level `if`/`throw` (C2 shows the exact deletion). `src/index.test.ts` is unchanged and still pins the same predicate through `PLUGIN_NAME_PATTERN`. `pnpm knip` is green with the test as the sole consumer, and red without it (O4 negative control). `dist/index.js` is now a bare `const` export, so `"sideEffects": false` states the truth. **Discharged.**

- **D2 - `release.yml` stages the package, at every site.** The file was read end to end (218 lines) and every enumeration of the published set located by grep. There are seven, all updated: `:4-6` header comment, `:34` version-match loop, `:49` preflight loop, `:90` publint loop, `:99` arethetypeswrong loop, `:132` the `stage` call, `:210` the GitHub Release body. **No hard-coded list omitting the package remains.** Checked in detail:
  - *Nothing else should be there.* The two workspaces absent from these loops are `blogwright-build-agent` and `blogwright-docs`, both `"private": true` and both in `.changeset/config.json`'s `ignore` list. `blogwright-analytics` is neither, so it belongs in all seven.
  - *Tarball name.* `pnpm pack` in `packages/analytics` emitted exactly `blogwright-analytics-0.3.3.tgz`, matching `"blogwright-analytics-${VERSION}.tgz"` at `:132` and the `<name>-<version>.tgz` convention its three neighbours use.
  - *Ordering.* `core pds analytics cli`. `blogwright-analytics` depends only on `blogwright-core`, which precedes it; `blogwright` (cli) follows. Consistent with the step's "dependency order" comment.
  - *YAML.* `yaml.safe_load` parses the file; the `Stage packages` step's `run` block round-trips with all four `stage` calls intact and the heredoc-free shell function unbroken.
  - *The `bin` claim was verified, not accepted.* Run against the real commands in `packages/analytics`: `npx --yes publint` -> `All good!`, exit 0; `npx --yes @arethetypeswrong/cli --pack --profile esm-only` -> `node16 (from ESM) 🟢`, `bundler 🟢`, exit 0. Both also re-run against `packages/pds` (exit 0, 0) as the stated binless precedent. Neither tool, nor `npm stage publish --provenance --access public --ignore-scripts`, has any input conditioned on a `bin` field. The claim holds.
  - *Failure mode if the group were ever misconfigured.* Adding analytics to the `:34` loop is not merely cosmetic: a version drift between the changeset group and the tag now aborts the release loudly at `validate` rather than silently omitting the package - the inverse of the failure D2 existed to close.
  - **Discharged.**

- **Judgement on the two extra prose edits: keep both.**
  - `:4-6` (header comment) enumerates the same published set as the loops below it. Leaving it saying "blogwright-core, blogwright-pds, and blogwright" while the workflow stages four packages would be a stale comment on the file's own contract. In scope, correct. Nit only: the rewrap leaves `:7` (`# live until approved out-of-band`) short of the surrounding fill width. `.oxfmtrc.json` ignores `.github/**`, so no gate is involved; purely cosmetic.
  - `:210` (Release body) is **load-bearing, not prose**. Staged packages go live only when a human runs `npm stage approve` against each one, and this list is what tells the operator which. Had it stayed at three names, an operator would approve core, pds and cli and leave `blogwright-analytics` sitting in staging - reproducing exactly the `plugin add analytics` 404 that D2 was raised to prevent, one step later in the pipeline. Keeping it is required for D2 to actually work.

## Regression check

- `knip.json:4` (the `workspaces` map) read by `pnpm knip` at the repo root → expect the four existing entries still resolve and report clean : ☑ PRESERVED (C4, C3).
- `package.json:6-10` (the root `pnpm -r` fan-out) invoking `build`/`test`/`lint`/`typecheck` across every workspace → expect `packages/core`, `packages/cli`, `packages/pds` and `packages/build-agent` still succeed : ☑ PRESERVED (C4 - 123/1s, 234, 96 and 27 tests respectively, all four `Done` on the other three scripts).
- `.changeset/config.json:5` (the fixed version group) read by `changeset version` → expect the three existing members still grouped : ☑ PRESERVED - the array gains a fourth element and loses none, all four members sit at 0.3.3, none is in `ignore`, and the O5 scratch-monorepo probe shows `changeset version` moving all four together.
- `.github/workflows/release.yml` (the tag-driven publish) → expect the three existing packages still validated, linted, staged and announced exactly as before : ☑ PRESERVED - every hunk is an insertion into a list; no existing package name, loop body, `stage` argument or step was altered, and the file still parses.

## Residue

- **`plan.md:347` (M6) and `plan.md:393` (the "After task 46" cut line) are now stale.** Both state that `packages/analytics` "is not published". With `release.yml` staging it, a release cut at either the after-38 or after-46 cut line will publish `blogwright-analytics@<version>` to npm - an inert package with no `blogwright.plugin` field. That is the intended and unavoidable consequence of the plan's own settled decision at `plan.md:623-628` (the package versions in lockstep so `blogwright-analytics@<cli version>` exists on the registry), so the diff is right and the two prose lines are what is out of date. It falsifies no obligation here - the task's inertness criteria are the manifest field, the CLI dependency and `blogwright` in the manifest, all of which hold. Follow-up for whoever owns the plan document, or for task 58's documentation pass: reword those two lines, and note the interim behaviour they now describe - between task 32 and task 47, `blogwright plugin add analytics` will install successfully and then be skipped silently by `loadCandidate` as `not-a-plugin`, rather than failing with a registry 404.
- **Unverifiable here, and worth confirming before the next tag:** `npm stage publish` under OIDC trusted publishing needs a trusted-publisher configuration on the npm package, and `blogwright-analytics` has never existed on the registry. If npm requires a first manual publish before that configuration can be created, the first tagged release after this lands will fail at `release.yml:132` - and because analytics is staged before cli, `blogwright` itself would not be staged in that run, leaving a partial release that needs a re-run. This is an operational prerequisite of publishing any new package name, not a defect in the diff, and it cannot be tested from this workspace. Flagged because it fails only at release time.
- The `packages/analytics` oxlint `overrides` question (`.oxlintrc.json:71-84`) remains deferred to task 43, which introduces the package's first `node:fs` use. Confirmed still open and still correctly deferred: C5 shows the restriction is live in this package today.
- Superseding two notes carried by the previous discharge: the changeset-group entry belongs to task 32 (`plan.md:623-628`), not task 47, and it is present; and task 40 owes no widening of the vitest `include`, because `plan.md:742` places the transform at `packages/analytics/src/transform/`, which `src/**/*.test.ts` already covers and which the O5 probe proves is type-checked.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED against freshly collected evidence and all four regression checks are PRESERVED; D1 is gone with knip still green on the test as sole consumer (proved by negative control) and `sideEffects: false` now truthful, and D2 is complete at all seven enumerations in `release.yml` with the tarball name, ordering, YAML and `bin`-independence each verified by execution rather than by assertion - the only residue is two stale prose lines in `plan.md`, which the diff does not own.
