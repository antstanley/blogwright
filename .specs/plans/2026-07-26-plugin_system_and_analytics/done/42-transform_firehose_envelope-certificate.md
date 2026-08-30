# Done Certificate - Task 42: The Firehose transform handler and its per-record drop path

**Task:** [42-transform_firehose_envelope.md](42-transform_firehose_envelope.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 42. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 42) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/analytics/src/transform/handler.ts` decodes each Firehose record from base64, maps it through `mapRecord`, and returns `Ok` with the re-encoded row or `ProcessingFailed`, per record, with `recordId` echoed unchanged and no AWS SDK or network call anywhere in it.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `mapRecord` (task 40) or the `visitor_key`/`is_bot` derivation (task 41): the handler forwards their decisions and must not re-implement the mapping, the drop rule, or the salt derivation.

## Validation environment

- **Diff under test:** workspace `/Users/ant/code/blogwright-task-42`, working-copy commit `92b3f148` over `a858abf7` (build 34/62, task 41). `jj diff --stat`: two files, `+612 / -0`, both new.
- **Integration target:** the bookmark has advanced past the build 35 named in the routing brief; `plugin-system-and-analytics` is at `db8db370` **build 36/62** (task 45 - the analytics query port and named query set). All merge evidence below is against build 36.
- **Mutation harness:** `mutate.py` + `mutations.json` in the validator's private scratch directory. 30 mutations applied one at a time, each followed by `vitest run handler --reporter=verbose` and a byte-exact restore.

## Obligations

- **O1 - Per-record Ok/ProcessingFailed, proven by a mixed batch.** ✅ SATISFIED
  - *Claim:* the handler decodes, maps and classifies each record independently, and a batch containing one unmappable record still returns `Ok` for every other record.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run handler --reporter=verbose` inside `packages/analytics` - **23 passed / 23**, 16 `it` blocks (four expanded by `it.each`). The mixed-batch test (`handler.test.ts:161-186`, "reports one unmappable record as ProcessingFailed and still returns Ok for the rest") asserts `response.records.map((entry) => entry.result)` against the full ordered list `['Ok', 'Ok', 'ProcessingFailed', 'Ok']` - every entry's `result`, not a count - then `toStrictEqual`s the failed entry as `{ recordId: 'r-3', result: 'ProcessingFailed' }` and decodes entries 0 and 3 back to `FULL_ROW`. `rowOf` (`handler.test.ts:139-147`) throws unless the entry is `Ok` **and** carries `data`, so the `Ok` entries are proven to carry decodable base64.
  - *Checks run:* the mapping call resolves to the imported `mapRecord` (`handler.ts:74` `import { type CloudFrontRecord, mapRecord } from './map-record.js'`, called once at `handler.ts:205`). There is no second mapping path and no inline field mapping in the module. Mutation evidence that the classification is genuinely per-record: `M-failed-filtered-out` (failed entries omitted from the response) is killed by 8 tests; `M-dropped` (`ProcessingFailed` → `Dropped`) by 8; `M-failed-carries-data` by 2, including the IP-leak test.

- **O2 - recordId echoed unchanged for every entry.** ✅ SATISFIED
  - *Claim:* every response entry carries the request entry's `recordId` verbatim, for `Ok` and `ProcessingFailed` alike.
  - *Evidence collected:* `handler.test.ts:188-211` ("echoes every recordId unchanged and in order, failed entries included") builds a four-entry batch - one mappable, one unmappable, one non-JSON, one mappable - and asserts `response.records.map((entry) => entry.recordId)` `toStrictEqual` the full ordered request list `['first', 'second', 'third', 'fourth']`, then the full ordered result list. It covers both failure kinds, not only the successful entries.
  - *Checks run:* mutation `M-id-mangled-on-failure` (a failed entry gets a constant id) is killed by 7 tests including this one; `M-order-reversed` (response not in request order) is killed by 4. So both the identity and the ordering halves of the obligation have teeth. `handler.ts:203`, `:206` and `:209` all read `record.recordId` with no transformation.

