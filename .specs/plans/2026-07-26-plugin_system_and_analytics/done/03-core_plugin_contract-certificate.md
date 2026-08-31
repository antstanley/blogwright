# Done Certificate - Task 03: Add the Plugin contract and its boundary validator to core

**Task:** [03-core_plugin_contract.md](03-core_plugin_contract.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 03. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 03) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `Plugin`, `PluginCommand`, `PluginInitIo`, `ConfigBlockEntry` and `PluginManifest` are declared in `packages/core/src/plugin.ts`, and `validatePlugin(module, packageName)` turns an arbitrary imported module into a trusted `Plugin` or raises naming the package.
- **P2 - Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `packages/core/src/plugin.ts`'s existing contents from tasks 01 and 02 (`PluginContext` and `ResourceNode` keep their declarations and doc comments), nor `packages/core/src/index.ts`'s export surface (the new symbols must not collide with `config.js`, `ports.js` or `state.js` exports).

**P3 discharged.** `jj diff --git packages/core/src/plugin.ts` contains **zero** deletion lines
(`grep -c '^-[^-]'` → 0): the change is a pure append onto tasks 01 and 02's declarations and
doc comments. `packages/core/src/index.ts` is untouched; `export * from './plugin.js'` (line 23)
already carried the barrel and no new symbol collides (`pnpm build` and `pnpm typecheck` clean).
`packages/core/src/config.ts` is the only other production edit: two lines of `parseConfig`'s
body replaced by a delegation.

## Obligations

- **O1 - The `Plugin` and `PluginCommand` member lists are exactly as specified.**
  - *Claim:* `Plugin<TConfig = never>` declares `name`, `description`, `commands`, optional `nodes(ctx)`, `configKey`, `validateConfig(raw): TConfig` and `init(io)` and nothing else; `PluginCommand` declares `action`, `summary` and `run(ctx: PluginContext<TConfig>, args: string[])`, and `action` is a plain string so `secret status` is representable.
  - *Evidence collected:* `packages/core/src/plugin.ts:325-360` declares exactly seven members -
    `name: string`, `description: string`, `commands: PluginCommand<TConfig>[]`,
    `nodes?(ctx: PluginContext<TConfig>): ResourceNode[]`, `configKey?: string`,
    `validateConfig?(raw: unknown): TConfig`, `init?(io: PluginInitIo): Promise<ConfigBlockEntry[]>`
    - member-for-member the list in `2026-07-26-cli_plugin_system.md` §Plugin SPI → The `Plugin`
    contract. No `hooks`, `dependsOn`, `ports` or `middleware` member exists (grep: no hits).
    `PluginCommand<TConfig = never>` at `plugin.ts:172-183` declares `action: string`,
    `summary: string`, `run(ctx: PluginContext<TConfig>, args: string[]): Promise<void>`.
    `packages/cli/src/cli.ts:210` holds `new Set([… 'secret status', 'secret delete'])` - plain
    strings that need no encoding against `action: string`.
  - *Critical:* `validateConfig?(raw: unknown): TConfig` **returns** the resolved block; it is not
    `void`. Probed positively: a `Plugin<{table:string}>` whose `validateConfig` returns
    `{ table: 'events' }` compiles, and `const resolved: {table: string} = p.validateConfig!({})`
    typechecks. Defaults therefore have somewhere to live for tasks 22 and 44.
  - *Status:* ☑ SATISFIED

- **O2 - The init surface, the manifest and the no-null rule.**
  - *Claim:* `PluginInitIo` and its question shape live in this module, `init` returns an empty `ConfigBlockEntry[]` when declined, `PluginManifest` is `{ plugin: string }` checked against a shared `PLUGIN_NAME_PATTERN`, and no domain value in the module is typed `null` or bare `undefined`.
  - *Evidence collected:* `PluginQuestion` (`plugin.ts:241-251`), `PluginInitIo` (`plugin.ts:261-268`),
    `ConfigBlockEntry` (`plugin.ts:277-280`), `PLUGIN_NAME_PATTERN` (`plugin.ts:288`),
    `PluginManifest` (`plugin.ts:297-299`). The literal `^[a-z0-9-]+$` appears **exactly once**
    in the file (`grep -c` → 1) and matches the `pattern` in the spec's `PluginManifest` `$def`
    (§Type changes). `init?(io): Promise<ConfigBlockEntry[]>` returns an array, so a declined
    contributor returns `[]`, never `undefined`. `grep '| null\|: null' packages/core/src/plugin.ts`
    → no hits.
  - *Check discharged:* the regular expression inside `validatePlugin`'s name check is the shared
    constant - `PLUGIN_NAME_PATTERN.test(name)` at `plugin.ts:410` - not a second inline literal.
    The constant carries no `g` flag, so `.test` is stateless (no `lastIndex` hazard); the
    `PLUGIN_NAME_PATTERN` unit test calls it five times in a row and passes.
  - *Deviation recorded (not disqualifying):* `configKey?: string` (`plugin.ts:337`) is the one
    optional data property in the module written without `| undefined`, unlike task 01's
    `tags?: Record<string, string> | undefined`. Under `exactOptionalPropertyTypes` this is the
    *stricter* form and satisfies the DoD's actual rule ("no `null` or `undefined` stands for a
    domain value"); it is an internal inconsistency, not a defect.
  - *Status:* ☑ SATISFIED

