# Done Certificate - Task 21: Add the pds config validator and secretName default to blogwright-pds

**Task:** [21-pds_config_ownership.md](21-pds_config_ownership.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 21. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 21) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/pds/src/config.ts` owns the `pds` config block end to end - the three checks lifted verbatim from core plus the `<siteName>/atproto` secret-name derivation - with negative-space tests, and is purely additive because core still validates at this point.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `mergeConfig`/`validateConfig` in `packages/core/src/config.ts`, the pds cases in `packages/core/src/config.test.ts:86-120`, or any consumer of `PdsConfig` (`packages/pds/src/sync.ts:50`, `packages/pds/src/client-metadata.ts:41`, `packages/cli/src/nodes.ts:925`).

## Obligations

- **O1 - The module exports a validator and a secret-name resolver, and imports only core types.**
  - *Claim:* `packages/pds/src/config.ts` exports a validator for the `pds` block plus a function returning `<siteName>/atproto` when `secretName` is absent and the explicit value otherwise, with no `node:fs`, `node:child_process`, or vendor-SDK import.
  - *Evidence collected:* the file is 57 lines. Exports are `validatePdsConfig(raw: unknown): PdsConfig` (`config.ts:31`) and `resolvePdsSecretName(pds: PdsConfig, siteName: string): string` (`config.ts:55`). `grep -nE "^import|require\(" packages/pds/src/config.ts` returns exactly one line - `config.ts:15: import type { PdsConfig } from 'blogwright-core';`. The compiled `packages/pds/dist/config.js` contains no `import` at all, so the type import is fully erased and the module has no runtime dependency.
  - *Checks:* the resolver's declared return type is `string`, not `string | undefined`; `pds.secretName ?? defaultSecretName(siteName)` (`config.ts:56`) makes the fallback total, so task 22 and task 23 can consume it without a cast. `pnpm typecheck` is green across all five workspaces.
  - *Status:* ☑ SATISFIED

- **O2 - The four error messages are byte-identical to core's.**
  - *Claim:* the strings raised are exactly `config.pds.name is required`, `config.pds.handleResolver must be a URL, got "…"`, `config.pds.handleResolver must be https, got "…"`, and `config.pds.secretName has invalid characters: "…"`.
  - *Evidence collected:* not verified by reading the templates side by side - verified by **rendering**. A temporary harness (since deleted) drove 17 malformed `pds` blocks through core's `mergeConfig` (which calls the unexported `validateConfig`) and through `validatePdsConfig`, and asserted `toBe` equality on `${err.name}: ${err.message}`. All 17 matched exactly, covering every interpolation edge tried: blank / whitespace / tab-newline `name`; `nope`, `''`, `://a b"c`, `42` resolvers (all → `must be a URL, got "…"` with the raw input echoed); `http://resolver`, `HTTP://Resolver.Example/`, `ftp://r.example`, `mailto:a@b.c` (all → `must be https, got "…"`, original casing preserved, parsed URL never substituted for the raw input); `my site/atproto`, `a"b`, `café`, `''` secret names (all → `has invalid characters: "…"`, embedded quote and non-ASCII rendered identically). A second harness compared `mergeConfig(...).pds.secretName` with `resolvePdsSecretName(...)` over 3 site names × 3 blocks - all 9 identical.
  - *Ordering:* the `new URL(...)` try/catch ordering (`config.ts:36-43`) is preserved and behaviourally confirmed: `nope` renders `must be a URL` and never falls through to the https check, while `http://resolver` renders `must be https`. Mutation M3 (an https string-prefix check hoisted above the `try`) reddens `rejects a non-URL handleResolver`, so the ordering is pinned by the suite, not merely by the source.
  - *Status:* ☑ SATISFIED

- **O3 - Negative-space and positive tests cover every branch.**
  - *Claim:* `packages/pds/src/config.test.ts` rejects a blank/whitespace `name`, an `http://` resolver, a non-URL resolver, and a `secretName` containing a character outside `^[\w/+=.@-]+$`, and accepts the derived default and an explicit override.
  - *Evidence collected:* `pnpm --filter blogwright-pds exec vitest run config --reporter=verbose` → 11 passed, 0 failed. Every rejection is paired with its accepting neighbour: blank `name` (`:10`) and whitespace `name` (`:14`) ↔ `accepts a real name` (`:20`); `nope` (`:24`) and `http://resolver.example` (`:30`) ↔ `accepts an https:// handleResolver` (`:36`); `my site/atproto` (`:51`) ↔ `accepts a secretName built only from the permitted class` (`:57`, exercising `_ - / + = . @` and digits); derived default (`:72`) ↔ explicit override (`:76`). Every rejection asserts on the message text, not merely that something threw, and each accept asserts the returned block with `toEqual`.
  - *Mutation testing (15 mutants, all caught):* message wording ×4, `.trim()` removal, try/catch reordering, https-check removal, permissive regex, wrong default template, default-always-wins, dropped quotes around each interpolation, parsed-URL-instead-of-raw-input, "reject everything" (6 tests red, including all three accepts - the suite distinguishes "rejects the right things" from "rejects everything"), and a mutated return value (3 accepts red).
  - *Status:* ☑ SATISFIED

