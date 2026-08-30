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
- **P3 - Invariants.** Must not break the shared signing seam (`SigningClient.send`, `packages/core/src/aws/signer.ts:100`), the barrel export surface consumed by `packages/cli/src/context.ts` and `packages/pds/src/test-support.ts`, or the `s3` service key's path-style/`uriEscapePath` handling (`packages/core/src/aws/signer.ts:141`).

## Validation history

This is the **third** discharge. Pass 1 rejected a `createTable` that carried no Iceberg schema.
Pass 2 (2026-08-30) re-derived everything from AWS's own service model and returned PARTIAL on
**O2 only**: `create*` idempotency did not hold against the real service, because S3 Tables
carries its error code in `x-amzn-ErrorType` and core's `parseError` reads the body only, so
`AwsError.code` is `Http409` and `isAlreadyExists`'s `/Conflict/i` never fires. The three tests
claiming otherwise passed only because the helper fabricated a body `code` key.

This pass verifies the repair. **Scope control, established before anything else:** the approved
pass-2 tree was recovered from the jj operation log (`jj --at-op fa7c1eb6def4 file show -r @`) and
diffed against the working copy. The delta is exactly:

- `s3tables.ts` - the `isAlreadyExists` doc comment (`:177-207`, rewritten) and one line, `:209`.
  **Nothing else changed:** `PATHS`, all nine methods, `buildIcebergMetadata`, the three
  `normalize*`, `stripAwsFraming`, `rethrowWithContext` and every type are byte-identical to the
  approved text.
- `s3tables.test.ts` - the `errorResponse` helper (`:61-81`) and the two `error context`
  expectations (`:420`, `:433`) plus their explanatory comment.
- `index.ts` - **unchanged**, `shasum -a 1` = `91e6907829f2fa994b2c3d396756761a52c04a99`,
  identical to pass 2.

Pass 2's SATISFIED findings for O1, O3, O4, O5 and O6 therefore stand on unchanged code and are
carried forward; O2 is re-derived in full, and O3's falsifiability walk was re-run from scratch
over all 28 cases because the delta touches the error helper every negative test depends on.

## Shared checkpoints

- **C1 - The change surface is three paths.** `jj status` / `jj diff --stat` in
  `/Users/ant/code/blogwright-task-33`: `A packages/analytics/src/aws/s3tables.test.ts` (444
  lines), `A packages/analytics/src/aws/s3tables.ts` (407 lines), `M
  packages/analytics/src/index.ts` (+16/-6). No file of `packages/core`, `packages/cli`,
  `packages/pds` or `packages/build-agent` is touched; `.changeset/` is untouched (see O5).

- **C2 - The wire contract (carried forward from pass 2, code unchanged).** Verified against two
  independent copies of `botocore/data/s3tables/2018-05-10/service-2.json` - the live
  `boto/botocore@develop` copy and the one shipped inside `awscli 2.36.20`. All nine
  operations, methods, URI templates and parameter placements match, including `GetTable` as
  `GET /get-table` with every identifier at `location: querystring` and no URI labels;
  `CreateNamespaceRequestNamespaceList` is min 1/max 1; `metadata.iceberg` is the sole member of
  the `TableMetadata` union; `schema` (not `schemaV2`) is correct for an all-primitive table;
  `SchemaField {id,name,type,required}` carries no `locationName`, while
  `IcebergPartitionField.sourceId`/`fieldId` carry `locationName: "source-id"`/`"field-id"`.

- **C3 - The error wire shape, re-probed live by this validator.** An unauthenticated
  `GET https://s3tables.us-east-1.amazonaws.com/get-table?…` (read-only, no side effect,
  2026-08-30):

  ```
  HTTP/1.1 403 Forbidden
  x-amzn-RequestId: e626b0f5-5b54-4ef8-a21d-dc8d2d5e7c21
  x-amzn-ErrorType: MissingAuthenticationTokenException:http://internal.amazon.com/coral/com.amazon.coral.service/
  Content-Type: application/json

  {"message":"Missing Authentication Token"}
  ```

  A fresh request id, so this is a new observation and not a replay of pass 2's. The body carries
  `message` and nothing else - no `__type`, no `code`, no `Code`. `parseError`
  (`signer.ts:177-199`) reads `response.text()` only; its JSON branch takes
  `json.__type ?? json.code ?? json.Code`, finds none, and leaves `code = "Http<status>"`; only
  the XML branch ever sets `requestId`. So for **every** S3 Tables failure,
  `AwsError.code === "Http<status>"` and `AwsError.requestId === undefined`.

