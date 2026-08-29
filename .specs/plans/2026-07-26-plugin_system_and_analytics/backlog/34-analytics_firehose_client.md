# Task 34 - FirehoseClient in blogwright-analytics

**Plan:** [plan.md](../plan.md) · **Certificate:** [34-analytics_firehose_client-certificate.md](34-analytics_firehose_client-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics plugin → Its own service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) (`FirehoseClient` - create/describe/delete delivery stream, and tagging; it lives in `blogwright-analytics`, not in core)
**Depends on:** 31, 32
**Produces:** a `FirehoseClient` exposing create, describe, delete and tagging for one delivery stream, with the Iceberg destination as a typed input, the stream's delivery state returned in domain vocabulary, and every `x-amz-target` and body pinned by a transport-mocked test
**Pointers:** `packages/analytics/src/aws/firehose.ts` (new - the client lives here), `packages/core/src/aws/secretsmanager.ts:5,14-31` (the AWS-JSON `TARGET` constant and `call<T>(op, payload)` helper to follow), `packages/core/src/aws/secretsmanager.ts:78-89` (the describe-returns-undefined-on-absent shape), `packages/core/src/aws/logs.ts:155-162` (the delete not-found swallow to mirror), `packages/core/src/aws/errors.ts:24,32` (`isNotFound` / `isAlreadyExists`), `packages/core/src/aws/logs.test.ts:9-16,49-66` (the transport-stub helpers and the delete-idempotency describe the tests mirror), `packages/core/src/tags.ts` (`ResourceTags`, the tagging input type every client already takes), `packages/analytics/src/index.ts` (task 32's seeded barrel - the client is exported from there, never from core)

## Steps

- [ ] Write `packages/analytics/src/aws/firehose.ts` in the AWS-JSON shape of `packages/core/src/aws/secretsmanager.ts:5,18-31`: a module-level `TARGET` of `Firehose_20150804`, a module doc comment naming the protocol, and a private `call<T>(op, payload)` posting `application/x-amz-json-1.1` to `/` with `x-amz-target: ${TARGET}.${op}`.
- [ ] Declare the destination input as a typed interface rather than an untyped object - `IcebergDestinationInput` carrying the Glue catalog ARN, the delivery role ARN, the destination table (namespace and name), the S3 error-output prefix and bucket ARN, the buffering hints, and the transform Lambda ARN - with units stated in doc comments the way `packages/core/src/aws/microvms.ts:23-41` does.
- [ ] Expose exactly four methods - `createDeliveryStream`, `describeDeliveryStream`, `deleteDeliveryStream`, `tagDeliveryStream` - and verify each operation name and body shape against the Firehose API reference before writing, because no SDK validates them.
- [ ] Map `DescribeDeliveryStream`'s response onto a narrow domain type (`DeliveryStreamStatus`: name, ARN, delivery state, and the last failure description when present) so `analytics status` can report health without re-reading the raw response, and return `undefined` on `AwsError.isNotFound` in the `packages/core/src/aws/secretsmanager.ts:78-89` shape.
- [ ] Give `deleteDeliveryStream` the not-found swallow at `packages/core/src/aws/logs.ts:155-162` so teardown is re-runnable, and rethrow every other failure as an `AwsError` (`packages/core/src/aws/errors.ts:8`) preserving `code`, `statusCode` and `requestId` with the operation and stream name prefixed onto the message.
- [ ] Have `tagDeliveryStream` take the repo's `ResourceTags` and skip the call entirely when the map is empty, the way `packages/core/src/aws/logs.ts:41` spreads tags only when non-empty.
- [ ] Write `packages/analytics/src/aws/firehose.test.ts` with the `packages/core/src/aws/logs.test.ts:9-16` transport helpers: one case per operation pinning the `x-amz-target` header and the parsed request body, an absent-stream describe returning `undefined`, a not-found delete resolving, and a `ValidationException` delete rejecting - mirroring `logs.test.ts:49-66`.
- [ ] Export the client from `packages/analytics/src/index.ts`, keeping the barrel alphabetical. Nothing is added to `packages/core/src/index.ts`.

## Definition of done

- [ ] `FirehoseClient` exposes create, describe, delete and tagging for a delivery stream and nothing else; the Iceberg destination configuration is accepted as a typed input, not an untyped object.
- [ ] `describeDeliveryStream` returns the stream's delivery state in domain vocabulary so `analytics status` can report health without re-reading the raw response, and returns `undefined` for an absent stream; `deleteDeliveryStream` swallows not-found so teardown is re-runnable and rethrows every other error with context - each direction asserted, mirroring the `LogsClient` delete idempotency tests at `packages/core/src/aws/logs.test.ts:49-66`.
- [ ] Transport-mocked tests pin the `x-amz-target` and request body for each operation; no test reaches the network.
- [ ] The client is exported from `packages/analytics/src/index.ts`, `packages/core` is untouched, and `pnpm knip` reports no unused export.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-core exec vitest run firehose --reporter=verbose`; confirm each of the four operations pins its `x-amz-target` and body against a stub `Transport`, and that describe returns `undefined` rather than throwing on `ResourceNotFoundException`.
