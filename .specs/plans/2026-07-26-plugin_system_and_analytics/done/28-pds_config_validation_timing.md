# Task 28 - Pin what an invalid pds config block does on built-in commands after validation moves into the plugin

**Plan:** [plan.md](../plan.md) · **Certificate:** [28-pds_config_validation_timing-certificate.md](28-pds_config_validation_timing-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Config ownership (Add)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) and §`blogwright-core` → Config (Modify) (the qualified claim that validation outcomes are identical on `blogwright pds <action>` paths) and §Upgrading a deployed stack item 5 (the built-in commands' divergence this task pins)
**Depends on:** 25, 26, 27
**Produces:** the settled dispatch-time validation pinned by tests - a malformed `pds` block accepted by `bootstrap`, `deploy` and `status`, which load no plugin, and rejected by `blogwright pds <action>` with core's original messages - so the divergence the spec's §Upgrading a deployed stack item 5 lists cannot regress silently in either direction
**Pointers:** `packages/cli/src/context.ts:110-124` (`createContext` → `loadConfig`, the single place every built-in command's config is parsed), `packages/cli/src/context.ts:85-102` (`loadConfig`, the candidate loop), `packages/cli/src/context.test.ts:8-55` (the `loadConfig` describe block the new cases join), `packages/cli/src/cli.ts:134-140` (the built-in dispatch's `createContext` call), `packages/cli/src/plugins.ts` (task 08 discovery - lazy by design, so plugins are not loaded for built-in commands), `packages/cli/src/plugins.ts` (task 19 - `validatePluginConfig`, called from the dispatch path), `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md` §Assumptions and open questions (where an accepted divergence is recorded)

> **ROUTED FINDING - added 2026-08-30 from task 25's implementation.**
> `validatePdsConfig(undefined)` throws `TypeError: Cannot read properties of
> undefined (reading 'name')`, verified against the built package. Task 19's
> dispatch path calls `validateConfig` with `undefined` whenever a plugin's
> block is absent - that is the corrected contract, landed at build 38, and the
> analytics validator handles it by returning a fully-defaulted block.
> This is yours to fix: the task owns pds config-validation outcomes. Decide
> what an absent `pds` block should mean - pds has no derivable defaults the way
> analytics does, so returning a defaulted block may be wrong and a clear
> refusal may be right - but a bare `TypeError` is neither.
> **CORRECTED 2026-08-30 by task 25's verification gate: this is reachable NOW,
> from task 25 (landed), not from task 26.** `loadPluginForRemoval`
> (`plugin-commands.ts:1050-1061`) goes through the `ModuleLoader` port rather
> than `discover`, so the `blogwright.plugin` manifest field is not the gate -
> `isDeclaredDependency` is, and `blogwright plugin add pds` satisfies it. The
> live sequence on the current tip is: `plugin add pds`, then `plugin remove
> pds` answered yes, on a repo with no `pds` block. Impact is a confusing
> message and a refused teardown, not data loss - but it is live, and task 19's
> shipped changeset explicitly promises the behaviour it breaks.
>
> **REFINEMENT 2026-08-31 from task 29's verification gate.** Your DoD asks for
> "unchanged" messages, and a bare `(raw ?? {})` guard discharges that
> **literally** while still leaving the wrong outcome: an absent `pds` block
> would then say `config.pds.name is required` rather than the actionable
> `config has no "pds" section - add it to config/production.jsonc` an operator
> used to get. The DoD does not distinguish an ABSENT block from a MALFORMED
> one, and they want different answers - absent is an ordinary first-run state
> and should name the missing section; malformed is a real defect and should
> name the offending key.
> Task 29 left a pin for you at `cli.test.ts:1433` asserting the current
> `TypeError` and its `cause`, with an in-file comment telling you to **update
> it, not delete it**. It fails under `(raw ?? {})`, so you cannot close this
> without seeing it - and if you land only that guard, the pin will go green
> over a message that is still wrong.

## Steps

- [x] Establish the current behaviour with a test before changing anything: load a config whose `pds` block has a blank `name`, and one whose `handleResolver` is `http://resolver`, through `loadConfig`/`createContext` on a built-in command path, and record whether it throws after task 27.
- [x] Pin the settled consequence rather than re-deciding it - task 19 settled the resolution: plugin config is validated ONLY for the plugin being dispatched, in the dispatch path, never in `createContext`. So a malformed `pds` block does NOT fail `deploy`/`status`/`bootstrap` (they never load the plugin), and DOES fail `blogwright pds <action>`. Assert both, and count `ModuleLoader` calls on a built-in command to prove the load never happens.
- [x] Carry the divergence into the changeset in the same words as the spec's §Upgrading a deployed stack item 5, naming which commands stop rejecting which inputs, and confirm the spec still lists it there - the changeset and the spec are the two places an operator can learn it.
- [x] Assert the outcome for both malformed blocks and for a valid block on the same path, so no config valid today becomes invalid and no config invalid today is silently accepted without a test saying so.
- [x] Confirm the rejection messages are the strings core raises today - task 21 lifted them verbatim, so the assertions compare against `config.pds.name is required` and `config.pds.handleResolver must be https, got "http://resolver"`.

## Definition of done

- [x] Tests pin the outcome of loading a config whose `pds` block has a blank `name`, and one whose `handleResolver` is `http://…`, on a built-in command path (`createContext`/`loadConfig`, as `bootstrap` reaches it) - not only on `blogwright pds <action>`.
- [x] The divergence is the settled outcome, not a choice made here: a test proves `deploy`/`status`/`bootstrap` load no plugin module (a `ModuleLoader` call count of zero on the built-in path) while accepting the malformed block, `blogwright pds <action>` rejects the same block, and the changeset carries the divergence in the same words as the spec's §Upgrading a deployed stack item 5 - the user-visible change that list now includes.
- [x] No config file that is valid today becomes invalid, and none that is invalid today is silently accepted, without that outcome being asserted by a test and named in the commit description.
- [x] Error messages for a rejected `pds` block are unchanged from the strings core raises today - `config.pds.name is required` and `config.pds.handleResolver must be https, got "…"` - asserted on the message, not on the fact of throwing.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm --filter blogwright exec vitest run context --reporter=verbose` in `packages/cli`; confirm both malformed-block cases assert the settled outcome - acceptance on the built-in path, a throw with core's exact message on the `blogwright pds <action>` path - and read the changeset and the spec's §Upgrading item 5 for the recorded divergence.
