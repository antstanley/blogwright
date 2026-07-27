# Done Certificate — Task 58: Document the analytics plugin, update the toolchain and ports tables, and close the change spec

**Task:** [58-analytics_docs_and_closure.md](58-analytics_docs_and_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 58. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 58) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** DEVELOPMENT.md records Vite/SvelteKit and `AnalyticsQuery` and no longer counts the workspace at four packages, `packages/analytics/README.md` documents install, the five actions, the region pinning and the privacy contract, a changeset states the semver impact, the spec's four open questions are each resolved or owned, and two of the three remaining change specs — the analytics spec and the plugin-system spec whose flip task 20 deferred here — are merged, leaving the pds spec as the single pending entry for task 59.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the existing rows of DEVELOPMENT.md's Toolchain and ports tables (`DEVELOPMENT.md:12-22`, `:72-81`), the merged-spec links in `.specs/README.md:35-42`, the relative links inside the moved change spec (which point at `../../packages/…` and `../../DEVELOPMENT.md` and gain a directory level under `merged/`), or the changeset fixed group at `.changeset/config.json:5`.

## Obligations

- **O1 — The two DEVELOPMENT.md table rows, and the two workspace counts a fifth package invalidates.**
  - *Claim:* the Toolchain table carries the Vite/SvelteKit row naming the dashboard build, the ports table carries `AnalyticsQuery` with its defining module, real adapter and test fake, and neither the pnpm toolchain row nor the four-package-split Assumption still says four.
  - *Evidence to collect:* read `DEVELOPMENT.md:12-23` and confirm a Vite/SvelteKit row exists with a version channel and a note scoping it to `packages/analytics/app` → `dist/app`; read `DEVELOPMENT.md:72-82` and confirm the `AnalyticsQuery` row names `analytics/src/ports.ts`, `createDuckDbAnalyticsQuery` (`analytics/src/adapters/duckdb-query.ts`) and the fixture-backed fake, in four columns like the `Vcs` row; run `grep -nE "four packages|four-package" DEVELOPMENT.md` and expect no hits; read the amended Assumption and confirm it names `blogwright-analytics` beside `blogwright-pds`.
  - *Checks:* resolve each path named in the new ports row against the working tree — confirm `packages/analytics/src/ports.ts` and `packages/analytics/src/adapters/duckdb-query.ts` exist and export what the row claims, so the table does not document a file that is not there. The two counts fail silently: `pnpm-workspace.yaml`'s `packages/*` glob picks the new package up with no edit, so nothing in CI notices either statement going stale — the grep is the only gate.
  - *Status:* ☐ unverified

- **O2 — The package README and the in-code documentation.**
  - *Claim:* `packages/analytics/README.md` documents install, the five actions, the us-east-1 pinning and the privacy contract, and every public export carries a doc comment while every module opens with an ownership comment.
  - *Evidence to collect:* read `packages/analytics/README.md` and confirm it names `blogwright plugin add analytics`, all five actions (`init`, `bootstrap`, `status`, `dashboard`, `destroy --yes`), the us-east-1 pinning with its CloudFront reason, and the two privacy statements (the raw viewer IP is never stored; `cs(Cookie)` and `x-forwarded-for` are never selected); read the exports of `packages/analytics/src/index.ts` and confirm each has a doc comment, and read the first line of every module under `packages/analytics/src/` and `packages/analytics/src/transform/` for the ownership comment.
  - *Checks:* resolve the privacy claim against the code — confirm `packages/analytics/src/schema.ts`'s field selection (task 39) contains neither `cs(Cookie)` nor `x-forwarded-for`, and that no column in the row the transform emits holds the raw IP, so the README documents the behaviour rather than an intention.
  - *Status:* ☐ unverified

- **O3 — The four open questions and no bare TODO.**
  - *Claim:* backfill, table record expiration, the Glue integration's adopt-and-never-delete contract, and the daily salt's cross-day correlation semantic are each resolved in the change description or recorded as out of scope with an owner; and no bare `// TODO` exists in the new code.
  - *Evidence to collect:* count the `- ` items under §Open questions in `.specs/changes/2026-07-26-analytics_plugin.md` — expect four, and expect one entry in the change description per item; confirm the Glue entry points at `packages/analytics/src/nodes.ts` (task 49) and the salt-semantic entry at `packages/analytics/src/transform/visitor-key.ts` (task 41); run `grep -rn "TODO" packages/analytics/` — expect either no output or every match carrying an owner and a tracking reference, per `DEVELOPMENT.md:251`.
  - *Status:* ☐ unverified

