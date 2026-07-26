# Task 09 — Reject plugins claiming a reserved or duplicate namespace

**Plan:** [plan.md](../plan.md) · **Certificate:** [09-cli_namespace_collision_rules-certificate.md](09-cli_namespace_collision_rules-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → Namespace collisions](../../../changes/2026-07-26-cli_plugin_system.md) ("Built-in commands always win"; the reserved set, and two plugins claiming the same name being an error rather than a race)
**Depends on:** 08
**Produces:** a `RESERVED_COMMANDS` set derived from the CLI's own dispatch set, plus reserved-name and duplicate-name rejection inside `discover`, so no plugin can shadow a built-in or race another plugin for a namespace
**Pointers:** `packages/cli/src/cli.ts:66-75` (`KNOWN_COMMANDS` — eight of the eleven reserved names), `packages/cli/src/cli.ts:107` (`init`, dispatched before `KNOWN_COMMANDS` is consulted), `:111` (`preview`, likewise), `:114` (the hardcoded `command === 'pds'` branch that shadows `pds` until task 29), `:117-121` (the `KNOWN_COMMANDS` membership test), `packages/cli/src/plugins.ts` (task 08 — where `discover` collects failures), `packages/cli/src/plugins.test.ts` (task 08 — the fake-loader harness the new tests extend)

## Steps

- [ ] Export a `RESERVED_COMMANDS` set from `packages/cli/src/cli.ts` beside `KNOWN_COMMANDS` (`packages/cli/src/cli.ts:66-75`), built as the union of `KNOWN_COMMANDS` and the literal set `{'init', 'preview', 'plugin'}` — so a built-in added to `KNOWN_COMMANDS` becomes reserved without a second edit. `init` (`:107`) and `preview` (`:111`) dispatch outside `KNOWN_COMMANDS`; `plugin` is listed explicitly because this task does not depend on task 10, which is what later adds it to `KNOWN_COMMANDS` — the union keeps the 11-name assertion true both before and after that lands.
- [ ] Add a test asserting `RESERVED_COMMANDS` equals the literal set `init, bootstrap, deploy, rollback, delete, destroy, history, logs, status, preview, plugin`, so adding a built-in without reserving it fails a test rather than silently allowing a shadow.
- [ ] Apply the reserved check inside `discover` (`packages/cli/src/plugins.ts`): a plugin whose `name` is reserved is recorded as a load failure naming both the package and the collided name, and never reaches the returned plugin list.
- [ ] Apply the duplicate check: when two candidates claim the same `name`, both are recorded as failures naming both packages, and the message is built from a sorted package list so the outcome does not depend on candidate iteration order.
- [ ] Record in the `plugins.ts` module comment why `pds` is deliberately not reserved — the hardcoded `command === 'pds'` branch at `packages/cli/src/cli.ts:114` still shadows it until task 29 removes the shadow rather than adding a reservation — and add a test that documents the current behaviour.

## Definition of done

- [ ] The reserved set is exactly `init`, `bootstrap`, `deploy`, `rollback`, `delete`, `destroy`, `history`, `logs`, `status`, `preview`, `plugin`, is derived from — or asserted equal to — the CLI's own dispatch set, and the derivation accounts for `init` and `preview` being dispatched before `KNOWN_COMMANDS` is consulted (`packages/cli/src/cli.ts:107` and `:111`); deriving the set from `KNOWN_COMMANDS` alone under-reserves by two names.
- [ ] A discovered plugin claiming a reserved name is RECORDED AS A LOAD FAILURE naming both the package and the collided name, and is absent from the returned plugin list (test); two plugins claiming the same name are both recorded as failures naming both packages (test), and the outcome does not depend on iteration order. Collect, never throw — this matches task 08's recorded collect-not-abort choice and is what `blogwright plugin list` (task 17) needs to show a mixed good/broken listing. The spec's "rejected with an error" is satisfied by a reported load failure; say so in the module comment so the next reader does not switch it to a throw.
- [ ] `pds` is deliberately absent from the reserved set, the module comment records why, and a test documents it.
- [ ] Built-in commands still win with no measurable change to their dispatch path, and the existing CLI tests pinned in task 07 pass unmodified.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright test -- plugins` and `pnpm --filter blogwright test -- cli`; confirm the reserved-set equality test fails when `status` is removed from `KNOWN_COMMANDS`, that a duplicate-name fixture fails identically with its two candidates in either order, and that the task-07 pins pass unmodified.
