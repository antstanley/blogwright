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

Workspace `/Users/ant/code/blogwright-task-44` (jj, parent `0580edb7` = task 39). This validation covers the **delta** answering the previous gate's D1 and D2. `jj status` = exactly four paths: `packages/analytics/src/config.ts` (A), `packages/analytics/src/config.test.ts` (A), and the two type-claim harness files under `.specs/plans/…/type-claims/` (M). No plan, task, certificate or change-spec file was touched.

Every mutation below was applied to a copy-restore harness; all five touched files were `sha256`-verified byte-identical to baseline before the final gate run, and the scratch probe module was deleted:

| file | baseline sha256 | after all mutations |
| --- | --- | --- |
| `packages/analytics/src/config.ts` | `54f6cffa…9ee3a4` | `54f6cffa…9ee3a4` ✓ |
| `packages/analytics/src/config.test.ts` | `e97f791f…ba34ef` | `e97f791f…ba34ef` ✓ |
| `packages/core/src/config.ts` | `82136680…353dd1` | `82136680…353dd1` ✓ |
| `type-claims/claims.ts` | `ba3f5247…1a7afd` | `ba3f5247…1a7afd` ✓ |
| `type-claims/transcriptions.ts` | `07dca78a…c700f4` | `07dca78a…c700f4` ✓ |

Post-restore, all six gates from the workspace root: `pnpm build` 0, `pnpm typecheck` 0, `pnpm test` 0 (**596 tests**, 5 packages), `pnpm lint` 0 (three pre-existing `no-shadow` warnings in `packages/cli/src/nodes.test.ts`, untouched by this task), `pnpm exec oxfmt --check .` 0 (146 files), `pnpm knip` 0. Type-claim gate (`node type-claims/check.mjs`): **PASS, 31 claims** (12 compiled positives, 19 pinned compile-errors) - up from 29.

## Obligations

- **O1 - Shape, defaults and named constants.**
  - *Claim:* `AnalyticsConfig` carries `tableBucket`, `namespace` (default `web`), `table` (default `page_views`), `bots` (`'flag' | 'filter'`, default `flag`) and `dashboard.port` (default `4317`); a `{}` block validates and produces every default; defaults and limits are named module constants; the port default is one exported constant.
  - *Evidence collected:* the block is now two types over one shared base. `EnvIndependentSettings:107` carries `namespace`, `table`, `bots`, `dashboard.port` **total**; `AnalyticsConfig:144` extends it with the sealed `readonly [ENV_DERIVED]: EnvDerivedOverrides`; `ResolvedAnalyticsConfig:153` extends it with total `tableBucket`/`saltSecretName`. Field-for-field this is the spec's `$defs.AnalyticsConfig` plus `saltSecretName`. Every default and limit is a named module constant - `DEFAULT_NAMESPACE:159`, `DEFAULT_TABLE:162`, `DEFAULT_BOTS:165`, `DEFAULT_DASHBOARD_PORT:172` (exported), `MIN_DASHBOARD_PORT:175`, `MAX_DASHBOARD_PORT:178`, `TABLE_BUCKET_MIN_LENGTH:181`, `TABLE_BUCKET_MAX_LENGTH:184` - with no bare literal at any call site; `TABLE_BUCKET_PATTERN:193` is composed by `new RegExp` from the two length constants. The `{}` obligation is now discharged **twice**: `config.test.ts:34` asserts the four literal defaults straight off `validateAnalyticsConfig({})`, and `config.test.ts:224` asserts all six against literals in one `toEqual` after `resolveAnalyticsConfig`.
  - *Checks run:* each literal default mutated in turn - `DEFAULT_NAMESPACE web→webz`, `DEFAULT_TABLE page_views→pageviews`, `DEFAULT_BOTS flag→filter` each produce `3 failed | 33 passed`; `DEFAULT_DASHBOARD_PORT 4317→4318` produces `5 failed`. The port default is exported, imported by the test by name, and `pnpm knip` is silent on it.
  - *Status:* ☑ SATISFIED

