# Done Certificate — Task 52: The CloudWatch delivery destination and the second delivery off the site's source

**Task:** [52-nodes_log_destination_and_delivery.md](52-nodes_log_destination_and_delivery.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 52. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 52) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `analytics-log-destination` and `analytics-log-delivery` add a second delivery hanging off the site's existing delivery source, which the plugin reads but never creates, never repoints and never deletes.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's vended log delivery (`packages/cli/src/nodes.ts:713` `logDeliveryNode`, its `ConflictException` self-heal at `:743-762` and its teardown at `:763-775`), the `LogsClient` request bodies task 36 pinned for the no-options path, or the plugin's read-only access to the site's state (`SiteState` from task 01).

## Obligations

- **O1 — Destination with an immutable output format.**
  - *Claim:* the destination points at the Firehose stream with the required output format and is replaced, not updated, when the recorded format differs from the configured one.
  - *Evidence to collect:* read the destination node's `create`/`update` bodies and the recorded-format comparison in `packages/analytics/src/nodes.ts`; run `pnpm test -- nodes` in `packages/analytics` and confirm the format-change case asserts a delete-then-create call sequence rather than a repeated put.
  - *Checks:* resolve the output-format argument — confirm it reaches `putDeliveryDestination`'s task 36 option (`packages/core/src/aws/logs.ts:106-112`) and not a hand-built request body.
  - *Status:* ☐ unverified

- **O2 — Delivery joins the site's source; absence fails with an actionable message.**
  - *Claim:* the delivery is created against the site's delivery source with `schema.ts`'s record-field selection, `putDeliverySource` is never called, the source name and distribution ARN are read through `ctx.names` and the read-only `SiteState` view, and an absent source or distribution ARN fails before any AWS call with a message naming `blogwright bootstrap`.
  - *Evidence to collect:* read the delivery node's body for its source-name and distribution-ARN reads and the guard preceding the first call; run `grep -n "StateStore\|putDeliverySource" packages/analytics/src/nodes.ts` and expect no hit; run `pnpm test -- nodes` in `packages/analytics` and confirm the negative-space case asserts both the message text and that the recorded call list is empty.
  - *Checks:* resolve the record-field argument — confirm it is `CLOUDFRONT_RECORD_FIELDS` from `packages/analytics/src/schema.ts` (task 39), not a list restated in `nodes.ts`.
  - *Status:* ☐ unverified

- **O3 — The site's CloudWatch delivery survives.**
  - *Claim:* after the analytics delivery is created, `deliveriesForSource` still lists the site's CloudWatch delivery and no delete was issued against it.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics` and read the survival case: confirm the fake seeds an existing CloudWatch delivery id, asserts it is still listed after `create`, and asserts no `deleteDelivery` naming that id appears in the call log.
  - *Status:* ☐ unverified

- **O4 — The shared delivery source is never deleted.**
  - *Claim:* neither the `ConflictException` retry nor `delete` calls `deleteDeliverySource`; the retry clears only the plugin's own delivery and destination with a comment stating the deliberate divergence from `packages/cli/src/nodes.ts:751-759`; `delete` removes the delivery before the destination per `packages/cli/src/nodes.ts:763-768`.
  - *Evidence to collect:* read both bodies and the divergence comment in `packages/analytics/src/nodes.ts`; run `pnpm test -- nodes` in `packages/analytics` and confirm the retry case and the teardown case each assert the full ordered call log and the absence of `deleteDeliverySource`.
  - *Checks:* resolve every `logs` call in the two nodes — confirm none is `deleteDeliverySource` (`packages/core/src/aws/logs.ts:164`), and that the delivery id being deleted is the plugin's own, looked up by its destination rather than by clearing every delivery on the shared source.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run the analytics and CLI node suites and confirm no `deleteSource` entry anywhere (Reviewable).**
  - *Claim:* a reviewer can run both node suites and observe no `deleteSource` entry in any analytics call log, the CLI's self-heal assertions unchanged, and the format-change case showing delete-then-create.
  - *Evidence to collect:* run `pnpm test -- nodes` inside `packages/analytics` and `pnpm test -- nodes` inside `packages/cli`; read the analytics call-log assertions and `packages/cli/src/nodes.test.ts:88-97`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:743` `logDeliveryNode.create` with a stale source (the `ConflictException` path) → expect the existing sequence `putSource, listDeliveries, deleteDelivery:d-1, deleteSource, deleteDest, putSource, putDest, createDelivery` pinned at `packages/cli/src/nodes.test.ts:88-97` : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/aws/logs.ts:114` `createDelivery` called by the site with no options → expect the body pinned by task 36 (`{ deliverySourceName, deliveryDestinationArn }`) with no record-field keys added : ☐ (PRESERVED / REGRESSION)

## Residue

The site's self-heal at `packages/cli/src/nodes.ts:751-759` deletes every delivery on the shared source and then the source itself; when a site re-bootstrap runs that path, the plugin's delivery is collateral damage and the plugin's scoped state will claim a delivery that no longer exists. That interaction is outside this task's DoD and is the concrete form of the open question both change specs raise about `blogwright destroy` and plugin-owned resources — the validator should record whether a follow-up exists. Whether the plugin's delivery id is discoverable after a partial create (it is not recorded by `createDelivery`, which returns nothing) determines how `delete` finds it; confirm the lookup path is by destination and not by assuming a single delivery per source.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
