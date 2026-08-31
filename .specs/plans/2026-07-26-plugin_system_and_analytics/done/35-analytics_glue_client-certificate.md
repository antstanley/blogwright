# Done Certificate - Task 35: GlueClient in blogwright-analytics

**Task:** [35-analytics_glue_client.md](35-analytics_glue_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 35. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 35) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `GlueClient` exposing exactly two operations - create the `s3tablescatalog` federation and look one up - with the lookup returning `undefined` when absent so the node can adopt an existing federation, and create idempotent on already-exists.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the shared signing seam (`SigningClient.send` at `packages/core/src/aws/signer.ts:95`) or the barrel export surface consumed by `packages/cli/src/context.ts:5` and `packages/pds/src/test-support.ts:13`.

## Sources of truth used by this validation

The validator did not verify the wire format from the tests. It fetched two independent
service models and AWS's own procedures:

- botocore `glue/2017-03-31/service-2.json` (fetched 2026-08-30, 1 341 339 bytes, HTTP 200 from
  `raw.githubusercontent.com/boto/botocore/develop`).
- `aws-sdk-js-v3` smithy model `aws-models/glue.json` (2 532 360 bytes) as a cross-check on the
  operation error lists.
- The three AWS procedures that create this catalog: the Amazon S3 User Guide
  (`s3-tables-integrating-aws.html`), the AWS Glue Developer Guide
  (`enable-s3-tables-catalog-integration.html`), and the Lake Formation Developer Guide
  (`enable-s3-tables-catalog-integration.html`, plus `change-settings.html` and
  `change-access-iam-to-lf.html`).

## Obligations

- **O1 - The surface is exactly two operations.**
  - *Claim:* `GlueClient` in `packages/analytics/src/aws/glue.ts` declares `createCatalogFederation` and `getCatalogFederation` and no other public method.
  - *Evidence collected:* the class body at `packages/analytics/src/aws/glue.ts:214-298` declares `constructor`, a `private call<T>`, `createCatalogFederation(name, tableBucketArn): Promise<void>` and `getCatalogFederation(name): Promise<CatalogFederation | undefined>`. No third public method; no `deleteCatalog` (the Residue names one as a defect). Both map to calls `analytics-catalog-integration` makes per the change spec §Analytics pipeline - a read-then-adopt node whose `delete()` is a no-op.
  - *Independent check:* the public-surface test asserts `Object.getOwnPropertyNames(GlueClient.prototype).sort()` is exactly `['call','constructor','createCatalogFederation','getCatalogFederation']`. The validator confirmed this is a real constraint, not a tautology: adding a `deleteCatalog` method (mutation `S01`) and renaming `createCatalogFederation` (mutation `S02`) each redden it.
  - *Status:* ☑ SATISFIED

