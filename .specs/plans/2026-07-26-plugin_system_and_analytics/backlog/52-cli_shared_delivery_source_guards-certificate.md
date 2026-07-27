# Done Certificate — Task 52: Guard the shared CloudFront delivery source against cascading deletes

**Task:** [52-cli_shared_delivery_source_guards.md](52-cli_shared_delivery_source_guards.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 52. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 52) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `deliveriesForSource` returns each delivery's destination ARN alongside its id, and on that `logDeliveryNode` refuses to delete a delivery source carrying deliveries it does not own while its `ConflictException` retry removes only the site's own delivery, so the analytics delivery survives both `blogwright destroy` and a bootstrap self-heal.
- **P2 — Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 — Invariants.** Must not change behaviour when the site's delivery is the only one on the source: the existing teardown order (`nodes.ts:763-775`) and the existing self-heal call-order assertions (`nodes.test.ts:88-97,104`) stand unchanged. `findDeliveryIdBySource` (`logs.ts:124-136`) keeps its signature and behaviour; this task stops calling it, it does not rewrite it.

## Obligations

- **O1 — The client can express "the site's own delivery".**
  - *Claim:* `deliveriesForSource` (`packages/core/src/aws/logs.ts:139-153`) returns each matching delivery's `id` together with its `deliveryDestinationArn`, so the discrimination both guards need is available without a raw AWS call from the CLI (DEVELOPMENT.md §Where validation lives).
  - *Evidence to collect:* read the widened return type at `packages/core/src/aws/logs.ts:139,144` and the filter it feeds at `:147-149`; run `pnpm test -- logs` in `packages/core` and confirm a case maps a paginated `DescribeDeliveries` response to id/destination pairs and still filters out a delivery on another source.
  - *Checks:* confirm the guards read this list and not `findDeliveryIdBySource`, and that the CLI added no direct `send`/`call` against CloudWatch Logs to compensate.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O2 — A shared source is never deleted.**
  - *Claim:* `delete()` leaves the delivery source in place and raises, naming the foreign delivery and `blogwright analytics destroy`, when `deliveriesForSource` returns any delivery the site does not own.
  - *Evidence to collect:* read `delete()` in `packages/cli/src/nodes.ts`; run the foreign-delivery test; inspect the recording fake's final state for the source.
  - *Checks:* the source must still exist in the fake after the call — an assertion only on the thrown message would pass even if the delete had been issued first.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O3 — The unshared teardown is unchanged.**
  - *Claim:* with no foreign delivery, `delete()` still removes delivery → source → destination in the documented order.
  - *Evidence to collect:* run the existing call-order assertion; confirm it was not edited (`git diff packages/cli/src/nodes.test.ts` shows additions only in the ordering block).
  - *Checks:* if the pre-existing ordering assertion had to change, the guard altered behaviour it was meant to preserve.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O4 — The retry deletes exactly one delivery.**
  - *Claim:* the `ConflictException` retry deletes only the site's own delivery id, identified by the one named predicate matching `deliveryDestinationArn` against `ctx.names.deliveryDestination`, rather than by list position.
  - *Evidence to collect:* read the retry block and the predicate; run the retry test with a foreign delivery present; read the fake's delete call log.
  - *Checks:* the foreign id must appear nowhere in the delete log; the identification must not use `findDeliveryIdBySource`'s `.find()` (`logs.ts:131`), which returns whichever delivery AWS lists first; and it must not read the recorded `destination` output (`nodes.ts:731`), which is empty on this path because `putDeliverySource` throws the Conflict at `:721-726` first.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O5 — Existing self-heal preserved.**
  - *Claim:* the call-order assertions at `packages/cli/src/nodes.test.ts:88-97,104` pass with no edit to any expected sequence.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- nodes`; diff the test file.
  - *Checks:* unchanged means not edited, not merely still green — the one permitted edit in that block is the `deliveriesForSource` fake at `:63` returning the widened shape.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O6 — Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass; a changeset records that `destroy` can now fail early with a message where it previously threw a Conflict part-way.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O7 — Reviewable.**
  - *Claim:* a reviewer can confirm the guards directly.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- nodes`.
  - *Checks:* the foreign-delivery cases fail loudly rather than cascading, and no pre-existing log-delivery assertion was edited.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

## Regression checks

- `packages/cli/src/nodes.ts:753-757` is the only caller of `deliveriesForSource`; after the widening, `grep -rn "deliveriesForSource" packages/` shows the client, that call site and the fakes only : ☐ (PRESERVED / REGRESSION)
- The pre-existing `LogsClient` describes at `packages/core/src/aws/logs.test.ts:18-66`, including task 37's pinned delivery bodies, still pass unedited : ☐ (PRESERVED / REGRESSION)
- `logDeliveryNode.create()`'s happy path (`nodes.ts:743-745`) still wires source → destination → delivery on a clean environment : ☐ (PRESERVED / REGRESSION)
- `blogwright bootstrap` on an environment with no analytics plugin behaves exactly as today : ☐ (PRESERVED / REGRESSION)
- `blogwright destroy` on an environment with no analytics plugin still tears down the delivery trio : ☐ (PRESERVED / REGRESSION)

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☐ NOT DONE   <!-- validator sets -->
- **Gaps:**   <!-- validator lists any unsatisfied obligation or regression -->