- **O3 - No AWS SDK, no network, no module mocking.** ✅ SATISFIED
  - *Claim:* the handler imports no AWS SDK and performs no network call, and its tests need neither cloud access nor `vi.mock`.
  - *Evidence collected:* `grep -rn "@aws-sdk\|fetch(\|vi.mock\|vi.stubGlobal" packages/analytics/src/transform/` returns **no output** (exit 1). The result is clean for the right reason, not by a reworded prose mention: `@aws-sdk` appears **nowhere in `packages/*/src`** - this repo hand-rolls every AWS client over its own SigV4 transport, so there is no dependency to avoid naming. `handler.ts` has exactly two imports (`:72`, `:74`): `import type { SecretsManagerClient } from 'blogwright-core'` and `mapRecord`/`CloudFrontRecord` from `./map-record.js`. The envelope types are repo-owned declarations (`FirehoseTransformRecord`, `FirehoseTransformRequest`, `FirehoseRecordResult`, `FirehoseTransformedRecord`, `FirehoseTransformResponse`, `handler.ts:76-118`); nothing is imported from `@types/aws-lambda`.
  - *Type-only import erases:* `packages/analytics/dist/transform/handler.js` after `pnpm build` contains exactly one import - `import { mapRecord } from './map-record.js'`. No `blogwright-core`, no client, no signer, no transport reaches task 43's bundle through this module. `dist/transform/handler.d.ts` carries the `SecretsManagerClient` type import only.
  - *Port, not a mock:* `SaltSecretStore = Pick<SecretsManagerClient, 'getSecretValue'>` (`handler.ts:126`) is checked against core's real class - `packages/core/src/aws/secretsmanager.ts:65` declares `async getSecretValue(name: string): Promise<string | undefined>`, matching exactly. The suite's only vitest import is `{ describe, expect, it }`; the store is satisfied by a plain counting object (`handler.test.ts:104-119`). DEVELOPMENT.md §Testing ("substitute at ports, never by patching modules") is met.
  - *Dependency check:* `packages/analytics/package.json` gained nothing - `dependencies` remains `blogwright-core` alone.

- **O4 - Invalid JSON and an empty batch are handled without throwing.** ✅ SATISFIED
  - *Claim:* a record whose payload is not valid JSON returns `ProcessingFailed`, and an empty `records` array returns an empty `records` response - neither throws.
  - *Evidence collected:* `handler.test.ts:213-219` awaits the handler (a resolved response, not a rejection) and asserts `response.records` `toStrictEqual` `[{ recordId: 'r-1', result: 'ProcessingFailed' }]` - a returned entry, and one carrying no `data`. `handler.test.ts:245-251` asserts `response.records` `toStrictEqual` `[]` - a zero-length array on a real response object, not `undefined`. Three further negative cases go beyond the DoD: an undecodable base64 payload (`:221-227`) and four non-object payload shapes (`:229-243`).
  - *Checks run:* `M-json-throws` (the `JSON.parse` try/catch removed) is killed by 3 tests; `M-empty-batch-throws` (empty batch yields `undefined` records) is killed by the empty-batch test. Both obligations are therefore falsifiable rather than incidentally true.

- **O5 - Meets the repo definition of done.** ✅ SATISFIED
  - *Evidence collected:* all six CI gates run from the workspace root in `.github/workflows/ci.yml` order, all green.
    - `pnpm build` - Done, 5 packages.
    - `pnpm typecheck` - Done, 6 packages.
    - `pnpm test` - core/build-agent 27, pds 100, **analytics 329 (12 files)**, cli 317; all passed.
    - `pnpm lint` - Done. `pnpm exec oxlint src` inside `packages/analytics` exits 0 with zero findings; the `no-shadow` warnings in the aggregate run are pre-existing in `packages/cli/src/nodes.test.ts` and untouched here.
    - `pnpm exec oxfmt --check .` - "All matched files use the correct format", 166 files.
    - `pnpm knip` - exit 0, no output.
  - *knip is clean without a manufactured consumer.* `FirehoseTransformRequest`, `FirehoseTransformResponse` and `SaltSecretStore` appear in `createTransformHandler`'s own exported signature, so `declaration: true` requires the exports; `dist/transform/handler.d.ts` confirms it. `SALT_SECRET_NAME_ENV` is consumed by the suite for real work - it builds the `ENV` fixture and is the string the env-guard errors are asserted against - and mutation `M15a` (a different hardcoded name) reddens **19 of 23** tests, proving the value is load-bearing rather than merely mentioned. This is the "export beside its own consumer" answer plan.md's knip bullet prescribes, not the manufactured-consumer anti-pattern.
  - *Other baseline items.* Limits and vocabulary are named constants (`OK`, `PROCESSING_FAILED`, `SALT_SECRET_NAME_ENV`); no magic values in the transform path. Both throws carry context and a remedy - `handler.ts:141-145` names the missing variable and the consequence, `handler.ts:159-163` names the secret and points at `blogwright analytics bootstrap`. No `null` is used for a domain value (`decodePayload` returns `undefined`). The one external interaction is behind the `SaltSecretStore` port. Functions are small and single-purpose (`requireSaltSecretName`, `loadSaltSecret`, `decodePayload`, `transformRecord`, `createTransformHandler`).
  - *Changeset: not required, and correctly omitted.* `packages/analytics/src/index.ts` re-exports only `./aws/*` and `ANALYTICS_NAMESPACE`; `createTransformHandler` and the envelope types reach no published `exports` surface, and no node yet deploys the function. This is the identical call tasks 39, 40 and 41 made for this package, each recorded in its certificate, with the analytics plugin's changeset coverage scheduled at task 58. `.changeset/` holds no analytics-transform entry at the tip, so the precedent is consistent.