- **O2 - One table bucket per environment, implemented and recorded.**
  - *Claim:* `tableBucket` defaults to `<env>-<siteName>-analytics` and `saltSecretName` to `<siteName>/<env>/analytics-salt`, both carrying the environment, and the module's doc comment records the consequence a reader must not undo.
  - *Evidence collected:* `defaultTableBucket:265` and `defaultSaltSecretName:273` are functions of `site.env`; `resolveAnalyticsConfig:426` builds `site` from `ctx.env` and `ctx.config.siteName` and nothing else. The module doc comment (`config.ts:33-50`) names the consequence in full - staging and production resolving to the same Iceberg table and the same salt, `blogwright analytics destroy --yes` in staging issuing `DeleteTableBucket` against production's data, why per-environment state cannot see the collision, and AWS's Firehose/Iceberg concurrency reason. The two-environment test (`config.test.ts:235`) asserts both `not.toBe` and the concrete staging literals.
  - *Checks run:* the environment was mutated out of each default, and the order swapped, with the message held constant.
    - `defaultTableBucket` → `` `${site.siteName}-analytics` ``: **6 failed**.
    - `defaultTableBucket` → `` `${site.siteName}-${site.env}-analytics` `` (order swap): **6 failed** - the literal form is pinned, not merely the presence of `env`.
    - `defaultSaltSecretName` → `` `${site.siteName}/analytics-salt` ``: **4 failed**; order swap `` `${site.env}/${site.siteName}/analytics-salt` ``: **4 failed**.
    - `site.env` hard-coded to `'production'`: **4 failed**, including `reads the environment and site name off the context it is given`. `site.siteName` hard-coded: **3 failed**.
  - *Status:* ☑ SATISFIED

- **O3 - Boundary and negative-space rejection, with named-value errors.**
  - *Claim:* `tableBucket` is tested at 2, 3, 63 and 64 characters and `dashboard.port` at 1023, 1024, 65535 and 65536; `namespace`/`table` outside `^[a-z0-9_]+$`, `bots` outside the union and an unknown key are all rejected; every message names the offending key and value.
  - *Evidence collected:* eight distinct boundary tests (`config.test.ts:123,127,132,138,153,157,161,167`), four accept and four reject, each its own `it` with the value in its name. Twelve further rejection tests cover non-object block, non-object dashboard, unknown key in the block, unknown key in the sub-block, non-lowercase and empty `namespace`, non-lowercase `table`, a `bots` value outside the union, a fractional and a non-numeric port, a bad `saltSecretName`, and a valid-length bucket outside the character class.
  - *Checks run:* each bound mutated in **both** directions with the message text held constant. Each mutation kills **exactly one** boundary test - re-run in full against the delta, not inherited:

    | mutation (message unchanged) | failures | test killed |
    | --- | --- | --- |
    | pattern `{MIN-1,MAX}` | 1 | rejects a tableBucket of 2 characters |
    | pattern `{MIN+1,MAX}` | 1 | accepts a tableBucket of 3 characters |
    | pattern `{MIN,MAX-1}` | 1 | accepts a tableBucket of 63 characters |
    | pattern `{MIN,MAX+1}` | 1 | rejects a tableBucket of 64 characters |
    | `port < MIN - 1` | 1 | rejects a dashboard.port of 1023 |
    | `port <= MIN` | 1 | accepts a dashboard.port of 1024 |
    | `port >= MAX` | 1 | accepts a dashboard.port of 65535 |
    | `port > MAX + 1` | 1 | rejects a dashboard.port of 65536 |

    **One home for the bounds:** mutating `TABLE_BUCKET_MIN_LENGTH 3→2` changes both the accepted length *and* the rendered message (`must be 2..63 …` against the expected `must be 3..63 …`), killing two tests. Same for `TABLE_BUCKET_MAX_LENGTH 63→64`. The constants are the single source for both the pattern and the message. Error vocabulary is unchanged from the previously verified module and still matches `packages/core/src/config.ts`'s register.

    Message falsifiability: removing `formatValue`'s string quoting kills **10** tests.
  - *Status:* ☑ SATISFIED

