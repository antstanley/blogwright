# Done Certificate — Task 55: The loopback dashboard server and the analytics dashboard command

**Task:** [55-dashboard_server_and_command.md](55-dashboard_server_and_command.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 55. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 55) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `packages/analytics/src/server.ts` is the package's only `node:http` importer, bound to `127.0.0.1` on the configured port with no route that accepts SQL, and the `analytics dashboard` command constructs the DuckDB adapter at the plugin's composition root, prints the URL, and releases the listener on shutdown.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the plugin's four other actions in `packages/analytics/src/plugin.ts` (task 47's command table, still validated by core's `validatePlugin` at the discovery boundary), the named query set and its parameter validation in `packages/analytics/src/queries.ts` (task 45, which must stay free of `node:http`), or the DuckDB adapter's credential injection in `packages/analytics/src/adapters/duckdb-query.ts` (task 46).

## Obligations

- **O1 — Loopback bind, configured port, printed URL, clean shutdown.**
  - *Claim:* the server binds `127.0.0.1` on `config.analytics.dashboard.port`, the command prints the resolved URL, and the shutdown path releases the listener.
  - *Evidence to collect:* read the `listen` call in `packages/analytics/src/server.ts` and confirm the host argument is the loopback constant and the port argument is the caller-supplied resolved config value, with no `process.env` read; run `pnpm test -- server` inside `packages/analytics` and expect the bind-address test, the port-from-config test, and the rebind-after-close test to pass; read the `dashboard` handler in `packages/analytics/src/commands.ts` and confirm the URL reaches `ctx.logger.info`.
  - *Checks:* resolve the port expression at the `listen` call — confirm it traces back to task 44's resolved `AnalyticsConfig` and its exported default constant, not to a numeric literal, an environment variable, or a second copy of `4317`.
  - *Status:* ☐ unverified

- **O2 — Named queries only; no route accepts SQL.**
  - *Claim:* an unknown query name returns 404 listing the available names, and SQL supplied by the client is rejected before the `AnalyticsQuery` port is reached.
  - *Evidence to collect:* read every route registration in `packages/analytics/src/server.ts` and confirm each resolves a name through task 45's lookup with no branch reading a request body or query parameter as SQL; run `pnpm test -- server` › the unknown-name test and the SQL-rejection tests and expect the 404 body to contain the available names and the fixture-backed fake to record zero `run` calls in the SQL cases.
  - *Checks:* trace the SQL-carrying request through the handler — confirm rejection happens in the routing layer, before any call into `queries.ts` or the port, so no code path could reach the adapter with caller text.
  - *Status:* ☐ unverified

- **O3 — Date range and bot flag pass through as parameters.**
  - *Claim:* each query route parses a date range and a bot-inclusion flag, validates them at the request boundary, and hands them to `AnalyticsQuery.run(name, params)` unmodified.
  - *Evidence to collect:* run `pnpm test -- server` › the parameter-passthrough test and read its assertion — expect it to compare the `params` object the fixture fake received against the values sent in the request, field by field; run the invalid-range test and expect a rejection naming the offending value rather than a silent default.
  - *Status:* ☐ unverified

- **O4 — Edge module and single construction site.**
  - *Claim:* the listener is the package's edge module and the DuckDB adapter is constructed only at the plugin's composition root.
  - *Evidence to collect:* run `grep -rn "node:http\|node:fs\|@duckdb" packages/analytics/src/` — expect `node:http` to match `server.ts` only, `@duckdb` to match `adapters/duckdb-query.ts` only, and `node:fs` to match nothing outside the edge; run `grep -rn "createDuckDbAnalyticsQuery" packages/analytics/src/` — expect the definition plus exactly one call site, in the `dashboard` handler.
  - *Checks:* resolve the `query` argument passed to `createDashboardServer` at that call site — confirm it is the port-typed adapter constructed there, not an import of the adapter module inside `server.ts` or `queries.ts`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- server` inside `packages/analytics`, then `grep -rn "0.0.0.0\|node:http" packages/analytics/src/` (Reviewable).**
  - *Claim:* a reviewer can run the package's server suite and the grep and observe that `node:http` is confined to `server.ts`, that no `0.0.0.0` appears, and that removing the unknown-name guard makes the 404 test fail naming the requested query.
  - *Evidence to collect:* run the two commands and record the output; then delete the unknown-name guard in `packages/analytics/src/server.ts`, re-run `pnpm test -- server`, confirm the 404 test fails with the query name in the message, and restore the guard.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts` (task 10's plugin fall-through) dispatches `blogwright analytics status` against the plugin whose table now carries a fifth action → expect task 54's status output, unchanged : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/plugin.ts` default export passes core's `validatePlugin` at the discovery boundary with the `dashboard` entry present → expect validation to pass and all five actions to be listed : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/queries.ts` is imported by `server.ts` for its lookup → expect `pnpm test -- queries` to still pass and `queries.ts` to import no `node:http` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the static-asset branch serves task 56's `dist/app`, which does not exist until that task lands — confirm the server degrades with a clear error rather than a stack trace when `appDir` is absent, though the DoD does not require it. Concurrency (two dashboards on the same port) and an occupied-port failure message are outside the obligations. The SIGINT handler is a process-level side effect registered by the command; whether it should be a port is a question the DoD does not settle.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