- **O6 - Reviewable: the mixed-batch response shape.** ✅ SATISFIED
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run handler --reporter=verbose` run verbatim from `packages/analytics` - 23 passed, 1 file, 141 ms, no cloud access. By inspection of `handler.test.ts:161-186`, the mixed batch is four request entries `r-1 … r-4` with the third built from `UNMAPPABLE_RECORD` (`FULL_RECORD` minus `timestamp(ms)`); the expected response is exactly one `ProcessingFailed` at index 2 and `Ok` at 0, 1 and 3. The request-order id check is discharged by the companion test at `:188-211`, which asserts the full ordered id list over a batch carrying both failure kinds.

## Routed-finding verification (the crux)

The routed finding required proof by mutation, not by reading. Both were done.

- **The module's structure.** `handler.ts` contains exactly **one** `try` in code (`:182-186`), around `JSON.parse(Buffer.from(data, 'base64').toString('utf8'))` and nothing else. `grep` for `.catch(`, `Promise.all`, `Promise.allSettled` in the module returns nothing. The only `?.` is `env[SALT_SECRET_NAME_ENV]?.trim()` at `:140`, immediately followed by an explicit `undefined`/`''` guard that throws - it swallows nothing. No `??` sits between `mapRecord` and the batch boundary.
- **M11 reproduced (batch-boundary catch).** Wrapping the whole handler body in `try { … } catch { return per-record ProcessingFailed }` is killed by exactly **5** tests: the throttled read, the three "Secrets Manager holds no secret / an empty value / a blank value" rows, and the retry test. The implementer's claim - 5 loud batch failures converted to silent per-record `ProcessingFailed` - is substantiated exactly.
- **M11 in its literal shape (catch around `mapRecord` only) SURVIVES, and that is not a defect.** It is a provably equivalent mutant: `loadSaltSecret` guarantees a non-blank secret before any mapping, `day` is a fixed 10-character slice of an ISO instant, `dailySalt` returns 64 hex characters, and `stringFrom` (`map-record.ts:194-204`) trims and returns `ABSENT` for an empty or `-` value, so `visitorKey` is never reached with an empty IP. Under the handler's own guards `mapRecord` is **total**, so no test can distinguish the added catch. The finding's harm is prevented by the validated boundary rather than by the catch's absence alone, and the absence is additionally held by the module comment at `handler.ts:36-52`. The composite mutation (catch **plus** guard removal) is killed by 3 tests - by the guard removal, which is exactly where the protection lives.
- **The salt premise holds end to end.** The **secret** reaches `mapRecord` (`handler.ts:205`, `mapRecord(payload, saltSecret)`); `mapRecord` derives each record's own `day` and calls `dailySalt(saltSecret, day)` per record (`map-record.ts:347`). The handler hoists nothing.
- **The midnight test is real, not vacuous.** `LAST_MS_OF_AUGUST = 1_788_134_399_999` and `FIRST_MS_OF_SEPTEMBER = 1_788_134_400_000`; the guard test (`handler.test.ts:295-301`) pins the gap at exactly 1 ms and both `toISOString()` renderings across the boundary. **M16a** (gap widened, still straddling) reddens the guard test; **M16b** (both instants on the same side) reddens the guard test *and* both per-record-salt tests - so the fixture is proved non-vacuous in both directions.
- **The bug the finding names is caught.** **M8** (one fixed day for the salt) and **M9** (the wall-clock day instead of the record's) each redden both midnight tests: "keys each record under its own day's salt, not one salt for the buffer" and "gives one visitor two keys across the midnight". Three further salt mutations - a day nobody's record carries, the raw secret used as the salt, the user agent dropped from the key - each redden the `FULL_ROW` assertion as well, confirming that `FULL_ROW.visitor_key` is independently derived from task 41's functions rather than restating the handler's output.

## Outcome vocabulary

`Dropped` appears nowhere in the code; `FirehoseRecordResult` is `'Ok' | 'ProcessingFailed'` and the module comment (`handler.ts:26-30`) records why the third value is refused. Failed entries are constructed as two-property object literals with no `data` (`handler.ts:203`, `:206`), asserted by `toStrictEqual` in five tests. `recordId` is echoed verbatim on every entry and the response is built by a synchronous `.map` over `request.records`, so request order is structural. Empty batch → `[]`; single record → one entry; mixed batch → per-entry outcomes: all three asserted.

## Judged decisions

| Decision | Verdict | Evidence |
| --- | --- | --- |
| Secret read once per execution environment, failure **not** cached | Correct, both halves fire | `M10-no-cache` (cache dropped) reddens "reads the secret … once, then reuses it"; `M13-cache-promise` (`cached ??= loadSaltSecret(...)`) reddens "retries a failed read on the next batch rather than caching the failure". The suite also pins that no read happens before the first batch. |
| Type-only port; task 43's bundle carries no client | Correct | `dist/transform/handler.js` imports only `./map-record.js`; the DoD grep is clean because the repo has no `@aws-sdk` anywhere, not because prose was reworded. |
| `SALT_SECRET_NAME_ENV` exported so one spelling exists | Correct | `M15a` (different hardcoded name) reddens 19 tests. knip clean with no manufactured consumer. Note: `M15b` (the same spelling inlined as a literal) survives - inherent, since the test builds its fixture from the export; the property is static, and the export is independently required by declaration emit. |
| No composition root here; entry file routed to task 43 | Correct, and documented | `handler.ts:63-69` states the module is not a composition root and names the bundle entry as the binder. The obligation is carried in `backlog/43-transform_bundle_and_source_hash.md:10-20` as a routed finding. Not a defect. |
| Drop `reason` discarded, no logging | No policy invented | `handler.ts` never reads `mapped.reason` and contains no `console`, no logger, and no claim about logging. The module comment frames the error prefix itself as the data-quality signal. Remains an open question, as routed. |

## Falsifiability sweep (validator-run, not accepted from the implementer)

30 mutations applied and individually attributed; **25 killed, 5 survived**. Every one of the 16 `it` blocks and every one of the four `it.each` row-sets is reddened by at least one mutation - there is no assertion in this suite that cannot fail. The four non-object payload rows were sampled adversarially, as directed:

- `null` is the row with unique teeth: `M-guard-null` (the `parsed === null` check removed) reddens it alone, because `null['timestamp(ms)']` throws out of the batch.
- `M-guard-typeof` and `M-guard-array` **survive**: with either clause removed, a bare number, a bare string and a one-element array still reach `mapRecord`, still lack `timestamp(ms)`, and still drop to `ProcessingFailed`. Those three rows therefore do not discriminate their own guard clause - though each is reddened by 4 other mutations (`M-dropped`, `M-id-mangled-on-failure`, `M-failed-filtered-out`, `M15a`), so none is a vacuous assertion in plan.md's sense. Recorded as an observation below, not a defect: the guards are correct defence-in-depth that keeps this module from depending on `mapRecord`'s tolerance of non-objects, exactly as `handler.ts:172-176` disclaims.

The remaining survivor, `M-trim-secret`, is the only one that names a real gap; see Observations.

**Restore proved twice.** After the last mutation every file's SHA-256 matches the pre-mutation baseline (`handler.ts ca59c49a…`, `handler.test.ts bbdcaaaf…`, `map-record.ts 766d1618…`, `visitor-key.ts 003726e6…`), and re-snapshotting the workspace yields the **identical** working-copy commit `92b3f1486a93def9314b643b015b7b3000f64fe6` it had before any mutation - a tree-level proof, not a file-level one. `packages/analytics` is green post-restore: 329 passed / 12 files.

## Regression check

- `packages/analytics/src/transform/map-record.ts` `mapRecord` is called by the handler for each decoded payload → **PRESERVED**. The file is byte-identical between the workspace and the tip (`766d1618…` both sides); tasks 40 and 41 pass unchanged inside the full analytics run (329 tests, 12 files); the handler adds no second mapping path (one call site, `handler.ts:205`).
- `packages/analytics/vitest.config.ts` `include` collects `transform/**/*.test.ts` → **PRESERVED**. `include: ['src/**/*.test.ts']` is untouched; the analytics suite grew from 12 files with `handler.test.ts` collected alongside `bots`, `map-record` and `visitor-key`.
- `packages/core/src/aws/secretsmanager.ts` supplies the port's shape → **PRESERVED**. Byte-identical between workspace and tip (`af024650…`); builds 35 and 36 touched `packages/core/src/config.ts` only.

## Integration

- Both new paths are **absent** at the tip: `jj file list -r db8db370 packages/analytics/src/transform` returns only `bots`, `map-record` and `visitor-key`.
- Three-way merge dry-run: `git merge-tree --write-tree db8db370 92b3f148` produced tree `26455c85` with no conflict output. `git diff --name-status db8db370 26455c85` is exactly `A packages/analytics/src/transform/handler.test.ts` and `A packages/analytics/src/transform/handler.ts`, `+612 / -0`. A **clean pure-add**.
- Every symbol the change imports resolves against the current tree: `mapRecord`/`CloudFrontRecord` (unchanged since build 34, and `mapRecord`'s required second parameter is present) and `SecretsManagerClient.getSecretValue` (unchanged in core).
- Note for the merging agent: the bookmark is at **build 36**, one ahead of the build 35 named in the routing brief. Build 36 (task 45) added `src/ports.ts`, `src/queries.ts`, `src/queries.test.ts` and `src/fixture-query.ts` under `packages/analytics`, none under `transform/`, so the file sets are disjoint.

## Observations (non-blocking)

1. **The "returned untrimmed" invariant is documented but not pinned by a test.** `handler.ts:151-155` states that the stored secret is returned untrimmed because trimming "would derive a different salt from the same secret - orphaning every `visitor_key` already written". Mutation `M-trim-secret` (`return secret` → `return secret.trim()`) **survives the whole suite**. The line above it already calls `secret.trim()` for the blank check, so a later reader could reasonably "tidy" the return and silently re-key every visitor whose secret carries leading or trailing whitespace - unrepairable per the spec, since the old salt is gone. One assertion would close it: read back a store returning `` ` ${SALT_SECRET} ` `` and expect the row's `visitor_key` to equal `visitorKey(ip, ua, dailySalt(' ' + SALT_SECRET + ' ', day))`. Low likelihood (a bootstrap-generated secret carries no whitespace), but the module itself elevates the property to load-bearing.
2. **Two `decodePayload` guard clauses are behaviourally redundant under the current fixtures** (`M-guard-typeof`, `M-guard-array` survive). Defence-in-depth, correctly reasoned in the module comment; noted so a future reader does not mistake the four `it.each` rows for per-clause coverage.
3. **"Once at cold start" is implemented as once on the first invocation**, not at module load - forced by the factory shape the DoD's grep requires, documented at `handler.ts:219-229`, and achieving the cost and latency goal the spec names. Recorded as a faithful reading, not a divergence.

## Conclusion

VERDICT: **DONE**
CONFIDENCE: **high**
SUMMARY: O1…O6 all SATISFIED on collected evidence - 23 handler tests green, the DoD grep clean because the repo carries no AWS SDK at all, the type-only port erased from the emitted bundle, all six CI gates green from the workspace root, and no changeset required on tasks 39-41's recorded precedent - with the routed finding discharged by mutation rather than by reading (the batch-boundary blanket catch reddens exactly the 5 secret-failure tests, the one-salt-per-invocation bug reddens both midnight tests, and the 1 ms midnight fixture is proved non-vacuous in both directions), 25 of 30 mutations killed with every `it` block falsifiable and all 5 survivors accounted for, three regression traces PRESERVED, and a clean pure-add merge onto build 36.
