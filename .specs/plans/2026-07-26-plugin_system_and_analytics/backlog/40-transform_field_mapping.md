# Task 40 - CloudFront record to PageView row mapping in the transform

**Plan:** [plan.md](../plan.md) · **Certificate:** [40-transform_field_mapping-certificate.md](40-transform_field_mapping-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Record transformation](../../../changes/2026-07-26-analytics_plugin.md) (steps 1, 2 and 5 of the transform: map each CloudFront field name to its column name, derive `event_time` from `timestamp(ms)` and the partition day from it, and drop records the schema cannot accept)
**Depends on:** 39
**Produces:** `mapRecord` in `packages/analytics/src/transform/map-record.ts` - a pure function turning one CloudFront access-log record into a `page_views` row or a droppable result naming the missing field, with `event_time` and `day` derived in UTC and covered by day-rollover boundary tests
**Pointers:** `packages/analytics/src/transform/map-record.ts` (new - the pure mapper), `packages/analytics/src/transform/map-record.test.ts` (new - fixed-input/fixed-output and boundary tests), `packages/analytics/src/schema.ts` (task 39 - `PAGE_VIEWS_COLUMNS`, `FIELD_TO_COLUMN`, `DERIVED_COLUMNS`, the `PageView` row type this consumes), `packages/analytics/vitest.config.ts:8` (the `include` glob - unchanged, `src/**/*.test.ts` already covers the transform), `packages/build-agent/src/build.ts` (the precedent for a bundled module tree - note it lives under `src/`, which is why the transform does too)

## Steps

- [ ] Put the transform under `packages/analytics/src/transform/` - inside the package's existing source root - so task 32's `tsconfig.json` (`rootDir: src`, include `src/**/*`), its `tsconfig.typecheck.json`, the default vitest `src/**/*.test.ts` glob and the `oxlint src` script all cover it with NO widening. A sibling `transform/` tree would sit outside `include`, so `pnpm typecheck` - a CI gate - would never typecheck the one component this spec calls load-bearing; adding it to `include` would then break `tsc -p tsconfig.json` against `rootDir: src`. This is also what the cited precedent actually does: `packages/build-agent/src/build.ts` is under `src/`, and the workspace has no non-`src` module tree.
- [ ] Write `mapRecord(record)` in `packages/analytics/src/transform/map-record.ts` returning a discriminated result - a mapped `PageView` row, or a droppable outcome carrying the reason and the missing field name - never a partially populated row and never `null`.
- [ ] Build the row by iterating `FIELD_TO_COLUMN` from `schema.ts`, so no CloudFront field name and no column name is spelled a second time inside the transform.
- [ ] Derive `event_time` from the record's `timestamp(ms)` value and `day` from `event_time` in UTC, both through small named helpers whose inputs are the record's own values, never a wall clock.
- [ ] Coerce `status`, `bytes_sent` and `time_taken` to numbers through one named helper; a value that does not parse as a number takes the drop path rather than writing a wrong value.
- [ ] Write `packages/analytics/src/transform/map-record.test.ts` with fixed record fixtures and fully spelled expected rows, plus a drop case per required column and the two day-rollover boundary cases at `23:59:59.999` and `00:00:00.000` UTC.

## Definition of done

- [ ] `mapRecord` builds a row using `schema.ts`'s mapping table only - no CloudFront field name and no column name is written a second time in the transform; `grep -rn "cs(Referer)\|timestamp(ms)" packages/analytics/` finds them in exactly one module.
- [ ] `event_time` is derived from `timestamp(ms)` and `day` from `event_time` in UTC; the tests use fixed inputs with fully spelled expected outputs and read no wall clock, and boundary tests at `23:59:59.999` and `00:00:00.000` UTC prove the partition value lands on the right side of midnight.
- [ ] `status`, `bytes_sent` and `time_taken` are emitted as numbers, not strings (asserted by `typeof` on each), and a non-numeric value for one of them takes the drop path rather than writing a wrong value.
- [ ] Negative-space: a record missing any of `event_time`, `day`, `host`, `uri` or `status` is reported as droppable with a reason naming the missing field, and no partially populated row is returned (asserted by checking the result carries no row at all, not merely that one field is absent).
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- map-record` inside `packages/analytics`; confirm the two midnight-boundary cases produce different `day` values one millisecond apart and that every drop case names its missing field in the failure reason.
