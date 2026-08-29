# Done Certificate - Task 01: Declare PluginContext in blogwright-core

**Task:** [01-core_plugin_context.md](01-core_plugin_context.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 01. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

> **Re-gate.** This is the second discharge. The first returned `pending correctness fix` on
> three findings (D1 - no `TConfig = never` default; D2 - shallow `SiteState`; D3 - four
> undocumented fields). This pass re-derived every obligation from scratch against the current
> workspace `/Users/ant/code/blogwright-task-01`, rebased onto `d65d5457` (which already carries
> task 00 and task 04). The prior pass's conclusions were not treated as evidence.

## Definition

DONE(Task 01) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `PluginContext`, `PluginLogger`, `PluginPorts` and `SiteState` are declared in `packages/core/src/plugin.ts` and exported from core's index, with a CLI test that composes a `PluginContext` from an `OpsContext` plus the three members the dispatch boundary supplies (`pluginConfig`, `siteState`, `record`) and so fails the build the moment any member stops being suppliable. `OpsContext` does not satisfy `PluginContext` by assignment and is not expected to.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `packages/cli/src/context.ts` (`OpsContext` and `createContext` keep their current shape and wiring), `packages/cli/src/test-support.ts` (`createTestContext` still returns a complete `OpsContext`), `packages/pds/src/context.ts` (`PdsContext` unchanged until task 24), or `packages/core/src/index.ts`'s existing exports (no name collision introduced by the new barrel line). Additionally, for this rebase: task 04's `StateStore` (optional 4th `scope` argument, `packages/core/src/state.ts:48-63`) and task 01's `plugin.ts` must coexist.

## Obligations

- **O1 - `PluginContext` names exactly the agreed sixteen members and nothing more.**
  - *Claim:* the interface declares `env`, `domain`, `preview`, `config`, `pluginConfig`, `names`, `accountId`, `clients`, `ports`, `tags`, `logger`, `store`, `state` (the plugin's own state), `siteState` (the read-only site view), `record()` and `save()` - and nothing else. `agentDir` and every CLI-private port are absent, and their absence is recorded in a doc comment as a rule, not a count.
  - *Evidence to collect:* read the `PluginContext` declaration in `packages/core/src/plugin.ts` and enumerate its members - expect exactly sixteen; compare against `OpsContext` at `packages/cli/src/context.ts:25-51` and confirm `agentDir` (:40) appears in `OpsContext` only; read `packages/cli/src/ports.ts:24` and confirm `PluginContext.ports` is `PluginPorts` (`fs`, `terminal`) rather than the CLI's `Ports`, with a comment in `plugin.ts` naming `vcs`/`ping` (and tasks 05/06's `loader`/`packages`) as CLI-private types core cannot reference.
  - *Status:* SATISFIED - verified **mechanically**, not by eye. A temporary probe in
    `packages/cli/src/context.test.ts` using `type Exact<A,B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never`
    compiled clean for
    `Exact<keyof PluginContext<unknown>, 'env'|'domain'|'preview'|'config'|'pluginConfig'|'names'|'accountId'|'clients'|'ports'|'tags'|'logger'|'store'|'state'|'siteState'|'record'|'save'>`
    - so the key set is exactly those sixteen, no extra and none missing - and clean for
    `Exact<OptionalKeys<PluginContext<unknown>>, 'tags'>`, so `tags` is the *only* optional member
    (`plugin.ts:120`, `tags?: Record<string, string> | undefined`). Declaration order matches the spec's
    enumeration (`plugin.ts:75-159`). Type resolution was probed the same way and compiled clean for
    `ports`≡`PluginPorts`, `state`≡`OpsState`, `siteState`≡`SiteState`, `store`≡`StateStore` (all from
    `blogwright-core`), and **failed** (`TS2322: Type 'true' is not assignable to type 'never'`) for
    `Exact<PluginContext['ports'], Ports>` - confirming `ports` is core's two-member `PluginPorts`
    (`plugin.ts:42-45`), not the CLI's four-member `Ports` (`packages/cli/src/ports.ts:24-29`).
    `agentDir` appears only on `OpsContext` (`packages/cli/src/context.ts:40`). The module comment
    (`plugin.ts:1-13`) and `PluginPorts`' doc (`:33-41`) name `agentDir`, `vcs`, `ping` and "any port a
    later CLI feature adds" as the CLI-private rule. `configDocument` (spec §Typed plugin config, which
    keeps the raw document on `OpsContext`) is correctly absent. All probes removed.

