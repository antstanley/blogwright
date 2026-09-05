# Done Certificate — Task 63: Close specification coverage and documentation against the integrated code

**Task:** [63-specification_closure.md](63-specification_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-09-05 — unverified

## Definition

DONE(Task 63) means every obligation O1–O8 is satisfied with recorded evidence.

## Premises

- P1: Internal canonical pages/schema and accurate consumer docs cover all integrated requirements; both pending specs merge with complete evidence and the temporary type-claim gate retires.
- P2: One obligation per DoD item, in order; O8 is Reviewable.
- P3: Preserve the downstream behavior listed under Regression check; use the current integrated base, never an old passing verdict.

## Obligations

### O1

- Claim: Canonical overview/plugin/PDS/analytics pages and schema are indexed and describe implemented contracts, entities, state, fourteen-node pipeline, observability and backfill limits; internal docs confer no supported public SPI.
- Evidence to collect: Read all canonical pages against core/CLI/PDS/analytics source and the four source specs (including owned-log-groups). Check fourteen nodes and log config in implementation, and internal-contract disclaimer.
- Status: ☐ unverified

### O2

- Claim: Schema JSON passes Draft 2020-12 meta-validation with valid local references, includes every supplied JSON entity/field with the intended optionality/defaults, and each entity is described in prose. Each source spec Merge plan step maps to a concrete final artifact.
- Evidence to collect: Run Draft202012Validator.check_schema (or an equivalent Draft 2020-12 validator), resolve every local $ref and compare $defs to supplied fragments and source types. Record a per-spec Merge plan step-to-artifact table.
- Status: ☐ unverified

### O3

- Claim: CLI reference and README accurately document plugin/PDS invocation, lifecycle, removal/teardown behavior, environment-specific warnings, four publishable packages and six gates; consumer analytics privacy text distinguishes page_views from raw failure/log storage.
- Evidence to collect: Run built bin --help, inspect rendered Astro CLI page and public README/analytics README. Verify rawData disclosure against handler ProcessingFailed behavior and AWS reference; inspect four-package changesets fixed group and CI.
- Status: ☐ unverified

### O4

- Claim: Historical coverage gaps are explicitly evidenced: positive/negative config typing, bundled-only dispatch and single helper source. Existing historical partial/delta verdicts remain intact, with current closure proved here rather than inherited.
- Evidence to collect: Read reviews/2026-09-05-historical-coverage.md and discharge each outstanding check with current source/tests and an actual negative compile probe. Record exact command/output; do not infer proof from comments.
- Status: ☐ unverified

### O5

- Claim: The planning type-claim gate passes before retirement; output and rationale are retained, executable duplicate transcriptions/checker retire, and typecheck still checks shipped declarations/tests.
- Evidence to collect: Capture `node type-claims/check.mjs` success before removal, inspect retained README and removed files, then run pnpm typecheck after retirement.
- Status: ☐ unverified

### O6

- Claim: Both remaining change specs have Merged status/date in merged/, no pending linked specs remain, all incoming/outgoing Markdown links resolve, and all source requirements map to implemented evidence or explicitly non-required open questions.
- Evidence to collect: Run R3 conformance against all current source requirements, enumerate moved files/status/date and validate links over .specs/ plus modified docs; preserve explicit open questions and historical findings.
- Status: ☐ unverified

### O7

- Claim: Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- Evidence to collect: Run all six gates on integrated result, record exits and counts; no functional change should be hidden as a docs correction.
- Status: ☐ unverified

### O8

- Claim: Reviewable: inspect the built CLI help and built docs, run the final conformance/coverage and link/schema checks, and verify every outstanding row of the review report has named evidence and no required gap.
- Evidence to collect: Execute CLI help, docs build, schema/link checks, and record the review-table resolutions and current final conformance verdict.
- Status: ☐ unverified

## Regression check

- Existing CLI invocations and plugin dispatch are described accurately without changing runtime behavior. — ☐ (PRESERVED / REGRESSION)
- No lost schema entities, spec references, historical evidence or shipped beta.3 log-group guarantees. — ☐ (PRESERVED / REGRESSION)

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or a regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: ☐
CONFIDENCE: ☐
SUMMARY: ☐
