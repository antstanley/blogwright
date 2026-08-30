# Done Certificate - Task 33: S3TablesClient in blogwright-analytics

**Task:** [33-analytics_s3tables_client.md](33-analytics_s3tables_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 33. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 33) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** An `S3TablesClient` over the shared SigV4 transport exposing create/get/delete for table buckets, namespaces and tables, with absence returned as `undefined`, creates idempotent on already-exists, and every request shape pinned by a transport-mocked test.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the shared signing seam (`SigningClient.send`, `packages/core/src/aws/signer.ts:99`), the barrel export surface consumed by `packages/cli/src/context.ts` and `packages/pds/src/test-support.ts`, or the `s3` service key's path-style/`uriEscapePath` handling (`packages/core/src/aws/signer.ts:141`).

## Shared checkpoints

Collected once and referenced by the obligations below. This is a **second** validation, run
after the first cut was rejected for a `createTable` that carried no Iceberg schema. Everything
below was re-derived from scratch; the prior certificate was not used as evidence.

- **C1 - The change surface is three paths.** `jj status` / `jj diff --stat` in `/Users/ant/code/blogwright-task-33`: `A packages/analytics/src/aws/s3tables.test.ts` (420 lines), `A packages/analytics/src/aws/s3tables.ts` (391 lines), `M packages/analytics/src/index.ts` (+16/-6: a doc-comment rewording plus one `export *` line). No file of `packages/core`, `packages/cli`, `packages/pds` or `packages/build-agent` is touched, and `.changeset/` is untouched (see O5).

- **C2 - The wire contract, verified against AWS's own model - not against the tests.** Two
  independent copies of the authoritative service model were read: the live
  `botocore/data/s3tables/2018-05-10/service-2.json` from `boto/botocore@develop` (fetched
  2026-08-30, HTTP 200, 152 011 bytes) and the separately-shipped copy inside
  `awscli 2.36.20`. They agree on every point below.
  Service metadata: `protocol: rest-json`, `endpointPrefix: s3tables`, `signingName: s3tables`,
  `auth: [aws.auth#sigv4]` - so the descriptor `{ service: 's3tables', signingName: 's3tables' }`
  and the resolved host `s3tables.<region>.amazonaws.com` are both correct.

  | Operation | AWS model | Implementation | Verdict |
  |---|---|---|---|
  | CreateTableBucket | `PUT /buckets`, body requires `name` | `s3tables.ts:269` `PUT /buckets` body `{ name }` | match |
  | GetTableBucket | `GET /buckets/{tableBucketARN}`; response requires `arn`, `name` | `:279` | match |
  | DeleteTableBucket | `DELETE /buckets/{tableBucketARN}` (204) | `:290` | match |
  | CreateNamespace | `PUT /namespaces/{tableBucketARN}`; body `namespace` is `CreateNamespaceRequestNamespaceList` with **min 1 / max 1** | `:300` body `{ namespace: [namespace] }` | match - the single-element-array is required, not incidental |
  | GetNamespace | `GET /namespaces/{tableBucketARN}/{namespace}`; response members are `namespace`, `createdAt`, `createdBy`, `ownerAccountId`, `namespaceId`, `tableBucketId` - **no `tableBucketARN`** | `:310`; `normalizeNamespace` (`:74`) threads the caller's ARN through | match - only `CreateNamespaceResponse` carries `tableBucketARN` |
  | DeleteNamespace | `DELETE /namespaces/{tableBucketARN}/{namespace}` (204) | `:324` | match |
  | CreateTable | `PUT /tables/{tableBucketARN}/{namespace}`; required `tableBucketARN`, `namespace`, `name`, `format`; optional `metadata`; `OpenTableFormat` enum is `["ICEBERG"]` | `:345` body `{ name, format: 'ICEBERG', metadata }` | match |
  | GetTable | **`GET /get-table`** with `tableBucketARN`, `namespace`, `name`, `tableArn` all at `location: querystring`; **no URI labels at all** | `:364` `GET /get-table` + `query { tableBucketARN, namespace, name }` | match - the code is right; the 2026-08-30 correction to the task file is confirmed |
  | DeleteTable | `DELETE /tables/{tableBucketARN}/{namespace}/{name}` (204), optional `versionToken` querystring | `:383` | match (unused optional param is legitimate) |

  **The Iceberg payload, member by member** (this is the defect class the first cut shipped, so
  it was checked key by key):
  - `TableMetadata` is a **union** whose sole member is `iceberg: IcebergMetadata`. Implementation emits `metadata: { iceberg: … }` (`:150`). ✔
  - `IcebergMetadata.schema` (`IcebergSchema`) is documented "for table schemas with **primitive types only**"; `schemaV2` is for `struct`/`list`/`map`. Every `page_views` column is a primitive (`schema.ts` `IcebergType` = string|timestamp|date|int|long|double|boolean), so **`schema` is the correct member**, not `schemaV2`. ✔
  - `IcebergSchema.fields` → `SchemaField` members: `id` (Integer, **optional** - auto-assigned when omitted), `name`, `type`, `required`. **None carries a `locationName`**, so all four are plain camelCase on the wire. Implementation emits exactly `{ name, type, id, required? }` (`:152-159`). ✔
  - `IcebergPartitionSpec.fields` → `IcebergPartitionField` members: `sourceId` with `locationName: "source-id"`, `fieldId` with `locationName: "field-id"`, plus `transform` and `name` with **no** `locationName`. Under rest-json, `locationName` renames the JSON body key. So `source-id`/`field-id` are **genuinely hyphenated keys inside an otherwise camelCase payload** - the implementer's claim is correct, and confirmed independently in both model copies. Implementation emits `{ name, 'source-id', transform, 'field-id'? }` (`:163-169`). ✔
  - `IcebergPartitionSpec.specId` also carries `locationName: "spec-id"`; the client never emits it (it defaults to `0`), which is valid. ✔
  - Error shapes: `NotFoundException` (404) and `ConflictException` (409, documented as "the request failed because there is a **conflict with a previous write. You can retry the request**"). There is no `AlreadyExistsException` for these operations. There is also **no `ValidationException`** in this service - a 400 is `BadRequestException`.

