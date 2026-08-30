# Done Certificate - Task 11: Build the help output's Plugins section from discovered plugins

**Task:** [11-cli_help_plugin_sections.md](11-cli_help_plugin_sections.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 11. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.
>
> This is a RE-GATE after a CONCERNS verdict (D1 in the superseded certificate). Every
> obligation below was re-discharged from scratch against the current tree; the previous
> verdict was not carried forward as evidence.

## Definition

DONE(Task 11) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** Help text is assembled at runtime - today's static base plus one section per discovered plugin - with failed loads surfaced and the no-plugins output byte-identical to today's `USAGE`.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the five sites that print help once this task runs (`packages/cli/src/cli.ts:103,171,200,256,288` in pre-task-10 numbering), the exit codes at `:102-106`, or the task-07 byte-exact pin in `packages/cli/src/cli.test.ts`. `:119` is already gone by this point - task 10 replaced `:117-121` with the plugin fall-through - and must NOT be re-added. `:200` still exists (`runPds` lives until task 29) and IS wired.
- **P4 - Workspace.** Diff read at `/Users/ant/code/blogwright-task-11`, working copy `klqpmtkt 029eacf4` over parent `zvlzqmqm c33c646a`. Three files: `.changeset/cli-help-plugin-sections.md` (added), `packages/cli/src/cli.ts`, `packages/cli/src/cli.test.ts`. All mutation probes below were reverted and the workspace verified byte-restored (`md5 packages/cli/src/cli.ts` = `4d0fd0af5f37634928ab46b0156f41c5`, `packages/core/src/repo-root.ts` = `57dd79e6b0fdd103acecdab396413469`, `jj status` unchanged).

## Obligations

- **O1 - `--help` runs discovery, deliberately.**
  - *Claim:* the help path triggers discovery, a test proves it, and the module comment records the exception to task 10's laziness rule with the pds-migration reason.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` - **30/30 pass**. "runs discovery, and with no plugins installed prints USAGE byte-identical to the task-07 pin, exiting 0 for --help" asserts `discoveryPortsCalls === 1` - a count of PORT-FACTORY calls, not merely loader calls; the bare-invocation twin asserts the same. `helpText` (`cli.ts:195-209`) calls `discover(repoRoot, cliPackageDir(), ports)` - the identical three-argument form `runPlugin` uses (`plugin-commands.ts:265-266`). The `DiscoveryPortsFactory` doc comment (`cli.ts:236-261`) enumerates the four paying paths (dispatch; `--help`/bare plus every other USAGE print site; `plugin list` task 17; `init` task 14) against `deploy`, `bootstrap`, `status` named explicitly and `rollback`, `delete`, `destroy`, `history`, `logs` and a successful `preview`/`pds` listed as paying nothing, with the task-26 reason stated.
  - *Checks:* `grep` finds exactly five `logger.info(await helpText(makeDiscoveryPorts()))` sites (`cli.ts:293,372,407,465,501`) and **zero** bare `logger.info(USAGE)`.
  - *Mutation probe (laziness):* inserting `makeDiscoveryPorts();` into `case 'deploy':` fails exactly one test - "never touches the ModuleLoader for deploy, status or bootstrap" (1 failed / 29 passed). The net catches factory construction, not only loader use. Reverted.
  - *Status:* ☑ SATISFIED

- **O2 - The no-plugins output is unchanged, exit codes included.**
  - *Claim:* with nothing discovered, `blogwright --help` emits today's `USAGE` byte for byte, and `--help` still exits 0 while a bare invocation still exits 1 - **including where discovery's own preconditions do not hold.**
  - *Evidence collected (byte identity):* `EXPECTED_USAGE` extracted from `@-` and from the working copy: `diff` empty, 53 lines both - the task-07 pin is **unchanged**. The live `USAGE` constant likewise: `md5` `8bd21d3a74ca5236c7344e5525ce2e66` on both revisions, 3106 bytes. `buildHelp` (`cli.ts:113`) returns `base` by early return when both collections are empty - no separator, heading or trailing newline.
  - *Evidence collected (built binary, real temp directories, not the harness):* after `pnpm -r build`, `node packages/cli/dist/bin.js` run with cwd set to each of four freshly created directories under `/private/tmp/bw-verify-11` (verified: no `.git`/`.jj` anywhere above `/private/tmp`):
    - no repo at all, `--help` → **exit 0**, full 53-line USAGE on stdout, stderr empty.
    - no repo at all, bare → **exit 1**, same full USAGE.
    - `.git` present, no root `package.json`, `--help` → **exit 0**, full USAGE, stderr empty.
    - `.git` present, no root `package.json`, bare → **exit 1**, full USAGE.
    - healthy repo, `--help` → **exit 0**; output compared programmatically against the pinned literal: `real === pinned + "\n"` is **true** (3089 vs 3088 bytes - the node terminal's own newline, the same delta the parent produced).
  - *Checks:* the return expression `values.help || command ? 0 : 1` (`cli.ts:295`) is textually unchanged from the parent. `helpText` guards each precondition individually and falls back to `USAGE` (`cli.ts:196-208`).
  - *Mutation probes (both guards fire, distinctly):*
    - deleting `if (isNoRepoRootError(err)) return USAGE;` → **2 failures**, exactly the two "outside any discoverable repo" tests. Reverted.
    - deleting `if (isMissingPackageJsonError(err)) return USAGE;` → **2 failures**, exactly the two "repo with no root package.json" tests. Reverted.
    - replacing both narrowed guards with a blanket `return USAGE;` → **1 failure**, exactly the malformed-`package.json` test. The narrowness is pinned in both directions. Reverted.
  - *Status:* ☑ SATISFIED (the exception recorded against this obligation in the superseded certificate is discharged - the fix is present, executed against the built binary, and mutation-covered on both guards)

- **O3 - Plugin sections render, deterministically.**
  - *Claim:* one section per plugin is appended, showing the plugin's `description` and one line per command from `action` plus `summary`, in a deterministic order.
  - *Evidence collected:* "appends one section per discovered plugin to --help, ordered by plugin name regardless of dependency/discovery order" passes against a hand-typed full-output literal. The fixture genuinely discriminates: `blogwright-a-pkg` declares plugin `zzz` and `blogwright-z-pkg` declares `aaa`, so `pluginDependencyNames`' sort (`plugins.ts:142`) yields discovery order `[zzz, aaa]` - the reverse of the asserted name order. `buildHelp` sorts by `Plugin.name` (`cli.ts:120-122`).
  - *Evidence collected (end-to-end, real Node adapters):* a temp repo at `/private/tmp/bw-verify-11/repo-plugins` with `.git`, a root `package.json` declaring `blogwright-widget`, and a real `node_modules/blogwright-widget` (`{"blogwright":{"plugin":"widget"}}`, ESM default export with a single-word and a multi-word action). `node packages/cli/dist/bin.js --help` → exit 0 and the appended block rendered through `createNodeFileSystem`/`createNodeModuleLoader`:
    ```
    Plugins:

      widget - manage widgets
        sync - sync widgets
        secret status - show widget secret metadata
    ```
  - *Status:* ☑ SATISFIED

- **O4 - A failed load does not break help.**
  - *Claim:* when one plugin fails to load, the remaining sections still render and the failure is surfaced without a stack trace.
  - *Evidence collected:* "leaves a working plugin's section rendered when another plugin fails to load, surfacing the failure with no stack trace" passes, asserting full-output equality containing the good plugin's complete section AND the single failure line. Exact equality is strictly stronger than a no-`at `-frame assertion. `renderPluginFailure` (`cli.ts:95-97`) reads only `packageName` and `reason`, never `.stack`.
  - *Evidence collected (end-to-end):* the same temp repo above, with a second real package `blogwright-broken` whose ESM default export is `{}`. `--help` → **exit 0**, the widget section intact, plus `Plugins that failed to load:` / `  blogwright-broken: plugin package "blogwright-broken"'s Plugin.name is required - the CLI namespace it claims, e.g. "analytics"`. `grep -n "    at "` over the captured stdout: **no stack frames**.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* the six CI gates are green in order, tests cover positive and negative space, and a changeset ships for the user-facing change.
  - *Evidence collected:* from the repo root, in `.github/workflows/ci.yml` order - `pnpm -r build` clean; `pnpm typecheck` clean (5 projects, all Done); `pnpm test` clean (**core 123 + 1 skipped, build-agent 27, pds 96, cli 245 across 22 files**); `pnpm lint` exit 0 (only pre-existing `no-shadow` warnings in `src/nodes.test.ts`, untouched here - zero findings in `cli.ts`/`cli.test.ts`); `pnpm exec oxfmt --check .` "All matched files use the correct format" over 139 files; `pnpm knip` exit 0.
  - *Changeset:* `.changeset/cli-help-plugin-sections.md` present, `"blogwright": minor` (correct - `.changeset/config.json` fixes the three publishable packages together, so a single-package bump moves all three; only the CLI changed here). Its body describes user-facing behaviour: the per-plugin sections, the named-and-reasoned failure line with no stack trace, the enriched help at the three error print sites, the unchanged no-plugins output, and the guarded no-repo/no-`package.json` behaviour. The superseded certificate's D2 is discharged.
  - *Negative space:* three tests exist purely for it - two no-repo, two no-`package.json`, and one asserting a malformed root `package.json` **rejects** rather than falling back.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewer checks the pin, the ordering and the broken plugin (Reviewable).**
  - *Claim:* running `pnpm --filter blogwright exec vitest run cli --reporter=verbose` shows the no-plugins case matching the task-07 byte-exact pin, two fake plugins rendering in name order regardless of fixture order, and a plugin that fails to load leaving the other section intact.
  - *Evidence collected:* ran the `Reviewable:` line **as written** - **30 passed, 0 failed, 765ms**. The three named observations are the tests recorded under O2, O3 and O4 respectively; the ordering fixture's discrimination was confirmed by construction (O3) rather than by trusting the assertion.
  - *Assertions are hand-written literals:* `EXPECTED_USAGE` and `EXPECTED_HELP_WITH_WIDGET` are hand-typed; the ordering and failed-load expectations are inline literals. Nothing in the test file calls `buildHelp`, `renderPluginSection` or `renderPluginFailure` - none of the three is exported, so no assertion can pass by construction.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts` old `:117-121` (the `:119` print site) → expect NO help print at the plugin fall-through and the exit code still 1 : ☑ PRESERVED. The fall-through (`cli.ts:307-320`) contains no help print and the deleted branch was NOT re-added; `grep` confirms exactly five `helpText` sites and zero bare `logger.info(USAGE)`. The test "reports an unrecognised first positional as neither a built-in nor an installed plugin" passes.
- `packages/cli/src/cli.ts:200` (`runPds` unknown action) → expect the assembled text and exit code 1 : ☑ PRESERVED. Now `cli.ts:407`, wired, with the task-26/29 reason recorded in code (`cli.ts:403-406`), covered by a dedicated `EXPECTED_HELP_WITH_WIDGET` test.
- `packages/cli/src/cli.ts:256`/`:288` (`runPreview`) → ☑ PRESERVED. Now `cli.ts:465` (the reachable guard, covered by an `EXPECTED_HELP_WITH_WIDGET` test) and `cli.ts:501` (the switch `default:`, provably unreachable past the guard, wired anyway with the unreachability documented at `cli.ts:496-500`).
- `packages/cli/src/cli.ts` switch `default:` (`blogwright plugin`, reserved but not yet dispatched) → ☑ PRESERVED, now rendering the assembled text (dedicated test, exit 1, error line unchanged).
- `packages/cli/src/bin.ts:9` invokes `main` for a real `blogwright --help` → ☑ PRESERVED **in every case checked**, including the two that regressed before: outside a repo and in a repo with no root `package.json`, the built binary prints the full USAGE and exits 0 (`--help`) / 1 (bare). The superseded certificate's D1 is discharged by execution, not by inspection.
- `blogwright-core`'s `findRepoRoot` and `packages/cli/src/plugins.ts`'s `discover` are now read by a second caller (`helpText`) → expect unexpected failures to keep propagating : ☑ PRESERVED. Verified by execution through a chdir harness over the **built** `dist/` modules (Node itself refuses to start with an unparseable `package.json` in cwd, so the built `bin.js` cannot be used for this case): an unparseable root `package.json` rejects with `failed to parse …/package.json as JSON for the consuming repo: …` (cause `SyntaxError`), and a non-object (`[]`) root `package.json` rejects with `… must contain a JSON object, not []`. Neither prints help. `bin.ts:18-22` turns either into one `✗ <message>` line and exit 1.
- Guard scope audited by reading `plugins.ts` end to end: `loadCandidate` wraps every candidate-level failure - including a `FileNotFoundError` from reading a candidate's manifest - inside its own `catch` and returns a `failures` entry, so the only errors escaping `discover` are `readDependencyManifest`'s three shapes. Exactly one of the three carries a `FileNotFoundError` as `cause`. `isMissingPackageJsonError` therefore cannot swallow a candidate-level or a malformed-manifest failure.

## Defects

None blocking. Two non-blocking observations, neither a correctness failure:

- **N1 (design nit, not a defect) - `isNoRepoRootError` identifies its error by message prefix, across a package boundary.** `packages/cli/src/cli.ts:145-147` matches `err.message.startsWith('could not find the repo root')` against a string literal defined in `packages/core/src/repo-root.ts:17`. Its sibling `isMissingPackageJsonError` is structural (`err.cause instanceof FileNotFoundError`), so the pair is inconsistent.
  - *The rot-quietly hypothesis was tested and does NOT hold here.* Mutation probe: rewording the throw to `` `no repo root found (no .git or .jj above ${start})` `` - a reword deliberately chosen to keep core's own loose pin `rejects.toThrow(/repo root.*\/repo\/src/)` (`packages/core/src/repo-root.test.ts:25`) **passing** - leaves `pnpm --filter blogwright-core exec vitest run repo-root` at 4/4 green but **fails 2 CLI tests** ("falls back to plain USAGE … outside any discoverable repo", both directions), and reddens `pnpm -r test` (`Tests 2 failed | 243 passed`). Reverted. The coupling is loud, not silent: `vitest.config.ts` aliases `blogwright-core` to core's **source**, and the two fallback tests drive `main` end-to-end over the real `findRepoRoot`, so any reword is caught in the same CI run.
  - *Residual risk:* the alarm fires in a different package from the edit, so the person rewording sees `cli.test.ts` fail rather than a pin next to the code they changed - a confusing signal, not a missing one. It would become genuinely silent only if `blogwright-core` were ever consumed as a published version rather than `workspace:*`.
  - *What I would do:* make it structural, and the change is smaller than it looks. `findRepoRoot`'s throw is narrowed by **no** call site today - `init.ts:85` uses a blanket `.catch(() => process.cwd())`, `context.ts:149`, `commands.ts:70,167`, `plugin-commands.ts:265`, `process-package-manager.ts:141` and pds's four sites all let it propagate, and the only pins on the text are core's loose regex and a docs troubleshooting heading. So exporting `class RepoRootNotFoundError extends Error` from core and throwing it is strictly additive: every existing `catch`, `instanceof Error` and `rejects.toThrow(/repo root/)` keeps working unchanged, and `cli.ts` narrows on the class. That is a one-line-per-side change with no behavioural blast radius. I am recording it as a follow-up rather than blocking, because the current guard is correct, is covered by four tests, and its failure mode is demonstrably caught by CI.
- **N2 (informational) - `--help` now dynamically imports every installed `blogwright-*` plugin module.** Module-level side effects in a third-party plugin now run on `blogwright --help`, where before they ran only on dispatch. This is the design the task mandates (§CLI → Plugin dispatch requires help to reflect what is installed, and task 26 makes it load-bearing for pds), and task 10 already established the loading path; recorded so it is not rediscovered as a surprise.

## Residue

Notes for later tasks. `discovered.failures` is rendered in candidate order (dependency-name sorted, consumer half before bundled half) and is NOT explicitly sorted the way `plugins` is - deterministic in practice, but not pinned by a test; task 17 (`blogwright plugin list`, which must name failed loads) is the natural place to pin it. `helpText` is called fresh at each of the five print sites and is never memoised - correct today because at most one fires per invocation, but a future path that printed help twice would discover twice. `isMissingPackageJsonError` deliberately also tolerates the **CLI's own** `package.json` being missing, so a corrupt CLI install prints plain help rather than erroring; that is the right trade for `--help` and is documented at `cli.ts:150-160`, but it is a second precondition hidden behind one predicate. Error paths now pay for discovery because they share the help text: measured cost is nil here (whole `cli` suite 765ms; discovery is two `package.json` reads plus one resolve/load per `blogwright-*` dependency, and this repo's consumer manifest has none). Whether `--plain` should suppress discovery is unspecified and unimplemented.

## Conclusion

VERDICT: ☑ DONE (all six obligations SATISFIED with collected evidence; no obligation carries an exception)
CONFIDENCE: ☑ high
SUMMARY: Re-discharged from scratch - the task-07 `USAGE` pin is byte-identical to the parent revision (`diff` empty, constant md5 `8bd21d3a74ca5236c7344e5525ce2e66` on both), both no-repo regressions are fixed and verified against the **built binary** in real temp directories (full USAGE, exit 0 for `--help` and 1 for bare, in both a directory with no repo and a repo with no root `package.json`), a malformed or non-object root `package.json` still **rejects** rather than printing help, each guard is individually mutation-covered by a distinct test and a blanket-catch mutation kills the narrowness test, the laziness net still catches port-factory construction on `deploy`, and all six repo gates are green - with the string-matched `findRepoRoot` guard recorded as a non-blocking design nit whose rot-quietly failure mode was tested and shown to be caught by the existing suite.
