# Done Certificate - Task 40: CloudFront record to PageView row mapping in the transform

**Task:** [40-transform_field_mapping.md](40-transform_field_mapping.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 40. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 40) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `mapRecord` in `packages/analytics/src/transform/map-record.ts` turns one CloudFront access-log record into a `page_views` row or a droppable result naming the missing field, deriving `event_time` and `day` in UTC, covered by day-rollover boundary tests.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `packages/analytics/src/schema.ts` (task 39) - the column set, the field selection and the mapping table stay the single source, and this task must not fork them; and must not break the package's existing gates after widening the `vitest.config.ts` include glob and the `lint` script to cover `transform/`.

## Obligations

- **O1 - Mapping has exactly one home.**
  - *Claim:* `mapRecord` reads `FIELD_TO_COLUMN` from `schema.ts` and spells no CloudFront field name and no column name a second time.
  - *Evidence to collect:* run `grep -rn "cs(Referer)\|timestamp(ms)" packages/analytics/` - expect matches only in `packages/analytics/src/schema.ts` and in test fixtures, never in `map-record.ts` outside the derived-field helpers; read `packages/analytics/src/transform/map-record.ts` and confirm the row is built by iterating the imported mapping, not by a literal object with column keys.
  - *Checks:* resolve the mapping identifier used inside `mapRecord` - confirm it is the import from `../src/schema.js`, not a locally redeclared constant of the same name.
  - *Status:* ☐ unverified

- **O2 - UTC derivation and the midnight boundary.**
  - *Claim:* `event_time` is derived from `timestamp(ms)` and `day` from `event_time` in UTC; tests use fixed inputs and fully spelled expected outputs and read no wall clock; boundary tests at `23:59:59.999` and `00:00:00.000` UTC prove the partition value.
  - *Evidence to collect:* run `pnpm test -- map-record` in `packages/analytics` and confirm the two boundary cases pass with `day` values differing by one calendar day; run `grep -n "Date.now()\|new Date()" packages/analytics/src/transform/` - expect no output in test bodies or in `map-record.ts`; read the two boundary fixtures and confirm both timestamps are literal numbers.
  - *Status:* ☐ unverified

- **O3 - Numeric columns are numbers, and a non-numeric value drops.**
  - *Claim:* `status`, `bytes_sent` and `time_taken` are emitted as numbers, asserted by `typeof`; a non-numeric value for any of them takes the drop path.
  - *Evidence to collect:* run `pnpm test -- map-record` › the numeric-typing test and confirm it asserts `typeof row.status === 'number'` (and the same for `bytes_sent` and `time_taken`), not merely equality against a number literal; run the non-numeric case and confirm the result is the droppable variant, not a row carrying `NaN` or a string.
  - *Status:* ☐ unverified

- **O4 - Required-field absence drops with a named reason and no partial row.**
  - *Claim:* a record missing any of `event_time`, `day`, `host`, `uri` or `status` yields a droppable result whose reason names the missing field, and no partially populated row is returned.
  - *Evidence to collect:* run `pnpm test -- map-record` › the drop-path tests and confirm one case per required column; read the assertions and confirm each checks the reason string contains the missing column name **and** that the result carries no row property at all - an assertion that merely checks one field is absent does not satisfy this obligation.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewable: the midnight-boundary cases and the drop reasons (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- map-record` inside `packages/analytics` and observe that the two midnight-boundary cases produce different `day` values one millisecond apart and that every drop case names its missing field.
  - *Evidence to collect:* run `pnpm test -- map-record` from `packages/analytics` and capture the full test-name list; read the two boundary test names and their expected `day` literals in `packages/analytics/src/transform/map-record.test.ts` and confirm they differ; read each drop-case assertion and confirm the expected reason names the field.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/schema.ts` `FIELD_TO_COLUMN` is read by `mapRecord` for a fixture record → expect every selected field to land in its mapped column and task 39's totality test to still pass : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/vitest.config.ts` `include` (widened here) is read by `pnpm test` in the package → expect the existing `src/**/*.test.ts` suites to still be collected and pass alongside the new `transform/**` suites : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/package.json` `lint` (widened here) is invoked by the root `pnpm -r lint` → expect `oxlint src transform` to run clean and to still lint every file it linted before : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the change spec does not fix the wire type of `timestamp(ms)` (string of milliseconds versus number); the obligations require only that the derivation is total over the fixtures and reads no clock, so either input handling is acceptable provided a non-parsing value drops. `query` and `referrer` being empty strings rather than absent is not covered by the DoD - CloudFront emits `-` for absent values, and whether that becomes an empty string or a drop is left to the author. The `day` value's textual format (`YYYY-MM-DD` per the spec's `format: date`) is asserted only through the boundary fixtures' expected literals.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
