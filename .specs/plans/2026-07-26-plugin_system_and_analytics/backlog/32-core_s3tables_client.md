# Task 32 — S3TablesClient in blogwright-core

**Plan:** [plan.md](../plan.md) · **Certificate:** [32-core_s3tables_client-certificate.md](32-core_s3tables_client-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §`blogwright-core` → New service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) (`S3TablesClient` — REST-JSON: create/get/delete for table buckets, namespaces, and tables)
**Depends on:** 31
**Produces:** an `S3TablesClient` over the shared SigV4 transport exposing create/get/delete for table buckets, namespaces and tables, with absence returned as `undefined`, creates idempotent on already-exists, and every request shape pinned by a transport-mocked test
**Pointers:** `packages/core/src/aws/s3tables.ts` (new — the client lives here), `packages/core/src/aws/microvms.ts:4-11,13-21,124-140` (the REST-JSON module doc comment, the `PATHS` table with percent-encoded segments, and the `call<T>(method, path, payload?)` helper to follow), `packages/core/src/aws/secretsmanager.ts:65,92` (the undefined-on-absent and swallow-not-found shapes), `packages/core/src/aws/s3.ts:71-74` (the already-exists swallow on create), `packages/core/src/aws/errors.ts:8,24,32` (the `AwsError` constructor plus `isNotFound` / `isAlreadyExists`), `packages/core/src/aws/logs.test.ts:9,14` (the `response()` and `logsWith()` transport-stub helpers the tests mirror), `packages/core/src/index.ts:15-16` (the alphabetical export list `s3tables` slots into)

## Steps

- [ ] Write `packages/core/src/aws/s3tables.ts` opening with a module doc comment (the `packages/core/src/aws/microvms.ts:4-11` shape) naming the protocol — REST-JSON over the `s3tables` signing key added in task 31 — and stating that the floci emulator does not implement the service, so it is covered by transport mocks.
- [ ] Declare a `PATHS` table in the `packages/core/src/aws/microvms.ts:15-21` shape covering `PUT /buckets`, `GET|DELETE /buckets/{tableBucketArn}`, `PUT /namespaces/{tableBucketArn}`, `GET|DELETE /namespaces/{tableBucketArn}/{namespace}`, `PUT /tables/{tableBucketArn}/{namespace}` and `GET|DELETE /tables/{tableBucketArn}/{namespace}/{name}`, percent-encoding every interpolated segment as `microvms.ts:17` does — and verify each method and path against the S3 Tables API reference before writing, because no SDK validates them.
- [ ] Add a private `call<T>(method, path, payload?)` helper in the `packages/core/src/aws/microvms.ts:124-140` shape, sending `service: 's3tables'` with `content-type: application/json` and parsing an empty body as `{}`.
- [ ] Expose exactly nine methods in domain vocabulary — `createTableBucket`/`getTableBucket`/`deleteTableBucket`, `createNamespace`/`getNamespace`/`deleteNamespace`, `createTable`/`getTable`/`deleteTable` — each returning a narrow domain shape (ARN, name, metadata-location) rather than the raw response, and add nothing the analytics nodes do not call.
- [ ] Give every `get*` an `AwsError.isNotFound` catch returning `undefined` (`packages/core/src/aws/secretsmanager.ts:65-75`), every `create*` an `isAlreadyExists` catch returning normally (`packages/core/src/aws/s3.ts:71-74`), and every `delete*` an `isNotFound` swallow so teardown is re-runnable.
- [ ] Rethrow every other failure as an `AwsError` (`packages/core/src/aws/errors.ts:8`) that keeps the original `code`, `statusCode` and `requestId` and prefixes the message with the operation and the offending bucket/namespace/table name, so `isNotFound`/`isAlreadyExists` still narrow downstream and no context is lost.
- [ ] Write `packages/core/src/aws/s3tables.test.ts` reusing the `response()` and `<client>With(transport)` helpers from `packages/core/src/aws/logs.test.ts:9-16`: one recording-transport case per operation pinning method, path and parsed body, plus an absent-resource case, an already-exists create case, and a 500 that must reject.
- [ ] Add `export * from './aws/s3tables.js';` to `packages/core/src/index.ts` between `./aws/s3.js` at `:15` and `./aws/secretsmanager.js` at `:16`, keeping the list alphabetical.

## Definition of done

- [ ] `S3TablesClient` exposes exactly the operations the nodes need — create/get/delete for table buckets, namespaces and tables — in domain vocabulary; no operation is added speculatively.
- [ ] Every get returns `undefined` for an absent resource rather than throwing and every create is idempotent on already-exists, while non-not-found failures surface as `AwsError` carrying the operation and the offending bucket/namespace/table name; transport-mocked tests cover each direction, including a 500 that is rethrown rather than swallowed.
- [ ] Tests drive a `Transport` stub through `SigningClient` (the `packages/core/src/aws/logs.test.ts` pattern) and pin the HTTP method, path and request body of every call; no test reaches the network.
- [ ] The client is exported from `packages/core/src/index.ts` and `pnpm knip` reports no unused export.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- s3tables`; confirm all nine operations pin a method, a path and a request body against a stub `Transport`, and that no test constructs `fetchTransport` or calls `fetch`.
