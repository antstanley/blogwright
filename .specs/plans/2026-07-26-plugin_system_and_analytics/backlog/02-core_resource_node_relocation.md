# Task 02 — Move ResourceNode from the CLI into blogwright-core

**Plan:** [plan.md](../plan.md) · **Certificate:** [02-core_resource_node_relocation-certificate.md](02-core_resource_node_relocation-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §Resource graph → Vocabulary relocation (Modify)](../../../changes/2026-07-26-cli_plugin_system.md) (core owns the vocabulary of a reconcilable resource; the CLI keeps `topoSort`, `applyGraph` and `destroyGraph`)
**Depends on:** 01
**Produces:** `ResourceNode<Ctx extends PluginContext = PluginContext>` declared in `blogwright-core` and reachable as `import type { ResourceNode } from 'blogwright-core'`, with `packages/cli/src/graph.ts` reduced to the engine and `packages/cli/src/nodes.ts`'s 1,087 lines changed in their import block alone
**Pointers:** `packages/cli/src/graph.ts:4-15` (the `ResourceNode` interface being moved, doc comments included), `packages/cli/src/graph.ts:18,58,89` (`topoSort`/`applyGraph`/`destroyGraph` — the engine that stays, bodies untouched), `packages/cli/src/nodes.ts:13` (`import type { ResourceNode } from './graph.js'` — the one line that changes), `packages/cli/src/nodes.ts:42,80,151,219,369,393,482,538,590,713,780,825,973,1053,1055` (the fifteen bare `ResourceNode` annotations that must stay bare), `packages/cli/src/graph.test.ts:3,6,58,90,108` (the type import and the four inline node literals), `packages/cli/src/commands.ts:13,46,63` (the `applyGraph`/`destroyGraph` consumers, which must not change), `packages/core/src/plugin.ts` (task 01's SPI module — `ResourceNode` joins it), `packages/core/src/index.ts:22-23` (the barrel line task 01 added already re-exports it)

## Steps

- [ ] Move the `ResourceNode` declaration from `packages/cli/src/graph.ts:4-15` into `packages/core/src/plugin.ts` as `ResourceNode<Ctx extends PluginContext = PluginContext>`, with `read`, `create`, `update?` and `delete` all taking `Ctx`, keeping the existing doc comments on `title`, `read` and `update` verbatim.
- [ ] State the construction in the type's doc comment: the default `Ctx` is `PluginContext`, so a plugin writes plain `ResourceNode`; the CLI instantiates `ResourceNode<OpsContext>`; a plugin-typed node is assignable to a CLI-typed one by ordinary parameter contravariance (a method taking the wider `PluginContext` accepts an `OpsContext`), so neither method-parameter bivariance nor a cast is relied on.
- [ ] Confirm the symbol is reachable as `import type { ResourceNode } from 'blogwright-core'` through the `./plugin.js` barrel line task 01 added to `packages/core/src/index.ts` — add no second export line.
- [ ] Rewrite `packages/cli/src/graph.ts` to import the type from `blogwright-core` and annotate `topoSort` (:18), `applyGraph` (:58) and `destroyGraph` (:89) with `ResourceNode<OpsContext>[]`, leaving all three function bodies byte-identical and deleting the local interface.
- [ ] Change `packages/cli/src/nodes.ts:13` to `import type { ResourceNode as CoreResourceNode } from 'blogwright-core'` (folded into the existing core import block at :1-9) followed by one `type ResourceNode = CoreResourceNode<OpsContext>;` line, so all fifteen annotations and every function body in the file stay byte-identical.
- [ ] Update `packages/cli/src/graph.test.ts` to import the type from `blogwright-core` and annotate its `node()` helper (:6) and three inline literals (:58,:90,:108) as `ResourceNode<OpsContext>`, changing no assertion.
- [ ] Add a fixture test proving the plugin path: a node whose four methods are typed against core's `PluginContext` alone compiles as a `ResourceNode`, is accepted by `topoSort`, and reconciles through `applyGraph` with a `createTestContext()` context.

## Definition of done

- [ ] `ResourceNode` is declared in `packages/core/src/plugin.ts` and reachable from `blogwright-core`; `packages/cli/src/graph.ts` declares it no longer and still owns `topoSort`, `applyGraph` and `destroyGraph` with byte-identical bodies.
- [ ] `git diff packages/cli/src/nodes.ts` shows the import hunk and nothing else — no function body and no node-factory signature in the 1,087-line file is modified, and the fifteen `ResourceNode` annotations still read bare.
- [ ] The parameterisation is deliberate and documented: `ResourceNode<Ctx extends PluginContext = PluginContext>`, with the doc comment stating that assignability from a plugin-typed node to `ResourceNode<OpsContext>` is parameter contravariance rather than method bivariance, and no cast and no `any` appears anywhere in the change (DEVELOPMENT.md §Code style).
- [ ] A fixture node whose methods name only core's `PluginContext` compiles as a `ResourceNode`, and `graph.test.ts` and `nodes.test.ts` assertions are unchanged apart from imports and type arguments, and all pass.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm typecheck && pnpm test -- graph nodes`; confirm `grep -n 'interface ResourceNode' packages/cli/src/graph.ts` returns nothing and `git diff --stat packages/cli/src/nodes.ts` reports a single hunk in the import block.
