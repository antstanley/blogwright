# Done Certificate — Task 53: Guard the shared CloudFront delivery source against cascading deletes

**Task:** [52-cli_shared_delivery_source_guards.md](52-cli_shared_delivery_source_guards.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 52. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 53) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `logDeliveryNode` refuses to delete a delivery source carrying deliveries it does not own, and its `ConflictException` retry removes only the site's own delivery, so the analytics delivery survives both `blogwright destroy` and a bootstrap self-heal.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not change behaviour when the site's delivery is the only one on the source: the existing teardown order (`nodes.ts:763-775`) and the existing self-heal assertions (`nodes.test.ts:88-97`) stand unchanged.

## Obligations

- **O1 — A shared source is never deleted.**
  - *Claim:* `delete()` leaves the delivery source in place and raises, naming the foreign delivery and `blogwright analytics destroy`, when `deliveriesForSource` returns any delivery the site does not own.
  - *Evidence to collect:* read `delete()` in `packages/cli/src/nodes.ts`; run the foreign-delivery test; inspect the recording fake's final state for the source.
  - *Checks:* the source must still exist in the fake after the call — an assertion only on the thrown message would pass even if the delete had been issued first.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O2 — The unshared teardown is unchanged.**
  - *Claim:* with no foreign delivery, `delete()` still removes delivery → source → destination in the documented order.
  - *Evidence to collect:* run the existing call-order assertion; confirm it was not edited (`git diff packages/cli/src/nodes.test.ts` shows additions only in the ordering block).
  - *Checks:* if the pre-existing ordering assertion had to change, the guard altered behaviour it was meant to preserve.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O3 — The retry deletes exactly one delivery.**
  - *Claim:* the `ConflictException` retry deletes only the site's own delivery id, identified by its destination rather than by list position.
  - *Evidence to collect:* read the retry block; run the retry test with a foreign delivery present; read the fake's delete call log.
  - *Checks:* the foreign id must appear nowhere in the delete log, and the identification must not use `findDeliveryIdBySource`'s `.find()` (`logs.ts:131`), which returns whichever delivery AWS lists first.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O4 — Existing self-heal preserved.**
  - *Claim:* `packages/cli/src/nodes.test.ts:88-97` passes unchanged.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- nodes`; diff the test file.
  - *Checks:* unchanged means not edited, not merely still green.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O5 — Repo definition of done.**
  - *Claim:* the change meets DEVELOPMENT.md's definition of done (see plan.md baseline).
  - *Evidence to collect:* run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`.
  - *Checks:* all five gates pass; a changeset records that `destroy` can now fail early with a message where it previously threw a Conflict part-way.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->
- **O6 — Reviewable.**
  - *Claim:* a reviewer can confirm the guards directly.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- nodes`.
  - *Checks:* the foreign-delivery cases fail loudly rather than cascading, and no pre-existing log-delivery assertion was edited.
  - *Status:* ☐ SATISFIED / ☐ UNSATISFIED   <!-- validator sets -->

## Regression checks

- `logDeliveryNode.create()`'s happy path (`nodes.ts:743-745`) still wires source → destination → delivery on a clean environment : ☐ (PRESERVED / REGRESSION)
- `blogwright bootstrap` on an environment with no analytics plugin behaves exactly as today : ☐ (PRESERVED / REGRESSION)
- `blogwright destroy` on an environment with no analytics plugin still tears down the delivery trio : ☐ (PRESERVED / REGRESSION)

## Conclusion

- **Rubric.** DONE iff every obligation is SATISFIED and every regression check is PRESERVED.
  Any UNSATISFIED or REGRESSION ⇒ NOT DONE, and the gap is named.
- **Status:** ☐ DONE / ☐ NOT DONE   <!-- validator sets -->
- **Gaps:**   <!-- validator lists any unsatisfied obligation or regression -->