- **O3 - `validatePlugin` accepts a valid module and rejects seven distinct malformations.**
  - *Claim:* the positive case returns a typed `Plugin`, and there is one negative test each for no default export, a non-object default export, a missing or empty `name`, a `name` violating the pattern, a missing `description`, `commands` not an array, and a command missing `action` or `run`.
  - *Evidence collected:* `pnpm --filter blogwright-core exec vitest run plugin --reporter=verbose`
    → **13 passed**, of which the `validatePlugin` describe block contributes **10** (one positive,
    seven negatives, the `nodes()`-throws case, the no-leak case). Each negative maps to exactly
    one rejection reason and none is duplicated:
    `plugin.ts:384/391` no default export · `:397` non-object default · `:405` missing/empty name ·
    `:411` name pattern · `:419` missing description · `:427` commands not an array · `:436` command
    missing action/run. Assertions read individually: every negative is a `toThrow` on a distinct
    message regex, and each additionally asserts `new RegExp(PACKAGE)`. None passes vacuously - the
    positive case asserts `name`, `description`, `commands.length` and `commands[0].action` off the
    returned value.
  - *Status:* ☑ SATISFIED

- **O4 - Messages name the package, suggest a fix, leak nothing, and nothing on the module is invoked.**
  - *Claim:* every raised message contains `packageName` and a corrective clause, no message interpolates a value read off the module, and validation invokes no function the module supplies.
  - *Evidence collected:* read the **construction**, not only the tests. All seven raises route
    through one helper, `rejectPlugin` (`plugin.ts:367-369`), whose only interpolation is
    `packageName`. Six of the seven detail strings are string literals; the seventh
    (`plugin.ts:413`) interpolates `${PLUGIN_NAME_PATTERN}` - this module's own constant, not module
    data. There is therefore **no path** by which a module value can reach a message, which is
    stronger than the injected-marker test can show. Confirmed empirically by driving all ten
    malformation shapes through the built `dist/plugin.js` and printing every message.
  - *Check discharged:* traced `validatePlugin`'s body (`plugin.ts:382-444`) for a call expression
    on a module-derived value - **none**. The operations are `typeof`, `!== null`, `Array.isArray`,
    property reads, `.length`, and `PLUGIN_NAME_PATTERN.test(name)` on a string already narrowed by
    `typeof`. The `nodes()`-throws test returns normally (`not.toThrow()`), so `nodes`, `init`,
    `validateConfig` and `run` are provably never invoked.
  - *Status:* ☑ SATISFIED

