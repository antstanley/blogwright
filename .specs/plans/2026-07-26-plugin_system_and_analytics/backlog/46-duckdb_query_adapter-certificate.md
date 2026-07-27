# Done Certificate — Task 46: The DuckDB AnalyticsQuery adapter with explicit credentials

**Task:** [46-duckdb_query_adapter.md](46-duckdb_query_adapter.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 46. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 46) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `packages/analytics/src/adapters/duckdb-query.ts` implements `AnalyticsQuery` against `@duckdb/node-api`, attaching the S3 Tables catalog read-only with credentials injected from a `CredentialProvider`, translating every DuckDB error into a repo `Error` naming the query and the attach target, with the vendor dependency confined to this package.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break task 45's port contract — `run(name, params)` stays the whole surface and the fixture-backed fake stays substitutable — and must not break the credential provider in `packages/core/src/aws/credentials.ts`, which every other AWS client already resolves through.

## Obligations

- **O1 — Read-only attach, adapter placement, and a read-only surface.**
  - *Claim:* the adapter wraps `@duckdb/node-api`, attaches the catalog read-only (asserted), lives under `adapters/`, is constructed only at the plugin's composition root, and exposes only `run(name, params)`.
  - *Evidence to collect:* read `packages/analytics/src/adapters/duckdb-query.ts` and confirm the attach statement carries the read-only mode; run `pnpm test -- duckdb-query` in `packages/analytics` › the read-only test and confirm it asserts the emitted attach statement, not merely that attach was called; run `grep -rn "duckdb-query" packages/analytics/src/` and confirm the only importers are the composition root and the test.
  - *Checks:* resolve the return type of the factory — confirm it is the `AnalyticsQuery` interface from `packages/analytics/src/ports.ts`, not a wider object exposing an execute/write method.
  - *Status:* ☐ unverified

- **O2 — Credentials are injected, not resolved by DuckDB.**
  - *Claim:* the adapter takes a `CredentialProvider` and injects its resolved values into DuckDB's secret; a `staticCredentials` test observes those exact values reaching the secret statement.
  - *Evidence to collect:* read the factory signature and confirm the provider is a parameter, not a module-level `createCredentialProvider()` call; run `pnpm test -- duckdb-query` › the credential test and confirm it asserts the literal access key, secret key and session token from `staticCredentials` (`packages/core/src/aws/credentials.ts:44`) appear in the secret statement the adapter builds.
  - *Checks:* resolve the credentials source inside the adapter — confirm no path reads `process.env.AWS_*` and no DuckDB option enables the vendor's own credential chain.
  - *Status:* ☐ unverified

- **O3 — Vendor errors are translated at the boundary.**
  - *Claim:* DuckDB failures surface as the repo's own `Error` carrying the query name and the attach target; no vendor error object escapes.
  - *Evidence to collect:* run `pnpm test -- duckdb-query` › the error-translation test and confirm it forces a failure and asserts both the error's constructor is a repo `Error` type and the message contains the query name and the attach target; read every `catch` in the module and confirm each re-raises with added context rather than swallowing, per DEVELOPMENT.md §Use exceptions, not return codes.
  - *Status:* ☐ unverified

- **O4 — The vendor dependency is confined and used.**
  - *Claim:* `@duckdb/node-api` is a dependency of `blogwright-analytics` only, and `pnpm knip` reports it used.
  - *Evidence to collect:* run `grep -rn "@duckdb" packages/*/package.json` — expect exactly one match, in `packages/analytics/package.json`; run `grep -rn "@duckdb" packages/analytics/src/` — expect matches only in `adapters/duckdb-query.ts` (only under `adapters/` once task 61 adds `duckdb-ingest.ts` beside it); run `pnpm knip` from the repo root and confirm it reports neither an unused nor an undeclared dependency for the package.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: literal credentials in the secret statement, vendor import in one file (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- duckdb-query` inside `packages/analytics` and observe the credential test asserting the literal `staticCredentials` access key and session token in the secret statement, and confirm `grep -rn "@duckdb" packages/analytics/src/` matches only `adapters/duckdb-query.ts` (only files under `adapters/` once task 61 adds `duckdb-ingest.ts` beside it).
  - *Evidence to collect:* run `pnpm test -- duckdb-query` from `packages/analytics` and capture the output; open `packages/analytics/src/adapters/duckdb-query.test.ts` and read the literal credential values in both the fixture and the assertion; run the grep and capture its single-file result.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/ports.ts` `AnalyticsQuery` is implemented by both the fixture-backed fake (task 45) and this adapter → expect both to typecheck against the unchanged interface and task 45's suite to pass : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/aws/credentials.ts:19` `createCredentialProvider` is called by the CLI's composition root for every AWS client → expect its behaviour and signature unchanged by this task : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/package.json` dependencies (edited here) feed `pnpm -r build` and `pnpm knip` → expect the four existing packages' installs and gates to be unaffected by the new native dependency : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: `@duckdb/node-api` is a native dependency, so `pnpm-workspace.yaml`'s `allowBuilds` list may need an entry for its postinstall; that is not in the DoD — note it if `pnpm install` warns about an ignored build script. How the adapter observes its own SQL for the credential and read-only assertions (an injected statement sink versus an in-memory DuckDB instance) is unconstrained, but an in-memory instance would contradict task 45's "no test starts DuckDB" obligation for the package's other suites — flag it if the adapter test starts one. Lake Formation grants and `ENDPOINT_TYPE 'S3_TABLES'` availability are spec assumptions, not obligations here.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
