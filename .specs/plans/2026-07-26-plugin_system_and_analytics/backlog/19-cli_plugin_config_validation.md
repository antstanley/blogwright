# Task 19 — Validate plugin-owned config blocks through each plugin

**Plan:** [plan.md](../plan.md) · **Certificate:** [19-cli_plugin_config_validation-certificate.md](19-cli_plugin_config_validation-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → Config ownership (Add)](../../../changes/2026-07-26-cli_plugin_system.md) ("the CLI calls each loaded plugin's `validateConfig` after parsing. A config file carrying a block for a plugin that is not installed is valid and inert — the same contract `pds` has today.")
**Depends on:** 03, 08, 10
**Produces:** after `parseConfig`, the CLI hands each loaded plugin the raw block its `configKey` names for validation, with blocks for uninstalled plugins left inert and duplicate `configKey` claims rejected
**Pointers:** `packages/cli/src/context.ts:120-124` (the `loadConfig` call inside `createContext` — the seam validation hooks onto), `packages/cli/src/context.ts:85-102` (`loadConfig`, which calls `parseConfig` at `:94`), `packages/cli/src/plugins.ts` (task 08 — `discover`, and task 09's collision pass where a duplicate `configKey` check belongs), `packages/core/src/config.ts:242` (`parseConfig`), `packages/core/src/config.ts:253-255` (the spread that keeps unknown keys intact), `packages/core/src/config.ts:314-330` (core's `pds` branch — deliberately untouched by this task; task 27 removes it)

## Steps

- [ ] Validate ONLY the plugin being dispatched, in the dispatch path — not in `createContext`. Record the choice and its reason in the module comment of `packages/cli/src/plugins.ts`. `createContext` (`packages/cli/src/context.ts:110-124`) is the path every built-in command takes and accepts no plugin list, so validating there would run discovery on `deploy`/`status`/`bootstrap` — breaking task 10's laziness test and this task's own DoD — and there is no seam through which the dispatched plugin alone could be reached.
- [ ] Add `validatePluginConfig(plugin, config)` in `plugins.ts` taking ONE plugin: when it declares both `configKey` and `validateConfig`, call the validator with `pluginBlock(config, configKey)` (task 27) if that key is present, and skip it when absent — never pass `undefined` into a plugin, per DEVELOPMENT.md's no-null rule.
- [ ] Call it from `runPlugin` (task 10) immediately after the context is built and before the plugin's `run`, so an invalid block fails before the command does any work. Built-in commands never reach it.
- [ ] Wrap a plugin's thrown error so the plugin's own message survives verbatim with a prefix naming the plugin, and let it exit non-zero through the existing `bin.ts` error path.
- [ ] Add the duplicate-`configKey` rejection beside task 09's duplicate-namespace check, with an error naming both packages and the shared key.
- [ ] Extend `packages/cli/src/context.test.ts` with fake plugins only — block present, block absent, block for an uninstalled plugin, a failing validator, and two plugins claiming one key — plus an assertion that a built-in command loads no plugin modules.

## Definition of done

- [ ] Every loaded plugin declaring both `configKey` and `validateConfig` is called with that key's raw block after `parseConfig`, and is not called at all when the block is absent — one test each, driven entirely by fake plugins.
- [ ] A config file carrying a block for a plugin that is not installed parses, is inert, and the key survives on the config object (test) — the same contract `pds` has today; this task changes nothing in `packages/core/src/config.ts`, so core still validates the `pds` block and task 27 has somewhere to hand that validation to.
- [ ] A plugin's validation failure surfaces the plugin's own message unchanged, prefixed with enough context to name the plugin, and exits non-zero; and two plugins declaring the same `configKey` is rejected with an error naming both — one negative test each, asserting on the message.
- [ ] The scope of validation — every discovered plugin versus only the plugin being dispatched — is chosen, stated in a module comment and consistent with the laziness rule, with a test asserting built-in commands still load no plugin modules; the choice is recorded plainly because task 28 has to reason about it.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- context`; confirm the failing-validator case fails before any AWS client call is made (the test's fake STS records no `getAccountId`) and that the uninstalled-plugin block is still readable on the returned `config`.
