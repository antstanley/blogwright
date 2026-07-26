# Task 34 — GlueClient in blogwright-core

**Plan:** [plan.md](../plan.md) · **Certificate:** [34-core_glue_client-certificate.md](34-core_glue_client-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §`blogwright-core` → New service clients (Add)](../../../changes/2026-07-26-analytics_plugin.md) (`GlueClient` — the catalog federation create and lookup, the only Glue operations the catalog-integration node needs)
**Depends on:** 31
**Produces:** a `GlueClient` exposing exactly two operations — create the `s3tablescatalog` federation and look one up — with the lookup returning `undefined` when absent so the node can adopt an existing federation, and create idempotent on already-exists
**Pointers:** `packages/core/src/aws/glue.ts` (new — the client lives here), `packages/core/src/aws/secretsmanager.ts:5,14-31` (the AWS-JSON `TARGET` constant and `call<T>(op, payload)` helper to follow), `packages/core/src/aws/secretsmanager.ts:78-89` (the describe-returns-undefined-on-absent shape), `packages/core/src/aws/errors.ts:24,32` (`isNotFound`, whose `NotFound` pattern matches Glue's `EntityNotFoundException`, and `isAlreadyExists`, whose `AlreadyExists` pattern matches `AlreadyExistsException`), `packages/core/src/aws/logs.test.ts:9-16,49-66` (the transport-stub helpers and the idempotency describe the tests mirror), `packages/core/src/index.ts:10-11` (the alphabetical export list `glue` slots into)

## Steps

- [ ] Write `packages/core/src/aws/glue.ts` in the AWS-JSON shape of `packages/core/src/aws/secretsmanager.ts:5,18-31`: a module-level `TARGET` of `AWSGlue`, a module doc comment stating the client exists solely for the `s3tablescatalog` federation Firehose writes through, and a private `call<T>(op, payload)` posting `application/x-amz-json-1.1` to `/` with `x-amz-target: ${TARGET}.${op}`.
- [ ] Expose exactly two methods — `createCatalogFederation` and `getCatalogFederation` — taking the catalog name and the S3 Tables bucket ARN, and verify the operation names and body shape against the Glue API reference before writing, because no SDK validates them.
- [ ] Return `undefined` from `getCatalogFederation` on `AwsError.isNotFound` (`packages/core/src/aws/errors.ts:24` — the `NotFound` pattern matches Glue's `EntityNotFoundException`) in the `packages/core/src/aws/secretsmanager.ts:78-89` shape, so the catalog-integration node can adopt an existing federation instead of creating one.
- [ ] Swallow already-exists on `createCatalogFederation` via `AwsError.isAlreadyExists` (`packages/core/src/aws/errors.ts:32` — the `AlreadyExists` pattern matches Glue's `AlreadyExistsException`), with a comment stating why: the federation is account-and-region-scoped shared state, so two environments must not fight over it.
- [ ] Rethrow every other failure as an `AwsError` (`packages/core/src/aws/errors.ts:8`) preserving `code`, `statusCode` and `requestId` with the operation and catalog name prefixed onto the message, so no Glue error crosses the boundary without context.
- [ ] Write `packages/core/src/aws/glue.test.ts` with the `packages/core/src/aws/logs.test.ts:9-16` transport helpers: a present lookup returning the mapped domain value, an absent lookup returning `undefined`, an `AlreadyExistsException` create resolving, a `ValidationException` create rejecting, and pinned `x-amz-target` and body assertions for both operations.
- [ ] Add `export * from './aws/glue.js';` to `packages/core/src/index.ts` between `./aws/form.js` at `:10` and `./aws/iam.js` at `:11`, keeping the list alphabetical.

## Definition of done

- [ ] `GlueClient` exposes exactly two operations — create catalog federation and look one up — because those are the only ones the catalog-integration node needs.
- [ ] The lookup returns `undefined` when the federation does not exist so the node can adopt an existing one rather than create, and create is idempotent on already-exists because the integration is account-scoped shared state; tests cover the present lookup, the absent lookup, and an already-exists error fed back with no throw.
- [ ] Transport-mocked tests pin the `x-amz-target` and request body for both operations; non-not-found errors are rethrown with context, asserted by a case that feeds back a `ValidationException` and expects a rejection.
- [ ] The client is exported from `packages/core/src/index.ts` and `pnpm knip` reports no unused export.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- glue`; confirm the suite covers present, absent, already-exists and non-not-found, and that the class body declares no third public method.
