# Done Certificate - Task 07: Give main() a test seam and pin today's dispatch behaviour

**Task:** [07-cli_main_test_seam.md](07-cli_main_test_seam.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 07. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 07) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `main` accepts an injectable context factory defaulted to `createContext` at `bin.ts`, and a new `packages/cli/src/cli.test.ts` pins today's help, unknown-command, `pds` and `status` behaviour byte-exactly.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break real CLI invocation through `packages/cli/src/bin.ts:9`, nor the behaviour of `runPds` (`packages/cli/src/cli.ts:187-232`) and `runPreview` (`:246-292`), which both build their own context today.

## Obligations

- **O1 - The seam is a parameter, not a mock.**
  - *Claim:* `main` takes its context factory as a parameter, `bin.ts` supplies `createContext`, and no module mock or env-var override appears in `cli.test.ts`.
  - *Evidence collected:* `packages/cli/src/cli.ts:88-92` declares `main(argv, makeTerminal, makeContext: ContextFactory)` - a required third parameter, matching the shape of the pre-existing `makeTerminal`. `ContextFactory` is declared at `:86` as `(opts: ContextOptions) => Promise<OpsContext>`, structurally identical to `createContext`'s own signature (`context.ts:110`). `packages/cli/src/bin.ts:5,10` imports `createContext` and passes it as the third argument. Grep of `packages/cli/src/cli.test.ts` for `vi.mock`, `vi.stubEnv`, `vi.stubGlobal`, `vi.spyOn`, `process.env`: no matches.
  - *Checks:* every `createContext` reference inside `packages/cli/src/cli.ts` is gone - `:146`, `:216` and `:273` (formerly `:134`, `:203`, `:259`) now call `makeContext` with byte-identical option literals; the only surviving occurrence of the identifier in `cli.ts` is the word inside the doc comment at `:82`. Stronger than required: `cli.ts:7` imports `ContextOptions`/`OpsContext` as `import type`, so `context.js` is not in `cli.js`'s runtime module graph at all - `packages/cli/dist/cli.js` contains no import of `./context.js` (verified in the built output). `packages/cli/src/bin.ts:5` is the only runtime import of `./context.js` in the CLI package outside `context.test.ts`. `context.ts:119` (`findRepoRoot`) and `:132` (`sts.getAccountId`) are therefore structurally unreachable from the test.
  - *Judgement on the seam's shape:* the DoD phrase "defaulted to `createContext` at `bin.ts` (the composition root)" admits two readings - a TypeScript default parameter inside `cli.ts`, or a required parameter whose production value is chosen at `bin.ts`. Step 2 of the task settles it ("so `cli.ts` no longer constructs the real context itself and `bin.ts` stays the only place adapters are wired"), as does this certificate's own Residue note. A `= createContext` default inside `cli.ts` would have kept a value import of `context.js` in the domain module and left a hidden production default there, defeating the stated rationale and DEVELOPMENT.md §Hexagonal architecture. The required parameter is the correct reading and is enforced by the compiler at the single production call site.
  - *Status:* ☑ SATISFIED

