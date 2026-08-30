# Task 46 - The DuckDB AnalyticsQuery adapter with explicit credentials

**Plan:** [plan.md](../plan.md) · **Certificate:** [46-duckdb_query_adapter-certificate.md](46-duckdb_query_adapter-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Ports → `AnalyticsQuery`](../../../changes/2026-07-26-analytics_plugin.md) ("The real adapter wraps `@duckdb/node-api`, attaches the catalog, and maps DuckDB errors into the repo's own vocabulary at the boundary") and §Analytics dashboard → Credentials (DuckDB is given credentials explicitly, resolved through blogwright's existing provider chain, rather than resolving its own)
**Depends on:** 45
**Produces:** `packages/analytics/src/adapters/duckdb-query.ts` - the real `AnalyticsQuery`, attaching the S3 Tables catalog read-only with credentials injected from a `CredentialProvider`, translating every DuckDB error into a repo `Error` naming the query and the attach target, with `@duckdb/node-api` confined to this package
**Pointers:** `packages/analytics/src/adapters/duckdb-query.ts` (new - the only module in the repo that may import `@duckdb/node-api`, until task 61 adds `adapters/duckdb-ingest.ts` beside it), `packages/analytics/src/adapters/duckdb-query.test.ts` (new - the credential-injection and error-translation tests), `packages/analytics/src/ports.ts` (task 45 - the `AnalyticsQuery` interface this implements), `packages/core/src/aws/credentials.ts:9,19,44` (`CredentialProvider`, `createCredentialProvider`, `staticCredentials` - the provider chain and the fixed-credentials test helper), `packages/core/src/adapters/node-fs.ts` (the adapter-shape precedent: vendor surface in, repo `Error` out), `packages/core/src/aws/errors.ts` (`AwsError` - the error-translation vocabulary adapters raise in), `packages/analytics/package.json:25-28` (the dependency list `@duckdb/node-api` joins)

> **ROUTED FINDING - added 2026-08-30 from task 45's implementation.**
> Two things task 45 deliberately left for this task.
> **1. The relation name is your contract to bind.** SQL binds values, not
> identifiers, so task 45 could not splice the configured
> `<namespace>.<table>` into its definitions without committing the exact
> interpolation that module exists to forbid. Every definition therefore reads
> one relation, exported as `PAGE_VIEWS_RELATION`. This adapter holds the
> context and so `resolveAnalyticsConfig(ctx)` - bind that name to the
> configured triple here. Do not reach around task 44's `ENV_DERIVED` seal to
> get the bucket; take the resolver.
> **2. The SQL has never been executed.** There is no adapter before this task,
> so DuckDB dialect correctness is entirely unverified: `FILTER (WHERE ...)`,
> `sum(...) OVER ()`, and `CAST($from AS DATE)` against a DATE column are all
> unexercised. Treat "the query set compiles" as no evidence at all, and
> execute every one of the seven against a real table with real rows. In
> particular verify the unique-visitors query returns per-day counts plus their
> sum, because a dialect difference there fails by returning a plausible
> number rather than an error - and the whole point of that query's shape is
> that a cross-day `COUNT(DISTINCT)` is uncomputable under daily salt rotation.
> **3. One specific dialect risk already spotted.** Task 45's gate flagged the
> bare `$include_bots` in `($include_bots OR NOT coalesce(is_bot, false))` -
> DuckDB may require `CAST($include_bots AS BOOLEAN)` for a bound parameter in
> boolean position. Check it first; it appears in several definitions, and a
> failure there would look like a type error at query time rather than anything
> the query set's own tests could have caught.

## Steps

- [ ] Add `@duckdb/node-api` to `packages/analytics/package.json` dependencies only, and confirm it appears in no other package's manifest.
- [ ] Write `createDuckDbAnalyticsQuery(opts)` in `packages/analytics/src/adapters/duckdb-query.ts` taking the resolved config and a `CredentialProvider`, returning an `AnalyticsQuery` - the interface from task 45 - and nothing wider.
- [ ] Resolve credentials through the injected provider and inject the values into DuckDB's secret statement, so the adapter never lets DuckDB resolve its own chain; take the seam as a constructor parameter so a test can pass `staticCredentials`.
- [ ] Attach the S3 Tables catalog in read-only mode as a named step, so the attach target and its mode are one identifiable call the test can observe.
- [ ] Wrap every DuckDB call in a translation boundary raising the repo's own `Error` with the query name and the attach target in the message; no vendor error object escapes the module.
- [ ] Write `packages/analytics/src/adapters/duckdb-query.test.ts` observing the secret statement built from `staticCredentials` values, asserting the read-only attach, and asserting a vendor failure surfaces as a repo `Error` with context.
- [ ] Construct the adapter only at the plugin's composition root (task 56's dashboard command wires it); leave every domain module importing the port.

## Definition of done

- [ ] The adapter wraps `@duckdb/node-api`, attaches the S3 Tables catalog in read-only mode (asserted), lives under `adapters/`, is constructed only at the plugin's composition root with no domain module importing it, and the port it implements exposes only `run(name, params)` so no write path exists through it.
- [ ] Credentials are passed in explicitly: the adapter takes a `CredentialProvider` resolved through `createCredentialProvider` (`packages/core/src/aws/credentials.ts:19`) and injects the values into DuckDB's secret; a test with `staticCredentials` (`packages/core/src/aws/credentials.ts:44`) observes those exact values reaching the secret statement.
- [ ] DuckDB errors are translated into the repo's own `Error` vocabulary at the boundary, carrying the query name and the attach target, and a negative-space test asserts no vendor error object escapes the adapter.
- [ ] `@duckdb/node-api` is a dependency of `blogwright-analytics` only - `grep -rn "@duckdb" packages/*/package.json` shows one match - and `pnpm knip` reports it used, not unused.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run duckdb-query --reporter=verbose` inside `packages/analytics`; confirm the credential test asserts the literal `staticCredentials` access key and session token reaching the secret statement, and that `grep -rn "@duckdb" packages/analytics/src/` matches only `adapters/duckdb-query.ts` (only files under `adapters/` once task 61 adds `duckdb-ingest.ts` beside it).
