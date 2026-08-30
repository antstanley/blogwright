# Done Certificate - Task 11: Build the help output's Plugins section from discovered plugins

**Task:** [11-cli_help_plugin_sections.md](11-cli_help_plugin_sections.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 11. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 11) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** Help text is assembled at runtime - today's static base plus one section per discovered plugin - with failed loads surfaced and the no-plugins output byte-identical to today's `USAGE`.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the five sites that print help once this task runs (`packages/cli/src/cli.ts:103,171,200,256,288`), the exit codes at `:102-106`, or the task-07 byte-exact pin in `packages/cli/src/cli.test.ts`. Of the six that print help in today's tree, `:119` is already gone by this point - task 10 replaced `:117-121` with the plugin fall-through - so a validator who expects `:119` to carry the assembled text is discharging against a superseded tree. `:200` still exists (`runPds` lives until task 29) and IS wired.

## Obligations

- **O1 - `--help` runs discovery, deliberately.**
  - *Claim:* the help path triggers discovery, a test proves it, and the module comment records the exception to task 10's laziness rule with the pds-migration reason.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` - 25/25 pass, including "runs discovery, and with no plugins installed prints USAGE byte-identical to the task-07 pin, exiting 0 for --help", which asserts `discoveryPortsCalls === 1` (`cli.test.ts:238`) - a count of PORT-FACTORY calls, not merely loader calls. The module comment on `DiscoveryPortsFactory` (`cli.ts:176-202`) names four paths: (1) generic plugin dispatch, (2) `--help`/bare invocation plus every other USAGE print site, (3) `blogwright plugin list` (task 17), (4) `blogwright init` (task 14) - against `deploy`, `bootstrap`, `status` named explicitly and `rollback`, `delete`, `destroy`, `history`, `logs` and a successful `preview`/`pds` listed as paying nothing. The reason is stated at `cli.ts:197-201` (task 26 strips the static `pds` block; without help paying for discovery no commit would list all six pds actions before task 29).
  - *Checks:* resolved - `helpText` (`cli.ts:147-151`) calls `discover(repoRoot, cliPackageDir(), ports)` imported from `./plugins.js` (`cli.ts:12`). `runPlugin` (`plugin-commands.ts:265-266`) calls the identical three-argument form of the same `discover`. No second, differently-scoped reader.
  - *Mutation probe (laziness, both directions):* adding a bare `makeDiscoveryPorts()` to `case 'deploy'` - building the ports and never touching the loader - fails "never touches the ModuleLoader for deploy, status or bootstrap" with `expected 1 to be +0` at `cli.test.ts:655`. The net catches factory construction, not only loader use. Reverted.
  - *Status:* ☑ SATISFIED

- **O2 - The no-plugins output is unchanged, exit codes included.**
  - *Claim:* with nothing discovered, `blogwright --help` emits today's `USAGE` byte for byte, and `--help` still exits 0 while a bare invocation still exits 1.
  - *Evidence collected:* the task-07 pins pass with their assertions unedited. `EXPECTED_USAGE` (`cli.test.ts:41-93`) extracted from the parent revision (`@-`) and from the working copy hash to the same md5 `2828b03b136e687493133f7b28fc109e`, 3115 bytes both - byte-unchanged. The live `USAGE` constant is likewise identical to the parent's and to the pin body. `buildHelp` (`cli.ts:109-110`) returns `base` by early return when both collections are empty - no separator, heading or trailing newline.
  - *Checks:* traced `main(['--help'], …)` through `cli.ts:232-236`: the return expression `values.help || command ? 0 : 1` is textually unchanged, and both codes are asserted (`cli.test.ts:230`, `:257`). The built binary run in-repo (`node packages/cli/dist/bin.js --help`) exits 0 and emits exactly the pinned text plus the node terminal's own trailing newline.
  - *Mutation probe (byte identity):* deleting the empty-case early return fails 5 tests including both pins. Reverted.
  - *EXCEPTION recorded:* the exit-code clause holds only where discovery's preconditions hold. See D1 in Defects - outside a repo, or in a repo with no root `package.json`, `--help` now exits 1 and prints no help at all, where the parent printed the full `USAGE` and exited 0.
  - *Status:* ☑ SATISFIED for the in-repo case named by the evidence; the "exit codes … unchanged" clause is VIOLATED outside a repo (D1).

- **O3 - Plugin sections render, deterministically.**
  - *Claim:* one section per plugin is appended, showing the plugin's `description` and one line per command from `action` plus `summary`, in a deterministic order.
  - *Evidence collected:* "appends one section per discovered plugin to --help, ordered by plugin name regardless of dependency/discovery order" passes, asserting the full output against a hand-typed literal carrying both descriptions and both `action`/`summary` pairs. Re-ran the fixture with the two specs supplied in the reverse array order: 25/25 still pass, output byte-identical. Reverted.
  - *Fixture discrimination verified:* `blogwright-a-pkg` declares plugin `zzz` and `blogwright-z-pkg` declares plugin `aaa`, so `pluginDependencyNames`' sort (`plugins.ts:142`) makes discovery yield `[zzz, aaa]` - the reverse of name order. Removing the sort at `cli.ts:118-120` fails exactly this test and nothing else. The ordering is not passing incidentally.
  - *Status:* ☑ SATISFIED

