# Done Certificate - Task 46: The DuckDB AnalyticsQuery adapter with explicit credentials

**Task:** [46-duckdb_query_adapter.md](46-duckdb_query_adapter.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 46. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

> **Second discharge, 2026-08-30.** The first discharge recorded DONE with a separate
> correctness verdict of CONCERNS, naming one defect: `config.region` reaching the `ATTACH`
> statement as an unescaped single-quoted literal, i.e. arbitrary SQL execution in a session
> already holding the operator's AWS credentials. This discharge re-runs the completeness
> protocol over the delta that closes it and records the correctness verdict as CORRECT. The
> delta is three hunks: `quoteLiteral` (`duckdb-query.ts:203-205`), `attachStatement` calling it
> (`:286-288`), and one new `describe` block of three tests
> (`duckdb-query.test.ts:703-777`). Everything the first discharge established over the base was
> re-derived only where the delta could have disturbed it; the rest is inherited and marked so.

## Definition

DONE(Task 46) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/analytics/src/adapters/duckdb-query.ts` implements `AnalyticsQuery` against `@duckdb/node-api`, attaching the S3 Tables catalog read-only with credentials injected from a `CredentialProvider`, translating every DuckDB error into a repo `Error` naming the query and the attach target, with the vendor dependency confined to this package.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 45's port contract - `run(name, params)` stays the whole surface and the fixture-backed fake stays substitutable - and must not break the credential provider in `packages/core/src/aws/credentials.ts`, which every other AWS client already resolves through.

## The closed defect - arbitrary SQL through the attach literal

The defect and the fix were both reproduced from scratch by this gate, in both directions, through the adapter's own `connectDuckDb().run` rather than a hand-rolled DuckDB harness. A control ran before every mutation.

**Control (fix in place).** `pnpm --filter blogwright-analytics exec vitest run duckdb-query --reporter=verbose` from `packages/analytics`: **42 passed / 42**.

**The exploit, pre-fix.** Mutating `quoteLiteral` to `` return `'${value}'` `` (the pre-fix text of `attachStatement`, byte-for-byte in effect) and driving the *unmodified* adapter with the briefed payload

```
region: `x' AS "inj" (TYPE duckdb); COPY (SELECT 42 AS pwned) TO '<tmp>/…csv'; ATTACH '`
```

produced the statement list

```
ATTACH 'arn:aws:s3tables:x' AS "inj" (TYPE duckdb); COPY (SELECT 42 AS pwned) TO '<tmp>/…csv'; ATTACH ':123456789012:bucket/production-example-analytics' AS "analytics" (TYPE iceberg, …, READ_ONLY)
```

and **INJECTED STATEMENT RAN: true** - both side effects observed on disk: the smuggled `ATTACH` created a 12 KB DuckDB database file, and the `COPY` wrote its CSV. The call failed only at the *third* statement, with `Invalid Input Error: Could not parse S3 Tables ARN warehouse value` - exactly the statement-3 ARN-parse failure the implementer reported, and proof that statements one and two had already executed. Both files were deleted.

**After the fix.** The same payload through the same path yields one statement whose entire payload sits inside a single literal, and the error moves to `Invalid Input Error: Could not parse AWS service from host: s3tables.x' AS "inj" (TYPE duckdb); COPY … .amazonaws.com/iceberg` - a single-statement host-parse failure, with **INJECTED STATEMENT RAN: false** and no file of either name on disk. The observed behaviour changed; the fix is not demonstrated only in the "after" direction.

**Five further shapes of this gate's own devising**, each run against the fix and then against the same mutation:

| Shape | Payload idea | Pre-fix | Post-fix |
| --- | --- | --- | --- |
| B | multi-statement with **no** `TYPE` clause (default is duckdb) | statement 1 executed, failed on extension inference | no injection; single literal |
| C | `x' AS "c" (TYPE duckdb) --` - a line comment truncating the option list | **ran with no error at all**, silently creating a local database file | no injection; single literal |
| C2 | `/*` block comment swallowing the option list | parse error (unterminated comment) | no injection |
| D | an **already-doubled** `''` in the input, to defeat a one-pass or self-re-scanning escaper | parse error | escaped to `''''`, round-trips as `''` |
| E | `\'` - a backslash before the quote | **ran**; DuckDB gives backslash no escaping meaning | no injection; single literal |
| F | `$$` dollar-quoting, DuckDB's other literal form | not reachable behind a leading `'` | not reachable |

Shape C is worth naming: pre-fix it produced a *successful, silent* attach of an attacker-named local database, with no error for an operator to notice. It is now blocked.

**A general property, not a payload list.** Twelve regions - `'`, `''`, `'''`, `a''b`, `a'''b`, `a\b`, `a\'b`, `'; DROP TABLE x; --`, `us-east-1'--`, `$$a$$`, `a' || 'b`, and a plain one - were pushed through the adapter and read back by `SELECT <target> AS target` in real DuckDB 1.5.5. All twelve returned the ARN **byte-for-byte**, one row, one column named `target`. `quoteLiteral` is therefore injective and faithful to DuckDB's only string escape, not merely proof against the shapes tried. Under the mutation this same check fails.

All exploit artefacts (`packages/analytics/arn:aws:s3tables:*` and `<tmp>/blogwright-analytics-injected-*.csv`, `<tmp>/gate46-*.csv`) were deleted; the directories are confirmed empty of them.

## Obligations

- **O1 - Read-only attach, adapter placement, and a read-only surface.**
  - *Claim:* the adapter wraps `@duckdb/node-api`, attaches the catalog read-only (asserted), lives under `adapters/`, is constructed only at the plugin's composition root, and exposes only `run(name, params)`.
  - *Evidence collected:* inherited from the first discharge, and re-checked where the delta touches it. The delta changes `attachStatement` (`duckdb-query.ts:286-288`), so the read-only assertion was re-run: *"attaches the S3 Tables catalog read-only, against the secret it just created"* asserts the emitted statement verbatim and is green, unchanged in text - `quoteLiteral` is the identity on an ARN with no quote in it, so no legitimate attach target renders differently. Inherited without re-derivation: that `READ_ONLY` parses while `NOT_AN_OPTION` is refused pre-network; that `Object.keys(port)` is `["run"]`. Re-checked here: `grep -rn "createDuckDbAnalyticsQuery\|adapters/duckdb-query" packages/` outside the two new files returns nothing, and `packages/analytics/src/index.ts` does not export the adapter, so no domain module imports it and no composition root exists yet (task 56 wires it).
  - *Status:* ☑ SATISFIED

- **O2 - Credentials are injected, not resolved by DuckDB.**
  - *Claim:* the adapter takes a `CredentialProvider` and injects its resolved values into DuckDB's secret; a `staticCredentials` test observes those exact values reaching the secret statement.
  - *Evidence collected:* untouched by the delta and inherited - credentials travel as bind values, `duckdb_secrets()` shows `secret=redacted`, and the deliberate parse error proving DuckDB's `LINE 1:` echo is real. Re-run here as part of the 42-test suite: the four secret-statement tests are green. The delta cannot reach this path: `quoteLiteral` is called only from `attachStatement` (`grep -n "quoteLiteral" duckdb-query.ts` → the definition at `:203` and the one call at `:287`), and `secretStatement` (`:262-281`) still binds every credential value.
  - *Status:* ☑ SATISFIED

- **O3 - Vendor errors are translated at the boundary.**
  - *Claim:* DuckDB failures surface as the repo's own `Error` carrying the query name and the attach target; no vendor error object escapes.
  - *Evidence collected:* inherited, including that omitting `cause` is load-bearing rather than an oversight. Re-checked against the delta, because the fix creates an asymmetry worth naming: **`contextualise` (`:437-443`) still interpolates the raw, unescaped `attachTarget`.** Second opinion, checked rather than accepted:
    - *No path carries that string back into an executed statement.* `attachTarget` has exactly three uses (`:380` where it is computed, `:420` where it goes through `attachStatement` and so through `quoteLiteral`, and `:442` where it is interpolated into an `Error` message). `contextualise` is called only at `:453` and `:458`, and in both the returned `Error` is thrown. Nothing in the module catches it, and no module imports the adapter at all. The error message is a terminal value.
    - *It cannot smuggle credentials.* The ARN's three components are `ctx.config.region`, `ctx.accountId` and `config.tableBucket` (`:242-244`) - none is a credential the adapter resolved. The credential values never enter statement text (O2), so no DuckDB message built from the statement can carry one into the target; and the message's *detail* half is still passed through `redact` in both branches (`:438-441`), which is where a vendor-echoed credential would appear. The redaction test is green.
    - The implementer's argument therefore holds: the raw ARN is the operator-facing attach target, the string an operator checks region and permissions against, and rendering it escaped would make the message *less* useful without making anything safer.
  - *Status:* ☑ SATISFIED

- **O4 - The vendor dependency is confined and used.**
  - *Claim:* `@duckdb/node-api` is a dependency of `blogwright-analytics` only, and `pnpm knip` reports it used.
  - *Evidence collected:* `grep -rn "@duckdb" packages/*/package.json` → exactly one match, `packages/analytics/package.json:22`. `grep -rn "@duckdb" packages/analytics/src/` → three lines, all in `adapters/duckdb-query.ts` (`:4`, `:46` the import, `:346`); across `packages/*/src/` there is no other match. `pnpm knip` from the workspace root is clean, exit 0. That knip is a live signal is inherited from the first discharge and not re-derived.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates re-run from the workspace root, in CI order - `pnpm build` (5 packages + docs, Done), `pnpm typecheck` (all packages, Done), `pnpm test` (**core, analytics 424/13 files, pds 117, cli 317, build-agent 27; zero failures** - 424 is the prior 421 plus the delta's three), `pnpm lint` (exit 0; the only warnings are the pre-existing `no-shadow` set in `packages/cli/src/nodes.test.ts`, none in analytics), `pnpm exec oxfmt --check .` ("All matched files use the correct format", 172 files), `pnpm knip` (clean, exit 0). `pnpm install --frozen-lockfile` is "Already up to date" with no ignored-build-script warning.
  - *The delta also closes a lint violation the first discharge did not flag.* The pre-delta test file reached for `node:fs` (`existsSync`/`mkdtempSync`/`rmSync`) from `packages/analytics/src/adapters/`, which is **not** in `.oxlintrc.json`'s `no-restricted-imports` override list (only `packages/core/src/adapters/**`, `packages/cli/src/adapters/**` and four named files are exempt). Proved live by negative control: a throwaway `packages/analytics/src/adapters/*.ts` importing `node:fs` draws `error eslint(no-restricted-imports)`. The delta routes the check through `createNodeFileSystem()` instead (`duckdb-query.test.ts:723`), so the file now passes the rule it would otherwise have broken - and the port call is demonstrably non-vacuous, because under the mutation `files.exists` returned `true`.
  - *Changeset:* still none; the ruling is unchanged from the first discharge - acceptable for this task (nothing is user-reachable until task 56 wires a composition root), recommended before the next release because this is the first task to add an install-time native dependency to a `fixed`, publicly published package.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: literal credentials in the secret statement, vendor import in one file (Reviewable).**
  - *Claim:* a reviewer can run the named command inside `packages/analytics` and observe the credential test asserting the literal `staticCredentials` access key and session token in the secret statement, and confirm `grep -rn "@duckdb" packages/analytics/src/` matches only `adapters/duckdb-query.ts`.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run duckdb-query --reporter=verbose` run from `packages/analytics` → **42 passed / 42**. The literal values are spelled once in the fixture (`duckdb-query.test.ts:46-50`) and asserted by name in the bindings and by absence from every statement's text. Both greps run and reported under O4.
  - *Status:* ☑ SATISFIED

## Routed finding from task 45 - inherited

All three items of the task file's routed finding were discharged in the first discharge on directly reproduced evidence, and none is reachable by this delta: `resolveAnalyticsConfig(ctx)` is the adapter's own call and the options type carries no bucket field; the seven definitions execute against a real DuckDB table, with `unique-visitors` genuinely discriminating (per-day `2, 2, 1`, sum `5`, cross-day distinct `3`); and the bare `$include_bots` binds as `BOOLEAN` with no `CAST` required. `packages/analytics/src/queries.ts` is byte-identical to the tip (sha256 `6e9e3115…`) and its suite is 76 passed / 76, so nothing the routed finding covers has moved.

## Falsifiability - the delta's three tests, walked

Every `it` the delta adds was mutated and observed to fail. A control ran before each mutation.

| Mutation of `quoteLiteral` | Result |
| --- | --- |
| M0 control (no edit) | 42 pass, 0 fail |
| MA `value.replaceAll("'", "''")` → `value` (the pre-fix text) | **3 killed - exactly the three new tests**, the third with `expected true to be false` because the smuggled `COPY` wrote its file |
| MB `.replaceAll("'", "")` - drop the quote instead of doubling | **2 killed** - tests 1 and 2. Test 3 correctly stays green: dropping quotes is safe, merely wrong |
| MC `.replaceAll("'", "''").replaceAll("'", "''")` - escape twice | **2 killed** - tests 1 and 2 |

- **Test 1** (`duckdb-query.test.ts:725`) asserts the whole `ATTACH` string verbatim. Dies under all three mutations.
- **Test 2** (`:732`) does what is claimed of it: it extracts the target literal out of the *recorded* `ATTACH` (`targetLiteral`, `:712`) and evaluates `SELECT <target> AS target` in **real DuckDB** through the adapter's own `connectDuckDb`, so DuckDB is the judge of whether the literal is one value. It catches a **terminated** literal (MA: the trailing `--` comments the alias away, so the row comes back under a different column name and the assertion fails) and a **dropped** quote (MB: the row comes back with the region changed), and over-escaping too (MC). One prose nit: its comment says a terminated literal is "a syntax error rather than a row" - for this particular payload it is actually a correctly-parsed row with the wrong column name. The test still fails; only the comment is imprecise.
- **Test 3** (`:749`) is **not passing for an environmental reason.** Re-run with `HOME` pointed at an empty directory, so DuckDB's extension directory is empty and no `iceberg`/`httpfs` extension is available at all: green with the fix (11 ms, versus 117 ms when the cached extension is present, confirming the override took effect), and **red under MA with `expected true to be false`** - the discrimination survives an empty extension directory, and `autoinstall_known_extensions`/`autoload_known_extensions` being off means it needs no network. The harness is not vacuous either: `files.exists` demonstrably returns `true` when the file is there.
- **No stale-file coupling.** `const token = crypto.randomUUID()` sits inside the `it` body (`:757`) and both paths derive from it - the tmp CSV and the `arn:aws:s3tables:<token>` database file - so a file left by one red run can never be observed by the next. The trade is litter on a red run only; a green run creates nothing, since either file exists exactly when the escaping is gone.

**The escape lives at this boundary deliberately, and the comment says why.** `duckdb-query.ts:181-202` states it: `ATTACH` takes its target as a literal and DuckDB accepts no placeholder there; `runAndReadAll` executes every statement it is handed, after `CREATE SECRET` has put the operator's credentials into the session; of the ARN's three components only `region` is unvalidated (`packages/core/src/config.ts:306` is `if (!cfg.region)` and nothing more, confirmed by reading it); "that gap is being closed upstream; this escape stays regardless… The adapter must not be one upstream change away from executing arbitrary SQL." The core `region` validation is routed separately and its absence is **not** counted as a defect here. The adapter is now not one upstream change away: `quoteLiteral` wraps the **whole ARN**, so a relaxed `tableBucket` rule, a hand-assembled context supplying an arbitrary `accountId`, or a new component spliced into `tableBucketArn` are all covered by the same escape.

## Regression check

- `packages/analytics/src/ports.ts` `AnalyticsQuery` is implemented by both the fixture-backed fake (task 45) and this adapter → **PRESERVED**. `ports.ts`, `queries.ts`, `config.ts` and `schema.ts` are byte-identical to the tip by sha256; `queries.test.ts` is 76 passed / 76; `pnpm typecheck` clean : ☑ PRESERVED
- `packages/core/src/aws/credentials.ts:19` `createCredentialProvider` → **PRESERVED**. Untouched; core's suite passes : ☑ PRESERVED
- `quoteIdentifier` (`duckdb-query.ts:177-179`) → **PRESERVED and still correct**. The delta adds `quoteLiteral` above it and changes nothing inside it (`jj diff` over the source shows exactly two hunks: the new function, and `attachStatement` swapping `'${target}'` for `quoteLiteral(target)`). It remains correct for its inputs: `namespace` and `table` are held to `/^[a-z0-9_]+$/` by `validateAnalyticsConfig` (`packages/analytics/src/config.ts:198, 354-357`), and that validation cannot be bypassed - `AnalyticsConfig` carries the non-exported `ENV_DERIVED` symbol, so only `validateAnalyticsConfig` can construct one, and `resolveAnalyticsConfig` passes `namespace`/`table` straight through. The reserved-word case is asserted (`a namespace named for a SQL keyword`, green). The asymmetry with `quoteLiteral` is justified rather than an oversight: the identifier path is sealed by a type in the same package, the literal path was guarded only by a truthiness check in another one : ☑ PRESERVED
- `packages/analytics/package.json` and `pnpm-lock.yaml` feed `pnpm -r build` and `pnpm knip` → **PRESERVED**. The lockfile's 94 added lines, **zero deletions**, are entirely the `@duckdb/*` importer entry, package entries and snapshots; every added line not naming a duckdb package is a `specifier`/`version`/`resolution`/`cpu`/`os`/`libc` child of one. `detect-libc@2.1.2` was already present at the tip, so no non-duckdb resolution changed : ☑ PRESERVED

## Integration

The task's base is `db8db370` (build 36/62, task 45). The bookmark has since moved past the build 40 named in the review brief: it is now `85c7f09` (build 41/62, task 18), with tasks 42, 19, 48, 49 and 18 landed since the base. `git apply --check` of this task's four-path patch is **clean at both** `dc5ee5e` (build 40) and `85c7f09` (build 41), exit 0, no offsets outside the lockfile. Task 43 is in review and shares `packages/analytics/package.json` and `pnpm-lock.yaml`: applying task 43's patch first and then this one is **also clean** (exit 0; the lockfile hunks take a 3-line offset, which git resolves), because task 43 touches `scripts.build` and `devDependencies` while this task touches `dependencies`. `queries.ts` is byte-identical to the tip.

## Residue

- **The correctness concern the first discharge raised is closed.** `tableBucketArn`'s output now reaches the statement only through `quoteLiteral`. Verified in both directions against DuckDB 1.5.5 with five payload shapes of this gate's own devising beyond the briefed one, and with a twelve-region byte-for-byte round-trip.
- **Upstream `region` validation is still absent** (`packages/core/src/config.ts:306` checks truthiness only). Routed separately by the reviewer; explicitly not a defect of this task, and the adapter no longer depends on it.
- **`contextualise` names the raw ARN.** Confirmed correct and deliberate - see O3. Worth one note for a future reader: the `against ${attachTarget}` half of the message is the only part not passed through `redact`, which is right today because the ARN is built from three non-credential values; if a fourth component is ever spliced into `tableBucketArn`, that assumption should be re-checked.
- **A red run of test 3 leaves two files behind** - a CSV in the temp directory and a DuckDB database file named `arn:aws:s3tables:<uuid>` in `packages/analytics/`. This is deliberate and documented in the test, and it trades litter for the stronger property (no stale file can redden a later run). It only happens when the escaping is gone, i.e. when the build is already broken.
- **Test 2's comment** describes a terminated literal as producing "a syntax error rather than a row"; for its payload it produces a row under a different column name. The assertion is unaffected.
- `SESSION_TOKEN` with an empty string, the AWS attach being unexercisable offline, and the missing changeset are all unchanged from the first discharge and were re-ruled there; none is reachable by this delta.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations hold on evidence collected fresh at this discharge - six gates green from the workspace root in CI order, 42/42 on the Reviewable command, both greps returning exactly the one manifest match and the one source file, `queries.ts` byte-identical to the tip with 76/76, and a clean patch application at build 40, at the current build 41 tip, and on top of task 43 - while the one defect that gated the previous merge is closed and independently reproduced in both directions, with three tests that each demonstrably fail when the one-line escape is removed and a general round-trip property showing the escape is faithful to DuckDB rather than tuned to a payload list.