- **O4 - Optional-not-null, and the block is inert for core.**
  - *Claim:* absence is `?: T | undefined` with no `null` for a domain value, and a config carrying an `analytics` block passes core's `parseConfig` untouched when the plugin is not loaded.
  - *Evidence collected:* `exactOptionalPropertyTypes: true` at `tsconfig.base.json:15`, inherited by `packages/analytics/tsconfig.json`; every optional field on `RawAnalyticsConfig:83`, `RawDashboardConfig:68` and `EnvDerivedOverrides:122` is written `?: T | undefined`. The only `null` in the module is `isRecord`'s `typeof` companion at `:245` and its own explanatory comment.
  - *Checks run:* the passthrough tests **genuinely call core** - `packages/analytics/vitest.config.ts` aliases `blogwright-core` to `../core/src/index.ts`. Both directions mutated in `packages/core/src/config.ts`: dropping `...raw` from `mergeConfig`'s spread killed `leaves the analytics block on the parsed config untouched` (1 failed); throwing on an `analytics` key in `parseConfigDocument` killed **both** passthrough tests (2 failed). No mutation inside `packages/analytics` kills either one, which is the proof they exercise core rather than a local stand-in. Core restored to baseline sha256.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates exit 0 (table above). No changeset - correct and consistent with task 39: `config.ts` is not re-exported from `index.ts`, so nothing here is user-facing yet; task 58 owns the closure changeset.
  - *Checks run - the knip decision:* six types are deliberately un-exported (`BotHandling:60`, `RawDashboardConfig:68`, `RawAnalyticsConfig:83`, `EnvIndependentSettings:107`, `EnvDerivedOverrides:122`, `AnalyticsConfigContext:235`), following `schema.ts`'s `IcebergType` precedent. `ResolvedAnalyticsConfig` is newly exported and knip is silent on it - it is carried by `resolveAnalyticsConfig`'s own return annotation, not manufactured. **Negative control:** adding `export` to `ENV_DERIVED` makes `pnpm knip` fail with `Unused exports (1) ENV_DERIVED packages/analytics/src/config.ts:135:14`. The seal is therefore defended by a second, independent gate.
  - *Checks run - the derived-length check:* `resolveAnalyticsConfig:427-433` length-checks the merged bucket. Removing it kills `rejects a derived table bucket of 64 characters`; weakening `>` to `>=` kills `accepts a derived table bucket of exactly 63 characters` and the 63-char explicit case.
  - *Checks run - the `typeof port` clause, re-verified against the rewritten `validateDashboardPort:380`:* removing `typeof port !== 'number'` produces **36 passed, 0 failed** under vitest but **five** `pnpm typecheck` errors (`TS18047` ×2, `TS2365` ×2, `TS2322` ×1 at `config.ts:401,402,408`). Still load-bearing for a gate the repo runs; the comment recording the redundancy remains the right handling.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: named defaults and eight named boundary tests (Reviewable).**
  - *Claim:* a reviewer can run the `Reviewable:` command inside `packages/analytics` and observe that the `{}` case asserts every default by name and that each of the eight boundary cases is its own named test carrying the value in its name.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run config --reporter=verbose` run verbatim as the `Reviewable:` line words it: **36 passed**. Every default is asserted by name across the two `{}` cases - `namespace`/`table`/`bots`/`dashboard.port` off the validator at `:34`, and all six including `tableBucket` and `saltSecretName` off the resolver at `:224`. The eight boundary test names are `accepts a tableBucket of 3 characters`, `accepts a tableBucket of 63 characters`, `rejects a tableBucket of 2 characters`, `rejects a tableBucket of 64 characters`, `accepts a dashboard.port of 1024`, `accepts a dashboard.port of 65535`, `rejects a dashboard.port of 1023`, `rejects a dashboard.port of 65536` - eight distinct `it`s, each with its value in the name.
  - *Status:* ☑ SATISFIED

## D1 - the seal, verified by compilation

The delta applies the four literal defaults **in the validator** and carries `tableBucket`/`saltSecretName` under a non-exported `const ENV_DERIVED = Symbol(…)` (`config.ts:135`), reachable only through `resolveAnalyticsConfig(ctx)`. The seal was verified by writing the hazardous lines into a scratch probe module in `packages/analytics/src` and compiling with the package's own `tsconfig.typecheck.json` - **the diagnostics below are compiler output, not the implementer's report**:

| probe | result |
| --- | --- |
| `` ctx.pluginConfig.tableBucket ?? `${ctx.config.siteName}-analytics` `` | `TS2339: Property 'tableBucket' does not exist on type 'AnalyticsConfig'` ✓ |
| `ctx.pluginConfig[someSymbol]` (symbol reflection) | `TS7053: … expression of type 'symbol' can't be used to index type 'AnalyticsConfig'` ✓ |
| `export { ENV_DERIVED } from './config.js'` | `TS2459: Module './config.js' declares 'ENV_DERIVED' locally, but it is not exported` ✓ (same for the `import` form) |
| `export const ENV_DERIVED = …` in `config.ts` | `pnpm knip` fails: `Unused exports (1)` ✓ |
| **positive control** `resolveAnalyticsConfig(ctx).tableBucket` / `.saltSecretName` | compiles clean ✓ - the seal steers, it does not merely break |
| structural smuggling: `const loose: { tableBucket?: string } = ctx.pluginConfig` | `TS2559` ✓ |

