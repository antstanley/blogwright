# Done Certificate — Task 39: The page_views column set, partitioning and CloudFront field selection in one module

**Task:** [39-analytics_table_schema_and_field_selection.md](39-analytics_table_schema_and_field_selection.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 39. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 39) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `packages/analytics/src/schema.ts` is the single home for the `page_views` column set, its `day` partition, the CloudFront record-field selection and the field-to-column mapping, read by the transform, the table node and the delivery node rather than restated in each.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break anything — this task adds a new module in a package that has no consumers yet. The invariant to protect is the spec's own contract: the twenty column names and the five-column `required` set in `.specs/changes/2026-07-26-analytics_plugin.md:247-277` are the authority, and a divergence here silently corrupts every later task.

## Obligations

- **O1 — Column table, types, partition, required split, lowercase names.**
  - *Claim:* `PAGE_VIEWS_COLUMNS` lists exactly the twenty columns the spec names, in order, with Iceberg types matching the `PageView` `$defs` JSON types, `required: true` exactly for `event_time`, `day`, `host`, `uri`, `status`, the `day` partition declared as a named constant, and a test iterating the table asserts `^[a-z0-9_]+$` on every name.
  - *Evidence to collect:* read `packages/analytics/src/schema.ts` and set-compare its column names against the twenty in `.specs/changes/2026-07-26-analytics_plugin.md:121-124` — expect an exact match with no extras and no omissions; compare the `required: true` subset against the `required` array at `.specs/changes/2026-07-26-analytics_plugin.md:250`; run `pnpm test -- schema` in `packages/analytics` and confirm the lowercase-name test executes once per column (assert the iteration count equals the column count, not a hardcoded sample).
  - *Status:* ☐ unverified

- **O2 — Field selection excludes personal-data fields and keeps the viewer IP.**
  - *Claim:* `CLOUDFRONT_RECORD_FIELDS` lives in the same module, contains neither `cs(Cookie)` nor `x-forwarded-for`, and contains the viewer-IP field.
  - *Evidence to collect:* run `grep -n "cs(Cookie)\|x-forwarded-for" packages/analytics/src/` — expect matches only inside the negative-space assertion in `schema.test.ts`, never in the selection itself; run `pnpm test -- schema` and confirm the named negative-space test passes; read `CLOUDFRONT_RECORD_FIELDS` and confirm the viewer-IP field is present.
  - *Status:* ☐ unverified

- **O3 — Mapping totality in both directions.**
  - *Claim:* every entry in `CLOUDFRONT_RECORD_FIELDS` maps to exactly one column, and every column is either a mapping target or listed in `DERIVED_COLUMNS` (`event_time`, `day`, `visitor_key`, `is_bot`).
  - *Evidence to collect:* run `pnpm test -- schema` › the totality test and confirm it passes; then temporarily delete one `FIELD_TO_COLUMN` entry, re-run, and confirm the test fails naming the now-unsourced column — restore the entry afterwards. Also confirm no column appears as the target of two different fields.
  - *Status:* ☐ unverified

- **O4 — The module is pure.**
  - *Claim:* `schema.ts` imports no Node builtin, no vendor SDK and no `fetch`.
  - *Evidence to collect:* read the import list at the head of `packages/analytics/src/schema.ts` — expect type-only imports or none at all; run `grep -n "node:\|@aws-sdk\|fetch(" packages/analytics/src/schema.ts` and expect no output.
  - *Checks:* resolve every identifier the module calls at module scope — confirm each resolves to a local pure function or a JavaScript builtin, not to an injected or imported side effect.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: the totality test catches a deleted mapping entry (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- schema` inside `packages/analytics`, delete one entry from `FIELD_TO_COLUMN`, and observe the totality test fail naming the orphaned column.
  - *Evidence to collect:* run `pnpm test -- schema` from `packages/analytics` and capture the passing output; edit `packages/analytics/src/schema.ts` to remove one `FIELD_TO_COLUMN` entry, re-run, and capture the failure message — expect the orphaned column name in it; restore the file and re-run to confirm green.
  - *Status:* ☐ unverified

## Regression check

No existing callers in scope — `packages/analytics/src/schema.ts` is new and, at this task, imported only by its own test. The consumers this module is written for (task 40's `mapRecord`, task 48's table node, task 52's delivery node) do not exist yet.

## Residue

Notes for the validator: the exact CloudFront access-log field spellings are not enumerated in the change spec beyond the three examples it names (`x-edge-location`, `cs(Referer)`, `timestamp(ms)`); the obligations check totality and the two exclusions, not that each spelling matches AWS documentation — a wrong spelling is caught at first delivery, not here. Iceberg type choices for `time_taken` (JSON `number`) and `bytes_sent`/`status` (JSON `integer`) are the author's mapping; the DoD requires only that they distinguish integral from fractional. The `day` partition transform (identity on a date column versus a `day()` transform over `event_time`) is left to task 48's table node.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
