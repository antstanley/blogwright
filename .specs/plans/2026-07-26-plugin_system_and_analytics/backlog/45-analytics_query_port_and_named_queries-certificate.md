# Done Certificate — Task 45: The AnalyticsQuery port and the fixed named query set

**Task:** [45-analytics_query_port_and_named_queries.md](45-analytics_query_port_and_named_queries.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 45. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 45) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `AnalyticsQuery` (`run(name, params)`) and the fixed named query set exist in the plugin's own modules, every definition parameterised rather than interpolated, with a fixture-backed fake every consumer test uses and no DuckDB started anywhere in the package's suite.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break task 44's config surface — the bot-inclusion default is read from `config.analytics.bots`, not restated — nor task 39's `schema.ts`, whose column names the query SQL must reference rather than re-spell in a second vocabulary.

## Obligations

- **O1 — The port is declared in the plugin's own module and hides the vendor.**
  - *Claim:* `AnalyticsQuery` is `run(name, params)` returning rows, declared in `packages/analytics/src/ports.ts`, and no domain module imports `@duckdb/node-api`.
  - *Evidence to collect:* read `packages/analytics/src/ports.ts` and confirm the interface exposes `run` and nothing that leaks a DuckDB type into the signature; run `grep -rn "@duckdb" packages/analytics/src/` — expect no match outside `adapters/`; run `pnpm knip` from the repo root and confirm no unused or undeclared dependency for the package.
  - *Checks:* resolve the row type in `run`'s return position — confirm it is a repo-owned type, not a vendor result type re-exported through the port.
  - *Status:* ☐ unverified

- **O2 — The named set is complete and every definition is parameterised.**
  - *Claim:* the set covers views over time, top paths, referrers, countries, status codes, cache hit ratio and unique visitors by `visitor_key`; each takes a date range and a bot-inclusion flag defaulting from `config.analytics.bots`; and a test iterating the whole set asserts no interpolated caller value in any SQL text.
  - *Evidence to collect:* read `packages/analytics/src/queries.ts` and set-compare the query names against the seven the spec lists in §Analytics dashboard → Local server; run `pnpm test -- queries` in `packages/analytics` and confirm the parameterisation assertion iterates the set (assert its iteration count equals the set size, not a hardcoded sample); confirm the bot default is read from the config module, not a literal.
  - *Status:* ☐ unverified

- **O3 — Unknown name and bad date range both raise.**
  - *Claim:* an unknown query name raises an error listing the available names, and an absent or inverted date range raises rather than silently defaulting; both messages name the offending value.
  - *Evidence to collect:* run `pnpm test -- queries` › the unknown-name case and confirm the asserted message enumerates the available names; run the inverted-range and absent-range cases and confirm each asserts a throw with the offending value in the message — a test asserting only that something threw does not satisfy this obligation.
  - *Status:* ☐ unverified

- **O4 — A fixture-backed fake, and no DuckDB in the suite.**
  - *Claim:* a fixture-backed fake `AnalyticsQuery` ships beside the port, every consumer test substitutes at the port, and no test in the package starts DuckDB.
  - *Evidence to collect:* read the fake and confirm it implements the same `run(name, params)` signature and returns fixture rows; run `grep -rn "duckdb" packages/analytics/src/*.test.ts packages/analytics/src/transform/*.test.ts` — expect no output; run `grep -rn "vi.mock" packages/analytics/` — expect no output, since substitution happens at the port.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: an interpolating query fails the parameterisation test (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- queries` inside `packages/analytics`, add a query definition that interpolates a parameter into its SQL text, and observe the parameterisation test fail naming that query.
  - *Evidence to collect:* run `pnpm test -- queries` from `packages/analytics` and capture the passing output; add a definition whose SQL embeds a template placeholder for a caller value, re-run, and capture the failure message — expect the offending query's name in it; remove the definition and re-run to confirm green.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/config.ts` (task 44) supplies the `bots` default read by the query parameter defaulting → expect task 44's config suite to pass unchanged and the default to come from the shared constant : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/index.ts` re-exports the package surface → expect `pnpm knip` to report no unused export after `ports.ts` and `queries.ts` are added : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the SQL dialect is DuckDB's, but no adapter exists until task 46, so the query text is unexecuted here — the obligations check parameterisation and totality, not that each statement runs. Whether the queries reference the table through a configured catalog/namespace/table triple or a hardcoded name is unconstrained by the DoD; a hardcoded `page_views` contradicts task 44's configurable `table` and is worth flagging as residue. Pagination and row limits for the dashboard are not covered.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
