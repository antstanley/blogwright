# Task 55 — analytics status: nodes against scoped state, stream health and row count

**Plan:** [plan.md](../plan.md) · **Certificate:** [55-analytics_status_command-certificate.md](55-analytics_status_command-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics plugin → Namespace and commands (Add)](../../../changes/2026-07-26-analytics_plugin.md) ("`analytics status` — the plugin's nodes against its scoped state, plus the Firehose stream's delivery health and the table's current row count") and §Ports → `AnalyticsQuery` (Add) (the row count crosses the port; DuckDB never appears in domain code)
**Depends on:** 45, 54
**Produces:** `analytics status` lists the twelve nodes present or missing against `state/<env>.analytics.json` in the same pretty/plain split as the site's `status`, and appends the Firehose stream's delivery health and the table's row count, degrading each to a warning when its read fails
**Pointers:** `packages/analytics/src/commands.ts` (task 47 — the `status` body declared there is filled in here), `packages/analytics/src/commands.test.ts` (task 54 — the suite this extends), `packages/analytics/src/nodes.ts` (task 54 — `buildAnalyticsNodes`, whose `read()` this command calls), `packages/analytics/src/ports.ts` (task 45 — the `AnalyticsQuery` port and its fixture-backed fake), `packages/analytics/src/queries.ts` (task 45 — the named set the row count is taken from), `packages/cli/src/commands.ts:301-329` (`status` — the heading, the `pretty` branch at `:303`, the per-node loop and the plain-form contract comment at `:323`), `packages/cli/src/render.ts:59` (`StatusEntry`), `packages/cli/src/render.ts:72` (`renderStatusTree`), `packages/cli/src/commands.ts:250` (the warn-and-continue precedent for one unreadable item inside a listing), `packages/core/src/ports.ts:34-50` (`Terminal` and `isInteractive`, which the plain/pretty split keys off)

## Steps

- [ ] Fill in `status` in `packages/analytics/src/commands.ts`: iterate `buildAnalyticsNodes(ctx)` calling each node's `read(ctx)` and collecting a present/missing entry, so the command needs no import of the CLI's engine — the property that makes a plugin-declared `status` possible under task 16's precedence.
- [ ] Render through the same pretty/plain split as `packages/cli/src/commands.ts:301-329`: a tree when `ctx.ports.terminal.isInteractive`, and one stable line per node otherwise, keeping the plain form the contract for CI and agents.
- [ ] Append the Firehose stream's delivery health from the state the stream node's `read` hydrated (task 51) rather than issuing a second describe path.
- [ ] Append the table's current row count through the `AnalyticsQuery` port, taking the count from task 45's named set — adding it to `packages/analytics/src/queries.ts` if the set does not already carry one, never writing SQL inline in the command.
- [ ] Degrade both extras to a warning line when their read fails, so the node listing still completes — the warn-and-continue shape at `packages/cli/src/commands.ts:250`.
- [ ] Extend `packages/analytics/src/commands.test.ts`: the plain-form listing with a non-interactive terminal asserting the exact lines; a failing stream read and a failing row-count read each asserting a warning and a complete listing; and a never-bootstrapped environment asserting every node reports missing and the command exits 0.

## Definition of done

- [ ] `analytics status` lists each of the twelve nodes as present or missing against `state/<env>.analytics.json`, using the same pretty/plain split as `packages/cli/src/commands.ts:301-329`, with the plain form asserted line by line against a non-interactive terminal because it is the stable contract for CI and agents.
- [ ] The presence loop calls `read()` on the plugin's own nodes and imports no CLI module — `grep -rn "from 'blogwright'" packages/analytics/src/commands.ts` returns nothing — which is what makes a plugin-declared `status` possible under task 16's precedence.
- [ ] The command reports the Firehose stream's delivery health and the table's current row count, the row count obtained through the `AnalyticsQuery` port from task 45's named set rather than SQL written in the command — `grep -rn "@duckdb" packages/analytics/src/commands.ts` returns nothing — and a test with a failing read of either asserts the failure degrades to a warning line while the node listing still completes.
- [ ] Negative space: `analytics status` on an environment that was never bootstrapped reports every node missing and exits 0 rather than throwing, asserted against an empty scoped state.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- commands` inside `packages/analytics`; confirm the plain-mode test asserts twelve lines by node title, that the two degraded cases still show all twelve, and that the never-bootstrapped case asserts a zero exit rather than only the absence of a throw.
