# Done Certificate - Task 45: The AnalyticsQuery port and the fixed named query set

**Task:** [45-analytics_query_port_and_named_queries.md](45-analytics_query_port_and_named_queries.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 45. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 45) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `AnalyticsQuery` (`run(name, params)`) and the fixed named query set exist in the plugin's own modules, every definition parameterised rather than interpolated, with a fixture-backed fake every consumer test uses and no DuckDB started anywhere in the package's suite.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 44's config surface - the bot-inclusion default is read from `config.analytics.bots`, not restated - nor task 39's `schema.ts`, whose column names the query SQL must reference rather than re-spell in a second vocabulary.

## Obligations

- **O1 - The port is declared in the plugin's own module and hides the vendor.**
  - *Claim:* `AnalyticsQuery` is `run(name, params)` returning rows, declared in `packages/analytics/src/ports.ts`, and no domain module imports `@duckdb/node-api`.
  - *Evidence collected:* `ports.ts:66-73` declares `interface AnalyticsQuery { run(name: QueryName, params: QueryParams): Promise<readonly QueryRow[]> }` - one operation, no second member. The row type is repo-owned: `QueryRow = Readonly<Record<string, QueryValue>>` (`ports.ts:51`) over `QueryValue = string | number | boolean` (`ports.ts:43`, deliberately un-exported), not a vendor result type. `grep -rn "@duckdb" packages/analytics/src/` → no match (exit 1); `grep -rn "duckdb" packages/analytics/package.json pnpm-lock.yaml` → no match, so the vendor is not even a declared dependency yet. `pnpm knip` from the repo root → exit 0, no output.
  - *Checks:* `run`'s return position resolves to `Promise<readonly QueryRow[]>`, a repo-owned type. Case-insensitive `grep -rli duckdb packages/analytics/src/` matches only prose in `queries.ts`, `ports.ts`, `fixture-query.ts` and the pre-existing `aws/glue.ts` - no import, no test file. The `ports.ts:10-12` parenthesis discloses that the specifier is named in prose rather than spelled, so the DoD grep does not trip on a comment; the disclosure makes the rewording honest rather than evasive, and the substantive property (no vendor import, no vendor type in a signature) holds independently of how the comment is worded.
  - *Type-level check (added by the validator):* adding a second member to `AnalyticsQuery` fails `pnpm typecheck` at `fixture-query.ts:83` (`TS2741`), so the fake's conformance to the port is compiler-enforced.
  - *Status:* ☑ SATISFIED

