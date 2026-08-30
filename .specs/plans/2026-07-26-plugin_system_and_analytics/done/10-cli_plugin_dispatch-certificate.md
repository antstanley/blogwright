# Done Certificate - Task 10: Route `blogwright <plugin> <action>` through generic dispatch

**Task:** [10-cli_plugin_dispatch.md](10-cli_plugin_dispatch.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 10. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 10) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright <plugin> <action>` dispatches to an installed plugin's command with flag values and multi-word actions intact, while discovery stays skipped for every built-in command.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break built-in dispatch (`packages/cli/src/cli.ts:107-175`), the hardcoded `pds` branch at `:114` (still live until task 29), `preview` dispatch at `:246-292`, or the task-07 pins in `packages/cli/src/cli.test.ts`.

## Obligations

- **O1 - Generic dispatch, multi-word actions, and exit codes.**
  - *Claim:* an unrecognised first positional reaches plugin dispatch with the remaining args, multi-word actions dispatch by declaration, and the command's return value becomes the exit code.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` - 19/19 pass, including "dispatches a multi-word action (\"secret status\") by declaration, not by positional shifting, with a trailing environment"; `pnpm --filter blogwright exec vitest run cli plugin-commands` - 27/27 pass, including `runPlugin` › "matches the longest declared action (\"secret status\" over the bare \"secret\")". The fixture (`test-support.ts:390-409`, `makeFakePlugin`) declares a bare `secret` BEFORE `secret status`, so a first-match implementation cannot pass. `matchAction` (`plugin-commands.ts:129-143`) keeps the strictly-longest whole-word match and consumes `match.wordCount` positionals (`:279`); no branch reproduces `cli.ts:195`'s fixed shift.
  - *Checks:* trace `blogwright fake secret status extra` - `matchAction` returns `secret status` (wordCount 2), `afterAction = ['extra']`, so `extra` is consumed as the ENVIRONMENT (`env = 'extra'`) and `args = []`. This diverges from this obligation's check text, which expected `extra` in `args`; the divergence is in the certificate, not the code: §CLI → Plugin dispatch and the task's own step 5 both make the first unconsumed positional the environment (`blogwright <plugin> <action> [env] [args]`), which O1's check line predates. A second trailing positional does arrive: `blogwright fake secret status extra more` gives `env='extra'`, `args=['more']`. Mutation `[...afterAction, …]` (env positional not consumed) fails 4 tests, so the consumption is pinned.
  - *Deviation, recorded not waived:* "the command's return value becomes the exit code" is not implementable. `PluginCommand.run` is declared `run(ctx, args): Promise<void>` in the merged SPI (`packages/core/src/plugin.ts:183`) and the authority spec names no return code, so there is no value to map without a cast. The implementation maps what it owns - 0 on success, 1 on both refusals - and lets a command's own failure propagate to `bin.ts:18`'s catch (`process.exitCode = 1`), exactly as every built-in refusal does; `plugin-commands.test.ts:137-169` pins the propagation. The DoD's purpose clause ("a command that reports failure exits non-zero") holds; only its mechanism clause ("without throwing") is foreclosed by the SPI.
  - *Status:* ☑ SATISFIED (with the recorded deviation on the unimplementable return-code clause)

- **O2 - Flag values arrive at `run`.**
  - *Claim:* a flag-carrying invocation reaches `run()` with the flag's value, asserted positively rather than through a refusal message.
  - *Evidence collected:* `cli.test.ts:278-298` drives `main(['fake','secret','status','--identifier','alice.example','--yes'])` and asserts `calls[0].args` equals `['--identifier','alice.example','--yes']` - a positive assertion on the recorded value, no refusal message anywhere in it; `plugin-commands.test.ts:87-113` asserts the same at the unit level.
  - *Checks:* `main` hands its own `parseArgs` `values` (`cli.ts:100-116`) straight to `runPlugin` (`cli.ts:145`); `PluginValues` (`plugin-commands.ts:60-72`) narrows that same object rather than rebuilding it, and `serialiseFlags` (`:100-109`) renders `FORWARDED_FLAGS` - `identifier` and `yes` among them - into the `string[]` the SPI's `run(ctx, args: string[])` declares. `env` is deliberately excluded (consumed as the override); `plain`/`help` are session-level. Mutation dropping `serialiseFlags` from `args` fails exactly the two flag tests.
  - *Status:* ☑ SATISFIED

- **O3 - Unknown plugin and unknown action.**
  - *Claim:* an unknown plugin name and an unknown action each produce the specified message and exit code 1.
  - *Evidence collected:* `cli.test.ts:374-393` asserts `terminal.errors` equals one line reading: no built-in command or installed plugin claims "ghost" - run `blogwright plugin list` to see what is installed - with `main` returning 1; `cli.test.ts:394-419` asserts `['✗ unknown fake action: bogus']` plus a `writes` entry listing all four declared actions, with `main` returning 1. Both mirrored in `plugin-commands.test.ts`. Message sites: `plugin-commands.ts:257-261` and `:274-276`.
  - *Status:* ☑ SATISFIED

