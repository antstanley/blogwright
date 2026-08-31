# Done Certificate - Task 53: The CloudWatch delivery destination and the second delivery off the site's source

**Task:** [53-nodes_log_destination_and_delivery.md](53-nodes_log_destination_and_delivery.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 53. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 53) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `analytics-log-destination` and `analytics-log-delivery` add a second delivery hanging off the site's existing delivery source, which the plugin reads but never creates, never repoints and never deletes.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's vended log delivery (`packages/cli/src/nodes.ts:766` `logDeliveryNode`, its `ConflictException` self-heal at `:796-820` and its teardown at `:822-833`), the `LogsClient` request bodies task 37 pinned for the no-options path, or the plugin's read-only access to the site's state (`ctx.siteState`, typed `SiteState`, from task 01 - distinct from `ctx.state`, which holds the plugin's own outputs).

## Validation environment

- Workspace `/Users/ant/code/blogwright-task-53`, working copy `oktpsppx 81bf0fe9`, parent `qnumvmqu 2ff2cb01` (build 51). Diff: three files, `+1451/-21`.
- All commands run from the workspace root. Diff stat and sha256 of both mutated source files re-verified identical after every experiment.

## Obligations

- **O1 - Destination with an immutable output format.**
  - *Claim:* the destination points at the Firehose stream with the required output format and is replaced, not updated, when the recorded format differs from the configured one.
  - *Evidence collected:* `analyticsLogDestinationNode` at `packages/analytics/src/nodes.ts:2650`. `create` resolves `requireStreamArn` → `requireActiveStream` → `putLogDestination`; `putLogDestination` (`:2623-2635`) calls `logs(ctx).putDeliveryDestination(name, streamArn, { outputFormat: DELIVERY_OUTPUT_FORMAT })` - task 37's option object at `packages/core/src/aws/logs.ts:21-23`, not a hand-built body - and records `name`, `arn` (guarded against `''` by `recordOptional`) and `outputFormat`. `update` (`:2707-2745`) compares `recordedText(ctx, LOG_DESTINATION_NODE, 'outputFormat')` against `DELIVERY_OUTPUT_FORMAT` and, on a mismatch, warns, detaches the plugin's own delivery, deletes the destination, then re-puts.
  - *Checks:* `DELIVERY_OUTPUT_FORMAT = 'json'` (`:2401`) is a valid `PutDeliveryDestination` `outputFormat` (AWS: `json | plain | w3c | raw | parquet`) and is required by `transform/handler.ts:183`, which `JSON.parse`s each base64 record. Test `replaces the destination when the recorded output format differs` asserts the call log `listDeliveries, deleteDelivery:analytics-d, deleteDest, describeStream, putDest` - delete-then-create, not a second put - and `re-puts the destination on a matching format` asserts the non-destructive path is a bare `describeStream, putDest`. Mutants: dropping `outputFormat` from the put kills 2; dropping the detach ahead of `deleteDest` kills the format-change test (the stateful fake rejects `DeleteDeliveryDestination` while a delivery points at it, so this assertion is non-vacuous).
  - *Status:* ☑ SATISFIED

- **O2 - Delivery joins the site's source; absence fails with an actionable message; the creation day is recorded once.**
  - *Claim:* the delivery is created against the site's delivery source with `schema.ts`'s record-field selection, `putDeliverySource` is never called, the source name and distribution ARN are read through `ctx.names` and `ctx.siteState`, an absent source or distribution ARN fails before any AWS call with a message naming `blogwright bootstrap`, and the node records `createdDay` - the UTC day the delivery was first created - written once and never advanced.
  - *Evidence collected:* `analyticsLogDeliveryNode` at `packages/analytics/src/nodes.ts:2846`. `create` resolves `requireSiteDeliverySource(ctx)` (`:2810-2823`: `ctx.names.deliverySource` and `ctx.siteState.resources['cloudfront-distribution']?.arn`, throwing `…run \`blogwright bootstrap <env>\` first` when either is absent) and `requireLogDestinationArn(ctx)` **before** the single `createDelivery` call, which passes `recordFields: CLOUDFRONT_RECORD_FIELDS` and nothing else. `grep -n "StateStore\|putDeliverySource" packages/analytics/src/nodes.ts` returns three hits, **all inside doc comments** (`:31`, `:2784`, `:2833`); `grep -rn "putDeliverySource\|deleteDeliverySource" packages/analytics/src --include "*.ts"` excluding tests returns six hits, all comments. `createdDay` is written at exactly one site (`:2913`) under `if (typeof out[CREATED_DAY_KEY] !== 'string')`, and `read`'s hydration (`:2857-2874`) deliberately omits it.
  - *Checks:* the record-field argument resolves to `CLOUDFRONT_RECORD_FIELDS` from `packages/analytics/src/schema.ts:181`, not a restated list; the test additionally pins `c-ip`/`timestamp(ms)` present and `cs(Cookie)`/`x-forwarded-for` absent. `toStrictEqual` on the request body pins the exact three keys. Write-once direction verified by mutation: making the `createdDay` write unconditional kills 2 tests (`never advances createdDay when the delivery is created again`, `never advances createdDay through the destination's Conflict retry`); refilling it in `read` kills 2 more. Negative space verified: removing the `requireSiteDeliverySource` refusal kills 2 tests, both of which assert `expect(requests).toStrictEqual([])` - no AWS call at all. Adding a `putDeliverySource` call kills 2; dropping `recordFields` kills 1.
  - *Status:* ☑ SATISFIED

- **O3 - The site's CloudWatch delivery survives.**
  - *Claim:* after the analytics delivery is created, `deliveriesForSource` still lists the site's CloudWatch delivery and no delete was issued against it.
  - *Evidence collected:* `leaves the site's CloudWatch delivery listed and undeleted once its own exists` seeds `SITE_DELIVERY` (`id: 'site-d'`, destination ARN ending `<prefix>-cf-dest`), creates the plugin delivery, re-lists through the node's own `read`, and asserts `world.deliveries` is `[SITE_DELIVERY, { id: 'd-1', … }]`, that the call log is exactly `createDelivery, listDeliveries`, and that neither `deleteDelivery:site-d` nor `deleteSource` appears. `creates the destination against the stream…` makes the same survival assertion on the destination path.
  - *Checks:* the fake is stateful (`answerLogs`, `packages/analytics/src/nodes.test.ts:503-576`) and mutates `world.deliveries`, so the surviving-id assertion reads the model rather than the script.
  - *Status:* ☑ SATISFIED

- **O4 - The shared delivery source is never deleted.**
  - *Claim:* neither the `ConflictException` retry nor `delete` calls `deleteDeliverySource`; the retry clears only the plugin's own delivery and destination with a comment stating the deliberate divergence from the site's node; `delete` removes the delivery before the destination.
  - *Evidence collected:* the retry at `packages/analytics/src/nodes.ts:2671-2705` carries the divergence comment ("**The deliberate divergence is the absent `deleteDeliverySource`.**") and calls only `clearPluginDeliveries` → `deleteDeliveryDestination` → `putLogDestination`. Teardown is expressed as an edge: `analyticsLogDeliveryNode.delete` calls only `clearPluginDeliveries`; `analyticsLogDestinationNode.delete` calls only `deleteDeliveryDestination`; `destroyGraph` (`packages/cli/src/graph.ts:107`) walks the reverse topological order, so the delivery goes first. Every `logs(ctx)` call in the two nodes was enumerated: `putDeliveryDestination`, `createDelivery`, `deliveriesForSource`, `deleteDelivery`, `deleteDeliveryDestination` - `deleteDeliverySource` appears nowhere in executable code.
  - *Checks:* the deleted id is looked up by destination through `isPluginDelivery` (`:2495`), not by position and not by clearing every delivery on the source - `deletes only its own delivery, never the shared source` seeds the site's delivery **first** so a position-based guard picks the wrong one, and `leaves a delivery it cannot attribute exactly where it found it` pins the fail-closed empty-ARN case. Mutants: `deleteDeliverySource` added to the delivery's `delete` kills 5; added to the destination's `delete` kills 5; added to the Conflict retry kills 2; `isPluginDelivery → true` kills 10.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected, from the workspace root:* `pnpm build` exit 0; `pnpm test` all green (core 149+1 skipped, build-agent 27, pds 145, analytics 734, cli 353); `pnpm lint` 0 errors (11 pre-existing `no-shadow` **warnings** in `packages/cli/src/nodes.test.ts`, present unchanged at `@-`, in code this task does not touch); `pnpm exec oxfmt --check .` "All matched files use the correct format"; `pnpm knip` clean.
  - *Checks:* limits are named constants with rationale - `LOG_DESTINATION_NAME_MAX_LENGTH = 60` (matching AWS's documented `name` max), `STREAM_ACTIVE_POLL_INTERVAL_MS = 5_000`, `STREAM_ACTIVE_TIMEOUT_MS = 5 * 60_000`, `ISO_DAY_LENGTH = 10`; `boundedName` throws rather than truncating, pinned by `raises on a derived destination name over the service's limit, before any call`. No changeset added - consistent with the established convention for this build's node tasks (48, 49, 50, 51 each landed with none; the plugin's user-facing surface is covered by the umbrella changesets already in `.changeset/`).
  - *Status:* ☑ SATISFIED

- **O6 - Run the analytics and CLI node suites and confirm no `deleteSource` entry anywhere (Reviewable).**
  - *Claim:* a reviewer can run both node suites and observe no `deleteSource` entry in any analytics call log, the CLI's self-heal assertions unchanged, and the format-change case showing delete-then-create.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` → 162 passed; `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` → 33 passed. Every analytics case that could reach the source asserts `expect(deliveryCalls(requests)).not.toContain('deleteSource')`, and `answerLogs`'s `DeleteDeliverySource` branch (which would reject anyway while a delivery is attached) is never reached. The format-change case's call log is `listDeliveries, deleteDelivery:analytics-d, deleteDest, describeStream, putDest`.
  - *Checks:* the contract's `packages/cli/src/nodes.test.ts:88-97` is a **stale line reference** - the self-heal assertion block is now at `:140-155` (the file grew in task 52, before this task). The assertions themselves are byte-identical: the CLI diff removes four lines and adds thirteen, all of them the foreign-delivery fixture, and **no `expect` line is added, removed or edited** (`jj diff --git packages/cli/src/nodes.test.ts | grep -E "^[+-]" | grep expect` is empty).
  - *Status:* ☑ SATISFIED

## The routed `CREATING` finding - adjudicated

Task 51's finding is discharged here, and every clause of the reasoning was checked independently:

- `requireActiveStream` (`packages/analytics/src/nodes.ts:2591`) runs before every `putDeliveryDestination`, in both `create` and `update`. Removing the call kills 6 tests.
- **`pollUntil` returns rather than throws on timeout** - `packages/core/src/util.ts:36-47`, `if (Date.now() >= deadline) return value;`. **Verified directly**; the whole timeout path depends on it, and the claim is correct.
- The predicate `(status) => status === undefined || status.state !== 'creating'` settles on any non-`creating` state, so a `create-failed` stream is reported at once. Replacing it with `() => true` kills `waits for a stream that is still creating before pointing a destination at it`.
- The post-poll check `if (settled?.state === 'active') return;` is what converts timeout, `create-failed`, `deleting` and an unreadable stream into one message. Weakening it kills `refuses rather than pointing a destination at a stream that never became active`.
- The wait-rather-than-refuse rationale holds: `applyGraph` runs `analytics-firehose-stream` immediately before this node, and 5s/5min is generous for a `DirectPut` stream.

**Verdict: the decision is sound and correctly implemented.** One note, not a defect: `settled === undefined` (an unreadable stream) settles the poll immediately and refuses rather than waiting. This is consistent with the rest of the module - `analytics-firehose-stream`'s own `create` already describes the stream immediately after creating it (`:2007`) - but it is a refusal path that the "wait, don't refuse" rationale does not itself cover.

## The Step 3 divergence on `fieldDelimiter` - adjudicated against AWS

**The implementer is right, and Step 3 is defective.** Checked against AWS's own reference:

- `CreateDelivery` → `fieldDelimiter`: *"The field delimiter to use between record fields **when the final output format of a delivery is in `Plain`, `W3C`, or `Raw` format**."*
- `PutDeliveryDestination` → `outputFormat`: valid values `json | plain | w3c | raw | parquet`.
- The format here is `json` because `packages/analytics/src/transform/handler.ts:183` does `JSON.parse(Buffer.from(data, 'base64').toString('utf8'))`; `plain`/`w3c`/`raw` deliver delimited text that would fail every record as `ProcessingFailed`.

So a `fieldDelimiter` on this delivery is out of scope of its own documentation. The authority spec (§`blogwright-core` → `LogsClient` delivery configuration) says only that *core's client* accepts the delimiter - which task 37 delivered - and its node row for `analytics-log-delivery` says nothing about one. **The DoD's O2 names only the record-field selection**, and the DoD is what governs done-ness. Step 3's "and the delimiter task 37 added" over-specifies against the authority and against AWS.

The absence is pinned rather than incidental: the create test asserts the request body with `toStrictEqual`, and adding `fieldDelimiter: '\t'` kills it.

**Recorded as a defective step**, the fifth in this build. No remediation is required of this task.

## Mutation testing - run independently, not accepted from the implementer

A private harness was built with two controls run **first**:

- **Negative control (anchor):** a mutator whose anchor cannot match reports `ANCHOR DID NOT MATCH - FILE UNCHANGED` and is refused. Behaved correctly.
- **Negative control (no-op):** a comment-only insertion must survive. **This control exposed a harness defect** - `--reporter=basic` does not exist in vitest 4, so every run failed to start and every mutant would have been scored "killed" on exit code. The harness was corrected to `--reporter=verbose` and to require a parsed `Tests …` summary line; the no-op then survived cleanly (162 / 33 passing).
- **Positive control:** renaming `LOG_DESTINATION_NODE` kills 12.

18 mutants, all killed, each with an anchor-match check, an on-disk sha256 change check, the failing test names captured, and a sha256 restore verified after each:

| # | Mutation | File | Killed |
|---|---|---|---|
| M1 | `isOwnDelivery` → `true` | cli/nodes.ts | **3** (the three task-52 refusal tests) |
| M2 | delivery `create` also calls `putDeliverySource` | analytics/nodes.ts | 2 |
| M3 | delivery `delete` also calls `deleteDeliverySource` | analytics/nodes.ts | 5 |
| M4 | destination `delete` also calls `deleteDeliverySource` | analytics/nodes.ts | 5 |
| M5 | Conflict retry also calls `deleteDeliverySource` | analytics/nodes.ts | 2 |
| M6 | format-replace drops the detach before `deleteDest` | analytics/nodes.ts | 1 |
| M7 | `requireActiveStream` drops the post-poll state check | analytics/nodes.ts | 1 |
| M8 | poll predicate settles immediately | analytics/nodes.ts | 1 |
| M9 | destination `create` skips `requireActiveStream` | analytics/nodes.ts | 6 |
| M10 | `createdDay` written unconditionally | analytics/nodes.ts | 2 |
| M11 | `createDelivery` sends a `fieldDelimiter` | analytics/nodes.ts | 1 |
| M12 | `createDelivery` drops `recordFields` | analytics/nodes.ts | 1 |
| M13 | `requireSiteDeliverySource` stops refusing | analytics/nodes.ts | 2 |
| M14 | `isPluginDelivery` → `true` | analytics/nodes.ts | 10 |
| M15 | destination suffix collides with the site's (`-cf-dest`) | analytics/nodes.ts | 16 |
| M16 | `outputFormat` dropped from the put | analytics/nodes.ts | 2 |
| M17 | `utcDay` derives the day in local time | analytics/nodes.ts | 1 |
| M18 | `read` refills `createdDay` with today | analytics/nodes.ts | 2 |

M1 reproduces the implementer's headline claim exactly. M2 (2) and M3/M4 (5 each) reproduce the `putDeliverySource`/`deleteDeliverySource` claims. M6 reproduces the format-replace detach claim.

**Foreign-fixture strengthening verified.** The CLI diff replaces the hand-written `destArn('staging-analytics-dest')` with `destArn(\`${ctx.names.prefix}-analytics-cf-dest\`)`. `logDestinationName` is `boundedName(\`${ctx.names.prefix}${LOG_DESTINATION_SUFFIX}\`, 60, …)` with `LOG_DESTINATION_SUFFIX = '-analytics-cf-dest'`, and `boundedName` **throws rather than truncates**, so the restated derivation is exact for every name the plugin can produce. `deriveNames` gives `deliveryDestination = \`${prefix}-cf-dest\``, so the two remain distinct - the single property task 52's guards rest on, and the property M15 destroys.

**Note (M17):** the local-time mutant is killed only because this host runs `SAST` (UTC+2). On a UTC or western CI runner the `2026-08-31T23:45:00Z` fixture would not distinguish `toISOString` from a local derivation and M17 would survive. The production code is correct; the *test* is TZ-dependent. Low severity, worth a `TZ` pin in a later pass.

## Regression check

- `packages/cli/src/nodes.ts` `logDeliveryNode.create` with a stale source (the `ConflictException` path) → the sequence `putSource, listDeliveries, deleteDelivery:d-1, deleteSource, deleteDest, putSource, putDest, createDelivery`, now pinned at `packages/cli/src/nodes.test.ts:143-152` : ☑ **PRESERVED** (assertion byte-identical; passes; M1 shows the three sibling guards are still live)
- `packages/core/src/aws/logs.ts:145` `createDelivery` called by the site with no options → the body task 37 pinned, `{ deliverySourceName, deliveryDestinationArn }` with no record-field keys : ☑ **PRESERVED** (`packages/core` 149 passed / 1 skipped; the site's own call site at `packages/cli/src/nodes.ts:785` still passes no options)
- Tasks 48-51's suite → **exactly 129 tests at the parent commit, verified by restoring `@-`'s `nodes.ts` and `nodes.test.ts` and running them**; 162 now, 33 added, **none removed and none renamed** (`comm` over the extracted `it(` names is empty in the removed direction). The test diff removes exactly three lines - `requests.push({`, `});` and `siteState: { resources: {} },` - all inside `makeContext`, and no expected value is edited. The stateful `LogsWorld` branch is entered only when a case passes `logs:`, so every pre-existing case still takes the scripted queue unchanged : ☑ **PRESERVED**

## Integration

- Bookmark `plugin-system-and-analytics` is at **build 52** (`nktqssqt c972d4e5`, task 29); this task is based on build 51 (`qnumvmqu 2ff2cb01`).
- `git merge-tree --write-tree --messages c972d4e5 81bf0fe9` → clean, exit 0, no conflict.
- **Overlap with task 27 checked explicitly.** Both touch `packages/cli/src/nodes.test.ts`, in disjoint regions: task 27 at `:1-17` (imports and the `ctx()` helper) and `:300-306` (a new OIDC test); task 53 at `:35-40` and `:110-120` (inside `deliveryCtx`, in the `cloudfront log delivery self-heal` describe). Task 27 touches `packages/core/src/config.ts` but **not** `deriveNames`, `prefix`, `deliverySource` or `deliveryDestination`, so this task's derived fixture is unaffected. Merge probes: task 27 vs task 53 → clean (`Auto-merging packages/cli/src/nodes.test.ts`, no conflict); task 27 onto build 52, then task 53 → clean. The merged `packages/cli/src/nodes.test.ts` carries both changes with no `FOREIGN` remnant, and the merged CLI tree was **smoke-run**: `vitest run nodes` → 34 passed (33 + task 27's one new test). Workspace restored and sha256-verified afterwards.

## Residue

- **The site's self-heal remains destructive to this plugin's delivery when it runs.** `packages/cli/src/nodes.ts:796-820` still deletes the delivery source. Task 52's guards are confirmed in place and confirmed live over this plugin's **real** derived name (M1, M15): `ownDeliveryIdsOrRefuse` refuses before deleting anything when the shared source carries a foreign delivery, and it refuses on an unattributable one too. So the interaction now stops with nothing removed and an actionable message rather than cascading. Task 16's `blogwright destroy` guard is out of this task's evidence scope and was not re-verified here.
- **The delivery id is not recorded and cannot be** - `CreateDelivery` returns nothing through core's wrapper - so `delete` looks it up by destination via `isPluginDelivery`, not via `findDeliveryIdBySource` (which returns whichever delivery AWS lists first, and on this shared source may well be the site's). Confirmed by reading and by M14.
- **Hand-off to task 61 - the absent `createdDay` is NOT covered by the spec's literal refusal clause.** The write-once design is right and the reasoning for it is right: a bound that moved later would double-insert, a bound that is absent loses nothing. But the reachable state is a *delivery record that exists with no bound* - `read` hydrates `source`, `destination`, `distribution` and `delivery: 'configured'` off AWS and deliberately leaves `createdDay` unset, which is exactly what a lost or re-created state file produces. §Backfill of historical logs says the command "fails with an actionable message naming `blogwright analytics bootstrap` **when the plugin's scoped state carries no delivery record**" - and in this state there *is* a delivery record. The implementer's claim that "the spec already says so" **overstates the spec**. Task 61 must be told explicitly to refuse on an absent `createdDay` as well as on an absent delivery record; implementing §Backfill literally would skip the refusal and then compute "days strictly before `undefined`".
- **Ordering note in `analyticsLogDestinationNode.update` (`:2707-2745`), low severity.** On the format-mismatch branch the destructive half (`clearPluginDeliveries` → `deleteDeliveryDestination`) runs *before* `requireStreamArn` and `requireActiveStream`. If either then throws, the plugin's delivery and destination are gone until the next reconcile. It converges - state still records the stale format, so the next pass re-enters the branch, the deletes are idempotent, and the re-put follows - and the warn already states that records in the gap are lost. `create` resolves both guards first; only `update` does not.
- **Stale line references.** The task contract, this certificate's original P3, and the `Reviewable:` item all cite `packages/cli/src/nodes.ts:713-775` and `packages/cli/src/nodes.test.ts:88-97`. Those line numbers predate task 52's growth of both files; the real locations are `packages/cli/src/nodes.ts:766-834` and `packages/cli/src/nodes.test.ts:140-155`. Cosmetic, and corrected above.
- **Spec observation, no action.** AWS's `PutDeliveryDestination` reference says "If you use this operation to update an existing delivery destination, all the current delivery destination parameters are overwritten with the new parameter values that you specify" - which does not itself confirm the change spec's "the output format is immutable once a destination exists". The implementation is safe either way: it replaces only on a *recorded* mismatch, re-puts idempotently otherwise, and carries a `ConflictException` retry for a stale destination that refuses the put.
- **The `ConflictException` retry belongs on the destination node, and the reading of core is correct.** `packages/core/src/aws/logs.ts:145-160` `createDelivery` catches `err.isAlreadyExists`, and `isAlreadyExists` is `/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i` (`errors.ts:32-34`). A Conflict from `CreateDelivery` is therefore swallowed and can never surface to the delivery node, leaving `putDeliveryDestination` as the only call in this chain a Conflict can reach. Placing the retry on the destination node is right, not an oversight.
- **`isPluginDelivery` filters where task 52's `isOwnDelivery` refuses; the asymmetry is correct.** `ownDeliveryIdsOrRefuse` refuses because both of its callers go on to delete the *source*, which AWS rejects while any delivery is attached - a foreign delivery forecloses what it was about to do. Nothing in this module deletes that source, so a foreign delivery obstructs nothing here and the filter is the whole answer. The two predicates are the same test against names kept distinct by `LOG_DESTINATION_SUFFIX`, so each selects exactly what the other rejects, and the empty-ARN case is fail-closed on both sides.
- **The stateful fake is non-vacuous.** `answerLogs` rejects `DeleteDeliverySource` while any delivery is attached **and** `DeleteDeliveryDestination` while a delivery points at it, both with a `ConflictException` that core's wrappers do not catch (they swallow only not-found). M6 confirms this: dropping the detach in the replace path fails on the fake's refusal, not on a call-log assertion. A void-returning fake would have hidden it.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All six obligations are SATISFIED on collected evidence - two nodes that create the destination in `json` and replace it on a recorded format change, a delivery joined to the site's source with `schema.ts`'s fields, `putDeliverySource`/`deleteDeliverySource` absent from executable code, a write-once `createdDay`, and refusals before any AWS call - with both regression traces PRESERVED, tasks 48-51's 129 tests confirmed unmodified against the parent commit, all six repo gates clean from the workspace root, a clean merge onto build 52 alongside task 27 (smoke-run), and 18 independently-run mutants killed behind three controls, one of which caught a defect in the mutation harness itself; the only outstanding items are a hand-off obligation for task 61 (an absent `createdDay` must be an actionable refusal - the spec's literal clause does not cover it) and a recorded defect in Step 3, whose demand for a `fieldDelimiter` contradicts both the DoD and AWS's own documentation of that field.
