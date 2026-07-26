# Task 27 — Remove pds validation and defaulting from blogwright-core's config

**Plan:** [plan.md](../plan.md) · **Certificate:** [27-core_config_drops_pds-certificate.md](27-core_config_drops_pds-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-core` → Config (Modify)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) (core stops validating and defaulting the `pds` block; the `PdsConfig` type stays on `OpsConfig` and `secretName` becomes optional) and [2026-07-26-cli_plugin_system.md §CLI → Config ownership (Add)](../../../changes/2026-07-26-cli_plugin_system.md) (core keeps unknown keys intact and no longer validates plugin-owned blocks)
**Depends on:** 19, 23, 26
**Produces:** `blogwright-core`'s config module holds no pds domain knowledge — no handle resolver, no secret-name character class, no `<siteName>/atproto` default — while a config file carrying a `pds` block still typechecks and round-trips unchanged
**Pointers:** `packages/core/src/config.ts:266-271` (the `raw.pds` branch in `mergeConfig` to delete), `packages/core/src/config.ts:314-330` (the `cfg.pds` block in `validateConfig` to delete), `packages/core/src/config.ts:43` (`secretName: string`, which becomes optional), `packages/core/src/config.ts:253` (the spread through which unknown keys already survive), `packages/core/src/config.test.ts:86-120` (the five pds cases, four of which move), `packages/pds/src/config.test.ts` (task 21's equivalents), `packages/pds/src/sync.ts:50` (task 22's resolver, now the only defaulting path), `packages/cli/src/nodes.ts:925` (task 23's rewired ARN)

## Steps

- [ ] Delete the `raw.pds` branch at `packages/core/src/config.ts:266-271` so `mergeConfig` lets the block through the spread at `:253` untouched, and delete the `cfg.pds` block at `:314-330` from `validateConfig`.
- [ ] Make `PdsConfig.secretName` optional at `packages/core/src/config.ts:43` (`secretName?: string | undefined` under `exactOptionalPropertyTypes`), keeping the doc comment and the rest of the interface as they are, and keeping `PdsConfig` exported and reachable as `OpsConfig['pds']`.
- [ ] Remove the four pds cases from `packages/core/src/config.test.ts:90-120` (applies pds defaults, keeps explicit pds overrides, rejects a pds section without a name, rejects a non-https pds handleResolver), keeping `leaves pds undefined when the section is absent` at `:86-88`.
- [ ] Add the unknown-key tests in their place: a config carrying an `analytics` block parses with the key present and byte-equal on the returned config; a config carrying a malformed such block parses without throwing; a `pds` block round-trips exactly as written, including the absence of `secretName`.
- [ ] Run `pnpm knip` and clear whatever the removal orphans — unused imports or now-dead helpers in `packages/core/src/config.ts` — rather than suppressing the report.
- [ ] Write the changeset: `blogwright-core` loses validation users may be relying on and `PdsConfig.secretName` becomes optional on a published type, so the semver impact is stated explicitly.

## Definition of done

- [ ] `packages/core/src/config.ts` contains no occurrence of `handleResolver`, `secretName` or `atproto`, grepping the file for `pds` finds only the `PdsConfig` type and its `OpsConfig` field, and `PdsConfig.secretName` is `string | undefined` under `exactOptionalPropertyTypes` while `PdsConfig` stays exported from core and reachable as `OpsConfig['pds']`.
- [ ] A config carrying a top-level key core knows nothing about (e.g. `analytics`) parses successfully with the key present and byte-equal on the returned config; a config carrying a malformed such block also parses, since core no longer judges it — a negative-space test asserting no throw; a `pds` block round-trips exactly as written.
- [ ] The four pds cases removed from `packages/core/src/config.test.ts:90-120` have one-to-one equivalents in `packages/pds/src/config.test.ts`, so net coverage for those inputs did not drop, and the removed tests are replaced by the unknown-key-survival tests above.
- [ ] Everything reading `secretName` compiles without a non-null assertion — `packages/pds` via task 22 and `packages/cli/src/nodes.ts:925` via task 23 — and a changeset records the semver impact, because this removes validation users may be relying on and makes `PdsConfig.secretName` optional on a published type.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm build && pnpm test && pnpm knip` from the repo root, then `grep -nE "handleResolver|secretName|atproto|pds" packages/core/src/config.ts`; confirm the only hits are the `PdsConfig` declaration and the `OpsConfig.pds` field.