- **O2 - The named set is complete, every definition is parameterised, and the unique-visitors semantic is the summed-daily one.**
  - *Claim:* the set covers views over time, top paths, referrers, countries, status codes, cache hit ratio and unique visitors by `visitor_key`; each takes a date range and a bot-inclusion flag defaulting from `config.analytics.bots`; a test iterating the whole set asserts no interpolated caller value in any SQL text; and the unique-visitors definition computes daily uniques summed over the range - never a `COUNT(DISTINCT …)` spanning days.
  - *Evidence collected:* `queries.ts:175-304` declares exactly the seven names the spec's §Local server lists, in its order; `queries.test.ts:96-98` set-compares them against a literal spec list. Every definition carries `binds: ['from','to','include_bots']` and `$from`/`$to`/`$include_bots` placeholders; `queries.test.ts:116-119` pins declaration against placeholders per name. `pnpm --filter blogwright-analytics exec vitest run queries --reporter=verbose` → 63 passed from 33 `it` blocks.
  - *Iteration count check:* the per-definition suite is `describe.each(ANALYTICS_QUERY_NAMES)` and a separate guard (`queries.test.ts:148-152`) asserts the names it actually iterated equal `Object.keys(ANALYTICS_QUERIES)`. Mutation **M-L** (`.slice(0, 2)`) reddens that guard alone (1 failed / 37) - the guard is real, not decorative.
  - *Bot default check:* `BOTS_INCLUDED_BY_DEFAULT` (`queries.ts:324-327`) is `satisfies Record<AnalyticsConfig['bots'], boolean>` and is indexed by `config.bots` at `queries.ts:431`. Mutation **M-D** (`filter: true`) and **M-N** (`[config.bots]` → `['flag']`) each redden two tests; **M-V** (`flag: false`) reddens the `"flag"` test alone. Adding a third mode to task 44's `BotHandling` union fails `pnpm typecheck` with `TS1360` at `queries.ts:327` and `TS7053` at `queries.ts:431` - the exhaustiveness is compiler-enforced, and the default *value* is read from `config.bots` rather than restated.
  - *Unique-visitors semantic (the check that fails silently if wrong):* `queries.ts:288-302` counts `DISTINCT visitor_key` inside a `GROUP BY day` CTE and forms the range total as `sum(daily_unique_visitors) OVER ()`. Verified by mutation, not by reading:
    - **M-A** removing `GROUP BY day` from the CTE → 1 failed, `the unique-visitors query > counts distinct visitor_key inside a day and nowhere else`.
    - **M-B** `sum(…) OVER ()` → `max(…) OVER ()` → 1 failed, `the unique-visitors query > reports the range total as the sum of those daily counts` - a *different* test.
    - **M-C** relabelling the total `unique_visitors` → 2 failed: `ANALYTICS_QUERIES > never names a result column "unique_visitors"` and `the unique-visitors query > labels its rows as summed daily uniques`.
  - *Labelling check:* no result column anywhere in the set is named `unique_visitors` (`queries.test.ts:104-109` iterates every definition's `resultColumns`); the meaning is carried in the column names `daily_unique_visitors` / `summed_daily_unique_visitors` **and** in `rowMeaning` (`queries.ts:282-283`), and both are pinned (`queries.test.ts:170-178`).
  - *Parameterisation is structural, verified with `tsc` rather than taken from the tests:* the validator wrote the interpolation itself.
    - Interpolating a caller value into a definition → `pnpm typecheck` reports `TS2345: Argument of type 'string' is not assignable to parameter of type 'SqlRelation'`.
    - Assigning a plain string to a definition's `sql` → `TS2322: Type 'string' is not assignable to type 'SqlText'` (plus `TS2352` at the `queryDefinition` cast).
    - The runtime probe also fires: an interpolated-probe definition fails `the interpolated-probe query definition > spells no value a caller could have supplied`, naming the query in the title, exactly as the `Reviewable:` line describes.
    - **Two gates, but not equal.** `pnpm typecheck` is a CI job (`.github/workflows/ci.yml:22`) and is *total* - `sql` is module-private and its rest parameter has one inhabitant, so no caller value can reach a statement. The runtime test is a *partial* net: it catches quoted literals, day-shaped values, missing placeholders and an unsubstituted `${`. It does not catch an unquoted splice - the validator interpolated `'0 OR 1=1'` into `status-codes` as `AND status >= ${…}` and all 63 tests stayed green while `tsc` reported `TS2345`. See Defect D2.
  - *Column vocabulary (P3):* `columns` is typed `readonly PageViewColumnName[]` against task 39's `schema.ts`, and `queries.test.ts:135-137` asserts the SQL names exactly those columns. **M-Q** (over-declaring `user_agent` on `countries`) reddens that one test.
  - *Status:* ☑ SATISFIED

- **O3 - Unknown name and bad date range both raise.**
  - *Claim:* an unknown query name raises an error listing the available names, and an absent or inverted date range raises rather than silently defaulting; both messages name the offending value.
  - *Evidence collected:* `queries.ts:359-367` raises ``unknown analytics query "top-page" - available queries are views-over-time, top-paths, referrers, countries, status-codes, cache-hit-ratio, unique-visitors``, asserted in full at `queries.test.ts:223-227` (not a bare `toThrow()`). `validateRange` (`queries.ts:379-399`) raises for an absent range, a missing end, a non-`YYYY-MM-DD` day, a non-calendar day and an inverted range, each message quoting the offending value; all five asserted as full strings (`queries.test.ts:229-260`). Mutations **M-I** (drop the names list), **M-J** (default an absent range), **M-H** (drop the inverted check), **M-X** (`>` → `>=`) and **M-Z1** (validate the range before the name) each redden the expected tests and nothing else.
  - *Calendar-day check is real:* **M-E** (pattern-only, round-trip removed) reddens `rejects a day that is not on the calendar, naming it` **alone** - so the pattern check and the calendar check are distinguishable. The converse does not hold: **M-F** (pattern removed, round-trip kept) reddens nothing, because `Date.parse('2026-8-1T00:00:00Z')` is already `NaN`; the two tests are separately *stated* but only the calendar one is separately *falsifiable* (**M-G**, `isCalendarDay` → always true, reddens both). `DAY_PATTERN` is therefore defence-in-depth, not load-bearing - see Defect D3.
  - *Falsification of the obligation:* `queryDefinition` reads the name off `ANALYTICS_QUERIES` with a plain index (`queries.ts:360`), so keys inherited from `Object.prototype` resolve to a truthy value and skip the `undefined` branch. Executed trace: `queryDefinition('constructor')` returns the `Object` constructor; `prepareQuery('constructor', {range}, config)` throws `TypeError: definition.binds is not iterable` - no available-names list, no mention of the offending value. Same for `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `__proto__`. The fake inherits it: `createFixtureAnalyticsQuery({ toString: rows })` throws `queryDefinition(...).resultColumns is not iterable`, and `fake.run('constructor', …)` throws `definition.binds is not iterable`. `queries.ts:355-358` documents this function as the boundary "the local server's HTTP path arrives at", which is exactly where a path segment named `constructor` can appear. No SQL is minted on this path (the throw precedes the return), so it is an error-quality defect, not an injection.
  - *Status:* ☒ PARTIAL - every asserted case holds; the obligation's own words ("an unknown query name raises an error listing the available names") are false for the ~12 inherited `Object.prototype` keys. See Defect D1.

- **O4 - A fixture-backed fake, and no DuckDB in the suite.**
  - *Claim:* a fixture-backed fake `AnalyticsQuery` ships beside the port, every consumer test substitutes at the port, and no test in the package starts DuckDB.
  - *Evidence collected:* `fixture-query.ts:71-97` returns a real implementation of the port that runs the *same* `prepareQuery` the DuckDB adapter will (`fixture-query.ts:87`), so the fake refuses an unknown name and a bad range with the identical messages - confirmed by **M-H**, which reddens the `prepareQuery` and the fake's inverted-range test together. `grep -rn "duckdb" packages/analytics/src/*.test.ts` → no match; `grep -rn "vi.mock" packages/analytics/` → no match, so substitution is at the port, not through the module loader.
  - *Anti-vacuous-fixture guard:* `checkFixtureShape` (`fixture-query.ts:51-61`) refuses rows whose keys are not exactly the query's `resultColumns`, at construction. Verified load-bearing by **M-M**, a one-character typo in `views-over-time`'s `resultColumns` (`'views'` → `'veiws'`): **all six** `createFixtureAnalyticsQuery` tests fail, plus two others (8 total). Disabling the guard (**M-K**) reddens `refuses fixture rows that are not shaped like the query result` alone. This is the mechanism that stops tasks 46/55/57 writing assertions against fabricated row shapes, and it works.
  - *Further mutations:* **M-Y** (unseeded query answers `[]`) and **M-Z2** (stop recording `calls`) each redden their own tests.
  - *`QueryRow` admits no `null`:* adding `extra: null` to a fixture row fails `pnpm typecheck` with `TS2322: Type 'null' is not assignable to type 'QueryValue'` - a SQL NULL must reach a caller as an absent key.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected*, all from the workspace root and all re-run after every mutation was restored:
    - `pnpm build` → Done for all packages.
    - `pnpm typecheck` → Done for all five packages.
    - `pnpm test` → 813 passed, 1 skipped (analytics 239/239; core 143; cli 304; pds 100; build-agent 27).
    - `pnpm lint` → clean; `pnpm --filter blogwright-analytics lint` emits nothing (the only warnings in the repo are pre-existing `no-shadow` in `packages/cli/src/nodes.test.ts`).
    - `pnpm exec oxfmt --check .` → "All matched files use the correct format", 158 files.
    - `pnpm knip` → exit 0, no output.
  - *Constants:* `CACHE_HIT_RESULT_TYPES`, `QUERY_PARAM_NAMES`, `PAGE_VIEWS_RELATION`, `DAY_PATTERN`, `DAY_LENGTH`, `BOTS_INCLUDED_BY_DEFAULT` are all named. **M-U** (adding `OriginShieldHit` to `CACHE_HIT_RESULT_TYPES` without touching the SQL) reddens `the cache-hit-ratio query definition > spells no value a caller could have supplied`, so the constant and the statement cannot drift.
  - *Changeset:* none added, consistent with tasks 39 and 44. Nothing user-facing ships: `packages/analytics` still declares no `blogwright.plugin` manifest field and no `Plugin` default export, and `index.ts` re-exports only the AWS clients, so the new modules are not yet on any published surface.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: an interpolating query fails the parameterisation test.**
  - *Claim:* a reviewer can run the command, add an interpolating definition, and observe the parameterisation test fail naming that query.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run queries --reporter=verbose` from `packages/analytics` → `Test Files 1 passed`, `Tests 63 passed`, every title listed. The validator added an eighth definition whose SQL splices `${PROBE_FROM}` and re-ran: `Tests 2 failed | 66 passed`, with `src/queries.test.ts > the interpolated-probe query definition > spells no value a caller could have supplied` naming the offending query (the second failure is the totality test, correctly objecting to an eighth name). The same file simultaneously fails `pnpm typecheck` with `TS2345` at `queries.ts:318`. The probe was removed and the suite re-run green.
  - *Status:* ☑ SATISFIED

## Falsifiability sweep

The implementer's table was not accepted. The validator ran **31 source mutations plus 5 type-level probes** against the workspace, restoring after each. Every one of the 33 `it` blocks was observed to fail under at least one mutation:

| # | `it` block (abbreviated) | reddened by |
|---|---|---|
| 1 | is exactly the seven named queries | M-R (names restated and incomplete) |
| 2 | names every key of the table | M-R - **not vacuous**: the assertion catches `ANALYTICS_QUERY_NAMES` being restated instead of derived |
| 3 | never names a result column `unique_visitors` | M-C |
| 4 | declares the date range and the bot flag (×7) | M-P (drop `include_bots` from `referrers`) |
| 5 | spells no value a caller could have supplied (×7) | M-U, interpolated probe |
| 6 | is one statement over the relation (×7) | M-S (different relation), M-T (two statements) |
| 7 | reads exactly the page_views columns (×7) | M-Q |
| 8 | selects exactly the result columns (×7) | M-M |
| 9 | iterated every query rather than a sample | M-L (`describe.each(...).slice(0, 2)`) |
| 10 | counts distinct visitor_key inside a day | M-A |
| 11 | reports the range total as the sum | M-B |
| 12 | labels its rows as summed daily uniques | M-C |
| 13 | binds the range and the bot flag | M-M |
| 14 | binds one value per placeholder, every query | M-P |
| 15 | `"flag"` counts bot rows | M-V |
| 16 | `"filter"` leaves them out | M-D, M-N |
| 17 | explicit `includeBots` overrides | M-W |
| 18 | accepts a range of one day | M-X |
| 19 | rejects an unknown name, listing | M-I |
| 20 | rejects an absent range | M-J |
| 21 | rejects a range missing one end | M-J |
| 22 | rejects a day that is not YYYY-MM-DD | M-G only (**not** independently of #23 - see D3) |
| 23 | rejects a day not on the calendar | M-E (independently), M-G |
| 24 | rejects an inverted range | M-H |
| 25 | checks the name before the range | M-Z1 |
| 26 | answers a named query with recorded rows | M-M |
| 27 | records what each call bound | M-Z2 |
| 28 | defaults the bot flag from its config | M-D, M-N, M-Z2 |
| 29 | refuses fixtures under an unknown name | M-I |
| 30 | refuses fixtures not shaped like the result | M-K |
| 31 | raises for a query it holds no rows for | M-Y |
| 32 | refuses an inverted range at the port | M-H |
| 33 | typed to refuse an unknown name | port widened to `string` → `TS2578 Unused '@ts-expect-error' directive` |

The `describe.each` table is not one weak shared assertion: all five of its `it` blocks were falsified by mutations to a *single* definition (M-P `referrers`, M-Q `countries`, M-S `countries`, M-T `status-codes`, M-M `views-over-time`), each reddening only the affected name.

## Judgements recorded

- **Relation name left for task 46.** Sound and documented (`queries.ts:20-28`, `54-61`): SQL binds values, not identifiers, so splicing the configured triple would be the interpolation the module forbids. Task 44's `ENV_DERIVED` seal was **not** reached around - `queries.ts` imports `AnalyticsConfig` as a *type* only, `prepareQuery` takes `Pick<AnalyticsConfig, 'bots'>`, and neither `ENV_DERIVED` nor `resolveAnalyticsConfig` is referenced anywhere outside prose. The configurability task 44 declares is preserved for the adapter.
- **No `LIMIT` on the top-N queries.** Confirmed absent (`grep -in "limit\|offset"` matches only a prose mention of `LimitExceeded`). `ORDER BY views DESC, <key>` is in the SQL, so the head is deterministic and task 57 can take it. A literal would be a magic number and a `$limit` bind would break "every query binds exactly the range and the bot flag" (`queries.test.ts:116-119` would fail). Correct call.
- **`QueryValue` un-exported.** Confirmed (`ports.ts:43`), with the reason and the re-export condition in the doc comment; `pnpm knip` is clean. Better than a manufactured consumer.
- **No changeset.** Consistent with tasks 39 and 44, and justified: the package exposes no plugin manifest or default export yet, so none of this is user-facing.

## Regression check

- `packages/analytics/src/config.ts` (task 44) supplies the `bots` default read by the query parameter defaulting → task 44's config suite passes unchanged (analytics 239/239, no config test touched); the default is read from `config.bots`, and the mapping is exhaustive over task 44's union (verified: adding a third mode is `TS1360` + `TS7053`) : ☑ **PRESERVED**
- `packages/analytics/src/index.ts` re-exports the package surface → `pnpm knip` reports nothing after `ports.ts`, `queries.ts` and `fixture-query.ts` are added : ☑ **PRESERVED**
- Task 39's `schema.ts` → not modified; `columns` is typed `PageViewColumnName[]` and `queries.test.ts:135-137` pins each statement's column vocabulary against `PAGE_VIEWS_COLUMNS` : ☑ **PRESERVED**
- Task 40's transform (landed at build 31) maps CloudFront's `-` and `''` to *absent* (`transform/map-record.ts:96,178,202`), so the `referrer IS NOT NULL` / `country IS NOT NULL` filters in `referrers` and `countries` are correct rather than leaving a `-` bucket : ☑ **PRESERVED**

## Integration

`jj status` in the workspace shows four `A` entries and no `M` - **no landed file was touched**, and `jj diff --stat` after every mutation was restored is byte-identical to the original (963 insertions, 4 files, 0 deletions; SHA-1s match the pre-mutation baseline for all five files touched during testing).

The workspace's parent is build 30 (task 36); the bookmark is at build 32. None of the four new paths exists at `plugin-system-and-analytics`. Builds 31 (task 40, `transform/map-record.ts`) and 32 (task 17, `packages/cli`) touch disjoint paths, as do task 38 (`packages/analytics/src/aws/`, in review) and task 41 (`packages/analytics/src/transform/`, in review, changing `map-record.ts`'s signature). The only delta to a file this task reads is `schema.ts` gaining `export` on `TIMESTAMP_MS_FIELD`, which `queries.ts` does not use. **A plain merge onto the bookmark is a clean pure-add.**

## Residue

- **The SQL has never been executed.** There is no adapter until task 46, so DuckDB dialect correctness is unverified by execution: `count(*) FILTER (WHERE …)`, `sum(…) OVER ()`, `CAST($from AS DATE)` against the DATE `day` column, `ORDER BY <output alias>`, and - the one the validator would look at first - whether DuckDB infers `BOOLEAN` for a bare `$include_bots` in `($include_bots OR NOT coalesce(is_bot, false))` without an explicit cast. Static review found nothing wrong. This is **acceptable for this task's DoD**, which asks for parameterisation and totality rather than execution, and the execution obligation is routed to task 46. Task 46 owes a test that runs all seven statements against a DuckDB instance holding a `page_views` fixture; if the bare boolean parameter needs a `CAST($include_bots AS BOOLEAN)`, that edit belongs there.
- Pagination and row limits for the dashboard are not covered (task 57).
- The `adapters/` directory the port's comment names does not exist yet; it lands with task 46.

## Defects

- **D1 (the one that gates this certificate) - `queries.ts:360`, inherited-key lookup.** `(ANALYTICS_QUERIES as Record<string, QueryDefinition>)[name]` returns a truthy value for any `Object.prototype` key, so `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `__proto__` and the rest skip the unknown-name branch. Executed: `prepareQuery('constructor', {range}, config)` → `TypeError: definition.binds is not iterable`; `createFixtureAnalyticsQuery({ toString: rows })` → `queryDefinition(...).resultColumns is not iterable`. Failure scenario: task 55's local server routes `GET /api/queries/constructor` into this boundary - the very seam `queries.ts:355-358` says the `string` parameter exists for - and returns an internal `TypeError` instead of the documented, names-listing rejection. Fix is one line: `Object.hasOwn(ANALYTICS_QUERIES, name)` before the index (or build the table over `Object.create(null)`), plus one test asserting `prepareQuery('constructor', …)` throws the unknown-name message.
- **D2 - `queries.ts:16-18`, doc over-claim.** "`queries.test.ts` pins the same property at run time - vitest transpiles without typechecking, so the type-level block and the test-level one fail independently." The runtime block pins a strictly weaker property. Demonstrated: splicing `'0 OR 1=1'` into `status-codes` as `AND status >= ${…}` leaves all 63 tests green while `tsc` reports `TS2345`. The type gate is the total one and it is in CI (`ci.yml:22`), so the guarantee holds - but the sentence should say the runtime test is a second, partial net over quoted and day-shaped values, not "the same property".
- **D3 - `queries.ts:330`, `DAY_PATTERN` is not load-bearing.** Removing it changes no test outcome, because the ISO round-trip already rejects every input the pattern rejects. Harmless defence-in-depth; recorded so a later reader does not mistake `rejects a day that is not YYYY-MM-DD` for independent coverage of the pattern.
- **D4 - `queries.test.ts:345`, redundant type assertion.** `const _FAKE_IMPLEMENTS_THE_PORT: AnalyticsQuery = createFixtureAnalyticsQuery({})` cannot fail on its own: `FixtureAnalyticsQuery extends AnalyticsQuery` already forces conformance, and a mismatch surfaces at `fixture-query.ts:83`. The comment calling it "the one check the test runner cannot make" overstates it. Cosmetic.

## Conclusion

VERDICT: ☒ **PARTIAL** (pending the D1 correctness fix)
CONFIDENCE: **high**
SUMMARY: O1, O2, O4, O5 and O6 are SATISFIED on collected evidence - the unique-visitors summed-daily semantic and its labelling are pinned by mutations that redden separate named tests, parameterisation is structural and confirmed with `tsc` (`TS2345` on interpolation, `TS2322` on a plain-string `sql`) as well as by the `Reviewable:` runtime probe, the fixture fake's shape guard is load-bearing (a one-character `resultColumns` typo fails all six fake tests), no DuckDB appears anywhere in the suite, and all six repo gates are green with the diff restored byte-identical - but O3 is PARTIAL because inherited `Object.prototype` keys bypass the unknown-name branch at `queries.ts:360` and surface a `TypeError` instead of the error listing the available names, at the exact HTTP boundary that function documents itself as owning.
