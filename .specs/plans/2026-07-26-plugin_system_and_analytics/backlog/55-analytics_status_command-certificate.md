# Done Certificate — Task 55: analytics status: nodes against scoped state, stream health and row count

**Task:** [55-analytics_status_command.md](55-analytics_status_command.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 55. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 55) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `analytics status` lists the twelve nodes present or missing against `state/<env>.analytics.json` in the same pretty/plain split as the site's `status`, and appends the Firehose stream's delivery health and the table's row count, degrading each to a warning when its read fails.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's `status` (`packages/cli/src/commands.ts:301-329`) or task 15's extracted read loop, task 54's node set and its scoped state store, or task 45's port contract — no DuckDB may start anywhere in the package's test suite.

## Obligations

- **O1 — Twelve nodes listed against scoped state, in both output modes.**
  - *Claim:* the command reports each of the twelve nodes present or missing against `state/<env>.analytics.json`, with a tree when interactive and one stable line per node when not.
  - *Evidence to collect:* read `status` in `packages/analytics/src/commands.ts`; run `pnpm test -- commands` in `packages/analytics` and confirm the plain-mode case uses a non-interactive terminal and asserts twelve lines by node title, and that an interactive case exercises the tree branch.
  - *Checks:* resolve the state the presence check reads — confirm it is the plugin's scoped store, not the site's `state/<env>.json`.
  - *Status:* ☐ unverified

- **O2 — Own nodes, no CLI import.**
  - *Claim:* the presence loop calls `read()` on the plugin's own nodes and the command module imports no CLI module.
  - *Evidence to collect:* run `grep -rn "from 'blogwright'" packages/analytics/src/commands.ts` and expect no output; read the loop and confirm it iterates `buildAnalyticsNodes(ctx)` and calls `node.read(ctx)` directly rather than delegating to an engine function.
  - *Checks:* resolve the read loop's helper, if any — confirm it lives in `packages/analytics/src/` and is not an import of task 15's CLI-side `readNodeStatus`.
  - *Status:* ☐ unverified

- **O3 — Stream health and row count, both degrading to warnings.**
  - *Claim:* the command reports the stream's delivery health and the table's row count, the count taken through the `AnalyticsQuery` port from task 45's named set, and a failing read of either degrades to a warning while the listing completes.
  - *Evidence to collect:* run `grep -rn "@duckdb" packages/analytics/src/commands.ts` and expect no output; read the row-count call and confirm it names a query from `packages/analytics/src/queries.ts` rather than SQL text; run `pnpm test -- commands` in `packages/analytics` and confirm the two failure cases assert both the warning line and that all twelve node lines are still emitted.
  - *Checks:* resolve the delivery-health value — confirm it comes from the state task 51's stream `read` hydrated, not a second describe call issued by the command.
  - *Status:* ☐ unverified

- **O4 — A never-bootstrapped environment.**
  - *Claim:* `analytics status` on an environment with empty scoped state reports every node missing and exits 0 rather than throwing.
  - *Evidence to collect:* run `pnpm test -- commands` in `packages/analytics` and read the never-bootstrapped case — confirm it seeds empty scoped state, asserts twelve missing lines, and asserts the returned exit code is 0 rather than only the absence of a throw.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- commands` inside `packages/analytics` and confirm the twelve plain lines, the degraded cases and the zero exit (Reviewable).**
  - *Claim:* a reviewer can run the package's command tests and observe a plain-mode case asserting twelve lines by node title, two degraded cases still showing all twelve, and a never-bootstrapped case asserting a zero exit.
  - *Evidence to collect:* run `pnpm test -- commands` inside `packages/analytics`; read the three named cases and their assertions.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:301` `status(ctx)` for the site → expect the same lines as before this task in both interactive and plain modes, since the plugin's status is a separate implementation : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/nodes.ts` `read()` on each of the twelve nodes, called by this command with an empty scoped state → expect `false` and no throw from every node, the contract tasks 48–51 and 53 established : ☐ (PRESERVED / REGRESSION)

## Residue

If task 45's named set carries no row-count query, one is added to `packages/analytics/src/queries.ts` here; the validator should confirm it was added there and satisfies task 45's parameterisation test rather than being written inline. `analytics status` reaching the table requires DuckDB credentials at runtime (task 46), so a working row count in a real session depends on that adapter — the tests substitute the fixture-backed fake, and no test may start DuckDB. Whether a missing stream should read as unhealthy or as merely missing is not pinned by the DoD; note which the implementation chose.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
