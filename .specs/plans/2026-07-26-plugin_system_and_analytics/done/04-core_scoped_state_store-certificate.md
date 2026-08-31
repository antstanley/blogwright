# Done Certificate - Task 04: Give StateStore an optional plugin scope

**Task:** [04-core_scoped_state_store.md](04-core_scoped_state_store.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

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
  - *Status:* **SATISFIED**. `stateKey` (`state.ts:20-22`) returns `state/${env}.json` when `scope === undefined`
    and `state/${env}.${scope}.json` otherwise; it is called exactly once, from the constructor (`state.ts:62`) -
    `grep -rn stateKey packages/` finds no other src call site. `state.test.ts:46-50,61-65` assert the paths as
    hand-written literals inside `expect(requests).toEqual([...])` - `/bucket/state/test.json` and
    `/bucket/state/test.analytics.json` - not recomputed from any template. `vitest run src/state.test.ts
    --reporter=verbose` shows both named tests passing (9/9).

- **O2 - `load`, `save` and `delete` address one key.**
  - *Claim:* all three methods issue their request against the same object, for a scoped and an unscoped store.
  - *Evidence to collect:* read the three method bodies (`state.ts` `load`, `save`, `delete`) and confirm each uses the single computed key, not its own template; run `pnpm test -- state` › the test that captures the request URL a `Transport` fake receives for each of the three methods, and confirm it asserts the same key across all three, twice - once scoped, once unscoped.
  - *Checks:* resolve the key expression inside `save` - confirm it is the instance's computed key, not a second call that could take a different argument.
  - *Status:* **SATISFIED**. The key is a `private readonly key: string` computed once in the constructor
    (`state.ts:49,62`); `load` (`:69`), `save` (`:87`) and `delete` (`:94`) each read `this.key` and nothing else -
    `stateKey` has no second call site, so they cannot diverge. Resolution check on `save`: `this.s3.putObject(this.bucket,
    this.key, ...)` binds to `S3Client.putObject` (`aws/s3.ts:105`) → `objectPath` → `/${bucket}/${encodeKey(key)}`;
    the argument is the instance field, not a recomputed key. The two routing tests capture `new URL(req.url).pathname`
    at the `Transport` seam and assert GET/PUT/DELETE against one identical path, once unscoped and once scoped.

- **O3 - The corrupt-state error names the real key, and a hostile scope is rejected.**
  - *Claim:* the error formerly hardcoding `state/${this.env}.json` at `state.ts:44` now reports the key in use, and the scopes `a/b`, `..` and `''` each raise an error naming the offending scope.
  - *Evidence to collect:* run `pnpm test -- state` › the corrupt-state negative test on a scoped store fed non-JSON, and confirm the matched message contains `state/test.analytics.json`; run the three rejected-scope tests and confirm each expected message contains the scope it was given.
  - *Checks:* trace a scope of `../../etc` through the constructor - confirm it raises before any key is computed, so no request can ever be issued outside the `state/` prefix.
  - *Status:* **SATISFIED**. `state.ts:77` now interpolates `${this.key}`; for an unscoped store that resolves to
    `state/${env}.json`, so the existing message is byte-identical. Two negative tests discriminate: the scoped store
    fed `not json` is asserted to reject with `state/test.analytics.json` (a substring the pre-change hardcoded
    message could not contain), the unscoped one with `state/test.json` (which the scoped message does not contain).
    Both pass. Scope rejection: `SCOPE_PATTERN = /^[a-z0-9-]+$/` (`state.ts:18`), tested at `state.ts:57` *before*
    `this.key` is assigned at `:62`, so `../../etc` throws in the constructor and no key is ever computed nor request
    issued. Probed the regex directly under node: `a/b`, `..`, `.`, `''`, `../../etc`, `a.b`, `A`, `a b`, `a%2Fb`,
    `é`, `"a\n"` and `"\na"` all reject; only `[a-z0-9-]+` passes. The trailing-newline hazard does not apply - the
    regex carries no `m` flag and JavaScript's `$` is end-of-input. The error names both the scope (quoted) and the
    bucket; three tests pin the quoted scope and a fourth pins the bucket.

- **O4 - Existing call sites and existing tests are untouched.**
  - *Claim:* `packages/cli/src/context.ts:134` and `packages/cli/src/test-support.ts:181` still construct three-argument unscoped stores, and no pre-existing test file was edited.
  - *Evidence to collect:* run `grep -rn 'new StateStore' packages/cli/src` and confirm both hits pass exactly three arguments; run `git diff --stat` and confirm the only changed files are `packages/core/src/state.ts` and the new `packages/core/src/state.test.ts`.
  - *Status:* **SATISFIED**. `grep -rn 'new StateStore' packages/cli/src` → exactly two hits,
    `context.ts:134: new StateStore(clients.s3, names.bucket, opts.env)` and
    `test-support.ts:181: new StateStore(clients.s3, names.bucket, env)` - three arguments each, unchanged.
    `jj diff --stat` → `packages/core/src/state.test.ts | 115 +` and `packages/core/src/state.ts | 51 +-`,
    2 files changed and nothing else; no pre-existing test file was touched.

- **O5 - The doc comment says what a scope does and does not buy.**
  - *Claim:* the class doc comment states both key forms, that scoping changes the key and not the bucket - both objects sit under the site's `state/` prefix, which `bucketNode.delete()` empties (`packages/cli/src/nodes.ts:66`) - and names task 16's `blogwright destroy` guard as what protects a plugin's record; this task adds no guard itself.
  - *Evidence to collect:* read the doc comment at `packages/core/src/state.ts:21-24` and confirm all three statements; run `grep -rn "listObjects\|refus" packages/core/src/state.ts` and expect no output, since the policy belongs to the CLI.
  - *Status:* **SATISFIED** (substantively; the grep's literal form was unsatisfiable as authored). The doc comment
    at `state.ts:24-47` carries all three statements: both key forms (`:27`, `:31-33`); scoping changes the key and
    not the bucket, both objects side by side under the site bucket's `state/` prefix, which the bucket node empties
    wholesale via `deletePrefix(ctx.names.bucket, '')` (`:36-42`) - `sed -n 66p packages/cli/src/nodes.ts` confirms
    that is exactly the cited line; and `blogwright destroy` "is expected to refuse while any
    `state/<env>.<plugin>.json` exists, naming that plugin's `blogwright <plugin> destroy --yes`", closing with
    "`StateStore` itself is a store, not a policy - it does not add that guard" (`:43-46`). That is task 16's guard
    as plan.md:228 states it and as the change spec states it at
    `.specs/changes/2026-07-26-cli_plugin_system.md:354-357`; the comment names the guard by its command rather than
    by its plan-task number, which is the right call for source that outlives the plan.
    The named grep returns two hits, neither of which is policy: `state.ts:44` is the doc comment's own sentence
    about the CLI-level refusal, and `state.ts:77` is the pre-existing "refusing to proceed with empty state" text
    that the base commit already carried - so "expect no output" was never achievable. The check's intent holds:
    `grep -n listObjects packages/core/src/state.ts` is empty, the class issues no listing and enforces no refusal,
    and the diff adds no guard.

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm the scope pattern is a named constant rather than an inline literal, and that no changeset is required because no shipped command yet constructs a scoped store.
  - *Status:* **SATISFIED**. Run from `/Users/ant/code/blogwright-task-04`: `pnpm build` exit 0; `pnpm test` exit 0
    (core 104 passed/1 skipped, build-agent 27, pds 85, cli 124 - 340 passing, 0 failing); `pnpm lint` exit 0 (only
    the five pre-existing `no-shadow` warnings in the untouched `packages/cli/src/nodes.test.ts`);
    `pnpm exec oxfmt --check .` exit 0, "All matched files use the correct format", 122 files; `pnpm knip` exit 0,
    no output. CI's extra gate `pnpm typecheck` also exits 0. The scope limit is the named constant `SCOPE_PATTERN`
    (`state.ts:18`), not an inline literal, and the error is raised with context (scope and bucket). Negative-space
    coverage is present (5 of the 9 new tests). No changeset: `blogwright-core` is published, but the change is an
    additive optional parameter no shipped command passes, i.e. internal-only under DEVELOPMENT.md:318-319, and
    `.changeset/` holds only `config.json` and `README.md`.

- **O7 - The pinned keys and the unchanged call sites are visible in two commands (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- state` and see the literal strings `state/test.json` and `state/test.analytics.json` in the assertions, then run `grep -rn 'new StateStore' packages/cli/src` and see two three-argument constructions.
  - *Evidence to collect:* run both commands and record their output verbatim, including the test names and the two grep hits.
  - *Status:* **SATISFIED**, with one note on the command as authored. `pnpm test -- state` exits 0 across all five
    projects (core 104 passed/1 skipped, build-agent 27, pds 85, cli 124) - but it does not filter: `pnpm -r test --
    state` reaches vitest as `vitest run -- state`, which runs every file, and the default reporter prints no test
    names, so the literals are not visible in its output. Ran the file directly to obtain the evidence the obligation
    asks for - `pnpm exec vitest run src/state.test.ts --reporter=verbose` in `packages/core`, 9 passed:
    "an unscoped store addresses state/test.json for load, save and delete"; "a store scoped to a plugin addresses
    state/test.analytics.json for load, save and delete"; "a scoped store fed non-JSON reports its own key, not the
    site key"; "an unscoped store fed non-JSON reports the unscoped key"; "rejects a scope containing a slash, naming
    it"; 'rejects a scope of "..", naming it'; "rejects an empty scope, naming it"; "names the store bucket alongside
    the offending scope"; "accepts a lowercase alphanumeric/dash scope". The literals `state/test.json` and
    `state/test.analytics.json` are read directly in the assertions at `state.test.ts:46-50,61-65,74,81`.
    `grep -rn 'new StateStore' packages/cli/src` → two hits, both three-argument (see O4).

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:137` calls `store.load()` on a store built at :134 for env `production` → expect a GET of `state/production.json` : **PRESERVED**. :134 passes three arguments, so `scope` is `undefined`, `stateKey` takes the `state/${env}.json` branch and `load` GETs `this.key` = `state/production.json` via `getObjectText` → `getObject` → `objectPath`. The `undefined`-means-fresh and corrupt-must-throw semantics are untouched.
- `packages/cli/src/context.ts:154` calls `store.save(state)` through `ctx.save()` → expect a PUT of `state/production.json` with the same JSON body shape as before : **PRESERVED**. `save` still sets `updatedAt` then calls `putObject(this.bucket, this.key, JSON.stringify(state, null, 2), 'application/json')`; only the second argument's spelling changed (`stateKey(this.env)` → `this.key`), same value, same argument positions, so no `tags` argument is introduced and no `x-amz-tagging` header appears.
- `packages/cli/src/commands.ts:63` calls `ctx.store.delete()` during `destroy` → expect a DELETE of `state/<env>.json`, still swallowing its own failure, and no scoped key touched : **PRESERVED**. `delete` is `deleteObject(this.bucket, this.key).catch(() => undefined)` - the `.catch` is retained verbatim and the key is the unscoped one. `commands.ts:224` (`previewTeardown`) resolves identically.
- `packages/cli/src/test-support.ts:181` builds the store every CLI test's context carries → expect the whole existing suite to pass with no edit : **PRESERVED**. Three-argument construction unchanged; `pnpm test` is green with 124 cli tests and `jj diff --stat` shows no test file edited.

## Residue

Notes for the validator, not obligations. `packages/core/src/state.ts` had no test file before this task, so "existing state tests pass untouched" means the wider suite that exercises the store indirectly through `createTestContext` - there is no prior `state.test.ts` to preserve. The scope reaching the constructor comes from a plugin manifest that task 03 already constrains to `^[a-z0-9-]+$`; validating again here is deliberate defence at the boundary that owns the key, not duplication to remove. Whether `load` should also verify the round-tripped document's `env` field matches the store's is outside this DoD and belongs with any future state-versioning work.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: **DONE**
CONFIDENCE: **high**
SUMMARY: O1-O7 are all SATISFIED on collected evidence and all four regression traces are PRESERVED - the key is
computed once in the constructor behind a named-constant scope pattern that provably admits nothing able to leave the
`state/` prefix, the unscoped key and its corrupt-state message are byte-identical, both CLI call sites still pass
three arguments, no existing test was edited, and all five repo gates plus `pnpm typecheck` are green.

Validator notes, not obligations:
- The `Reviewable:` command `pnpm test -- state` does not filter to the state tests and prints no test names; it
  passes, but the literals it promises a reviewer are only visible via
  `pnpm exec vitest run src/state.test.ts --reporter=verbose` in `packages/core`. Worth correcting where that phrasing
  is reused in later tasks.
- O5's `grep -rn "listObjects\|refus"` cannot return no output: `state.ts` carried "refusing to proceed with empty
  state" before this task. Discharged on intent (no listing, no policy in the class), not on the literal check.
- Out of scope, flagged for the plan rather than this task: env names are validated nowhere, so an environment
  literally named `<env>.<plugin>` would collide with that plugin's scoped key. The key form is the change spec's own
  (`state/<env>.<plugin>.json`), and this task implements it faithfully.
