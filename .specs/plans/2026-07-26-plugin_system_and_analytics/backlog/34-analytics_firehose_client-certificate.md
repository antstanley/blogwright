# Done Certificate — Task 35: FirehoseClient in blogwright-core

**Task:** [34-analytics_firehose_client.md](34-analytics_firehose_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 34. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 35) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** A `FirehoseClient` exposing create, describe, delete and tagging for one delivery stream, with the Iceberg destination as a typed input, the stream's delivery state returned in domain vocabulary, and every `x-amz-target` and body pinned by a transport-mocked test.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the shared signing seam (`SigningClient.send` at `packages/core/src/aws/signer.ts:95`) or the barrel export surface consumed by `packages/cli/src/context.ts:5` and `packages/pds/src/test-support.ts:13`.

## Obligations

- **O1 — The surface is four operations, with a typed destination input.**
  - *Claim:* `FirehoseClient` in `packages/analytics/src/aws/firehose.ts` declares `createDeliveryStream`, `describeDeliveryStream`, `deleteDeliveryStream` and `tagDeliveryStream` and no other public method, and the Iceberg destination is a declared interface with named fields, not `Record<string, unknown>` or an inline object literal type.
  - *Evidence to collect:* read the class body and the exported interfaces of `packages/analytics/src/aws/firehose.ts`; confirm the destination parameter's type is a named interface whose fields cover the catalog ARN, delivery role ARN, destination table, error-output prefix and bucket, buffering hints, and transform Lambda ARN.
  - *Checks:* grep `packages/analytics/src/aws/firehose.ts` for `any`, `unknown` and `Record<string, unknown>` in the destination input's type — expect no match, per DEVELOPMENT.md §Code style.
  - *Status:* ☐ unverified

- **O2 — Describe returns domain state or `undefined`; delete is re-runnable and every other error keeps its context.**
  - *Claim:* `describeDeliveryStream` returns a narrow domain type carrying the stream's delivery state (not the raw `DescribeDeliveryStream` response) and `undefined` on `AwsError.isNotFound`; `deleteDeliveryStream` resolves on `isNotFound` and rejects on any other failure with the operation and stream name in the message.
  - *Evidence to collect:* read `describeDeliveryStream`, `deleteDeliveryStream` and their return types in `packages/analytics/src/aws/firehose.ts`; run `pnpm test -- firehose` and confirm four named cases exist — a populated describe expecting the mapped domain fields, a `ResourceNotFoundException` describe expecting `undefined`, a `ResourceNotFoundException` delete expecting `resolves.toBeUndefined()`, and a `ValidationException` delete expecting `rejects.toThrow` (the `packages/core/src/aws/logs.test.ts:49-66` shape).
  - *Checks:* resolve the rethrow construction in `packages/analytics/src/aws/firehose.ts` — confirm it preserves `code`, `statusCode` and `requestId` from `packages/core/src/aws/errors.ts:8-21` rather than throwing a bare `Error`, so downstream `isNotFound` narrowing still works.
  - *Status:* ☐ unverified

- **O3 — Every request shape is pinned, with no network access.**
  - *Claim:* `packages/analytics/src/aws/firehose.test.ts` asserts the `x-amz-target` header and the parsed request body for all four operations, driving a stub `Transport` through `SigningClient`.
  - *Evidence to collect:* read `packages/analytics/src/aws/firehose.test.ts` and confirm each operation has a recorded header and body assertion; run `pnpm test -- firehose` and record the case names.
  - *Checks:* grep the test file for `fetchTransport`, `fetch(` and `AWS_ENDPOINT_URL` — expect no match.
  - *Status:* ☐ unverified

- **O4 — Exported and not dead.**
  - *Claim:* `packages/core/src/index.ts` re-exports `./aws/firehose.js`, and `pnpm knip` reports no unused export for the new module.
  - *Evidence to collect:* read `packages/core/src/index.ts` and confirm the export line sits between `./aws/errors.js` and `./aws/form.js`; run `pnpm knip` from the repo root — expect a clean report.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- firehose`; confirm each of the four operations pins its `x-amz-target` and body against a stub `Transport`, and that describe returns `undefined` rather than throwing on `ResourceNotFoundException` (Reviewable).**
  - *Claim:* a reviewer can run the filtered suite and observe four pinned request shapes plus the absent-stream case.
  - *Evidence to collect:* run `pnpm test -- firehose` and record the pass count and case names; read the assertion for the absent-stream case and confirm it expects `undefined`, not a rejection.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:5` imports from `blogwright-core` → expect the widened barrel at `packages/core/src/index.ts` to still resolve every existing named export : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/test-support.ts:13` imports `createClients` from `blogwright-core` → expect `pnpm test` in `packages/pds` to remain green : ☐ (PRESERVED / REGRESSION)

Otherwise: new code with no existing callers — `FirehoseClient` is first consumed by task 51.

## Residue

Notes for the validator: buffering-hint bounds and the error-output prefix are values the stream node (task 51) supplies; this task only has to type them, so a missing range check here is not a defect. The stream's region pinning is task 38's obligation, not this one. Firehose request shapes cannot be validated without real AWS — a body that passes the pinned assertions can still be rejected by the service, so a path or key that diverges from the published API reference is a defect even with a green suite.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