- **O2 - Today's behaviour is pinned.**
  - *Claim:* `cli.test.ts` asserts `--help` → `USAGE` and 0; bare invocation → `USAGE` and 1; unknown command → `unknown command: x` plus `USAGE` and 1; `blogwright pds` with no action and `blogwright pds bogus` → 1 with today's message shape; `blogwright status` reaches `commands.status`.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` (the task's `Reviewable:` command) and `pnpm --filter blogwright test -- cli` (this certificate's command) both pass. Six tests, all read rather than taken on their names: `prints USAGE and exits 0 for --help` (`cli.test.ts:109-121`), `prints USAGE and exits 1 for a bare invocation` (`:123-131`), `prints "unknown command" plus USAGE and exits 1 for an unrecognised command` (`:133-145`), `exits 1 with "unknown pds action: (none)" when no action is given` (`:149-161`), `exits 1 with "unknown pds action: bogus" for an unrecognised action` (`:163-175`), `reaches commands.status, which completes despite a rejecting AWS transport` (`:179-192`). Every exit code is `main`'s resolved return value (`const code = await main(...)`); no `process.exit`, no `process.exitCode`, no spawned process.
  - *Checks:* traced `blogwright pds` with no action through `cli.ts:207-215` - `positionals = ['pds']`, `secret = false`, `action = positionals[1] = undefined`, so `logger.error(\`unknown pds action: ${action ?? '(none)'}\`)` emits `unknown pds action: (none)`, which `createLogger` renders as `✗ unknown pds action: (none)` (colour stripped, terminal non-interactive). The test pins that exact string. Confirmed independently against the built CLI: `node packages/cli/dist/bin.js pds` prints `✗ unknown pds action: (none)` and exits 1.
  - *Status test - is it real evidence or a proxy?* Real. `Status for "…" (bucket …)` has exactly one producer in the repo, `packages/cli/src/commands.ts:302`; grep finds no other. The assertion pins index 0 of `writes`, so any earlier output (a `USAGE` dump, an error path) fails it. `code === 0` independently proves the `switch` matched `case 'status'` and fell through to `return 0` - the only route to 0 for `argv = ['status']` (the help short-circuit at `:114` is not taken because `command` is set and `--help` is absent; `init`/`preview`/`pds` do not match; `KNOWN_COMMANDS` contains `status`). Had `commands.status` thrown, `await main(...)` would have rejected and the test failed. The assertion is not a module spy.
  - *Deviation from the authored expectation, in the safe direction:* this certificate anticipated the header `Status for "test" (bucket …)`, assuming the stub would take `createTestContext`'s default env. The implementer instead forwards `opts.env` (`cli.test.ts:99-105`), so the header reads `production` - which additionally proves `main`'s env resolution (`cli.ts:144`, `values.env ?? envPositional ?? 'production'`) reached the factory. Stronger evidence, not weaker.
  - *Status:* ☑ SATISFIED

- **O3 - The USAGE pin is byte-exact.**
  - *Claim:* the help assertion compares the full `USAGE` string, not a substring or a normalised form.
  - *Evidence collected:* `cli.test.ts:26-78` declares `EXPECTED_USAGE` as an independent literal copy, not an import - and cannot be an import, because `USAGE` at `cli.ts:11` is module-private (`const USAGE`, never exported). Extracted both template literals and byte-diffed them: identical, 3091 bytes, no interpolation and no escape sequences in either. All five help assertions are `expect(terminal.writes).toEqual([EXPECTED_USAGE])` - a deep-equality comparison over the whole captured `writes` array, so extra or missing output also fails. Grep for `toContain`, `trim(`, whitespace normalisation: no matches.
  - *Checks (mutation performed):* changed one character inside the template literal at `cli.ts:25` (`vs.` → `vs,`), re-ran the CLI suite: 5 of 6 tests failed, each with a character-level diff naming the changed line (`- status [env] Show planned graph vs. live state` / `+ … vs, live state`) at `cli.test.ts:120`. Restored the file from a byte backup (sha256 `4322fa15…09bd1` before and after), re-ran: 6/6 green. `jj status` unchanged throughout.
  - *Assessment of pin strength:* the pin is genuinely load-bearing for tasks 11 and 26/29. Any edit to `USAGE` - a rebuilt help section, the deletion of the static `pds` block - breaks five assertions and forces a deliberate, reviewed update to `EXPECTED_USAGE`. The residual weakness is inherent to any golden-text pin (an implementer can paste the new text without thinking); the doc comment at `cli.test.ts:19-25` states why the copy exists, which is the available mitigation.
  - *Status:* ☑ SATISFIED

- **O4 - No process, no AWS, and behaviour-neutral.**
  - *Claim:* the new tests spawn nothing and reach no cloud, and the change makes no user-visible difference, so no changeset is required.
  - *Evidence collected:* grep of `cli.test.ts` for `execFile`, `spawn`, `fetch`, `node:child_process`, `node:fs`: no matches. The stub factory (`cli.test.ts:98-105`) returns `createTestContext`, whose clients are built over `rejectAllTransport` (`test-support.ts:53-57`) with `staticCredentials` (so no ambient credential chain and no IMDS lookup), whose `ports.vcs` fails fast (`:91-102`), whose `ports.fs` is a fresh `createMemoryFileSystem`, and whose `ports.ping` is a no-op. `main` passes `ports: { terminal }` only, so `fs`/`vcs`/`ping` all take those in-memory defaults. Combined with O1's finding that `context.js` is absent from the test's runtime module graph, neither disk nor AWS is reachable; the six tests run in 8 ms of test time.
  - *Behaviour neutrality:* `jj diff --git` touches three files. `cli.ts` gains a type and a parameter and renames three call targets; every `ContextOptions` object literal is byte-identical (`runPreview` keeps `preview: true` at `:274`). No message string and no `USAGE` byte changed. Verified against the built artifact after `pnpm build`: `node packages/cli/dist/bin.js --help` exits 0 and its stdout is byte-identical to the pinned text; `… frobnicate` prints `✗ unknown command: frobnicate` plus usage and exits 1; `… pds` exits 1. `.changeset/` contains only `config.json` and `README.md` - no changeset added, correctly.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* run from the workspace root. `pnpm build` - clean (docs, core, pds, build-agent, cli). `pnpm test` - 5 packages, 351 tests passing (core 104 + 1 skipped, build-agent 27, pds 85, cli 134 across 16 files). `pnpm lint` - exit 0; the only output is pre-existing `no-shadow` warnings in `packages/cli/src/nodes.test.ts`, with no finding on `cli.ts`, `bin.ts` or `cli.test.ts`. `pnpm exec oxfmt --check .` - "All matched files use the correct format", 124 files. `pnpm knip` - exit 0, no output (the newly exported `ContextFactory` is consumed by `cli.test.ts`). `pnpm typecheck` additionally clean. The change introduces no numeric limits.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewer runs the CLI suite and breaks the pin (Reviewable).**
  - *Claim:* a reviewer can run the CLI suite and observe a passing suite with no network or git access, then change one character of `USAGE` and observe the byte-exact pin fail.
  - *Evidence collected:* both spellings of the command run (the task's `pnpm --filter blogwright exec vitest run cli --reporter=verbose` and this certificate's `pnpm --filter blogwright test -- cli`). Passing names recorded under O2. Mutation, failure output, revert and return to green recorded under O3, with a sha256 match confirming the byte-exact restore. No network and no git access is required or attempted: the CLI suite's only VCS surface is `rejectAllVcs`, and its only AWS surface is `rejectAllTransport`.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/bin.ts:10` calls `main(process.argv.slice(2), makeTerminal, createContext)` → after `pnpm build`, `node packages/cli/dist/bin.js --help` prints stdout byte-identical to the pinned usage text and exits 0; `… frobnicate` and `… pds` each print today's message and exit 1 : ☑ PRESERVED
- `packages/cli/src/cli.ts:216` `runPds` builds a context for `pds sync` → the factory-routed call passes the same `ContextOptions` (`env` with the same `values.env ?? envPositional ?? 'production'` resolution, `configPath`, `domain`, `endpointOverride`, `ports: { terminal }`); the diff changes only the callee identifier : ☑ PRESERVED
- `packages/cli/src/cli.ts:273` `runPreview` builds a context with `preview: true` → the flag and every sibling field survive the routing unchanged : ☑ PRESERVED
- Signature-change sweep: `main` is imported in exactly two places repo-wide - `bin.ts:4` (production) and `cli.test.ts:14` (new) - so the added required parameter has no other call site to break; `pnpm typecheck` and `pnpm build` confirm : ☑ PRESERVED

## Residue

Notes for the validator: the exact name and placement of the `ContextFactory` type is an implementation choice. Whether the factory is a required third parameter or an optional one with a default inside `cli.ts` is not fixed by the obligations, but a default that references `createContext` from `cli.ts` weakens O1's intent - the composition root should own the real construction. `preview` dispatch is pinned by no obligation here; it is exercised only through the regression check.

Validator's additions, carried forward for tasks 11, 26 and 29:

- The stub factory ignores `opts.domain`, `opts.preview`, `opts.configPath` and `opts.endpointOverride`, so no test would catch a dispatch change that stopped forwarding them - `runPreview`'s `preview: true` in particular is held only by reading, as this certificate anticipated. Tasks 26 and 29 rewrite exactly that code and should widen the stub to record and assert the full `ContextOptions`.
- The `pds` arm is pinned only on its two negative paths. No test asserts that a valid action (`pds keygen`, `pds secret status`, `pds sync production`) reaches the corresponding `pds.*` function or resolves its environment positional. That is within this task's contract but leaves task 29's positional-shift removal without a positive-path net; task 29's own certificate names those cases and should add them.
- The status assertion interpolates `ctx.names.bucket` from the context the factory produced, so it pins that `commands.status` was reached, not that bucket naming is correct. That split is correct (naming is owned elsewhere), and the literal `production` in the same string carries the env-resolution evidence.
- Out of scope but adjacent: `cli.ts:121` still constructs a real adapter directly (`initSite(createNodeFileSystem(), …)`), so `cli.ts` is not yet free of adapter construction. Pre-existing and untouched by this diff.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED with executed evidence - the five gates are clean, the six new tests were read rather than trusted, the `USAGE` pin was proved byte-identical (3091 bytes) and proved to fire under a one-character mutation and to recover on revert, and the seam is stronger than the contract required because `cli.ts`'s type-only import leaves `context.js` out of the test's runtime module graph entirely.