- **C4 - The 409 discriminator, from AWS's model.** Every exception shape's
  `error.httpStatusCode`: `AccessDeniedException` 403, `BadRequestException` 400,
  **`ConflictException` 409**, `ForbiddenException` 403, `InternalServerErrorException` 500,
  `MethodNotAllowedException` 405, `NotFoundException` 404, `TooManyRequestsException` 429.
  `ConflictException` is the **only** 409 in the service. The modelled error list for each of
  `CreateTableBucket`, `CreateNamespace` and `CreateTable` is
  `[InternalServerError 500, Forbidden 403, NotFound 404, TooManyRequests 429, Conflict 409, BadRequest 400]`
  - one 409 each, and it is `ConflictException`. **No other 409 exists on these paths to be
  wrongly swallowed.**

- **C5 - Six gates, from the workspace root.** `pnpm build` all five packages `Done`;
  `pnpm typecheck` all five `Done`; `pnpm test` core 140 passed/1 skipped, build-agent 27/27,
  pds 96/96, analytics 30/30, cli 259/259; `pnpm lint` `Done` (only output is the pre-existing
  `no-shadow` warning set in `packages/cli/src/nodes.test.ts`, a file this task does not touch);
  `pnpm exec oxfmt --check .` "All matched files use the correct format", 144 files; `pnpm knip`
  exit 0, no output.

- **C6 - Mutation restoration proof.** Fifteen mutations were applied to `s3tables.ts` from a
  copy-backed original and each was reverted. Post-validation `shasum -a 1`:
  `98d32934fcea3c2dfdfb01c87512024172827ad4  packages/analytics/src/aws/s3tables.ts`,
  `9b7465306187c71de140a8a9732e028bef8c34fe  packages/analytics/src/aws/s3tables.test.ts`,
  `91e6907829f2fa994b2c3d396756761a52c04a99  packages/analytics/src/index.ts` - identical to the
  pre-mutation values. `jj status` lists the same three paths, `jj diff --stat` the same
  444/407/16, and the suite is back to 28/28. **No test file was ever mutated**; every negative
  control was applied to the implementation. All scratch files live outside the repo.

## Obligations

- **O1 - The surface is exactly the nine operations the nodes need.**
  - *Claim:* `S3TablesClient` declares the nine create/get/delete methods and no other public
    method, each in domain vocabulary rather than mirroring the raw API response.
  - *Evidence:* code unchanged from the approved pass-2 text (see Validation history). Nine
    `async` methods at `:285, :295, :306, :316, :326, :340, :361, :380, :399`, one
    `private async call<T>` (`:246`), one constructor. Eight module exports, all reachable from
    the public signature. Returned shapes are narrow domain records (`TableBucket {arn,name}`,
    `Namespace {name,tableBucketArn}`, `Table {arn,name,metadataLocation}`), not the raw
    responses. `createTable` carries the Iceberg schema, and task 48's mapping from
    `PAGE_VIEWS_COLUMNS` was written and executed against this signature in pass 2 - eight lines,
    no cast, a payload that validates against `CreateTableRequest` member for member.
  - *Status:* ☑ SATISFIED

