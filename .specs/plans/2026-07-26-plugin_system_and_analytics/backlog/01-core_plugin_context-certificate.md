# Done Certificate — Task 01: Declare PluginContext in blogwright-core

**Task:** [01-core_plugin_context.md](01-core_plugin_context.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 01. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 01) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `PluginContext`, `PluginLogger`, `PluginPorts` and `SiteState` are declared in `packages/core/src/plugin.ts` and exported from core's index, with a CLI test that composes a `PluginContext` from an `OpsContext` plus the three members the dispatch boundary supplies (`pluginConfig`, `siteState`, `record`) and so fails the build the moment any member stops being suppliable. `OpsContext` does not satisfy `PluginContext` by assignment and is not expected to.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `packages/cli/src/context.ts` (`OpsContext` and `createContext` keep their current shape and wiring), `packages/cli/src/test-support.ts` (`createTestContext` still returns a complete `OpsContext`), `packages/pds/src/context.ts` (`PdsContext` unchanged until task 24), or `packages/core/src/index.ts`'s existing exports (no name collision introduced by the new barrel line).

## Obligations

- **O1 — `PluginContext` names exactly the agreed sixteen members and nothing more.**
  - *Claim:* the interface declares `env`, `domain`, `preview`, `config`, `pluginConfig`, `names`, `accountId`, `clients`, `ports`, `tags`, `logger`, `store`, `state` (the plugin's own state), `siteState` (the read-only site view), `record()` and `save()` — and nothing else. `agentDir` and every CLI-private port are absent, and their absence is recorded in a doc comment as a rule, not a count.
  - *Evidence to collect:* read the `PluginContext` declaration in `packages/core/src/plugin.ts` and enumerate its members — expect exactly sixteen; compare against `OpsContext` at `packages/cli/src/context.ts:25-51` and confirm `agentDir` (:40) appears in `OpsContext` only; read `packages/cli/src/ports.ts:24` and confirm `PluginContext.ports` is `PluginPorts` (`fs`, `terminal`) rather than the CLI's `Ports`, with a comment in `plugin.ts` naming `vcs`/`ping` (and tasks 05/06's `loader`/`packages`) as CLI-private types core cannot reference.
  - *Status:* ☐ unverified

- **O2 — The load-bearing fields are justified, and every export is documented.**
  - *Claim:* `names`, `accountId` and `siteState` carry doc comments naming their real consumers (task 53's log-delivery node reading `names.deliverySource` and the site's recorded distribution outputs; the analytics IAM roles reading the account id), and every exported symbol in the module has a doc comment.
  - *Evidence to collect:* read every `export` in `packages/core/src/plugin.ts` and confirm each is preceded by a `/** … */` block; confirm `packages/core/src/config.ts:343` really declares `deliverySource` and that the comment names it; confirm `.specs/changes/2026-07-26-analytics_plugin.md` §Analytics pipeline → Shape states the plugin reads `ctx.names.deliverySource`.
  - *Status:* ☐ unverified

- **O3 — Read-only site view, scoped store, and no CLI import.**
  - *Claim:* `siteState` is typed so an assignment into `ctx.siteState.resources` does not compile, `state` and `siteState` are distinct fields of distinct types, `record()` writes to the former only, `store` is documented as the plugin's own scoped store, `plugin.ts` imports only core modules, and `packages/pds/src/context.ts` is unchanged.
  - *Evidence to collect:* read the `SiteState` declaration and confirm `PluginContext.state` is core's `OpsState` while `PluginContext.siteState` is the readonly view — separate fields of separate types; confirm a `ResourceNode<PluginContext>` test calls `ctx.record(...)` and reads the value back from `ctx.state.resources` while `ctx.siteState` is unaffected; confirm a second test runs the real `destroyGraph` over a one-node plugin graph and observes `ctx.state.resources` lose the id, which a bare outputs map cannot satisfy; temporarily add `const c: PluginContext = createTestContext(); c.siteState.resources['x'] = {};` to `packages/cli/src/context.test.ts`, run `pnpm typecheck`, expect a read-only assignment error, then remove the probe; read the import list at the top of `packages/core/src/plugin.ts` and confirm every specifier is a relative `./…` core module; run `git diff --stat packages/pds/` and expect no output.
  - *Checks:* resolve the type of `PluginContext.store` — confirm it is core's `StateStore` from `packages/core/src/state.ts:25` and not a CLI type.
  - *Status:* ☐ unverified

- **O4 — The CLI test proves the composition without a cast.**
  - *Claim:* `packages/cli/src/context.test.ts` builds a `PluginContext<unknown>`-annotated value from a `createTestContext()` result spread plus exactly `pluginConfig`, `siteState` and `record`, with no `as` and no `any`, and the suite passes.
  - *Evidence to collect:* read the added test in `packages/cli/src/context.test.ts`; run `pnpm test -- context` › the new composition test and expect it green; grep the file for `as PluginContext` and ` any` and expect no hits; confirm the three boundary-supplied members are exactly `pluginConfig`, `siteState` and `record` and that no member `OpsContext` already carries is written a second time.
  - *Checks:* resolve the `PluginContext` identifier in that test — confirm it is imported from `blogwright-core`, not re-declared locally in the CLI. Then temporarily write `const p: PluginContext = createTestContext();`, run `pnpm typecheck`, and expect `TS2739` naming `pluginConfig`, `siteState` and `record` — a bare assignment compiling would mean `PluginContext` lost one of the three, not that the task succeeded. Remove the probe.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm no changeset is required because the change adds internal SPI vocabulary that no shipped command yet dispatches through.
  - *Status:* ☐ unverified

- **O6 — Adding a field neither `OpsContext` nor the boundary supplies breaks the build (Reviewable).**
  - *Claim:* a reviewer can run `pnpm build && pnpm test -- context`, then add to `PluginContext` a field that neither `OpsContext` carries nor the test's three boundary members supply, and observe `pnpm typecheck` fail inside `packages/cli/src/context.test.ts`.
  - *Evidence to collect:* run the two commands and record the pass; add `probe: string;` to `PluginContext`, run `pnpm typecheck`, expect an error naming `packages/cli/src/context.test.ts` and the missing property; revert the probe and re-run `pnpm typecheck` to confirm clean.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.test.ts:8` runs the existing `loadConfig` suite after the new import and test are added → expect the five original assertions still pass : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/index.ts:22-23` re-exports `./plugin.js` alongside `./config.js`, `./ports.js` and `./state.js` → expect `pnpm build` to emit no duplicate-export or ambiguous-re-export diagnostic : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.ts:139` builds an `OpsContext` literal → expect it still typechecks unchanged, since `PluginContext` adds no requirement to it : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations. `OpsContext` is deliberately not assignable to `PluginContext`, and a validator who "fixes" that by deleting `pluginConfig`, `siteState` or `record` has broken the SPI: the two state surfaces are separate because the site's state and the plugin's come from two different stores (spec §The two state surfaces), and the adaptation between them is a function at the dispatch boundary, written for real in task 10 and completed with the scoped store in task 16. O4's composition is the compile-time alarm standing in for that function until it exists; if a later task adds a field to `PluginContext` that neither side supplies, O4 is what breaks first, and that is the intent. The lifecycle context plugin *nodes* receive during task 16 is the same `PluginContext` with `store`/`state` re-pointed at the plugin's scoped store; nothing here forecloses that. `StateStore` gains its scope in task 04, so `store` is documented as scoped before the scope exists — the two tasks are independent by design.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
