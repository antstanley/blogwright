# Done Certificate - Task 37: Optional output format, record fields and field delimiter on LogsClient deliveries

**Task:** [37-core_logs_delivery_configuration.md](37-core_logs_delivery_configuration.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 37. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 37) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `putDeliveryDestination` accepts an output format and `createDelivery` accepts record fields and a field delimiter, each optional and each absent from the request body when omitted, with a test pinning the site's existing delivery bodies byte-for-byte.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's vended log delivery - `logDeliveryNode` at `packages/cli/src/nodes.ts:713-777`, including the `wire()` sequence at `:714-734`, the `ConflictException` retry at `:744-761` and the teardown ordering at `:763-775` - nor the `LogsClient` behaviour pinned by `packages/core/src/aws/logs.test.ts:18-66`.

## Obligations

- **O1 - Three optional parameters, omitted from the body when absent.**
  - *Claim:* `putDeliveryDestination` at `packages/core/src/aws/logs.ts:106` takes an optional output format and `createDelivery` at `:114` takes optional record fields and a field delimiter; all three are declared `?: T | undefined` (the `exactOptionalPropertyTypes` form used at `packages/core/src/aws/logs.ts:14-15`) and each is conditionally spread into the request body.
  - *Evidence to collect:* read `packages/core/src/aws/logs.ts:106-125` and confirm each optional field is declared with the explicit `| undefined` union and appears in the body only through a `...(x !== undefined ? { x } : {})` spread; run `pnpm typecheck` at the repo root and expect it clean.
  - *Checks:* confirm neither method grew past two positional parameters - the options arrive in a trailing object in the `filterEvents(logGroupName, opts = {})` shape at `packages/core/src/aws/logs.ts:71`, per DEVELOPMENT.md §Code style ("Prefer 0–2 parameters").
  - *Status:* ☑ SATISFIED
    - `packages/core/src/aws/logs.ts:19` declares `export type DeliveryOutputFormat = 'json' | 'plain' | 'w3c' | 'raw' | 'parquet'` - a union, not a free string, per DEVELOPMENT.md §Make intent explicit (`:147-149`).
    - `:21-27` declare `DeliveryDestinationOptions { outputFormat?: DeliveryOutputFormat | undefined }` and `DeliveryOptions { recordFields?: readonly string[] | undefined; fieldDelimiter?: string | undefined }` - all three carry the explicit `| undefined` union required under `exactOptionalPropertyTypes` (`tsconfig.base.json:15`).
    - `:118-131` and `:134-147` build both bodies with `...(opts.X !== undefined ? { X: opts.X } : {})`, the same idiom as `filterEvents` at `:83-84` and `ensureLogGroup` at `:52`.
    - Both methods take two positional parameters plus a trailing `opts: T = {}`, matching `filterEvents(logGroupName, opts = {})` at `:80`.
    - `pnpm typecheck` clean across all six workspace packages. Each package's `tsconfig.typecheck.json` sets `"exclude": []`, so `*.test.ts` and `src/test-support.ts` are in scope.
    - Independent API verification against the live AWS reference: `PutDeliveryDestination` lists `outputFormat` as a **top-level** request field (not nested in `deliveryDestinationConfiguration`) with Valid Values `json | plain | w3c | raw | parquet` - the union is exactly right, no member missing or invented. `CreateDelivery` lists top-level `fieldDelimiter` (String, 0-5 chars) and `recordFields` (Array of strings, 0-128 items, each 1-64 chars). All three key spellings match the API exactly.

