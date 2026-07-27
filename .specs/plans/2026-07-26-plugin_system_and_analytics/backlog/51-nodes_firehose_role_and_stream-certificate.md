# Done Certificate — Task 51: The Firehose delivery role and the Iceberg delivery stream nodes

**Task:** [51-nodes_firehose_role_and_stream.md](51-nodes_firehose_role_and_stream.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 51. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 51) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `analytics-error-bucket`, `analytics-firehose-role` and `analytics-firehose-stream` exist in `packages/analytics/src/nodes.ts` — a us-east-1 bucket for failed records, a delivery role holding exactly four concretely-scoped grants and declaring a dependency on each node whose recorded output those grants interpolate, and a stream writing the Iceberg destination through the transform, whose `read` surfaces the delivery state `analytics status` reports.
- **P2 — Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break tasks 48–50's nodes and their recorded outputs (the table, the catalog integration and the transform function ARN this role and stream read), nor touch the site's environment bucket at all — the failed-record prefix belongs to the plugin's own `analytics-error-bucket`, and `ctx.names.bucket` appears nowhere in the plugin's nodes.

## Obligations

- **O1 — Four concretely-scoped grants.**
  - *Claim:* the role's inline policy grants exactly Glue catalog read, S3 Tables write, `lambda:InvokeFunction` on the transform function, and write to the plugin's own `analytics-error-bucket`, each against a concrete ARN, with no `*` resource and no fifth statement.
  - *Evidence to collect:* read the policy helper in `packages/analytics/src/nodes.ts`; run `pnpm test -- nodes` in `packages/analytics` and confirm the policy test parses the captured document, asserts each of the four capabilities by its action, fails on any `*` in `Resource`, and asserts `ctx.names.bucket` appears nowhere in it.
  - *Checks:* resolve each ARN expression — confirm it is built from `ctx.accountId`, the resolved analytics config, or an output recorded by tasks 48–50, not from a hardcoded account or region string.
  - *Status:* ☐ unverified

- **O2 — Declared dependencies on both nodes, and the stream's destination.**
  - *Claim:* the role declares `dependsOn` on `analytics-error-bucket`, `analytics-table` and `analytics-transform-function`; the stream declares `dependsOn` on `analytics-table`, `analytics-catalog-integration` and `analytics-transform-function`, and configures the Iceberg destination plus the record-transform Lambda processor against the recorded function ARN.
  - *Evidence to collect:* read both nodes' `dependsOn` arrays and the stream's create payload; run `pnpm test -- nodes` in `packages/analytics` and confirm one case asserts the role's three dependency ids, one asserts the stream's three, and one asserts the destination and processor payload shape.
  - *Checks:* resolve the processor's function ARN — confirm it reads the value task 50's node recorded into the scoped state rather than re-deriving the function name. Cross-check the role's declared set against every ARN its policy interpolates: an ARN read from a node the role does not declare is reconciled after the role under `topoSort`'s alphabetical drain (`packages/cli/src/graph.ts:35-38`) and interpolates as `undefined`, which is a wrong grant, not a failure.
  - *Status:* ☐ unverified

- **O3 — The error bucket is the plugin's own, in us-east-1.**
  - *Claim:* the error/backup prefix targets `analytics-error-bucket`, the plugin's own us-east-1 bucket, never the site's environment bucket (`ctx.names.bucket`), and a comment states why.
  - *Evidence to collect:* read the error-prefix expression and the comment beside it in `packages/analytics/src/nodes.ts`; confirm the comment names the undocumented cross-region behaviour (`S3DestinationConfiguration.BucketARN` carries no region, so the API can neither express nor reject the mismatch) and that a schema mismatch sends every affected record there, making it a normal path; run `grep -n "names.bucket" packages/analytics/src/nodes.ts` and expect no output.
  - *Status:* ☐ unverified

- **O4 — The `AppendOnly` reconcile is defensive, not assumed.**
  - *Claim:* the stream node attempts `UpdateDestination` when the recorded flag differs from the configured one and falls back to deleting and recreating the stream when the update is rejected, with one test per branch.
  - *Evidence to collect:* read the stream node's `update` path; run `pnpm test -- nodes` in `packages/analytics` and confirm both branches are covered. AWS's own documentation contradicts itself here — the Firehose considerations page says `AppendOnly` is settable only at `CreateDeliveryStream`, while the `IcebergDestinationUpdate` API reference lists it as an accepted field — so a node written against either reading alone is a defect, whichever reading turns out to be right.
  - *Status:* ☐ unverified

- **O5 — Health readable, absence safe, teardown re-runnable.**
  - *Claim:* `read` hydrates the stream's delivery state into the plugin's scoped state and returns `false` without throwing when the stream is absent; `delete` is idempotent and completes after a partial teardown.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics`; confirm one case asserts the delivery state is recorded where task 55 will read it, one asserts a `false` return for an absent stream with no throw, and one deletes with the stream already gone and asserts the role deletion still issued.
  - *Status:* ☐ unverified

- **O6 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O7 — Run `pnpm test -- nodes` inside `packages/analytics` and confirm the enumerated policy and the partial-teardown case (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests and observe a policy test enumerating all four capabilities by action, and a partial-teardown case that deletes the role after the stream is already gone without throwing.
  - *Evidence to collect:* run `pnpm test -- nodes` inside `packages/analytics`; read the policy test's assertions and the partial-teardown case's recorded call list.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/nodes.ts` tasks 48–50 nodes reconciled through the same test harness → expect their call sequences and recorded outputs unchanged by the two appended nodes : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:42` `bucketNode.delete` (which empties every prefix in the site bucket) → expect its call sequence unchanged, because the failed-record prefix lives in the plugin's own `analytics-error-bucket` and no site-bucket prefix was added : ☐ (PRESERVED / REGRESSION)

## Residue

Whether the stream must reach `ACTIVE` before task 53's delivery targets it is not in the DoD; if the delivery creation races a `CREATING` stream, a `pollUntil` in the shape of `packages/cli/src/nodes.ts:702-707` belongs here and the validator should note its absence. Buffering hints, compression and the Iceberg destination's retry duration are configuration surface the DoD does not pin — note whether they are named constants or literals. The spec's open question on record expiration for the table is unrelated and stays open.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