- **O4 - A failed load does not break help.**
  - *Claim:* when one plugin fails to load, the remaining sections still render and the failure is surfaced without a stack trace.
  - *Evidence collected:* "leaves a working plugin's section rendered when another plugin fails to load, surfacing the failure with no stack trace" passes. The assertion is a full-output equality (`cli.test.ts:327-337`) that contains the good plugin's complete section AND the single failure line `  blogwright-broken: plugin package "blogwright-broken"'s Plugin.name is required …`. Exact equality is strictly stronger than the `no "at " frame` / `no trace-carrying "Error:" prefix` assertions this obligation names: no stack frame can be present in a string asserted equal to a literal that has none. `renderPluginFailure` (`cli.ts:91-93`) reads only `packageName` and `reason`, never `.stack`. Exit code stays 0.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the repo root - `pnpm build` clean; `pnpm test` clean (core 123 + 1 skipped, build-agent 27, pds 96, cli 240/22 files); `pnpm lint` exit 0 (only pre-existing `no-shadow` warnings in `src/nodes.test.ts`, untouched by this task - zero findings in `cli.ts` or `cli.test.ts`); `pnpm exec oxfmt --check .` "All matched files use the correct format" over 139 files; `pnpm knip` clean.
  - *Gap recorded:* no changeset was added for this task. `.changeset/` holds only task 10's `generic-plugin-dispatch.md`, whose text covers dispatch and does not mention help gaining plugin sections. For every current user the in-repo `--help` output is byte-identical, so the user-facing surface is arguably nil today - but D1 below IS user-observable now, which argues a changeset is owed.
  - *Status:* ☑ SATISFIED (gates clean; the changeset gap is recorded, not scored as a failure)

- **O6 - Reviewer checks the pin, the ordering and the broken plugin (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- cli` and observe the no-plugins case matching the task-07 byte-exact pin, two fake plugins rendering in name order regardless of fixture order, and a plugin that throws on load leaving the other section intact.
  - *Evidence collected:* ran the task's own `Reviewable:` line as written - `pnpm --filter blogwright exec vitest run cli --reporter=verbose` - 25 passed, 0 failed, 746ms. Passing names recorded under O1/O3/O4. The two plugins were swapped in the ordering fixture and the suite re-run: identical output, 25/25. The failed-load test's assertions were read and confirmed to assert the surviving section present alongside the named failure in one exact-string comparison.
  - *Assertions are hand-written literals:* `EXPECTED_USAGE` (`cli.test.ts:41`) and `EXPECTED_HELP_WITH_WIDGET` (`cli.test.ts:159-164`) are hand-typed; the ordering and failed-load expectations are inline literals. Nothing in the test file calls `buildHelp`, `renderPluginSection` or `renderPluginFailure` - none of the three is exported. The pitfall caught twice earlier in this build does not recur here.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:117-121` no longer prints help at all: task 10 replaced that branch with the plugin fall-through, so an unrecognised first positional reaches plugin dispatch and reports an unknown plugin naming `blogwright plugin list` → expect NO `USAGE` print site there and the exit code still 1 : ☑ PRESERVED. The fall-through (now `cli.ts:247-262`) contains no help print; the deleted branch was NOT re-added. `grep` finds exactly five `logger.info(await helpText(...))` sites and zero bare `logger.info(USAGE)`. The test at `cli.test.ts:362-390` asserts `terminal.writes` is `[]` and the code is 1.
- `packages/cli/src/cli.ts:200` prints help after `unknown pds action: …`, with the hardcoded `pds` branch at `:114` still live until task 29 → expect the assembled text and exit code 1 : ☑ PRESERVED. Now `cli.ts:347`, wired, with an in-code comment recording why (`cli.ts:343-346`). Covered by a dedicated test asserting `EXPECTED_HELP_WITH_WIDGET` for `blogwright pds bogus`; unwiring it back to the plain constant fails exactly that test.
- `packages/cli/src/cli.ts:256` and `:288` print help after an unknown `preview` action → expect the assembled text and exit code 1 : ☑ PRESERVED. Now `cli.ts:405` (the reachable guard) and `cli.ts:441` (the switch `default:`). The guard is covered by a test asserting `EXPECTED_HELP_WITH_WIDGET`; unwiring it fails that test. `:441` is provably unreachable - the guard at `:403` returns for every action outside `PREVIEW_ACTIONS` - so no test can reach it; it is wired anyway and the unreachability is documented at `cli.ts:436-439`. Per-site coverage was confirmed by mutation: unwiring each of the four reachable sites in turn fails a distinct test (help → 4 tests, switch default → 1, runPds → 1, runPreview → 1).
- `packages/cli/src/bin.ts:9` invokes `main` for a real `blogwright --help` → expect the built CLI to print today's text plus any installed plugin sections, verified by running `node packages/cli/dist/bin.js --help` after `pnpm build` : ☑ PRESERVED in-repo / ☒ REGRESSION outside a repo. In-repo: exit 0, output equal to the pin plus the terminal's own newline, no plugin sections (correct - `blogwright-pds` carries no `blogwright.plugin` manifest field until task 29). Outside a repo: exit 1 and no help at all. See D1.
- *(added)* `packages/cli/src/cli.ts:283-315` - `blogwright plugin` falls to the switch `default:` : ☑ PRESERVED, now rendering the assembled text (test at `cli.test.ts:340-360`). Note it still builds an `OpsContext` before reaching `default:`, which is pre-existing task-10 behaviour, not a change here.

## Defects

- **D1 (CONCERNS) - `blogwright --help` no longer degrades when discovery cannot start.** `packages/cli/src/cli.ts:147-151`. `helpText` calls `findRepoRoot(ports.fs)` and then `discover`, and neither is guarded. `findRepoRoot` throws when no `.git`/`.jj` is found above `cwd` (`packages/core/src/repo-root.ts:17`), and `discover`'s `readDependencyManifest` throws for a missing or unparseable root `package.json` (`packages/cli/src/plugins.ts:110-114`) - `plugins.ts`'s own module comment names these two as the preconditions it deliberately throws for. `bin.ts:18-22` catches, prints the message, and sets exit code 1.
  - *Failure scenario, reproduced against the built binary:* `cd /tmp/empty && npx blogwright --help` prints `✗ could not find the repo root (no .git or .jj above /tmp/empty)` and exits 1. In a repo with `.git` but no root `package.json`, `blogwright --help` prints `✗ no package.json found at …/package.json for the consuming repo …` and exits 1. A bare invocation in either place behaves the same. The parent revision printed the full `USAGE` and exited 0 in both - its help branch was a plain `logger.info(USAGE)` with no filesystem access at all (`@-`'s `cli.ts:122`).
  - *Why this is attributable to task 11:* the task mandates that `--help` run discovery, but nothing requires the print to be sacrificed when discovery cannot start. A `try`/`catch` around the discovery pair returning `base` - optionally with a one-line note - satisfies both the mandate and the DoD's own "one broken plugin cannot break `blogwright --help`" in its natural, one-level-up reading. `--help` is the one command that should not require a working environment, and it is the command this task is named for.
  - *Mitigating context:* the change spec's Assumptions section states "The consuming repo has a `package.json` at the root `findRepoRoot` resolves. Discovery reads it through the `FileSystem` port and reports a clear error when absent." The message IS clear, so the outcome is arguably spec-sanctioned for the consuming-repo case. It does not address running `--help` outside a repo, and it is not what the task's own DoD says about exit codes.
  - *No test covers either direction of this path*, so a later fix has no net and a later regression has no alarm.

- **D2 (minor, recorded not scored) - no changeset.** The plan baseline asks for one when a change is user-facing. D1 is user-observable today; the help-gains-plugin-sections behaviour becomes user-observable at task 26/29.

- **D3 (cosmetic) - stale doc comment.** `packages/cli/src/cli.test.ts:126-131` says `unreachableDiscoveryPorts` serves "`deploy`, `bootstrap`, `status` and a WELL-FORMED `pds`/`preview` dispatch", but after this change the constant has exactly one remaining use site (`cli.test.ts:785`, the `status` dispatch test); the laziness test now uses its own counting factory, and no well-formed `pds`/`preview` test uses it. Harmless, but the comment over-describes its own scope.

## Residue

Notes for the validator: this task makes the error paths pay for discovery too, because they share the help text; whether that is acceptable is not an obligation here, but a measurable slowdown on `unknown command` is worth recording. **Measured:** no perceptible slowdown - the whole `cli` suite runs in 746ms and each help-path test in 0-3ms; discovery is two `package.json` reads plus one resolve/load per `blogwright-*` dependency, and this repo's consumer manifest has none. The exact section heading wording (a `Plugins:` banner versus bare per-plugin blocks) is an implementation choice constrained only by O2's byte-identity requirement for the empty case; the implementation chose a `Plugins:` banner plus a separate `Plugins that failed to load:` block, both suppressed entirely when their collection is empty. Whether `--help` should suppress discovery under `--plain` is not specified and is not an obligation; the implementation does not suppress it. One further note for task 26: `discovered.failures` is rendered in candidate order (dependency-name sorted) and is NOT explicitly sorted the way `plugins` is - deterministic in practice, but not pinned by a test.

## Conclusion

VERDICT: ☑ pending correctness fix (all six obligations discharged with evidence; O2's exit-code clause carries a recorded exception - D1)
CONFIDENCE: ☑ high
SUMMARY: Every obligation's named evidence was collected and every named check run - the task-07 pin is byte-identical to the parent (md5-verified), all five help print sites are wired with per-site mutation coverage for the four reachable ones, `:119` was not re-added, the ordering fixture genuinely discriminates (removing the sort fails exactly that test), the laziness net counts port-factory calls, and all five repo gates are clean - so the task is complete on its own terms and blocked only by D1, a demonstrated regression in which `blogwright --help` outside a repo now exits 1 with an error instead of printing help and exiting 0.
