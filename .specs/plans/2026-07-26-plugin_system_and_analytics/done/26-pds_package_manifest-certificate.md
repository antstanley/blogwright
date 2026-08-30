# Done Certificate - Task 26: Declare the plugin manifest field in packages/pds/package.json

**Task:** [26-pds_package_manifest.md](26-pds_package_manifest.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 26. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

Discharged against workspace `/Users/ant/code/blogwright-task-26` (`@ = ymvkxvyw 664362bf`, parent
`upprttuo 38f22dc9` = build 46). All mutation work was done in that workspace and reverted; the
working-copy `jj diff --git` is byte-identical before and after
(SHA-256 `c008453945fb5afce7bbbf063cdf8e66916b3332d27c115f503596b2e8a9726c`, 486 lines, both times).

## Definition

DONE(Task 26) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright-pds` is discoverable as the `pds` plugin from a consuming repo depending only on `blogwright`, with `blogwright plugin list` reporting it, while `blogwright pds <action>` still runs through the hardcoded branch so nothing user-visible moves yet.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the published `blogwright-pds` export map (`packages/pds/package.json:9-18`), the `blogwright/rkey` re-export (`packages/cli/src/rkey.ts:7`), or the current `runPds` dispatch (`packages/cli/src/cli.ts:114-116`).
- **P4 - CONTRACT CORRECTION (validator's note, 2026-08-31).** The ROUTED FINDING in the task file
  (`26-pds_package_manifest.md:10-28`) instructs "do not land the manifest field alone". Its premise
  was corrected on 2026-08-30 by task 25's verification gate, and that correction is recorded in
  `backlog/28-pds_config_validation_timing.md:21-31` and `done/25-pds_plugin_export-certificate.md:160-178`
  - **but it was never propagated back into task 26's own file**, which still carries the
  uncorrected text. This certificate discharges against the CORRECTED contract: the manifest field is
  not the gate on `validatePdsConfig(undefined)`, so landing it alone is correct. The verification is
  in the Exposure analysis below, done independently rather than taken on the correction's word.

## Obligations

- **O1 - The manifest field is present and nothing else in the package moved.**
  - *Claim:* `packages/pds/package.json` declares `"blogwright": { "plugin": "pds" }`, keeps `"name": "blogwright-pds"`, and leaves the `.` and `./rkey` export conditions byte-identical.
  - *Evidence collected:* `diff` of the parent revision's `packages/pds/package.json` against the working copy is exactly three added lines (`"blogwright": {` / `"plugin": "pds"` / `},`) at line 6, inserted between `sideEffects` and `files`; nothing else. A structural comparison confirms `name` = `blogwright-pds` in both, `exports` serialises identically in both (`{".":{"types":"./dist/index.d.ts","default":"./dist/index.js"},"./rkey":{"types":"./dist/rkey.d.ts","default":"./dist/rkey.js"}}`), `files` = `["dist"]` in both, and `blogwright` is the ONLY key whose value differs. `npm pack --dry-run --json` in `packages/pds` yields the same 28-entry file set with and without the field (set-symmetric-difference empty).
  - *Status:* ☑ SATISFIED

- **O2 - Bundled discovery works from a consumer that depends only on `blogwright`.**
  - *Claim:* the CLI discovers `blogwright-pds` when the consuming repo's `package.json` lists `blogwright` and nothing else - the guarantee the migration's "no install step" claim rests on.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run plugins --reporter=verbose` → **1 file, 21 passed**, including `discover (integration) - the bundled blogwright-pds plugin > discovers blogwright-pds as the "pds" plugin from a consuming repo whose package.json names only "blogwright"` (`packages/cli/src/plugins.test.ts:764-833`). Its fixture consumer root carries `{ dependencies: { blogwright: '^0.3.3' } }` and no `node_modules`, and it runs the REAL `createNodeFileSystem`/`createNodeModuleLoader` against `cliPackageDir()`.
  - *Checks:* the discovery path is `discover` → `collectCandidates` → `pluginDependencyNames(cliPkg)` from `cliPackageDir()` → `ports.loader.packageJsonPathFor`/`resolve`/`load`. The consumer half contributes nothing: `pluginDependencyNames` filters to the `blogwright-` prefix and so never emits the bare `blogwright` specifier (pinned separately at `plugins.test.ts` "never hands the resolver the bare `blogwright` specifier"). No bare dynamic `import()` is involved; every hop crosses the injected `ModuleLoader`.
  - *The in-test control was independently falsified.* The case ends with a second `discover(consumerRoot, cliStub, …)` against a CLI package bundling nothing, asserting `plugins`/`failures` are empty. Repointing that call at `cliPackageDir()` (validator mutation C1) makes the case FAIL with `expected [ { name: 'pds', …(5) } ] to deeply equal []` - so the control is a live assertion, not a vacuous one, and it really does exclude arrival via the consumer half or via the test process's own module graph.
  - *End-to-end confirmation outside vitest:* a hand-built consumer repo (`.git`, `package.json` naming only `blogwright`, no `node_modules`) run against the real `packages/cli/dist/bin.js` prints the `pds` section in `--help` and the `pds` row in `plugin list`.
  - *Status:* ☑ SATISFIED

- **O3 - `plugin list` reports the pds row.**
  - *Claim:* `blogwright plugin list` reports `pds` with its namespace, the package version, and the `pds` config key.
  - *Evidence collected:* `blogwright plugin list (integration) - the bundled blogwright-pds plugin > reports the pds row: the namespace, the package, the version packages/pds/package.json declares, and the pds config key` (`packages/cli/src/plugins.test.ts:835-897`) asserts `terminal.writes` equals exactly `['namespace package version configKey', 'pds blogwright-pds <version> pds']`, hand-typed in `--plain` single-space form, with the version read by a path the test builds itself rather than off the discovery result (non-circular). All four fields are asserted, not the namespace alone. Reproduced against the real binary: `plugin list` in the probe consumer prints `pds blogwright-pds 0.3.3 pds`.
  - *Kill checks:* removing the manifest field fails this case (and only it plus O2's, across all 353 CLI tests); rewriting the namespace column to `entry.packageName` puts this case in a 7-test kill set alongside `plugin-commands.test.ts`'s rendering cases.
  - *Placement:* both new cases live in `plugins.test.ts` rather than `plugin-commands.test.ts` because the `Reviewable:` line runs `vitest run plugins`, which matched **one** file (`src/plugins.test.ts`) in the recorded run - `plugin-commands.test.ts` does not contain the substring `plugins`. The placement claim is verified, not assumed.
  - *Status:* ☑ SATISFIED

- **O4 - The rkey subpath and today's pds dispatch are untouched.**
  - *Claim:* `blogwright/rkey` still re-exports `blogwright-pds/rkey` with `packages/cli/src/rkey.test.ts` unmodified, and `blogwright pds <action>` still reaches `runPds`.
  - *Evidence collected:* `jj diff --git packages/cli/src/rkey.test.ts packages/cli/src/rkey.ts packages/pds/src/rkey.test.ts` is empty. `pnpm --filter blogwright exec vitest run rkey --reporter=verbose` → 1 file, 3 passed. `packages/cli/src/cli.ts:397` still reads `if (command === 'pds')` and still precedes the `!KNOWN_COMMANDS.has(command)` fall-through at `:401` that would otherwise reach `runPlugin`. `pnpm --filter blogwright exec vitest run cli` → 39 passed.
  - *Precedence proved by mutation, not by statement order.* Validator mutation F (`command === 'pds'` → `command === '__pds_disabled__'`) fails **exactly six** cases in `main - pds dispatch`, reproducing the implementer's count: the three that predate this task (`(none)`, `bogus`, and the plugin-section-appended case) and the three added here. Both paths are live in one invocation: the third new case asserts `pds bogus` refuses with `✗ unknown pds action: bogus`, the fixture plugin's own `bogus` never runs, AND the help that refusal prints carries the plugin's section.
  - *`pds` is still unreserved.* `packages/cli/src/known-commands.ts:71-76` derives `RESERVED_COMMANDS` from `KNOWN_COMMANDS ∪ {init, preview, plugin}`; `pds` is absent, deliberately, per that module's comment. Adding `'pds'` to the set (validator mutation R) fails 9 tests across both files, including the two explicit "does not reserve pds" cases and both new integration cases - so discovery admitting the plugin is pinned in both directions.
  - *Environment positional intact:* changing `env: values.env ?? envPositional ?? 'production'` to `env: 'production'` (validator mutation E) fails exactly the new `pds sync staging` case, which is therefore its sole guard.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* run twice from the workspace root, once before any mutation and once after every restore - `pnpm build` ✔, `pnpm typecheck` ✔, `pnpm test` ✔ (core/build-agent 27, pds 145, analytics 539, cli 353; 22 CLI test files), `pnpm lint` ✔ (only pre-existing `no-shadow` warnings in `nodes.test.ts`, untouched here), `pnpm exec oxfmt --check .` ✔ (187 files), `pnpm knip` ✔. All six exit 0. Pinned rkey vectors pass unchanged (O4).
  - *Changeset:* `.changeset/pds-discoverable-as-a-plugin.md` exists, marks `blogwright` and `blogwright-pds` minor, and names the deliberate help-text loss and the transient lifecycle gap. **Partial accuracy defect - see D1 below**; it does not affect any O.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `vitest run plugins` and `vitest run rkey` (Reviewable).**
  - *Claim:* a reviewer can run both and observe the bundled-discovery case passing, the `plugin list` row naming `pds`, and the rkey vectors untouched.
  - *Evidence collected:* both commands run from `packages/cli` in the exact form the task file names. `vitest run plugins` → 21/21, with the two named cases present by name in the verbose output; `vitest run rkey` → 3/3. `jj diff --git packages/pds/package.json` is the three-line addition of O1.
  - *Status:* ☑ SATISFIED

## Exposure analysis - does the manifest field WIDEN the `validatePdsConfig(undefined)` defect?

**No.** Verified two independent ways rather than accepted from the implementer's report.

*Static - every caller found, not counted.* `resolvePluginConfig` (`packages/cli/src/plugins.ts:655`) is the
only thing that reaches a plugin's `validateConfig` anywhere in the repo (repo-wide grep across
`cli`, `core`, `pds`, `analytics`; `core/config.ts:298`'s `validateConfig(cfg)` is core's own unrelated
internal function). It has exactly two call sites, both in `plugin-commands.ts`:

- `:713`, inside `runPlugin` (`:633-717`). `runPlugin`'s only caller repo-wide is `cli.ts:406`, on the
  `!KNOWN_COMMANDS.has(command)` fall-through - which `command === 'pds'` at `cli.ts:397` intercepts
  first, and which in any case validates only the DISPATCHED plugin's block.
- `:1097`, inside `destroyBeforeRemoval` (`:1082`). Its only caller is `runPluginRemove:1175`, whose
  plugin comes from `loadPluginForRemoval:1147` - a direct `ports.loader.resolve` + `load` +
  `validatePlugin`, which never reads a `package.json` `blogwright` field at all. The gate there is
  `isDeclaredDependency` (`:1139`), not the manifest. Confirmed against the real binary: `blogwright
  plugin remove pds` on a repo that has not run `plugin add` stops at `blogwright-pds is not a
  dependency of …`, identically with the field present and removed.

The four discovery-running paths reach no validator: `helpText`/`buildHelp`/`renderPluginSection` read
`name`, `description`, `commands[].action|summary` and test `plugin.nodes` for truthiness only
(`genericLifecycleActions` never calls it); `runPluginList` reads `plugin.name`, `packageName`,
`configKey` and the version off disk; `initSite`→`collectPluginBlocks` calls `plugin.init` only where
declared, and `createPdsPlugin` (`packages/pds/src/plugin.ts:173-181`) declares none. `discover`
itself calls `validatePlugin`, never `validateConfig`.

*Empirical - the probe re-run independently.* A real consumer repo, the real
`packages/cli/dist/bin.js`, nine invocations (`--help`, bare, `plugin list`, `init`, `pds bogus`,
`pds bootstrap`, `preview bogus`, an unknown namespace, `plugin remove pds`) captured with the field
present and with it removed. Differences are confined to `discover`'s own output - the `Plugins:`
section, and `plugin list`'s row vs. its empty-state line. `init`, the unknown-namespace path and
`plugin remove` are byte-identical. `plugin "pds" rejected` and `Cannot read properties of undefined`
appear in **zero** captures. The interactive `init` branch was additionally driven under a pty:
discovery runs and the wizard reaches its first question with no validator error.

**Conclusion.** The defect is live from task 25 and gated by `isDeclaredDependency`, exactly as the
correction states. Task 26 opens no new code path to it. Task 28 still owns the fix. One honest
qualification: this task does make the broken sequence more *discoverable* - `plugin list` now
advertises `pds`, which is a plausible prompt to try `plugin add pds` then `plugin remove pds`. That
is a change in likelihood, not in reachability.

## The transient 26 → 29 help gap - ruled ACCEPTABLE

Reproduced against the real binary: `blogwright --help` lists `bootstrap`, `status` and `destroy`
under `pds` (pds contributes `nodes`, so `genericLifecycleActions` emits all three), while
`blogwright pds bootstrap` answers `✗ unknown pds action: bootstrap` and exits 1. Same for `status`
and `destroy`.

Shipping it is acceptable: (a) it is unavoidable once the manifest field lands, since the lifecycle
lines are derived from the same table the dispatcher would match against, and the only alternative -
suppressing them for the `pds` namespace - is a namespace-keyed special case task 29 would have to
delete; (b) the three verbs were already refused before this task, so the delta is one help line, not
a new failure; (c) the refusal is explicit, non-destructive and pre-`makeContext` - `pds destroy` in
particular tears nothing down; (d) it is disclosed to operators in the changeset's third paragraph.

The pinning is the right handling. `cli.test.ts`'s `still refuses the generic lifecycle verbs its own
help now advertises - the deliberate, transient 26 -> 29 gap` states what the gap is in its own body
and names task 29. It is not a rubber stamp: validator mutation F (which simulates removing the
hardcoded branch, i.e. what task 29 does) makes it FAIL. So task 29 cannot close the gap without
being handed this test, and the gap cannot silently survive 29 either.

## The pin that moved - still a pin

`EXPECTED_USAGE` was extracted from the parent revision and from the working copy and diffed
directly. Inside the template literal the change is **16 deletions and zero additions** (the 15 static
`pds …` lines plus the blank line that separated them from `Options:`); the `USAGE` constant in
`cli.ts` took the identical 16-line deletion, and `cli.ts` has no other change in the whole diff.
Nothing was re-typed. The two bodies are byte-identical to each other, which is the property the pin
exists to assert. Validator mutation I (one added line in `USAGE`) fails **16** `cli.test.ts` cases,
reproducing the implementer's count - the pin is live.

## Regression check

- `packages/cli/src/rkey.ts:7` re-exports from `blogwright-pds/rkey` → `rkey.test.ts` unmodified, 3/3 pass; `packages/pds` `exports` map byte-identical; `npm pack` file set identical : ☑ **PRESERVED**
- `packages/cli/src/cli.ts:397` dispatches `blogwright pds sync` to `runPds` → all six actions still in `runPds`'s `known` set; `pds sync staging` still reaches the real `blogwright-pds` `sync` with `ctx.env === 'staging'`; mutation F kills all six pds-dispatch cases : ☑ **PRESERVED**
- `packages/cli/src/plugins.ts` discovery now finds a second candidate → no reserved-name error (`pds` is not in `RESERVED_COMMANDS`), no duplicate-name error, no duplicate-configKey error, no init/lifecycle-collision error (pds declares an `init` COMMAND but no `init(io)` contributor, and declares neither `bootstrap` nor `destroy`); `result.failures` is `[]` in the integration case and the real binary prints no "Plugins that failed to load" line : ☑ **PRESERVED**
- `packages/cli/src/commands.test.ts` and `commands.ts` untouched by this diff; `vitest run commands` → 2 files, 88 passed, including every `destroy`/`previewTeardown`/`assertNoScopedState`/`readNodeStatus` call-sequence case : ☑ **PRESERVED**

## Falsifiability - validator's own mutation sweep

Eight mutations, each with the passing control run immediately before it, each reverted and the
revert proved by `jj diff --git` matching the recorded baseline SHA-256.

| # | Mutation | Result |
|---|---|---|
| A | remove `blogwright` field from `packages/pds/package.json` | **2 of 353** CLI tests fail - exactly the two new `plugins.test.ts` cases |
| B | manifest → `{"plugin": "not-pds"}` | **1** fails (the new discovery case). Package still discovered, still rendered as `pds` in `--help` and `plugin list`, still dispatched as `pds`. Confirms the open question below. |
| C1 | in-test control repointed from `cliStub` to `cliPackageDir()` | **1** fails - the control is a live assertion |
| E | `env: values.env ?? envPositional ?? 'production'` → `'production'` in `runPds` | **1** fails - the new `pds sync staging` case |
| F | `command === 'pds'` → a disabled string | **6** fail, all in `main - pds dispatch` - the implementer's count reproduced, including the three predating this task |
| I | one line added to `USAGE` | **16** `cli.test.ts` cases fail - the implementer's count reproduced |
| L | `plugin list` namespace column ← `entry.packageName` | **7** fail, incl. the new `plugin list` case |
| R | add `'pds'` to `RESERVED_COMMANDS` | **9** fail across both files, incl. both "does not reserve pds" cases and both new cases |

No claim sampled was overstated. Both counts the review brief singled out (F = 6, I = 16) reproduced
exactly.

## Integration

The bookmark `plugin-system-and-analytics` is at `mxnosrxp e519f15c` = build(47/62). The task-26
workspace sits on build 46. `jj duplicate ymvkxvyw -d mxnosrxp` produced `xyuymluz` with
**conflict=no** and a diff byte-identical to the original - a plain merge onto build 47 is clean. The
duplicate was abandoned; the main tree is as found. File sets are disjoint: build 47 (task 50) touches
`packages/analytics/*` and `pnpm-lock.yaml`; task 56 (in review) touches `packages/analytics/*` only
(its new `commands.test.ts` is the analytics one, not the CLI's); task 51's workspace is empty. The
manifest field adds no dependency, so `pnpm-lock.yaml` needs no update and
`--frozen-lockfile` is unaffected.

## Residue

- **The open question this task surfaced is confirmed and correctly left alone.** Mutation B: with
  `packages/pds/package.json` declaring `{"blogwright": {"plugin": "not-pds"}}`, the package is still
  discovered and still dispatches as `pds`. Mechanism verified: `parsePluginManifest`
  (`plugins.ts:285-290`) only checks the string against `PLUGIN_NAME_PATTERN` and
  `loadCandidate` uses it solely to decide the package IS a plugin and to build error text; the
  namespace comes from `plugin.name` via `validatePlugin` (`core/plugin.ts:406-418`), which never
  compares the two. `plugin list`'s namespace column reads `entry.plugin.name`, so a mismatched
  manifest renders a normal row. No check anywhere covers it. Already recorded at
  `plan.md:598-611`; not fixed here, correctly.
- **`pds` remains unreserved** (task 09's set), verified above and pinned in both `plugins.test.ts`
  and `cli.test.ts`. Task 29 hands the namespace to the plugin.
- **Discovery cost on built-in command paths** is still not covered by the DoD, and is still task 28's
  eager/lazy question. Note the cost is nil in practice for the pds module itself: `cli.ts:10`
  statically imports `blogwright-pds` on every invocation, so `discover`'s `load` hits a warm module
  cache.
- **The `plugin list` integration case is coupled to this workspace's own manifests.** It asserts a
  single row, which holds only while the repo root's `package.json` declares no `blogwright-*`
  package and `packages/cli/package.json` bundles no plugin but `blogwright-pds`. Note
  `packages/analytics/package.json` ALREADY declares `{"plugin":"analytics"}` (task 47); the case
  passes only because analytics is neither a CLI dependency nor a root devDependency. A future task
  that bundles analytics breaks this test - loudly and obviously, which is acceptable, but it is a
  coupling worth knowing about.
- **Two forward-looking comments in `cli.ts` now read stale** (`:266-270` and `:502-504` still say
  task 26 "strips"/"will strip" the static block, in the future tense). Pre-existing text, untouched
  by this diff; cosmetic, and task 29 deletes both regions.
- **The ROUTED FINDING in `26-pds_package_manifest.md:10-28` is still uncorrected in place.** The
  correction exists in two other files (P4). Nothing in this diff or its changeset explains why the
  finding's instruction was not followed, so the next reader of task 26's file will believe it was
  ignored. The reasoning is recorded here instead.

## Defects

Both are documentation-level; neither is a code fault and neither blocks the merge.

- **D1 - `.changeset/pds-discoverable-as-a-plugin.md:9`: the enumeration of dropped help text is
  incomplete while reading as exhaustive.** It names three losses and then asserts "All three remain
  in the docs". Comparing the removed static block against the plugin's own summaries, **five**
  details actually drop from `blogwright --help`: the three named, plus `pds login`'s "and refreshed
  automatically on every sync" and `pds init`'s "(commit them)". *Failure scenario:* an operator
  upgrading reads the changeset to learn what left the help text, and does not learn that `pds init`
  no longer reminds them to commit the site verification files - an actionable instruction. Both
  omitted details ARE still in the docs (`docs/src/content/docs/reference/cli.md:185` and `:209`), so
  nothing is lost from the product; only the changeset's list is short by two.

- **D2 - a new user-visible contradiction between `plugin list` and `plugin remove`, disclosed
  nowhere.** This is the first commit at which `blogwright plugin list` reports a BUNDLED plugin.
  Reproduced against the real binary in a repo that depends only on `blogwright`: `plugin list`
  prints `pds blogwright-pds 0.3.3 pds`, and `blogwright plugin remove pds` then answers
  `✗ blogwright-pds is not a dependency of <repoRoot> - nothing to remove; run `blogwright plugin
  list` to see what is installed` (`packages/cli/src/plugin-commands.ts:1140-1144`) - pointing the
  operator at the listing that just showed it. *Failure scenario:* an operator who does not want the
  pds plugin runs `plugin list`, sees it, runs `plugin remove pds`, and is told it is not installed
  and to consult the command that says it is. The refusal is correct - `blogwright-pds` is a
  non-optional dependency of the CLI and cannot be removed - but its remedy is self-contradicting for
  exactly this case. Not fixable here without contradicting O3, and the message belongs to task 18.
  It needs routing (task 29 or 30, whichever ships the migration's operator-facing text), not a code
  change in this task. Neither the change spec nor the plan anticipates the bundled case.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All six obligations are satisfied with independently collected evidence - the manifest field
is a three-line addition leaving `name`, `exports` and the packed file set identical; bundled
discovery and the `plugin list` row are proved by two real-disk cases whose own control was
falsification-tested; `blogwright pds <action>` still routes through `runPds` with mutation F killing
all six dispatch cases; the `EXPECTED_USAGE` pin took 16 deletions and zero additions and mutation I
kills 16 cases; and all six repo gates are clean before and after an eight-mutation sweep that
reproduced every count sampled. The manifest field opens no new path to `validatePdsConfig(undefined)`
- verified by finding every `resolvePluginConfig` caller and by a nine-invocation with/without probe
against the real binary in which only `discover`'s own output differs - so task 28 keeps the fix.
The two defects recorded (an incomplete changeset enumeration, and a newly-exposed
`plugin list`/`plugin remove` contradiction) are documentation-level and route rather than block.
