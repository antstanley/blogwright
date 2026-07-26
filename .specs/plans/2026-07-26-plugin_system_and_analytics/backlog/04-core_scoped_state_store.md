# Task 04 — Give StateStore an optional plugin scope

**Plan:** [plan.md](../plan.md) · **Certificate:** [04-core_scoped_state_store-certificate.md](04-core_scoped_state_store-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §State → Scoped state stores (Modify)](../../../changes/2026-07-26-cli_plugin_system.md) (an unscoped store keys `state/<env>.json` as today; a store scoped to a plugin keys `state/<env>.<plugin>.json`)
**Depends on:** —
**Produces:** `StateStore` accepting an optional fourth constructor argument, so a scoped store addresses `state/<env>.<plugin>.json` through `load`, `save` and `delete` while every existing unscoped construction keeps addressing `state/<env>.json` byte-for-byte
**Pointers:** `packages/core/src/state.ts:17-19` (`stateKey`, the one function that derives the key), `packages/core/src/state.ts:25-30` (the three-argument constructor), `packages/core/src/state.ts:36,54,61` (the `load`/`save`/`delete` call sites that must not drift), `packages/core/src/state.ts:44` (the corrupt-state error that hardcodes `state/${this.env}.json`), `packages/cli/src/context.ts:134` (the production unscoped construction), `packages/cli/src/context.ts:137,154` (`store.load()` and `store.save(state)`), `packages/cli/src/commands.ts:63,224` (`ctx.store.delete()` on destroy and delete), `packages/cli/src/test-support.ts:181` (the test unscoped construction), `packages/core/src/aws/s3.test.ts:11-18` (`response`/`s3With` — the transport-level mock model the new tests copy), `packages/core/src/state.test.ts` (new — the first tests this module has had)

## Steps

- [ ] Add an optional fourth constructor parameter `scope` to `StateStore` (`packages/core/src/state.ts:26-30`) and change `stateKey` (`:17`) to take the scope, returning `state/${env}.json` when there is none and `state/${env}.${scope}.json` when there is.
- [ ] Validate the scope where it enters the class — reject anything that does not match `^[a-z0-9-]+$` (the same namespace shape a plugin manifest declares) with an error naming the offending scope and the store's bucket, so no `/`, `.` or `..` can move the key out of the `state/` prefix.
- [ ] Compute the key once per instance and route `load` (`:36`), `save` (`:54`) and `delete` (`:61`) through it, so the three methods can never address different objects.
- [ ] Replace the hardcoded `state/${this.env}.json` in the corrupt-state error (`:44`) with the key actually read, so a scoped store's parse failure names its own object rather than the site's.
- [ ] Extend the class doc comment (`:21-24`) to state both key forms and why the unscoped one is on-disk identity that must not move for an existing environment.
- [ ] Add `packages/core/src/state.test.ts` over a `Transport` fake modelled on `packages/core/src/aws/s3.test.ts:11-18`: assert the request path each of `load`, `save` and `delete` issues, for an unscoped store (`state/test.json`) and a scoped one (`state/test.analytics.json`).
- [ ] Add the negative cases: a scoped store fed non-JSON reports `state/test.analytics.json` in its error, and constructing a store with the scopes `a/b`, `..` and the empty string each raises naming the scope.

## Definition of done

- [ ] `stateKey` returns `state/<env>.json` with no scope and `state/<env>.<plugin>.json` with one, and both forms are pinned by literal assertions in `packages/core/src/state.test.ts`, because the unscoped key is on-disk identity for every existing environment.
- [ ] `load`, `save` and `delete` all address the same key — one test asserts the S3 object each of the three passes to the transport-level mock, for both a scoped and an unscoped store.
- [ ] The corrupt-state error at `packages/core/src/state.ts:44` reports the key in use rather than a hardcoded one, proven by a negative test on a scoped store fed non-JSON; a scope containing `/` or `..`, or an empty scope, is rejected with an error naming it, so no key can escape the `state/` prefix.
- [ ] `packages/cli/src/context.ts:134` and `packages/cli/src/test-support.ts:181` still construct unscoped stores unchanged, and no existing test in any package was edited.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- state`; confirm the assertions pin the literal strings `state/test.json` and `state/test.analytics.json`, then run `grep -rn 'new StateStore' packages/cli/src` and confirm both call sites still pass exactly three arguments.
