# Done Certificate - Task 52: Guard the shared CloudFront delivery source against cascading deletes

**Task:** [52-cli_shared_delivery_source_guards.md](52-cli_shared_delivery_source_guards.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 52. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

> **Re-validated 2026-08-30 after the integration fix.** This certificate supersedes the
> pre-rebase discharge. Task 52 was built from build 24; task 16 landed at build 26 adding
> call-sequence assertions to `packages/cli/src/commands.test.ts`, and on the merged tree three
> of them failed with `unexpected AWS request in test: POST https://logs.us-east-1.amazonaws.com/`
> because `logDeliveryNode.delete()` now issues a `listDeliveries` as its first action. The
> workspace was rebased onto `0dc38d28` and `commands.test.ts` repaired. **The whole question
> re-opened here is whether that repair bought a green suite by weakening another task's tests.**
> It did not - see O9. Two observations from the earlier discharge (the missing `.filter`, the
> unpinned `?? ''`) were closed by a hardening round and are re-verified below as resolved.

## Definition

DONE(Task 52) ≡ every obligation O1…O9 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion. O9 is added by
this re-validation and covers the integration fix.

## Premises

- **P1 - Goal.** `deliveriesForSource` returns each delivery's destination ARN alongside its id, and on that `logDeliveryNode` refuses to remove a delivery source carrying deliveries it does not own - in `delete()` and in its `ConflictException` retry, which additionally deletes only the site's own delivery - so the analytics delivery survives both `blogwright destroy` and a bootstrap self-heal.
- **P2 - Obligations.** The task is done iff O1…O9 all hold. O1…O7 are one per definition-of-done item in DoD order, O8 is the `Reviewable:` item, O9 is the integration fix.
- **P3 - Invariants.** Must not change behaviour when the site's delivery is the only one on the source: the existing teardown order and the existing self-heal call-order assertions (`nodes.test.ts:88-97,104`) stand unchanged. `findDeliveryIdBySource` keeps its signature and behaviour; this task stops calling it, it does not rewrite it.
- **P4 - Fake fidelity.** Both refusals are unfalsifiable against a fake whose `deleteDeliverySource` returns void whatever the source carries. The validator treats a passing suite over a never-failing fake as NO evidence for O2 or O5.
- **P5 - No test may get weaker.** The fix edits `commands.test.ts`, which belongs to task 16. Any assertion that lost power there is a defect regardless of suite colour. The validator diffs that file against `0dc38d28` and accounts for every removed or changed line before forming any other verdict.

## P4 discharged first - the fake still models AWS after the rebase

Read at `packages/cli/src/nodes.test.ts:86-98`: `deleteDeliverySource` pushes `deleteSource`, then
`if (aws.deliveries.length > 0) throw new AwsError({ code: 'ConflictException', … })`, and only
otherwise sets `sourcePresent = false`. There is no third path. Proved by execution (**M4**:
refusal disabled, scoping kept):

```
FAIL  refuses to delete a delivery source carrying a delivery the site does not own
  Expected: "blogwright analytics destroy staging --yes"
  Received: "logs: ConflictException - Delivery Source still has deliveries attached. (HTTP 400)"
FAIL  refuses the conflict retry rather than unwiring a shared delivery source
  Received: "logs: ConflictException - Delivery Source still has deliveries attached. (HTTP 400)"
```

That trace is the blocking defect reproduced exactly. The foreign delivery is seeded FIRST
(`aws.deliveries = [FOREIGN, own]`), so a position-based guard picks the wrong one.
**P4: DISCHARGED post-rebase.**

## P5 discharged second - `commands.test.ts` did not get weaker

Diffed against `0dc38d28` line by line:

```
$ jj diff --git packages/cli/src/commands.test.ts | grep -c '^-[^-]'   →  2
-        findDeliveryIdBySource: async () => undefined,     (dead stub)
-    // own state object deleted last.                      (comment, continued in place)
```

Every `expect` line compared textually, line numbers stripped:

```
$ diff <(expects @ 0dc38d28) <(expects @ working copy)
42a43  >     expect(
51a53  >     expect(calls).toContain(`logsUsEast1.deleteDelivery ${OWN_DELIVERY_ID}`);
65a68  >     expect(calls).toContain('logsUsEast1.deliveriesForSource');
65a69  >     expect(calls).toContain(`logsUsEast1.deleteDelivery ${OWN_DELIVERY_ID}`);
```

67 → 71 expects: **four added, zero removed, zero changed.** The implementer's claim is verified
verbatim. **P5: DISCHARGED - no assertion in task 16's file lost power.**

The removed stub makes the fixture *stricter*, not looser. `test-support.ts:68-82`: overrides are
layered with `Object.assign(Object.create(base), overrides)` over a real `LogsClient` built on
`rejectAllTransport`, which throws `unexpected AWS request in test: <method> <url> - override the
client method on createTestContext`. With `findDeliveryIdBySource` no longer stubbed, any caller
now fails fast at that transport instead of silently receiving `undefined`. That is the same
mechanism that surfaced the integration defect in the first place.

The fixture's own delivery ARN is **derived, not literal**: `commands.test.ts:398` declares
`let ownDestinationArn = ''`, and `:476` - *after* `createTestContext` returns - assigns
``` `arn:…:delivery-destination:${ctx.names.deliveryDestination}` ```. Proved behaviourally by
**M2** (`isOwnDelivery` → `false`), whose refusal printed the per-environment derived names:

```
delivery source production-example-cf-source still carries a delivery this site does not own
  (site-own-delivery (destination arn:…:delivery-destination:production-example-cf-dest));
  … blogwright analytics destroy production --yes
delivery source preview-example-cf-source … preview-example-cf-dest …
  … blogwright analytics destroy preview --yes
```

Different names per environment ⇒ the comparison is real, not a tautology, and not bypassed by an
empty list. It also re-confirms the CORRECTED remedy interpolates `ctx.env`.

## Obligations

- **O1 - The client can express "the site's own delivery".**
  - *Claim:* `deliveriesForSource` returns each matching delivery's `id` together with its `deliveryDestinationArn`.
  - *Evidence collected:* `packages/core/src/aws/logs.ts:30-40` (`DeliverySummary`), `:179-199` (widened return; response type carries `deliveryDestinationArn?`; the source-name filter maps to pairs). `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose` from `packages/core` - **14/14 pass**, including the paginated case that keeps `site` + `analytics` across two pages and drops `elsewhere` (another source).
  - *Checks:* the guards read this list only (`nodes.ts:745`); `grep -rn "findDeliveryIdBySource"` shows the definition plus its own two tests, no production caller; `findDeliveryIdBySource`'s two pre-existing tests still pass unedited. The CLI issues no raw AWS call - every touch goes through `ctx.clients.logsUsEast1.*` (DEVELOPMENT.md §Where validation lives).
  - *Mutation evidence:* **M6** (source-name filter removed) and **M7** (pagination stopped after page 1) each kill the mapped-shape test. **M5** (`?? ''` → `?? 'MUTANT'`) kills the new fallback test - the gap the earlier discharge recorded as Observation 2 is **CLOSED**.
  - *Status:* ☑ SATISFIED
- **O2 - A shared source is never deleted.**
  - *Claim:* `delete()` raises before issuing any delete, naming the foreign delivery and `blogwright analytics destroy <env>`.
  - *Evidence collected:* `nodes.ts:829` - `delete()`'s first statement is `await ownDeliveryIdsOrRefuse(ctx)`; the refusal at `:750-758` throws before the delete loop. Test asserts `expect(calls).toEqual(['listDeliveries', 'listDeliveries'])` - the delete log is EMPTY, not merely free of `deleteSource` - plus `aws.sourcePresent === true`, `aws.destinationPresent === true`, `aws.deliveries` still `['analytics-d', 'd-1']`.
  - *Checks:* refuse-before-delete is pinned by a `calls` assertion, not by a message. **M4** (refusal disabled) fails it with the fake's own ConflictException.
  - *Status:* ☑ SATISFIED
- **O3 - The unshared teardown is unchanged.**
  - *Claim:* with no foreign delivery, `delete()` still removes delivery → source → destination.
  - *Evidence collected:* the NEW `delete()`-path assertion at `nodes.test.ts:170-176`: `expect(calls).toEqual(['listDeliveries', 'deleteDelivery:d-1', 'deleteSource', 'deleteDest'])`, plus final state `deliveries []`, `sourcePresent false`, `destinationPresent false`. Reached through `node(ctx).delete(ctx)`; its first call is `listDeliveries`, which no `create()` path emits first.
  - *Checks:* falsifiable - **M8** (destination torn down first) kills it.
  - *Status:* ☑ SATISFIED
- **O4 - The retry deletes exactly one delivery.**
  - *Claim:* the retry deletes only the site's own delivery id, identified by the one named predicate matching `deliveryDestinationArn` against `ctx.names.deliveryDestination`, not by position and not from state.
  - *Evidence collected:* `nodes.ts:730-732` - `isOwnDelivery(delivery, destinationName)` compares `delivery.deliveryDestinationArn.split(':').pop()` to the destination name. `grep -n "isOwnDelivery" packages/cli/src/nodes.ts` → the definition at `:730` and **two** uses, both inside `ownDeliveryIdsOrRefuse` (`:746` reject-filter, `:763` keep-filter): one predicate, one helper, and that helper is the single call site both guards share (`:811`, `:829`).
  - *Checks:* not `findDeliveryIdBySource` (no caller remains). Not a state output - `ownDeliveryIdsOrRefuse` reads only `ctx.clients`, `ctx.names` and `ctx.env`; no `output(` appears in it, so the empty `destination` output at `nodes.ts:775` is never consulted. Not by position - the foreign delivery is seeded first and the `delete()` refusal test asserts `/analytics-d/`.
  - *Structural claim judged:* `ownDeliveryIdsOrRefuse` now returns `deliveries.filter(isOwnDelivery…).map(d => d.id)`. The earlier discharge's Observation 1 (`.map` over the whole list, correct only via the non-local `throw` above) is **CLOSED** - the safety invariant is local to the return statement. The `.filter` survived the rebase and is present at `nodes.ts:763`.
  - *Status:* ☑ SATISFIED
- **O5 - The retry never removes the shared source either.**
  - *Claim:* with a foreign delivery present, the retry refuses before any delete, with the same message, and both guards call one predicate.
  - *Evidence collected:* `nodes.ts:803-816` - `deleteDeliverySource` at `:815` is unreachable while a foreign delivery is listed, because `ownDeliveryIdsOrRefuse` throws first. Test asserts `expect(calls).toEqual(['putSource', 'listDeliveries'])` - empty delete log - with `aws.sourcePresent === true` and both deliveries intact. Ran against the P4-compliant fake.
  - *Checks:* the "scoped the delivery deletion but left `deleteDeliverySource` unconditional" defect is excluded by **M4**. The refusal is a stop, not a fallback: nothing follows the `throw`, and `create()` propagates it.
  - *Status:* ☑ SATISFIED
- **O6 - Existing self-heal preserved.**
  - *Claim:* the two call-order assertions at `nodes.test.ts:88-97,104` pass with no edit to any expected sequence.
  - *Evidence collected:* both `it` blocks extracted from `0dc38d28` and from the working copy and compared byte-for-byte - **identical MD5s** (`a9e9c54c…` for `removes the stale delivery trio and retries on ConflictException`, `c2472426…` for `wires straight through when there is no conflict`). `jj diff --git packages/cli/src/nodes.test.ts | grep -c '^-[^-]'` → **3**, and those three are the `deliveryCtx` signature, the `deliveriesForSource` fake at `:63`, and the `return { ctx, calls }` line. **No assertion line removed or altered.**
  - *Status:* ☑ SATISFIED
- **O7 - Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done.
  - *Evidence collected:* all six gates run from the workspace root, in `.github/workflows/ci.yml` order, each exit 0:
    - `pnpm build` → PASS (exit 0)
    - `pnpm typecheck` → PASS, all five packages (exit 0)
    - `pnpm test` → PASS (exit 0): core 143 + 1 skipped, build-agent 27, pds 100, analytics 90, cli 304 - **664 passed, 1 skipped**
    - `pnpm lint` → exit 0, **29 warnings, 0 errors, all 29 `no-shadow`**, all in `nodes.test.ts`
    - `pnpm exec oxfmt --check .` → "All matched files use the correct format", 148 files (exit 0)
    - `pnpm knip` → exit 0, no output
  - *Checks:* `.changeset/shared-delivery-source-guards.md` records that `destroy` can now fail early where it previously threw a Conflict part-way through teardown, and names the environment-scoped remedy. `blogwright-core` minor is correct for widening `deliveriesForSource`'s public return type on a 0.x package (0.3.3).
  - *Lint judgement:* 25 → 29. The four new warnings are at `nodes.test.ts:171,180,196,204` - exactly the four `const { ctx, calls, aws } = deliveryCtx(…)` destructures in the four new tests, matching all 25 pre-existing warnings in the same file verbatim in shape. `.oxlintrc.json` sets no `no-shadow` rule, so it arrives at warning severity from a category default and does not gate. **Consistency was the right call**: renaming `ctx` in only the four new tests would leave the file inconsistent with 25 siblings for no behavioural gain, and would not reduce the warning class.
  - *Status:* ☑ SATISFIED
- **O8 - Reviewable.**
  - *Claim:* a reviewer can confirm the guards directly.
  - *Evidence collected:* both `Reviewable:` commands run as written - `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` from the workspace root (**33/33**) and `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose` from `packages/core` (**14/14**).
  - *Checks:* both foreign-delivery cases fail loudly with an empty delete log rather than cascading; the widened `deliveriesForSource` still filters by source name (`elsewhere` is dropped, and **M6** proves the filter is load-bearing); no pre-existing log-delivery assertion was edited (O6, P5).
  - *Status:* ☑ SATISFIED
- **O9 - The integration fix (added by this re-validation).**
  - *Claim:* the three tests task 16 owns in `commands.test.ts` still assert what they existed for, and no other task's coverage was traded for a green suite.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run commands --reporter=verbose` - **56/56 pass**, including all three previously-failing tests. P5 above accounts for every removed and changed line. Per test:
    - **`destroy > proceeds exactly as before the guard…`** - the added projection at `:532-543` is **ordered**: `calls.filter(/^logsUsEast1\.(deliveriesForSource|deleteDelivery)/)` (the `deleteDelivery` alternative is a prefix, so it also captures `deleteDeliverySource` and `deleteDeliveryDestination`) compared with `toEqual` against the four-element sequence. **M1c** (source deleted before the ownership read) and **M8** (destination first) each kill it, in both cases with the same four elements in a different order - so the assertion genuinely tests order, not membership. It is also the *only* test that catches M1c. Task 16's own property (`calls[0]` is the guard's listing, `calls.at(-1)` the state delete, 11 nodes) is untouched.
    - **`destroy > treats an already-deleted bucket as no scoped state…`** - `calls[0]`, `calls.at(-1)` and `rejects.toThrow('NoSuchBucket')` are byte-identical to `0dc38d28`; the only change is one added `toContain` and its comment. The implementer's account is confirmed: the pre-existing comment claims "the eight non-bucket resources" while listing only seven `toContain`s - the eighth was the delivery, unassertable because the old fixture answered `findDeliveryIdBySource` with `undefined` so `if (deliveryId)` was false and no delete ever fired. This test is now **stronger** than task 16 left it.
    - **`previewTeardown > adds exactly one listObjects at the head…`** - the disclosure is **accurate and the judgement is sound**. The equality `expect(calls).toEqual(['s3.listObjects…', ...baseline.calls])` is differential: it compares the guarded verb against an unguarded run of the same body, so calls added inside a node grow both sides alike. That is the correct semantics for the property it names ("exactly one `listObjects` at the head and nothing else"), which is therefore **preserved, not weakened**. It is genuinely blind to the read vanishing, and the two added lines close exactly that: under **M1** the equality passed and the failure was `commands.test.ts:705` (`toContain deleteDelivery`); under **M1b** (read removed entirely) the failure was `:704` (`toContain deliveriesForSource`). Both added lines are load-bearing and neither is redundant. Order on this path is covered by the sibling `destroy` projection over the same single code path.
  - *Checks:* whole-suite regression - `pnpm test` 664 passed / 1 skipped across all five packages; no test outside this task's own files changed.
  - *Status:* ☑ SATISFIED

