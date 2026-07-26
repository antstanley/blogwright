# Done Certificate — Task 48: The S3 Tables bucket, namespace and page_views table nodes

**Task:** [48-nodes_table_bucket_namespace_table.md](48-nodes_table_bucket_namespace_table.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 48. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 48) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The first three nodes of the plugin's graph exist in `packages/analytics/src/nodes.ts` — table bucket, namespace and `page_views` table — chained by `dependsOn`, reconcilable in both directions against a mocked transport, and carrying no column literal of their own.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's own graph (`packages/cli/src/nodes.ts:1053` `buildNodes` and its node set), the shared client bundle's region split (`packages/core/src/clients.ts:42-70`), or task 39's schema module, which this task reads and must not edit.

## Obligations

- **O1 — Three chained nodes, incremental recording, and the pinned client.**
  - *Claim:* `analytics-table-bucket`, `analytics-namespace` and `analytics-table` implement `read`/`create`/`delete`, chain bucket → namespace → table through `dependsOn`, record each identifier into the plugin's scoped state as its resource is created, and reach AWS only through `ctx.clients.s3tables`, which signs against `us-east-1` whatever `config.region` says.
  - *Evidence to collect:* read the three node factories in `packages/analytics/src/nodes.ts` for their `id`, `dependsOn` and the position of the state write inside `create` (before any secondary call, as at `packages/cli/src/nodes.ts:54-56`); run `pnpm test -- nodes` in `packages/analytics` and confirm the region test builds the context with a non-`us-east-1` `config.region` and asserts `/us-east-1/s3tables/` in the recorded `authorization` header.
  - *Checks:* resolve every AWS call in the three nodes — confirm each goes through `ctx.clients.s3tables` from the `PluginContext`, and that no `fetch`, no vendor SDK and no second client construction appears in `packages/analytics/src/nodes.ts`.
  - *Status:* ☐ unverified

- **O2 — The table is built from the schema module.**
  - *Claim:* `analytics-table` derives `page_views` from `packages/analytics/src/schema.ts`'s column set and `day` partition, with no column name, type or partition literal in `nodes.ts`.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics`; alter one column name in `packages/analytics/src/schema.ts`, re-run, and confirm the create-payload test fails naming that column; restore the file. Read `packages/analytics/src/nodes.ts` and confirm the table node contains no column-name string.
  - *Status:* ☐ unverified

- **O3 — Absence and idempotence in both directions.**
  - *Claim:* each `read` returns `false` without throwing when the resource is absent, and each `delete` is a no-op when it is already gone.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics` and confirm six transport-mocked cases exist — one absent-read and one already-deleted case per node — each asserting no throw rather than only asserting the return value.
  - *Status:* ☐ unverified

- **O4 — Names come from the resolved analytics config.**
  - *Claim:* the bucket, namespace and table names are read from task 44's resolved `analytics` config, not from `ctx.names`, and the two-environment collision test lives with the module owning the derivation.
  - *Evidence to collect:* read the name expressions in the three node factories; run `grep -n "ctx.names" packages/analytics/src/nodes.ts` and confirm no hit for the bucket, namespace or table name; locate the two-environment collision test and confirm it sits with task 44's module rather than in `nodes.test.ts`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- nodes` inside `packages/analytics`, alter a column and confirm the payload test fails (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests, break one column in `schema.ts`, and observe the table-node payload test fail naming that column, with the region test showing `/us-east-1/s3tables/`.
  - *Evidence to collect:* run `pnpm test -- nodes` inside `packages/analytics`; edit one column name in `packages/analytics/src/schema.ts`, re-run and read the failure message; restore the file and confirm the suite is green again; read the recorded `authorization` header assertion in the region test.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:1053` `buildNodes(ctx)` called with a production context → expect the same eleven-to-fourteen node ids as before this task, with no analytics node present : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/clients.ts:42` `createClients({ region: 'eu-west-1' })` → expect `logs`, `s3`, `microvms` and `secrets` still signing against `eu-west-1` while `s3tables` signs against `us-east-1` : ☐ (PRESERVED / REGRESSION)

## Residue

The plugin's `output(ctx, id)` equivalent duplicates a three-line helper from `packages/cli/src/nodes.ts:20-22` because a plugin may not import the CLI; note whether the duplication is stated in a comment. The spec's open question on record expiration for the table is not covered by the DoD and stays open. Whether the S3 Tables API reports an absent namespace as a not-found error or an empty result determines how `read` distinguishes absence from failure — confirm the adapter (task 32) returns `undefined` for absence rather than throwing, so the node's absence path is real rather than a swallowed error.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