- **O5 - The heterogeneous registry compiles without a cast, and `Plugin<never>` has no readable config *property*.**
  - *Claim:* a `Plugin<{ a: string }>` and a `Plugin<{ b: number }>` both join one `Plugin<unknown>[]` and a `PluginContext<unknown>` dispatches through it with no cast; a property read off `ctx.pluginConfig` inside a bare `Plugin` is a compile error, while a whole-field assignment is documented as compiling.
  - *Evidence collected:* `plugin.test.ts:189-232` builds `pluginA: Plugin<{a: string}>` and
    `pluginB: Plugin<{b: number}>`, assigns `const registry: Plugin<unknown>[] = [pluginA, pluginB]`,
    and `await command.run(ctx, [])` through it, asserting both `run` bodies ran and read their own
    field. The context comes from `makeContext` (`plugin.test.ts:150-186`), built from core's real
    fixtures. **No `as` and no `any` in the test or the fixture** - the file's only cast is
    `(err as Error).message` inside a `catch`, unrelated to the demonstration. `pnpm typecheck` clean.
  - *Check discharged (why the array is accepted):* method-declared bivariance, demonstrated
    adversarially, not assumed. An arrow-typed twin of the same shape
    (`run: (ctx: PluginContext<T>, args: string[]) => Promise<void>`) was compiled against the
    shipped types and **fails**: `TS2322: Type 'ArrowCommand<{a: string}>' is not assignable to type
    'ArrowCommand<unknown>'. Type 'unknown' is not assignable to type '{a: string}'.` The shipped
    method syntax at `plugin.ts:183` is what makes the registry legal. No widening cast, no `any`
    in the registry type.
  - *Check discharged (`never` has no inhabitant):* `PluginContext<never>['pluginConfig'] = emptyBlock`
    is `TS2322: Type 'Record<string, never>' is not assignable to type 'never'`. Nothing in the diff
    constructs a `PluginContext<never>`: `probes(ctx: PluginContext)` (`plugin.test.ts:247`) only
    *declares* the parameter and is never called.
  - *The `never` rationale is right way round, re-verified independently:* deleting the
    `@ts-expect-error` at `plugin.test.ts:248` and running `tsc -p tsconfig.typecheck.json` yields
    exactly `src/plugin.test.ts(248,29): error TS2339: Property 'anything' does not exist on type
    'never'.` The directive is load-bearing. Conversely, adding an `@ts-expect-error` directly above
    the whole-field assignment yields `TS2578: Unused '@ts-expect-error' directive` - so
    `const n: number = ctx.pluginConfig` genuinely compiles and is correctly left unguarded and
    documented (`plugin.ts:311-320`) rather than designed around. `tsconfig.typecheck.json` sets
    `"exclude": []`, so test files are inside the typecheck gate; note that `pnpm build` excludes
    `**/*.test.ts`, so this probe is enforced by `pnpm typecheck` (CI) rather than by the build.
  - *Status:* ☑ SATISFIED

- **O6 - `parseConfigDocument` gives the host a typed route to a plugin's raw block.**
  - *Claim:* `parseConfigDocument(text)` returns `{ config: OpsConfig; raw: Readonly<Record<string, unknown>> }`, `parseConfig` keeps its signature as the `config` half, and `pluginBlock(raw, key)` reads a block out of that document.
  - *Evidence collected:* `packages/core/src/config.ts:241-270`. `parseConfig(text: string): OpsConfig`
    is unchanged in signature and now returns `parseConfigDocument(text).config`.
    `pluginBlock(raw, key): unknown` at `config.ts:269`. `pnpm test` → 121 core tests pass, including
    the four new `parseConfigDocument`/`pluginBlock` cases; the unknown top-level key `analytics`
    round-trips into `raw`.
  - *Byte-identity discharged independently.* The shipped test (`config.test.ts:136`,
    `expect(config).toEqual(parseConfig(text))`) is near-tautological now that `parseConfig` *is*
    that expression, so it was not relied on. The pre-change implementation was reconstructed
    verbatim (`mergeConfig(JSON.parse(stripTrailingCommas(stripJsonComments(text))))`) and run
    against the new `parseConfig` over seven fixture documents (defaults, domain+microvm, pds block,
    paths, unknown plugin key, comments+trailing comma, sourceInclude): `JSON.stringify` output is
    identical in every case. Error-path parity also holds on five failing documents, message for
    message, including the `TypeError` on `null`. Execution trace confirms why: `mergeConfig` builds
    a fresh `cfg` by spreading and never mutates `raw`, so hoisting the parse changes nothing.
  - *Check discharged:* nothing indexes `OpsConfig` by a `string`; the type-claim corpus pins
    `config[configKey]` as `TS7053` (claim C07) and it still holds. No cast on `OpsConfig` was added
    anywhere - `config.ts:254`'s `raw as Partial<OpsConfig>` is the same cast the deleted line
    already carried, relocated.
  - *Regression on every existing caller:* `packages/cli/src/context.ts:95` (`loadConfig`),
    `packages/cli/src/init.test.ts:33`, and core's own `config.test.ts` are the complete caller set
    (repo-wide grep). All take `(text: string) => OpsConfig`; all pass.
  - *Status:* ☑ SATISFIED