- **C3 - The real error wire shape, observed live.** An unauthenticated `GET https://s3tables.us-east-1.amazonaws.com/get-table?…` (read-only, no side effect) returned:

  ```
  HTTP/1.1 403 Forbidden
  x-amzn-RequestId: 0cbb3a6b-7187-4fb5-88b8-3a6f8888cd43
  x-amzn-ErrorType: MissingAuthenticationTokenException:http://internal.amazon.com/coral/com.amazon.coral.service/
  Content-Type: application/json

  {"message":"Missing Authentication Token"}
  ```

  S3 Tables conveys the error **code in the `x-amzn-ErrorType` header only** and the **request id in `x-amzn-RequestId` only**; the JSON body carries `message` and nothing else - no `__type`, no `code`, no `Code`. Core's `parseError` (`packages/core/src/aws/signer.ts:172-197`) reads the **body only**. Consequence, proved by execution in O2: for every real S3 Tables failure `AwsError.code` is `Http<status>` and `AwsError.requestId` is `undefined`.

- **C4 - Six gates, from the workspace root.** `pnpm build` all five packages `Done`; `pnpm typecheck` all five `Done`; `pnpm test` core 140 passed/1 skipped, build-agent 27/27, pds 96/96, analytics 30/30, cli 259/259; `pnpm lint` `Done` (the only output is the pre-existing `no-shadow` warning set in `packages/cli/src/nodes.test.ts`, a file this task does not touch); `pnpm exec oxfmt --check .` "All matched files use the correct format" over 144 files; `pnpm knip` exit 0, no output.

- **C5 - Mutation restoration proof.** Every mutation in this validation was applied to a copy-backed file and reverted. Baseline and post-validation `shasum -a 1` are identical:
  `a65553cefb416ebe6692cf737613257a1a15ce6d  packages/analytics/src/aws/s3tables.ts`,
  `37a34c4e97d36134f9e3a93c5a25df88af7d9cca  packages/analytics/src/aws/s3tables.test.ts`,
  `91e6907829f2fa994b2c3d396756761a52c04a99  packages/analytics/src/index.ts`.
  `jj diff --stat` is byte-for-byte the C1 figure (420/391/16, 821 insertions, 6 deletions) and `jj status` lists the same three paths. All scratch files created during validation were deleted.

## Obligations

