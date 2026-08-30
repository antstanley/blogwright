# Done Certificate - Task 44: The analytics config block, its defaults and its validator

**Task:** [44-analytics_config_block.md](44-analytics_config_block.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 44. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 44) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `AnalyticsConfig`, its defaults and `validateAnalyticsConfig` live in `packages/analytics/src/config.ts`: an empty block validates and yields every default, every limit is a named constant, every rejection names the offending key and value, and every derived default carries the environment.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `blogwright-core`'s config surface: `parseConfig`/`mergeConfig`/`validateConfig` gain no `analytics` knowledge, `DEFAULT_CONFIG` is unchanged, and every existing test in `packages/core/src/config.test.ts` still passes.

## Verification environment

Workspace `/Users/ant/code/blogwright-task-44` (jj, parent `0580edb7` = task 39). `jj diff --stat` = exactly two added files, 582 insertions, nothing else touched. All mutations below were applied to a copy-restore harness and every file was restored to its baseline sha256 before the final gate run:

| file | baseline sha256 | after all mutations |
| --- | --- | --- |
| `packages/analytics/src/config.ts` | `d2bacddc…3372e2` | `d2bacddc…3372e2` ✓ |
| `packages/analytics/src/config.test.ts` | `0dcdccbb…ec65f3` | `0dcdccbb…ec65f3` ✓ |
| `packages/core/src/config.ts` | `82136680…353dd1` | `82136680…353dd1` ✓ |

Post-restore, all six gates from the workspace root: `pnpm build` 0, `pnpm typecheck` 0, `pnpm test` 0 (453 tests), `pnpm lint` 0, `pnpm exec oxfmt --check .` 0, `pnpm knip` 0. Type-claim gate (`node type-claims/check.mjs`): PASS, 29 claims.

## Obligations

- **O1 - Shape, defaults and named constants.**
  - *Claim:* `AnalyticsConfig` carries `tableBucket`, `namespace` (default `web`), `table` (default `page_views`), `bots` (`'flag' | 'filter'`, default `flag`) and `dashboard.port` (default `4317`); a `{}` block validates and produces every default; defaults and limits are named module constants; the port default is one exported constant.
  - *Evidence collected:* fields at `config.ts:54-72` match the spec's `$defs.AnalyticsConfig` field-for-field, `saltSecretName` included. Every default and limit is a named module constant - `DEFAULT_NAMESPACE:90`, `DEFAULT_TABLE:93`, `DEFAULT_BOTS:96`, `DEFAULT_DASHBOARD_PORT:101` (exported), `MIN_DASHBOARD_PORT:104`, `MAX_DASHBOARD_PORT:107`, `TABLE_BUCKET_MIN_LENGTH:110`, `TABLE_BUCKET_MAX_LENGTH:113` - with no bare literal at any call site. `TABLE_BUCKET_PATTERN:122` is composed by `new RegExp` from the two length constants (no flags, so no `lastIndex` statefulness). The `{}` case (`config.test.ts:161`) asserts all six fields in one `toEqual` **against literals**, not against the constants, so it is not circular.
  - *Checks run:* mutating each literal default in turn kills the `{}` case and nothing else it should not - `DEFAULT_NAMESPACE web→webs`, `DEFAULT_TABLE page_views→pageviews` and `DEFAULT_BOTS flag→filter` each produce exactly `1 failed | 32 passed`; `DEFAULT_DASHBOARD_PORT 4317→4318` produces `3 failed` (the `{}` case, the empty-sub-block case and the `DEFAULT_DASHBOARD_PORT` pin). The port default is exported and `pnpm knip` is silent on it.
  - *Status:* ☑ SATISFIED

