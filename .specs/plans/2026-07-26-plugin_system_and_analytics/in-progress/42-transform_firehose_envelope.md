# Task 42 - The Firehose transform handler and its per-record drop path

**Plan:** [plan.md](../plan.md) · **Certificate:** [42-transform_firehose_envelope-certificate.md](42-transform_firehose_envelope-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Record transformation](../../../changes/2026-07-26-analytics_plugin.md) (step 5: records the schema cannot accept are emitted to the Firehose error prefix rather than failing the batch) and [DEVELOPMENT.md §Testing](../../../../DEVELOPMENT.md) ("Unit tests run with no cloud access"; tests substitute at ports, never by patching modules)
**Depends on:** 41
**Produces:** `packages/analytics/src/transform/handler.ts` - the Lambda entry point that decodes each Firehose record from base64, maps it through `mapRecord`, and returns `Ok` with the re-encoded row or `ProcessingFailed`, per record, with `recordId` echoed unchanged and no AWS SDK or network call anywhere in it
**Pointers:** `packages/analytics/src/transform/handler.ts` (new - the Lambda entry point and the Firehose envelope types), `packages/analytics/src/transform/handler.test.ts` (new - the per-record and batch assertions), `packages/analytics/src/transform/map-record.ts` (task 40 - `mapRecord` and its droppable result, the only decision the handler forwards), `packages/analytics/src/transform/visitor-key.ts` (task 41 - the salt derivation the handler must feed from the record's own day, not a wall clock), `packages/build-agent/src/server.ts` (the precedent for an edge entry point whose domain logic lives in separately tested pure modules)

> **ROUTED FINDING - added 2026-08-30 from task 41's implementation.**
> `mapRecord(record, saltSecret)` now takes the **secret**, not a salt. Do not
> hoist salt derivation to the batch: the day a record's salt must match comes
> from that record's own `timestamp(ms)`, and a Firehose buffer straddles
> midnight routinely, so one salt chosen per invocation is the wrong day's for
> every record on the far side of it - producing keys that silently fail to join
> with either day's.
> `dailySalt` and `visitorKey` **throw** on an empty secret, day, IP or salt,
> deliberately: an unsalted digest that looks protected is worse than a failed
> batch, because the table stores `user_agent` in the clear beside the key and
> an unsalted SHA-256 of an IPv4 address is a lookup table (2^32 addresses). So
> when you fail the batch on a bad secret read, do NOT wrap the mapping in a
> blanket try/catch - that converts those throws into silently dropped records
> and routes everything to the error bucket, which is the exact
> blank-dashboard-with-no-error signature this plan has already nearly shipped
> three times. Let them propagate and fail the batch loudly.

## Steps

- [ ] Read the long-lived root secret from Secrets Manager ONCE at cold start and cache it for the life of the execution environment; derive the per-record salt with `dailySalt(secret, record.day)` (task 41) rather than re-reading anything. The secret's name arrives as an environment variable set by task 50's function node. Caching matters for cost as well as latency: reading per invocation would be roughly 43,000 `GetSecretValue` calls a month at a 60-second Firehose buffer, more than half the price of the secret itself for no benefit.
- [ ] A failed secret read fails the whole batch - never fall back to an unsalted or date-only digest. A silent fallback would write unprotected data that looks protected, which is worse than writing nothing.
- [ ] Declare the Firehose transform envelope types in `handler.ts` - the request's `records` array of `{ recordId, data }` and the response's `records` array of `{ recordId, result, data? }` with `result` in `'Ok' | 'ProcessingFailed'` - as repo-owned types, so no AWS SDK or `@types/aws-lambda` dependency enters the package.
- [ ] Write the handler as a small function over the batch that maps each record independently: decode `data` from base64, parse the JSON payload, call `mapRecord`, and build the per-record response.
- [ ] Return `Ok` with the row re-encoded to base64 for records `mapRecord` accepts, and `ProcessingFailed` for the droppable ones, so Firehose routes them to the error prefix instead of failing the batch.
- [ ] Echo `recordId` unchanged onto every response entry, including the failed ones, because Firehose discards a response whose ids do not match its request.
- [ ] Handle a payload that is not valid JSON as `ProcessingFailed` rather than a throw, and an empty `records` array as an empty response, both without touching the network.
- [ ] Write `handler.test.ts`: a per-record assertion over a mixed batch, an id-echo assertion over every entry, the invalid-JSON case, and the empty-batch case - all with plain fixtures, no `vi.mock`, and no cloud access.

## Definition of done

- [ ] The handler decodes each record from base64, maps it, and returns `Ok` with the re-encoded row or `ProcessingFailed` for records the schema cannot accept - the decision is per record and asserted per record, and a batch test containing one unmappable record asserts the remaining records still return `Ok`, so a bad record reaches the Firehose error prefix instead of failing the batch.
- [ ] `recordId` is echoed unchanged for every record, `Ok` and `ProcessingFailed` alike (asserted over the whole response), because Firehose discards a response whose ids do not match its request.
- [ ] The handler imports no AWS SDK and performs no network call; its tests need no cloud access and no module mocking - `grep -rn "@aws-sdk\|fetch(\|vi.mock" packages/analytics/src/transform/` returns nothing.
- [ ] Negative-space: a record whose payload is not valid JSON returns `ProcessingFailed` rather than throwing, and an empty batch returns an empty `records` array rather than throwing (both asserted).
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run handler --reporter=verbose` inside `packages/analytics`; confirm the mixed-batch test's expected response has one `ProcessingFailed` entry and the rest `Ok`, with the request's `recordId` values in the same order.
