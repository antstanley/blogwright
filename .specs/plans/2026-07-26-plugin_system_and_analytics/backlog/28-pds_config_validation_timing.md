# Task 28 — Keep an invalid pds config block failing on built-in commands after validation moves into the plugin

**Plan:** [plan.md](../plan.md) · **Certificate:** [28-pds_config_validation_timing-certificate.md](28-pds_config_validation_timing-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Config ownership (Add)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) and §`blogwright-core` → Config (Modify) (the claim that the block's validation outcomes are identical, only their implementation location moves)
**Depends on:** 25, 26, 27
**Produces:** a decided, tested answer to when a plugin-owned config block is validated — either eager validation on every config load, or a recorded divergence in the change spec and the changeset — so a malformed `pds` block cannot start passing silently on `bootstrap`, `deploy` or `status`
**Pointers:** `packages/cli/src/context.ts:110-124` (`createContext` → `loadConfig`, the single place every built-in command's config is parsed), `packages/cli/src/context.ts:85-102` (`loadConfig`, the candidate loop), `packages/cli/src/context.test.ts:8-55` (the `loadConfig` describe block the new cases join), `packages/cli/src/cli.ts:134-140` (the built-in dispatch's `createContext` call), `packages/cli/src/plugins.ts` (task 08 discovery — lazy by design, so plugins are not loaded for built-in commands), `packages/cli/src/plugins.ts` (task 19 — `validatePluginConfig`, called from the dispatch path), `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md` §Assumptions and open questions (where an accepted divergence is recorded)

## Steps

- [ ] Establish the current behaviour with a test before changing anything: load a config whose `pds` block has a blank `name`, and one whose `handleResolver` is `http://resolver`, through `loadConfig`/`createContext` on a built-in command path, and record whether it throws after task 27.
- [ ] Decide between the two resolutions and record the decision in the commit description: eager validation of plugin-owned keys wherever config is loaded, or accepting the divergence.
- [ ] There is no "if eager" branch to take: task 19 settled this — plugin config is validated ONLY for the plugin being dispatched, in the dispatch path, never in `createContext`. Pin the consequence rather than re-deciding it: a malformed `pds` block does NOT fail `deploy`/`status`/`bootstrap` (they never load the plugin), and DOES fail `blogwright pds <action>`. Assert both, and count `ModuleLoader` calls on a built-in command to prove the load never happens.
- [ ] If divergence: add the gap to the change spec's Open questions and to the changeset in the same words, naming which commands stop rejecting which inputs.
- [ ] Either way, assert the outcome for both malformed blocks and for a valid block on the same path, so no config valid today becomes invalid and no config invalid today is silently accepted without a test saying so.
- [ ] Confirm the rejection messages are the strings core raises today — task 21 lifted them verbatim, so the assertions compare against `config.pds.name is required` and `config.pds.handleResolver must be https, got "http://resolver"`.

## Definition of done

- [ ] Tests pin the outcome of loading a config whose `pds` block has a blank `name`, and one whose `handleResolver` is `http://…`, on a built-in command path (`createContext`/`loadConfig`, as `bootstrap` reaches it) — not only on `blogwright pds <action>`.
- [ ] If the resolution is eager validation, plugin-owned config keys are validated wherever config is loaded and the cost is bounded — a test shows `deploy`/`status` pay no full plugin load when no plugin is installed; if the resolution is to accept the divergence, it is written into the change spec's Open questions and into the changeset, because it contradicts the spec's claim that the migration produces no user-visible change.
- [ ] No config file that is valid today becomes invalid, and none that is invalid today is silently accepted, without that outcome being asserted by a test and named in the commit description.
- [ ] Error messages for a rejected `pds` block are unchanged from the strings core raises today — `config.pds.name is required` and `config.pds.handleResolver must be https, got "…"` — asserted on the message, not on the fact of throwing.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- context` in `packages/cli`; confirm both malformed-block cases assert an outcome (throw with the exact message, or documented acceptance) and read the commit description or the change spec for the recorded decision.
