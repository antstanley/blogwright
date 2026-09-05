# Task 17 - Add `blogwright plugin list`

**Plan:** [plan.md](../plan.md) · **Certificate:** [17-cli_plugin_list_command-certificate.md](17-cli_plugin_list_command-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → `blogwright plugin` (Add)](../../../changes/merged/2026-07-26-cli_plugin_system.md) ("`blogwright plugin list` - installed plugins, their namespaces, versions, and the config key each owns. Also names plugins that failed to load, with the reason.")
**Depends on:** 08, 09, 10
**Produces:** the built-in `plugin` namespace with its `list` action, printing one row per installed plugin - namespace, package name, version, owned config key - plus a row per plugin that failed to load with the reason, in both interactive and `--plain` modes
**Pointers:** `packages/cli/src/plugin-commands.ts` (the `plugin` namespace's actions live here), `packages/cli/src/cli.ts:66-75` (`KNOWN_COMMANDS` - gains `plugin`, which is also in the reserved set task 09 enforces), `packages/cli/src/cli.ts:11-63` (`USAGE`, which task 11 rebuilds), `packages/cli/src/plugins.ts` (task 08 - `discover(repoRoot, cliPackageDir, ports)` and the load failures it collects), `packages/cli/src/context.ts:118` (task 08's exported `cliPackageDir()` helper - standalone precisely so this command, which runs before `createContext`, can still supply the second argument), `packages/cli/src/commands.ts:258-272` (`history`'s interactive/plain split - the output contract this command mirrors), `packages/core/src/ports.ts` (`FileSystem.readText` - how each plugin package's `package.json` is read)

## Steps

- [x] Extend discovery's result so a load failure is a first-class value carrying the package name and the reason from `validatePlugin`, rather than an exception that aborts the whole listing.
- [x] Read each discovered package's own `package.json` through `ctx.ports.fs.readText` at the directory `ports.loader.resolve` returned, and take `version` from it - never a hardcoded map, never a registry call.
- [x] Dispatch the `plugin` namespace BEFORE `createContext` - beside the `init` (`cli.ts:107`) and `preview` (`cli.ts:111`) branches, not in the switch at `:142` - and hand it only the ports it needs (`fs`, `loader`, `packages`). `createContext` runs at `cli.ts:134` and does a config load plus `sts.getAccountId()`, so dispatching `plugin` after it would make `blogwright plugin list` and `plugin add` fail with `no config found for environment …` on an unconfigured repo - and `plugin add` is precisely what an operator runs before the repo is configured. Keep `plugin` in `KNOWN_COMMANDS` (`cli.ts:66`) so no plugin can claim it.
- [x] Render rows in two shapes as `history` does (`commands.ts:258-272`): an aligned table when `ctx.ports.terminal.isInteractive`, and stable column-per-line output otherwise, with an explicit marker (not a blank cell) for a plugin that owns no `configKey`.
- [x] Handle the empty and unknown-input cases: no plugins prints a line naming `blogwright plugin add` and exits 0; `blogwright plugin` with no action or an unknown one prints the namespace's actions and exits 1.
- [x] Write `packages/cli/src/plugin-commands.test.ts` cases with fake plugin packages in the in-memory `FileSystem` and a fake `ModuleLoader`, including one healthy and one broken plugin in the same run.

## Definition of done

- [x] `blogwright plugin list` works on a repo with NO `config/<env>.jsonc` and no AWS credentials, asserted by a test that never constructs a context - the empty-state line naming `blogwright plugin add` is otherwise unreachable in exactly the situation it exists for.

- [x] `blogwright plugin list` prints one row per installed plugin with its namespace, package name, version and `configKey` - or a clear marker when it owns none - pinned by an output test in both interactive and `--plain` modes, consistent with the existing `history`/`status` output contract for CI and agents.
- [x] Versions are read from each plugin package's own `package.json` through `ctx.ports.fs`, never from a hardcoded map and never over the network - a grep of `packages/cli/src/plugin-commands.ts` for `fetch` and for any version literal returns nothing, and no test needs a network.
- [x] Plugins that failed to load are listed with the reason from `validatePlugin`/discovery, and their presence does not stop the healthy ones being listed - a test with one good and one broken fake plugin asserts both rows appear and the exit code is what the chosen contract says.
- [x] The empty and unknown-input space is covered: a repo with no plugins prints a clear empty-state line naming `blogwright plugin add` and exits 0 (an empty listing is never an error), and `blogwright plugin` with no action or an unknown action prints the namespace's actions and exits 1 - one test each.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm --filter blogwright exec vitest run plugin-commands --reporter=verbose`; confirm the mixed good/broken listing shows the healthy plugin's version sourced from the in-memory `package.json` the test wrote, and that no test in the file constructs a real `ModuleLoader` or reads from disk.
