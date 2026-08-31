# Done Certificate - Task 17: Add `blogwright plugin list`

**Task:** [17-cli_plugin_list_command.md](17-cli_plugin_list_command.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> Discharged by a verification agent that neither wrote the code nor authored the previous
> certificate. This revision supersedes the CONCERNS/PARTIAL certificate recorded against the
> earlier eight-file diff: the diff is now **eleven** files, and the five defects that
> certificate raised (D1-D5) have each been closed. Every closure below is backed by an
> execution trace - a mutation applied to the working tree, the named test failure observed, the
> mutation restored - run fresh by this agent, not inherited from the implementer's account.
> 8 mutations run in this pass, **8 killed, 0 survived**. Restoration proven by `shasum -a 256 -c`
> over all 48 files in `packages/cli/src` and `.changeset`, and by a byte-identical
> `jj diff --git` (sha256 `fe1363b1…`) against the pre-verification dump.

## Definition

DONE(Task 17) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The built-in `plugin` namespace with its `list` action, printing one row per installed plugin - namespace, package name, version, owned config key - plus a row per plugin that failed to load with the reason, in both interactive and `--plain` modes.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 08's `discover(repoRoot, cliPackageDir, ports)` for the dispatch path, task 09's reserved-name and duplicate-name rejections, task 10's `blogwright <plugin> <action>` routing, or the built-in command switch in `packages/cli/src/cli.ts`.

## Inherited findings

The prior gate established the core behaviour by execution and this pass did not disturb it: the
dispatch placement (M1 - disabling the `plugin` branch fails two named tests including
`createContext must not run for \`blogwright plugin list\``), the real-binary run on a `git init`
directory with no `config/` and every `AWS_*` unset, version provenance through the `FileSystem`
port, the `(none)`/`(unknown)` markers, both output modes, the exit-code contract, the `default:`
arm's unreachability, the non-vacuity of the laziness assertion (M21), and `EXPECTED_USAGE`'s
independence (M13 - deleting the two `plugin list` lines from `USAGE` alone fails 14 tests).
Those are carried forward as SATISFIED. **The delta touched none of them**: it adds one assertion
inside an existing `it`, three new `it` blocks, one changeset, and one changeset correction.

The headline no-config/no-credentials property was nonetheless **re-executed on the merged tree**
(build 31 + this task, real binary, every `AWS_*` unset,
`AWS_CONFIG_FILE=AWS_SHARED_CREDENTIALS_FILE=/nonexistent`, a bare `git init` repo):

```
blogwright plugin       -> exit 1  ✗ unknown plugin action: (none) + the actions listing
blogwright plugin bogus -> exit 1  ✗ unknown plugin action: bogus  + the actions listing
blogwright plugin list  -> exit 0  no plugins installed - run `blogwright plugin add <name>` to install one
blogwright nonsense     -> exit 1  ✗ no built-in command or installed plugin claims "nonsense" …
```

## The five closures

- **D1 (was blocking, medium) - `packageJsonPath` provenance. CLOSED.**
  - *The hazard.* `plugins.ts:332` (`packageJsonPath: manifestPath.path`) was entirely unpinned:
    every map-backed fixture flattens `package.json` and `index.js` into one directory, so a
    `resolve`-entry-derived path passed 310/310. Silent in reality - a real dual-package plugin
    lists as `(unknown)` and still exits 0.
  - *The repair.* An assertion added to the previously-unused on-disk fixture at
    `plugins.test.ts:726-729`, which already builds a real `blogwright-dual@1.0.0` with
    `exports: {".": "./dist/index.js"}` and a `dist/package.json` stub through the real
    `createNodeModuleLoader`.
  - **Mutation M15** - `packageJsonPath: entry.path.replace(/[^/\\]+$/, 'package.json')`.
    Observed: **1 failed | 312 passed**, the failure being exactly the named fixture, and naming
    the stub:
    `Received: ".../node_modules/blogwright-dual/dist/package.json"` against
    `Expected: /[/\\]node_modules[/\\]blogwright-dual[/\\]package\.json$/`. Restored.
  - *Suffix, not equality - verified, not assumed.* The received path in that trace begins
    `/private/var/folders/…` while `makeTempDir` returned `/var/…`. A `toEqual(join(consumerRoot, …))`
    would have failed on the shipped code on macOS. The check is `toMatch` on a
    `…/blogwright-dual/package.json$` suffix, which the `dist/` stub cannot satisfy. Correct form.
  - *Status:* ☑ CLOSED

- **D2 (was blocking, low→pinned) - missing vs malformed. CLOSED.**
  - *The repair.* `plugin-commands.test.ts:1475` wraps the fixture's `FileSystem` so that
    **only the second read of one path** returns `'{ "version": '`:
    `readText: async (path) => path === manifestPath && ++reads > 1 ? '{ "version": ' : base.fs.readText(path)`.
  - *Isolation confirmed by execution, not by reading.* Probed against the shipped code:
    `{ code: 'THREW SyntaxError', reads: 2, writes: [], errors: [] }`. `reads === 2` means
    discovery's own read succeeded and the plugin loaded, was validated and reached the listing;
    only the version read saw the corrupted file. The wrapper isolates exactly the read under test.
  - **Mutation M14** - `JSON.parse` wrapped in `try { … } catch { return undefined; }`.
    Observed: **1 failed | 312 passed** (`promise resolved "+0" instead of rejecting`), and the
    same probe against the mutant returned
    `{ code: 0, reads: 2, writes: ['namespace package version configKey', 'widget blogwright-metrics (unknown) (none)'] }`.
    The mutant renders `(unknown)` and exits 0 - byte-identical to a genuinely versionless
    plugin, the exact conflation task 11 forbids - and the new test is what stops it. Restored.
  - *Status:* ☑ CLOSED

- **D3 (was low) - the bold failure heading. CLOSED.**
  - *The repair.* `plugin-commands.test.ts:1509` runs the broken-plugin case with
    `interactive: true` and pins `'[1mfailed to load:[0m'`.
  - **Mutation M25** - drop `colors.bold` at `render.ts:232`: **1 failed**, that test, diffing
    `"[1mfailed to load:[0m"` against `"failed to load:"`. Restored.
  - *The reason line's uncolouredness is pinned in the other direction too.* **Mutation M27** -
    wrap each failure line in `colors.bold` under `pretty`: **1 failed**, the same test. The test
    name ("and the reason line stays uncoloured") is therefore honest, not decorative.
  - *Status:* ☑ CLOSED

- **D4 (was low, latent) - `test-support.ts`'s shared fixture. CLOSED.**
  - *The repair.* `withBrokenPlugin` (`test-support.ts:466-490`) now spreads the whole manifest
    (`...manifest`) before overwriting `dependencies`, restoring the parity the pre-move
    `cli.test.ts` copy had, and narrows with a predicate instead of the `as` cast.
  - *The predicate matches the narrowing used in the production modules - byte-identical, not merely similar.*
    All three of `test-support.ts:451`, `plugins.ts:143` and `plugin-commands.ts:748` read
    `typeof value === 'object' && value !== null && !Array.isArray(value)` and are declared
    `value is Record<string, unknown>`. It is a real type predicate; there is no cast anywhere in
    the helper.
  - *No other test's behaviour changed - established by mutation, not by inspection.*
    **Mutation M28** - drop `...manifest`, reverting to the defective `{ dependencies: {…} }`
    form: **exactly 1 failed | 312 passed**, and the one failure is the new
    `test-support.test.ts` case. Since every other test passes under both forms, no existing
    caller's behaviour depends on the spread; the new case is the sole pin, and it genuinely
    fails against the old form. Restored.
  - *The other half of the join is pinned too.* **Mutation M29** - drop `...dependencies` so the
    broken candidate replaces rather than joins: **3 failed**, including
    `cli.test.ts > leaves a working plugin's section rendered when another plugin fails to load`
    and the mixed good/broken `plugin list` case. Both halves of the helper's contract are held.
  - *Status:* ☑ CLOSED

- **D5 (was completeness) - changesets. CLOSED.**
  - *The new changeset.* `.changeset/plugin-list-command.md`, `"blogwright": minor`. Every claim
    checked against the code or a run: the four columns and their order, sorting by namespace
    (`plugin-commands.ts:820`), the TTY/`--plain` split, versions read from each package's own
    `package.json` with no table and no registry, `(unknown)`/`(none)` never blank, the
    empty-state line, exit 0 for a produced listing including a failed plugin, no `OpsContext`,
    `--help` now listing `plugin list`, and a bare or unrecognised `plugin` action printing the
    namespace's actions at exit 1. `--plain` is a real flag (`cli.ts:68`, `:303`, `:309`), and it
    is what shapes `terminal.isInteractive`. The minor bump is right for a new command, and the
    diff touches no `packages/core` file, so no second package needs one.
  - *The correction is accurate.* `.changeset/cli-help-plugin-sections.md` claimed enriched help
    prints at "an unrecognised `blogwright plugin` (bare)". This task made that false, and the
    single deleted clause is exactly that one. Confirmed against the real binary: bare
    `blogwright plugin` now prints `✗ unknown plugin action: (none)` plus the actions listing,
    not `USAGE`.
  - **It did not over-delete - the two retained paths were executed and mutated.** The same
    sentence names `blogwright pds <bogus-action>` and `blogwright preview <bogus-action>`. Both
    still print the enriched form: `cli.test.ts:1042` and `:1078` assert
    `EXPECTED_HELP_WITH_WIDGET` (= `EXPECTED_USAGE` + a `Plugins:` section, `cli.test.ts:190`),
    and both pass. **Mutation M30** - `cli.ts:485` and `:543` print the plain `USAGE` constant
    instead of `await helpText(makeDiscoveryPorts())`: **exactly those 2 tests fail | 34 pass**.
    The retained claims are genuinely pinned, not merely still written down. Restored.
    `runPreview`'s guard (`cli.ts:541`) handles a missing and an unrecognised action through one
    arm, so the changeset's `<bogus-action>` phrasing covers the bare case the test drives.
  - *No further false claim was left behind.* The reachable USAGE print sites are now `--help`/bare
    (`cli.ts:314`), `pds` (`:485`) and `preview` (`:543`); the two `default:` arms (`:450`, `:579`)
    are unreachable, and the unknown-command path routes to `runPlugin`'s own message rather than
    to `USAGE`. The corrected sentence enumerates exactly the reachable error-path sites.
  - *Status:* ☑ CLOSED

## Obligations

- **O1 - One row per plugin, pinned in both modes.** Unchanged by the delta; inherited.
  Interactive and plain pins are hand-typed full-array `toEqual`s, the fixture's two plugins
  deliberately mismatch package and namespace so package order and namespace order disagree, and
  mode selection is the `Terminal` port. `plugin-commands` now runs **43 passed** (was 41).
  *Status:* ☑ SATISFIED

- **O2 - Versions come from each package's own `package.json` through the FileSystem port.**
  `readPackageVersion` (`plugin-commands.ts:777`) does `JSON.parse(await fs.readText(packageJsonPath))`
  on the injected port. `grep -nE "fetch|https?://|registry|npmjs" plugin-commands.ts` → one prose
  match in a doc comment; `grep -nE "'[0-9]+\.[0-9]+"` → nothing. **The provenance of the path is
  now pinned as well** - the gap D1 named - so this obligation no longer rests on an unpinned
  invariant. *Status:* ☑ SATISFIED

- **O3 - A broken plugin is listed with its reason and does not suppress the healthy ones.**
  Unchanged by the delta; inherited (exact four-line array, discovery's own message verbatim,
  exit 0, verified against `--help`'s matching contract). The delta adds the TTY form of the same
  section. *Status:* ☑ SATISFIED

- **O4 - Empty and unknown-input space.** Unchanged by the delta; inherited, and re-executed
  against the real binary on the merged tree (all four cases above). *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Six gates, workspace root, CI order.* `pnpm build` 0 · `pnpm typecheck` 0 ·
    `pnpm test` 0 (**670 passed | 1 skipped** across 5 packages; cli **313/313**) ·
    `pnpm lint` 0 (only the pre-existing `no-shadow` warnings in `nodes.test.ts`) ·
    `pnpm exec oxfmt --check .` 0 (148 files) · `pnpm knip` 0.
  - *Changeset.* Present, and the stale sibling corrected - see D5. This is the item that was
    NOT SATISFIED in the previous certificate; it is satisfied now.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: the listing is driven entirely by in-memory fixtures.**
  `pnpm --filter blogwright exec vitest run plugin-commands --reporter=verbose` → **43 passed**.
  The mixed good/broken case prints `widget blogwright-metrics 2.0.0 (none)`, the `2.0.0` seeded
  by `buildDiscoveryPorts([{ …, version: '2.0.0' }])` into the in-memory filesystem.
  `grep -n "createNodeModuleLoader\|makeTempDir\|node:fs" plugin-commands.test.ts` → **no matches**.
  The disclosed caveat stands as adjudicated before: `plugin-commands.test.ts:62`'s
  `findRepoRoot(createNodeFileSystem())` is pre-existing and structural to task 10's
  `buildDiscoveryPorts`, which makes the identical call itself (`test-support.ts:377`) for every
  test in the file. **The delta introduced no new disk read here** - verified against the base
  revision, whose import block already carried `createNodeFileSystem`, `findRepoRoot` and
  `type FileSystem`; the new D2 test wraps `base.fs`, the in-memory one.
  *Status:* ☑ SATISFIED (as intended; the literal reading is a pre-existing task-10 property)

## Falsifiability audit

Every `it` added by this delta was walked and shown to fail, plus the one assertion added inside
an existing `it`. The delta adds exactly **3** `it` blocks - arithmetic confirmed: the prior pass
recorded 310 cli tests and 11 added `it` blocks; the tree now runs **313**, and
`plugin-commands.test.ts` holds 11 task-17 cases against the 9 recorded before.

| Added by the delta | Killed by | Result |
|---|---|---|
| `plugins.test.ts:726` (assertion inside the dual-package `it`) | M15 entry-derived path | 1 failed, names the `dist/` stub |
| `plugin-commands.test.ts:1475` propagates an unparseable manifest | M14 blanket catch | 1 failed; mutant prints `(unknown)`, exit 0 |
| `plugin-commands.test.ts:1509` bolds the failure heading | M25 drop bold; M27 bold the reason line | 1 failed each, both directions |
| `test-support.test.ts:85` joins onto the consumer manifest | M28 drop `...manifest`; M29 drop `...dependencies` | 1 failed / 3 failed |

No assertion added in this delta is vacuous. The shape that shipped in task 14 (empty call lists
against an empty filesystem) is absent; the D2 test's `expect(reads).toBe(2)` and
`expect(terminal.writes).toEqual([])` were both observed non-vacuous - the mutant drives `writes`
non-empty, and `reads` distinguishes discovery's read from the version read.

## Regression check

- `withBrokenPlugin` is shared fixture code. M28 shows **312 of 313 tests pass under both the old
  and the new form**, so no existing caller's behaviour changed; M29 shows the helper's join
  contract is load-bearing for two other tests : ☑ PRESERVED
- `packages/cli/src/plugins.ts` (`discover`) - the delta adds no production change to this file at
  all; only the test assertion. `plugins.test.ts` 21/21, cli 313/313 : ☑ PRESERVED
- `--help` / `USAGE` and the `pds`/`preview` error paths - M30 confirms both enriched-help paths
  are still wired and still pinned : ☑ PRESERVED
- Real binary on an unconfigured repo, merged tree: the four `plugin`-namespace cases above, plus
  the unknown-command message, all as contracted : ☑ PRESERVED

## Integration check

**A plain merge onto build 30 is clean - established by execution, not by inspection.** The
bookmark has advanced past build 30 to `97be077` (31/62, task 40); this was checked against that
head, which subsumes build 30.

- *File overlap: none.* Everything landed between this workspace's base `0dc38d2` (26/62) and
  `97be077` touches `packages/analytics/**`, `packages/core/src/aws/logs*`, `.specs/**`,
  `.changeset/shared-delivery-source-guards.md`, and - for task 52 - `packages/cli/src/nodes.ts`,
  `nodes.test.ts` and `commands.test.ts`. This task touches none of those eleven-file set's paths,
  and none of them is in its own. `git apply --check --3way` of the full diff onto `97be077`
  reports every one of the eleven files applied cleanly.
- *No pinned call sequence or output collides.* The merged tree was **built and run**, not
  reasoned about: a worktree at `97be077` with this diff applied and a fresh `pnpm install`
  gives `pnpm build` 0 · `pnpm typecheck` 0 · `pnpm test` 0 (**cli 317/317** = 313 + task 52's
  four, analytics 222, core 143, pds 100, build-agent 27) · `pnpm lint` 0 ·
  `oxfmt --check` 0 (156 files) · `pnpm knip` 0. Task 52's additions to `commands.test.ts` and
  `nodes.test.ts` and this task's `USAGE`/`DiscoveryResult` changes do not interact.
- *The two shared surfaces were checked specifically.* `USAGE`/`--help` has exactly one code pin
  in the repo, `EXPECTED_USAGE` in `cli.test.ts`, which this diff owns; `DiscoveryResult`'s only
  whole-result `toEqual` pins are the three in `plugins.test.ts`, updated here. Task 52 adds no
  new command name to `KNOWN_COMMANDS` and no new USAGE print site.

## Design decisions judged

All decisions adjudicated in the prior pass stand: exit 0 for a produced listing, the version read
living in `plugin-commands.ts` rather than in `discover`, `DiscoveryResult` gaining `installed`
with `plugins` derived at the single construction point, the documented-unreachable `default:`
arm, and the `USAGE`/`EXPECTED_USAGE` pair. Three are now better supported than they were:

- **`packageJsonPath` from `packageJsonPathFor`, not from `resolve`.** ACCEPT, and now
  **pinned**. This was the one place the implementation departed from the task text and the
  previous certificate's own O2 wording; it was the correct departure, and M15 no longer survives.
- **Task 11's missing-vs-malformed distinction.** HONOURED in code and now **pinned** by a test
  that fails under the blanket catch, with the mutant's conflated output recorded above.
- **`withBrokenPlugin` in `test-support.ts`, narrowed rather than cast.** ACCEPT without the
  caveat the prior pass attached: the spread is restored, the helper's own comment about joining
  `devDependencies` is now a promise the code keeps, and a test enforces it.

## Residue

- `known-commands.ts`'s doc comment still describes `KNOWN_COMMANDS` as "the eight names" while
  the set holds nine. Pre-existing (task 10 added `plugin`); task 20's closure pass.
- `docs/src/content/docs/reference/cli.md` does not mention `plugin list` - task 20's surface.
- `render.ts:165` exports `PluginListing`, which nothing imports: `plugin-commands.ts` builds the
  argument inline (`{ rows, failures }`) and imports only `renderPluginList` and `PluginListRow`.
  `knip` is green, so this is a style note, not a gate finding.
- `isRecord` is now defined identically in three modules (`plugins.ts`, `plugin-commands.ts`,
  `test-support.ts`). Deliberate and documented as a local copy in each; a shared helper would be
  a cross-task refactor.
- The D1 assertion is a suffix match, so it pins that the path is the package's own manifest and
  not the `dist/` stub, but not that it is rooted under the fixture's temp dir. Adequate for the
  property it exists to hold.
- The exit-0-for-a-broken-plugin choice is settled and consistent with `--help`; tasks 18 and 19
  should not diverge when they add `add`/`remove` to `PLUGIN_NAMESPACE_ACTIONS`.
- The version shown is the installed package's, not the SPI it was built against - the spec's open
  question, carried at task 20. `plugin list` still does not verify a plugin's `configKey` block is
  present in config; that is task 19's surface.

## Conclusion

CORRECTNESS: **CORRECT** (confidence: high)
COMPLETENESS: **DONE** (confidence: high)

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All five defects the previous certificate raised are closed and each closure was proven
by a fresh mutation rather than accepted - the entry-derived `packageJsonPath` (M15), the blanket
`JSON.parse` catch that conflates a versionless manifest with a broken one (M14, whose mutant was
observed printing `(unknown)` at exit 0), the unbolded failure heading (M25/M27), the dropped
manifest spread in shared fixture code (M28/M29, the new case failing against the old form and no
other test's behaviour changed either way), and the missing changeset plus its stale sibling
(M30 confirming the correction removed only the clause this task falsified and left the `pds` and
`preview` paths, which really do still print enriched help) - with all six gates green, every
`it` added in the delta shown to fail, and a merge onto build 30 clean not only by `git apply`
but by building and running the merged tree end to end.
