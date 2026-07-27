# Task 37 — Optional output format, record fields and field delimiter on LogsClient deliveries

**Plan:** [plan.md](../plan.md) · **Certificate:** [37-core_logs_delivery_configuration-certificate.md](37-core_logs_delivery_configuration-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §`blogwright-core` → `LogsClient` delivery configuration (Modify)](../../../changes/2026-07-26-analytics_plugin.md) ("Both are optional and default to today's behaviour, so the site's existing CloudWatch delivery is unchanged")
**Depends on:** —
**Produces:** `putDeliveryDestination` accepts an output format and `createDelivery` accepts record fields and a field delimiter, each optional and each absent from the request body when omitted, with a test pinning the site's existing delivery bodies byte-for-byte
**Pointers:** `packages/core/src/aws/logs.ts:106-112` (`putDeliveryDestination` and its two-key `PutDeliveryDestination` body), `packages/core/src/aws/logs.ts:114-121` (`createDelivery` and the `isAlreadyExists` swallow that must survive), `packages/core/src/aws/logs.ts:71-87` (`filterEvents(logGroupName, opts: FilterEventsOptions = {})` — the trailing-options-object shape to follow, so neither method grows past two positional parameters), `packages/core/src/aws/logs.ts:41,77-79` (the conditional-spread idiom for optional body keys), `packages/cli/src/nodes.ts:727-732` (the site's only callers, which must not need editing), `packages/cli/src/nodes.test.ts:59-63,546-551` (the two-argument `LogsClient` fakes that must keep typechecking), `packages/core/src/aws/logs.test.ts:9-16,49-66` (the transport-stub helpers and the existing describes that must pass unmodified)

## Steps

- [ ] Declare a `DeliveryOutputFormat` union (`'json' | 'plain' | 'w3c' | 'raw' | 'parquet'`) in `packages/core/src/aws/logs.ts` rather than accepting a free string, per DEVELOPMENT.md §Make intent explicit, and confirm the member list against the CloudWatch Logs `PutDeliveryDestination` API reference before writing.
- [ ] Add a trailing options object to `putDeliveryDestination` at `packages/core/src/aws/logs.ts:106` in the `filterEvents(logGroupName, opts = {})` shape at `:71` — `DeliveryDestinationOptions { outputFormat?: DeliveryOutputFormat | undefined }` — spreading `outputFormat` into the `PutDeliveryDestination` body only when defined, the way `filterEvents` spreads `startTime` at `:77`.
- [ ] Add a trailing options object to `createDelivery` at `packages/core/src/aws/logs.ts:114` — `DeliveryOptions { recordFields?: readonly string[] | undefined; fieldDelimiter?: string | undefined }` — spreading each into the `CreateDelivery` body only when defined, and leave the `isAlreadyExists` swallow at `:117-119` exactly as it stands.
- [ ] Keep both methods positional-compatible with their only callers at `packages/cli/src/nodes.ts:727` and `:732` and with the two-argument fakes at `packages/cli/src/nodes.test.ts:59-63,546-551`, so no CLI file changes as part of this task.
- [ ] Add a body-capturing test to `packages/core/src/aws/logs.test.ts` (using the `response()`/`logsWith()` helpers at `:9-16`) pinning the no-options bodies as exactly `{ name, deliveryDestinationConfiguration: { destinationResourceArn } }` and `{ deliverySourceName, deliveryDestinationArn }` — the same keys and values the current implementation produces for the site's CloudWatch delivery.
- [ ] Add a second test asserting `outputFormat` appears in the `PutDeliveryDestination` body and `recordFields` plus `fieldDelimiter` appear in the `CreateDelivery` body when supplied, and that supplying only one of the two `createDelivery` options leaves the other key absent.

## Definition of done

- [ ] `putDeliveryDestination` takes an optional output format and `createDelivery` takes optional record fields and a field delimiter; all three are declared `?: T | undefined` under `exactOptionalPropertyTypes` and are omitted from the request body when absent.
- [ ] A test asserts the request body for the site's existing CloudWatch delivery is unchanged when the new options are omitted — same keys, same values as the current implementation produces.
- [ ] A test asserts the options appear in the request body when supplied: `outputFormat` on `PutDeliveryDestination`, record fields and delimiter on `CreateDelivery`.
- [ ] `createDelivery`'s existing already-exists swallow and the existing `LogsClient` tests at `packages/core/src/aws/logs.test.ts:18-66` pass unmodified.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- logs` and `pnpm test -- nodes`; confirm the pinned no-options bodies are exactly the two objects `packages/cli/src/nodes.ts:727,732` produce today and that the CLI's log-delivery node tests pass with no change to their client fakes.