- **O7 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* run from `/Users/ant/code/blogwright-task-03`:
    `pnpm build` clean · `pnpm typecheck` clean (5 projects) · `pnpm test` clean
    (core 121 passed/1 skipped, build-agent 27, pds 85, cli 143) · `pnpm lint` exit 0
    (`packages/core lint: Done`, no diagnostic on `plugin.ts` or `config.ts`; the only warnings are
    pre-existing `no-shadow` notes in `packages/cli/src/nodes.test.ts`) ·
    `pnpm exec oxfmt --check .` "All matched files use the correct format" (127 files) ·
    `pnpm knip` exit 0, no output. `PLUGIN_NAME_PATTERN` is a module-level
    `SCREAMING_SNAKE_CASE` constant (`plugin.ts:288`), not an inline literal. No changeset: the SPI
    is internal and unreleased, and plan.md task 20 owns the plugin system's changeset coverage.
  - *Extra gate:* the plan's type-claim corpus,
    `node .specs/plans/2026-07-26-plugin_system_and_analytics/type-claims/check.mjs` →
    `PASS: 29 claims held (12 compiled positives, 17 pinned compile-errors)`. The corpus's
    transcription of `Plugin` is member-for-member the shipped one (it leaves `init`'s io/return as
    `unknown` by design, deferring to tasks 13/47), and C01/C02 pin the `never` default in the same
    direction the shipped types and doc comments state. **The corpus and the shipped types agree;
    neither side is wrong here.**
  - *Status:* ☑ SATISFIED

