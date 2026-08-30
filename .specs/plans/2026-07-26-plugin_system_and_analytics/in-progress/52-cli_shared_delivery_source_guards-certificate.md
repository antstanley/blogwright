# Done Certificate - Task 52: Guard the shared CloudFront delivery source against cascading deletes

**Task:** [52-cli_shared_delivery_source_guards.md](52-cli_shared_delivery_source_guards.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 52. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 52) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `deliveriesForSource` returns each delivery's destination ARN alongside its id, and on that `logDeliveryNode` refuses to remove a delivery source carrying deliveries it does not own - in `delete()` and in its `ConflictException` retry, which additionally deletes only the site's own delivery - so the analytics delivery survives both `blogwright destroy` and a bootstrap self-heal.
- **P2 - Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 - Invariants.** Must not change behaviour when the site's delivery is the only one on the source: the existing teardown order (`nodes.ts:763-775`) and the existing self-heal call-order assertions (`nodes.test.ts:88-97,104`) stand unchanged. `findDeliveryIdBySource` (`logs.ts:124-136`) keeps its signature and behaviour; this task stops calling it, it does not rewrite it.
- **P4 - Fake fidelity.** Both refusals are unfalsifiable against the recording fake as it stands: `deleteDeliverySource` at `nodes.test.ts:67-69` returns void whatever the source carries, so an implementation that still deletes a shared source passes every assertion about which delivery ids were deleted. The validator treats a passing suite over a never-failing fake as NO evidence for O2 or O5.

## P4 discharged first - the fake now models AWS

Read at `packages/cli/src/nodes.test.ts:86-98`: `deleteDeliverySource` pushes `deleteSource`, then
`if (aws.deliveries.length > 0) throw new AwsError({ code: 'ConflictException', … })`, and only
otherwise sets `sourcePresent = false`. There is no third path - it cannot return void while a
delivery remains. Proved by execution, not by reading (mutation **M1**: refusal removed from
`ownDeliveryIdsOrRefuse`, scoping kept):

```
FAIL  refuses to delete a delivery source carrying a delivery the site does not own
  Expected: "blogwright analytics destroy staging --yes"
  Received: "logs: ConflictException - Delivery Source still has deliveries attached. (HTTP 400)"
FAIL  refuses the conflict retry rather than unwiring a shared delivery source
  Received: "logs: ConflictException - Delivery Source still has deliveries attached. (HTTP 400)"
```

The failure is the fake's own Conflict, not a silent pass - and the trace is the blocking defect
reproduced exactly: the retry deleted the site's own `d-1`, then blew up on the shared source.
The foreign delivery is seeded FIRST (`nodes.test.ts:108-110`, `aws.deliveries = [FOREIGN, own]`),
so a position-based guard picks the wrong one. **P4: DISCHARGED - every other verdict below rests
on it and it holds.**

## Obligations

- **O1 - The client can express "the site's own delivery".**
  - *Claim:* `deliveriesForSource` returns each matching delivery's `id` together with its `deliveryDestinationArn`.
  - *Evidence collected:* `packages/core/src/aws/logs.ts:37-40` (`DeliverySummary`), `:179-197` (widened return, response type carries `deliveryDestinationArn?`, filter maps to pairs). `pnpm --filter blogwright-core exec vitest run logs` - 13/13 pass, including the new paginated case that keeps `site` + `analytics` and drops `elsewhere` (another source).
  - *Checks:* the guards read this list only (`nodes.ts:745`); `grep -rn "findDeliveryIdBySource" packages/` shows the definition and its own two tests, no production caller; the CLI issues no raw `send`/`call` - every AWS touch goes through `ctx.clients.logsUsEast1.*`.
  - *Mutation evidence:* **M7** (source-name filter removed) and **M8** (pagination dropped) each fail the new mapped-shape test; **M9** (throw instead of empty list) fails the empty-list test. Both new `it`s are falsifiable.
  - *Status:* ☑ SATISFIED
- **O2 - A shared source is never deleted.**
  - *Claim:* `delete()` raises before issuing any delete, naming the foreign delivery and `blogwright analytics destroy <env>`.
  - *Evidence collected:* `nodes.ts:818-828` - `delete()`'s first statement is `await ownDeliveryIdsOrRefuse(ctx)`; the refusal at `:750-758` throws before the delete loop. Test asserts `expect(calls).toEqual(['listDeliveries', 'listDeliveries'])` - the delete log is EMPTY, not merely free of `deleteSource` - plus `aws.sourcePresent === true`, `aws.destinationPresent === true`, `aws.deliveries` still `['analytics-d', 'd-1']`.
  - *Checks:* **M2** moved the refusal to AFTER deleting the site's own deliveries, keeping the identical message. Both message assertions still passed; the test failed on the `calls` list (`+ "deleteDelivery:d-1"`). The before/after ordering is pinned by a `calls` assertion, exactly as the check requires.
  - *Status:* ☑ SATISFIED
