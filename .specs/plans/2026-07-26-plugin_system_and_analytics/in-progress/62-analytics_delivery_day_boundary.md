# Task 62 — Keep the initial delivery day conservative across UTC midnight

**Plan:** [plan.md](../plan.md) · **Certificate:** [62-analytics_delivery_day_boundary-certificate.md](62-analytics_delivery_day_boundary-certificate.md)

**Implements:** [Analytics spec](../../../changes/merged/2026-07-26-analytics_plugin.md) §Backfill of historical logs, strict whole-day exclusion and write-once creation bound.
**Depends on:** 53, 61
**Produces:** A CreateDelivery request crossing UTC midnight cannot cause backfill to include a day on which live delivery may already have started.
**Pointers:** `packages/analytics/src/nodes.ts`: analyticsLogDeliveryNode.create and createdDay; nodes.test.ts creation-day cases; backfill.ts and backfill.test.ts whole-day bound.

## Steps

- [ ] Capture the UTC day before beginning the delivery-creation request/retry sequence; write it only after successful creation and only if createdDay is absent. Preserve old recorded bounds and read/adoption behavior.
- [ ] Add a deterministic crossing-midnight test that advances time inside the request fake; demonstrate the old code fails. Cover failure without a false recorded day, existing earlier bound, same-day creation and backfill excluding the live day.
- [ ] Write an analytics patch changeset explaining the duplicate-day prevention. Preserve beta.3 fourteen-node graph and log-group behavior.

## Definition of done

- [ ] The first successful create stores the UTC day sampled before the request, including a request spanning midnight; it cannot store the later response day.
- [ ] Existing createdDay is never advanced by rereconcile or replacement; read-only hydration does not invent one; failed creation does not record a successful creation day.
- [ ] Backfill still admits only complete UTC days strictly before the stored day, refusing the live day; beta.3 logging configuration and fourteen-node graph are preserved.
- [ ] Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- [ ] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run nodes backfill --reporter=verbose`; observe the deterministic midnight test fail with the old sampling order and pass with the fix.
