# Task 39 — The page_views column set, partitioning and CloudFront field selection in one module

**Plan:** [plan.md](../plan.md) · **Certificate:** [39-analytics_table_schema_and_field_selection-certificate.md](39-analytics_table_schema_and_field_selection-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Table schema](../../../changes/2026-07-26-analytics_plugin.md) (the twenty lowercase columns, the `day` partition, the selected CloudFront fields, and the ban on `cs(Cookie)` and `x-forwarded-for` ever leaving CloudFront) and §Type changes (the `PageView` `$defs` block and its `required` list)
**Depends on:** 32
**Produces:** `packages/analytics/src/schema.ts` — one ordered column table for `page_views`, its `day` partition, the CloudFront record-field selection, and the field-to-column mapping that the transform (task 40), the table node (task 48) and the delivery node (task 53) all read instead of restating
**Pointers:** `packages/analytics/src/schema.ts` (new — the single home for the column set, the field selection and the mapping), `packages/analytics/src/schema.test.ts` (new — the totality and lowercase tests), [§Analytics pipeline → Table schema](../../../changes/2026-07-26-analytics_plugin.md) (the twenty columns and the excluded fields), [§Type changes](../../../changes/2026-07-26-analytics_plugin.md) (the `PageView` `$defs` fragment giving each column's JSON type and the five required columns), `packages/core/src/config.ts:341-372` (`Names`/`deriveNames` — the precedent for a pure derived-vocabulary module with no side effects), `packages/core/src/aws/logs.ts:114` (`createDelivery`, whose record-fields parameter task 53 feeds from this selection)

## Steps

- [ ] Declare `PAGE_VIEWS_COLUMNS` in `packages/analytics/src/schema.ts` as one ordered array of `{ name, icebergType, required }` covering `event_time`, `day`, `host`, `uri`, `query`, `method`, `status`, `referrer`, `user_agent`, `country`, `asn`, `edge_location`, `result_type`, `bytes_sent`, `time_taken`, `content_type`, `protocol`, `request_id`, `visitor_key`, `is_bot`, with `required: true` exactly for the spec's `PageView.required` set (`event_time`, `day`, `host`, `uri`, `status`) and Iceberg types taken from the `$defs` JSON types.
- [ ] Declare the partition alongside it as a named constant naming the `day` column, and export a `PageView` row type derived from the column table so the transform cannot invent a column name the table does not carry.
- [ ] Declare `CLOUDFRONT_RECORD_FIELDS` in the same module — the CloudFront access-log field names the delivery selects — and a `FIELD_TO_COLUMN` mapping from each selected field to its single column, keeping the viewer-IP field selected because task 41 derives `visitor_key` from it.
- [ ] Declare `DERIVED_COLUMNS` naming the four columns no CloudFront field maps to (`event_time`, `day`, `visitor_key`, `is_bot`), so the totality test can distinguish "derived" from "forgotten".
- [ ] Write `packages/analytics/src/schema.test.ts`: iterate `PAGE_VIEWS_COLUMNS` asserting `^[a-z0-9_]+$` on every name; assert `cs(Cookie)` and `x-forwarded-for` are absent from `CLOUDFRONT_RECORD_FIELDS` and the viewer-IP field is present; assert the mapping is total in both directions against `PAGE_VIEWS_COLUMNS` and `DERIVED_COLUMNS`.
- [ ] Keep the module pure — no `node:` builtin, no vendor SDK, no `fetch` — and add a doc comment stating that Firehose matches JSON keys to Iceberg column names exactly and discards non-matching fields with no error.

## Definition of done

- [ ] `schema.ts` declares one ordered table describing the `page_views` columns the spec lists — `event_time`, `day`, `host`, `uri`, `query`, `method`, `status`, `referrer`, `user_agent`, `country`, `asn`, `edge_location`, `result_type`, `bytes_sent`, `time_taken`, `content_type`, `protocol`, `request_id`, `visitor_key`, `is_bot` — with their Iceberg types and the `day` partition, their required/optional split matching the spec's `PageView.required` list, and a test that iterates the table asserting every column name matches `^[a-z0-9_]+$` (an S3 Tables catalog requirement), so a capitalised or parenthesised name cannot ship.
- [ ] The CloudFront record-field selection is declared in the same module, and a negative-space test asserts `cs(Cookie)` and `x-forwarded-for` are absent (they must never leave CloudFront) while the viewer-IP field is present because the transform derives `visitor_key` from it.
- [ ] A test asserts the mapping is complete in both directions: every selected CloudFront field maps to exactly one column, and every column is either mapped from a selected field or listed in `DERIVED_COLUMNS` (`event_time`, `day`, `visitor_key`, `is_bot`) — a column with neither source fails the test.
- [ ] The module imports no Node builtin, no vendor SDK and no `fetch`; it is pure data plus pure functions, confirmed by reading its import list.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- schema` inside `packages/analytics`; delete one entry from `FIELD_TO_COLUMN` and confirm the totality test fails naming the orphaned column, then restore it.