**The shapes task 48 will actually write** were probed, not just the single hazardous line:

- `ResourceNode<PluginContext<AnalyticsConfig>>` with the hazardous read inside `read(ctx)` → `TS2339` ✓; the same node's `create`/`delete` reaching the config through `resolveAnalyticsConfig(ctx)` → clean ✓.
- That node assigned into `Plugin<AnalyticsConfig>['nodes']`'s bare `ResourceNode[]` → clean ✓, so the seal costs task 48 nothing structurally.
- A **bare `ResourceNode`** (whose `ctx.pluginConfig` is `never`) → `TS2339: Property 'tableBucket' does not exist on type 'never'` ✓, while `resolveAnalyticsConfig(ctx)` still compiles there. This was the shape most likely to leak and it does not.

**Published surface.** `packages/analytics/dist/config.d.ts:92` emits `declare const ENV_DERIVED: unique symbol;` and the file ends `export {};` - the symbol is declared but not exported, so a consumer of the package cannot name it either. (`config.ts` is not re-exported from `index.ts` today, so it is doubly unreachable from the package root.)

**Runtime reflection.** `Object.entries` and `JSON.stringify` over `ctx.pluginConfig` compile but drop symbol keys, so neither leaks the sealed pair; `Object.getOwnPropertySymbols` is the only route and it is the `TS7053` above.