- **O2 - One table bucket per environment, implemented and recorded.**
  - *Claim:* `tableBucket` defaults to `<env>-<siteName>-analytics` and `saltSecretName` to `<siteName>/<env>/analytics-salt`, both carrying the environment, and the module's doc comment records the consequence a reader must not undo.
  - *Evidence collected:* `defaultTableBucket:175-177` and `defaultSaltSecretName:184-186` are functions of `site.env`. The module doc comment (`config.ts:12-25`) names the consequence in full - staging and production resolving to the same Iceberg table and the same salt, `blogwright analytics destroy --yes` in staging issuing `DeleteTableBucket` against production's data, and the reason nothing catches it (state is scoped per environment, so each state file correctly records the bucket it was told to use) - plus AWS's Firehose/Iceberg concurrency reason. The two-environment test (`config.test.ts:172`) asserts both `not.toBe` and the concrete staging literals.
  - *Checks run:* the consequence was mutated out of each default in turn, as the task's central risk requires.
    - `defaultTableBucket` → `` `${site.siteName}-analytics` `` : **4 failed** - `yields every default for a block of {}`, `derives a different table bucket and a different salt secret for each environment`, and both derived-length cases.
    - `defaultSaltSecretName` → `` `${site.siteName}/analytics-salt` `` : **2 failed** - the `{}` case and the two-environment case.
    - Order-swap controls (`<siteName>-<env>-analytics`, `<env>/<siteName>/analytics-salt`) also fail the `{}` case, so the literal form is pinned and not merely the presence of `env`.
  - *Status:* ☑ SATISFIED

- **O3 - Boundary and negative-space rejection, with named-value errors.**
  - *Claim:* `tableBucket` is tested at 2, 3, 63 and 64 characters and `dashboard.port` at 1023, 1024, 65535 and 65536; `namespace`/`table` outside `^[a-z0-9_]+$`, `bots` outside the union and an unknown key are all rejected; every message names the offending key and value.
  - *Evidence collected:* eight distinct boundary tests, four accept and four reject, each its own `it` with the value in its name. Twelve further rejection tests cover non-object block, non-object dashboard, unknown key in the block, unknown key in the sub-block, non-lowercase and empty `namespace`, non-lowercase `table`, a `bots` value outside the union, a fractional and a non-numeric port, a bad `saltSecretName`, and a valid-length bucket outside the character class.
  - *Checks run:* each bound was mutated in **both** directions, with the message text held constant so the semantic and the message are separated - this is where an off-by-one would hide. Each mutation kills **exactly one** boundary test:

    | mutation (message unchanged) | test killed |
    | --- | --- |
    | pattern `{MIN-1,MAX}` | rejects a tableBucket of 2 characters |
    | pattern `{MIN+1,MAX}` | accepts a tableBucket of 3 characters |
    | pattern `{MIN,MAX-1}` | accepts a tableBucket of 63 characters |
    | pattern `{MIN,MAX+1}` | rejects a tableBucket of 64 characters |
    | `port < MIN - 1` | rejects a dashboard.port of 1023 |
    | `port <= MIN` | accepts a dashboard.port of 1024 |
    | `port >= MAX` | accepts a dashboard.port of 65535 |
    | `port > MAX + 1` | rejects a dashboard.port of 65536 |

    All eight fire from both sides, isolated. **One home for the pattern and the bounds:** mutating `TABLE_BUCKET_MIN_LENGTH 3→2` changed both the accepted length *and* the rendered message, which came back as `must be 2..63 …` against the test's expected `must be 3..63 …`. The constant is the single source for both.

    Error vocabulary was compared against `packages/core/src/config.ts` directly. `config.analytics.dashboard.port must be in 1024..65535, got 1023` is the task's stated target register verbatim. `must be lowercase alphanumeric/underscores, got "…"` mirrors core's `config.siteName must be lowercase alphanumeric/dashes, got "…"`. `config.analytics.saltSecretName has invalid characters: "analytics salt!"` mirrors core's `config.pds.secretName has invalid characters: "…"` verbatim in shape, over the identical `^[\w/+=.@-]+$` class. The unknown-key form (`… is not a known setting - allowed keys are …`) has no core precedent, because core has no unknown-key rejection at all; it follows the repo's ` - ` explanatory-clause style and names the offending key. The `, got <value>` suffix on `must be one of` and `must be in` is an enrichment over core, but the task text specifies exactly that enrichment.

    Message falsifiability: dropping the key from the unknown-key message, dropping the value from the port message, collapsing the `saltSecretName` message, and removing `formatValue`'s string quoting each kill named tests (1, 4, 1 and 10 respectively).
  - *Status:* ☑ SATISFIED

