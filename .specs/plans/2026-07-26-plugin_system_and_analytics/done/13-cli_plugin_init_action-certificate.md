# Done Certificate - Task 13: Add the generic `blogwright <plugin> init` action

**Task:** [13-cli_plugin_init_action.md](13-cli_plugin_init_action.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 13. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 13) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright <plugin> init` on a repo with an existing config runs the plugin's `init(io)` against the Terminal port and splices the returned block into the file the environment resolves to, with a plugin-declared `init` command taking precedence over the generic action.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `loadConfig` in `packages/cli/src/context.ts:85` (its candidate order and its `FileNotFoundError` branch are refactored, not changed), `createContext` (`context.ts:110`), the built-in `init` branch at `packages/cli/src/cli.ts:107`, or task 10's dispatch for actions other than `init`.

## Obligations

- **O1 - End-to-end splice into the resolved config file.**
  - *Claim:* the action calls the plugin's `init(io)`, renders the block, splices it into the environment's resolved config path, and the result re-parses through `parseConfig`.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the end-to-end test in `packages/cli/src/plugin-commands.test.ts`; confirm it seeds a config at `config/<env>.jsonc` in `createMemoryFileSystem`, drives answers through `createScriptedTerminal`, asserts the written text contains the plugin's key, and ends with a `parseConfig` of the re-read file; repeat the trace for the `--config <path>` case.
  - *Checks:* resolve the path the action writes to - confirm it comes from the shared `resolveConfigPath(fs, source)` that `loadConfig` also calls (`packages/cli/src/context.ts`), not from a second string built inside `plugin-commands.ts`.
  - *Status:* ☑ SATISFIED - `pnpm --filter blogwright exec vitest run plugin-commands` passes 17/17. The
    end-to-end test (`packages/cli/src/plugin-commands.test.ts:280`) seeds `${repoRoot}/config/production.jsonc`
    on `buildDiscoveryPorts`' memory `fs`, drives one required answer through `createScriptedTerminal`,
    asserts the written text carries `"demo": {`, `"token": "secret-abc"` AND the untouched `"siteName"`,
    and ends with `parseConfigDocument(written).raw['demo']` equal to `{ token: 'secret-abc' }`; the
    `--config` trace (`:308`) writes `/elsewhere/custom.jsonc` and asserts `parseConfig(written)` does not
    throw. Path resolution: `runGenericInit` (`plugin-commands.ts:319`) calls the shared
    `resolveConfigPath(fs, { env, root, configPath })` from `context.ts:130` - the same function `loadConfig`
    (`context.ts:140`) is now entirely built from - with no second string built in `plugin-commands.ts`.
    Independently probed (temporary test file, since removed): `<plugin> init staging` with BOTH
    `config/production.jsonc` and `config/staging.jsonc` seeded writes staging and leaves production
    byte-identical; `--env production` beats the `staging` positional; the `ops.config.jsonc` fallback
    writes there and preserves an existing `// comment`. CAVEAT recorded as D1 below: no SHIPPED test pins
    the environment positional - dropping it (`rest.slice(1)` -> `[]` at `plugin-commands.ts:426`) leaves the
    whole 258-test suite green.

- **O2 - Prompting crosses the Terminal port only.**
  - *Claim:* the `io` handed to `init` prompts through `Terminal`, and no plugin path imports `node:readline`.
  - *Evidence to collect:* read the `io` construction in `packages/cli/src/plugin-commands.ts` and confirm every prompt call resolves to `ctx.ports.terminal.question`; run `pnpm lint` - expect clean; run `grep -rn "readline" packages/cli/src packages/core/src packages/pds/src` and confirm every hit is inside an adapter directory or a file listed in `.oxlintrc.json`'s override block.
  - *Checks:* confirm `packages/cli/src/plugin-commands.ts` is **not** in `.oxlintrc.json`'s `overrides.files` list, so the lint gate genuinely covers it.
  - *Status:* ☑ SATISFIED - `buildInitIo` (`plugin-commands.ts:272`) builds the `PluginInitIo` from
    `terminal.isInteractive`, the CLI `Logger`, and `ask: async (question) => (await ask(terminal, logger,
    question)) ?? ''` - every prompt therefore crosses `init.ts`'s exported `ask`, whose only input channel
    is `terminal.question`. `pnpm lint` exits 0 with no errors (only pre-existing `no-shadow` warnings in
    `nodes.test.ts`). `grep -rn "readline" packages/cli/src packages/core/src packages/pds/src` returns four
    hits: two doc-comment mentions (`init.ts:22`, `plugin-commands.ts:263`) and two real imports, both in
    `packages/core/src/adapters/node-terminal.ts` - an adapter directory. `.oxlintrc.json`'s
    `overrides.files` list is `packages/core/src/adapters/**`, `packages/cli/src/adapters/**`,
    `packages/cli/src/bin.ts`, `packages/cli/src/context.ts`, `packages/cli/src/test-support.ts`,
    `packages/pds/src/test-support.ts`, `packages/build-agent/**` - `plugin-commands.ts` is NOT in it, so the
    gate genuinely covers this file. Probed live: a contributor asking a required question with scripted
    answers `['', '  ', 'yes']` re-prompts twice and yields `'yes'`; an unanswered optional question yields
    `''`, never `undefined`. (See D2: the same doc comment misstates which files ARE exempt.)

- **O3 - A declared `init` command wins over the generic action.**
  - *Claim:* dispatch consults the plugin's own `commands` before the generic `init` action, in both directions, so pds's record-creating `init` is never replaced by a config writer.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and locate the three tests: one fake plugin declaring an `init` command (assert its `run` was called and no file was written), one carrying only an `init` contributor (assert the file was written), and one declaring both (assert discovery rejects it, naming the plugin); read the precedence comment in `packages/cli/src/plugin-commands.ts` and confirm it names pds as the reason.
  - *Checks:* precedence is the whole rule for a declared `init` - pds's writes no config block at all (`packages/pds/src/commands.ts:118` creates the publication record and the two site files), so an implementation or a test that requires a declared `init` command to write config has read the rule backwards. Only the both-declared combination is rejected, and only because the contributor's questions would then be asked nowhere.
  - *Checks:* trace the dispatch path for the argv `['pds', 'init']` shape through task 10's table - confirm the declared command is matched before the generic action is even constructed.
  - *Status:* ☑ SATISFIED - precedence is STRUCTURAL, not ordering luck: the generic action lives inside
    `if (!match) { ... }` at `plugin-commands.ts:415-437`, so `matchAction(plugin.commands, rest)` has
    already been consulted and failed before `rest[0] === GENERIC_INIT_ACTION` is even tested. Three tests:
    the declared-command plugin (`plugin-commands.test.ts:334`) asserts its `run` recorded exactly one call
    AND that the seeded config file is byte-identical afterwards; the contributor-only plugin (`:280`)
    asserts the file was written; the both-declared plugin (`:513`) asserts `discover` returns
    `plugins: []` and one `failures` entry. Mutation-tested: hoisting the generic check above `matchAction`
    AND dropping its `typeof plugin.init === 'function'` guard makes the declared-command test fail, so it
    is load-bearing. No test requires a declared `init` command to write config - the pds-like fixture's
    `run` only records, and the assertion on the file is that it did NOT change. Trace for `['pds','init']`:
    `matchAction` finds `action === 'init'` at word 1, returns the match, and `runGenericInit` is never
    constructed. Probed edge: a plugin declaring the MULTI-WORD `init db` plus a contributor is deliberately
    not a collision (the check compares `command.action === 'init'` exactly); `x init db` reaches the
    declared command and `x init` reaches the generic writer, both correct.

- **O4 - Refusal and empty paths.**
  - *Claim:* no `init` at all → the action is reported unavailable, the plugin's real actions are listed, exit is non-zero; an already-present key → non-zero with the splice module's message and the file byte-identical; a contributor yielding no block → nothing written and the operator told so.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the three tests; for the already-present case confirm the assertion compares the in-memory file's contents to the exact seeded string (not merely "does not contain the key") and that the exit code assertion is non-zero; for the no-init case confirm the listed actions come from the fake plugin's `commands` array.
  - *Status:* ☑ SATISFIED - three tests, all passing. No-`init`-at-all (`:377`): `code === 1`, no plugin
    `run` recorded, `terminal.errors === ['✗ unknown fake action: init']`, and `terminal.writes[0]` contains
    `"fake" actions:` and `sync - sync it` - the listing comes from `renderActions(plugin)` over the
    fixture's own `commands` array. Already-present key (`:402`): `runPlugin` REJECTS with
    `/already declares a "demo" key/` - the message raised by `spliceConfigBlock`
    (`config-block.ts:274`), not re-worded here - and the assertion is `expect(await
    fs.readText(configPath)).toBe(seeded)`, an exact byte comparison against the seeded string, so it proves
    the file was never written. Non-zero exit is via `bin.ts:18-22`, which maps any rejection to
    `process.exitCode = 1` after printing `err.message`; this is the exit-code contract task 10 recorded at
    `plugin-commands.ts:374-383`. Contributor yielding `[]` (`:428`): `code === 0`, file byte-identical,
    and `terminal.writes` contains a line matching `nothing written`. Mutation-tested: moving `fs.writeText`
    above the `spliceConfigBlock` call makes the byte-identical test fail.

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☑ SATISFIED - from the worktree root: `pnpm build` clean (tsc for core/pds/cli, rolldown for
    build-agent, docs build); `pnpm test` 370 passing (core+cli 247, pds 96, build-agent 27), 0 failing;
    `pnpm lint` exit 0, zero errors; `pnpm exec oxfmt --check .` "All matched files use the correct format"
    over 139 files; `pnpm knip` exit 0, no output. A changeset exists at
    `.changeset/plugin-init-action.md` (`"blogwright": minor`) and describes the user-facing behaviour
    including the refusal and empty paths. The one limit in the new code (`MAX_ATTEMPTS`) is the existing
    named constant in `init.ts`, reused rather than duplicated; `GENERIC_INIT_ACTION` is a named constant in
    both modules that spell it (deliberately mirrored, not imported - documented at
    `plugin-commands.ts:250-258`).

- **O6 - Reviewable: `pnpm test -- plugin-commands` shows declared-command precedence and an untouched file (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin-commands` and observe that a fake plugin declaring `init` reaches its own `run` and never the config writer, and that the already-configured case leaves the in-memory file identical to what the test seeded.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; capture the passing test names; read the two assertions named in the claim and confirm they are the ones the test actually makes.
  - *Status:* ☑ SATISFIED - `pnpm --filter blogwright exec vitest run plugin-commands --reporter=verbose`
    prints 17 passing tests across three describe blocks (`runPlugin`, `runPlugin - the generic \`init\`
    action`, `discover - a plugin declaring both an init command and an init(io) contributor`,
    `toPluginContext`). The two assertions the claim names are the ones the test actually makes:
    `expect(calls).toEqual([{ action: 'init', ctx: expect.anything(), args: [] }])` followed by
    `expect(await fs.readText(configPath)).toBe(seeded)` in "lets a plugin's own declared `init` command
    win", and `expect(await fs.readText(configPath)).toBe(seeded)` after the rejection in "rejects with the
    splice module's own message and leaves the file byte-identical".

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:163` (`createContext`, was :120) calls `loadConfig` with an env and no `configPath` : ☑ PRESERVED. `loadConfig` is now `parseConfig(await fs.readText(await resolveConfigPath(fs, source)))`; the candidate list moved verbatim into `configCandidates` (`context.ts:110`) in the same order (`--config` alone, else `config/<env>.jsonc` then `ops.config.jsonc`) and the thrown message is the identical template. All five pre-existing `loadConfig` tests pass unmodified, including "surfaces validation failures instead of trying the next candidate" - the one that pins that an EXISTING but invalid candidate raises rather than falling through, which the `FileNotFoundError`-catch rewrite could have broken. Mutation-tested: swapping the two candidates fails three tests. One benign semantic shift: absence is now decided by `fs.exists` (`node-fs.ts:45`, `stat` + `isAbsence`) instead of by catching `FileNotFoundError` off `readText`, so an unreadable-but-present file now surfaces a "checking" rather than a "reading" contextualised error - same class of failure, same propagation, different verb. `createContext` is the ONLY production caller of `loadConfig` (grep over `packages/**/*.ts`; the other hits are tests and doc comments).
- `packages/cli/src/cli.ts:107` (`main`, `command === 'init'`) calls `initSite` : ☑ PRESERVED. `cli.ts` is not in the diff at all (seven files: the changeset, `context.ts`/`context.test.ts`, `init.ts`, `plugin-commands.ts`/`.test.ts`, `plugins.ts`). `blogwright init` still reaches the built-in wizard because `KNOWN_COMMANDS` is tested against the FIRST positional; `blogwright <plugin> init` has `<plugin>` there, so it falls through to `runPlugin` as before. No plugin awareness was added to the wizard.
- `packages/cli/src/init.ts:93-110` (`initSite`'s four questions) calls `ask` : ☑ PRESERVED. The non-comment diff of `init.ts` is exactly two lines - `interface Question` -> `export interface Question` and `async function ask(` -> `export async function ask(` (reflowed across four lines by the formatter). The loop body, `MAX_ATTEMPTS`, the default-value suffix and the validate/retry semantics are byte-identical. `pnpm --filter blogwright exec vitest run init` passes 5/5 unmodified. The task's step 13 explicitly allowed "export it, or lift it into a shared prompt module"; exporting `Question` alongside `ask` is not gratuitous - tsc's declaration emit for the now-exported `ask` requires it. A shared `prompt.ts` would be tidier (it would stop dispatch depending on the wizard module, a coupling task 14 will thicken), but the chosen option is within the contract.

## Residue

Not obligations, for the validator's awareness: the action's behaviour on a repo with *no* config at all (task 14's territory) is undefined here and worth a note if the implementation guesses; `secret status`-style multi-word actions are not exercised by this task; and whether the `io` surface should offer anything beyond a question/validate loop is deliberately left to the first plugin that needs more.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED against their named evidence and all three regression traces are PRESERVED - the generic action resolves the environment through the same `resolveConfigPath` `loadConfig` uses (verified live for the `staging` positional, `--env`, `--config` and the `ops.config.jsonc` fallback), a declared `init` command wins structurally rather than by ordering, the both-declared rejection sits in `plugins.ts`'s collision pass with the DECISION note task 16 needs, and every gate is clean - with one recorded coverage gap (D1: no shipped test pins the environment positional on this new path) and three low-severity notes that do not change the verdict.

## Validator notes (2026-08-30)

Recorded for the record; none blocks the merge.

- **D1 - coverage gap, MEDIUM, recommend a follow-up test.** No shipped test exercises the environment positional on the generic `init` path. Mutating `rest.slice(1)` to `[]` at `packages/cli/src/plugin-commands.ts:426` leaves all 258 tests green. The shipped cases cover only the DEFAULT environment (`config/production.jsonc`, which passes either way) and `--config` (which bypasses environment resolution entirely); neither `ops.config.jsonc` nor a non-default `config/<env>.jsonc` is pinned. The behaviour is correct today - a temporary probe confirmed `<plugin> init staging` writes `config/staging.jsonc` and leaves `config/production.jsonc` byte-identical - but a later task could silently regress it into the exact fallback-to-production defect task 10's own doc comment (`plugin-commands.ts:349-362`) exists to warn about. One test asserting the file WRITTEN for `['init', 'staging']` would close it.
- **D2 - doc inaccuracy, LOW.** `packages/cli/src/plugin-commands.ts:265` claims the file "carries no override, unlike `init.ts`/`bin.ts`/the adapters". `init.ts` is NOT in `.oxlintrc.json`'s `overrides.files`; `context.ts` is, and goes unmentioned. The conclusion the sentence draws (this file IS covered by the gate) is correct - only its list of the exempt files is wrong.
- **D3 - UX gap, LOW.** `renderActions` (`plugin-commands.ts:185`) lists only `plugin.commands`, so a contributor-only plugin's unknown-action refusal prints `"demo" actions:` followed by nothing, even though `blogwright demo init` works. Verified: `blogwright demo nope` writes exactly `['"demo" actions:']`. The DoD only requires the listing for the no-`init`-at-all case, which is why this is a note and not a defect; task 17's `plugin list` may be the better place to fix it.
- **D4 - theoretical, LOW.** `runGenericInit` is handed `plugin.init` detached from its object (`plugin-commands.ts:424`) and calls it as `contributor(io)`, so `this` is `undefined` inside a contributor, whereas a declared command's `run` is invoked as `match.command.run(...)` with `this` bound to the command. Only a class-instance plugin would notice, and the SPI documents plain objects.
- **D5 - informational.** `discover`'s `failures` are read nowhere in production code - `runPlugin` destructures only `{ plugins }`. So the double-declaration rejection is invisible to the operator: `blogwright both init` reports `no built-in command or installed plugin claims "both"` with no reason. This is pre-existing from task 10 (namespace collisions behave identically) and task 17's `plugin list` is the intended surface; noted so it is not mistaken for something this task introduced.
- **Residue discharged.** The no-config-at-all case does NOT guess: `resolveConfigPath` raises `no config found for environment "production" - looked for ...` BEFORE the contributor is invoked (probed: `terminal.prompts` is empty), so an operator is never asked questions that are then thrown away, and the failure exits 1 through `bin.ts`. Multi-word actions: a plugin declaring `init db` plus a contributor is deliberately not a collision, and both `x init db` (declared) and `x init` (generic) dispatch correctly.
- **Workspace left as found.** Verification used a temporary probe test file and five source mutations in `/Users/ant/code/blogwright-task-13`; all were reverted and byte-compared against backups, and `jj st` shows the original seven changed files only.