- **O3 - The unshared teardown is unchanged.**
  - *Claim:* with no foreign delivery, `delete()` still removes delivery → source → destination.
  - *Evidence collected:* the NEW `delete()`-path assertion at `nodes.test.ts:158-165`: `expect(calls).toEqual(['listDeliveries', 'deleteDelivery:d-1', 'deleteSource', 'deleteDest'])`, plus final state `deliveries []`, `sourcePresent false`, `destinationPresent false`.
  - *Checks:* this is a `delete()` sequence, not one of the two `create()` ones - it is reached through `node(ctx).delete(ctx)` and its first call is `listDeliveries`, which no `create()` path emits first. Falsifiable: killed by **M3** (predicate compared against `names.deliverySource`) and by **M10** (fake stops clearing `destinationPresent` - `expected true to be false`).
  - *Status:* ☑ SATISFIED
- **O4 - The retry deletes exactly one delivery.**
  - *Claim:* the retry deletes only the site's own delivery id, identified by the one named predicate matching `deliveryDestinationArn` against `ctx.names.deliveryDestination`, not by position.
  - *Evidence collected:* `nodes.ts:730-732` - `isOwnDelivery(delivery, destinationName)` compares `delivery.deliveryDestinationArn.split(':').pop()` to the destination name; the sole call site is `nodes.ts:746`, shared by both guards (`grep -n "isOwnDelivery" packages/cli/src/nodes.ts` → definition at `:730` and one use at `:746`). The retry test's delete log is empty and `analytics-d` appears in no delete call.
  - *Checks:* not `findDeliveryIdBySource` (no caller remains). Not a state output - `ownDeliveryIdsOrRefuse` reads only `ctx.clients`, `ctx.names` and `ctx.env`; `grep "output("` inside it returns nothing, so the empty `destination` output at `nodes.ts:731` is never consulted. Not by position - **M4** (treat `deliveries[0]` as own) fails the `delete()` refusal test on `/analytics-d/`, because the foreign delivery is seeded first. **M3** (compare against `names.deliverySource`) fails both the pre-existing self-heal test and the new teardown test.
  - *Structural claim judged:* the helper returns `deliveries.map(d => d.id)` only after `foreign.length === 0`, i.e. only when every listed delivery satisfies `isOwnDelivery`. The returned set is therefore extensionally the own set, and no fixture can reach "retry deletes a foreign id". The claim is genuine; **no further test is owed.** See Observation 1 for the non-local shape of that guarantee.
  - *Status:* ☑ SATISFIED
- **O5 - The retry never removes the shared source either.**
  - *Claim:* with a foreign delivery present, the retry refuses before any delete, with the same message, and both guards call one predicate.
  - *Evidence collected:* `nodes.ts:800-812` - `deleteDeliverySource` at `:814` is unreachable while a foreign delivery is listed, because `ownDeliveryIdsOrRefuse` throws at `:750` first. Test asserts `expect(calls).toEqual(['putSource', 'listDeliveries'])` - empty delete log - and `aws.sourcePresent === true` with both deliveries intact. Ran against the P4-compliant fake.
  - *Checks:* the "scoped the delivery deletion but left `deleteDeliverySource` unconditional" defect is excluded by **M1**: with the refusal stripped but the scoping kept, both tests fail with the fake's ConflictException - the exact shape earlier reviews missed. The refusal is a stop, not a fallback: nothing follows the `throw`, and `create()` propagates it. One predicate, one definition, greppable.
  - *Status:* ☑ SATISFIED
- **O6 - Existing self-heal preserved.**
  - *Claim:* the call-order assertions at `nodes.test.ts:88-97,104` pass with no edit to any expected sequence.
  - *Evidence collected:* `jj diff --git packages/cli/src/nodes.test.ts | grep -c "^-[^-]"` → **3**, and those three lines are the `deliveryCtx` signature, the `deliveriesForSource` fake at `:63`, and the `return { ctx, calls }` line. No assertion line is removed or altered. The implementer's claim is verified verbatim.
  - *Checks:* unchanged means not edited. Both sequences pass unmodified; `removes the stale delivery trio and retries on ConflictException` still expects `['putSource','listDeliveries','deleteDelivery:d-1','deleteSource','deleteDest','putSource','putDest','createDelivery']` and is falsifiable (killed by **M3**).
  - *Status:* ☑ SATISFIED