**The stated residual is an honest boundary, not an evasion.** Two paths remain open and both were confirmed to compile: inventing a name from nothing (`` `${ctx.config.siteName}-analytics` `` with no `??`) and fabricating a context (`resolveAnalyticsConfig({ ...ctx, env: 'production' })`). Neither is reachable by the accident the original hazard described - the `??` fallback needs a field to fall back *from*, and that field is gone from every shape a node can hold. Closing the first needs the sink branded (task 33's `S3TablesClient` taking a `TableBucketName` only the resolver can mint), which is genuinely another task's module; closing the second is impossible in structural TypeScript without a nominal brand on `env` itself, owned by core. **The original hazard is closed.**

**Task 47 needs nothing extra.** A probe built a full `Plugin<AnalyticsConfig>` with `validateConfig: validateAnalyticsConfig` bound verbatim, a `commands` table and an `init` contributor: it compiles clean, `ctx.pluginConfig.namespace`/`.table`/`.bots`/`.dashboard.port` are total inside a command's `run`, and the sealed pair resolves through `resolveAnalyticsConfig(ctx)`. `Plugin.init?(io: PluginInitIo)` names no `TConfig`, so the contributor is genuinely unaffected. One note, not introduced by this delta: `DEFAULT_NAMESPACE`/`DEFAULT_TABLE`/`DEFAULT_BOTS` are module-private, so task 47's certificate obligation to default each prompt "against task 44's default constants by name" will need those three exported at that point (knip will be satisfied once `plugin.ts` imports them).

## D2 - the type-claim reconciliation, verified by negative control

`transcriptions.ts` no longer transcribes `AnalyticsConfig`: it re-exports `AnalyticsConfig` and `ResolvedAnalyticsConfig` from `../../../../packages/analytics/src/config.js` as ground truth, with the retired transcription and the reason it was wrong recorded in the doc comment. `claims.ts` adds C30 (both sealed reads are `TS2339`) and C31 (the literal defaults total on `pluginConfig`, and the total six-field shape on `ResolvedAnalyticsConfig`).

Both claims are real - negative controls run here, not accepted from the report:

| control | result |
| --- | --- |
| add `tableBucket?: string` back onto `AnalyticsConfig` | gate FAILs: `BROKEN CLAIM C30 … claims.ts:368 error TS2578: Unused '@ts-expect-error' directive` ✓ (the `saltSecretName` directive at `:370` still holds - the claims discriminate per field) |
| make `namespace` optional | gate FAILs: `BROKEN CLAIM C31 … claims.ts:379 error TS2322: Type 'string \| undefined' is not assignable to type 'string'` ✓ |
| make `bots` optional (extra control) | gate FAILs: `BROKEN CLAIM C31 … claims.ts:385 error TS2322` ✓ - so all four literals are pinned, three directly on `pluginConfig` and `bots` through the shared `EnvIndependentSettings` base |

Claim count moved **29 → 31** and `node type-claims/check.mjs` reports `PASS: 31 claims held`. The seal is additionally pinned by a *second* gate: opening it makes `pnpm typecheck` fail with `TS2578` at `config.test.ts:108` and `:116`, because `packages/analytics/tsconfig.typecheck.json` sets `exclude: []` and so type-checks the test file.

**Scope boundary held.** Only `type-claims/claims.ts` and `type-claims/transcriptions.ts` were edited under `.specs/`; `jj status` shows no plan, task, certificate or change-spec file touched. `type-claims/` is a compiled harness the repo runs as a gate, not plan prose, and D2 directed the change explicitly - the narrower instruction is the right reading.

## Falsifiability sweep

The implementer's table was **not accepted**. 40 mutations were applied independently by this gate (38 in `config.ts`, 2 in `packages/core/src/config.ts`), each run in isolation against a restored baseline. **All 36 `it` blocks were observed failing under at least one mutation** - the map below names one killer per test, and no test was left uncovered:

| test | killer |
| --- | --- |
| accepts an empty block / treats an absent block / yields every default for `{}` | any of `DEFAULT_NAMESPACE`, `DEFAULT_TABLE`, `DEFAULT_BOTS`, `DEFAULT_DASHBOARD_PORT` |
| accepts a block naming every setting | ignore `overrides.tableBucket`; also `SECRET_NAME_PATTERN` without `/` |
| rejects a block that is not an object | drop the `isRecord(block)` guard |
| rejects an unknown key inside the block / inside the sub-block | disable the respective allowed-key loop |
| rejects a dashboard that is not an object | drop `isRecord(raw)` in `validateDashboardPort` |
| **does not let a reader reach tableBucket off ctx.pluginConfig** | `defaultTableBucket` without `env` (runtime); plus `TS2578` under `pnpm typecheck` and under C30 |
| **does not let a reader reach saltSecretName off ctx.pluginConfig** | `defaultSaltSecretName` without `env` (runtime); plus `TS2578` under `pnpm typecheck` and under C30 |
| the eight boundary cases | the eight isolated bound mutations in O3's table, one each |
| rejects a tableBucket outside the character class | widen `[0-9a-z-]` to `[0-9a-zA-Z_-]` |
| rejects a fractional port | drop `!Number.isInteger(port)` |
| rejects a port that is not a number | coerce `raw['port']` with `Number(…)` |
| rejects a namespace / a table outside `^[a-z0-9_]+$` | allow uppercase in `IDENTIFIER_PATTERN` |
| rejects an empty namespace | `+` → `*` in `IDENTIFIER_PATTERN` |
| rejects a bots value outside the union | `isBotHandling` → `typeof value === 'string'` |
| accepts a saltSecretName using the pds class | drop `/` from `SECRET_NAME_PATTERN` |
| rejects a saltSecretName with invalid characters | admit space and `!` into `SECRET_NAME_PATTERN` |
| derives a different bucket and salt per environment | drop or swap `env` in either default; hard-code `site.env` |
| keeps explicit settings over the defaults | ignore either sealed override |
| applies the dashboard port default when the sub-block is empty | `DEFAULT_DASHBOARD_PORT 4317→4318` |
| rejects / accepts a derived table bucket at 64 / 63 | remove the derived-length check; `>` → `>=` |
| **reads the environment and site name off the context it is given** | hard-code `site.env`; hard-code `site.siteName` |
| `DEFAULT_DASHBOARD_PORT` is 4317 | `4317→4318` |
| both `parseConfig` passthrough cases | **only** the two `packages/core/src/config.ts` mutations |

The three tests added by this delta were sampled hardest: the two seal tests are falsifiable on **three** independent gates each (vitest runtime assertion, `pnpm typecheck`'s `TS2578`, and the type-claim gate's C30), and `reads the environment and site name off the context it is given` is killed by two distinct hard-codings.

One mutation remains unobservable to vitest - the `typeof port` narrowing clause - and is discharged under O5: `pnpm typecheck` emits five errors for it.

*Falsifiability gap, noted not filed:* `accepts a saltSecretName using the pds secret-name character class` (`config.test.ts:211`) uses `'example/production/analytics-salt'`, which is byte-identical to the value `SITE` derives, so ignoring the explicit override does not kill it. The test still falsifies on its stated subject - the character class - so this is a note about the fixture's choice of value, not an unfalsifiable assertion.

## Regression check

- `packages/core/src/config.ts:242` `parseConfig` with a document containing an `analytics` block → core byte-identical to baseline (sha256 verified), `pnpm test` green across all 5 packages (596 tests), and the block survives as an unvalidated passthrough : ☑ PRESERVED
- `packages/analytics/src/index.ts` and the package's build surface → `pnpm build` regenerates `dist/config.d.ts` with `ENV_DERIVED` declared-not-exported; `pnpm knip` reports no unused export, and the negative control proves the check discriminates : ☑ PRESERVED
- The type-claim gate → PASS at 31 claims, with three independent negative controls proving C30 and C31 discriminate : ☑ PRESERVED

## Residue

The previous gate's D1 and D2 are both **closed**, verified by compilation and by negative control rather than by report. Remaining notes, none of them defects:

- (a) `resolveAnalyticsConfig` cites `deriveNames` as precedent for the derived-length check while declining the character-class check the same function performs; harmless on every real path, but the justification comment still overstates its precedent.
- (b) The `saltSecretName` character class is restated rather than imported, because core does not export it and task 27 moves core's copy to `packages/pds`.
- (c) Task 47 will need `DEFAULT_NAMESPACE`/`DEFAULT_TABLE`/`DEFAULT_BOTS` exported to satisfy its own certificate's "by name" evidence. Pre-existing, not introduced here.
- (d) C31 pins `bots` on `pluginConfig` only transitively, through the `EnvIndependentSettings` base that `ResolvedAnalyticsConfig` also extends. A future refactor that split the two interfaces would silently drop that pin.

## Defects

- **D3 - the absent `analytics` block now crashes the resolver with a bare `TypeError`, on a path this task's own DoD declares valid.** `packages/analytics/src/config.ts:428` reads `const overrides = block[ENV_DERIVED];` and immediately dereferences it, and `:434` reads `block.dashboard.port` - both unguarded, correctly so, because the *type* guarantees them. But task 19's contract (`backlog/19-cli_plugin_config_validation.md`, step 3 and DoD item 2) specifies that when the plugin's config key is **absent**, `resolvePluginConfig` does **not** call `validateConfig` at all and places a plain `{}` on `ctx.pluginConfig` - "is not called at all when the block is absent … `pluginConfig` is an empty object rather than `undefined`". Before this delta that was safe: `{}` was a valid `AnalyticsConfig` and `resolveAnalyticsConfig` merged it over every default. It is no longer. **Verified by execution** against the built `dist/config.js`:
  ```
  resolveAnalyticsConfig({ env: 'staging', config: { siteName: 'example' }, pluginConfig: {} })
    → TypeError: Cannot read properties of undefined (reading 'tableBucket')
  ```
  while the path where the validator *is* called with `undefined` resolves correctly to every default. Nothing catches it at compile time: the CLI dispatches over `Plugin<unknown>` and `toPluginContext(ops): PluginContext<unknown>` (`packages/cli/src/plugin-commands.ts:241,466`), so `TConfig` is erased at exactly the boundary where the `{}` is injected. **Failure scenario:** an operator runs `blogwright plugin add analytics` and then `blogwright analytics status` without writing an `analytics` key - a configuration this task's own step list and module doc call valid ("An absent block validates as an empty one, so installing the plugin without writing an `analytics` key is valid", `config.ts:283-286`) and whose validator handles `undefined` explicitly at `:294`. They get `TypeError: Cannot read properties of undefined (reading 'tableBucket')` with no mention of the config, the key or the plugin, instead of a fully defaulted run. Task 47 binds `validateConfig` verbatim, so there is no wrapper seam to absorb this - the same no-seam argument the previous gate used to file D1 against this task. **Fix, either:** amend task 19's contract so `resolvePluginConfig` calls `validateConfig(pluginBlock(doc, key))` on the absent path too (passing the `undefined` this validator already handles), reserving the `{}` fallback for plugins that declare no `configKey`; **or** record the requirement in `config.ts`'s module doc and in this task's residue so task 19 cannot land the `{}` fallback unaware. The first is one branch in a task that has not been built yet and is the cheaper of the two.

## Conclusion

VERDICT: ☑ pending correctness fix - all six obligations are SATISFIED with evidence, all three regression traces are PRESERVED, every one of the 36 tests was independently observed failing under mutation, and both of the previous gate's defects are closed by compiler-verified means. The verdict is held open solely on D3. If the build owner resolves D3 by amending task 19's contract, task 44 is DONE exactly as it stands and no re-validation of this module is needed; if it is resolved inside `config.ts`, re-validation is narrow - the absent-block path and one added test.
CONFIDENCE: ☑ high
SUMMARY: The seal is real and steering rather than merely breaking - the hazardous `??` line is `TS2339` in every node shape task 48 can write, including the bare `ResourceNode` whose `pluginConfig` is `never`, the symbol is declared-not-exported in the published `.d.ts`, `knip` and the type-claim gate each independently defend it, and `resolveAnalyticsConfig(ctx)` compiles clean beside it - but the same totality that closes D1 turns task 19's specified `{}` for an absent block from harmless into a bare `TypeError` on a configuration this task calls valid, which no gate in the build catches because `TConfig` is erased at the dispatch boundary.
