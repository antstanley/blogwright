# Done Certificate — Task 37: Optional output format, record fields and field delimiter on LogsClient deliveries

**Task:** [37-core_logs_delivery_configuration.md](37-core_logs_delivery_configuration.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 37. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 37) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `putDeliveryDestination` accepts an output format and `createDelivery` accepts record fields and a field delimiter, each optional and each absent from the request body when omitted, with a test pinning the site's existing delivery bodies byte-for-byte.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's vended log delivery — `logDeliveryNode` at `packages/cli/src/nodes.ts:713-777`, including the `wire()` sequence at `:714-734`, the `ConflictException` retry at `:744-761` and the teardown ordering at `:763-775` — nor the `LogsClient` behaviour pinned by `packages/core/src/aws/logs.test.ts:18-66`.

## Obligations

- **O1 — Three optional parameters, omitted from the body when absent.**
  - *Claim:* `putDeliveryDestination` at `packages/core/src/aws/logs.ts:106` takes an optional output format and `createDelivery` at `:114` takes optional record fields and a field delimiter; all three are declared `?: T | undefined` (the `exactOptionalPropertyTypes` form used at `packages/core/src/aws/logs.ts:14-15`) and each is conditionally spread into the request body.
  - *Evidence to collect:* read `packages/core/src/aws/logs.ts:106-125` and confirm each optional field is declared with the explicit `| undefined` union and appears in the body only through a `...(x !== undefined ? { x } : {})` spread; run `pnpm typecheck` at the repo root and expect it clean.
  - *Checks:* confirm neither method grew past two positional parameters — the options arrive in a trailing object in the `filterEvents(logGroupName, opts = {})` shape at `packages/core/src/aws/logs.ts:71`, per DEVELOPMENT.md §Code style ("Prefer 0–2 parameters").
  - *Status:* ☐ unverified

- **O2 — The site's existing delivery bodies are byte-identical.**
  - *Claim:* with no options supplied, `putDeliveryDestination` sends exactly `{ name, deliveryDestinationConfiguration: { destinationResourceArn } }` and `createDelivery` sends exactly `{ deliverySourceName, deliveryDestinationArn }` — the same keys and values as before the change.
  - *Evidence to collect:* run `pnpm test -- logs` and confirm a named case captures both request bodies through a stub `Transport` and asserts them with `toEqual` (not `toMatchObject`, which would not catch an added key); compare the asserted objects against `packages/core/src/aws/logs.ts:109` and `:116` as they stand on `main`.
  - *Status:* ☐ unverified

- **O3 — The options reach the body when supplied.**
  - *Claim:* supplying an output format puts it in the `PutDeliveryDestination` body, and supplying record fields and a delimiter puts both in the `CreateDelivery` body.
  - *Evidence to collect:* run `pnpm test -- logs` and confirm a named case asserts each supplied option in the captured body, plus a case supplying only one of the two `createDelivery` options and asserting the other key is absent.
  - *Status:* ☐ unverified

- **O4 — The already-exists swallow and the existing suite survive unmodified.**
  - *Claim:* `createDelivery` still returns normally on `AwsError.isAlreadyExists`, and the pre-existing describes at `packages/core/src/aws/logs.test.ts:18-66` pass with no edits.
  - *Evidence to collect:* read `packages/core/src/aws/logs.ts:115-120` and confirm the `try`/`catch` is unchanged; run `jj diff packages/core/src/aws/logs.test.ts` and confirm the diff is additive only — no line inside `LogsClient.findDeliveryIdBySource` or `LogsClient delete* idempotency` is removed or altered.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- logs` and `pnpm test -- nodes`; confirm the pinned no-options bodies are exactly the two objects `packages/cli/src/nodes.ts:727,732` produce today and that the CLI's log-delivery node tests pass with no change to their client fakes (Reviewable).**
  - *Claim:* a reviewer can run both filtered suites and observe the unchanged delivery bodies plus a green CLI node suite whose `LogsClient` fakes were not edited.
  - *Evidence to collect:* run `pnpm test -- logs` and `pnpm test -- nodes` and record the pass counts; run `jj diff packages/cli/src/nodes.test.ts` and expect an empty diff.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:727` calls `putDeliveryDestination(ctx.names.deliveryDestination, groupArn)` with two arguments → expect the same two-key `PutDeliveryDestination` body and the returned destination ARN : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:732` calls `createDelivery(ctx.names.deliverySource, destArn)` with two arguments → expect the same two-key `CreateDelivery` body and an already-exists response still swallowed : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.test.ts:546-551` supplies a two-parameter `putDeliveryDestination`/`createDelivery` fake through `createTestContext` → expect it to still satisfy the widened signature without edits : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: `deliveriesForSource` is untouched here — task 52 widens its return to carry each delivery's destination ARN, because it is the task that rewrites its only caller — so its absence from this task's diff is expected, not a gap. The spec also states that the output format is immutable once a destination exists, so the delivery-destination node replaces rather than updates when the configured format differs — that is task 53's obligation, not this one, and its absence here is not a defect. Validating the record-field names against the CloudFront field set is task 39's concern. If the `DeliveryOutputFormat` union omits a member the API accepts, the omission is a follow-up rather than a regression, since no existing caller supplies a format at all.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
