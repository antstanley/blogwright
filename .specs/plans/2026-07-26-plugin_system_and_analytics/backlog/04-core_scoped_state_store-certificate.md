# Done Certificate - Task 04: Give StateStore an optional plugin scope

**Task:** [04-core_scoped_state_store.md](04-core_scoped_state_store.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 04. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 04) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `StateStore` accepts an optional fourth constructor argument so a scoped store addresses `state/<env>.<plugin>.json` through `load`, `save` and `delete`, while every existing unscoped construction keeps addressing `state/<env>.json` byte-for-byte.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not perturb the site's on-disk state identity: `packages/cli/src/context.ts:134` must still read and write `state/<env>.json` for every existing environment, `packages/cli/src/context.ts:137,154` must keep their load/save behaviour, and `packages/cli/src/commands.ts:63,224` must still delete the same object. A changed unscoped key means every bootstrapped stack loses its record of what exists and the next bootstrap duplicates resources.

## Obligations

- **O1 - Both key forms are correct and pinned.**
  - *Claim:* `stateKey` yields `state/<env>.json` with no scope and `state/<env>.<plugin>.json` with one, and tests assert both as literal strings.
  - *Evidence to collect:* read `stateKey` and the constructor in `packages/core/src/state.ts`; run `pnpm test -- state` › the key-derivation tests and confirm the literals `state/test.json` and `state/test.analytics.json` appear in the assertions rather than being recomputed from the same template the implementation uses.
  - *Status:* ☐ unverified

- **O2 - `load`, `save` and `delete` address one key.**
  - *Claim:* all three methods issue their request against the same object, for a scoped and an unscoped store.
  - *Evidence to collect:* read the three method bodies (`state.ts` `load`, `save`, `delete`) and confirm each uses the single computed key, not its own template; run `pnpm test -- state` › the test that captures the request URL a `Transport` fake receives for each of the three methods, and confirm it asserts the same key across all three, twice - once scoped, once unscoped.
  - *Checks:* resolve the key expression inside `save` - confirm it is the instance's computed key, not a second call that could take a different argument.
  - *Status:* ☐ unverified

- **O3 - The corrupt-state error names the real key, and a hostile scope is rejected.**
  - *Claim:* the error formerly hardcoding `state/${this.env}.json` at `state.ts:44` now reports the key in use, and the scopes `a/b`, `..` and `''` each raise an error naming the offending scope.
  - *Evidence to collect:* run `pnpm test -- state` › the corrupt-state negative test on a scoped store fed non-JSON, and confirm the matched message contains `state/test.analytics.json`; run the three rejected-scope tests and confirm each expected message contains the scope it was given.
  - *Checks:* trace a scope of `../../etc` through the constructor - confirm it raises before any key is computed, so no request can ever be issued outside the `state/` prefix.
  - *Status:* ☐ unverified

- **O4 - Existing call sites and existing tests are untouched.**
  - *Claim:* `packages/cli/src/context.ts:134` and `packages/cli/src/test-support.ts:181` still construct three-argument unscoped stores, and no pre-existing test file was edited.
  - *Evidence to collect:* run `grep -rn 'new StateStore' packages/cli/src` and confirm both hits pass exactly three arguments; run `git diff --stat` and confirm the only changed files are `packages/core/src/state.ts` and the new `packages/core/src/state.test.ts`.
  - *Status:* ☐ unverified

- **O5 - The doc comment says what a scope does and does not buy.**
  - *Claim:* the class doc comment states both key forms, that scoping changes the key and not the bucket - both objects sit under the site's `state/` prefix, which `bucketNode.delete()` empties (`packages/cli/src/nodes.ts:66`) - and names task 16's `blogwright destroy` guard as what protects a plugin's record; this task adds no guard itself.
  - *Evidence to collect:* read the doc comment at `packages/core/src/state.ts:21-24` and confirm all three statements; run `grep -rn "listObjects\|refus" packages/core/src/state.ts` and expect no output, since the policy belongs to the CLI.
  - *Status:* ☐ unverified

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm the scope pattern is a named constant rather than an inline literal, and that no changeset is required because no shipped command yet constructs a scoped store.
  - *Status:* ☐ unverified

- **O7 - The pinned keys and the unchanged call sites are visible in two commands (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- state` and see the literal strings `state/test.json` and `state/test.analytics.json` in the assertions, then run `grep -rn 'new StateStore' packages/cli/src` and see two three-argument constructions.
  - *Evidence to collect:* run both commands and record their output verbatim, including the test names and the two grep hits.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:137` calls `store.load()` on a store built at :134 for env `production` → expect a GET of `state/production.json` : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.ts:154` calls `store.save(state)` through `ctx.save()` → expect a PUT of `state/production.json` with the same JSON body shape as before : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/commands.ts:63` calls `ctx.store.delete()` during `destroy` → expect a DELETE of `state/<env>.json`, still swallowing its own failure, and no scoped key touched : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/test-support.ts:181` builds the store every CLI test's context carries → expect the whole existing suite to pass with no edit : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations. `packages/core/src/state.ts` had no test file before this task, so "existing state tests pass untouched" means the wider suite that exercises the store indirectly through `createTestContext` - there is no prior `state.test.ts` to preserve. The scope reaching the constructor comes from a plugin manifest that task 03 already constrains to `^[a-z0-9-]+$`; validating again here is deliberate defence at the boundary that owns the key, not duplication to remove. Whether `load` should also verify the round-tripped document's `env` field matches the store's is outside this DoD and belongs with any future state-versioning work.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
