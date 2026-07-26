# Task 53 — Guard the shared CloudFront delivery source against cascading deletes

**Plan:** [plan.md](../plan.md) · **Certificate:** [52-cli_shared_delivery_source_guards-certificate.md](52-cli_shared_delivery_source_guards-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §CloudFront log delivery → Two guards on the site's node (Modify)](../../../changes/2026-07-26-analytics_plugin.md) and [2026-07-26-cli_plugin_system.md §CLI → Plugin lifecycle (Add)](../../../changes/2026-07-26-cli_plugin_system.md) (a site node deletes only what it created)
**Depends on:** 37
**Produces:** `logDeliveryNode` refuses to delete a delivery source that carries deliveries it does not own, and its `ConflictException` retry removes only the site's own delivery — so the analytics delivery survives both `blogwright destroy` and a bootstrap self-heal

**Pointers:** `packages/cli/src/nodes.ts:713-777` (`logDeliveryNode` in full), `:743-762` (the `ConflictException` retry that today deletes every delivery via `deliveriesForSource`), `:763-775` (`delete()` and the teardown-ordering comment), `packages/core/src/aws/logs.ts:124-136` (`findDeliveryIdBySource` — `.find()`, returns the FIRST match), `:139-153` (`deliveriesForSource` — the full list both guards read), `:164-171` (`deleteDeliverySource`, which catches only `isNotFound` so a Conflict propagates), `packages/cli/src/nodes.test.ts:32-105` (the recording `logsUsEast1` fake and its call-order assertions)

## Steps

- [ ] In `delete()`, read `deliveriesForSource` first. Delete the site's own delivery and destination, then delete the delivery source ONLY when no other delivery remains; when others remain, leave the source in place and fail with a message naming them and pointing at `blogwright analytics destroy`. Today the source is deleted unconditionally, and with a second delivery attached AWS returns a Conflict that `deleteDeliverySource` does not catch — so `blogwright destroy` throws partway through teardown, after the distribution is already gone.
- [ ] In the `ConflictException` retry, delete only the site's own delivery id rather than iterating `deliveriesForSource` and deleting all of them. The current loop silently removes the analytics delivery while the plugin's scoped state still records it as `configured`, so `analytics status` reports healthy and CloudFront has stopped delivering — a silent data-loss path, which is the worst shape a bug can take here.
- [ ] Identify "the site's own delivery" by the destination it points at (`ctx.names.deliveryDestination`), not by position. `findDeliveryIdBySource` uses `.find()` (`logs.ts:131`) and returns whichever delivery AWS lists first, which is not necessarily the site's once a second exists.
- [ ] Extend `packages/cli/src/nodes.test.ts` with the recording `logsUsEast1` fake: a `delete()` against a source carrying one foreign delivery leaves the source alive and raises with that delivery named; a `delete()` against a source carrying only the site's own removes all three in the documented order; a Conflict retry with a foreign delivery present deletes only the site's id and leaves the foreign one in the call log.
- [ ] Write the changeset: `blogwright destroy` can now fail where it previously threw a Conflict, which is the point — it fails early with an actionable message instead of part-way through.

## Definition of done

- [ ] `delete()` never deletes a delivery source carrying a delivery it does not own; it fails with a message naming the foreign delivery and `blogwright analytics destroy`, asserted by test, and the source is still present in the fake's state afterwards.
- [ ] With no foreign delivery present, `delete()` still removes delivery → source → destination in the order the comment at `nodes.ts:763-768` documents, proved by an unchanged call-order assertion — this task must not regress the existing teardown.
- [ ] The `ConflictException` retry deletes exactly one delivery id, the site's own, identified by its destination rather than by list position; a test with a foreign delivery present asserts the foreign id never appears in a delete call.
- [ ] The existing self-heal behaviour is preserved for the single-delivery case: `packages/cli/src/nodes.test.ts:88-97` passes unchanged.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright test -- nodes`; confirm the foreign-delivery cases fail loudly rather than cascading, and that no assertion in the pre-existing log-delivery tests had to be edited.
