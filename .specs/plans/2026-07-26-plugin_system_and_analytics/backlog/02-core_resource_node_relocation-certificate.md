# Done Certificate — Task 02: Move ResourceNode from the CLI into blogwright-core

**Task:** [02-core_resource_node_relocation.md](02-core_resource_node_relocation.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 02. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 02) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `ResourceNode<Ctx = PluginContext>` lives in `blogwright-core` and is reachable from its index; `packages/cli/src/graph.ts` is reduced to the engine, generic over the structural context minimum it actually uses, and `packages/cli/src/nodes.ts` changes only its import block.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the site's reconciliation behaviour: `packages/cli/src/nodes.ts` `buildNodes` (:1053) must still produce the same node set in the same order, and `packages/cli/src/commands.ts` `bootstrap` (:46) and `destroy` (:63) must still call `applyGraph`/`destroyGraph` unchanged. No derived AWS resource name may move.

## Obligations

- **O1 — The type lives in core; the engine stays in the CLI.**
  - *Claim:* `ResourceNode` is declared in `packages/core/src/plugin.ts`, is importable as `import type { ResourceNode } from 'blogwright-core'`, and `packages/cli/src/graph.ts` no longer declares it while still exporting `topoSort`, `applyGraph` and `destroyGraph`, now generic over the engine's named structural minimum, with bodies unchanged apart from the one local annotation the generic forces at `:39` (`order: ResourceNode<Ctx>[]`).
  - *Evidence to collect:* read `packages/core/src/plugin.ts` for the declaration; run `grep -n 'interface ResourceNode' packages/cli/src/graph.ts` and expect no output; run `git diff packages/cli/src/graph.ts` and confirm the only removals are the interface block (old :4-15) and the `OpsContext`-only import, and that the only in-body change is the `:39` annotation — the signatures change, the statements do not.
  - *Checks:* resolve `ResourceNode` inside `packages/cli/src/graph.ts` — confirm it resolves to the `blogwright-core` import, not to a locally re-declared alias.
  - *Status:* ☐ unverified

- **O2 — `nodes.ts` changed only its import block.**
  - *Claim:* the 1,087-line file's diff is confined to the import hunk (the `./graph.js` type import replaced by an aliased `blogwright-core` import plus one instantiation line); no function body and no node-factory signature moved.
  - *Evidence to collect:* run `git diff --stat packages/cli/src/nodes.ts` and record the changed-line count; run `git diff packages/cli/src/nodes.ts` and read every hunk, confirming all of them sit above the first `function` declaration; run `grep -n 'ResourceNode<' packages/cli/src/nodes.ts` and expect exactly one hit, the instantiation line.
  - *Status:* ☐ unverified

- **O3 — The parameterisation is deliberate, documented, and cast-free.**
  - *Claim:* the declaration is `ResourceNode<Ctx = PluginContext>` with an unconstrained parameter, its doc comment states why no `extends PluginContext` bound is possible (`OpsContext` lacks `pluginConfig`, `siteState` and `record`, so the constrained form is `TS2344` at every CLI annotation) and that the engine's generic constraint is the structural minimum both contexts satisfy, and the change introduces no cast and no `any`.
  - *Evidence to collect:* read the declaration and its doc comment in `packages/core/src/plugin.ts`; read the engine's constraint type in `packages/cli/src/graph.ts` and confirm it names exactly `logger`, `save()` and `state.resources`; run `git diff` over the four touched files and grep the added lines for ` as ` and `any`, expecting no hits.
  - *Checks:* a `ResourceNode<OpsContext>` annotation must compile with no `@ts-expect-error` anywhere in `packages/cli/src/graph.ts`; then confirm the doc comment's negative claim is honest by temporarily adding `extends PluginContext` to the declaration and observing `pnpm typecheck` fail with `TS2344` in the CLI, removing the probe afterwards.
  - *Status:* ☐ unverified

- **O4 — A plugin-typed fixture node compiles and runs, and existing assertions are untouched.**
  - *Claim:* a node whose four methods name only core's `PluginContext` is accepted as a `ResourceNode`, `topoSort` orders it, and `graph.test.ts`/`nodes.test.ts` assertions differ from their previous versions only in imports and type arguments.
  - *Evidence to collect:* read the new fixture test and confirm its method parameters are annotated `PluginContext`; run `pnpm test -- graph` › the fixture test and expect it green; run `git diff packages/cli/src/graph.test.ts packages/cli/src/nodes.test.ts` and confirm every changed line is an import or an annotation, never an `expect(…)`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm no changeset is required because the relocation is internal and no published behaviour changes.
  - *Status:* ☐ unverified

- **O6 — The relocation is visible in one grep and one diff (Reviewable).**
  - *Claim:* a reviewer can run `pnpm typecheck && pnpm test -- graph nodes` and observe green, then `grep -n 'interface ResourceNode' packages/cli/src/graph.ts` returning nothing and `git diff --stat packages/cli/src/nodes.ts` reporting a single import-block hunk.
  - *Evidence to collect:* run the three commands and record their output verbatim.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:46` calls `applyGraph(buildNodes(ctx), ctx)` with a bootstrap context → expect the same node set, same order, same derived names as before the move : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/commands.ts:63` calls `destroyGraph(buildNodes(ctx), ctx)` on teardown → expect reverse-order deletion unchanged : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/graph.test.ts:43` calls `applyGraph(nodes, createTestContext())` with nodes `a`→`b` → expect `['create:b', 'create:a']` : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.test.ts` exercises the node factories against `createTestContext()` → expect every existing assertion to pass with no change : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations. The one-line `type ResourceNode = CoreResourceNode<OpsContext>` instantiation appears in `nodes.ts` and, in inline form, in `graph.ts` and `graph.test.ts`; that is deliberate duplication chosen so the 1,087-line file's diff stays reviewable, and DEVELOPMENT.md §Clean Code sanctions a little duplication over the wrong abstraction. If a validator finds a shared alias exported from `graph.ts` instead, O1's claim that `graph.ts` "declares it no longer" needs a judgement call: an exported alias named `ResourceNode` in `graph.ts` fails O1. The engine's genericization lands here, in this task, matching the spec's relocation block — task 16 builds a `PluginContext` at the dispatch boundary and calls the same engine with no signature work of its own; a validator finding `OpsContext`-fixed engine signatures at task 16's start should fail this task, not that one.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