- **O8 - The negative-space suite is legible in one run (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin` and observe the seven negative cases each asserting the package name, then `grep -n ': any' packages/core/src/plugin.ts` returning nothing.
  - *Evidence collected:* `pnpm --filter blogwright-core exec vitest run plugin --reporter=verbose`
    (the `Reviewable:` line as written) - 13 passed, 1 file, named:
    `PLUGIN_NAME_PATTERN > accepts only lowercase alphanumerics and dashes`;
    `validatePlugin > returns a typed Plugin from a minimal valid module`;
    `> rejects a module with no default export`; `> rejects a non-object default export`;
    `> rejects a missing or empty name`; `> rejects a name that violates PLUGIN_NAME_PATTERN`;
    `> rejects a missing description`; `> rejects commands that is not an array`;
    `> rejects a command missing action or run`;
    `> validates cleanly even when nodes() would throw if called`;
    `> never includes a value read off the module in the raised message`;
    `Plugin<TConfig> type-level contract > joins a heterogeneous registry through Plugin<unknown>
    with no cast, and dispatches both run methods`;
    `> never default: a property read off ctx.pluginConfig is TS2339, while a whole-field assignment
    compiles`. Each of the seven negatives carries an explicit
    `expect(() => validatePlugin(…, PACKAGE)).toThrow(new RegExp(PACKAGE))` alongside its
    message-shape assertion. `grep -n ': any' packages/core/src/plugin.ts` → no output, exit 1.
  - *Status:* ☑ SATISFIED

## Regression check

No existing callers in scope - `validatePlugin` gains its first caller in task 08, and `Plugin` its first implementor in task 25. The only shared surface is `packages/core/src/plugin.ts` itself: confirm `PluginContext` (task 01) and `ResourceNode` (task 02) still compile and are still exported after the additions.

- `packages/cli/src/context.test.ts` assigns `createTestContext()` to a `PluginContext` binding → expect it still compiles and passes after the module grows : ☑ **PRESERVED** (the `PluginContext composition` describe block at `context.test.ts:89` still compiles and its cases pass; cli suite 143/143 green, `pnpm typecheck` clean)
- `packages/cli/src/graph.ts:18` `topoSort<Ctx>(nodes: ResourceNode<Ctx>[])` (task 02's generic engine) → expect `ResourceNode` still resolving through `blogwright-core` : ☑ **PRESERVED** (`graph.ts:1` still imports `type { ResourceNode, ResourceOutputs } from 'blogwright-core'`; `GraphContext` unchanged; build, typecheck and cli tests green)
- `parseConfig`'s three production/test callers (`packages/cli/src/context.ts:95`, `packages/cli/src/init.test.ts:33`, `packages/core/src/config.test.ts`) : ☑ **PRESERVED** (signature unchanged; output byte-identical to the pre-change implementation on seven happy and five failing documents)

## Residue

Notes for the validator, not obligations. Discovery imports arbitrary code from the consuming repository, so `validatePlugin` is the only guard between a malformed module and dispatch; a validator finding it lenient in a case the DoD does not enumerate (a `commands` array containing a non-object, a duplicate `action` within one plugin) should record it here rather than fail an obligation - namespace-level collision rules are task 09. The `init` return shape (`ConfigBlockEntry[]`) is consumed by the textual JSONC splice in task 12 and the generic init action in task 13; if either lands with a different shape, this module is the one that must change, not they.

**Recorded by the validator:**

1. **Message join produces a stray space before the possessive.** `rejectPlugin`
   (`plugin.ts:368`) builds `` `plugin package "${packageName}" ${detail}` ``, and six of the seven
   detail strings open with `'s`. Every possessive message therefore reads
   `plugin package "acme-plugin" 's Plugin.name is required - …`. Cosmetic, user-visible on every
   plugin-load failure, and invisible to the tests because each matches a substring that avoids the
   join. One-line fix (drop the space, or the leading `'s`).
2. **`summary` is never checked, yet the result is asserted to be a `Plugin`.** `validatePlugin`
   validates `action` and `run` per command (`plugin.ts:430-434`) but not `summary`, then returns
   `candidate as unknown as Plugin` (`plugin.ts:443`). A module whose command omits `summary` is
   accepted and `plugin.commands[0].summary` is `undefined` while typed `string` - verified by
   running the built module. Help output (task 14/16) would print `undefined`. Not among the DoD's
   seven, so recorded rather than failed, but unlike duplicate actions this is a *declared required
   member* of the type being asserted.
3. **The optional members' types are unchecked too.** `configKey: 42`, `validateConfig: 'x'`,
   `nodes: 'x'` all validate cleanly. Task 19's dispatch calling a string-valued `validateConfig`
   would surface a bare `TypeError`, not a message naming the package.
4. **Doc-comment overstatement.** `plugin.ts:377-378` says validation touches "only property reads
   and `typeof`/`Array.isArray` narrowing, so a malformed or hostile module cannot run code merely
   by being validated". The first half is true and is what the DoD asks for; the security claim is
   not. Property reads run module-supplied getters (demonstrated: `default` and `name` getters both
   fired), and `for (const command of commands)` (`plugin.ts:429`) runs a module-supplied
   `Symbol.iterator` (demonstrated with an `Array` subclass). The point is moot in practice - the
   module has already been `import`ed, running its top-level code, before `validatePlugin` sees it -
   but the sentence should be trimmed to the DoD's actual claim.
5. **The byte-identity test is near-tautological.** `config.test.ts:136` compares
   `parseConfigDocument(text).config` with `parseConfig(text)`, and `parseConfig` now *is* that
   expression, so it cannot detect a divergence from the pre-change behaviour. O6 was discharged
   against a reconstruction of the old implementation instead; the unchanged legacy `parseConfig`
   suite also pins the old behaviour. Worth strengthening to a pinned expected object.
6. **`raw` and `config` share nested objects.** `parseConfigDocument` returns the same parsed object
   that `mergeConfig` spread into `config`, so `raw.analytics === config.analytics` and an in-place
   mutation through one is visible on the other (verified). Pre-existing from the `...raw` spread,
   but newly *reachable* now that `raw` escapes. Harmless while `validateConfig` returns a value
   rather than mutating, which is what the SPI mandates.
7. **`command` is implicitly `any` inside the loop.** `Array.isArray(commands)` narrows `unknown` to
   `any[]` via the lib signature, so the `for…of` binding is `any`. Every read is guarded by
   `isRecord(command)` first, and the DoD's `grep ': any'` check passes because the `any` is
   inferred, not annotated. No hazard, noted for completeness.
8. **The cast at `plugin.ts:443` carries no justifying comment.** DEVELOPMENT.md §Code style: "Casts
   are bugs unless the next line validates the result or a comment justifies them." Here validation
   *precedes* the cast, which is the sanctioned validator idiom, but neither the line nor the
   function's doc comment says so.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All eight obligations are SATISFIED on collected evidence - six gates plus the type-claim
gate and the `Reviewable:` line run clean, the seven rejection reasons each have their own passing
negative test, the `never` default's `@ts-expect-error` was re-proved load-bearing (TS2339) with its
documented unsoundness re-proved unguardable (TS2578), the heterogeneous registry was shown to
compile through method-declared bivariance and not a cast (its arrow-typed twin fails TS2322), and
`parseConfig` was shown byte-identical to the pre-change implementation against a reconstruction
rather than against the shipped near-tautological test - with eight non-blocking findings recorded
in Residue, of which the stray space in every possessive error message and the unchecked required
`summary` are the two worth a follow-up.
