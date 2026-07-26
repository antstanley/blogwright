# Done Certificate — Task 03: Add the Plugin contract and its boundary validator to core

**Task:** [03-core_plugin_contract.md](03-core_plugin_contract.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 03. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 03) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `Plugin`, `PluginCommand`, `PluginInitIo`, `ConfigBlockEntry` and `PluginManifest` are declared in `packages/core/src/plugin.ts`, and `validatePlugin(module, packageName)` turns an arbitrary imported module into a trusted `Plugin` or raises naming the package.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `packages/core/src/plugin.ts`'s existing contents from tasks 01 and 02 (`PluginContext` and `ResourceNode` keep their declarations and doc comments), nor `packages/core/src/index.ts`'s export surface (the new symbols must not collide with `config.js`, `ports.js` or `state.js` exports).

## Obligations

- **O1 — The `Plugin` and `PluginCommand` member lists are exactly as specified.**
  - *Claim:* `Plugin` declares `name`, `description`, `commands`, optional `nodes(ctx)`, `configKey`, `validateConfig(raw)` and `init(io)` and nothing else; `PluginCommand` declares `action`, `summary` and `run(ctx: PluginContext, args: string[])`, and `action` is a plain string so `secret status` is representable.
  - *Evidence to collect:* read both declarations in `packages/core/src/plugin.ts` and enumerate their members against `.specs/changes/2026-07-26-cli_plugin_system.md` §Plugin SPI → The `Plugin` contract; confirm no member named `hooks`, `dependsOn`, `ports` or `middleware` exists; compare the action strings in `packages/cli/src/cli.ts:198` (`secret status`, `secret delete`) against the `action` type and confirm they need no encoding.
  - *Status:* ☐ unverified

- **O2 — The init surface, the manifest and the no-null rule.**
  - *Claim:* `PluginInitIo` and its question shape live in this module, `init` returns an empty `ConfigBlockEntry[]` when declined, `PluginManifest` is `{ plugin: string }` checked against a shared `PLUGIN_NAME_PATTERN`, and no domain value in the module is typed `null` or bare `undefined`.
  - *Evidence to collect:* read `PluginInitIo`, `ConfigBlockEntry`, `PluginManifest` and `PLUGIN_NAME_PATTERN` in `packages/core/src/plugin.ts`; confirm the pattern literal `^[a-z0-9-]+$` appears exactly once in the file and matches the `pattern` in the spec's `PluginManifest` `$def`; grep the module for `| null` and expect no hits, and confirm every optional field uses `?: T | undefined` under `exactOptionalPropertyTypes`.
  - *Checks:* resolve the regular expression used inside `validatePlugin`'s name check — confirm it is the shared `PLUGIN_NAME_PATTERN` constant, not a second inline literal.
  - *Status:* ☐ unverified

- **O3 — `validatePlugin` accepts a valid module and rejects seven distinct malformations.**
  - *Claim:* the positive case returns a typed `Plugin`, and there is one negative test each for no default export, a non-object default export, a missing or empty `name`, a `name` violating the pattern, a missing `description`, `commands` not an array, and a command missing `action` or `run`.
  - *Evidence to collect:* run `pnpm test -- plugin` › the `validatePlugin` describe block and expect eight or more passing cases; read `packages/core/src/plugin.test.ts` and map each negative test to its rejection reason, confirming none is missing and none is duplicated.
  - *Status:* ☐ unverified

- **O4 — Messages name the package, suggest a fix, leak nothing, and nothing on the module is invoked.**
  - *Claim:* every raised message contains `packageName` and a corrective clause, no message interpolates a value read off the module, and validation invokes no function the module supplies.
  - *Evidence to collect:* read every `throw new Error(` in `validatePlugin` and confirm each interpolates `packageName` and states what would fix it; read the negative tests and confirm each asserts the package name in the matched message; run the test that supplies a module whose `nodes()` throws when called and expect `validatePlugin` to return normally.
  - *Checks:* trace `validatePlugin`'s body for any call expression on a value read from `module` — expect none; the only operations are property reads and `typeof`/`Array.isArray` narrowing.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm `PLUGIN_NAME_PATTERN` is a module-level `SCREAMING_SNAKE_CASE` constant rather than an inline literal, and that a changeset exists only if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — The negative-space suite is legible in one run (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin` and observe the seven negative cases each asserting the package name, then `grep -n ': any' packages/core/src/plugin.ts` returning nothing.
  - *Evidence to collect:* run both commands and record their output verbatim, including the test names.
  - *Status:* ☐ unverified

## Regression check

No existing callers in scope — `validatePlugin` gains its first caller in task 08, and `Plugin` its first implementor in task 25. The only shared surface is `packages/core/src/plugin.ts` itself: confirm `PluginContext` (task 01) and `ResourceNode` (task 02) still compile and are still exported after the additions.

- `packages/cli/src/context.test.ts` assigns `createTestContext()` to a `PluginContext` binding → expect it still compiles and passes after the module grows : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/graph.ts:18` annotates `topoSort` with `ResourceNode<OpsContext>` → expect it still resolves through `blogwright-core` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations. Discovery imports arbitrary code from the consuming repository, so `validatePlugin` is the only guard between a malformed module and dispatch; a validator finding it lenient in a case the DoD does not enumerate (a `commands` array containing a non-object, a duplicate `action` within one plugin) should record it here rather than fail an obligation — namespace-level collision rules are task 09. The `init` return shape (`ConfigBlockEntry[]`) is consumed by the textual JSONC splice in task 12 and the generic init action in task 13; if either lands with a different shape, this module is the one that must change, not they.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