- **O1 - The surface is exactly the nine operations the nodes need.**
  - *Claim:* `S3TablesClient` declares `createTableBucket`/`getTableBucket`/`deleteTableBucket`, `createNamespace`/`getNamespace`/`deleteNamespace`, `createTable`/`getTable`/`deleteTable` and no other public method, each in domain vocabulary rather than mirroring the raw API response.
  - *Evidence collected:* `grep -n '^  async \|^  private \|^  constructor' packages/analytics/src/aws/s3tables.ts` returns a constructor, one `private async call<T>` (`:230`) and exactly those nine `async` methods (`:269, :279, :290, :300, :310, :324, :345, :364, :383`) - no more. The module's `^export` surface is eight names: `TableBucket`, `Namespace`, `Table`, `IcebergSchemaField`, `PartitionTransform`, `IcebergPartitionField`, `IcebergTableSchema`, `S3TablesClient`. The four new type exports are the `createTable` parameter vocabulary added by this re-cut and are all reachable from the public signature - none is speculative. `SERVICE`, `ICEBERG_FORMAT`, `PATHS`, the three `*Response` interfaces, `IcebergMetadataWire`, the three `normalize*`, `buildIcebergMetadata`, `isAlreadyExists`, `stripAwsFraming` and `rethrowWithContext` are module-private. Returned shapes are narrow domain records (`TableBucket {arn,name}`, `Namespace {name,tableBucketArn}`, `Table {arn,name,metadataLocation}`), not the raw responses (which carry `ownerAccountId`, `createdAt`, `versionToken`, `warehouseLocation`, `managedByService`, `tableBucketId` and more). Each of the nine maps to a verb on one of the change spec's `analytics-table-bucket` / `analytics-namespace` / `analytics-table` nodes (`.specs/changes/2026-07-26-analytics_plugin.md:298-300`).
  - **The consumer contract, verified outward.** The defect that sank the first cut is closed, and closed *usefully*: `createTable(bucketArn, namespace, name, schema: IcebergTableSchema)`. Task 48's mapping was written as a scratch exercise against task 39's `packages/analytics/src/schema.ts` (commit `8cc8735d`, not in this workspace), compiled with the package's own `tsconfig.typecheck.json`, and executed through the client with a recording transport:

    ```ts
    fields: PAGE_VIEWS_COLUMNS.map((column, index) => ({
      name: column.name, type: column.icebergType, id: index + 1, required: column.required,
    })),
    partitionSpec: [{
      name: PAGE_VIEWS_PARTITION_COLUMN,
      sourceId: PAGE_VIEWS_COLUMNS.findIndex((c) => c.name === PAGE_VIEWS_PARTITION_COLUMN) + 1,
      transform: 'identity',
    }],
    ```

    `pnpm --filter blogwright-analytics typecheck` passed with no error, and the emitted body was all 20 `page_views` columns as `{name, type, id, required}` with `metadata.iceberg.partitionSpec.fields = [{ name: 'day', 'source-id': 2, transform: 'identity' }]` - a payload that validates against `CreateTableRequest` member for member (C2). No contortion: eight lines, no cast, no `as`, no shim.
  - *On `IcebergSchemaField.id` being required though AWS auto-assigns it:* **reasonable, not a burden pushed downstream.** `IcebergPartitionField.sourceId` is documented as "must reference a valid field ID from the table schema", and schema and partition spec travel in the same `CreateTable` request - an auto-assigned id does not exist when `source-id` must name it. Relying on Iceberg's convention that auto-assignment numbers from 1 in declaration order would be depending on an unspecified implementation detail. The cost to task 48 is a single `index + 1`. (A client-side auto-numbering fallback for the no-partition case would be a nicety, not a correction.)
  - *Status:* ☑ SATISFIED