- **O2 - The load-bearing fields are justified, and every export is documented.**
  - *Claim:* `names`, `accountId` and `siteState` carry doc comments naming their real consumers (task 53's log-delivery node reading `names.deliverySource` and the site's recorded distribution outputs; the analytics IAM roles reading the account id), and every exported symbol in the module has a doc comment.
  - *Evidence to collect:* read every `export` in `packages/core/src/plugin.ts` and confirm each is preceded by a `/** … */` block; confirm `packages/core/src/config.ts:343` really declares `deliverySource` and that the comment names it; confirm `.specs/changes/2026-07-26-analytics_plugin.md` §Analytics pipeline → Shape states the plugin reads `ctx.names.deliverySource`.
  - *Status:* SATISFIED - all four exports carry `/** … */` (`PluginLogger:20-24`, `PluginPorts:33-41`,
    `SiteState:47-59`, `PluginContext:64-74`) and the module opens with an ownership comment
    (`:1-13`), meeting DEVELOPMENT.md:245-250 ("Public exports of `blogwright-core` … carry doc
    comments"; "Each module opens with a comment stating what it owns"). `names` (`:94-99`) names
    `names.deliverySource` and the analytics log-delivery node; `accountId` (`:101-105`) names the
    pds/analytics IAM ARNs; `siteState` (`:47-59`, `:138-141`) names the analytics log-delivery node
    reading the site's CloudFront distribution ARN. `packages/core/src/config.ts:343` declares
    `deliverySource`.
    **D3 closed:** the previous pass's four undocumented fields now carry doc comments - `env:76`,
    `domain:78`, `clients:107`, `logger:121` - and all sixteen fields are documented
    (`:76, 78, 80, 82, 84, 94, 101, 107, 109, 111, 121, 123, 129, 138, 143, 153`), satisfying the
    task's Step 20 "every `PluginContext` field", not just the DoD's weaker "every exported symbol".

- **O3 - Read-only site view, scoped store, and no CLI import.**
  - *Claim:* `siteState` is typed so an assignment into `ctx.siteState.resources` does not compile, `state` and `siteState` are distinct fields of distinct types, `record()` writes to the former only, `store` is documented as the plugin's own scoped store, `plugin.ts` imports only core modules, and `packages/pds/src/context.ts` is unchanged.
  - *Evidence to collect:* read the `SiteState` declaration and confirm `PluginContext.state` is core's `OpsState` while `PluginContext.siteState` is the readonly view - separate fields of separate types; confirm a `ResourceNode<PluginContext>` test calls `ctx.record(...)` and reads the value back from `ctx.state.resources` while `ctx.siteState` is unaffected; confirm a second test runs the real `destroyGraph` over a one-node plugin graph and observes `ctx.state.resources` lose the id, which a bare outputs map cannot satisfy; temporarily add `const c: PluginContext = createTestContext(); c.siteState.resources['x'] = {};` to `packages/cli/src/context.test.ts`, run `pnpm typecheck`, expect a read-only assignment error, then remove the probe; read the import list at the top of `packages/core/src/plugin.ts` and confirm every specifier is a relative `./…` core module; run `git diff --stat packages/pds/` and expect no output.
  - *Checks:* resolve the type of `PluginContext.store` - confirm it is core's `StateStore` from `packages/core/src/state.ts:25` and not a CLI type.
  - *Status:* SATISFIED - **D2 closed.** `SiteState` (`plugin.ts:60-62`) is now
    `{ readonly resources: Readonly<Record<string, Readonly<ResourceOutputs>>> }` - readonly at *both*
    levels. Probe, both lines in one compile:
    `probeCtx.siteState.resources['site']` then `r['arn'] = 'mutated'` →
    `error TS2542: Index signature in type 'Readonly<ResourceOutputs>' only permits reading`
    (the mutation the previous pass showed compiling), and
    `probeCtx.siteState.resources['x'] = {}` →
    `error TS2542: Index signature in type 'Readonly<Record<string, Readonly<ResourceOutputs>>>' only permits reading`.
    The deepening cost nothing: in the same probe `const s: SiteState = probeOps.state;` and
    `const s2: SiteState = { resources: probeOps.state.resources };` both compiled clean, so `OpsState`
    still satisfies `SiteState` with **no wrapper** and the CLI still hands its `state` straight through
    (task-01 step line 14 / claim C15); and reads still work - `takesOutputs(dr)` with
    `dr: Readonly<ResourceOutputs>` passed to a `ResourceOutputs` parameter, and `dr['arn']`, both
    compiled clean, so task 53's read path is unaffected. `pnpm build`, `pnpm typecheck` and
    `pnpm test` are green across all six projects with the deeper type, so no existing assignment
    anywhere in the repo broke.
    `state: OpsState` (`:137`) and `siteState: SiteState` (`:142`) are distinct fields of distinct
    types; `store: StateStore` resolves through `import type { OpsState, ResourceOutputs, StateStore } from './state.js'`
    (`:18`) to `packages/core/src/state.ts:48`, and its doc (`:123-127`) names the scoped
    `state/<env>.<plugin>.json` key that task 04's `stateKey` (`state.ts:20-22`) produces.
    The record test (`context.test.ts:122-148`) writes through `ctx.record` into a separate
    `emptyState(ops.env)` and asserts `siteState` is unaffected; **non-vacuous** - deleting
    `await node.create(ctx);` fails it with `expected undefined to deeply equal { arn: 'a' }`.
    The second test (`:150-175`) imports and runs the **real** `destroyGraph` from `./graph.js`
    (`packages/cli/src/graph.ts:88-100`, which does `delete ctx.state.resources[node.id]`) over a
    one-node graph; **non-vacuous** - deleting `await destroyGraph([node], ops);` fails it with
    `expected { arn: 'queue-arn' } to be undefined`. It genuinely gates the `OpsState` shape:
    retyping `state` to `Record<string, ResourceOutputs>` and rebuilding core yields
    `TS18048: 'ctx.state.resources' is possibly 'undefined'` at `context.test.ts:144` and `:174`
    plus `TS2322` on all four compositions; probe reverted and core rebuilt.
    `plugin.ts` imports only `./clients.js`, `./config.js`, `./ports.js`, `./state.js` - no CLI or pds
    module. `jj diff --stat` lists exactly three files; `packages/pds/` is untouched.

- **O4 - The CLI test proves the composition without a cast.**
  - *Claim:* `packages/cli/src/context.test.ts` builds a `PluginContext<unknown>`-annotated value from a `createTestContext()` result spread plus exactly `pluginConfig`, `siteState` and `record`, with no `as` and no `any`, and the suite passes.
  - *Evidence to collect:* read the added test in `packages/cli/src/context.test.ts`; run `pnpm test -- context` › the new composition test and expect it green; grep the file for `as PluginContext` and ` any` and expect no hits; confirm the three boundary-supplied members are exactly `pluginConfig`, `siteState` and `record` and that no member `OpsContext` already carries is written a second time.
  - *Checks:* resolve the `PluginContext` identifier in that test - confirm it is imported from `blogwright-core`, not re-declared locally in the CLI. Then temporarily write `const p: PluginContext = createTestContext();`, run `pnpm typecheck`, and expect `TS2739` naming `pluginConfig`, `siteState` and `record` - a bare assignment compiling would mean `PluginContext` lost one of the three, not that the task succeeded. Remove the probe.
  - *Status:* SATISFIED - **D1 closed.** `plugin.ts:75` now reads
    `export interface PluginContext<TConfig = never>`, matching `type-claims/transcriptions.ts:68`.
    The prescribed probe `const probeBare: PluginContext = createTestContext();` now yields exactly
    `src/context.test.ts(179,7): error TS2739: Type 'OpsContext' is missing the following properties from type 'PluginContext<never>': pluginConfig, siteState, record`
    - the required diagnostic, naming the required three, with **no** `TS2314` arity error. The two
    downstream forms the previous pass showed failing were re-probed and now compile clean:
    `interface ProbeNode02<Ctx = PluginContext> { … }` (task 02's `ResourceNode`) and
    `declare function probeRun03(ctx: PluginContext, args: string[]): Promise<void>` (task 03's `run`).
    Probes removed.
    The *Claim* holds independently: `context.test.ts:96-102` is the composition gate - a
    `createTestContext()` spread plus exactly `pluginConfig`, `siteState`, `record`, annotated
    `PluginContext<unknown>`, no cast, no field written twice. `PluginContext` is imported from
    `blogwright-core` (`:1-7`), not re-declared. No `as PluginContext`, no `any` anywhere in the file.
    All ten tests in the file pass.
    NOTE (not a DoD failure): the third test (`:127-133`) additionally re-points `state: pluginState`
    over the spread. That is deliberate - it is what makes the two state surfaces visibly distinct -
    and the DoD's "exactly three, no field written twice" composition is the *first* test, which is
    clean.

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm no changeset is required because the change adds internal SPI vocabulary that no shipped command yet dispatches through.
  - *Status:* SATISFIED - from `/Users/ant/code/blogwright-task-01`, all re-run **after** every probe was
    removed: `pnpm build` exit 0 (six projects), `pnpm test` exit 0 - 344 passed / 1 skipped
    (core 104, build-agent 27, pds 85, cli 128), `pnpm typecheck` exit 0 (also a CI step),
    `pnpm lint` exit 0 (25 `no-shadow` warnings, all pre-existing in the untouched
    `packages/cli/src/nodes.test.ts`; zero in any touched file), `pnpm exec oxfmt --check .` exit 0
    ("All matched files use the correct format", 123 files), `pnpm knip` exit 0 with no output.
    Additionally, the plan's own type-claim gate
    (`.specs/plans/…/type-claims/check.mjs`) passes: "PASS: 29 claims held (12 compiled positives,
    17 pinned compile-errors)". No changeset: the change adds internal SPI vocabulary no shipped
    command dispatches through, and CI has no changeset gate.

- **O6 - Adding a field neither `OpsContext` nor the boundary supplies breaks the build (Reviewable).**
  - *Claim:* a reviewer can run the task's `Reviewable:` command, then add to `PluginContext` a field that neither `OpsContext` carries nor the test's three boundary members supply, and observe `pnpm typecheck` fail inside `packages/cli/src/context.test.ts`.
  - *Evidence to collect:* run the two commands and record the pass; add `probe: string;` to `PluginContext`, run `pnpm typecheck`, expect an error naming `packages/cli/src/context.test.ts` and the missing property; revert the probe and re-run `pnpm typecheck` to confirm clean.
  - *Status:* SATISFIED - the `Reviewable:` line as currently written was exercised verbatim:
    `pnpm build && pnpm --filter blogwright exec vitest run context --reporter=verbose` → build exit 0,
    then **1 test file, 10 tests, all green**, and the filter genuinely narrows (only
    `src/context.test.ts` ran, out of the CLI's 15 test files), listing the four new cases by name.
    Adding `probeField: string;` to `PluginContext` and rebuilding core (required - the CLI typechecks
    against `packages/core/dist/*.d.ts`, which is CI's `pnpm build` → `pnpm typecheck` order) yields
    four errors, **all** inside `packages/cli/src/context.test.ts` (`:98`, `:109`, `:127`, `:153`):
    `TS2741: Property 'probeField' is missing in type '{ … }' but required in type 'PluginContext<…>'`.
    Probe reverted, core rebuilt, all six gates re-run clean, and `jj status` shows exactly the three
    intended files modified (`packages/cli/src/context.test.ts`, `packages/core/src/index.ts`,
    `packages/core/src/plugin.ts`), with source checksums matching their pre-probe values.

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.test.ts:8` runs the existing `loadConfig` suite after the new import and test are added → the six original `loadConfig`/`deriveAppTag` assertions all pass (10 of 10 in the file) : PRESERVED
- `packages/core/src/index.ts:23` re-exports `./plugin.js` in alphabetical position between `./config.js` (:22) and `./ports.js` (:24) → no other core module declares `PluginContext`, `PluginLogger`, `PluginPorts` or `SiteState` (grepped `packages/core/src` for each), so no collision and no ambiguous re-export; `pnpm build` and `pnpm knip` emit nothing : PRESERVED
- `packages/cli/src/context.ts:139` builds an `OpsContext` literal → `context.ts` is not in the diff (three files touched) and `pnpm typecheck` is clean : PRESERVED
- **Rebase-specific:** task 04's `StateStore` (optional 4th `scope` ctor argument, `packages/core/src/state.ts:48-63`) and task 01's `plugin.ts` coexist → `plugin.ts:18` imports `OpsState`, `ResourceOutputs` and `StateStore` from `./state.js`; core builds and its 104 tests pass; `PluginContext.store`'s doc (`:123-127`) names the `state/<env>.<plugin>.json` key task 04's `stateKey` (`state.ts:20-22`) actually produces, so the two land coherently rather than merely compiling : PRESERVED
- `packages/pds/src/context.ts` and `packages/cli/src/context.ts` untouched → `jj diff --stat` lists only the three intended files : PRESERVED

## Residue

Notes for the validator, not obligations. `OpsContext` is deliberately not assignable to `PluginContext`, and a validator who "fixes" that by deleting `pluginConfig`, `siteState` or `record` has broken the SPI: the two state surfaces are separate because the site's state and the plugin's come from two different stores (spec §The two state surfaces), and the adaptation between them is a function at the dispatch boundary, written for real in task 10 and completed with the scoped store in task 16. O4's composition is the compile-time alarm standing in for that function until it exists; if a later task adds a field to `PluginContext` that neither side supplies, O4 is what breaks first, and that is the intent. The lifecycle context plugin *nodes* receive during task 16 is the same `PluginContext` with `store`/`state` re-pointed at the plugin's scoped store; nothing here forecloses that.

Two notes from this pass, neither blocking:

1. **The type-claim corpus is now behind the shipped type.** `type-claims/transcriptions.ts:55` and this task's Step (the `SiteState` bullet) both spell the **shallow** `{ readonly resources: Readonly<Record<string, ResourceOutputs>> }`. The shipped type is one level deeper. Probed side by side in one compile: under the shallow shape `const sr = shallow.resources['site']; if (sr) sr['arn'] = 'mutated';` compiles clean; under the shipped shape the same code is `TS2542`. The corpus is the defective side - it transcribes a type that does **not** deliver this task's own DoD invariant ("a plugin can never write `state/<env>.json`"), because `siteState.resources` aliases the site's `ops.state.resources` with no wrapper, so a second-level write would reach the site's in-memory state and be persisted by the site's own `save()`. The corpus gate still passes (29/29) because claim C13 only exercises the outer index signature and C15 holds under both. Per `check.mjs`'s own rule ("Fix the document or the transcription, never the claim alone"), `transcriptions.ts:55` and the task's `SiteState` step should be updated to the deeper form. That is a plan-document edit, outside this task's diff, and no code change follows from it.
2. **Residual depth.** `Readonly<ResourceOutputs>` freezes the map's own index signature but not an array *value*: `ResourceOutputs` admits `string[]`, so a plugin that narrows with `Array.isArray` could still `push` into a site output in memory. No site node records an array output today (`packages/cli/src/nodes.ts` records only `name`, `arn`, `version` and other scalars), so the hole is theoretical, and the shipped type is already strictly stronger than what the spec, the task step and the corpus all prescribe. Recorded, not raised.

## Conclusion

VERDICT: DONE (O1-O6 all SATISFIED)
CONFIDENCE: high
SUMMARY: All three prior findings are genuinely fixed and independently re-derived - `PluginContext<TConfig = never>`
makes the bare-assignment check produce exactly `TS2739: … missing … pluginConfig, siteState, record` and unblocks
tasks 02 and 03's declarations; `SiteState` is now readonly at both levels so the second-level mutation that
falsified the "a plugin can never write `state/<env>.json`" claim is `TS2542`, with `OpsState` still assignable
straight through and reads unaffected; and all sixteen fields plus all four exports carry doc comments. The
sixteen-member enumeration, `tags` as the sole optional, and every member's type were verified mechanically with
compiled `Exact<…>` equality probes rather than by inspection; the four tests are non-vacuous by deletion; the
add-a-field alarm fires four times, all inside `packages/cli/src/context.test.ts`; and all six repo gates plus
the plan's own 29-claim type gate are green with the workspace left at exactly the three intended files.

**Validator note (correctness gate: CORRECT).** No defect in the diff. One divergence recorded against the plan's
own documents rather than the code: `type-claims/transcriptions.ts:55` (and the task's `SiteState` step) still
transcribe the shallow `Readonly<Record<string, ResourceOutputs>>`, which is weaker than what shipped and weaker
than this task's DoD requires - see Residue note 1. Fix the transcription and the step, not the code.