- **O4 - Laziness, the untyped-cast ban, and the changeset.**
  - *Claim:* built-in commands never trigger discovery, the plugin context is built by a named adaptation function with no cast, and a changeset records the new surface.
  - *Evidence collected:* `cli.test.ts:420-451` runs `deploy`, `status` and `bootstrap` and asserts `discoveryPortsCalls === 0` **and** `loader.resolveCalls`/`packageJsonPathForCalls`/`loadCalls` all empty - the port-factory count is the stronger of the two signals and is the assertion that fires first (mutation below). Every other built-in test passes `unreachableDiscoveryPorts` (`cli.test.ts:117-129`), a factory that throws on call. `grep -n "as PluginContext" packages/cli/src/plugin-commands.ts` → no matches; `grep -nE "\bas [A-Z]|\bany\b|as unknown"` over `plugin-commands.ts` and its test → prose in comments only. `toPluginContext` (`plugin-commands.ts:188-209`) supplies exactly `pluginConfig`, `siteState` and `record` on top of the `OpsContext`, and narrows one member it must: `ports` becomes `{fs, terminal}`, because `PluginContext.ports` is core's two-member `PluginPorts` and passing `ops.ports` through (which WOULD typecheck - excess-property checks do not apply to a non-literal) would hand a plugin `vcs`/`ping`/`loader`/`packages`, contradicting §Plugin SPI → `PluginContext`. `.changeset/generic-plugin-dispatch.md` describes the dispatch surface and bumps all three publishable packages minor, per `.changeset/README.md`'s fixed-version rule and `config.json`'s `fixed` array.
  - *Checks:* the discovery call sits inside `if (!KNOWN_COMMANDS.has(command))` at `cli.ts:136-150`, after the `init`/`preview`/`pds` branches and before the built-in switch; `makeDiscoveryPorts()` is evaluated only as an argument inside that branch. **Mutation:** relaxing the guard to `if (!KNOWN_COMMANDS.has(command) || true)` so every command falls through fails the laziness test with `AssertionError: expected 3 to be +0` - the port-factory counter, not the loader log. Reverted; suite green.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the worktree root, all six CI gates in `.github/workflows/ci.yml` order: `pnpm build` exit 0, `pnpm typecheck` exit 0 (all 4 packages, test files included), `pnpm test` exit 0 (core 123+1 skipped, pds 96, build-agent 27, cli 234 over 22 files), `pnpm lint` exit 0 (only pre-existing `no-shadow` warnings in `nodes.test.ts`, none in a file this task touches), `pnpm exec oxfmt --check .` clean over 139 files, `pnpm knip` exit 0. `DEFAULT_ENV` (`plugin-commands.ts:51`) and `FORWARDED_FLAGS` (`:81-90`) are named constants; no `null` for a domain value; no new external interaction outside the existing `fs`/`loader` ports. Changeset present.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewer dispatches a multi-word action and breaks laziness (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- cli` and observe `blogwright fake secret status --yes` reaching `run()` with `yes` true, and observe the laziness test fail when `discover` is hoisted above the built-in switch.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` - 19 passed, names recorded above. `blogwright fake secret status --identifier alice.example --yes` reaches `run()` with `args = ['--identifier','alice.example','--yes']`; because the SPI's `run` takes `args: string[]`, "`yes` true" arrives as the rendered `--yes` token, which is the faithful equivalent under `PluginCommand.run(ctx, args: string[])`. Hoisting the fall-through above the `KNOWN_COMMANDS` test fails the laziness test (`expected 3 to be +0`); reverted and re-run green (19/19, 27/27). Three further mutations confirm the load-bearing tests fire: first-match instead of longest-match → 3 failures; `env = DEFAULT_ENV` always → 6 failures, one of them reproducing the original defect message verbatim (`no config found for environment "production"`); reinstating a provisional pre-discovery `makeContext` → exactly 1 failure, the staging-only-config regression test, which is therefore the specific pin on the returned-for-rework defect.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:114` dispatches `blogwright pds sync` through `runPds` → the `command === 'pds'` branch (now `:133`) still sits ahead of the `KNOWN_COMMANDS` test and wins over generic dispatch; both task-07 pds pins pass unchanged : ☑ PRESERVED
- `packages/cli/src/cli.ts:117-121` previously produced `unknown command: x` → replaced by the unknown-plugin message; the task-07 pin was UPDATED in place (`cli.test.ts:161-191`), not deleted, and is as strict as what it replaced: both channels are asserted with `toEqual` (`errors` = the exact new message, `writes` = `[]`). Dropping the USAGE print is correct and forward-consistent: task 11's pointers state `:119` is deliberately absent from the print sites it wires and "is not to be re-added" : ☑ PRESERVED
- `packages/cli/src/bin.ts:9` invokes `main` for every real run → updated to the 4-argument form (`bin.ts:14`) with `makeDiscoveryPorts` wired to `createNodeFileSystem`/`createNodeModuleLoader`; every one of the 19 `main` call sites in `cli.test.ts` is updated; `blogwright deploy` still reaches `commands.deploy` with no discovery, pinned by the laziness test : ☑ PRESERVED

## Residue

Task 07's pin was updated rather than deleted, as required. The `args` shape handed to `run` is the flattened `string[]` the SPI declares, which O2's Residue explicitly permits. `blogwright plugin list` is referenced by the unknown-plugin message and does not exist until task 17, as expected - but see Finding 1 below: adding `plugin` to `KNOWN_COMMANDS` (required by step 2) with no `case 'plugin'` in the switch means `blogwright plugin list` now builds an `OpsContext` for the environment `list` before failing, which is a worse interim message than the one it replaces. Task 17 closes it.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied against collected evidence - six CI gates green, 27 dispatch/adaptation tests passing, and five mutations confirming that longest-match, environment resolution, env-positional consumption, flag forwarding and laziness are each pinned by a test that fails when broken - with one recorded deviation (the DoD's "return value becomes the exit code" is unimplementable against the merged `run(): Promise<void>` SPI and is discharged by refusal codes plus throw-propagation) and one transient interim wart on `blogwright plugin list` that task 17 closes.