- **O2 - The site's existing delivery bodies are byte-identical.**
  - *Claim:* with no options supplied, `putDeliveryDestination` sends exactly `{ name, deliveryDestinationConfiguration: { destinationResourceArn } }` and `createDelivery` sends exactly `{ deliverySourceName, deliveryDestinationArn }` - the same keys and values as before the change.
  - *Evidence to collect:* run `pnpm test -- logs` and confirm a named case captures both request bodies through a stub `Transport` and asserts them with `toEqual` (not `toMatchObject`, which would not catch an added key); compare the asserted objects against `packages/core/src/aws/logs.ts:109` and `:116` as they stand on `main`.
  - *Status:* ☑ SATISFIED
    - Parent revision read directly (`jj file show -r 'parents(@)' packages/core/src/aws/logs.ts`): `putDeliveryDestination` produced `{ name, deliveryDestinationConfiguration: { destinationResourceArn: logGroupArn } }` and `createDelivery` produced `{ deliverySourceName, deliveryDestinationArn }`. The pinned objects at `logs.test.ts:84-87` and `:110-113` are exactly those key sets and values.
    - The assertion is `toStrictEqual` on the whole body, which is **stronger** than the `toEqual` the certificate asked for: it fails on any added key and, unlike `toEqual`, does not ignore keys whose value is `undefined`. Not `toMatchObject`.
    - `capturingTransport` (`logs.test.ts:18-26`) sits at the `Transport` seam, so it receives `body: opts.body` verbatim from `SigningClient.send` (`signer.ts:176`) - the exact JSON string signed and put on the wire.
    - **Mutation testing confirms the pins fire.** Injecting an unconditional `outputFormat: opts.outputFormat ?? 'json'` into the `PutDeliveryDestination` body killed the destination pin (1 failed / 10 passed). Injecting a stray `s3DeliveryConfiguration` key into the `CreateDelivery` body killed the delivery pin and three others (4 failed / 7 passed). The workspace was restored byte-for-byte afterwards (`shasum` match, `jj diff --stat` unchanged).

- **O3 - The options reach the body when supplied.**
  - *Claim:* supplying an output format puts it in the `PutDeliveryDestination` body, and supplying record fields and a delimiter puts both in the `CreateDelivery` body.
  - *Evidence to collect:* run `pnpm test -- logs` and confirm a named case asserts each supplied option in the captured body, plus a case supplying only one of the two `createDelivery` options and asserting the other key is absent.
  - *Status:* ☑ SATISFIED
    - Five supplied-option cases, each `toStrictEqual` on the whole body: `outputFormat` alone (`logs.test.ts:93-104`), `recordFields` alone with `fieldDelimiter` proven absent (`:116-126`), `fieldDelimiter` alone with `recordFields` proven absent (`:128-136`), and both together (`:138-150`). Every combination of the two `createDelivery` options is covered - both absent, each alone, both present.
    - Mutation: renaming the body key to `output_format` killed the supplied-format case (1 failed / 10 passed), so the key name is pinned, not just the value.
    - *Observation, not a defect.* `call()` runs `JSON.stringify` before the transport sees the payload, and `JSON.stringify` drops keys whose value is `undefined`. A mutant that spreads unconditionally (`recordFields: opts.recordFields` with `opts = {}`) therefore survives - all 11 tests still pass. It survives because it is **wire-equivalent**: the bytes AWS receives are identical. The absent-key assertions prove omission at the wire level, which is the level that matters; they cannot distinguish it from a JS-object key set to `undefined`.