- **O4 — The changeset and the two executed merge plans.**
  - *Claim:* a changeset states the semver impact, and the merge plans of both specs this task owns are executed — the analytics spec's and the plugin-system spec's, deferred here by task 20 — leaving exactly one pending entry, the pds spec, named as task 59's.
  - *Evidence to collect:* read the new file under `.changeset/` and confirm it declares the new `blogwright-analytics` package and a minor on `blogwright-core`, naming `signingUsEast1`, the transport seam and the `LogsClient` delivery parameters as the reason — the plugin's four service clients live in `blogwright-analytics` and are not a core change; read the `Status:` header of `.specs/changes/merged/2026-07-26-analytics_plugin.md` and of `.specs/changes/merged/2026-07-26-cli_plugin_system.md` and confirm each says `Merged` with a `Merged:` date; run `ls .specs/changes/` and expect `merged/` plus `2026-07-26-migrate_pds_to_plugin_system.md` and nothing else; read `.specs/README.md:19-42` and confirm the merged list carries these two specs and the pending section holds exactly one entry, the pds spec, naming task 59 as its owner.
  - *Checks:* resolve every relative link inside both moved specs and inside `.specs/README.md` — the move adds a directory level, so links such as `../../packages/cli/src/nodes.ts` and `../../DEVELOPMENT.md` must have been re-pointed; confirm each target exists. Confirm the plugin-system flip was earned, not assumed: `SendOptions.service` accepts a plugin-supplied descriptor (task 31) and `AwsClients` carries `signingUsEast1` (task 38); if either is absent the obligation is UNSATISFIED even when the header says `Merged`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run the five gates, then confirm both specs moved and every link resolves (Reviewable).**
  - *Claim:* a reviewer can run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip` and observe clean gates, `.specs/changes/` holding `merged/` and the pds spec alone, the merged analytics and plugin-system specs each carrying a `Merged:` date, and every link in `.specs/README.md` resolving.
  - *Evidence to collect:* run the gate command line and record the output; run `ls .specs/changes/` and expect `merged` alone; run `grep -o "](\([^)]*\))" .specs/README.md` and check each target path exists on disk.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `.specs/README.md:19-42` is the index readers follow to reach every spec → expect the two moved specs to be reachable at their new depth, and the pds spec's pending link still to resolve at the old one : ☐ (PRESERVED / REGRESSION)
- `.specs/changes/merged/2026-07-26-analytics_plugin.md` relative links (`../../packages/…`, `../../DEVELOPMENT.md`, the two companion specs) after the move → expect each to resolve from its new directory : ☐ (PRESERVED / REGRESSION)
- `.changeset/config.json:5` fixed group with the new package's changeset present → expect `pnpm changeset:version` to version `blogwright-analytics` as intended and not to break the existing three-package lockstep : ☐ (PRESERVED / REGRESSION)
- `DEVELOPMENT.md:72-81` ports table consumers (tasks 05, 06 and 20 add rows to the same table) → expect the existing rows to be intact and the table to render : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: merge-plan steps 1 and 2 (folding the `Proposed changes` blocks and the `AnalyticsConfig` / `PageView` `$defs` into canonical pages) cannot be executed while no canonical spec set exists — confirm the change description says so rather than silently skipping them. The Starlight docs site under `docs/` is not in this task's scope, so the public documentation of the analytics surface at `blogwright.iamstan.dev` remains a follow-up. Whether the repo `README.md`'s Commands block should name `blogwright analytics …` alongside `pds` is left to task 20's plugin-surface documentation. The pds spec is deliberately left pending: its §The site graph drops its pds branch lands at task 59, a release later, and task 30 deferred the flip there for the same reason task 20 deferred the plugin-system spec's flip here. Emptying the pending list in this task would merge a spec with an outstanding `Proposed changes` block — mark UNSATISFIED if the pds entry is gone.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
