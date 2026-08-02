# Done Certificate - Task 32: Scaffold the blogwright-analytics workspace package

**Task:** [32-analytics_package_skeleton.md](32-analytics_package_skeleton.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

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
  - *Status:* ☐ unverified

- **O2 - No manifest field yet.**
  - *Claim:* the `blogwright.plugin` manifest field is absent from `packages/analytics/package.json`, deferred to task 47 with the `Plugin` export.
  - *Evidence to collect:* run `grep -n '"blogwright"' packages/analytics/package.json` - expect no match for a `"blogwright": { "plugin": … }` object (a `blogwright-core` dependency line is not a match for the manifest field); confirm `packages/analytics/src/index.ts` exports no `Plugin` default.
  - *Status:* ☐ unverified

- **O3 - Not a CLI dependency.**
  - *Claim:* `blogwright-analytics` appears in no dependency or devDependency list of `packages/cli/package.json`.
  - *Evidence to collect:* run `grep -rn blogwright-analytics packages/cli/package.json packages/core/package.json packages/pds/package.json` - expect no output; read `packages/cli/package.json:26-36` and confirm the dependency and devDependency lists are byte-identical to their state before this task.
  - *Status:* ☐ unverified

- **O4 - Workspace and knip wiring.**
  - *Claim:* `knip.json:4-12` carries a `packages/analytics` workspace entry, `pnpm knip` is clean, and the root recursive scripts pick the package up without a `pnpm-workspace.yaml` change.
  - *Evidence to collect:* read `knip.json` and confirm the new `packages/analytics` entry; run `pnpm knip` from the repo root - expect no unused dependency, export or file for the new workspace; run `pnpm -r build` and `pnpm -r test` and confirm `blogwright-analytics` appears in the per-package output; run `git diff --stat pnpm-workspace.yaml` - expect no change.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm no changeset is required, because nothing user-facing ships until the package has a `Plugin` export.
  - *Status:* ☐ unverified

- **O6 - Reviewable: fresh install, build, test and knip all list the new package (Reviewable).**
  - *Claim:* a reviewer can run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from the repo root and observe `blogwright-analytics` in the per-package output with every gate green.
  - *Evidence to collect:* run `pnpm install && pnpm -r build && pnpm -r test && pnpm knip` from `/Users/ant/code/blogwright` and capture the output; then run `grep -n blogwright packages/analytics/package.json` and confirm it shows the `blogwright-core` dependency and no `"blogwright": { "plugin": … }` block.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `knip.json:4` (the `workspaces` map) is read by `pnpm knip` at the repo root with the four existing workspace entries → expect all four still resolve and report clean : ☐ (PRESERVED / REGRESSION)
- `package.json:6-10` (the root `pnpm -r` fan-out) invokes `build`/`test`/`lint`/`typecheck` across every workspace → expect `packages/core`, `packages/cli`, `packages/pds` and `packages/build-agent` still succeed : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the package version chosen here joins the fixed changeset group at `.changeset/config.json:5` only when task 47 adds it; until then a mismatched version is a cosmetic issue, not an obligation. The `vitest.config.ts` `include` glob deliberately covers `src/**/*.test.ts` only - task 40's transform tests live outside `src/`, and widening that glob is that task's obligation, not this one's. Whether `packages/analytics` needs an entry in the oxlint `overrides` list at `.oxlintrc.json:71-84` is deferred to task 43, which introduces the first `node:fs` use in the package's build helper.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
