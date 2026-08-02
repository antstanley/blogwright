# Done Certificate - Task 61: The `analytics backfill` action, and the analytics spec's merge

**Task:** [61-analytics_backfill_action.md](61-analytics_backfill_action.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-27 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 61. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 61) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright analytics backfill` fills whole pre-Firehose days from the site's CloudWatch log group into the `page_views` table - each event through the same mapping, `visitor_key` derivation and drop rules as the transform Lambda, written through the new `AnalyticsIngest` port - inserting nothing the Firehose path wrote and nothing twice; the README documents the action; and the analytics change spec is merged.
- **P2 - Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the transform's tested contract (tasks 40–42 - the backfill reuses `mapRecord`/`visitorKey`, it does not fork them), task 46's read-only dashboard attach, the region pin (the salt secret and the log group are both us-east-1), or the ports discipline - no domain module imports `@duckdb/node-api` or issues a raw AWS call. Must not land before task 58's documentation pass.

## Obligations

- **O1 - The identical-row property.**
  - *Claim:* one fixture CloudFront event through the Firehose envelope path and through the backfill path yields deep-equal `page_views` rows, including `visitor_key` and `is_bot`.
  - *Evidence to collect:* run `pnpm test -- backfill` in `packages/analytics`; read the identical-row case and confirm it feeds the SAME fixture event to task 42's envelope and to the backfill mapper and compares full rows with deep equality, not a sampled column list; confirm the historical day's salt comes from `dailySalt(secret, day)` with the day under test, not from a stubbed constant.
  - *Checks:* resolve the backfill's mapping call - confirm it is task 40's `mapRecord` and task 41's `visitorKey` imported, not a re-implementation; a forked mapper is exactly how the two paths drift silently.
  - *Status:* ☐ unverified

- **O2 - Idempotency by construction, tested in both directions.**
  - *Claim:* only whole UTC days strictly before the recorded `createdDay` are ever handed to `insertDay`; an occupied day is skipped; a re-run inserts nothing; each inserted day is one transaction.
  - *Evidence to collect:* run `pnpm test -- backfill` and read the bound test (negative: no `insertDay` call at or after `createdDay` on the recording fake), the skip test, and the re-run test; read the adapter and confirm `insertDay` commits one transaction per day.
  - *Checks:* the bound's direction is the load-bearing half - trace where `createdDay` is read (task 53's scoped-state record, written once and never advanced) and confirm the backfill treats a missing record as a refusal, never as "backfill everything"; an unbounded default double-inserts every Firehose day.
  - *Status:* ☐ unverified

- **O3 - The read is core's existing surface; the write crosses `AnalyticsIngest`.**
  - *Claim:* events are read through `LogsClient.filterEvents` over `ctx.clients.logsUsEast1` with no change under `packages/core/`, and the write crosses the `AnalyticsIngest` port whose DuckDB adapter is the only new module importing `@duckdb/node-api`; task 46's read adapter stays read-only.
  - *Evidence to collect:* run `git diff --stat` (or inspect the change) and confirm `packages/core/` is untouched; run `grep -rn "@duckdb" packages/analytics/src/` and confirm hits only under `adapters/`; read `packages/analytics/src/adapters/duckdb-query.ts` and confirm its attach is still read-only while `duckdb-ingest.ts` is not; confirm no test starts DuckDB (`grep -rn "duckdb" packages/analytics/src/*.test.ts` returns nothing).
  - *Status:* ☐ unverified

- **O4 - Refusal and report.**
  - *Claim:* a missing `createdDay` fails before any AWS call with a message naming `blogwright analytics bootstrap`, and the report names inserted days, skipped days and the untouched boundary day.
  - *Evidence to collect:* run `pnpm test -- backfill` and read the refusal case (message text asserted, recording clients show no call) and the pinned report output.
  - *Status:* ☐ unverified

- **O5 - Documentation and changeset.**
  - *Claim:* `packages/analytics/README.md` gains the `backfill` entry (what it reads, the bound, the idempotency contract, optional and one-shot), DEVELOPMENT.md's ports table carries `AnalyticsIngest` beside `AnalyticsQuery`, and a changeset records the new user-facing action.
  - *Evidence to collect:* read the README entry; read the ports table row and resolve the paths it names against the working tree; read the changeset.
  - *Checks:* task 58 deliberately left the README entry out while the command still raised its not-yet-available error - confirm the entry landed here and describes the implemented behaviour, not the stub.
  - *Status:* ☐ unverified

- **O6 - The analytics change spec is merged and the pending list is empty.**
  - *Claim:* the spec's `Status:` is `Merged` with a `Merged:` date, the file lives at `.specs/changes/merged/2026-07-26-analytics_plugin.md`, every relative link inside it resolves at the new depth, its two open questions are carried, and `.specs/README.md`'s pending list is empty.
  - *Evidence to collect:* run `ls .specs/changes .specs/changes/merged` - expect all three specs under `merged/` and none pending; read the moved file's header and Open questions; resolve every relative link in it (both companion specs are `merged/` siblings by now); read `.specs/README.md`.
  - *Checks:* this is the flip task 58 deferred, because §Backfill of historical logs had not landed there - the same rule that split tasks 20/58 and 30/60. If this task is being validated with task 60 incomplete, the pds spec is still pending and that is correct - only the analytics entry is this task's to remove.
  - *Status:* ☐ unverified

- **O7 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm the changeset from O5 exists.
  - *Status:* ☐ unverified

- **O8 - Reviewable: deep-equal rows, a bounded fake, no DuckDB in tests, and the merged spec (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- backfill` inside `packages/analytics` and observe the identical-row case comparing full rows, the recording fake showing no `insertDay` at or after `createdDay`, and no test starting DuckDB; then confirm all three specs sit in `merged/` and every `.specs/README.md` link resolves.
  - *Evidence to collect:* run the named test filter and capture the output; run the two greps named in O3; run `ls .specs/changes .specs/changes/merged` and resolve the README links.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/transform/` consumed by the Firehose envelope (task 42) → expect the envelope suite to pass unmodified; the backfill imports the mapping, it does not change it : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/ports.ts` consumed by the dashboard server (task 56) → expect the server to keep receiving `AnalyticsQuery` only - grep the server module for `AnalyticsIngest` and expect no hit : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/commands.ts` (task 47's table) → expect the declared action set unchanged (`status`, `dashboard`, `backfill`) with only the `backfill` body filled : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: the boundary day (the day the Firehose delivery was created) is deliberately never backfilled - up to one day of history is lost at the seam, a stated precision limit; do not treat a gap on that day as a defect. Whether DuckDB's Iceberg write support (documented as preview) holds for the S3 Tables attach in write mode is the same vendor risk the spec's Assumptions record for reads, and the `AnalyticsIngest` port is what contains it - if the write syntax moves, the adapter moves and the domain does not. CloudWatch's `FilterLogEvents` pagination on large days is bounded by the site's blog-scale volumes; a pathological day that exhausts memory is out of scope here and worth a follow-up limit if observed.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