- **O4 - Core is untouched and no changeset is written.**
  - *Claim:* `packages/core/src/config.ts` and `packages/core/src/config.test.ts` are byte-identical to their pre-task state, the existing core pds tests pass unmodified, and `.changeset/` gains no file.
  - *Evidence collected:* the workspace is jj-only (no colocated `.git`), so the `git diff packages/core` check was run as `jj diff --git packages/core` → empty output, exit 0. `jj diff --stat` lists exactly two files, both new and both under `packages/pds/src/`. SHA-1 of `packages/core/src/config.ts` and `config.test.ts` at `@` equals the SHA at `@-` (`cce80705…` and `6987b3be…`), and `config.ts` in the worktree hashes identically to the main tree's copy. `.changeset/` holds only `config.json` and `README.md` - no new `*.md`. `pnpm --filter blogwright-core exec vitest run config` → 25 passed, including all five pds cases.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the repo root in `.github/workflows/ci.yml` order - `pnpm build` (rc 0), `pnpm typecheck` (rc 0), `pnpm test` (rc 0; core 123 passed/1 skipped, build-agent 27, pds 96, cli 173), `pnpm lint` (rc 0; only the pre-existing `no-shadow` warnings in the untouched `packages/cli/src/nodes.test.ts`), `pnpm exec oxfmt --check .` (132 files, correct format), `pnpm knip` (rc 0 - the new module is not re-exported from `index.ts` and knip is still clean). `packages/pds/src/rkey.test.ts`'s pinned vectors: 10 passed. The character class is the named constant `SECRET_NAME_PATTERN` (`config.ts:18`), not an inline literal at the call site, and the `<siteName>/atproto` template has exactly one home in `packages/pds` (`config.ts:22`, via `defaultSecretName`). No changeset required: `packages/pds/src/index.ts` does not re-export `./config.js` and the package's `exports` map is unchanged, so no published surface moved.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `pnpm test -- config` plus an empty core diff (Reviewable).**
  - *Claim:* a reviewer can run the task's `Reviewable:` command and observe the new pds cases passing alongside the untouched core cases, with `git diff packages/core` empty.
  - *Evidence collected:* `pnpm --filter blogwright-pds exec vitest run config --reporter=verbose` from the repo root lists all 11 new cases passing by name; `pnpm --filter blogwright-core exec vitest run config --reporter=verbose` lists the five core pds cases passing unmodified; `jj diff --git packages/core` (the jj equivalent of `git diff packages/core` in this workspace) is empty.
  - *Status:* ☑ SATISFIED

## Regression check

Discharged. The diff adds two files and touches nothing else, so no existing caller changes
behaviour: `requirePdsConfig` (`packages/pds/src/sync.ts:50`) still returns `ctx.config.pds`
verbatim - task 22's `ResolvedPdsConfig` has not been anticipated here, and no encroachment on
task 22 or 25 was found. Full-suite regression is green (419 tests across four packages, one
pre-existing skip). Core's `mergeConfig`/`validateConfig` are hash-identical to base.

## Residue

The `<siteName>/atproto` template deliberately has two homes after this task - the new one here and
core's at `packages/core/src/config.ts:269` - because core still validates. Task 27 removes core's.
The validator is unreachable from any command until task 25 wires it into the plugin export.

Three observations carried forward, none blocking:

1. `packages/pds/src/config.test.ts:43-49` - the dedicated ordering test asserts
   `.not.toThrow(/must be https/)`, which in vitest also passes when nothing throws at all, so it
   is vacuously satisfiable on its own. The ordering is genuinely pinned by the two message
   assertions at `:25` and `:31` (mutation M3 reddens `:24`), so this is redundant rather than wrong.
2. `toThrow('literal')` is a substring match, so a future prefix or suffix added to any of the four
   messages would survive this suite (two such mutants survived; every wording, quoting and
   interpolation change was caught). Byte-identity is established here by rendering against core,
   not by the suite - worth re-rendering when task 27 deletes core's copy, which is the last moment
   the comparison is possible. The suite is nonetheless stricter than core's own `/pds.name/` assertions.
3. `config.ts:45` tests `SECRET_NAME_PATTERN` against a possibly-absent `secretName`; `RegExp.test`
   coerces `undefined`/`null` to `"undefined"`/`"null"`, both of which match the class, so a raw block
   without `secretName` validates and is returned with `secretName` undefined despite the declared
   type. This is net-identical to core (core defaults before validating, and the derived default always
   matches the class), and task 22's `ResolvedPdsConfig` is where the type is made honest. A non-string
   `name` throws a V8 `TypeError` whose text differs only by the variable prefix
   (`cfg.pds.name?.trim` vs `cfg.name?.trim`); it is a crash path, not one of the four operator-facing
   messages, and core crashes on the same input.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied on collected evidence - the four messages and the
secret-name derivation render byte-identically to core's across 26 rendered comparisons, all 11
paired positive/negative tests pass and every one of 15 mutants is caught, core is hash-identical to
base with an empty `jj diff packages/core`, and all six CI gates are green.
