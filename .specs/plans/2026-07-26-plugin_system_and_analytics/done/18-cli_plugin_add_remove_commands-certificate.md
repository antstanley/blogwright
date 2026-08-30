# Done Certificate - Task 18: Add `blogwright plugin add` and `blogwright plugin remove`

**Task:** [18-cli_plugin_add_remove_commands.md](18-cli_plugin_add_remove_commands.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 18. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 18) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright plugin add <name>` and `blogwright plugin remove <name>` install and uninstall plugin packages in the consuming repo through the `PackageManager` port, resolving short names to `blogwright-*` and pinning the installed version to the running CLI's own - with `remove` asking whether the plugin's teardown should run first (settled 2026-07-27), and refusing in sessions that cannot ask.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `blogwright plugin list` (task 17), the port wiring at `packages/cli/src/context.ts:111-116`, or the ban on `node:child_process` outside adapters enforced by `.oxlintrc.json`.

## Validation environment

Workspace `/Users/ant/code/blogwright-task-18` (jj, parent `ukkpuprq` = build 38/62). Changeset:
8 files (`.changeset/plugin-add-remove-commands.md` added; `bin.ts`, `cli.ts`, `cli.test.ts`,
`context.ts`, `context.test.ts`, `plugin-commands.ts`, `plugin-commands.test.ts` modified).
Control before every mutation: `pnpm --filter blogwright exec vitest run` → **346 passed (22 files)**;
`plugin-commands` alone → **62 passed**. Every mutation below was applied by me, run, and reverted;
after the sweep `jj diff --git` was compared byte-for-byte against the pre-sweep capture -
**identical** - and all six gates were re-run green on the restored tree.

## Obligations

- **O1 - Name resolution, three cases.**
  - *Claim:* `analytics` → `blogwright-analytics`; a name containing `/` is literal; a name already starting with `blogwright-` is literal.
  - *Evidence collected:* `plugin-commands.test.ts:1731/1755/1771` assert the full spec string handed to the recording fake - `blogwright-analytics@9.9.9-test`, `@scope/thing@9.9.9-test` (the `/` case uses the scoped example the DoD names), `blogwright-metrics@9.9.9-test`. All three pass.
  - *Checks:* `resolvePluginPackage` (`plugin-commands.ts:936`) is a one-expression pure function - no port, no I/O, no throw. Mutations: **M8** (drop the `/` branch) → 1 failed, the scoped case; **M7** (widen `PACKAGE_NAME_PATTERN` to admit `@` in the name body) → 1 failed, the refusal case. Both reverted.
  - *Status:* ☑ SATISFIED

- **O2 - The pinned version comes from the composition root.**
  - *Claim:* the requested version is the running CLI's own, sourced at the composition root, and the test asserts the exact spec string.
  - *Evidence collected:* `cliVersion()` lives at `context.ts:139`, reading `join(cliPackageDir(), 'package.json')` with `node:fs/promises`; `cli.ts:13` imports it and `cli.ts:406` passes it as data into `PluginNamespaceDeps`. `plugin-commands.test.ts:1787` reads `packages/cli/package.json` off disk, asserts `await cliVersion()` equals the declared value, then drives `main(['plugin','add','analytics'])` and asserts the fake recorded `` `blogwright-analytics@${declared}` `` - the version (`0.3.3`) is never written in the test.
  - *Checks:* `plugin-commands.ts` contains no `node:fs`, no `readFile`, no `import.meta.url`; its only `'package.json'` reference (`:989`) is the *consuming repo's* manifest through the `FileSystem` port. The placement is not merely conventional - **M19** (move `import { readFile } from 'node:fs/promises'` into `plugin-commands.ts`) → `oxlint` errors `no-restricted-imports` at `plugin-commands.ts:118`; `.oxlintrc.json:79` exempts `packages/cli/src/context.ts` and nothing else in the CLI outside `adapters/`. Mutations: **M4** (pin `@latest` instead of `@${cliVersion}`) → 4 add cases failed; **M3** (drop `exact: true`) → 4 add cases failed. The two halves of the pin are separately pinned. Both reverted.
  - *Status:* ☑ SATISFIED

- **O3 - Already installed is a no-op, and no test touches a process or the network.**
  - *Claim:* installing an already-installed plugin reports that, exits 0, and never calls the package manager.
  - *Evidence collected:* `plugin-commands.test.ts:1823` seeds `consumerDeps: { 'blogwright-analytics': '0.3.0' }`, asserts exit 0, `packages.calls` empty, `errors` empty, and the exact line `blogwright-analytics is already installed - nothing to do`. It leaves `cliVersion` at `namespaceDeps()`'s throwing default, so the path is proven not even to resolve a version. `plugin-commands.test.ts` has no `child_process`, `execFile`, `spawn` or `fetch` (grep: 0 hits outside a comment at `:1697`).
  - *Checks:* `isDeclaredDependency` (`plugin-commands.ts:984`) reads the consuming repo's `package.json` through the `FileSystem` port (there is no `ctx` on this path by design - see O4's dispatch note) and uses `Object.hasOwn`, so a dependency named `constructor` cannot false-positive. Mutations: **M14** (delete the early return) → 1 failed; **M23** (resolve the version *before* the manifest check, preserving the return) → 1 failed - the ordering is pinned, not just the outcome. Both reverted.
  - *Status:* ☑ SATISFIED

- **O4 - `remove` asks before it forecloses, and refuses when it cannot ask or nothing is installed.**
  - *Claim:* see the authored claim; all nine sub-behaviours.
  - *Evidence collected:* twelve `remove` cases, all passing, all asserting the recorded `PackageManager` call list rather than messages. Yes path (`:1907`): one shared `order` log across both fakes yields `['destroy', 'remove blogwright-demo']`, plus the scoped S3 trace `state/production.demo.json` get/put/delete - task 16's generic destroy really ran against the plugin's own key. `n` (`:1974`) and bare Enter (`:1996`) both yield `['remove blogwright-demo']` with the pinned untouched-notice naming `` `blogwright demo destroy` ``; the `n` case leaves `makeContext` at its throwing default. Non-interactive refusal (`:2018`): exit 1, `order` empty, `packages.calls` empty, `writes` empty, message naming both `blogwright demo destroy --yes` and `blogwright plugin remove demo --yes`. `--plain` (`:2049`) drives the refusal through `main` and pairs it with the same fixture *without* the flag, which is asked and removes - the refusal is not vacuous. `--yes` (`:2094`) runs both `interactive: true` and `false` with **no scripted answers**, and `createScriptedTerminal.question` throws when unscripted (`core/src/adapters/script-terminal.ts:52`), so an implementation that still asked would fail rather than default. No-nodes (`:2120`), failed-load (`:2148`), wrong-package (`:2167`), not-installed (`:2187`) and bad-name (`:2211`) all assert the full call list.
  - *Checks:* the plugin is loaded by `loadPluginForRemoval` (`plugin-commands.ts:1050`) - one `ports.loader.resolve` + one `load` + `validatePlugin`, never `discover`; the laziness rule is untouched. The question goes through `confirm` (`logger.ts:34`) with `{ defaultYes: false }`, guarded by an explicit `!terminal.isInteractive` refusal at `:1160` so `confirm`'s silent-default-in-CI behaviour is never reached. Mutations: **M5** (`remove(name)` instead of `remove(packageName)`) → **9 failed**, the implementer's count reproduced; **M6** (move the uninstall ahead of the teardown) → **2 failed**, both ordering cases; **M9** (`defaultYes: true`) → 4 failed; **M10** (delete the non-interactive refusal) → 2 failed; **M11** (`namespace = name` instead of `plugin?.name ?? name`) → 1 failed, the `blogwright-metrics`/`widget` case; **M16** (not-installed returns 0) → 4 failed incl. the not-installed case; **M17** (drop the trailing-positional environment) → 1 failed; **M20** (ignore `--yes`) → 1 failed; **M21** (ask even for a plugin with no nodes) → 3 failed. All reverted.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests pass, the lint/format/dead-code gates are clean, limits are named constants.
  - *Evidence collected:* from the workspace root, after the mutation sweep and the proven restore - `pnpm build` **0**, `pnpm typecheck` **0**, `pnpm test` **0** (cli 346, analytics 406, pds 117, build-agent 27, core), `pnpm lint` **0** (only pre-existing `no-shadow` warnings in `nodes.test.ts`, a file this task does not touch; no diagnostic names any of the eight changed files), `pnpm exec oxfmt --check .` **0** (172 files), `pnpm knip` **0**. `.changeset/plugin-add-remove-commands.md` declares `"blogwright": minor` and names both commands, the resolution rule, the refusals, the exact pin, the teardown question and the exit-code asymmetry.
  - *Checks:* `PLUGIN_PACKAGE_PREFIX` and `PACKAGE_NAME_PATTERN` are module constants; no magic literal reaches a call site.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: the spec string carries the real CLI version and the no-op paths record nothing.**
  - *Claim:* a reviewer can run the named command and observe all three properties.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run plugin-commands --reporter=verbose` → **62 passed**, every case named. (1) The spec string is built from `packages/cli/package.json` read at test time, not a literal - and M4 proves the production path really supplies it. (2) Both "nothing to do" paths assert `packages.calls` `toEqual([])` - `add` already-installed (`:1849`) and `remove` not-installed (`:2199`). (3) The non-interactive refusal (`:2035-2037`) asserts exit 1 with `order` and `packages.calls` both empty - and M10 proves that emptiness is the guard returning, not an inert fixture.
  - *Status:* ☑ SATISFIED

