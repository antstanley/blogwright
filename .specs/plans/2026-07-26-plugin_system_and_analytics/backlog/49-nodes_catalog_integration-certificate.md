# Done Certificate — Task 49: The account-scoped Glue catalog integration node

**Task:** [49-nodes_catalog_integration.md](49-nodes_catalog_integration.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 49. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 49) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `analytics-catalog-integration` adopts an existing account-and-region-scoped Glue `s3tablescatalog` federation rather than creating one, and its `delete` is a no-op, so a second environment never re-creates it and a teardown never removes it.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break task 48's three nodes or their tests, and must not change `packages/cli/src/graph.ts:89-99` `destroyGraph`, which calls every node's `delete` unconditionally — the reason this node's inertness has to live in the node itself.

## Obligations

- **O1 — The node and its dependency.**
  - *Claim:* `analytics-catalog-integration` declares `dependsOn: ['analytics-table']` and creates the Glue `s3tablescatalog` federation Firehose reads the table through, via `ctx.clients.glue`.
  - *Evidence to collect:* read the node factory in `packages/analytics/src/nodes.ts` for its `id`, `dependsOn` and the create call; confirm the operation name matches task 34's `GlueClient` federation create.
  - *Checks:* resolve the create call — confirm it is `ctx.clients.glue` from the `PluginContext` and not a locally constructed client.
  - *Status:* ☐ unverified

- **O2 — Adopt, not create; and an inert delete.**
  - *Claim:* `read()` returns true for an already-existing integration and `delete()` performs no call, with a destroy over the node set issuing no Glue call at all.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics`; confirm one case asserts `read` true against a mocked existing integration, one asserts `delete` makes no call, and one runs a teardown over the whole node set with a recording Glue client and asserts the recorded call list is empty.
  - *Checks:* trace `destroyGraph` (`packages/cli/src/graph.ts:89-99`) over the plugin's node set — confirm reaching this node's `delete` produces no request, rather than a swallowed error.
  - *Status:* ☐ unverified

- **O3 — Second-environment convergence.**
  - *Claim:* with the integration already present, `create` is never invoked for a second environment's context.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics` and read the second-environment case: confirm it builds a context for a different `env` over the same account, mocks the integration as present, and asserts the create operation is absent from the recorded call list.
  - *Status:* ☐ unverified

- **O4 — Operator-visible scoping and the why comment.**
  - *Claim:* the node's `title` and create log line state that the integration is account-and-region scoped, and a comment on `delete` explains why it is a no-op rather than restating the code.
  - *Evidence to collect:* read the node's `title` string and its logger call in `packages/analytics/src/nodes.ts`; read the comment on `delete` and confirm it names the consequence for the other environment (DEVELOPMENT.md §Clean Code — comments explain why).
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- nodes` inside `packages/analytics` and confirm the empty Glue call log and the delete comment (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests and observe a destroy case asserting an empty Glue call log, and read a `delete` comment naming the consequence for other environments.
  - *Evidence to collect:* run `pnpm test -- nodes` inside `packages/analytics`; read the destroy case's assertion and confirm it checks an empty recorded call list rather than an absent error; read the `delete` body in `packages/analytics/src/nodes.ts`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/nodes.ts` task 48 chain (`analytics-table-bucket` → `analytics-namespace` → `analytics-table`) reconciled through the same test harness → expect the three earlier nodes' create/delete call sequences unchanged by the appended node : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/graph.ts:89` `destroyGraph` over a node set containing an inert-delete node → expect the loop to continue to the next node and still write state, as it does for `packages/cli/src/nodes.ts:809-812` : ☐ (PRESERVED / REGRESSION)

## Residue

This is the one node in the graph whose lifecycle deliberately differs from every other; a conventional create/delete node here breaks the other environment's pipeline, so a reviewer who "fixes" the empty `delete` reintroduces the fault. The validator should note whether a future reader is protected by the comment alone or by a test that would fail if `delete` started issuing a call. The spec's open question on whether one table bucket per environment duplicates this integration's reasoning stays open.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