- **O4 - The already-exists swallow and the existing suite survive unmodified.**
  - *Claim:* `createDelivery` still returns normally on `AwsError.isAlreadyExists`, and the pre-existing describes at `packages/core/src/aws/logs.test.ts:18-66` pass with no edits.
  - *Evidence to collect:* read `packages/core/src/aws/logs.ts:115-120` and confirm the `try`/`catch` is unchanged; run `jj diff packages/core/src/aws/logs.test.ts` and confirm the diff is additive only - no line inside `LogsClient.findDeliveryIdBySource` or `LogsClient delete* idempotency` is removed or altered.
  - *Status:* ☑ SATISFIED
    - `packages/core/src/aws/logs.ts:148-151`: the `catch (err) { if (err instanceof AwsError && err.isAlreadyExists) return; throw err; }` block is character-for-character the parent's. The diff touches only the body literal inside the `try`, never the `catch`.
    - `jj diff --git packages/core/src/aws/logs.test.ts` is purely additive: one new helper at `:18-26` and two new `describe` blocks appended after `:74`. No line inside `LogsClient.findDeliveryIdBySource` or `LogsClient delete* idempotency` is removed or altered; both pre-existing describes pass unmodified.
    - A new case (`logs.test.ts:152-161`) pins the swallow **with options supplied**, closing the path the widened signature opened. Mutation: deleting the `isAlreadyExists` guard killed exactly that case (1 failed / 10 passed).

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☑ SATISFIED
    - All six CI gates run at the repo root in `.github/workflows/ci.yml` order, all green: `pnpm build` (6 packages), `pnpm typecheck` (6 packages), `pnpm test` (513 passed / 1 skipped across 5 packages), `pnpm lint` (`blogwright-core` exit 0 with zero findings; the 25 `no-shadow` warnings are pre-existing in the untouched `packages/cli/src/nodes.test.ts`), `pnpm exec oxfmt --check .` ("All matched files use the correct format", 142 files), `pnpm knip` (exit 0, no output).
    - Changeset present at `.changeset/logs-delivery-output-format.md`, `"blogwright-core": minor`. **Minor is the correct semver impact:** the built `packages/core/dist/aws/logs.d.ts:33-34` shows `opts?: DeliveryDestinationOptions` / `opts?: DeliveryOptions` - a purely additive optional third parameter, so no existing consumer breaks; and three new exported types reach the published surface through `packages/core/src/index.ts:12` (`export * from './aws/logs.js'`), which is a feature addition, not a break.
    - *Note, not a blocker.* The AWS-side limits (`fieldDelimiter` ≤ 5 chars; `recordFields` ≤ 128 items of 1-64 chars) are not validated here. That matches this file's thin-passthrough precedent - `putRetentionPolicy` (`logs.ts:60`) does not validate CloudWatch's allowed retention values either - and a violation surfaces as an `AwsError` `ValidationException`. The task authoring the actual field list is 39; the caller is 53.