- **O7 - Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done.
  - *Evidence collected:* all six CI gates run from the workspace root, in `.github/workflows/ci.yml` order:
    - `pnpm build` → PASS
    - `pnpm typecheck` → PASS (all five packages)
    - `pnpm test` → PASS (core 142+1 skipped, build-agent 27, pds 100, analytics 62, cli 273)
    - `pnpm lint` → exit 0, 28 warnings, all `no-shadow` on `ctx`, all in `nodes.test.ts`
    - `pnpm exec oxfmt --check .` → "All matched files use the correct format", 146 files
    - `pnpm knip` → exit 0, no output
  - *Checks:* `.changeset/shared-delivery-source-guards.md` records that `destroy` can now fail early where it previously threw a Conflict part-way through teardown, and names the environment-scoped remedy. Bump levels (`blogwright-core`/`blogwright` minor) match `logs-delivery-output-format.md` at 0.3.3.
  - *Status:* ☑ SATISFIED
- **O8 - Reviewable.**
  - *Claim:* a reviewer can confirm the guards directly.
  - *Evidence collected:* both `Reviewable:` commands run as written - `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` from the workspace root (32/32) and `pnpm --filter blogwright-core exec vitest run logs --reporter=verbose` from `packages/core` (13/13).
  - *Checks:* both foreign-delivery cases fail loudly with an empty delete log rather than cascading; the widened `deliveriesForSource` still filters by source name (the `elsewhere` entry is dropped, and **M7** proves the filter is load-bearing); no pre-existing log-delivery assertion was edited (O6).
  - *Status:* ☑ SATISFIED

## Mutation ledger

Every mutation applied one at a time, restored from a SHA-256 baseline snapshot after each.

| # | Mutation | Result |
|---|---|---|
| M1 | Refusal removed from `ownDeliveryIdsOrRefuse`, scoping kept | KILLED - both refusal tests, by the fake's `ConflictException` (P4) |
| M2 | Refusal moved after deleting the site's own deliveries | KILLED - both, on the `calls` list; messages still passed |
| M3 | Predicate compared against `names.deliverySource` | KILLED - pre-existing self-heal test + new teardown test |
| M4 | Position-based ownership (`deliveries[0]` is own) | KILLED - `delete()` refusal test, on `/analytics-d/` |
| M5 | `${ctx.env}` dropped from the remedy | KILLED - both refusal tests |
| M6 | `deliveryDestinationArn ?? ''` → `?? 'MUTANT'` | **SURVIVED the full 604-test suite** - see Observation 2 |
| M7 | Source-name filter removed from `deliveriesForSource` | KILLED - mapped-shape test |
| M8 | Pagination dropped | KILLED - mapped-shape test |
| M9 | Throw instead of returning an empty list | KILLED - empty-list test |
| M10 | Fake stops clearing `destinationPresent` | KILLED - teardown test's state assertions are load-bearing |
| M11 | `wire()` skips `createDelivery` | KILLED - `wires straight through` |
| M12 | Retry catch widened from `/Conflict/i` to any `AwsError` | SURVIVED - pre-existing test, see Observation 4 |
| M13 | Non-conflict errors swallowed instead of rethrown | KILLED - `rethrows non-conflict errors untouched` |

Falsifiability sweep covered all 8 `it` blocks added or touched by this diff (3 new in
`nodes.test.ts`, 2 new in `logs.test.ts`, 3 pre-existing in the same `describe` whose fake changed
underneath them). 8/8 are falsifiable; none is an assertion that cannot fail.

**Restore proof:** `shasum -a 256 -c` on all four touched source files matches the pre-mutation
baseline, and `jj diff --stat` is byte-identical to the diff as first read (10 / 79 / 68 / 56 / 30;
226 insertions, 17 deletions across 5 files).

## Regression checks

