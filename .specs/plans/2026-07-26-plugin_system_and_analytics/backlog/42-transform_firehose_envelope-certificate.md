# Done Certificate — Task 42: The Firehose transform handler and its per-record drop path

**Task:** [42-transform_firehose_envelope.md](42-transform_firehose_envelope.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 42. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 42) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `packages/analytics/transform/handler.ts` decodes each Firehose record from base64, maps it through `mapRecord`, and returns `Ok` with the re-encoded row or `ProcessingFailed`, per record, with `recordId` echoed unchanged and no AWS SDK or network call anywhere in it.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `mapRecord` (task 40) or the `visitor_key`/`is_bot` derivation (task 41): the handler forwards their decisions and must not re-implement the mapping, the drop rule, or the salt derivation.

## Obligations

- **O1 — Per-record Ok/ProcessingFailed, proven by a mixed batch.**
  - *Claim:* the handler decodes, maps and classifies each record independently, and a batch containing one unmappable record still returns `Ok` for every other record.
  - *Evidence to collect:* run `pnpm test -- handler` in `packages/analytics` › the mixed-batch test; read the assertion and confirm it checks the `result` of every entry in the response, not just the count of failures; confirm the `Ok` entries carry base64 `data` that decodes to the mapped row.
  - *Checks:* resolve the mapping call inside the handler — confirm it is the imported `mapRecord` from `./map-record.js`, not an inline re-implementation of the field mapping.
  - *Status:* ☐ unverified

- **O2 — recordId echoed unchanged for every entry.**
  - *Claim:* every response entry carries the request entry's `recordId` verbatim, for `Ok` and `ProcessingFailed` alike.
  - *Evidence to collect:* run `pnpm test -- handler` › the id-echo test; read the assertion and confirm it compares the full ordered list of response ids against the full ordered list of request ids, including the failed entry — an assertion covering only the successful entries does not satisfy this obligation.
  - *Status:* ☐ unverified

- **O3 — No AWS SDK, no network, no module mocking.**
  - *Claim:* the handler imports no AWS SDK and performs no network call, and its tests need neither cloud access nor `vi.mock`.
  - *Evidence to collect:* run `grep -rn "@aws-sdk\|fetch(\|vi.mock\|vi.stubGlobal" packages/analytics/transform/` — expect no output; read the import list of `packages/analytics/transform/handler.ts` and confirm the Firehose envelope types are repo-owned declarations, not imported from `@types/aws-lambda`; confirm `packages/analytics/package.json` gained no dependency for this task.
  - *Status:* ☐ unverified

- **O4 — Invalid JSON and an empty batch are handled without throwing.**
  - *Claim:* a record whose payload is not valid JSON returns `ProcessingFailed`, and an empty `records` array returns an empty `records` response — neither throws.
  - *Evidence to collect:* run `pnpm test -- handler` › the invalid-JSON case and the empty-batch case; read both assertions and confirm the first asserts a returned `ProcessingFailed` entry (not a rejected promise) and the second asserts a response object with a zero-length `records` array (not `undefined`).
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: the mixed-batch response shape (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- handler` inside `packages/analytics` and observe a mixed-batch expectation with exactly one `ProcessingFailed` entry, the rest `Ok`, and the request's `recordId` values in the same order.
  - *Evidence to collect:* run `pnpm test -- handler` from `packages/analytics` and capture the output; open `packages/analytics/transform/handler.test.ts`, read the mixed-batch fixture and its expected response, and confirm the id order and the single failure by inspection.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/transform/map-record.ts` `mapRecord` is called by the handler for each decoded payload → expect task 40's and task 41's suites to still pass unchanged, and the handler to add no second mapping path : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/vitest.config.ts` `include` (widened at task 40) collects `transform/**/*.test.ts` → expect the new handler suite to be collected alongside the existing transform suites : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: Firehose's `Dropped` result (silently discard, no error prefix) is deliberately unused here — the spec routes bad records to the error prefix, which is what `ProcessingFailed` does; if the implementation uses `Dropped` anywhere, flag it against the spec. The 6 MB Firehose response-size limit and record-splitting behaviour are not covered by the DoD. How the handler obtains the day for the salt (from the record's own derived `day` versus a per-invocation value) is constrained by task 41's obligations, not restated here.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