- **O2 - Absent lookup yields `undefined`; create is idempotent on already-exists.**
  - *Claim:* `getCatalogFederation` returns `undefined` when the federation does not exist and the mapped domain value when it does; `createCatalogFederation` returns normally when the service reports an already-exists error.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run glue --reporter=verbose` - 19 passed, 0 failed. The three named cases exist: *maps a present federation onto the domain value*, *returns undefined on EntityNotFoundException so the node creates rather than adopts*, and *resolves on AlreadyExistsException so a re-run of create is a no-op* (`resolves.toBeUndefined()`).
  - *Checks (run, not read):* the validator executed the actual regexes at `packages/core/src/aws/errors.ts:24,32` against **every** exception name in both operations' modelled error lists (11 on `CreateCatalog`, 8 on `GetCatalog`). Result - exactly two matches and no false positives: `EntityNotFoundException` → `isNotFound` true; `AlreadyExistsException` → `isAlreadyExists` true; `FederatedResourceAlreadyExistsException` → `isAlreadyExists` true by substring on `/AlreadyExists/i`, and it is tested by name. `FederationSourceException`, `FederationSourceRetryableException`, `InvalidInputException`, `AccessDeniedException`, `GlueEncryptionException`, `OperationTimeoutException`, `ConcurrentModificationException`, `ResourceNumberLimitExceededException`, `InternalServiceException` and `ValidationException` all match neither. So core's predicates are genuinely sufficient here and the decision not to add a local one is correct.
  - *Overload check:* `EntityNotFoundException` is on **both** operations' error lists and means different things. `createCatalogFederation` narrows only on `isAlreadyExists`, so it rethrows it, and a test pins that (*rejects EntityNotFoundException rather than reusing the lookup's absent narrowing*). Mutation `E04` - widening create's guard to `err.isAlreadyExists || err.isNotFound`, i.e. the "share the predicate" edit - reddens 3 tests. The guard is real.
  - *Wrapper check:* `FederationSourceErrorCode` is confirmed to be an enum containing the literal `EntityNotFoundException`, and `parseError` (`packages/core/src/aws/signer.ts:187`) reads `json.__type` only, so the outer wrapper name is what reaches `AwsError.code`. The suite pins this with a fixture carrying `FederationSourceErrorCode: 'EntityNotFoundException'` inside a `__type: 'FederationSourceException'` body, expecting a rejection.
  - *Status:* ☑ SATISFIED

- **O3 - Request shapes are pinned and non-not-found errors are rethrown with context.**
  - *Claim:* `packages/analytics/src/aws/glue.test.ts` asserts the `x-amz-target` header and the parsed request body for both operations, and a `ValidationException` fed back to either operation produces a rejection whose message names the operation and the catalog.
  - *Evidence collected:* both operations have a `toStrictEqual` over `{method, url, target, contentType, body}`. `ValidationException` rejection cases exist on both operations; `InvalidInputException` cases pin the full message `glue: InvalidInputException - createCatalogFederation "s3tablescatalog": Identifier is not valid (HTTP 400)`.
  - *Checks:* `grep` for `fetchTransport`, `fetch(` and `AWS_ENDPOINT_URL` in the test file - **no match**. Substitution is at the `Transport` port only.
  - *Outward verification against the service model (the check the tests cannot perform):*
    - `metadata.targetPrefix` is `AWSGlue` and `jsonVersion` is `1.1`; both operations are `POST /`. The `x-amz-target` and content type are right.
    - `CreateCatalogRequest.required` is `["Name","CatalogInput"]` - **`Name` is a sibling of `CatalogInput`**, and `CatalogInput`'s member list contains no name field of any kind. A name placed inside would be silently ignored. The implementation sends it as a sibling and a dedicated test asserts `Object.keys(body)` is `['Name','CatalogInput']` and that `CatalogInput` has no `Name`.
    - `CatalogInput` has **no `required` array at all**. The silent-success mode is real: a `CreateCatalog` omitting `FederatedCatalog` would return 200 and leave an empty non-federated catalog under the right name. The implementation sends it, and mutation `B02` (drop `FederatedCatalog`) reddens the body test.
    - `FederatedCatalog.ConnectionName` is exactly `aws:s3tables` in AWS's S3 User Guide payload, and `Identifier` is `arn:aws:s3tables:<region>:<account-id>:bucket/*`. Both match.
    - `CatalogNameString`'s pattern is `^(?!(.*[.\/\\]|aws:)).*$` and it types **`CreateCatalogRequest.Name` and `Catalog.Name`**. `FederatedCatalog.ConnectionName` is typed `NameString`, whose pattern is permissive. The module's claim that the `aws:` prohibition does not reach `ConnectionName` is confirmed - they are different fields with different patterns.
    - `CreateDatabaseDefaultPermissions`/`CreateTableDefaultPermissions` are both optional members of `CatalogInput` of type `PrincipalPermissionsList` → `PrincipalPermissions{Principal: DataLakePrincipal{DataLakePrincipalIdentifier}, Permissions: PermissionList}`, and `ALL` is a member of the `Permission` enum. The nesting the client sends matches key for key. **Both** of AWS's IAM-mode procedures - the S3 User Guide and the Glue Developer Guide - set both lists to `IAM_ALLOWED_PRINCIPALS`/`["ALL"]`. AWS states verbatim that these settings "effectively cause access to Data Catalog resources and Amazon S3 locations to be controlled solely by ... IAM policies. Individual Lake Formation permissions are not in effect", and that the empty-list form "revokes all existing IAM-based access to your S3 Tables resources". The Lake Formation guide's `[]` variant is the deliberate opt-in to LF mode - the mode the change spec's assumption excludes. So the fields are load-bearing exactly as claimed, and the change spec's "requires `s3tables` permissions but no Lake Formation grant" (`.specs/changes/merged/2026-07-26-analytics_plugin.md:640-645`, which itself says the claim "holds only while the table bucket stays in IAM access-control mode") does depend on them. Mutations `B05`, `B06`, `B07`, `B08`, `B11` through `B16` all redden.
    - `GetCatalogRequest` has **exactly one member, `CatalogId`, required**. No bucket ARN is accepted. AWS's own verification step is `aws glue get-catalog --catalog-id s3tablescatalog`, so the name is the id for a catalog created directly under the account. The contract's "taking the catalog name and the S3 Tables bucket ARN" therefore cannot be satisfied on one method; distributing it - both on create, name only on the lookup - is the only correct reading, and the contract is satisfied.
    - `CreateCatalogResponse` is an empty structure, so `Promise<void>` is right.
    - Every Glue exception shape's message member is `Message` (capital M) - `EntityNotFoundException`, `AlreadyExistsException`, `FederatedResourceAlreadyExistsException`, `InvalidInputException`, `FederationSourceException` and the rest all declare `Message`, none declares `message`. The fixtures use the real wire shape, and `parseError`'s `json.message ?? json.Message` fallback reads it.
  - *Status:* ☑ SATISFIED

- **O4 - Exported and not dead.**
  - *Claim:* `packages/analytics/src/index.ts` re-exports `./aws/glue.js`, `packages/core` is untouched, and `pnpm knip` reports no unused export for the new module.
  - *Evidence collected:* the barrel edit is one line - `export * from './aws/glue.js';` at `:17`, between `firehose` at `:16` and `s3tables` at `:18`, alphabetical. `jj diff --stat packages/core` → `0 files changed`. `jj diff --stat` on both landed sibling clients (`firehose.ts`, `s3tables.ts`) → `0 files changed`. `pnpm knip` from the workspace root → exit 0, empty report, and `knip.json` gains no suppression.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the workspace root `/Users/ant/code/blogwright-task-35`, in `ci.yml` order: `pnpm build` exit 0 · `pnpm typecheck` exit 0 · `pnpm test` exit 0 (cli 270/270, all packages green) · `pnpm lint` exit 0 (only pre-existing `no-shadow` warnings in `packages/cli/src/nodes.test.ts`; zero mentions of `glue`) · `pnpm exec oxfmt --check .` exit 0, 150 files · `pnpm knip` exit 0.
  - *Named constants:* `TARGET`, `S3_TABLES_CONNECTION`, `IAM_DEFAULT_PERMISSIONS`, `SERVICE` - every literal that could be mistyped is a module constant with a doc comment stating why.
  - *Changeset:* none, and `.changeset/` is untouched (`jj diff --stat .changeset` → 0 files changed). This follows the precedent recorded in tasks 33 and 34's certificates: `blogwright-analytics` declares no `blogwright.plugin` manifest field yet, so it is not a discoverable user-facing surface, and `GlueClient` has no consumer until task 49.
  - *Status:* ☑ SATISFIED

- **O6 - Run `pnpm test -- glue`; confirm the suite covers present, absent, already-exists and non-not-found, and that the class body declares no third public method (Reviewable).**
  - *Claim:* a reviewer can run the filtered suite, observe four named behavioural cases, and read a two-method class.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run glue --reporter=verbose` - **19 passed, 1 file, 308 ms**. The four required behaviours are all named: present (*maps a present federation onto the domain value*), absent (*returns undefined on EntityNotFoundException so the node creates rather than adopts*), already-exists (*resolves on AlreadyExistsException...* plus *resolves on FederatedResourceAlreadyExistsException, the second duplicate name*), and non-not-found (*rejects a ValidationException...*, *rethrows a non-not-found failure with the operation and catalog name*, *rethrows FederationSourceException...*, and both 500 cases). The class declares two public methods.
  - *Status:* ☑ SATISFIED

## Falsifiability audit (the implementer's sweep was not accepted)

The implementer reported 32 mutations with "NEVER RED: none". The validator did **not** accept
that table. It authored its own sweep of **66 mutations in two independent rounds**, tracking
which `it` blocks reddened per mutation:

- **Round 1 - 46 mutations** across the target prefix, both operation names, content type, HTTP
  method, path, service descriptor, `Name` placement, `FederatedCatalog` presence and both its
  keys, the connection literal, the identifier source, both default-permission lists and their
  principal and permission literals, the `GetCatalog` body key, all four `normalizeCatalog`
  fields, both narrowing predicates, all five `AwsError` fields on rethrow, the framing strip,
  and the public surface.
- **Round 2 - 20 further mutations** aimed specifically at the branches round 1 left alive.

**Result: NEVER RED - none.** All 19 `it` blocks are reddened by at least one mutation. The
implementer's headline claim is corroborated by a sweep twice its size, so it is accepted on the
validator's own evidence rather than on the implementer's table.

Six round-1 survivors and their disposition:

| Survivor | Disposition |
|---|---|
| `signingName: 'glue'` → `'lambda'` | **Real gap, correctly scoped out.** Mutating it changes only the SigV4 signature and the recording transport captures no `authorization` header. Task 38's certificate O3 pins the credential scope `/<region>/<signing name>/aws4_request` for all six clients, which is what closes it. Not a defect here. |
| `name: catalog?.Name ?? fallbackName` → `fallbackName` | Genuine coverage gap - see D2. |
| `requestId: err.requestId` → a literal | **Not a defect.** `parseError` never reads response headers, and Glue returns its request id only in `x-amzn-requestid`, so `AwsError.requestId` is structurally always `undefined` for this service. A test asserting preservation would assert `undefined === undefined` - precisely the "assertion that cannot fail" the plan baseline forbids. The field is preserved in code and left untested deliberately. |
| `text ? JSON.parse(text) : {}` → `JSON.parse(text \|\| 'null')` | Not informative - `null` is discarded by create. The **guard itself is covered**: round-2 mutation `R01` removing it entirely reddens 3 tests. |
| Two no-op probes (a `!` assertion, an unreachable guard) | Validator's own mutation-design flaws; no runtime change. |

Round-2 survivors `R03`, `R04`, `R05` (all in `normalizeCatalog`) and `R09` are reported as
defects D1 and D3 below.

Two further claims were verified rather than read:

- **`CatalogFederation`'s required-keys-of-type-`string | undefined` shape holds, both ways.** At
  the type level, `const x: CatalogFederation = { name, resourceArn }` is `TS2739: missing the
  following properties ... sourceIdentifier, connectionName`, while the same literal with both
  keys set to `undefined` compiles clean under `--strict --exactOptionalPropertyTypes`. At
  runtime, rewriting `normalizeCatalog` to spread the two keys conditionally (so they are absent
  rather than `undefined`) reddens *reports a catalog carrying no FederatedCatalog with both
  federation fields undefined* - `toStrictEqual` does distinguish the two. So a same-named but
  non-federated catalog is genuinely distinguishable and not adoptable.
- **The public-surface test is a real constraint.** It fails on an added method and on a renamed
  method. It also pins the private `call`, which is mild brittleness, not a defect.

## Judged decisions

- **`AllowFullTableExternalDataAccess` omitted - accepted.** The model confirms it is an optional
  `String` enum of `"True" | "False"` (not a boolean), documented as allowing "third-party engines
  to access data in Amazon S3 locations that are registered with Lake Formation". AWS's three
  procedures disagree: the S3 User Guide and Lake Formation payloads set `"True"`, the **Glue
  Developer Guide payload omits it entirely** - and the module's body is exactly the Glue
  Developer Guide's payload modulo an optional `Description`. Omission cannot break this pipeline:
  the catalog is put in IAM mode, where LF permissions are not in effect and LF credential vending
  is not the access path, and the spec's one third-party reader (DuckDB) attaches through S3
  Tables' own `ENDPOINT_TYPE 'S3_TABLES'` endpoint, not through Glue. Sending it would widen
  access the pipeline never uses. Accepted; see D4 for a documentation-accuracy note.
- **A 200 with no `Catalog` falling back rather than being a second "absent" signal - accepted in
  principle.** `GetCatalogResponse.Catalog` is optional in the model but `Catalog.Name` is
  required when `Catalog` is present, so the fallback can only fire on an undocumented shape, and
  a second `undefined` return would silently make the node create over an existing catalog. The
  decision is right; it is untested (D1).
- **Fixtures using both `ValidationException` and `InvalidInputException` - accepted, and better
  than either alone.** `InvalidInputException` is the modelled error on both operations;
  `ValidationException` is *not* on either operation's error list, though it does exist elsewhere
  in the Glue model, and AWS's S3 Tables integration page does quote
  `com.amazonaws.services.glue.model.ValidationException: Unsupported Federation Resource` on the
  wire - for a naming violation surfaced through `GetTable`, not for a catalog operation. The task
  contract names `ValidationException` explicitly, so covering it satisfies the contract, and
  covering `InvalidInputException` alongside it covers what these two operations actually return.
  Neither the module nor the tests claim `ValidationException` is modelled on these operations.
- **No changeset - accepted**, matching tasks 33 and 34 (see O5).

## Regression check

- `packages/cli/src/context.ts:5` imports from `blogwright-core` → `jj diff --stat packages/core` reports `0 files changed`; `pnpm build` and `pnpm typecheck` green across all packages : ☑ PRESERVED
- `packages/pds/src/test-support.ts:13` imports `createClients` from `blogwright-core` → `pnpm test` green in every package, cli 270/270 : ☑ PRESERVED
- Neither landed sibling client was edited (`firehose.ts`, `s3tables.ts` → `0 files changed`) : ☑ PRESERVED

Otherwise: new code with no existing callers - `GlueClient` is first consumed by task 49.

## Residue

- **D1 (minor, coverage).** `packages/analytics/src/aws/glue.ts:143,145,146` - the entire
  `Catalog`-absent fallback in `normalizeCatalog` is unexercised. Mutations making it throw
  (`catalog!.Name!`) or dropping the `?? ''` on `resourceArn` both survive the suite. **Failure
  scenario:** a later edit turns the `Catalog`-absent case into a second `return undefined`; the
  suite stays green, and the node then creates over an existing federation on every run. The blast
  radius is small - create is idempotent on already-exists, so the run still converges - but the
  branch has no assertion standing in front of it. A fixture feeding `response(200, '{}')` to
  `getCatalogFederation` would close it. Note `resourceArn`'s `?? ''` is the one fallback that can
  fire on a *documented* shape, since `Catalog.ResourceArn` is optional while `Catalog.Name` is
  required.
- **D2 (minor, fixture).** `packages/analytics/src/aws/glue.ts:145` - `getCatalogResponse()` sets
  `Name: CATALOG` and every call passes `CATALOG`, so nothing distinguishes the response's name
  from the request's. Replacing the expression with the bare `fallbackName` leaves the suite green.
  A fixture whose response `Name` differs from the requested name would close it.
- **D3 (minor, coverage).** `packages/analytics/src/aws/glue.ts:179` - `rethrowWithContext`'s
  non-`AwsError` pass-through is unexercised; replacing `throw err` with a different throw survives.
  The doc comment claims network-level failures pass through unchanged and nothing pins it. Note a
  test would need care, since `withRetry` retries a `TypeError`.
- **D4 (documentation accuracy, not behaviour).** `packages/analytics/src/aws/glue.test.ts:16-20` -
  the `EXPECTED_CREATE_BODY` comment says it is "transcribed from AWS's own documented S3 Tables
  integration procedure". There are three such procedures and they disagree; this body matches the
  **Glue Developer Guide's**, not the S3 User Guide's, which additionally carries
  `"AllowFullTableExternalDataAccess": "True"`. The body is correct - the citation is just less
  specific than the three-way divergence warrants.
- **Forward note for task 49.** Glue's `EntityNotFoundException` carries a `FromFederationSource`
  boolean the client does not model. A lookup that fails *at the federation source* (a wrong bucket
  ARN) can surface as `EntityNotFoundException` and read as absent, after which create returns
  `FederatedResourceAlreadyExistsException`, which is swallowed - a converging but silent path.
  Out of scope here: the contract says to narrow on `AwsError.isNotFound`, which is what the client
  does. Worth a look when the node is written.
- The adopt-rather-than-create policy and the no-op delete live in the node (task 49); this task
  only had to make adoption expressible, which it does.
- **Mutations restored.** Every mutation was reverted. Proof: `shasum -a 256 -c` against the
  pre-sweep baseline returns `OK` for all three files
  (`glue.ts` `d72bfc79…b716d`, `glue.test.ts` `a1697c33…4b3e8`, `index.ts` `a61f02e0…9bfe3`), and
  `jj status` reports exactly the original three-file change with no extra path.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED on collected evidence - the wire format is confirmed
key-by-key against the botocore `glue-2017-03-31` model and AWS's own IAM-mode integration
procedures rather than against the tests, both narrowings are confirmed by running core's actual
regexes over every modelled exception name on both operations, all six CI gates and the
`Reviewable:` line are green from the workspace root with `packages/core` and both sibling clients
untouched, and an independent 66-mutation sweep reddens all 19 `it` blocks - leaving only three
untested fallback branches (D1-D3) and one over-broad citation (D4), none of which changes
behaviour today.