- `packages/cli/src/nodes.ts:745` is now the only production caller of `deliveriesForSource`; `grep -rn "deliveriesForSource" packages/` shows the client, that call site, the two `logs.test.ts` cases and the CLI fake only : ☑ PRESERVED
- The pre-existing `LogsClient` describes still pass unedited - `jj diff --git packages/core/src/aws/logs.test.ts | grep -c "^-[^-]"` → **0**, purely additive : ☑ PRESERVED
- `logDeliveryNode.create()`'s happy path still wires source → destination → delivery (`wires straight through when there is no conflict`, and the us-east-1 routing test at `nodes.test.ts:652-658`) : ☑ PRESERVED
- `blogwright bootstrap` with no analytics plugin behaves exactly as today: the single-delivery retry sequence is unedited and green (O6) : ☑ PRESERVED
- `blogwright destroy` with no analytics plugin still tears down the trio, now proved by a `delete()`-path call-order assertion that did not exist before (O3) : ☑ PRESERVED
- **Added:** `destroyGraph` (`packages/cli/src/graph.ts:102-116`) tears down in `topoSort(nodes).reverse()` order, and nothing declares `dependsOn: ['cloudfront-log-delivery']`, so the log-delivery node is deleted early - before `cloudfront-distribution`. The refusal therefore genuinely lands with nothing removed, and it aborts the loop (no `catch` around `node.delete(ctx)`), leaving the node's state entry intact. The changeset's "it fails early, with nothing removed" is accurate : ☑ PRESERVED

## Observations (non-blocking; none gates the merge)

1. **`nodes.ts:761`** - `ownDeliveryIdsOrRefuse` returns `deliveries.map(d => d.id)`, i.e. ALL listed ids, not the filtered own ids. It is correct today only because the `throw` above guarantees `foreign.length === 0`. The name promises "own ids"; the body returns "all ids", so the guarantee is non-local: softening the refusal to a warning would silently hand foreign ids to the delete loop. One-token hardening: `deliveries.filter((d) => isOwnDelivery(d, ctx.names.deliveryDestination)).map((d) => d.id)`. Behaviour-neutral today.
2. **`logs.ts:191`** - the `?? ''` fallback for an absent `deliveryDestinationArn` is pinned by nothing: M6 changed it to `'MUTANT'` and the entire 604-test suite stayed green. The direction is safe and fail-closed (`''` → `''.split(':').pop() === ''` ≠ the destination name → classified foreign → refuse), and `DescribeDeliveries` always returns the field in practice, so this is coverage, not behaviour. The DoD's "asserts the mapped shape" is met for the present-ARN case.
3. **`nodes.test.ts:189`** - `expect(calls).not.toContain('deleteDelivery:analytics-d')` is strictly subsumed by the `toEqual` on the next line. Redundant, not unfalsifiable; the comment above it explains the intent.
4. **`nodes.test.ts:141-155`** (pre-existing, not added or edited by this task) - `rethrows non-conflict errors untouched` survives M12, widening the catch from `/Conflict/i` to every `AwsError`: the stubbed `putDeliverySource` throws `AccessDenied` on every call, so the retry runs to completion and re-throws the same error, and the message assertion still passes. The test pins the error but not the "untouched" half of its name (no call-log assertion). It is falsifiable (M13 kills it). Pre-existing gap, unchanged in kind by this task.
5. **`findDeliveryIdBySource`** now has no production caller; its only consumers are its own two tests. Leaving it is what the contract explicitly required ("unchanged by this task"), and P3 makes that an invariant, so this is the right call here. But knip's silence is **not** evidence of a consumer: knip v6's issue types are `files, dependencies, unlisted, unresolved, exports, nsExports, types, nsTypes, enumMembers, namespaceMembers, duplicates, catalog, cycles` - there is no class-member analysis at all, and even if there were, `logs.test.ts` references the method. Knip is clean, but for a reason unrelated to this symbol. Worth a follow-up task to delete it; out of scope for 52.
6. **Lint 25 → 28** - three new `no-shadow` warnings, one per new test, all `const { ctx, … } = deliveryCtx(…)` shadowing the module-level `ctx()` helper at `nodes.test.ts:7`, matching all 25 pre-existing warnings in the same file. `pnpm lint` exits 0. Consistency was the right call: renaming in only the three new tests would make the file inconsistent for no behavioural gain, and the repo config treats `no-shadow` as a warning.
7. **M4's margin is thin but adequate** - position-based ownership is caught by exactly one assertion (the `/analytics-d/` regex in the `delete()` refusal test); the retry test alone would pass a position-based implementation, since it refuses either way and only names the wrong delivery. Acceptable because both guards call one shared predicate, so a position defect cannot exist in only the uncovered half.

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☑ DONE
- **Gaps:** none. O1–O8 all SATISFIED, all six regression checks PRESERVED, P4 discharged by
  execution before any other verdict was formed. The seven observations above are non-blocking:
  two are coverage notes (2, 3), two concern pre-existing code this task did not change (4, 5), and
  three are judgement calls recorded as sound (1, 6, 7).
