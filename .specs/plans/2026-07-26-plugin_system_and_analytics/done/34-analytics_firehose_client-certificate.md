# Done Certificate - Task 34: FirehoseClient in blogwright-analytics

**Task:** [34-analytics_firehose_client.md](34-analytics_firehose_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 34. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 34) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `FirehoseClient` exposing create, describe, delete and tagging for one delivery stream, with the Iceberg destination as a typed input, the stream's delivery state returned in domain vocabulary, and every `x-amz-target` and body pinned by a transport-mocked test.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the shared signing seam (`SigningClient.send` at `packages/core/src/aws/signer.ts:95`) or the barrel export surface consumed by `packages/cli/src/context.ts:5` and `packages/pds/src/test-support.ts:13`.

## Outward verification (performed before reading the tests)

Per the gate's instruction, every operation name and body key was checked against the AWS
Firehose API reference directly, not against the implementation's own tests. All twelve
verified independently:

| Reference page | Checked | Result |
|---|---|---|
| `API_CreateDeliveryStream` | `X-Amz-Target: Firehose_20150804.CreateDeliveryStream`, `POST /`, `application/x-amz-json-1.1`, `DeliveryStreamName`, `DeliveryStreamType`, `IcebergDestinationConfiguration`, `Tags` | matches `firehose.ts:302-315,338-345` exactly |
| `API_IcebergDestinationConfiguration` | `CatalogConfiguration` (required), `RoleARN` (required), `S3Configuration` (required), `AppendOnly`, `BufferingHints`, `DestinationTableConfigurationList`, `ProcessingConfiguration` | every key sent by `buildIcebergDestination` (`firehose.ts:262-298`) is a real member, spelled correctly; all three required members are sent |
| `API_S3DestinationConfiguration` | `BucketARN` **Required: Yes**, `RoleARN` **Required: Yes**, `ErrorOutputPrefix` | trap 1 confirmed - both required keys are sent (`firehose.ts:267-272`) |
| `API_ProcessorParameter` | `Valid Values: LambdaArn \| NumberOfRetries \| … \| DataMessageExtraction` (11) | trap 2 confirmed - `LambdaArn` is mixed case while `RoleARN`/`BucketARN`/`CatalogARN` are upper; `firehose.ts:70` has it right |
| `API_Processor` | `Type` valid values (6), `Lambda` among them | `firehose.ts:67` correct |
| `API_DestinationTableConfiguration` (via create's request syntax) | `DestinationDatabaseName`, `DestinationTableName`, `S3ErrorOutputPrefix` | correct; note the list key is `DestinationTableConfigurationList`, which the code has |
| `API_DescribeDeliveryStream` | target, name-only body, `DeliveryStreamDescription` response, `ResourceNotFoundException` **HTTP 400** | correct |
| `API_DeliveryStreamDescription` | `DeliveryStreamStatus` valid values `CREATING \| CREATING_FAILED \| DELETING \| DELETING_FAILED \| ACTIVE`, optional `FailureDescription{Type,Details}` | the five mapped strings are exactly Firehose's (`firehose.ts:165-180`) |
| `API_DeleteDeliveryStream` | `DeliveryStreamName` required, `AllowForceDelete` optional (CMK grant retirement only), `ResourceInUseException` 400, `ResourceNotFoundException` 400 | correct; the page also states *"You can't delete a Firehose stream that is in the `CREATING` state"*, independently confirming the second edge |
| `API_TagDeliveryStream` | target, `Tags` **Array Members: Minimum 1**, four errors all 400 | confirms the empty-map short circuit is required, not merely tidy |
| Error status codes across all four operations | 4 + 1 + 2 + 4 documented exceptions | trap 3 confirmed - **every one is HTTP 400**; no 404, no 409 |
| `DeliveryStreamType` | `DirectPut \| KinesisStreamAsSource \| MSKAsSource \| DatabaseAsSource`, Required: No | `DirectPut` is the correct value for CloudFront vended delivery |

Consumer check (task 51, `backlog/51-nodes_firehose_role_and_stream.md`): `IcebergDestinationInput`
admits every value that node must send - the recorded catalog ARN, delivery role ARN, namespace,
table, the plugin's own error bucket ARN and prefix, the buffering hints and the transform Lambda
ARN - with no cast and no contortion, and `describeDeliveryStream` supplies both the delivery state
its `read` must hydrate and the ARN that `createDeliveryStream`'s `void` return discards. One
forward gap is recorded in Residue; it is out of this task's contracted scope.

## Obligations

- **O1 - The surface is four operations, with a typed destination input.**
  - *Claim:* `FirehoseClient` in `packages/analytics/src/aws/firehose.ts` declares `createDeliveryStream`, `describeDeliveryStream`, `deleteDeliveryStream` and `tagDeliveryStream` and no other public method, and the Iceberg destination is a declared interface with named fields, not `Record<string, unknown>` or an inline object literal type.
  - *Evidence collected:* the class body (`firehose.ts:300-415`) declares exactly one constructor, one `private async call<T>`, and the four public methods at `:337`, `:362`, `:392`, `:406`. `IcebergDestinationInput` (`firehose.ts:78-129`) is a named interface with nine `readonly` fields covering the catalog ARN, delivery role ARN, namespace and table, error bucket ARN and prefix, both buffering hints and the transform Lambda ARN, each with a doc comment naming its wire key and its units (`bufferIntervalSeconds` in **seconds**, `bufferSizeMb` in **MiB**), in the `microvms.ts:23-41` style the task cites.
  - *Checks:* `grep -n "\bany\b|Record<string, unknown>|: unknown"` over the module returns two hits only - `isStreamAlreadyExists(err: unknown)` (`:219`) and `rethrowWithContext(err: unknown, …)` (`:240`), the correct idiom for error narrowing. The destination input carries no loose type.
  - *Status:* ☑ SATISFIED

- **O2 - Describe returns domain state or `undefined`; delete is re-runnable and every other error keeps its context.**
  - *Claim:* `describeDeliveryStream` returns a narrow domain type carrying the stream's delivery state (not the raw `DescribeDeliveryStream` response) and `undefined` on `AwsError.isNotFound`; `deleteDeliveryStream` resolves on `isNotFound` and rejects on any other failure with the operation and stream name in the message.
  - *Evidence collected:* `DeliveryStreamStatus` (`firehose.ts:143-156`) is `{ name, arn, state, failure? }` - four fields, not the raw response; `DeliveryState` (`:134-140`) is the six-member domain union. `describeDeliveryStream` (`:362`) returns `undefined` on `err.isNotFound` and rethrows otherwise; `deleteDeliveryStream` (`:392`) returns on `err.isNotFound` and rethrows otherwise. `pnpm --filter blogwright-analytics exec vitest run firehose --reporter=verbose`: 28 passed, 0 failed, including the four named cases - `maps the service state ACTIVE onto the domain state active` (and four siblings), `returns undefined on ResourceNotFoundException rather than throwing`, `swallows ResourceNotFoundException so teardown is re-runnable`, `rejects a ValidationException rather than swallowing it`.
  - *Checks:* `rethrowWithContext` (`firehose.ts:240-251`) reconstructs an `AwsError` carrying `err.service`, `err.code`, `err.statusCode` and `err.requestId`, so downstream `isNotFound` narrowing survives the rethrow. Verified by mutation: replacing `code: err.code` with a literal, or `statusCode` with 500, each fails the two `FirehoseClient error context` tests.
  - *Status:* ☑ SATISFIED

- **O3 - Every request shape is pinned, with no network access.**
  - *Claim:* `packages/analytics/src/aws/firehose.test.ts` asserts the `x-amz-target` header and the parsed request body for all four operations, driving a stub `Transport` through `SigningClient`.
  - *Evidence collected:* the `FirehoseClient request wire format` describe holds one case per operation, each a single `toStrictEqual` over `{ method, url, target, contentType, body }` (`firehose.test.ts:137-193`). Crucially, `EXPECTED_DESTINATION` (`firehose.test.ts:35-67`) is the Iceberg configuration **written out literally**, independent of `buildIcebergDestination` - the test does not call the builder to compute its own expectation. This is the specific defence that was missing when task 33 shipped a `createTable` with no schema and a green suite.
  - *Checks:* `grep -n "fetchTransport|fetch\(|AWS_ENDPOINT_URL"` over the test file returns no match; every case drives an inline `async (req) => …` stub.
  - *Status:* ☑ SATISFIED

- **O4 - Exported and not dead.**
  - *Claim:* `packages/analytics/src/index.ts` re-exports `./aws/firehose.js`, `packages/core` is untouched, and `pnpm knip` reports no unused export for the new module.
  - *Evidence collected:* `jj diff --git packages/analytics/src/index.ts` is a single added line, `export * from './aws/firehose.js';`, placed immediately before `export * from './aws/s3tables.js';` - alphabetical, and the minimum edit possible. `jj st` lists three paths, none under `packages/core`. `grep -rn "firehose" packages/core/src --include='*.ts'` returns only two pre-existing lines in `packages/core/src/aws/endpoint.test.ts:25,27`, task 32's `ServiceDescriptor` case, untouched by this diff - and they independently confirm the descriptor resolves to `firehose.us-east-1.amazonaws.com`, the host the client's tests assert.
  - *Checks:* `pnpm knip` from the workspace root - exit 0, no findings.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates run from the workspace root in CI order, each exit 0 - `pnpm build` (0), `pnpm typecheck` (0), `pnpm test` (0: core 140 passed/1 skipped, cli 259, pds 100, analytics 90, build-agent 27), `pnpm lint` (0; 25 warnings, all pre-existing `no-shadow` in `packages/cli/src/nodes.test.ts`, none from this diff), `pnpm exec oxfmt --check .` (0, 148 files), `pnpm knip` (0). Every literal that reaches the wire is a named constant with a doc comment stating its provenance: `TARGET` (`:45`), `STREAM_TYPE` (`:54`), `APPEND_ONLY` (`:65`), `LAMBDA_PROCESSOR` (`:67`), `LAMBDA_ARN_PARAMETER` (`:70`). Errors are raised with context and no `null` is returned for a domain value - the absent-stream case returns `undefined`, matching `secretsmanager.ts:78-89`.
  - *Checks:* no changeset. This matches the precedent set one commit earlier by task 33, whose identical change (a new plugin-local client plus a barrel line) shipped none: `blogwright-analytics` declares no `blogwright.plugin` manifest field yet, so the package is not a discoverable user-facing surface and the client has no consumer until task 51.
  - *Status:* ☑ SATISFIED

- **O6 - Run `pnpm test -- firehose`; confirm each of the four operations pins its `x-amz-target` and body against a stub `Transport`, and that describe returns `undefined` rather than throwing on `ResourceNotFoundException` (Reviewable).**
  - *Claim:* a reviewer can run the filtered suite and observe four pinned request shapes plus the absent-stream case.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run firehose --reporter=verbose` - `Test Files 1 passed (1)`, `Tests 28 passed (28)`. The four pinning cases are named `pins CreateDeliveryStream…`, `pins DescribeDeliveryStream…`, `pins DeleteDeliveryStream…`, `pins TagDeliveryStream to its x-amz-target and a Key/Value tag list`. The absent-stream case is `returns undefined on ResourceNotFoundException rather than throwing`, asserting `await expect(...).toBeUndefined()` - a resolution, not a rejection.
  - *Status:* ☑ SATISFIED

## Routed finding - verified by execution

The finding: Firehose signals a duplicate stream with `ResourceInUseException`, which
`AwsError.isAlreadyExists` (`packages/core/src/aws/errors.ts:32`) matches on none of its four
alternatives. The repair: a named local predicate, `isStreamAlreadyExists` (`firehose.ts:219`),
scoped to the create path.

The implementer additionally reported a second edge the finding did not name: `DeleteDeliveryStream`
also answers `ResourceInUseException`, there meaning *"still `CREATING`, cannot be deleted yet"*.
Independently confirmed against `API_DeleteDeliveryStream`, which states both the exception and
*"You can't delete a Firehose stream that is in the `CREATING` state"*. Swallowing it on delete
would report a live stream as torn down. `deleteDeliveryStream` therefore narrows on `isNotFound`
alone.

Both directions verified by mutation, each applied to the source, the suite run, and the source
restored:

| Mutation | Predicted | Observed |
|---|---|---|
| drop the `\|\| err.code === 'ResourceInUseException'` limb from `isStreamAlreadyExists` | only the create-idempotency case fails | **1 failed / 27 passed** - `resolves on ResourceInUseException so a re-run of create is a no-op`, and nothing else |
| add the create predicate to delete's narrowing | only the delete asymmetry case fails | **1 failed / 27 passed** - `rejects ResourceInUseException rather than reusing create's already-exists narrowing`, and nothing else |
| replace delete's `isNotFound` with the create predicate outright | both delete directions fail | **2 failed / 26 passed** - the not-found swallow and the in-use rejection |

Fixture honesty: `errorResponse` (`firehose.test.ts:112-114`) emits
`{"__type":"<code>","message":"<msg>"}` at the caller's status, and every error case passes **400**.
That is the real wire shape on three independent grounds - the AWS reference names the error member
`message` (lowercase) and documents every Firehose exception at HTTP 400; core's `parseError`
(`signer.ts:187-189`) reads `__type` and splits on `#`, so both the bare and namespaced forms
resolve; and `packages/core/src/aws/logs.test.ts:50-51` already uses the byte-identical fixture for
the same AWS-JSON 1.1 protocol. Nothing is fabricated - contrast task 33, which invented a body key.

## Falsifiability audit

52 mutations were applied to `packages/analytics/src/aws/firehose.ts` one at a time, each followed
by a full suite run and a restore. The implementer's claimed 27-mutation table was not accepted; it
was re-derived adversarially and extended. **45 killed, 7 survived (6 distinct).**

Every one of the 28 `it`s was killed by at least one mutation, so no assertion in this suite is
incapable of failing. The four cases the implementer's table did not reach were closed here:
`omits Tags entirely when no tag map is given` (killed by making create always send a `Tags` key),
`returns undefined on ResourceNotFoundException` (killed by removing the not-found branch),
`rejects a ValidationException` (killed by making delete swallow every `AwsError`), and the
individual `CREATING`/`ACTIVE`/`DELETING` state rows (killed by mismapping each case in isolation,
rather than only collaterally through the `failure`-key mutation).

Survivors, each accounted for:

1. **`deleteDeliveryStream`'s context prefix is unpinned.** Replacing `rethrowWithContext(err, 'deleteDeliveryStream', name)` with a bare `throw err`, or with an empty operation and name, leaves all 28 tests green. The two delete rejection cases assert `/ValidationException|bad input/` and `/ResourceInUseException|is CREATING/` - alternations that also match the unprefixed `AwsError` message. Describe, tag and create each pin their prefix (mutating any of those three fails a test); delete alone does not. **Not a DoD miss:** the DoD names `packages/core/src/aws/logs.test.ts:49-66` as the shape to mirror, and that suite asserts only `resolves` and `rejects` - `LogsClient` adds no context at all. The firehose client goes beyond its stated model, and three of its four operations pin the extra behaviour. Recorded as a coverage nit, not a defect.
2. **`SERVICE.signingName` is unpinned.** Changing it to `'kinesis'` passes all 28. No test inspects the `Authorization` header's credential scope. The other half of the descriptor - `service: 'firehose'`, which drives the host - *is* pinned, by the `url: 'https://firehose.us-east-1.amazonaws.com/'` assertion in all four wire cases. A wrong signing name fails loudly at AWS with `SignatureDoesNotMatch` rather than silently misconfiguring, and the landed sibling `s3tables.ts:34` has the identical unpinned descriptor, so this is a package-wide convention, not a regression this task introduces.
3-4. **The `?? ''` and `?? name` fallbacks in `describeDeliveryStream` (`firehose.ts:369-370`) are unreachable.** `DeliveryStreamARN` and `DeliveryStreamName` are both `Required: Yes` on `DeliveryStreamDescription`, so no conforming response omits them. Defensive-only. See Residue for the one note on `arn: ''`.
5. **The non-`AwsError` passthrough in `rethrowWithContext` (`firehose.ts:250`) is untested.** The doc comment claims a network-level failure passes through unchanged; no case drives a transport that throws a `TypeError`. Low: the helper is being extracted to a shared home by task 38.
6. **`text ? JSON.parse(text) : {}` → `JSON.parse(text || '{}')` is an equivalent mutant**, not a coverage gap - the two are indistinguishable for every input. The original is byte-identical to `packages/core/src/aws/logs.ts:45`, the convention this task was told to follow.

## Judged decisions

- **`AppendOnly` as a module constant** (`firehose.ts:65`): the change spec settles it in two places - the `analytics-firehose-stream` row reads *"created with `AppendOnly: true`"*, and §Assumptions states *"The stream is created `AppendOnly`. `page_views` is insert-only by design."* There is no configuration under which this client should send `false`, and it exposes no update. Sound.
- **`DeliveryStreamType: 'DirectPut'` sent explicitly**: the reference marks it `Required: No`, so this is a choice. It states the source model the destination depends on rather than resting on an undocumented default, costs one key, and is pinned by the create wire test. Sound.
- **`AllowForceDelete` deliberately not sent, asserted absent**: the reference confirms the flag exists *only* to delete a stream when Firehose cannot retire a CMK grant. This stream is created with no `DeliveryStreamEncryptionConfigurationInput`, so it has no customer-managed key and the failure the flag suppresses cannot arise. The assertion is a real one - sending the key fails the delete wire case. Sound.
- **`createDeliveryStream` returns `void`**: the ARN is genuinely unavailable on the already-exists branch (the error body carries none), and `describeDeliveryStream` is name-keyed and returns it. Task 51 reads state through `read`, which describes anyway. Holds, as it held for task 33.
- **`DeliveryState` mapping**: the five mapped wire strings are exactly `DeliveryStreamStatus`'s valid values, verified against `API_DeliveryStreamDescription`. The `unknown` fallback is honest for a state AWS adds later, and is pinned by its own case.
- **Tags spread only when non-empty**: `...(tags && Object.keys(tags).length > 0 ? { Tags: … } : {})` (`firehose.ts:344`) is the idiom at `packages/core/src/aws/logs.ts:53,113` verbatim, differing only in that Firehose takes a `[{Key,Value}]` list where Logs takes a map. The reference makes it mandatory rather than tidy: `Tags` has `Array Members: Minimum number of 1 item` on both `CreateDeliveryStream` and `TagDeliveryStream`, so an empty list would be rejected.

## Regression check

- `packages/cli/src/context.ts:5` imports `createClients` from `blogwright-core` → `packages/core/src/index.ts` unchanged; `jj st` lists no path under `packages/core`; `pnpm test` green for cli (259 passed) : ☑ PRESERVED
- `packages/pds/src/test-support.ts:13` imports `createClients` from `blogwright-core` → `pnpm test` green for pds (100 passed) : ☑ PRESERVED
- `packages/analytics` barrel → `s3tables.js` export still resolves; analytics suite green (90 passed, 4 files) : ☑ PRESERVED

Otherwise: new code with no existing callers - `FirehoseClient` is first consumed by task 51.

**Mutation restore proven.** `shasum -a 256 -c` against the pre-mutation baseline returns OK for
all three files, and `jj diff --stat` is byte-identical to the pre-verification snapshot -
3 files changed, 839 insertions, 0 deletions. No code was edited by this gate.

## Residue

Notes carried forward:

- **Task 51 will need more than these four operations, and that is a plan-level gap, not a defect here.** Task 51's DoD requires the `AppendOnly` reconcile to *"attempt `UpdateDestination` and fall back to replacing the stream"*. `UpdateDestination` is not on this client, and the change spec's §Its own service clients names the `FirehoseClient` surface as exactly *"create/describe/delete delivery stream, and tagging"* while this task's DoD says *"and nothing else"* - so task 34 was right to stop where it did. Two things task 51 will additionally need: the operation itself, and two fields the narrow `DeliveryStreamStatus` currently drops - `VersionId` (the reference states the current version id *"is required when updating the destination"*) and `Destinations[].DestinationId`. Route to the planner before task 51 starts: either widen the client's contracted surface in the change spec, or restate task 51's reconcile in terms of delete-and-recreate alone.
- **`arn: ''` on a description-less response** (`firehose.ts:370`). Unreachable against a conforming service, but if it ever fired, a consumer recording the empty string into scoped state would interpolate a broken ARN silently. Returning `undefined` or throwing would fail louder. Cosmetic today; worth a line in task 51's review if that ARN is ever persisted.
- **`requestId` is `undefined` for this client**, as it is for every AWS-JSON and REST-JSON client in the repo: core's `parseError` (`signer.ts:196`) extracts a request id only from XML bodies and never reads the `x-amzn-RequestId` header. `rethrowWithContext` preserves faithfully whatever is there, so this task discharges its step; the underlying gap is already routed from task 33's gate.
- **No `CloudWatchLoggingOptions`** on the destination. Optional in the API, and the spec's error path is the S3 error bucket, so delivery failures surface there rather than in a log group. A node-level decision if it is ever wanted, not a client-level one.
- `stripAwsFraming`/`rethrowWithContext` duplicate `s3tables.ts`. Deliberate, and routed to task 38 for extraction. Explicitly not treated as a defect here.
- Buffering-hint bounds and the error-output prefix remain task 51's to supply; this task only types them.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied on collected evidence - every operation name and body key
independently confirmed against the AWS Firehose API reference (including all three reported traps),
both directions of the routed `ResourceInUseException` finding proven by mutation, all 28 tests shown
falsifiable, and all six repo gates green from the workspace root with `packages/core` untouched and
the barrel edit a single alphabetical line.