- **O2 - Absence, idempotency and contextual failure.**
  - *Claim:* each `get*` returns `undefined` for an absent resource, **each `create*` is idempotent on already-exists**, and every other failure surfaces as an `AwsError` naming the operation and the offending bucket/namespace/table name; transport-mocked tests cover each direction including a rethrown 500.
  - *Evidence collected - the parts that hold:* all nine `catch` blocks read `if (<predicate>) return …;` then fall to `rethrowWithContext(err, operation, resource)`; no catch swallows a non-`AwsError`. The three `get*` return `undefined` on `isNotFound` only, the three `delete*` return on `isNotFound` only, the three `create*` return on `isAlreadyExists` only. `rethrowWithContext` (`:216-226`) rebuilds the error with `service`, `code`, `statusCode`, `requestId` carried through, and `stripAwsFraming` (`:196-203`) prevents double-framing - pinned by an exact-string assertion (`s3tables: ValidationException - createTableBucket "Bad Name": name must be lowercase (HTTP 400)`). `AwsError.service` is `'s3tables'`, not `[object Object]`: `send` passes `resolved.name` into `parseError` (`signer.ts:167,177`). Nested resources are named as a path (`createTable "<arn>/web/page_views"`). Not-found and 500 behaviour is correct against the real wire too - see below.
  - *Checks - the part that fails.* The three "resolves normally on ConflictException" cases construct the error body themselves as `{"code":"ConflictException","message":…}`. **AWS never sends that body.** Per C3, S3 Tables puts the code in the `x-amzn-ErrorType` header and the body is `{"message":…}` only, so core's body-only `parseError` yields `code = "Http409"`, and `AwsError.isAlreadyExists` (`errors.ts:32`, `/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i`) does **not** match `"Http409"`. Proved by execution: a scratch test (since deleted, C5) drove the client with the observed real wire shape - status 409, `x-amzn-errortype: ConflictException:http://internal.amazon.com/coral/…`, body `{"message":"already exists"}` - and all four assertions passed:
    1. `createTableBucket` **rejects** (must resolve),
    2. `createTable` **rejects** (must resolve),
    3. `getTable` still returns `undefined` on a real 404 - saved by `isNotFound`'s `statusCode === 404` limb, which `isAlreadyExists` has no counterpart to,
    4. the thrown error carries `code: 'Http409'` and `requestId: undefined`.

    So the DoD clause "every create is idempotent on already-exists" is **satisfied against the fabricated body the tests send and unsatisfied against the service**. The local wrapper `isAlreadyExists` (`s3tables.ts:192-194`) is the right seam and already exists; it is a pure pass-through where it needs a `|| err.statusCode === 409` limb (409 is `ConflictException`'s only status in the model), plus a test built from the C3 wire shape rather than an invented body. No `packages/core` edit is required.
  - *Also:* the doc comment at `:176-190` asserts "In practice `ConflictException` is what every S3 Tables `Create*` operation returns for a duplicate name, so treating it as already-exists is correct for that case". The service does return `ConflictException`; the client cannot see that string. The comment's factual premise about `Create*` is right and its conclusion about this client is wrong. Its second half - that a genuine concurrent write conflict reads as success - is stated honestly, but "narrowing that would need a signal `AwsError` does not carry" overstates the constraint: a confirming `get*` after a 409 would narrow it with no new signal at all.
  - *Status:* ☐ **NOT SATISFIED** - the get/delete/rethrow halves hold; the create-idempotency half does not hold against the real service, and the tests that claim it agree with the implementation about a wire fact AWS does not honour.

- **O3 - Every request shape is pinned by a transport-mocked test.**
  - *Claim:* the tests drive a stub `Transport` through `SigningClient` and pin the method, path and request body of every call; no test reaches the network.
  - *Evidence collected:* `s3TablesWith(transport)` (`s3tables.test.ts:34-36`) is the only construction path and mirrors `packages/core/src/aws/logs.test.ts:14-16` over the same `response()` helper shape. `recordingTransport` captures `{ method, url, body }`; all nine operations have a `toStrictEqual` assertion (GetTable via a parsed `URL` origin+pathname plus `toStrictEqual` over `searchParams`), with bodies pinned as `undefined` for the bodyless GET/DELETE calls. 28 cases, all passing. `grep -n "fetch\|AWS_ENDPOINT_URL" packages/analytics/src/aws/s3tables.test.ts` returns nothing - no `fetchTransport`, no `fetch(`, no endpoint-override env var; substitution is at the `Transport` port.
  - *Negative controls (run by this validator, not inherited).* Two mutations were applied to `s3tables.ts` and reverted:
    1. **the `metadata` field deleted from the `createTable` PUT body** - the exact first-cut defect - → 4 failures (`pins CreateTable…`, `omits partitionSpec…`, `carries an explicit field-id…`, `reflects a changed column…`). The suite does now fire on the schema going missing.
    2. **`'source-id'` rewritten to camelCase `sourceId`** → 2 failures (`pins CreateTable…`, `carries an explicit field-id…`). The suite does fire on the hyphenated-key translation being lost.

    Both restored; hashes in C5.
  - *Residual limit, stated plainly:* transport tests still only pin what the implementation builds. What makes them meaningful here is C2 (the templates and keys they pin were independently verified against AWS's model) - and O2 records the one place where a fabricated wire fact slipped past exactly this limit.
  - *Status:* ☑ SATISFIED

- **O4 - Exported, core untouched, no unused export.**
  - *Claim:* the client is exported from `packages/analytics/src/index.ts`, `packages/core` is untouched, and `pnpm knip` reports no unused export.
  - *Evidence collected:* `packages/analytics/src/index.ts` gains one line, `export * from './aws/s3tables.js';` (trivially alphabetical at one entry; no name collides with `ANALYTICS_NAMESPACE`). `grep -rn "s3tables" packages/core/src --include='*.ts' --exclude='*.test.ts'` exits 1 with no output - `SIGNING_NAMES` (`endpoint.ts:19-31`) gains nothing and `AwsClients` gains no `s3tables` key. C1 confirms by diff that no `packages/core` file is modified. **No fork of the signing client:** `s3tables.ts`'s only import is `import { AwsError, type ServiceDescriptor, type SigningClient } from 'blogwright-core'` - no `@smithy/*`, no `@aws-crypto/*`, no `fetch`, no `node:crypto`; every request goes through `this.client.send(…)` with the plugin-supplied descriptor, resolved by `resolveService`/`canonicalHost`'s default branch to `s3tables.<region>.amazonaws.com` (confirmed by the pinned URLs). `pnpm knip` exits 0 with no output (C4).
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests ship with the change, the six gates plus `typecheck` are clean, functions are small and single-purpose, limits are named constants, errors carry context, no `null` for a domain value, external interaction only through a port.
  - *Evidence collected:* C4 - all six DEVELOPMENT.md gates plus CI's `pnpm typecheck` pass from the repo root. Functions are small and single-purpose (`call`, three `normalize*`, `buildIcebergMetadata`, `stripAwsFraming`, `rethrowWithContext`); each method is one `try`/`catch`. The one literal that would otherwise repeat is named (`ICEBERG_FORMAT`, `:20`). `undefined`, never `null`, for absence. The only external interaction is core's injected `SigningClient`/`Transport` port.
  - *Changeset:* **none exists** - `.changeset/` is untouched by this diff (C1) and holds only the five entries from earlier tasks. DEVELOPMENT.md's rule is "a **user-facing** change ships with a changeset; internal-only changes … do not need one." `blogwright-analytics` is publishable and in the fixed group (`.changeset/config.json:5`) but still carries no `blogwright.plugin` manifest field and no `Plugin` default export (task 47), so nothing here is reachable by any user and the package is a dependency of nothing. This is the same reading task 32 shipped the package skeleton on. Accepted, and flagged in Residue so task 58's closure changeset covers the client.
  - *Note:* the qualitative DoD items are met; O5's verdict does not absorb O2's failure, which is scored where it belongs.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable.**
  - *Claim:* `pnpm --filter blogwright-analytics exec vitest run s3tables --reporter=verbose` shows all nine operations pinning a method, a path and a request body against a stub `Transport`, with no `fetchTransport` and no `fetch`.
  - *Evidence collected:* run verbatim as the task file now words it (the filter reads `blogwright-analytics`, correct - the earlier `blogwright-core` filter has been fixed): `Test Files 1 passed (1)`, `Tests 28 passed (28)`, 9.34s. The nine `pins …` case names appear in the verbose output, one per operation. `grep -n "fetch" packages/analytics/src/aws/s3tables.test.ts` returns nothing.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/context.ts` imports `createClients` from `blogwright-core` → no core file is in the diff (C1); `packages/cli` builds, typechecks and runs 259/259 : ☑ PRESERVED
- `packages/pds/src/test-support.ts` imports `createClients` from `blogwright-core` → `packages/pds` 96/96 : ☑ PRESERVED
- P3's third invariant, the `s3` key's `uriEscapePath: false` (`signer.ts:141`): untouched, and the new client is the non-`s3` branch by construction; `packages/core` 140 passed / 1 skipped : ☑ PRESERVED
- `packages/analytics` own suite: 30/30 (28 s3tables + 2 index) : ☑ PRESERVED

Otherwise: new code with no existing callers - `S3TablesClient` is first consumed by task 48.

## Residue

1. **`AwsError.requestId` is always `undefined` for S3 Tables, and `AwsError.code` is always `Http<status>`.** Core's `parseError` (`signer.ts:172-197`) reads the response body only, and S3 Tables carries both the code and the request id in headers (C3). Two consequences beyond O2: an operator debugging a production failure has no AWS request id to hand to support, and any future downstream narrowing on `err.code === 'NotFoundException'` will silently never match. Fixing this properly is a core change (read `x-amzn-errortype` and `x-amzn-requestid` from `RawResponse.headers`, which `parseError` already receives) and would benefit every rest-json client, present and future - worth a plan entry, and it would subsume O2's local fix.
2. **The test file's error codes are invented.** `ValidationException` does not exist in the s3tables model; a 400 is `BadRequestException`. Harmless for the wrapper the test exercises, but it is the same habit that produced O2's defect: pinning behaviour against a wire fact nobody checked.
3. **Decision 1 (`create*` returns `void`) holds up.** Verified: `GetTable` is name-keyed (`tableBucketARN`+`namespace`+`name` at querystring) and returns `tableARN`, so a table's opaque generated ARN *is* reachable by lookup - the gap closes at the cost of one extra call. `createTable` also discards `versionToken` (required by `UpdateTableMetadataLocation`, optional on `DeleteTable`); none of the nine operations needs it, so that is correct restraint, not an omission. A caller wanting the ARN without a second round-trip is the only party who pays.
4. **Task 48 must synthesise field ids.** `PAGE_VIEWS_COLUMNS` carries none; the mapping in O1 uses `index + 1` and a `findIndex` for `sourceId`. Judged reasonable (see O1) - but it means the ids are positional, so **reordering `PAGE_VIEWS_COLUMNS` renumbers every field**. Harmless at create time; it would matter if anything ever diffs a live table's schema against the constant. Worth a comment in task 48's mapping.
5. **Minor.** `normalizeTableBucket`/`normalizeTable` (`:69,:96`) default a missing `arn` to `''`; both fields are `required` in AWS's model, so a malformed 200 yields an empty-string ARN rather than failing loudly. `rethrowWithContext` builds a fresh `AwsError` with no `cause` link (core chains none either). `content-type: application/json` is sent on bodyless GET/DELETE calls - harmless. The three 500 cases each take ~3s because `SigningClient.send` retries 5xx for idempotent methods; that is most of the 9.3s suite.
6. **`pnpm knip` does not prove the client is live** - `index.ts` re-exports the module wholesale. The real consumer arrives with task 48.
7. **Changeset.** None here, by the reading recorded in O5. Task 58's analytics closure changeset should describe the client along with the rest of the plugin surface.

## Conclusion

VERDICT: ☑ PARTIAL
CONFIDENCE: ☑ high
SUMMARY: Five of six obligations are SATISFIED against freshly collected evidence and all four regression checks are PRESERVED - every method, path, parameter placement and JSON key was re-verified against two independent copies of AWS's own `s3tables` service model rather than against the tests, the first cut's schema-less-`createTable` defect is closed and closed usefully (task 48's mapping compiles and emits a model-valid payload in eight lines), and two reverted mutations prove the suite fires on both the `metadata` field and the hyphenated `source-id` key. O2 fails: a live probe of the service shows S3 Tables returns its error code in the `x-amzn-ErrorType` header with a body of `{"message":…}` only, so core's body-only `parseError` yields `code: "Http409"` and `AwsError.isAlreadyExists` never matches - all three `create*` operations reject on a real `ConflictException` instead of resolving, which is exactly the DoD's "every create is idempotent on already-exists", and the three tests that claim it pass only because they fabricate a `code` key AWS does not send. `isNotFound` survives on its `statusCode === 404` limb, so `get*`/`delete*` are unaffected. The fix is local to `s3tables.ts:192-194` (`|| err.statusCode === 409`) plus a test built from the observed wire shape; no `packages/core` edit is needed. Re-validate O2 only.