## Mutation ledger

Every mutation applied one at a time to the workspace source and restored before the next.

| # | Mutation | Result |
|---|---|---|
| M1 | `ownDeliveryIdsOrRefuse(ctx)`'s result replaced by `[]` in `delete()` (read kept) | KILLED - **all three** repaired `commands.test.ts` tests; previewTeardown failed at `:705`, the equality passing |
| M1b | The ownership read dropped from `delete()` entirely | KILLED - all three; previewTeardown failed at `:704`, proving that line is what notices a vanished read |
| M1c | `deleteDeliverySource` moved *before* the ownership read | KILLED - `destroy > proceeds exactly as before the guard…`, and only that test. The ordered projection is the sole assertion that catches a reorder |
| M2 | `isOwnDelivery` → `false` | KILLED - all three, with the refusal naming the **derived** `production-example-cf-dest` / `preview-example-cf-dest` and the env-correct remedy |
| M3 | `isOwnDelivery` treats an empty ARN as own | KILLED - `nodes.test.ts > refuses when a delivery carries no destination ARN…` ONLY. `logs` suite 14/14 green, `commands` 56/56 green |
| M4 | Refusal in `ownDeliveryIdsOrRefuse` disabled (scoping kept) | KILLED - the three `nodes.test.ts` refusal tests, each by the fake's own `ConflictException` (P4) |
| M5 | `deliveryDestinationArn ?? ''` → `?? 'MUTANT'` | KILLED - `logs.test.ts > falls back to an empty destination ARN…` ONLY. `nodes` 33/33 green, `commands` 56/56 green |
| M6 | Source-name filter removed from `deliveriesForSource` | KILLED - mapped-shape test |
| M7 | Pagination stopped after page 1 | KILLED - mapped-shape test |
| M8 | Teardown reordered (destination first) | KILLED - `nodes.test.ts` teardown test AND the `commands.test.ts` projection |
| M9 | `${ctx.env}` dropped from the remedy string | KILLED - both `nodes.test.ts` refusal tests naming `staging` |
| M10 | `.filter(isOwnDelivery…)` in the return replaced by `.map` | **SURVIVED** - equivalent mutant by construction; see Observation 1 |

