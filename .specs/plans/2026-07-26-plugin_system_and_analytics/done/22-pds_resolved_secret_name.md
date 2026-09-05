# Task 22 - Resolve the secretName default inside blogwright-pds instead of relying on core

**Plan:** [plan.md](../plan.md) · **Certificate:** [22-pds_resolved_secret_name-certificate.md](22-pds_resolved_secret_name-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Config ownership (Add)](../../../changes/merged/2026-07-26-migrate_pds_to_plugin_system.md) (the plugin applies the `<siteName>/atproto` default for `secretName` when it is absent)
**Depends on:** 21
**Produces:** `requirePdsConfig` returns a resolved pds config whose `secretName` is always a `string`, applied inside the package from task 21's resolver, so every pds call site keeps a total type with no cast and no `!`
**Pointers:** `packages/pds/src/sync.ts:50` (`requirePdsConfig`, which returns core's `PdsConfig` today), `packages/pds/src/commands.ts:37,83,107,124` (the four command call sites reading `pds.secretName`), `packages/pds/src/oauth.ts:44,118,171,206` and `packages/pds/src/secret.ts:70` (the remaining consumers), `packages/pds/src/test-support.ts:97` (`mergeConfig` call in `createTestContext`, which gets the default from core today), `packages/pds/src/config.ts` (task 21 - the resolver this task consumes), `packages/pds/src/sync.test.ts:141,224` and `packages/pds/src/commands.test.ts:25,176` (fixtures that pass an explicit `secretName` and must keep working)

## Steps

- [ ] Add `ResolvedPdsConfig` to `packages/pds/src/config.ts` - core's `PdsConfig` with `secretName` narrowed to a required `string` - and export it, so the resolved shape has a name rather than being an inline intersection at each consumer.
- [ ] Change `requirePdsConfig` (`packages/pds/src/sync.ts:50`) to return `ResolvedPdsConfig`, applying `resolvePdsSecretName(ctx.config.pds, ctx.config.siteName)` from task 21 while keeping the absent-block throw and its message string exactly as they are.
- [ ] Retype the internal consumers that hold the result - `packages/pds/src/commands.ts` (keygen, secretStatus, secretDelete, init), `packages/pds/src/oauth.ts` (including `requireClientKey`'s `pds` parameter at `:33`), and `packages/pds/src/secret.ts:70` - to take `ResolvedPdsConfig`, adding no non-null assertion and no cast anywhere on the path.
- [ ] Make `createTestContext` (`packages/pds/src/test-support.ts:96`) resolve the pds `secretName` itself after `mergeConfig`, so a test that omits `secretName` still gets a context whose `ctx.config.pds.secretName` is `<siteName>/atproto` once core stops defaulting at task 27.
- [ ] Add the tests: `requirePdsConfig` on a `pds` block without `secretName` resolves to `<siteName>/atproto`; with an explicit `secretName` it returns that value unchanged; with no `pds` block it throws the unchanged message; and `createTestContext({ config: { pds: { name: 'Ant' } } })` yields a resolved `secretName`.

## Definition of done

- [ ] `requirePdsConfig` returns a type on which `secretName` is a required `string`; no call site in `packages/pds` reads `secretName` as possibly-undefined, and `grep -rn "secretName!" packages/pds/src` plus a read of the touched files confirms no `!` or cast was used to get there.
- [ ] Tests assert that a config with a `pds` block and no `secretName` resolves to `<siteName>/atproto` and that an explicit `secretName` is returned unchanged, and that `requirePdsConfig` still throws `config has no "pds" section - add it to config/production.jsonc` when the block is absent.
- [ ] `createTestContext` in `packages/pds/src/test-support.ts` still produces a context whose pds config carries a resolved `secretName` - asserted by a test that omits `secretName` in the overrides - so `packages/pds/src/test-support.test.ts:6`'s claim of merged, validated config defaults stays true.
- [ ] The `<siteName>/atproto` template has exactly one construction site in `packages/pds` (`grep -rn "/atproto" packages/pds/src` shows one, in `config.ts`), core's copy at `packages/core/src/config.ts:269` is the only other in the repository and task 27 deletes it, no pinned rkey vector or slug derivation is touched (`packages/pds/src/rkey.ts` and `packages/pds/src/rkey.test.ts` are byte-identical), and the change is behaviour-neutral for every config that names a `secretName` today.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test` in `packages/pds`; confirm the new resolution tests pass, the existing `sync.test.ts`/`commands.test.ts`/`oauth.test.ts`/`secret.test.ts` fixtures with an explicit `secretName` pass unchanged, and `git diff packages/pds/src/rkey.ts packages/pds/src/rkey.test.ts` is empty.