- **O6 - Run `pnpm test -- logs` and `pnpm test -- nodes`; confirm the pinned no-options bodies are exactly the two objects `packages/cli/src/nodes.ts:727,732` produce today and that the CLI's log-delivery node tests pass with no change to their client fakes (Reviewable).**
  - *Claim:* a reviewer can run both filtered suites and observe the unchanged delivery bodies plus a green CLI node suite whose `LogsClient` fakes were not edited.
  - *Evidence to collect:* run `pnpm test -- logs` and `pnpm test -- nodes` and record the pass counts; run `jj diff packages/cli/src/nodes.test.ts` and expect an empty diff.
  - *Status:* ☑ SATISFIED
    - The task's `Reviewable:` line run as written. `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose`: **11 passed** (4 pre-existing + 7 new), including both `pins the no-options body to exactly what the site's existing CloudWatch delivery sends today` cases.
    - `pnpm --filter blogwright exec vitest run nodes --reporter=verbose`: **29 passed**, including all three `cloudfront log delivery self-heal` cases and `cloudfront log nodes use the us-east-1 logs client`.
    - `jj diff --git packages/cli/` is **empty**. No CLI file changed; the diff is three files (`.changeset/logs-delivery-output-format.md`, `packages/core/src/aws/logs.test.ts`, `packages/core/src/aws/logs.ts`), 134 insertions / 4 deletions.
    - The pinned objects were checked against the parent revision's source, not against the test's own claim - see O2.

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:727` calls `putDeliveryDestination(ctx.names.deliveryDestination, groupArn)` with two arguments → expect the same two-key `PutDeliveryDestination` body and the returned destination ARN : ☑ PRESERVED
  - (Now at `nodes.ts:729-732` after task 32's landing shifted the file by two lines.) Two arguments → `opts` takes its `= {}` default → `opts.outputFormat === undefined` → the conditional spread contributes `{}` → body is `{ name, deliveryDestinationConfiguration: { destinationResourceArn } }`, identical to the parent's, with key order preserved as well. The return path `out.deliveryDestination?.arn ?? ''` (`logs.ts:130`) is untouched; `logs.test.ts:88` additionally asserts the returned ARN.
- `packages/cli/src/nodes.ts:732` calls `createDelivery(ctx.names.deliverySource, destArn)` with two arguments → expect the same two-key `CreateDelivery` body and an already-exists response still swallowed : ☑ PRESERVED
  - (Now at `nodes.ts:734`.) Two arguments → both conditional spreads contribute `{}` → body is `{ deliverySourceName, deliveryDestinationArn }`. The `catch` is unchanged, and POST is non-idempotent in `SigningClient.send` (`signer.ts:153`), so the 400 `ResourceAlreadyExistsException` is not retried before reaching the swallow.
- `packages/cli/src/nodes.test.ts:546-551` supplies a two-parameter `putDeliveryDestination`/`createDelivery` fake through `createTestContext` → expect it to still satisfy the widened signature without edits : ☑ PRESERVED
  - `ClientOverrides` types `logsUsEast1` as a `Partial<LogsClient>`, and TypeScript accepts a function of lower arity where a higher-arity signature is expected. `pnpm typecheck` covers this file (`packages/cli/tsconfig.typecheck.json` sets `"exclude": []`) and is clean. The same holds for the `:59-63` fakes.

## Residue

Notes for the validator: `deliveriesForSource` is untouched here - task 52 widens its return to carry each delivery's destination ARN, because it is the task that rewrites its only caller - so its absence from this task's diff is expected, not a gap. The spec also states that the output format is immutable once a destination exists, so the delivery-destination node replaces rather than updates when the configured format differs - that is task 53's obligation, not this one, and its absence here is not a defect. Validating the record-field names against the CloudFront field set is task 39's concern. If the `DeliveryOutputFormat` union omits a member the API accepts, the omission is a follow-up rather than a regression, since no existing caller supplies a format at all.

**Discharged:** the union omits nothing - it is exactly AWS's `json | plain | w3c | raw | parquet`, verified against the live `PutDeliveryDestination` reference rather than taken from the implementer's report, so no follow-up is owed.

**Carried forward to task 53.** The CLI's `LogsClient` fakes at `packages/cli/src/nodes.test.ts:59-63` and `:546-551` ignore every argument and assert only call order. That is pre-existing (they already ignore `name` and `logGroupArn`) and correctly outside this task, whose contract forbids CLI edits. But it means no CLI-layer test would notice if `logDeliveryNode.wire()` ever started passing an option to the site's own delivery. The byte-level pin now lives at the client layer where the body is built, which is the right layer for the "silently added body key" defect class; the remaining exposure is a `nodes.ts` change, and task 53's certificate already carries that regression check at its line 62. Task 53 should keep it, since its fakes are the only thing standing between the site's delivery and an option leaking onto it.

**Minor style tension, accepted.** Both methods now take three parameters, against DEVELOPMENT.md:212 ("Prefer 0-2 parameters"). The task contract explicitly sanctions the shape (two positional plus a trailing options object, following `filterEvents`), the certificate's own O1 check tests for exactly that, and `putDeliverySource` at `logs.ts:100-105` already takes four in the same file. No action.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED with collected evidence and all three regression traces are PRESERVED - the three options are `?: T | undefined` and conditionally spread, the no-options bodies were checked against the parent revision's own source and pinned with whole-body `toStrictEqual` that mutation testing proves fires on a silently added key, the union and all three body-field spellings were verified independently against AWS's live API reference, the CLI is untouched with an empty diff, and all six CI gates plus the `Reviewable:` line run clean.
