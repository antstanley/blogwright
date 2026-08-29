# Done Certificate - Task 02: Move ResourceNode from the CLI into blogwright-core

**Task:** [02-core_resource_node_relocation.md](02-core_resource_node_relocation.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 02. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 02) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `ResourceNode<Ctx = PluginContext>` lives in `blogwright-core` and is reachable from its index; `packages/cli/src/graph.ts` is reduced to the engine, generic over the structural context minimum it actually uses, and `packages/cli/src/nodes.ts` changes only its import block.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's reconciliation behaviour: `packages/cli/src/nodes.ts` `buildNodes` (:1053) must still produce the same node set in the same order, and `packages/cli/src/commands.ts` `bootstrap` (:46) and `destroy` (:63) must still call `applyGraph`/`destroyGraph` unchanged. No derived AWS resource name may move.

  **P3 discharged mechanically.** Both production files were emitted with the repo's own tsc
  (`--noResolve --isolatedModules --module nodenext --target es2023 --verbatimModuleSyntax`) at
  the parent commit and at the working copy, and the JavaScript is **byte-identical** for both
  `nodes.ts` and `graph.ts`. The whole production diff is type-erasure: an `import type`, a
  `type` alias, three generic parameter lists and one local annotation. `buildNodes` therefore
  emits the same node set in the same order, `applyGraph`/`destroyGraph` execute the same
  statements, and no derived AWS name can have moved. `commands.ts` is not in the diff at all.

## Obligations

- **O1 - The type lives in core; the engine stays in the CLI.**
  - *Claim:* `ResourceNode` is declared in `packages/core/src/plugin.ts`, is importable as `import type { ResourceNode } from 'blogwright-core'`, and `packages/cli/src/graph.ts` no longer declares it while still exporting `topoSort`, `applyGraph` and `destroyGraph`, now generic over the engine's named structural minimum, with bodies unchanged apart from the one local annotation the generic forces at `:39` (`order: ResourceNode<Ctx>[]`).
  - *Evidence collected:* declaration at `packages/core/src/plugin.ts:193`
    (`export interface ResourceNode<Ctx = PluginContext>`), reached through the single
    `export * from './plugin.js'` barrel line at `packages/core/src/index.ts:23` - no second
    export line was added. `grep -n 'interface ResourceNode' packages/cli/src/graph.ts` returns
    no output (exit 1). The `graph.ts` diff removes exactly the old `:4-15` interface block and
    the `import type { OpsContext } from './context.js'` line. Diffing the engine region of the
    parent-commit file against the working copy
    (`diff <(sed -n '/^export function topoSort/,$p' base) <(… working copy)`) yields exactly
    four changes and nothing else: the three signatures (`topoSort` :29, `applyGraph` :69,
    `destroyGraph` :103) and the one local annotation, now at `:50`
    (`const order: ResourceNode<Ctx>[] = [];` - the old `:39`, shifted by the added
    `GraphContext` block). Every statement is byte-identical, and the emitted JS is identical
    (see P3).
  - *Checks:* `ResourceNode` inside `packages/cli/src/graph.ts` resolves to the
    `blogwright-core` import at `:1` - it is the only binding of that name in the file
    (`grep -n ResourceNode packages/cli/src/graph.ts` shows the import plus four use sites, no
    local alias and no re-export). The certificate's Residue test - "an exported alias named
    `ResourceNode` in `graph.ts` fails O1" - does not fire.
  - *Status:* ☑ SATISFIED

- **O2 - `nodes.ts` changed only its import block.**
  - *Claim:* the 1,087-line file's diff is confined to the import hunk (the `./graph.js` type import replaced by an aliased `blogwright-core` import plus one instantiation line); no function body and no node-factory signature moved.
  - *Evidence collected:* `jj diff --git packages/cli/src/nodes.ts` reports **one** hunk
    (`grep -c '^@@'` = 1), `@@ -6,11 +6,13 @@`, entirely above the first `function` declaration
    (`microvmBaseImageArn`, `:17`). `jj diff --stat` reports 4 changed lines. `grep -n
    'ResourceNode<' packages/cli/src/nodes.ts` returns exactly one hit - `:15`,
    `type ResourceNode = CoreResourceNode<OpsContext>;`. All fifteen annotations still read
    bare and sit at exactly the pointer lines plus the two-line import shift:
    44, 82, 153, 221, 371, 395, 484, 540, 592, 715, 782, 827, 975, 1055, 1057
    (pointers 42, 80, 151, 219, 369, 393, 482, 538, 590, 713, 780, 825, 973, 1053, 1055).
    Emitted JS byte-identical (P3).
  - *Status:* ☑ SATISFIED

