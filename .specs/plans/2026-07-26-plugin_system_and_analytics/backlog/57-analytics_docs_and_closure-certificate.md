# Done Certificate — Task 57: Document the analytics plugin, update the toolchain and ports tables, and close the change spec

**Task:** [57-analytics_docs_and_closure.md](57-analytics_docs_and_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 57. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 57) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** DEVELOPMENT.md records Vite/SvelteKit and `AnalyticsQuery`, `packages/analytics/README.md` documents install, the five actions, the region pinning and the privacy contract, a changeset states the semver impact, the spec's four open questions are each resolved or owned, and the change spec is merged so no pending change specs remain.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the existing rows of DEVELOPMENT.md's Toolchain and ports tables (`DEVELOPMENT.md:12-22`, `:72-81`), the merged-spec links in `.specs/README.md:35-42`, the relative links inside the moved change spec (which point at `../../packages/…` and `../../DEVELOPMENT.md` and gain a directory level under `merged/`), or the changeset fixed group at `.changeset/config.json:5`.

## Obligations

- **O1 — The two DEVELOPMENT.md table rows.**
  - *Claim:* the Toolchain table carries the Vite/SvelteKit row naming the dashboard build, and the ports table carries `AnalyticsQuery` with its defining module, real adapter and test fake.
  - *Evidence to collect:* read `DEVELOPMENT.md:12-23` and confirm a Vite/SvelteKit row exists with a version channel and a note scoping it to `packages/analytics/app` → `dist/app`; read `DEVELOPMENT.md:72-82` and confirm the `AnalyticsQuery` row names `analytics/src/ports.ts`, `createDuckDbAnalyticsQuery` (`analytics/src/adapters/duckdb-query.ts`) and the fixture-backed fake, in four columns like the `Vcs` row.
  - *Checks:* resolve each path named in the new ports row against the working tree — confirm `packages/analytics/src/ports.ts` and `packages/analytics/src/adapters/duckdb-query.ts` exist and export what the row claims, so the table does not document a file that is not there.
  - *Status:* ☐ unverified

- **O2 — The package README and the in-code documentation.**
  - *Claim:* `packages/analytics/README.md` documents install, the five actions, the us-east-1 pinning and the privacy contract, and every public export carries a doc comment while every module opens with an ownership comment.
  - *Evidence to collect:* read `packages/analytics/README.md` and confirm it names `blogwright plugin add analytics`, all five actions (`init`, `bootstrap`, `status`, `dashboard`, `destroy --yes`), the us-east-1 pinning with its CloudFront reason, and the two privacy statements (the raw viewer IP is never stored; `cs(Cookie)` and `x-forwarded-for` are never selected); read the exports of `packages/analytics/src/index.ts` and confirm each has a doc comment, and read the first line of every module under `packages/analytics/src/` and `packages/analytics/src/transform/` for the ownership comment.
  - *Checks:* resolve the privacy claim against the code — confirm `packages/analytics/src/schema.ts`'s field selection (task 39) contains neither `cs(Cookie)` nor `x-forwarded-for`, and that no column in the row the transform emits holds the raw IP, so the README documents the behaviour rather than an intention.
  - *Status:* ☐ unverified

- **O3 — The four open questions and no bare TODO.**
  - *Claim:* backfill, table record expiration, one bucket per environment and salt stability are each resolved in the change description or recorded as out of scope with an owner, and no bare `// TODO` exists in the new code.
  - *Evidence to collect:* read the change description and confirm four entries, with the bucket-per-environment entry pointing at `packages/analytics/src/config.ts` (task 44) and the salt-stability entry at `packages/analytics/src/transform/visitor-key.ts` (task 41); run `grep -rn "TODO" packages/analytics/` — expect either no output or every match carrying an owner and a tracking reference, per `DEVELOPMENT.md:251`.
  - *Status:* ☐ unverified

- **O4 — The changeset and the executed merge plan.**
  - *Claim:* a changeset states the semver impact and the spec's merge plan is executed, leaving no pending change specs.
  - *Evidence to collect:* read the new file under `.changeset/` and confirm it declares the new `blogwright-analytics` package and a minor on `blogwright-core`, naming the four service clients and the `LogsClient` delivery parameters as the reason; read `.specs/changes/merged/2026-07-26-analytics_plugin.md:3` and confirm `Status: Merged` with a `Merged:` date; run `ls .specs/changes/` and expect only `merged/`; read `.specs/README.md:19-42` and confirm the pending section records that nothing is pending and the merged list carries all three specs.
  - *Checks:* resolve every relative link inside the moved spec and inside `.specs/README.md` — the move adds a directory level, so links such as `../../packages/cli/src/nodes.ts` and `../../DEVELOPMENT.md` must have been re-pointed; confirm each target exists.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run the five gates, then confirm the spec moved and every link resolves (Reviewable).**
  - *Claim:* a reviewer can run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip` and observe clean gates, `.specs/changes/` holding only `merged/`, the merged analytics spec carrying a `Merged:` date, and every link in `.specs/README.md` resolving.
  - *Evidence to collect:* run the gate command line and record the output; run `ls .specs/changes/` and expect `merged` alone; run `grep -o "](\([^)]*\))" .specs/README.md` and check each target path exists on disk.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `.specs/README.md:19-42` is the index readers follow to reach every spec → expect the three moved specs to be reachable and no link to point at `changes/2026-07-26-*.md` at the old depth : ☐ (PRESERVED / REGRESSION)
- `.specs/changes/merged/2026-07-26-analytics_plugin.md` relative links (`../../packages/…`, `../../DEVELOPMENT.md`, the two companion specs) after the move → expect each to resolve from its new directory : ☐ (PRESERVED / REGRESSION)
- `.changeset/config.json:5` fixed group with the new package's changeset present → expect `pnpm changeset:version` to version `blogwright-analytics` as intended and not to break the existing three-package lockstep : ☐ (PRESERVED / REGRESSION)
- `DEVELOPMENT.md:72-81` ports table consumers (tasks 05, 06 and 20 add rows to the same table) → expect the existing rows to be intact and the table to render : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: merge-plan steps 1 and 2 (folding the `Proposed changes` blocks and the `AnalyticsConfig` / `PageView` `$defs` into canonical pages) cannot be executed while no canonical spec set exists — confirm the change description says so rather than silently skipping them. The Starlight docs site under `docs/` is not in this task's scope, so the public documentation of the analytics surface at `blogwright.iamstan.dev` remains a follow-up. Whether the repo `README.md`'s Commands block should name `blogwright analytics …` alongside `pds` is left to task 20's plugin-surface documentation. If the two companion specs have not been merged by their own closure tasks, the pending list cannot be emptied — record that as a blocking dependency rather than editing their files here.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
