# Task 01 — FileSystem port and context wiring

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (the port conventions and composition-root rule)
**Depends on:** —
**Produces:** the ports module, the `OpsContext.ports` plumbing, a node and an in-memory `FileSystem` adapter, and a `createTestContext` factory — with `context.ts` config loading and `repo-root.ts` migrated as the first consumers
**Pointers:** `packages/cli/src/context.ts:49` (readFile in loadConfig), `packages/cli/src/repo-root.ts:13` (existsSync walk), `packages/cli/src/pds/sync.test.ts:141`, `packages/cli/src/deploy.test.ts:10`, `packages/cli/src/pds/commands.test.ts:59` (the `as unknown as OpsContext` casts the factory replaces)

## Steps

- [x] Define the `FileSystem` port in `blogwright-core` (`packages/core/src/ports.ts`, exported from the package index): `readText`, `writeText` (creates parent directories), `exists`, `listFiles` (recursive, returns relative paths) — domain vocabulary, not an `fs` re-export. Core placement is deliberate: the pds feature package (task 08) shares it.
- [x] Write the node adapter beside it (`packages/core/src/adapters/node-fs.ts`), translating `ENOENT` and friends into the repo's own `Error` types with path context.
- [x] Write the in-memory adapter (a `Map`-backed `FileSystem`) exported for tests.
- [x] Add `ports: Ports` to `OpsContext`; `createContext` accepts adapter overrides in `ContextOptions` and defaults to the node adapters — the only place adapters are constructed.
- [x] Migrate `loadConfig` (`context.ts`) and `findRepoRoot` (`repo-root.ts`) onto the port; `findRepoRoot` takes the port as a parameter with the walk logic unchanged.
- [x] Add `createTestContext` (in a test-support module) building a real `OpsContext` over in-memory adapters; convert the three `as unknown as OpsContext` casts to use it.

## Definition of done

- [x] Config loading and repo-root discovery are covered by tests running entirely against the in-memory adapter, including negative space (missing config file, no `.git`/`.jj` above the start directory).
- [x] The node adapter is covered by a tmp-dir integration test (the existing `repo-root.test.ts` pattern).
- [x] No test builds a context by casting; `createTestContext` is the only path.
- [x] `context.ts` and `repo-root.ts` import no `node:fs` API.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm test`; open `packages/core/src/ports.ts` and `context.ts` and confirm the port surface is four operations and adapters are constructed only in `createContext`.
