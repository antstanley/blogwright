# Task 18 — Add `blogwright plugin add` and `blogwright plugin remove`

**Plan:** [plan.md](../plan.md) · **Certificate:** [18-cli_plugin_add_remove_commands-certificate.md](18-cli_plugin_add_remove_commands-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → `blogwright plugin` (Add)](../../../changes/2026-07-26-cli_plugin_system.md) ("the short name `analytics` resolves to `blogwright-analytics` … the version installed matches the running CLI's own version … configuration and provisioned resources are untouched; the command says so and names the plugin's teardown verb") and §Ports → `PackageManager`
**Depends on:** 06, 17
**Produces:** `blogwright plugin add <name>` and `blogwright plugin remove <name>` install and uninstall plugin packages in the consuming repo through the `PackageManager` port, resolving short names to `blogwright-*` and pinning the installed version to the running CLI's own
**Pointers:** `packages/cli/src/plugin-commands.ts` (the `plugin` namespace from task 17 — `add` and `remove` join it), `packages/cli/src/ports.ts:24-29` (`Ports` — gains `packages: PackageManager` in task 06), `packages/cli/src/context.ts:110-116` (the composition root's port wiring, where the `PackageManager` adapter is constructed), `packages/cli/src/context.ts:118` (`agentDir` via `new URL('../agent', import.meta.url)` — the precedent for resolving the CLI's own package files at the composition root), `packages/cli/package.json:3` (`"version"` — the value pinned into the install spec), `packages/cli/src/adapters/process-vcs.ts` (the shell-out adapter task 06's `PackageManager` adapter is modelled on)

## Steps

- [ ] Write `resolvePluginPackage(name)` in `plugin-commands.ts` as a pure function: a name containing `/` or already starting with `blogwright-` is returned unchanged, anything else becomes `blogwright-${name}`.
- [ ] Resolve the running CLI's own version at the composition root the way `agentDir` is resolved (`context.ts:118`) — reading the CLI package's own `package.json` there, where `node:fs` is permitted — and carry it into the command as a value; never walk the filesystem for it from `plugin-commands.ts`.
- [ ] Implement `add`: resolve the package name, check the consuming repo's `package.json` dependencies through `ctx.ports.fs` first, and only then call `ports.packages.add(`${pkg}@${cliVersion}`, …)` — an already-installed plugin reports that and returns 0 without touching the port.
- [ ] Implement `remove`: call `ports.packages.remove(pkg)`, then print that configuration and provisioned resources are untouched and name `blogwright <name> destroy` as the teardown verb; a plugin that is not installed reports that and exits non-zero without calling the port.
- [ ] Extend the tests in `packages/cli/src/plugin-commands.test.ts` with a recording `PackageManager` fake, asserting the exact spec string, the recorded call list (empty where nothing should be called), and the pinned `remove` output.
- [ ] Write the changeset recording the two new user-facing commands.

## Definition of done

- [ ] Name resolution is covered by three tests: `analytics` becomes `blogwright-analytics`; a name containing `/` (for example `@scope/thing`) is used literally; a name already starting with `blogwright-` is used literally.
- [ ] The version requested matches the running CLI's own version, sourced at the composition root rather than by a filesystem walk from a domain module, and the test asserts the exact spec string handed to the `PackageManager` fake (`blogwright-analytics@<cli version>`).
- [ ] Installing an already-installed plugin reports that and exits 0 without calling the package manager (the test asserts the fake recorded nothing), and no test in this task spawns a process or touches the network.
- [ ] `blogwright plugin remove <name>` calls the port's `remove`, then states that configuration and provisioned resources are untouched and names the plugin's teardown verb `blogwright <name> destroy` — pinned output test; removing a plugin that is not installed reports that and exits non-zero rather than shelling out (negative test asserting the fake recorded nothing).
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- plugin-commands`; confirm the recorded spec string carries the version from `packages/cli/package.json` rather than a literal in the test, and that both "nothing to do" paths leave the recording fake's call list empty.