**M5 vs M3 - the disclosed reading, verified.** These fire disjoint tests, and the implementer's
explanation is correct: the two concerns live at different layers. `logs.ts`'s `??` decides the
*value* produced when `DescribeDeliveries` omits the field (pinned in `logs.test.ts` against a real
transport); `isOwnDelivery` decides how that value is *classified* (pinned in `nodes.test.ts`,
whose fixture substitutes at the `ctx.clients.logsUsEast1` port and therefore never executes
`logs.ts`'s `??` at all). No single test could cover both without crossing that seam. The pair is
non-redundant; this corrected the brief's own expectation and the correction stands.

**Falsifiability walk - all 10 `it` blocks added or touched, judged individually, not tabulated:**

| `it` | Falsifiable by | Verdict |
|---|---|---|
| `nodes.test.ts` · tears down delivery, then source, then destination… | M8 | ☑ |
| `nodes.test.ts` · refuses to delete a delivery source carrying a delivery the site does not own | M4, M9 | ☑ |
| `nodes.test.ts` · refuses when a delivery carries no destination ARN… | M3, M4 | ☑ |
| `nodes.test.ts` · refuses the conflict retry rather than unwiring a shared delivery source | M4, M9 | ☑ |
| `logs.test.ts` · pages DescribeDeliveries and pairs each id with its destination ARN | M6, M7 | ☑ |
| `logs.test.ts` · returns an empty list when the source carries nothing | (boundary only) | ☑ low power - see Observation 2 |
| `logs.test.ts` · falls back to an empty destination ARN… | M5 | ☑ |
| `commands.test.ts` · destroy > proceeds exactly as before the guard… | M1, M1b, M1c, M2, M8 | ☑ strongest of the three |
| `commands.test.ts` · destroy > treats an already-deleted bucket… | M1, M1b, M2 | ☑ |
| `commands.test.ts` · previewTeardown > adds exactly one listObjects at the head… | M1 (`:705`), M1b (`:704`), M2 | ☑ |

10/10 falsifiable. One (the empty-list boundary case) is low-power rather than unfalsifiable, and
matches the power of its pre-existing sibling `findDeliveryIdBySource > returns undefined when
nothing matches`. **No sweep claim in this ledger is taken from the implementer's report; each row
was executed by this gate.**

**Restore proof:** after the last mutation, `md5 -q packages/cli/src/nodes.ts
packages/core/src/aws/logs.ts` → `b55188f3f38eb4069171147dd3c7c003` /
`0f479ccf839696d45d9adc17a203e265`, identical to the pre-mutation snapshot;
`grep -rn "MUTANT\|false && foreign\|true || d.deliverySourceName\|void delivery" packages/*/src`
→ no matches; `jj diff --stat` is byte-identical to the diff as first read (10 / 55 / 100 / 72 /
78 / 30; **326 insertions, 19 deletions across 6 files**); and the full `pnpm test` is green.

## Regression checks

- `packages/cli/src/nodes.ts:745` is the only production caller of `deliveriesForSource` : ☑ PRESERVED
- `packages/core/src/aws/logs.test.ts` is **purely additive** - `grep -c '^-[^-]'` → **0** : ☑ PRESERVED
- `packages/cli/src/nodes.test.ts` - 3 removed lines, none an assertion; both pre-existing sequences MD5-identical to `0dc38d28` : ☑ PRESERVED
- `packages/cli/src/commands.test.ts` - 2 removed lines, neither an assertion; all 67 pre-existing `expect` lines textually identical; 4 added : ☑ PRESERVED
- `findDeliveryIdBySource` unchanged, its two tests green : ☑ PRESERVED
- `logDeliveryNode.create()`'s happy path still wires source → destination → delivery : ☑ PRESERVED
- `blogwright bootstrap` with no analytics plugin behaves as today - the single-delivery retry sequence is unedited and green : ☑ PRESERVED
- `blogwright destroy` with no analytics plugin still tears down the trio, now proved by a `delete()`-path call-order assertion that did not exist before : ☑ PRESERVED
- `destroyGraph` (`packages/cli/src/graph.ts:107`) tears down in `topoSort(nodes).reverse()` order and nothing declares `dependsOn: ['cloudfront-log-delivery']`, so the log-delivery node is deleted early - before `cloudfront-distribution`. The refusal genuinely lands with nothing removed, and it aborts the loop (no `catch` around `node.delete(ctx)`). Re-checked post-rebase : ☑ PRESERVED
- Whole-suite: 664 passed / 1 skipped across all five packages; no test outside task 52's own files changed : ☑ PRESERVED

## Observations (non-blocking; none gates the merge)

1. **`nodes.ts:763`** - the `.filter(isOwnDelivery…)` before `.map(d => d.id)` is unreachable while the `throw` above stands, so **M10** (revert to `.map` over the whole list) survives the full suite. This is an *equivalent mutant by construction*, not a coverage gap, and the code comment says so in as many words ("the throw above already guarantees … but that is a non-local guarantee"). Keeping it is right: it makes the name and the body agree locally, so softening the refusal cannot silently start feeding foreign ids to the delete loop. Recorded so a future reader is not surprised that no test dies without it.
2. **`logs.test.ts` · `returns an empty list when the source carries nothing`** - a boundary case with low mutation power: an implementation returning `[]` for an empty response is hard to break without breaking its siblings first. Not vacuous (a throw-on-empty or placeholder-row implementation dies), and it matches the power of the pre-existing `findDeliveryIdBySource` sibling. No action.
3. **`nodes.test.ts:189`** - `expect(calls).not.toContain('deleteDelivery:analytics-d')` is subsumed by the `toEqual` on the next line. Redundant, not unfalsifiable; the comment above explains the intent.
4. **`aws.sourcePresent` / `aws.destinationPresent` in the refusal tests** are weak signals in isolation - the fake's `deleteDeliverySource` throws *before* clearing `sourcePresent`, so those flags stay `true` under M4 too. The `calls` `toEqual` carries the real weight in every one of those tests, and it does so correctly. No action.
5. **`isOwnDelivery` compares only the ARN's final segment**, not account or region. A same-named destination in another account would read as own - but a delivery attached to *this* source is necessarily in this account, and matching the final segment is what the task contract prescribes ("Match on the name the ARN carries in its final segment"). Per spec.
6. **`findDeliveryIdBySource` now has no production caller**; its only consumers are its own two tests. That is exactly what the contract required ("unchanged by this task") and P3 makes it an invariant. `pnpm knip` is clean, but knip v6 has no class-member issue type, so its silence is not evidence of a consumer - already recorded as an open question in plan.md. Follow-up, out of scope for 52.
7. **plan.md's recorded resolution reads "updating the expected sequences to grow by the new call".** The implementer did not do that - no expected sequence in `commands.test.ts` was edited at all; the repair added a new ordered projection and removed a dead stub. That is *stricter* than the recorded resolution, and it is the outcome P5 wanted. Worth correcting in plan.md's open-questions entry so the lesson recorded there matches what was actually shipped.

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☑ DONE
- **Gaps:** none. O1–O9 all SATISFIED, all ten regression checks PRESERVED, P4 and P5 both
  discharged by execution before any other verdict was formed. The integration fix strengthened
  task 16's file rather than weakening it: two tests gained assertions and one gained an ordered
  projection that is the only thing in the suite catching a reordered teardown. The two
  observations that gated the earlier discharge (the non-local `.map`, the unpinned `?? ''`) are
  both closed. The seven observations above are non-blocking: one is an equivalent mutant recorded
  for clarity (1), three are test-power notes (2, 3, 4), two concern behaviour the contract
  prescribes or defers (5, 6), and one is a documentation correction owed to plan.md (7).