- **O2 - Absence, idempotency and contextual failure.** *(the re-derived obligation)*
  - *Claim:* each `get*` returns `undefined` for an absent resource, **each `create*` is
    idempotent on already-exists**, and every other failure surfaces as an `AwsError` naming the
    operation and the offending bucket/namespace/table name; transport-mocked tests cover each
    direction including a rethrown 500.

  - **The test helper is truthful.** `s3tables.test.ts:74-81`:

    ```ts
    function errorResponse(status: number, code: string, message: string): RawResponse {
      return {
        ...response(status, JSON.stringify({ message })),
        headers: { 'x-amzn-errortype': `${code}:http://internal.amazon.com/coral/com.amazonaws.s3tables/` },
      };
    }
    ```

    Body is `{"message":…}` and nothing else; the exception name is in the header. That is
    exactly the shape C3 observed live. **There is no fabricated body `code`** - the sin that
    invalidated pass 2's three idempotency tests is gone. `response()` seeds `headers: {}` and
    the spread overrides it, so no other header leaks in, and `text()` closes over the same
    single-key body. The header is *decorative by design*: `parseError` never reads
    `RawResponse.headers`, which is precisely why the client has to key on `statusCode` - and
    negative control M1 below proves the header is not secretly supplying the code.

  - **The fix is load-bearing (run by this validator).** Deleting **just** the `|| err.statusCode === 409`
    limb from `:209`, changing nothing else:

    | | baseline | limb deleted |
    |---|---|---|
    | `createTableBucket resolves normally on ConflictException` | ✓ | **×** |
    | `createNamespace resolves normally on ConflictException` | ✓ | **×** |
    | `createTable resolves normally on ConflictException` | ✓ | **×** |
    | other 25 | ✓ | ✓ |
    | total | 28 passed | **3 failed \| 25 passed** |

    Each failure's stack runs through `rethrowWithContext (s3tables.ts:231)` from
    `createTableBucket:290` / `createNamespace:321` / `createTable:375` - i.e. the operations
    reject exactly as pass 2 predicted the real service would make them. Restored; 28/28 green;
    hash back to `98d32934…` (C6). **Exactly the three, no more and no fewer.**

  - **409 is the right discriminator.** C4: `ConflictException` is the only 409 in the entire
    service model, and the only 409 on each of the three `create*` paths. Nothing else can be
    swallowed. The residual ambiguity is *inside* `ConflictException` - AWS documents it as "The
    request failed because there is a conflict with a previous write. You can retry the request"
    and ships no dedicated already-exists exception - so a genuine concurrent write conflict
    reads as success. That ambiguity is **not created by choosing 409**: matching the exception
    name itself would be exactly as coarse, because the one name covers both cases. Scope is
    tight: the local `isAlreadyExists` (`:208-210`) is called from three sites only (`:289`,
    `:320`, `:374`), all `create*`. `get*`/`delete*` key on core's `err.isNotFound` and are
    untouched - so a 409 from `deleteTableBucket` on a non-empty bucket is still rethrown with
    context, not swallowed. And 409 is not retryable (`isRetryable` needs ≥500, 429, or a code
    match on `Http409`), so the create fails fast and is swallowed once.

  - **The two `error context` tests assert the truth, not the code.** They now expect
    `code: 'Http400'` and `'s3tables: Http400 - createTableBucket "Bad Name": …'`. Derived
    independently: a 400 from this service arrives with body `{"message":…}` (C3), `parseError`
    finds no `__type`/`code`/`Code`, and returns `Http400`. `Http400` is what the real service
    produces through this stack - `ValidationException` never could, and in fact is not even an
    s3tables exception (a 400 is `BadRequestException`). The change corrects a test that was
    asserting a fiction. The comment at `:408-413` states why, points at `errorResponse`, and
    notes the same gap leaves `requestId` permanently `undefined`.

  - **The doc comment at `:177-207` is accurate and does not overclaim.** Checked clause by
    clause: `ConflictException`'s only status is 409 ✓ (C4); `parseError` reads the body only ✓
    (`signer.ts:177-199`); the body carries `message` alone ✓ (C3); therefore
    `code === "Http<status>"` and `isAlreadyExists`'s `/Conflict/i` "never matches here on its
    own" ✓ (`errors.ts:32-34` against `Http409`); "mirroring how `isNotFound` survives … on its
    `statusCode === 404` limb" ✓ (`errors.ts:24-29`). The accepted gap is stated as what it is -
    "A confirming `get*` after the 409 would narrow it without any new signal, at the cost of a
    round trip … not taking it is a deliberate trade, not a missing capability" - which is the
    correction pass 2 asked for; the earlier "would need a signal `AwsError` does not carry" is
    gone. The core-level fix is named as core-level and explicitly deferred, and
    `RawResponse.headers` really is in hand at `parseError` (`signer.ts:16-21`), so that
    suggestion is sound rather than aspirational.

  - *The rest of the obligation, unchanged and re-confirmed:* all nine `catch` blocks read
    `if (<predicate>) return …;` then fall to `rethrowWithContext`; no catch swallows a
    non-`AwsError`. `rethrowWithContext` (`:229-240`) carries `service`, `code`, `statusCode`,
    `requestId` through, and `stripAwsFraming` (`:213-220`) prevents double-framing - pinned by
    an exact-string assertion. Nested resources are named as a path
    (`createTable "<arn>/web/page_views"`). Three 500 cases reject.
  - *Status:* ☑ SATISFIED

- **O3 - Every request shape is pinned by a transport-mocked test, and every test can fail.**
  - *Claim:* the tests drive a stub `Transport` through `SigningClient` and pin the method, path
    and request body of every call; no test reaches the network.
  - *Evidence:* `s3TablesWith(transport)` (`:40-42`) is the only construction path, mirroring
    `packages/core/src/aws/logs.test.ts:14-16`. `recordingTransport` captures
    `{ method, url, body }`; all nine operations have a `toStrictEqual` assertion (GetTable via a
    parsed `URL` origin+pathname plus `toStrictEqual` over `searchParams`), bodies pinned as
    `undefined` for the bodyless GET/DELETE calls. `grep -n "fetch\|AWS_ENDPOINT_URL"` over the
    test file exits 1 - no `fetchTransport`, no `fetch(`, no endpoint-override env var.
  - **Falsifiability walk - all 28 `it`s, by execution.** The plan's DoD names shipped
    assertions that cannot fail; three earlier tasks in this build had them. Fifteen mutations
    were applied to the implementation and each `it` was required to die under at least one:

    | mutation | tests killed |
    |---|---|
    | M1 `\|\| err.statusCode === 409` deleted | 3 create-idempotency |
    | A every `PATHS` entry prefixed `/zz-` | the 9 `pins …` cases |
    | B `metadataLocation ?? 'ZZ'` | `normalizes a freshly-created table` |
    | C `err.isNotFound` → `false` in all six get/delete catches | 3 absent-resource + 3 delete-idempotency |
    | D `err.isNotFound` → always-true | `rethrows a 500` (get), `rethrows a 500 on delete` |
    | E `isAlreadyExists` → always-true | `rethrows a 500 on create` + the 3 error-context cases |
    | F `rethrowWithContext` → bare `throw err` | the 3 error-context cases |
    | G `partitionSpec` emitted unconditionally | `omits partitionSpec entirely …` |
    | H `'source-id'` → `sourceId` | `pins CreateTable`, `carries an explicit field-id` |
    | I `metadata` dropped from the PUT body (the pass-1 defect) | `pins CreateTable`, `omits partitionSpec`, `carries an explicit field-id`, `reflects a changed column` |
    | J query key `tableBucketARN` → `tableBucketArn` | `pins GetTable` |
    | K `{namespace: [n]}` → `{namespace: n}` | `pins CreateNamespace` |
    | L `ICEBERG_FORMAT` → `'ZZ'` | `pins CreateTable` |
    | M `required` emitted unconditionally | `pins CreateTable`, `omits partitionSpec`, `reflects a changed column` |
    | R `'field-id'` never emitted | `carries an explicit field-id` |

    Union of the killed sets = **all 28 cases**. Every `it` in the file demonstrably fails under
    some behaviour change. No assertion-free or tautological test exists here. All mutations
    reverted (C6).
  - *Residual limit, stated plainly:* transport tests still only pin what the implementation
    builds. What makes them meaningful is C2 and C3 - the templates, keys and error shape they
    pin were verified against AWS's own model and a live probe, not against the code.
  - *Status:* ☑ SATISFIED

- **O4 - Exported, core untouched, no unused export.**
  - *Claim:* the client is exported from `packages/analytics/src/index.ts`, `packages/core` is
    untouched, and `pnpm knip` reports no unused export.
  - *Evidence:* `index.ts` gains one line, `export * from './aws/s3tables.js';`, and is
    byte-identical to the approved pass-2 file. `grep -rn "s3tables" packages/core/src
    --include='*.ts' --exclude='*.test.ts'` exits 1 with no output. The unfiltered
    `grep -r s3tables packages/core/src` returns **eight** hits
    (`endpoint.test.ts:21,23,56,61,75`, `signer.test.ts:192,198,201`); each was checked against
    the parent commit with `jj file show -r @-` and is present there at the same line with the
    same text, and `jj diff -r @ --from @-` contains **zero** `packages/core` paths -
    `endpoint.ts`, `signer.ts`, `errors.ts`, `endpoint.test.ts` and `signer.test.ts` all hash
    identically to `@-`. The implementer's "I changed nothing in core" is verified, not accepted.
    `s3tables.ts` imports only `AwsError`, `ServiceDescriptor`, `SigningClient` from
    `blogwright-core` - no `@smithy/*`, no `fetch`, no `node:crypto`. `pnpm knip` exits 0 (C5).
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Evidence:* C5 - all five DEVELOPMENT.md gates plus CI's `pnpm typecheck` pass from the repo
    root. Functions are small and single-purpose; the one repeating literal is named
    (`ICEBERG_FORMAT`); `undefined`, never `null`, for absence; the only external interaction is
    core's injected `SigningClient`/`Transport` port. Negative-space tests exist for every
    validation path (absent, already-exists, 500, error context).
  - *Changeset:* none, and none is required - `.changeset/` is untouched by this diff (C1) and
    holds only the five entries from earlier tasks. `blogwright-analytics` still carries no
    `blogwright.plugin` manifest field and no `Plugin` default export (task 47), so nothing here
    is reachable by any user; DEVELOPMENT.md requires one only for a user-facing change. Same
    reading task 32 shipped the package skeleton on. Flagged in Residue for task 58.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable.**
  - *Claim:* `pnpm --filter blogwright-analytics exec vitest run s3tables --reporter=verbose`
    shows all nine operations pinning a method, a path and a request body against a stub
    `Transport`, with no `fetchTransport` and no `fetch`.
  - *Evidence:* run verbatim as the task file words it (filter reads `blogwright-analytics`):
    `Test Files 1 passed (1)`, `Tests 28 passed (28)`, 9.25s. The nine `pins …` case names appear
    in the verbose output, one per operation. `grep -n "fetch"` over the test file exits 1.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/context.ts` imports `createClients` from `blogwright-core` → no core file is
  in the diff and every core file hashes identically to `@-` (O4); `packages/cli` builds,
  typechecks and runs 259/259 : ☑ PRESERVED
- `packages/pds/src/test-support.ts` imports `createClients` from `blogwright-core` →
  `packages/pds` 96/96 : ☑ PRESERVED
- P3's third invariant, the `s3` key's `uriEscapePath: false` (`signer.ts:141`): untouched, and
  the new client is the non-`s3` branch by construction; `packages/core` 140 passed / 1 skipped
  : ☑ PRESERVED
- The delta's blast radius beyond `create*`: `isAlreadyExists` has three call sites, all
  `create*`; `get*`/`delete*` still key on core's `isNotFound`, so a 409 on delete (non-empty
  bucket) is still rethrown, not swallowed : ☑ PRESERVED
- `packages/analytics` own suite: 30/30 (28 s3tables + 2 index) : ☑ PRESERVED

Otherwise: new code with no existing callers - `S3TablesClient` is first consumed by task 48.

## Residue

1. **`errorResponse`'s 400 cases name an exception this service does not have.** Three tests pass
   `'ValidationException'`; the s3tables model's 400 is `BadRequestException`. Post-fix this
   string lands in the `x-amzn-errortype` header, which nothing reads - it cannot produce a false
   pass, and M1 proves the header is not feeding the code path - but the helper's whole purpose
   is to be truthful about the wire, and this one field is not. Cosmetic, and self-correcting
   (if core ever learns to read the header, the test fails loudly). Worth a one-word fix when
   the file is next touched. The 404/409/500 cases all use real exception names.
2. **Core's `parseError` still reads the body only** (`signer.ts:177-199`), so for S3 Tables
   `AwsError.requestId` is always `undefined` and `AwsError.code` is always `Http<status>`. An
   operator debugging a production failure has no AWS request id to quote to support, and any
   future downstream narrowing written as `err.code === 'NotFoundException'` silently never
   matches. The client's doc comment (`:199-206`) warns tasks 34-36 about exactly this. The
   durable fix - read `x-amzn-errortype` and `x-amzn-requestid` from the headers `parseError`
   already receives - is a core change that would benefit every rest-json client and subsume the
   409 limb. **Worth a plan entry.**
3. **A genuine concurrent-write `ConflictException` on `create*` reads as success.** Irreducible
   from this service's wire (one exception covers both cases), unchanged in scope by the 409
   discriminator, required by the DoD's idempotency clause, and honestly documented at `:191-197`
   along with the confirming-`get*` escape hatch a caller can take. Note the escape hatch is a
   *caller's* move for `createTableBucket` specifically: the client holds only `name` there and
   `getTableBucket` is ARN-keyed, so the client itself could not make that call without an
   account id it does not carry - consistent with `createTableBucket`'s own doc (`:268-283`),
   which has the caller computing the ARN before calling.
4. **Task 48 must synthesise field ids.** `PAGE_VIEWS_COLUMNS` carries none; the mapping uses
   `index + 1` and a `findIndex` for `sourceId`, so ids are positional and reordering the
   constant renumbers every field. Harmless at create time; worth a comment in task 48's mapping.
5. **Minor.** `normalizeTableBucket`/`normalizeTable` default a missing `arn` to `''`, so a
   malformed 200 yields an empty-string ARN rather than failing loudly. `rethrowWithContext`
   builds a fresh `AwsError` with no `cause` link (core chains none either).
   `content-type: application/json` is sent on bodyless GET/DELETE calls - harmless. The three
   500 cases each take ~3s because `SigningClient.send` retries 5xx for idempotent methods; that
   is most of the 9.3s suite.
6. **`pnpm knip` does not prove the client is live** - `index.ts` re-exports the module
   wholesale. The real consumer arrives with task 48.
7. **Changeset.** None here, by the reading recorded in O5. Task 58's analytics closure changeset
   should describe the client along with the rest of the plugin surface.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED and all five regression checks PRESERVED. The delta
was scoped by diffing the working copy against the approved pass-2 tree recovered from the jj
operation log: the schema/metadata code, all nine methods, `PATHS` and `index.ts` are
byte-identical, so only the idempotency repair was re-derived. It holds. The test helper now
emits the shape this validator observed live - exception name in `x-amzn-ErrorType`, body
`{"message":…}` alone, no fabricated body `code` - so the three idempotency tests exercise the
real failure the service produces; deleting just the `|| err.statusCode === 409` limb kills
exactly those three and nothing else, and restoring returns 28/28 with the file hashing to its
original. AWS's own model confirms `ConflictException` is the only 409 in the entire service and
the only 409 on all three `create*` paths, so nothing else can be swallowed, and the local
predicate is called from those three sites only, leaving `get*`/`delete*` behaviour untouched.
The `error context` tests now assert `Http400`, which is what this service genuinely produces
through core's body-only `parseError`, and the doc comment states the post-fix truth while
framing the residual concurrent-write ambiguity as the deliberate trade it is rather than a
missing capability. A fifteen-mutation battery killed all 28 `it`s - none can pass vacuously.
`packages/core` is verifiably untouched: all eight `s3tables` greps are pre-existing `.test.ts`
lines identical to `@-`, and no core path appears in the diff. Six gates green from the workspace
root; every mutation reverted with hashes to prove it.
