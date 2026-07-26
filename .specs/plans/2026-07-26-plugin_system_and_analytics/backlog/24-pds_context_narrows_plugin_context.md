# Task 24 — Redefine PdsContext as a narrowing of core's PluginContext

**Plan:** [plan.md](../plan.md) · **Certificate:** [24-pds_context_narrows_plugin_context-certificate.md](24-pds_context_narrows_plugin_context-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Context (Modify)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) (`PdsContext` becomes a narrowing of `PluginContext`; `PdsLogger` and `PdsPorts` resolve to the core equivalents; structural satisfaction by the CLI's `OpsContext` is unchanged)
**Depends on:** 01
**Produces:** `PdsContext` expressed as a narrowing of core's `PluginContext`, with `PdsLogger`/`PdsPorts` as aliases of the core types, and an explicit compile-time assignability test replacing the implicit proof that `runPds` provides today
**Pointers:** `packages/pds/src/context.ts:10` (`PdsLogger`, the structural duplicate of core's logger), `packages/pds/src/context.ts:19` (`PdsPorts`, the `fs`/`terminal` pair), `packages/pds/src/context.ts:25` (`PdsContext`, the interface to re-express), `packages/pds/src/index.ts:8` (the type re-exports), `packages/core/src/plugin.ts` (new at task 01 — `PluginContext` lives here), `packages/cli/src/context.ts:25` (`OpsContext`, which must keep satisfying `PdsContext` by plain assignment), `packages/cli/src/cli.ts:213` (`pds.keygen(ctx)` — today's implicit assignability proof, deleted at task 29), `packages/pds/src/test-support.ts:96` (`createTestContext`, which must not be forced to build a whole host context)

## Steps

- [ ] Replace the structural bodies of `PdsLogger` (`packages/pds/src/context.ts:10`) and `PdsPorts` (`:19`) with aliases of core's logger and ports types from `PluginContext`, keeping both names exported so `packages/pds/src/index.ts:8` and every internal importer are unchanged.
- [ ] Re-express `PdsContext` (`packages/pds/src/context.ts:25`) as a narrowing of `PluginContext` — `Pick`/`Omit` over the host slice pds actually uses: `env`, `domain`, `config`, `clients` narrowed to `{ secrets }`, `ports` narrowed to `fs` and `terminal`, `logger`, and optional `tags` — so no field shape is written twice.
- [ ] Keep the module comment at `packages/pds/src/context.ts:1-5` accurate: it now says the type is a narrowing of core's `PluginContext`, and it still states that the package imports no CLI type.
- [ ] Add the compile-time assignability test in `packages/cli/src/context.test.ts`: assign a `createTestContext()` result to a `PdsContext`-typed binding (or a `satisfies`/`expectTypeOf` assertion) so a future widening of `PluginContext` fails the build rather than the runtime.
- [ ] Verify `packages/pds/src/test-support.ts:96` still compiles and returns a complete `PdsContext` without constructing `AwsClients` beyond `secrets` or a `StateStore`; if the narrowing forces either, narrow further rather than widening the test factory.

## Definition of done

- [ ] `packages/pds/src/context.ts` declares no structural duplicate of core's logger or ports shapes — `PdsLogger` and `PdsPorts` resolve to the core types and `PdsContext` is expressed in terms of `PluginContext`, narrowed to the secrets client and the `fs`/`terminal` ports pds actually uses — and the change is type-only: no runtime file in `packages/pds/src` changes.
- [ ] `packages/pds` imports no type from `packages/cli`: `grep -rn "from 'blogwright" packages/pds/src --include=*.ts` returns only `blogwright-core` specifiers, and there is no hit for `blogwright/` or a relative path escaping the package.
- [ ] A compile-time assignability test in the CLI asserts `OpsContext` still satisfies `PdsContext` by plain assignment; this test is new and load-bearing, because the existing implicit proof (`packages/cli/src/cli.ts:213` passing `ctx` to `pds.keygen`) disappears when `runPds` is deleted at task 29.
- [ ] `createTestContext` in `packages/pds/src/test-support.ts:96` still builds a complete `PdsContext` without constructing the full `AwsClients` set or a `StateStore` — the narrowing must not force pds tests to fabricate a whole host context.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm typecheck && pnpm test` from the repo root; confirm the same test count as before plus the new assignability test, and read `packages/pds/src/context.ts` to see three type declarations with no repeated field shapes.
