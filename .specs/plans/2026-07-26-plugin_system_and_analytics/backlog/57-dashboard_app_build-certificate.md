# Done Certificate — Task 58: The SvelteKit dashboard app, built to dist/app and shipped prebuilt

**Task:** [57-dashboard_app_build.md](57-dashboard_app_build.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 57. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 58) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The SvelteKit + LayerChart application under `packages/analytics/app/` builds to `dist/app` through the package's own `build` script, ships in its `files`, calls only the named-query routes, and every gate exclusion the new toolchain needs is recorded with its reason while CI stays unchanged.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the four existing packages' `build` scripts fanned out by the root `pnpm -r build` (`package.json:6`), the five gates as CI runs them (`.github/workflows/ci.yml:20-29`) for the TypeScript trees they already cover, or task 56's `packages/analytics/src/server.ts`, whose `appDir` contract this build satisfies.

## Obligations

- **O1 — Builds to `dist/app`, ships prebuilt, one build script.**
  - *Claim:* the app builds to `dist/app`, `dist/app` is in the package's `files`, and the package's `build` script runs both the TypeScript build and the app build so no consumer runs Vite.
  - *Evidence to collect:* read the `build` script and the `files` array in `packages/analytics/package.json` and confirm both steps and both directories are present; read the adapter output path in `packages/analytics/app/svelte.config.js`; run `rm -rf packages/analytics/dist && pnpm -r build` from the repo root and confirm `packages/analytics/dist/app/index.html` exists afterwards.
  - *Checks:* resolve the second step of the `build` script — confirm it invokes the app build from the package directory (the shape of `packages/cli/package.json:20`) rather than depending on a root-level script or a manual pre-step a consumer would have to run.
  - *Status:* ☐ unverified

- **O2 — The app calls only the named-query routes.**
  - *Claim:* every network call the app makes names a query, a date range and a bot-inclusion flag against the server's own origin; none names another host and none sends SQL.
  - *Evidence to collect:* run `grep -rn "fetch(\|http://\|https://" packages/analytics/app/src/` and read every match — expect relative paths only, no absolute origin, and no string containing `SELECT` or a SQL fragment; read the fetch helper and confirm the query name, the date range and the bot flag are the only values it sends.
  - *Checks:* resolve the base path the helper builds its URL from — confirm it derives from the page's own origin rather than a configured or hard-coded host, so the prebuilt bundle cannot be pointed elsewhere.
  - *Status:* ☐ unverified

- **O3 — The gates pass with the app tree present, and each exclusion carries its reason.**
  - *Claim:* `pnpm lint`, `pnpm exec oxfmt --check .` and `pnpm knip` pass with the Svelte tree in the workspace, and every exclusion is written down with its reason and scoped no wider than that tree.
  - *Evidence to collect:* run `pnpm lint`, `pnpm exec oxfmt --check .` and `pnpm knip` from the repo root — expect all clean; read the diffs to `knip.json`, `.oxlintrc.json` and `.oxfmtrc.json` and confirm each added entry sits beside a comment stating why, matching the shape of the existing commented entries at `knip.json:3`, `.oxlintrc.json:85` and `.oxfmtrc.json:12-30`.
  - *Checks:* resolve each added glob — confirm it matches only `packages/analytics/app/**` and does not incidentally exclude `packages/analytics/src/**`, whose TypeScript the gates must still cover.
  - *Status:* ☐ unverified

- **O4 — CI needs no new step.**
  - *Claim:* the app build runs inside `pnpm build`, so `.github/workflows/ci.yml` is unchanged — or the change is deliberate and its reason is stated.
  - *Evidence to collect:* run `jj diff --stat .github/workflows/ci.yml` — expect no output; if there is output, read the change description and confirm it states why the step was needed.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run the clean-checkout build then the three gates (Reviewable).**
  - *Claim:* a reviewer can run `rm -rf packages/analytics/dist && pnpm -r build && ls packages/analytics/dist/app/index.html` followed by `pnpm lint && pnpm exec oxfmt --check . && pnpm knip` and observe the built entry point and three clean gates.
  - *Evidence to collect:* run both command lines and record the output — expect `packages/analytics/dist/app/index.html` listed and every gate exiting 0; run `jj diff --stat .github/workflows/ci.yml` and expect no output.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `package.json:6` (`pnpm -r build`) fans out to `packages/analytics` with the extended two-step script → expect the other three packages' builds to be unaffected and the whole run to stay green : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/server.ts` (task 56) serves `appDir` → expect the built `dist/app` to satisfy that contract, with `index.html` at its root : ☐ (PRESERVED / REGRESSION)
- `knip.json:4-12` workspaces map with the added exclusion → expect `pnpm knip` to still report the existing four workspaces' unused exports and dependencies, not to fall silent : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the app's own component tests (if any) are outside the DoD — the package's `test` script covers `src/**/*.test.ts` per task 32, and whether the Svelte tree joins it is undecided here. Bundle size, browser support and offline behaviour of the prebuilt app are unaddressed. `dist/app` inherits the repo-wide `dist` gitignore; confirm it is not accidentally committed. Whether `blogwright-analytics` needs a `prepack` guard so a stale `dist/app` cannot ship is a follow-up, not an obligation.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
