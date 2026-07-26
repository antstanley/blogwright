# Done Certificate — Task 19: Validate plugin-owned config blocks through each plugin

**Task:** [19-cli_plugin_config_validation.md](19-cli_plugin_config_validation.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 19. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 19) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `loadConfig` returns the raw config document alongside the parsed `OpsConfig`, `createContext` carries it on `OpsContext` as `configDocument`, and the dispatch path hands the dispatched plugin the block its `configKey` names — with blocks for uninstalled plugins left inert and duplicate `configKey` claims rejected.
- **P2 — Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `parseConfig`/`mergeConfig`/`validateConfig` in `packages/core/src/config.ts` (unchanged here, including the `pds` branches at `:266-271` and `:314-330`), `loadConfig`'s candidate order (`packages/cli/src/context.ts:85-102` — the return type changes, the candidate list and its order do not), `resolveConfigPath` as task 13 extracted it, `createTestContext` (which gains `configDocument` and nothing else), or the laziness rule that built-in commands run no discovery.

## Obligations

- **O1 — The raw document is threaded from the file to the dispatcher.**
  - *Claim:* `loadConfig` returns `{ config, raw }` off task 03's `parseConfigDocument`, `createContext` puts `raw` on `OpsContext` as `configDocument`, and no code path re-reads or re-parses the config file to reach a plugin's block.
  - *Evidence to collect:* read `packages/cli/src/context.ts:85-102` and confirm the return type and that the candidate order is untouched; read the `OpsContext` declaration and confirm `configDocument: Readonly<Record<string, unknown>>` is present and CLI-side only (absent from `PluginContext` in `packages/core/src/plugin.ts`); run `pnpm test -- context` and read the test asserting a top-level key `OpsConfig` does not declare survives onto `configDocument` while `config` matches today's `parseConfig` output; grep the CLI for a second `parseConfig`/`parseConfigDocument` call site and expect none outside `loadConfig`.
  - *Status:* ☐ unverified

- **O2 — The dispatched plugin is called with its block, and not called when absent.**
  - *Claim:* the plugin being dispatched, when it declares both `configKey` and `validateConfig`, receives that key's raw block read off `configDocument`; when the block is absent it is not called, and `pluginConfig` is an empty object rather than `undefined`.
  - *Evidence to collect:* run `pnpm test -- context` and read the two tests in `packages/cli/src/context.test.ts`; confirm the present case asserts the exact value handed to the fake validator (the raw block, not the merged config) and the absent case asserts the fake recorded zero calls and that `ctx.pluginConfig` is `{}`.
  - *Checks:* resolve the call site — confirm `resolvePluginConfig` is reached from `runPlugin`/`toPluginContext` in `packages/cli/src/plugin-commands.ts` and NOT from `createContext`, which every built-in command takes and which has no dispatched plugin to validate; confirm nothing passes `undefined` into a plugin validator or onto `pluginConfig` (DEVELOPMENT.md §Error handling, no-null rule).
  - *Status:* ☐ unverified

- **O3 — An uninstalled plugin's block is inert and survives; core is untouched.**
  - *Claim:* a config carrying a block for a plugin that is not installed parses, validates, and keeps the key on the config object; `packages/core/src/config.ts` is unmodified so core still validates `pds`.
  - *Evidence to collect:* run `pnpm test -- context` and read the inert-block test; confirm it asserts the key is readable on the returned `OpsConfig`; run `jj diff --stat` (or `git diff --stat`) and confirm `packages/core/src/config.ts` is not in the change; run `pnpm test -- config` in `packages/core` and expect the existing pds validation tests to pass.
  - *Status:* ☐ unverified

- **O4 — Failure messages and duplicate keys.**
  - *Claim:* a plugin's validation failure surfaces its own message unchanged with a plugin-naming prefix and exits non-zero; two plugins claiming one `configKey` is rejected with an error naming both.
  - *Evidence to collect:* run `pnpm test -- context` (and `pnpm test -- plugins` if the duplicate check lives there); read both negative tests; confirm the failure assertion contains the fake plugin's verbatim message text *and* the plugin name, and that the duplicate assertion names both package names and the shared key.
  - *Checks:* trace the thrown error to `packages/cli/src/bin.ts:13-18` — confirm the message reaches the operator through the existing error path and sets a non-zero `process.exitCode`.
  - *Status:* ☐ unverified

- **O5 — The validation scope is chosen, recorded and consistent with laziness.**
  - *Claim:* the choice between validating every discovered plugin and only the dispatched one is written into a module comment, and the context-taking built-ins — `deploy`, `bootstrap` and `status` — still load no plugin modules. `init` is deliberately outside that set: it runs before any context exists and asks each discovered plugin's questions (task 14).
  - *Evidence to collect:* read the module comment in `packages/cli/src/plugins.ts` and record the stated choice and its reason; run `pnpm test -- context` and read the laziness test — confirm it drives a built-in command (for example `status`) with a fake `ModuleLoader` and asserts `load` was never called.
  - *Checks:* trace the discovery call for a built-in command through `packages/cli/src/cli.ts:117` — confirm the fall-through to plugin dispatch is the only path that reaches `discover`.
  - *Status:* ☐ unverified

- **O6 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O7 — Reviewable: validation fails before any AWS call and inert blocks survive (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- context` and observe that the failing-validator case throws before any AWS client call (the fake STS records no `getAccountId`) and that the uninstalled-plugin block is still readable on the returned `config`.
  - *Evidence to collect:* run `pnpm test -- context`; read the failing-validator test and confirm it asserts the fake STS call count is zero; read the inert-block test and confirm the key assertion is on the returned config object.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:134` (`main`) calls `createContext` for every built-in command → expect no new required option, no new discovery on the built-in path, and unchanged behaviour for a config with no plugin blocks : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.test.ts` existing `loadConfig` cases → expect their assertions to hold unchanged against the `config` half of the new return, with the only edit being how the value is destructured; a changed candidate order or a changed parsed value is a REGRESSION : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/test-support.ts` (`createTestContext`) → expect it to supply `configDocument` and every other `OpsContext` member exactly as before, with no test in any package forced to pass one : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/config.ts:266-271,314-330` (the `pds` merge and validation branches) → expect unchanged behaviour for a config with a `pds` block; core's tests pass unmodified : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: `configDocument` is the one member `OpsContext` gains here and it must NOT appear on `PluginContext` — a plugin reads its own validated block through `pluginConfig`, and handing it the whole document would hand it every other plugin's config; the scope choice recorded here is exactly what task 28 must reason about when pds validation moves out of core, so its wording matters more than its content; validating every discovered plugin on every command would breach the laziness rule the spec states, so watch for a scope choice that quietly forces discovery on built-ins; and nothing here checks that a plugin's `configKey` differs from a core config key (`region`, `siteName`, `pds`), which the DoD does not require.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