## Adjudicated decisions

- **Dispatch stays ahead of `createContext` (task 17's property).** **M1** relocated the whole `if (command === 'plugin')` block to below `const ctx = await makeContext(...)` → **3 failed**: task 17's `plugin list` pin, and both of task 18's own `main`-driven cases. Neither `add` nor `remove` reaches for a context on any path except an answered-yes teardown, which builds one at `destroyBeforeRemoval` (`plugin-commands.ts:1082`) *after* the question. Property preserved and newly reinforced.
- **The `PackageManagerFactory` seam does not leak.** `namespaceDeps()`'s four throwing defaults are live, not decorative: **M2** (make `list` call `deps.makePackages()`) → **exactly 9 list cases failed**, the count claimed. **M18** (make `--help` call `makePackages()`) → **10 failed in `cli.test.ts`**, confirming the 36 added `unreachablePackages` arguments genuinely strengthen those files rather than merely satisfying an arity change.
- **Security gate.** I probed 35 caller-controlled names through the real `runPluginNamespace` with a recording fake (temporary probe file, since deleted; tree verified pristine afterwards). Rejected, port untouched: `analytics@9.9.9` (the mid-string `@` that would smuggle a version past the pin), `blogwright-analytics@1.0.0`, `@scope/thing@2.0.0`, `./evil`, `../evil`, `~/evil`, `@scope/../../evil`, `analytics/../../evil`, `https://…tgz`, `file:../evil`, `github:owner/repo`, **`owner/repo`** (npm's GitHub shorthand), `@/evil`, `@scope/`, uppercase, leading space, and every shell metacharacter form (`;`, newline, `$( )`, backticks) - the last group moot anyway, since the adapter uses `execFile` with an argument vector and no shell. Flag-shaped inputs (`-rf`, `--force`, `--save-dev`) are prefixed to `blogwright---force` etc. and so can never arrive at `pnpm` as a flag, which is exactly what the no-leading-dash rule buys. `exact: true` reaches the adapter as `--save-exact` (pnpm/npm) or `--exact` (yarn/bun); without it all four write a `^` range.
- **Exit-code asymmetry: the reason holds.** Task 17's residue asked 18/19 not to diverge from `list`'s exit 0 *for a broken plugin in a listing*. Task 18 preserves that contract exactly - a plugin whose module fails to load is still removed at exit 0 (`:2148`). The exit 1 is on a different axis: the named package is not a dependency at all, which is the shape of `blogwright plugin remove analytcs`, and it is what this task's own Steps and DoD require ("reports that and exits non-zero"). `add`'s 0 is the spec's explicit wording. No divergence.
- **The Steps/spec conflict on the untouched-notice: the deviation is justified.** I read the spec myself. §CLI → `blogwright plugin` attaches the notice to exactly two places - "**No** uninstalls and prints that configuration and provisioned resources are untouched, naming the teardown verb", and the no-nodes/failed-load branches where "the untouched-notice still prints". The Yes branch reads "runs the plugin's generic `destroy` … and then uninstalls", with no notice. The task file's Steps line ("Either way … print that configuration and provisioned resources are untouched") contradicts both the spec and its own DoD line, which requires the notice only on the `n`/Enter path. Printing it after an answered yes would be a false statement - the resources are gone. The implementation prints a distinct, true line and `:1961` asserts the untouched-notice is absent from that run. Spec and DoD govern; the Steps line is an authoring slip.
- **`--plain` correctly has one condition.** `createNodeTerminal` sets `interactive = !plain && …` (`core/src/adapters/node-terminal.ts:40`) and `bin.ts:10` passes `values.plain` straight in, so a second `values.plain` check would be dead in production. The refusal test is paired with the same fixture minus the flag, which *is* asked and returns 0 - not vacuous.
- **The teardown verb names the declared namespace.** `namespace = plugin?.name ?? name` (`:1152`); `:2120` proves it with a fixture where package `blogwright-metrics` claims namespace `widget` and the notice says `blogwright widget destroy`. M11 kills the alternative. The fallback to the typed name applies only when the module did not load, where nothing better exists.
- **`cliVersion()`'s placement.** Correct and lint-enforced (M19). `blogwright`'s own `exports` map has no `.` entry, so the manifest is unreachable through the `ModuleLoader` port; `context.ts` is the only CLI module outside `adapters/` exempt from `no-restricted-imports`; the string crosses into `plugin-commands.ts` as data. It is read on demand, so no command that does not pin a version pays for it. `cliPackageDir()` resolves to `packages/cli` from both `src/` and `dist/` (verified against the built tree), and npm always ships `package.json`.
- **Pins verified live, not repainted.** **M12** (one word of `USAGE`: "Install" → "Installs") → **exactly 14 cases failed**, the count claimed. **M13** (drift one `PLUGIN_NAMESPACE_ACTIONS` summary) → 3 failed, across both the `plugin-commands.test.ts` and `cli.test.ts` copies of the listing. I diffed every deletion in the changeset myself: **no `expect` line was deleted anywhere**. The only test-file deletions are import lines, reformatted call sites, and the two listing pins that had to grow by two entries; `EXPECTED_USAGE` gained four lines and lost none.

## Regression check

- `packages/cli/src/plugin-commands.ts` (`plugin list`, task 17) dispatched after `add`/`remove` join the namespace → all 9 `list` cases and both unknown-input cases pass unmodified apart from the mechanical fifth argument; the only intentional change to their pinned text is the two new action rows, re-proven live by M13 : ☑ PRESERVED
- `packages/cli/src/context.ts:110` (`createContext`) constructs the ports for every command → `Ports` and its wiring are untouched; `context.ts` gains only a new exported function. `deploy`/`bootstrap`/`status` build a context with no new required option, and both laziness pins (`cli.test.ts` and `context.test.ts`, `discoveryPortsCalls === 0`) still hold - now additionally proving no package manager is constructed either : ☑ PRESERVED
- `commands.test.ts`'s exact call sequences → the file is not in the changeset and its 346-test package run is green : ☑ PRESERVED
- **Merge cleanliness.** The bookmark `plugin-system-and-analytics` is at build **40/62** (tasks 48 and 49 landed after this workspace's parent). All seven files this task modifies are **byte-identical** between `ukkpuprq` (build 38) and the bookmark head - builds 39/40 touched only `packages/analytics/src/nodes*.ts` and `.specs/` - and the new changeset file does not exist at head. Tasks 43 and 46, still in review, touch only `packages/analytics/**`, `knip.json`, `pnpm-lock.yaml` and `packages/analytics/tsconfig.json`. A plain merge is clean : ☑ PRESERVED

## Residue

- **`Ports.packages` is now orphaned.** Task 06 added `packages: PackageManager` to `Ports` (`ports.ts`) and `context.ts:219` constructs `createProcessPackageManager(fs)` for every `OpsContext`. Nothing in the repo reads `ctx.ports.packages` - grep returns only a doc comment. Task 18 was the designated consumer and rightly declined it (a member of `OpsContext` is unreachable from a command that must dispatch before `createContext`), choosing the `PackageManagerFactory` seam instead. The member is therefore permanently dead: no remaining backlog task consumes it, and task 20's only `PackageManager` obligation is a `DEVELOPMENT.md` table row, which stays correct because the *port* is genuinely used through `bin.ts`. `knip` cannot see this - the plan's own baseline flags interface/class members as its blind spot. Not a behaviour defect (the constructor closes over `fs` and does no I/O), but task 20 should either delete `Ports.packages` and `context.ts:219` or record why they stay. Task 18's `PackageManagerFactory` doc comment argues for the separate seam without saying what becomes of the member it displaces.
- **`cliVersion()`'s no-`version` throw is uncovered - accepted.** `DEVELOPMENT.md` §Hexagonal architecture states "Tests substitute at the port, not by patching modules or globals", so `vi.mock('node:fs/promises')` is barred by the repo's own rules, and the repo uses no `vi.mock`/`vi.spyOn` anywhere. Adding a test-only parameter to a composition-root function whose whole purpose is to read one fixed real path would trade a real architectural boundary for one defensive line. The branch carries an actionable message and `packages/cli/package.json` always declares a version. Ruling: acceptable as disclosed.
- **An empty name is not caught by the "needs a plugin name" branch.** `rest[1] === undefined` is the only emptiness check (`:1216`), so `blogwright plugin add ""` resolves to `blogwright-` - which `PACKAGE_NAME_PATTERN` accepts - and reaches `pnpm add blogwright-@0.3.3`, failing with the package manager's error rather than the CLI's own. Cosmetic: no path, no flag, no version smuggling; the same is true of `.`/`..`, which prefix to `blogwright-.`/`blogwright-..`. npm's 214-character name limit is likewise not enforced. Worth one extra clause (`name === undefined || name === ''`) whenever this file is next touched.
- **`plugin remove` takes the package's short name, not the namespace.** Removing `blogwright-metrics` requires `blogwright plugin remove metrics`, not `remove widget`, even though `widget` is the name the operator types for every other command that plugin answers. The test states this deliberately and the refusal names `blogwright plugin list`, whose table carries both columns, so it is recoverable. Consistent with `remove` undoing `add`; noted for task 20's docs page.
- **A failing teardown leaving the package installed is asserted only by construction.** `destroyBeforeRemoval` is awaited before `deps.makePackages().remove(...)`, so a rejection propagates and the uninstall never runs; the doc comment at `:1120` names this as the point of the ordering. No test drives a node whose `delete` throws. Outside the DoD, and M6 already pins the ordering in the success direction; a one-case addition would close it.
- Carried forward unchanged from the authored residue: the pinned version is the only compatibility mechanism in v1 (task 20's open question); `add` has no defined behaviour when no lockfile is present (the adapter's `detectManager` throws with the list of lockfiles it looked for, which reaches the operator through `bin.ts`); `add` does not offer to run the plugin's `init`. The teardown-on-yes runs for the one environment the invocation resolves - `plugin-commands.test.ts:1940` proves `remove demo preview` touches only `state/preview.demo.json` - and the pinned output claims nothing broader.
- `isRecord` now has a fifth identical copy (`context.ts:117`, joining `plugins.ts`, `plugin-commands.ts`, `test-support.ts`, `core/plugin.ts`). Task 17's residue already recorded this as a deliberate local copy; unchanged in kind.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED on evidence I collected rather than accepted - 23 of my
own mutations, each with a 346-test control and each reverted, killed every claim I sampled and
reproduced the three counts the implementer named exactly (9 `list` cases for the eager package
manager, 9 for `remove(name)`, 14 for a one-word `USAGE` edit); the deletion audit shows no
assertion was altered anywhere among the 36 mechanical call sites; the security gate rejected all
17 hostile name shapes I put to it, including npm's `owner/repo` shorthand which the implementer
did not test; task 17's before-`createContext` property is preserved and newly reinforced; all six
gates are green from the workspace root on a tree proven byte-identical to the submitted diff; and
a merge onto build 40 is clean by file-level identity. The one finding of substance -
`Ports.packages` left with no consumer once this task chose a different seam - is inherited dead
wiring with no behavioural effect, recorded for task 20's closure rather than charged against this
implementation.
