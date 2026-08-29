# Task 06 - Add the PackageManager port and its process adapter

**Plan:** [plan.md](../plan.md) · **Certificate:** [06-cli_package_manager_port-certificate.md](06-cli_package_manager_port-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §Ports → `PackageManager`](../../../changes/2026-07-26-cli_plugin_system.md) (the rule that installing and removing packages crosses a port, detects the manager from the lockfile, and keeps `node:child_process` in the adapter)
**Depends on:** -
**Produces:** a `PackageManager` port (`detect`, `add`, `remove`) with a lockfile-detecting process adapter, wired at `createContext` and defaulted to a recording fake in `createTestContext`
**Pointers:** `packages/cli/src/ports.ts:10-15` (the `Vcs` port the new interface sits beside), `packages/cli/src/ports.ts:24-29` (the `Ports` interface that gains `packages`), `packages/cli/src/adapters/process-vcs.ts:7-26` (the `execFile` ownership and `runVcsCommand` error translation to mirror), `packages/cli/src/context.ts:111-116` (the composition root's port construction), `packages/cli/src/test-support.ts:91-102` (`rejectAllVcs`) and `:155-160` (the test-context port defaults), `packages/core/src/ports.ts:12-26` (the `FileSystem` port detection reads through), `packages/core/src/repo-root.ts:11` (`findRepoRoot` - what `repoRoot` means), `.oxlintrc.json:71-84` (the adapter override that already covers the new file), `DEVELOPMENT.md:72-81` (the ports table), `packages/cli/src/adapters/process-package-manager.ts` (new - the adapter lives here)

## Steps

- [ ] Define `PackageManager` in `packages/cli/src/ports.ts` beside `Vcs`: `detect(repoRoot)` returning the manager the repo uses, `add(spec, opts)` and `remove(name)` - domain vocabulary only, with `opts` carrying the repo's own concepts (dev dependency, exact version) rather than any package CLI's flag names; add `packages: PackageManager` to the `Ports` interface at `packages/cli/src/ports.ts:24-29`.
- [ ] Name the supported managers as a union type and a module-level lockfile table (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`) so the mapping is a named constant rather than a chain of literals at the call site.
- [ ] Implement `detect` in `packages/cli/src/adapters/process-package-manager.ts` by probing each lockfile through the injected `FileSystem` port (`packages/core/src/ports.ts:12-26`) - never `node:fs` - and raising an error naming `repoRoot` and every lockfile it looked for when none matches.
- [ ] Implement `add` and `remove` over `execFile` in the same adapter, mirroring `runVcsCommand` (`packages/cli/src/adapters/process-vcs.ts:17-26`) so a failure raises an `Error` carrying the command, its arguments and the directory, with the original attached as `cause`.
- [ ] Wire `packages: opts.ports?.packages ?? createProcessPackageManager(ports.fs)` into `createContext` (`packages/cli/src/context.ts:111-116`), and add a recording fake to `packages/cli/src/test-support.ts` beside `rejectAllVcs` (`:91-102`) that captures every `add`/`remove` call and answers `detect` from a configured manager, defaulted at `:155-160`.
- [ ] Write `packages/cli/src/adapters/process-package-manager.test.ts` covering one positive `detect` case per supported manager over `createMemoryFileSystem` and one negative case with no lockfile, and add the `PackageManager` row to DEVELOPMENT.md's ports table (`DEVELOPMENT.md:72-81`).

## Definition of done

- [ ] `PackageManager` exposes `detect(repoRoot)`, `add(spec, opts)` and `remove(name)` in domain vocabulary - not a re-export of any package CLI's flag surface - and detection reads the lockfile through the `FileSystem` port, not `node:fs`, so no new `no-restricted-imports` exception is needed.
- [ ] `detect` maps each supported lockfile to its manager with one positive test per manager, and raises with context naming `repoRoot` and the lockfiles it looked for when none matches (negative test).
- [ ] `packages/cli/src/adapters/process-package-manager.ts` is the only new file importing `node:child_process`, and it translates failures into repo `Error`s carrying the command, the arguments and the directory, mirroring `packages/cli/src/adapters/process-vcs.ts`.
- [ ] No test spawns a process: `createTestContext` defaults `ports.packages` to a recording fake and command tests assert on what the fake recorded; DEVELOPMENT.md §Hexagonal architecture's ports table gains a `PackageManager` row naming the port file, the real adapter and the test substitute.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright exec vitest run process-package-manager --reporter=verbose` and `grep -rn "node:child_process" packages/cli/src`; confirm every `detect` case passes against an in-memory filesystem with no process spawned, and that the grep returns only files under `packages/cli/src/adapters/`.