- **O3 - The parameterisation is deliberate, documented, and cast-free.**
  - *Claim:* the declaration is `ResourceNode<Ctx = PluginContext>` with an unconstrained parameter, its doc comment states why no `extends PluginContext` bound is possible (`OpsContext` lacks `pluginConfig`, `siteState` and `record`, so the constrained form is `TS2344` at every CLI annotation) and that the engine's generic constraint is the structural minimum both contexts satisfy, and the change introduces no cast and no `any`.
  - *Evidence collected:* `packages/core/src/plugin.ts:160-192` carries the doc comment and
    `:193` the unconstrained declaration. The engine's constraint,
    `packages/cli/src/graph.ts:16-26 GraphContext`, names exactly three members -
    `logger` (only `step`/`ok`/`warn`, the three the engine calls), `state.resources:
    Record<string, ResourceOutputs>`, and `save(): Promise<void>` - and names neither
    `OpsContext` nor `PluginContext`. Grepping the added lines of `jj diff --git` for
    ` as ` / `any` yields only the import-alias syntax
    (`type ResourceNode as CoreResourceNode`) and the English word "as" in prose; no cast, no
    `any`, no `@ts-expect-error` anywhere in the diff.
  - *Checks - run, not reasoned:*
    - **Negative probe (the doc comment's central claim).** `extends PluginContext` was
      temporarily added to the declaration, `blogwright-core` rebuilt, and
      `pnpm --filter blogwright typecheck` run: exit 2 with **12 × TS2344 and nothing else**,
      including `src/nodes.ts(15,38): error TS2344: Type 'OpsContext' does not satisfy the
      constraint 'PluginContext<never>'` and the same at `graph.ts:29,50,70,104`,
      `graph.test.ts:8,60,92,110,153` and `context.test.ts:161`. The probe was reverted, core
      rebuilt, and `pnpm typecheck` re-run clean; `shasum -a 256 -c` confirms
      `packages/core/src/plugin.ts` is byte-identical to its pre-probe state.
    - **The engine's constraint is genuinely the structural minimum, not `PluginContext`**
      (compiled probe, not reasoning). Against the *shipped* `GraphContext`: `OpsContext`
      assigns to it; `PluginContext<MyCfg>` and `PluginContext<never>` assign to it; and a bare
      object literal carrying only `{logger:{step,ok,warn}, state:{resources}, save}` - which
      is *not* a `PluginContext` (pinned with `@ts-expect-error`) - also assigns to it. The
      constraint is not vacuous either: dropping `save()` makes `applyGraph` reject the context
      (pinned with `@ts-expect-error`; both pins compiled, so neither has silently stopped
      erroring).
    - **The two instantiations really are unrelated.** `applyGraph(cliNodes, pluginCtx)` is
      `TS2345 … Property 'agentDir' is missing`, and `applyGraph(pluginNodes, opsCtx)` is
      `TS2345 … missing pluginConfig, siteState, record`. Nothing converts between them, as the
      doc comment claims.
  - *Type-claim corpus:* `node .specs/plans/2026-07-26-plugin_system_and_analytics/type-claims/check.mjs`
    → `PASS: 29 claims held (12 compiled positives, 17 pinned compile-errors)`, in both the main
    tree and the task workspace. C16 (`ResourceNode<OpsContext>` compiles unconstrained) and C17
    (the constrained form is `TS2344`) both hold, and the corpus's transcription of
    `ResourceNode` is character-for-character the shipped declaration. The corpus and the shipped
    code do **not** disagree; the only divergence is cosmetic and in the corpus's favour of
    looseness - it transcribes the engine constraint as `EngineContext` with
    `logger: PluginLogger` (five members), where the shipped type is named `GraphContext` and
    requires only the three logger members the engine actually calls. The shipped type is
    strictly more permissive, so every corpus claim about it remains true; neither the spec nor
    the task file fixes a name or a logger breadth, so neither side is wrong.
  - *Status:* ☑ SATISFIED (with two comment-accuracy defects recorded under Findings; neither
    affects a type or a behaviour)

- **O4 - A plugin-typed fixture node compiles and runs, and existing assertions are untouched.**
  - *Claim:* a node whose four methods name only core's `PluginContext` is accepted as a `ResourceNode`, `topoSort` orders it, and `graph.test.ts`/`nodes.test.ts` assertions differ from their previous versions only in imports and type arguments.
  - *Evidence collected:* the fixture is `packages/cli/src/graph.test.ts:140-171`. Its context is
    built exactly as task 01's composition test builds one - a `createTestContext()` spread plus
    `pluginConfig`, `siteState` and `record`. The node at `:153` is
    `ResourceNode<PluginContext<unknown>>` and its methods reach for `c.siteState.resources` and
    `c.record(…)`, both of which exist only on `PluginContext`; the methods are contextually
    typed from that annotation rather than annotated individually, and the negative probe above
    proves the annotation is load-bearing (it produced `TS2344: Type 'PluginContext<unknown>'
    does not satisfy the constraint 'PluginContext<never>'` at `graph.test.ts:153`).
  - *Non-vacuity, established by mutation rather than by reading:* with
    `const exists = await node.read(ctx)` temporarily replaced by `const exists = true` in
    `applyGraph`, the fixture **fails** at `graph.test.ts:169` (`expect(log).toEqual(['create'])`).
    It therefore genuinely drives the real `topoSort` and `applyGraph`, and asserts through
    `record` into the shared state. The mutation was reverted and `shasum -a 256 -c` confirms
    `packages/cli/src/graph.ts` is byte-identical to its pre-probe state.
  - *Assertions unchanged:* every changed line in `graph.test.ts` outside the appended block is
    an import (`:1`, `:4-5`) or a type argument (`:8`, `:60`, `:92`, `:110`); no `expect(…)` was
    touched. `nodes.test.ts` is not in the diff at all.
  - *Beyond the obligation - the instantiation task 16 will use also compiles* (probe): a
    `Plugin`-shaped `nodes?(ctx: PluginContext<MyCfg>): ResourceNode[]` returning
    `ResourceNode<PluginContext<MyCfg>>` objects passes straight into `applyGraph` with a
    `PluginContext<MyCfg>`, with no cast and no signature work. The Residue's failure condition
    for this task - "`OpsContext`-fixed engine signatures at task 16's start" - does not hold.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the workspace root, every CI gate, exit code recorded:
    `pnpm build` 0 · `pnpm typecheck` 0 · `pnpm test` 0 (core 104 passed/1 skipped,
    build-agent 27, pds 85, cli 129) · `pnpm lint` 0 (the only output is the pre-existing
    `no-shadow` warning set in the untouched `nodes.test.ts`) · `pnpm exec oxfmt --check .` 0
    ("All matched files use the correct format", 123 files) · `pnpm knip` 0 (no output).
    No changeset: the relocation is internal, no published behaviour changes, and task 01 -
    which likewise added new exported types to `blogwright-core` - shipped without one
    (`.changeset/` holds only `config.json` and `README.md`).
  - *Status:* ☑ SATISFIED

- **O6 - The relocation is visible in one grep and one diff (Reviewable).**
  - *Claim:* a reviewer can run `pnpm typecheck && pnpm test -- graph nodes` and observe green, then `grep -n 'interface ResourceNode' packages/cli/src/graph.ts` returning nothing and `git diff --stat packages/cli/src/nodes.ts` reporting a single import-block hunk.
  - *Evidence collected (the task's `Reviewable:` line as written):*
    `pnpm typecheck && pnpm --filter blogwright exec vitest run graph nodes --reporter=verbose`
    → exit 0, `Test Files 2 passed (2) · Tests 37 passed (37)`, the last `graph.test.ts` line
    being `✓ the engine over a core PluginContext instantiation > accepts a node typed on
    PluginContext through topoSort and applyGraph`.
    `grep -n 'interface ResourceNode' packages/cli/src/graph.ts` → no output, exit 1.
    `jj diff --stat packages/cli/src/nodes.ts` (this is a jj workspace) →
    `packages/cli/src/nodes.ts | 4 ++-`, one hunk, in the import block.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:46` calls `applyGraph(buildNodes(ctx), ctx)` with a bootstrap context → expect the same node set, same order, same derived names as before the move : ☑ **PRESERVED**. `commands.ts` is not in the diff. `Ctx` infers to `OpsContext` from both arguments; `OpsContext` satisfies `GraphContext` (compiled probe). The emitted `nodes.js` and `graph.js` are byte-identical to the parent commit, so the node set, its order and every derived name are unchanged by construction.
- `packages/cli/src/commands.ts:63` calls `destroyGraph(buildNodes(ctx), ctx)` on teardown → expect reverse-order deletion unchanged : ☑ **PRESERVED**. Same emitted-JS argument; `destroyGraph`'s body (`topoSort(nodes).reverse()`, `delete ctx.state.resources[node.id]`) is byte-identical, and `GraphContext.state.resources` is a mutable `Record`, so the `delete` still typechecks and still runs.
- `packages/cli/src/graph.test.ts:45` calls `applyGraph(nodes, createTestContext())` with nodes `a`→`b` → expect `['create:b', 'create:a']` : ☑ **PRESERVED**. Assertion untouched; `✓ applyGraph / destroyGraph > creates in dependency order and destroys in reverse`.
- `packages/cli/src/nodes.test.ts` exercises the node factories against `createTestContext()` → expect every existing assertion to pass with no change : ☑ **PRESERVED**. File not in the diff; all 30 of its tests green in the Reviewable run.
- *Additional consumer the task's Pointers omitted:* `packages/cli/src/context.test.ts` imported `ResourceNode` from `./graph.js` (`:12`) and annotated a node bare (`:161`). Both edits are **forced, not scope creep**: the symbol no longer exists in `graph.ts`, and the bare form would now default to `PluginContext<never>` while the node is handed to `destroyGraph([node], ops)` with an `OpsContext`. The `type OpsContext` addition to the existing `./context.js` import is the minimal way to write the type argument. No `expect(…)` in that file changed, and the two tests in it pass.

## Findings (non-blocking)

- **F1 - `packages/cli/src/context.test.ts:169-172`: a comment the change falsified.** It reads
  "destroyGraph is typed on OpsContext, not PluginContext; run it against ops directly." After
  this task `destroyGraph` is `<Ctx extends GraphContext>` and is *not* typed on `OpsContext`;
  a compiled probe confirms `destroyGraph` now accepts a `ResourceNode<PluginContext<…>>[]` with
  a `PluginContext`. The workaround the comment justifies is no longer necessary, and the test
  could now prove its own headline claim ("the real destroyGraph reaches through it") directly
  against the `PluginContext` it composes. The implementer's minimal edit is defensible under
  the "assertions unchanged" mandate; the stale explanation two lines below the line they did
  edit is not. Comment-only: no type and no behaviour is affected.
- **F2 - `packages/core/src/plugin.ts:174-176`: an overstated count.** The doc comment says
  "every one of the CLI's fifteen `ResourceNode<OpsContext>` annotations (`nodes.ts`) would fail
  to compile with `TS2344`". The probe shows `nodes.ts` yields exactly **one** `TS2344`, at
  `:15` - the alias - because the fifteen annotations are deliberately bare, as the same task
  requires elsewhere. The substantive claim is verified and correct (the constrained form does
  not compile, and the diagnostic is exactly the predicted `TS2344 … 'PluginContext<never>'`);
  only the count and its location are wrong. Inherited from the task file's own wording.
- **F3 - forward-looking residue for tasks 13/16/24, not a defect here.** Because task 01 set
  `PluginContext<TConfig = never>`, the default `ResourceNode` is `ResourceNode<PluginContext<never>>`,
  so a plugin that writes "plain `ResourceNode`" - which the doc comment at
  `packages/core/src/plugin.ts:162-165` invites - gets `pluginConfig: never` inside its methods
  and must write `ResourceNode<PluginContext<MyCfg>>` to read its own config. Nothing breaks:
  probes confirm `ResourceNode[]` still passes to `applyGraph` with a real `PluginContext<MyCfg>`
  (method-parameter bivariance), which is what corpus claim C19 pins. The fixture test's own
  choice of `ResourceNode<PluginContext<unknown>>` over the bare form is the same wrinkle
  surfacing. Worth a sentence in the doc comment when task 16 lands the dispatch boundary.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All six obligations are satisfied on collected evidence - the type is declared unconstrained in core and reached through the existing barrel, `graph.ts` keeps the engine over a genuinely minimal, probe-verified `GraphContext` constraint with byte-identical bodies, `nodes.ts` changed in one import hunk and emits identical JavaScript, the plugin-typed fixture is mutation-proven non-vacuous, and every CI gate plus the 29-claim type corpus is green; the only findings are two comment-accuracy defects that touch neither a type nor a behaviour.
