# Done Certificate - Task 46: The DuckDB AnalyticsQuery adapter with explicit credentials

**Task:** [46-duckdb_query_adapter.md](46-duckdb_query_adapter.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 46. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 46) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/analytics/src/adapters/duckdb-query.ts` implements `AnalyticsQuery` against `@duckdb/node-api`, attaching the S3 Tables catalog read-only with credentials injected from a `CredentialProvider`, translating every DuckDB error into a repo `Error` naming the query and the attach target, with the vendor dependency confined to this package.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 45's port contract - `run(name, params)` stays the whole surface and the fixture-backed fake stays substitutable - and must not break the credential provider in `packages/core/src/aws/credentials.ts`, which every other AWS client already resolves through.

## Obligations

- **O1 - Read-only attach, adapter placement, and a read-only surface.**
  - *Claim:* the adapter wraps `@duckdb/node-api`, attaches the catalog read-only (asserted), lives under `adapters/`, is constructed only at the plugin's composition root, and exposes only `run(name, params)`.
  - *Evidence collected:* `duckdb-query.ts:260-262` builds the attach as a whole statement carrying `READ_ONLY`; the test at `duckdb-query.test.ts:186-194` asserts the **emitted statement string** verbatim, not that attach was called. Mutation M2 (delete `, READ_ONLY` from `attachStatement`) killed exactly that test (38 pass / 1 fail), so the assertion is live. `READ_ONLY` is a recognised option of the iceberg attach, not an ignored one: against real DuckDB 1.5.5, `ATTACH '<arn>' … (TYPE iceberg, ENDPOINT_TYPE s3_tables, SECRET …, READ_ONLY)` parses and proceeds to the network (`Forbidden_403` from `s3tables.us-east-1.amazonaws.com/iceberg/v1/config`), while the same attach with `NOT_AN_OPTION` is refused before any network call with `Invalid Configuration Error: Unhandled options found: not_an_option`. `grep -rn "duckdb-query" packages/analytics/src/` matches only `duckdb-query.test.ts` - no domain module imports the adapter, and no composition root exists yet (task 56 wires it), which is what the task's step 7 asks for.
  - *Checks:* `createDuckDbAnalyticsQuery` is declared `: AnalyticsQuery` (`duckdb-query.ts:352`) and the returned object literal carries `run` alone. `Object.keys(adapterOver(recordingConnect()))` is asserted to equal `['run']` (`duckdb-query.test.ts:132-134`); independently reproduced by driving the built adapter - `Object.keys(port) = ["run"]`. No execute/write member exists.
  - *Status:* ☑ SATISFIED

- **O2 - Credentials are injected, not resolved by DuckDB.**
  - *Claim:* the adapter takes a `CredentialProvider` and injects its resolved values into DuckDB's secret; a `staticCredentials` test observes those exact values reaching the secret statement.
  - *Evidence collected:* the provider is a constructor parameter (`DuckDbAnalyticsQueryOptions.credentials`, `duckdb-query.ts:112`), resolved inside `openSession` (`:377`); there is no module-level `createCredentialProvider()` call. `duckdb-query.test.ts:137-150` asserts the secret statement's **bindings** equal the literal `staticCredentials` triple (`AKIAEXAMPLEKEYID`, `wJalrXUtnFEMI-K7MDENG-EXAMPLEKEY`, `FwoGZXIvYXdzEXAMPLESESSIONTOKEN`) plus the region, and `:152-166` asserts the statement **text** is the constant `CREATE OR REPLACE SECRET blogwright_analytics (TYPE s3, PROVIDER config, KEY_ID $access_key_id, SECRET $secret_access_key, REGION $region, SESSION_TOKEN $session_token)` and that no credential value appears in any statement the adapter issued. Mutation M9 (splice `KEY_ID '<accessKeyId>'` instead of binding it) killed that second test, so the negative assertion is live.
  - *Checks:* no `process.env`, no `AWS_*` read, and no `credential_chain` provider anywhere in the module (grep: none). The secret is `PROVIDER config`, i.e. explicit values; `ATTACH … SECRET blogwright_analytics` names the secret rather than letting DuckDB pick by scope. Verified against real DuckDB that `CREATE SECRET` genuinely accepts `$name` placeholders and that the bound values land in the secret: `duckdb_secrets()` reports `key_id=AKIAEXAMPLEKEYID;region=eu-west-2;secret=redacted;session_token=redacted`. The stated reason for binding was also confirmed rather than assumed - DuckDB's parser echoes the offending line, so a spliced credential would reach a message: `CREATE OR REPLACE SECRET s2 (… KEY_ID 'AKIALEAKYVALUE', SECRET 'topsecretvalue' BROKEN)` returns `Parser Error: syntax error at or near "BROKEN"` followed by `LINE 1: … KEY_ID 'AKIALEAKYVALUE', SECRET 'topsecretvalue' BROKEN)`.
  - *Status:* ☑ SATISFIED

- **O3 - Vendor errors are translated at the boundary.**
  - *Claim:* DuckDB failures surface as the repo's own `Error` carrying the query name and the attach target; no vendor error object escapes.
  - *Evidence collected:* seven error-translation tests (`duckdb-query.test.ts:317-415`) force failures at each step and assert the full message, e.g. `analytics query "cache-hit-ratio" against arn:aws:s3tables:us-east-1:123456789012:bucket/production-example-analytics failed while attaching the catalog read-only: 403 Forbidden`. The negative-space test asserts `instanceof Error`, `not.toBeInstanceOf(VendorError)`, `not.toBe(vendorError)`, `cause` undefined, and no `vendorHandle` own property. Mutation M8 (add `{ cause: err }` to `contextualise`) killed it; mutation M7 (disable redaction) killed the redaction test. Independently reproduced against real DuckDB and real AWS: the built adapter raised `constructor: Error`, prototype exactly `Error.prototype`, `cause: undefined`, own properties `["stack","message"]`, message naming the query and the ARN, and none of the three credential values present in the message or the stack.
  - All five catches (`:371, :396, :405, :426, :431`) re-raise with more information; none swallows. The deliberate divergence from `node-fs.ts:13`'s `contextualise` - no `cause` - is **justified and load-bearing, not stylistic**: DuckDB's parser echo (proved under O2) means the vendor message can carry a credential, and `err.cause.message` is exactly what Node's default uncaught-exception rendering and `console.error(err)` print. Attaching `cause` would reinstate the unredacted string the redactor exists to remove, so following the `node-fs` precedent here would defeat the property. Nothing diagnostic is lost: the vendor's own words are preserved verbatim, redacted, inside the raised message. DEVELOPMENT.md §Error handling requires context and "never log a secret in that context"; it does not require `cause`.
  - *Status:* ☑ SATISFIED

- **O4 - The vendor dependency is confined and used.**
  - *Claim:* `@duckdb/node-api` is a dependency of `blogwright-analytics` only, and `pnpm knip` reports it used.
  - *Evidence collected:* `grep -rn "@duckdb" packages/*/package.json` → exactly one match, `packages/analytics/package.json:22`. `grep -rn "@duckdb" packages/analytics/src/` → three lines, all in `adapters/duckdb-query.ts` (`:4`, `:46` the import, `:320`). Checked at import level rather than by string match, which is the property that actually matters: no `import`/`require`/dynamic import of anything duckdb-shaped exists in `packages/core/src`, `packages/cli/src`, `packages/pds/src` or `packages/build-agent/src`, and none in `packages/analytics/src` outside the adapter. `pnpm knip` from the repo root is clean.
  - The convention of naming the package in prose rather than spelling the specifier (`duckdb-query.test.ts:300-305`) is **honest, not evasive**: it was established by task 45's `ports.ts:6-12`, which is byte-identical to its tip and predates this task; the test file is new, so nothing pre-existing was rewritten to clear a grep; the choice is stated in the file with its reason; and the underlying property holds under an import-level check that does not depend on the string at all. `knip`'s report is a live signal, not a vacuous one: replacing the vendor import with a local stub made `pnpm knip` report `Unused dependencies (1) @duckdb/node-api  packages/analytics/package.json:22:6` and exit non-zero. Restored, hash-verified.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the workspace root, all six gates green - `pnpm build` (all 5 packages + docs), `pnpm test` (core, analytics 421/13 files, pds 117, cli 317, build-agent 27; zero failures), `pnpm lint` (exit 0; the only warnings are pre-existing `no-shadow` in `packages/cli/src/nodes.test.ts`), `pnpm typecheck` (all packages), `pnpm exec oxfmt --check .` ("All matched files use the correct format", 172 files), `pnpm knip` (clean). `pnpm install --frozen-lockfile` is "Already up to date" with **no ignored-build-script warning** - the certificate's Residue concern is discharged: `@duckdb/node-api`, `@duckdb/node-bindings` and the platform binary packages all declare empty `scripts`, so `pnpm-workspace.yaml`'s `allowBuilds` needs no entry. Constants are named (`CATALOG_ALIAS`, `SECRET_NAME`, `REQUIRED_EXTENSIONS`, `REDACTED`, `PAGE_VIEWS_RELATION_PATTERN`); the integer limit is `Number.isSafeInteger`, not a spelled number.
  - *Changeset:* none, and the implementer flagged rather than decided. **Ruling: acceptable for this task, but one should be added before the next release.** The plan baseline conditions a changeset on the change being user-facing, and nothing here is user-reachable - no composition root constructs the adapter until task 56, and `index.ts` does not export it - which is why tasks 36/38/40/41/45 shipped none. But this is the first of them to add an **install-time** fact, and `.changeset/config.json` puts `blogwright-analytics` in the `fixed` group with `access: public`, so the next `blogwright` release publishes it with a native dependency that pulls eight platform binary packages, whether or not a changeset names it. Existing changesets already target non-CLI packages (`blogwright-core` ×6, `blogwright-pds` ×1), so there is no convention against one. Recorded as a should-fix, not an O5 failure.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: literal credentials in the secret statement, vendor import in one file (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- duckdb-query` inside `packages/analytics` and observe the credential test asserting the literal `staticCredentials` access key and session token in the secret statement, and confirm `grep -rn "@duckdb" packages/analytics/src/` matches only `adapters/duckdb-query.ts`.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run duckdb-query --reporter=verbose` → **39 passed / 39**, in 762ms. The literal values are spelled once in the fixture (`duckdb-query.test.ts:46-50`) and asserted by name in the bindings (`:143-148`) and by absence from the statement text (`:163-165`). The grep returns three lines, all in `adapters/duckdb-query.ts`.
  - *Status:* ☑ SATISFIED

## Routed finding from task 45 - discharged separately

The task file carries a three-item routed finding. All three were checked directly rather than accepted from the implementation report.

1. **The relation name is bound here.** `createDuckDbAnalyticsQuery` calls `resolveAnalyticsConfig(opts.ctx)` itself (`duckdb-query.ts:353`); the options type carries `ctx`, `credentials`, `connect` and **no config or bucket field**, so no caller can hand it an env-less name and task 44's `ENV_DERIVED` seal is not reached around. The assertion that the environment survives is live: mutation M12 (drop `env` from `defaultTableBucket` in `config.ts`) reddened four tests including *"takes the attach target from the environment-carrying config, so two environments differ"*, which pins `bucket/staging-example-analytics` against `bucket/production-example-analytics`. The staging-deletes-production hazard is therefore covered by an assertion that can fail.
2. **The SQL has now been executed.** The second half of the test file runs the *real* `connectDuckDb` against a local `page_views` table shaped from `schema.ts` (`day DATE`, `status INTEGER`, `is_bot BOOLEAN` nullable, the rest `VARCHAR`) with nine fixture rows straddling the range, and executes all seven definitions over it. Confirmed real, not a fake: `SELECT 9007199254740993::HUGEINT` raises the adapter's own message, `DATE '2026-08-01'` reads back as the string `2026-08-01`, and an independent probe drove the built adapter through real DuckDB 1.5.5 end to end. **`unique-visitors` genuinely discriminates**: the fixture returns per-day `2, 2, 1` with `summed_daily_unique_visitors = 5` on every row, while a cross-day `count(DISTINCT visitor_key)` pinned beside it in the same test returns `3` - the two disagree, so the test can tell the shapes apart. Proved by mutation: M13 (`max(…) OVER ()` for `sum(…) OVER ()`) and M14 (`count(DISTINCT …) OVER ()` for the per-day count) each reddened that test. `sum(BIGINT) OVER ()` was confirmed to return HUGEINT, which arrives as a JS `bigint` and converts to `number`.
3. **The `$include_bots` risk is refuted, and the refutation was reproduced.** Against real DuckDB 1.5.5, `SELECT typeof($include_bots)` with a bound JS `true` returns `BOOLEAN`, and `WHERE ($include_bots OR NOT coalesce(is_bot, false))` returns 3 rows bound `true` and 2 rows bound `false` over the same table. No `CAST` is required. Mutation M16 (add `CAST($include_bots AS BOOLEAN)` to all seven definitions) changed no result, confirming the cast is unnecessary rather than merely tolerated.

## Falsifiability - independent mutation sweep

The implementation report's 42-mutation table was **not** accepted. An independent 17-run sweep was executed by a harness that aborts if a pattern is not found exactly once (it did abort once, on an ambiguous pattern, and was corrected). A control run before the sweep gave 39 passed / 0 failed.

| Mutation | Result |
| --- | --- |
| M0 control (no edit) | 39 pass, 0 fail |
| M1 `quoteIdentifier` returns the bare identifier | 7 killed |
| M2 drop `READ_ONLY` from the attach | 1 killed (the read-only test) |
| M3 never raise past `MAX_SAFE_INTEGER` | 1 killed |
| M4 SQL NULL no longer dropped | 1 killed |
| M5 drop `\b` word boundaries from the relation pattern | 1 killed |
| M6 allow a statement that binds no relation | 1 killed |
| M7 disable redaction | 1 killed |
| M8 attach `{ cause: err }` in `contextualise` | 1 killed (negative-space test) |
| M9 splice the access key instead of binding it | 1 killed |
| M10 swap extension load order | 1 killed |
| M11 hard-code the region in the ARN | 1 killed |
| M12 drop `env` from the derived bucket | 4 killed |
| M13 `max` instead of `sum` in `unique-visitors` | 2 killed |
| M14 cross-day distinct instead of per-day | 4 killed |
| M15 treat `sessionToken: ''` as absent | **0 killed** (uncovered - honestly disclosed) |
| M16 add `CAST($include_bots AS BOOLEAN)` | 0 killed (no behaviour change) |

Every mutation of a claimed property was killed by the test that claims it. The one uncovered case, M15, is exactly the one the implementer disclosed rather than hid. No assertion sampled was found unable to fail. All mutations restored; restore proved by `shasum -a 256 -c` over `duckdb-query.ts`, `duckdb-query.test.ts`, `queries.ts`, `config.ts` and `package.json` (5/5 OK) and by `jj status` showing the same four paths.

## Regression check

- `packages/analytics/src/ports.ts` `AnalyticsQuery` is implemented by both the fixture-backed fake (task 45) and this adapter → **PRESERVED**. `ports.ts`, `queries.ts` and `queries.test.ts` are **byte-identical** to the parent commit (sha256 compared against `jj file show -r @-`); task 45's suite is 76 passed / 76; `pnpm typecheck` is clean, so both implementations still satisfy the unchanged interface : ☑ PRESERVED
- `packages/core/src/aws/credentials.ts:19` `createCredentialProvider` is called by the CLI's composition root for every AWS client → **PRESERVED**. Untouched by this diff (the four changed paths are `packages/analytics/package.json`, the two new adapter files, and `pnpm-lock.yaml`); core's suite passes : ☑ PRESERVED
- `packages/analytics/package.json` dependencies feed `pnpm -r build` and `pnpm knip` → **PRESERVED**. `pnpm build` and `pnpm knip` are green across all five packages; `pnpm install --frozen-lockfile` is a no-op with no warning; the lockfile's 94 added lines are entirely the `@duckdb/*` importer entry, package entries and snapshots, with **zero deletions** and no other package's resolution changed (`detect-libc@2.1.2` was already present) : ☑ PRESERVED

## Integration

The task's base is `db8db370` (build 36/62, task 45); the bookmark `plugin-system-and-analytics` is at `8a052a5e` (build 39/62, task 48), with tasks 42, 19 and 48 landed since. Those builds touch `packages/analytics/src/nodes.ts`, `packages/analytics/src/transform/handler.ts`, seven `packages/cli/src` files and one changeset - **no overlap** with any of this task's four paths. `git merge-tree --write-tree` of the two heads produced a tree with no conflict section and exit 0. `packages/analytics/src/index.ts` is identical at both heads, so nothing this task changes is pinned or re-exported elsewhere.

## Residue

- **Correctness concern raised outside the DoD (see the separate correctness verdict).** `tableBucketArn` (`duckdb-query.ts:216-218`) interpolates `ctx.config.region` into the ARN, and `attachStatement` (`:260-262`) splices that ARN into the statement as a single-quoted literal. `region` is the only one of the three components with no character validation - `packages/core/src/config.ts:306` checks only `if (!cfg.region)`, while `tableBucket` is held to `^[0-9a-z-]{3,63}$` and `accountId` comes from STS. `@duckdb/node-api`'s `runAndReadAll` executes multiple statements in one call, so a `'` in `region` closes the literal and appends arbitrary SQL, executed in a session that has already loaded the operator's AWS credentials as a DuckDB secret with `httpfs` loaded. Demonstrated end to end offline through the unmodified built adapter. Not a DoD item and not a live exploit in the primary flow, but it is the one splice the module's own "values are bound, not spelled" reasoning does not cover, and the fix is one line.
- `SESSION_TOKEN` with an empty string: `credentials.sessionToken !== undefined` (`:242`) pushes the clause with `''`. Confirmed against real DuckDB that this creates a secret carrying an empty token rather than erroring, so the request would fail at AWS. **Second opinion: keep `!== undefined`.** `AwsCredentials.sessionToken?: string | undefined` spells absence one way, and inventing `''` as a second spelling would silently reinterpret a broken provider's output; failing loudly at AWS with a message naming the query and the attach target is the better outcome. `redactorFor` (`:271-279`) already filters empty values, so an empty token cannot cause an over-broad redaction either. No change needed.
- The AWS attach cannot be exercised offline, and the DoD does not ask it to be. A scratch probe drove the real adapter through real DuckDB 1.5.5: every statement - `INSTALL`/`LOAD httpfs`, `INSTALL`/`LOAD iceberg`, `CREATE OR REPLACE SECRET`, `ATTACH … READ_ONLY` - parsed and executed, failing only at AWS with `Forbidden_403`. **Acceptable for this DoD.** What remains unverified is whether a real S3 Tables catalog accepts this exact attach - `ENDPOINT_TYPE s3_tables` availability and Lake Formation grants are recorded in the change spec as assumptions, not as this task's obligations, and the port exists precisely so a syntax move lands in one file.
- No changeset. Ruled acceptable for this task, recommended before the next release - see O5.
- The real-DuckDB half calls `prepareQuery` + `bindPageViewsRelation` + `connection.run` directly rather than through `adapter.run`, which is unavoidable offline. The bridge is that the recording half asserts the adapter's own bindings and bound relation for all seven definitions, so the two halves together cover the path `adapter.run` takes. Worth keeping in mind if `run` ever stops delegating to those two functions.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied on independently reproduced evidence - the seven definitions execute against real DuckDB 1.5.5 with a fixture whose summed daily uniques (5) and cross-day distinct (3) genuinely disagree, the bare `$include_bots` binds as `BOOLEAN` and needs no `CAST`, credentials reach `CREATE SECRET` as bind values and appear nowhere in any statement text, `READ_ONLY` is a recognised attach option rather than an ignored one, no vendor error or `cause` escapes, the vendor dependency is confined to one file with `knip` proved live, all six gates are green, `queries.ts` is byte-identical with its 76 tests passing, and a 17-mutation sweep with a control killed every claimed property - so the definition of done is met; merge is nonetheless gated by the separate correctness verdict (CONCERNS), which names one unvalidated interpolation of `config.region` into the attach statement.