- **O4 - Optional-not-null, and the block is inert for core.**
  - *Claim:* absence is `?: T | undefined` with no `null` for a domain value, and a config carrying an `analytics` block passes core's `parseConfig` untouched when the plugin is not loaded.
  - *Evidence collected:* `exactOptionalPropertyTypes: true` at `tsconfig.base.json:15`, inherited by `packages/analytics/tsconfig.json`; every optional field on `AnalyticsConfig:54-72` and `AnalyticsDashboardConfig:42-45` is written `?: T | undefined`. `grep -n null` returns three hits, all the `isRecord` `typeof` companion at `:162` and its own explanatory comment - no function returns or accepts `null` for a domain value.
  - *Checks run:* the passthrough test **genuinely calls core**. `packages/analytics/vitest.config.ts` aliases `blogwright-core` to `../core/src/index.ts`, i.e. core's real source, not `dist` and not a local re-implementation. Both directions were mutated in `packages/core/src/config.ts`: dropping `...raw` from `mergeConfig`'s spread killed `leaves the analytics block on the parsed config untouched`; throwing on an `analytics` key in `parseConfigDocument` killed **both** passthrough tests. `not.toThrow` here is therefore falsifiable rather than vacuous. Core restored to its baseline sha256.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates exit 0 (table above). No changeset - correct, and consistent with task 39: the package carries no manifest field and `config.ts` is not re-exported from `index.ts`, so nothing here is user-facing yet; task 58 owns the closure changeset.
  - *Checks run - the knip decision:* `BotHandling` (`:35`) and `AnalyticsDashboardConfig` (`:42`) are un-exported, following `schema.ts:42`'s `IcebergType` precedent (also a bare `type`). **Negative control:** adding `export` to both makes `pnpm knip` fail with `Unused exported types (2)` naming exactly those two at `config.ts:35:13` and `config.ts:42:18`. So un-exporting was the honest answer of the three the plan allows, not a manufactured consumer. `DEFAULT_DASHBOARD_PORT` is exported and knip is silent on it. `AnalyticsConfig`'s export is not knip-manufactured either: removing the test's `type AnalyticsConfig` import and its one annotation leaves knip clean, so the export is carried by `validateAnalyticsConfig`'s own signature.
  - *Checks run - the derived-length check:* `resolveAnalyticsConfig:325-330` length-checks the merged bucket, `deriveNames`' precedent at `config.ts:355`. Removing the check kills `rejects a derived table bucket of 64 characters`; weakening `>` to `>=` kills `accepts a derived table bucket of exactly 63 characters`. It also covers an over-long *explicit* bucket, not just a derived one. Declining to re-check `env`/`siteName` character classes is sound on every real path - `deriveNames` holds `env` to `^[a-z0-9-]+$` and `validateConfig` holds `siteName` to the same, and the minimum derived length is 14 so the lower bound is unreachable. See the residue note for the one respect in which the cited precedent is not a clean match.
  - *Checks run - the unobservable mutation:* removing `typeof port !== 'number'` from `validateDashboardConfig:301` produces **33 passed, 0 failed** under vitest, confirming the implementer's report. But it is **not** unobservable to the gate set: `pnpm typecheck` then emits five errors - `src/config.ts(302,5): TS18047: 'port' is possibly 'null'`, `TS2365: Operator '<' cannot be applied to types '{}' and 'number'` (twice each for `<` and `>`), and `src/config.ts(309,12): TS2322: Type '{} | null' is not assignable to type 'number | undefined'`. The clause is load-bearing for a gate the repo runs, the stated reason (`Number.isInteger`'s lib signature returns `boolean`, not a predicate) is correct, and leaving it with a comment recording the redundancy is the right handling. The claim is if anything understated.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: named defaults and eight named boundary tests (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- config` inside `packages/analytics` and observe that the `{}` case asserts every default by name and that each of the eight boundary cases is its own named test carrying the value in its name.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run config --reporter=verbose` run as the `Reviewable:` line words it: 33 passed. The `{}` case enumerates `tableBucket`, `namespace`, `table`, `bots`, `saltSecretName` and `dashboard.port` in one `toEqual` against literals. The eight boundary test names are `accepts a tableBucket of 3 characters`, `accepts a tableBucket of 63 characters`, `rejects a tableBucket of 2 characters`, `rejects a tableBucket of 64 characters`, `accepts a dashboard.port of 1024`, `accepts a dashboard.port of 65535`, `rejects a dashboard.port of 1023`, `rejects a dashboard.port of 65536` - eight distinct `it`s, each with its value in the name.
  - *Status:* ☑ SATISFIED

## Falsifiability sweep

The plan's DoD (2026-08-30) requires every assertion be able to fail. **All 33 tests were observed failing under at least one mutation.** The implementer's table was not accepted; 44 mutations were applied independently, including two in `packages/core/src/config.ts`. No test was left uncovered:

- 8 boundary tests: killed by the eight isolated bound mutations in the O3 table, one each.
- 6 literal-default / constant tests: killed by mutating each default constant.
- 2 environment-derivation tests: killed by four independent mutations each (drop env, swap order, in each default).
- 13 validator structure/message tests: killed by removing the `isRecord` guards, the two unknown-key loops, each field assignment, the `bots` union check, both `IDENTIFIER_PATTERN` directions, both `SECRET_NAME_PATTERN` directions, the `TABLE_BUCKET` character class, `formatValue`'s quoting, and each message's key/value interpolation.
- 2 resolver tests: killed by ignoring an explicit setting and by the derived-length mutations.
- 2 `parseConfig` passthrough tests: killed **only** by mutations in `packages/core/src/config.ts`, which is the proof they exercise core rather than a local stand-in.

One mutation was found unobservable to vitest - the `typeof port` narrowing clause - and is discharged under O5: it is caught by `pnpm typecheck`, so no shipped line is unfalsifiable against the gate set.

## Regression check

- `packages/core/src/config.ts:242` `parseConfig` with a document containing an `analytics` block → core is byte-identical to baseline (sha256 verified), `pnpm test` green across all 5 packages (453 tests), and the block survives as an unvalidated passthrough : ☑ PRESERVED
- `packages/analytics/src/index.ts` re-exports the package surface consumed by later tasks → `pnpm knip` reports no unused export after the config module is added, and the negative control proves the check discriminates : ☑ PRESERVED

## Residue

**The validate/resolve split - recorded as a defect, see D1 below.** The implementer split the surface: `validateAnalyticsConfig(raw)` validates and applies no defaults (a `{}` block returns `{}`), while `resolveAnalyticsConfig(block, { env, siteName })` applies all six. The stated reason is real and unavoidable for two of them: `Plugin.validateConfig?(raw: unknown): TConfig` (`packages/core/src/plugin.ts:353`) carries no environment, so `tableBucket` and `saltSecretName` provably cannot be defaulted there. The plan's own downstream contracts already speak this vocabulary - task 48 "the resolved `analytics` config", task 47's pointer "the resolved-config shape", task 56 "the resolved config" - so a resolved shape distinct from the raw block is what the plan expects. The DoD's test obligation is discharged, not evaded: `resolveAnalyticsConfig(validateAnalyticsConfig({}), SITE)` puts `{}` through the validator and asserts all six defaults against literals in one `toEqual`.

What the reason does **not** cover is the extent. Four of the six defaults are literals with no environment dependency and could live in `validateConfig`. Dropping them too makes `ctx.pluginConfig` carry nothing at all, which is what D1 names.

Minor, not defects: (a) `resolveAnalyticsConfig` cites `deriveNames` as precedent for the derived-length check at `config.ts:355` while declining the character-class check the same function performs at `:349` - the cited precedent keeps both homes. Harmless on every real path (`ctx.names.env` has already passed `deriveNames`), but the justification comment overstates its precedent. (b) `toEqual` ignores `undefined`-valued properties, so `expect(validateAnalyticsConfig({})).toEqual({})` would also pass against a return of `{ namespace: undefined, … }`; semantically a no-op, and the real-default mutation kills it, so this is a note rather than a gap. (c) The `saltSecretName` pattern is restated rather than imported, because core does not export it and task 27 moves core's copy to `packages/pds` - correct, but it is a second home for one character class.

Out of this task's scope, as the authored certificate scopes it: whether the `configKey`/`validateConfig` wiring reaches the CLI is task 47's obligation. D1 is filed against this task nonetheless because task 47's contract binds `validateConfig` to this function verbatim and leaves no room for a wrapper - task 44's choice forecloses task 47's.

## Defects

- **D1 - `pluginConfig` will carry no defaults, contradicting the SPI contract, and the stated reason covers only two of six.** `packages/analytics/src/config.ts:205` returns an all-optional block. Task 47's contract requires `validateConfig` be "bound to task 44's `validateAnalyticsConfig` rather than a second validator written here", so `TConfig = AnalyticsConfig` (raw) is locked in and `ctx.pluginConfig` is a block with zero defaults. That contradicts `packages/core/src/plugin.ts:85-93` - "Returning the validated block also gives a plugin's own defaults somewhere to live, so every reader keeps a total type instead of re-checking for `undefined`" - and `:349-353` - "return it, applying the plugin's own defaults". The environment constraint forces only `tableBucket` and `saltSecretName` out of `validateConfig`; `namespace`, `table`, `bots` and `dashboard.port` are literals that could have stayed. **Failure scenario:** task 48 is told to "Take the bucket, namespace and table names from the resolved `analytics` config", but the context hands it the raw block and nothing forces it to reach `resolveAnalyticsConfig`. A node written as ``const bucket = ctx.pluginConfig.tableBucket ?? `${ctx.config.siteName}-analytics` `` compiles, typechecks and passes review - and task 48's own DoD forbids it from restating the two-environment collision test ("lives with the module that owns the derivation rather than being restated in `nodes.test.ts`"), so nothing in the build catches it. Staging and production then resolve to one Iceberg table and `blogwright analytics destroy --yes` in staging issues `DeleteTableBucket` against production's data - the exact consequence this task exists to prevent, relocated from a place where it is tested to five places where it is not (tasks 45, 48, 50, 56). **Fix, either:** apply the four literal defaults inside `validateAnalyticsConfig` and narrow `AnalyticsConfig` accordingly, leaving only the two derived fields optional; or amend task 47 to bind `validateConfig` to a wrapper and make `resolveAnalyticsConfig` take the `PluginContext` so the `{ env: ctx.names.env, siteName: ctx.config.siteName }` record has one home rather than five hand-assembled ones.
- **D2 - `AnalyticsConfig` means the opposite of what the plan's type-claim transcription says it means.** `packages/analytics/src/config.ts:54` declares `AnalyticsConfig` as the partial raw block; `.specs/plans/2026-07-26-plugin_system_and_analytics/type-claims/transcriptions.ts:208-220` declares `AnalyticsConfig` as the **total resolved** shape, annotated "`validateConfig` 'applies the plugin's own defaults', so every field is total on `pluginConfig`", and `claims.ts:68` models `Plugin<AnalyticsConfig>` against it. The transcription is not wired into CI (it passes today, 29 claims, because no claim exercises the field set), so this is silent. Task 47 will instantiate `Plugin<AnalyticsConfig>` with a different type than the gate models. **Fix:** whichever way D1 is resolved, update `transcriptions.ts` to match, or rename the shipped types so the total one keeps the name the plan reserved for it.

## Conclusion

VERDICT: ☑ pending correctness fix - all six obligations are SATISFIED with evidence and both regression traces are PRESERVED; the verdict is held open only because D1's fix changes `validateAnalyticsConfig`'s return type, and the `{}` obligation under O1 is currently discharged by composing the validator with the resolver rather than by the validator alone. Re-validation after the fix is narrow: O1's `{}` case and O3's message register.
CONFIDENCE: ☑ high
SUMMARY: Every value, bound, message and default in the shipped module is correct and every one of the 33 tests was independently observed failing under mutation - including both `parseConfig` passthrough tests, which only core mutations can kill - but the validate/resolve split leaves `ctx.pluginConfig` with none of the six defaults where the environment constraint forces only two out, handing the env-dropping bucket derivation to five downstream tasks that no test is contractually allowed to catch.
