# Done Certificate - Task 17: Add `blogwright plugin list`

**Task:** [17-cli_plugin_list_command.md](17-cli_plugin_list_command.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> Discharged by a verification agent that did not write the code. Every status below is backed
> by an execution trace: a mutation applied to the working tree, the named test failure observed,
> the mutation restored. 24 mutations were run; 21 killed, 3 survived. Full restoration proven
> by `jj diff --git` byte-comparison against the pre-verification dump and by `shasum -c` on all
> eight touched files.

## Definition

DONE(Task 17) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The built-in `plugin` namespace with its `list` action, printing one row per installed plugin - namespace, package name, version, owned config key - plus a row per plugin that failed to load with the reason, in both interactive and `--plain` modes.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 08's `discover(repoRoot, cliPackageDir, ports)` for the dispatch path, task 09's reserved-name and duplicate-name rejections, task 10's `blogwright <plugin> <action>` routing, or the built-in command switch at `packages/cli/src/cli.ts:414-451`.

## Headline obligation - runs with no config and no credentials

- **Claim:** `blogwright plugin list` works on a repo with NO `config/<env>.jsonc` and no AWS
  credentials, asserted by a test that never constructs a context.
- **Evidence.** Two independent proofs.
  1. *Unit.* `plugin-commands.test.ts:1522` calls `runPluginNamespace` directly - the command
     takes `Pick<Ports, 'fs' | 'loader'>`, never a `ContextFactory`. The empty-state case asserts
     `fs.exists(config/production.jsonc) === false` and `fs.exists(ops.config.jsonc) === false`
     before running, and `fs.exists(package.json) === true` so the empty listing is discovery
     finding nothing rather than discovery failing before it looked.
  2. *Dispatch placement.* `cli.test.ts:410` drives the same command through `main` with a
     `ContextFactory` that throws `createContext must not run for \`blogwright plugin list\``.
- **Mutation M1** - `cli.ts:361` `if (command === 'plugin')` → `if (false as boolean)`, so the
  name falls through to the `KNOWN_COMMANDS` switch past `makeContext`. Observed: **2 failed | 75
  passed**, including `Error: createContext must not run for \`blogwright plugin list\`` and
  `expected [ '✗ unknown command: plugin' ] to deeply equal [ '✗ unknown plugin action: (none)' ]`.
  Restored.
- **Execution.** Real CLI, real disk, no fixture: a `git init` directory with a bare
  `package.json`, `AWS_CONFIG_FILE=/nonexistent AWS_SHARED_CREDENTIALS_FILE=/nonexistent` and
  every `AWS_*` variable unset →
  `no plugins installed - run \`blogwright plugin add <name>\` to install one`, **exit 0**.
- **Status:** ☑ SATISFIED

## Obligations

- **O1 - One row per plugin, pinned in both modes.**
  - *Claim:* each installed plugin prints its namespace, package name, version and `configKey`
    (or a clear marker when it owns none), in interactive and `--plain` forms.
  - *Evidence.* `pnpm --filter blogwright exec vitest run plugin-commands --reporter=verbose` →
    **41 passed**. Both pins are hand-typed full-array `toEqual`s, not `padEnd`-computed:
    interactive `'[1mnamespace  package             version  configKey[0m'` +
    two aligned rows; plain `'namespace package version configKey'` + two single-space rows.
    The fixture's `LISTED_WIDGET` declares no `configKey` and its row carries `(none)`. Plain
    form matches `history`'s contract (`commands.ts:258-272`): same column set, no colour, no
    padding.
  - *Check - mode selection is the port.* `runPluginList` passes `terminal.isInteractive`
    (the `Terminal` port) into `renderPluginList`. `grep -n "process\.\|node:fs"
    plugin-commands.ts render.ts` → no matches.
  - *Check - fixture cannot pass by accident.* The two fixture plugins deliberately mismatch
    package and namespace (`blogwright-metrics`→`widget`, `blogwright-widgets`→`analytics`), so
    discovery's package-name order and the listing's namespace order disagree.
  - *Mutations.* **M3** `NO_CONFIG_KEY = '(none)'` → `''`: 5 failed. **M4** `UNKNOWN_VERSION =
    '(unknown)'` → `''`: 2 failed. **M9** plain join `' '` → `'\t'`: 5 failed. **M10**
    `renderPluginList` ignores `pretty` (always aligned): 5 failed. **M24** drop `colors.bold`
    on the header: 1 failed. **M8** drop `rows.sort`: 2 failed. **M18** `namespace:
    entry.plugin.name` → `entry.packageName`: 6 failed. **M22** `configKey` → `undefined`: 3
    failed. **M12** emit the header for an empty listing: 2 failed. All restored.
  - *Status:* ☑ SATISFIED

- **O2 - Versions come from each package's own `package.json` through the FileSystem port.**
  - *Claim:* no hardcoded version map and no network call.
  - *Evidence.* `readPackageVersion(fs: FileSystem, packageJsonPath: string)`
    (`plugin-commands.ts:768`) does `JSON.parse(await fs.readText(packageJsonPath))` on the
    injected port. `grep -nE "fetch|https?://|registry|npmjs" plugin-commands.ts` → one prose
    match in a doc comment ("never a registry lookup"), no code. `grep -nE "'[0-9]+\.[0-9]+"`
    → no matches: the module contains no version literal at all. `pnpm lint` clean, so the
    `no-restricted-imports` gate holds for this file.
  - *Mutations.* **M2** prepend `return '1.2.3';` to `readPackageVersion`: **6 failed**.
    **M17** `test-support.ts` stops seeding `version` into the fake manifest: **4 failed** -
    the asserted versions really do come from the in-memory file the fixture wrote.
  - *Deviation from this certificate's own text, for the better.* The certificate asked for a
    path "derived from `ports.loader.resolve`" (as did the task's Step 2). The implementation
    instead carries `ModuleLoader.packageJsonPathFor`'s path on `InstalledPlugin`. That is the
    correct choice and the certificate text was wrong: see D1 below for the execution proof
    that the `resolve`-derived path silently breaks every dual-package-layout plugin.
  - *Status:* ☑ SATISFIED

- **O3 - A broken plugin is listed with its reason and does not suppress the healthy ones.**
  - *Claim:* failed loads appear with the reason from `validatePlugin`/discovery, alongside the
    plugins that loaded.
  - *Evidence.* `plugin-commands.test.ts:1487` asserts the exact four-line array: header, the
    healthy `widget blogwright-metrics 2.0.0 (none)` row, `failed to load:`, and
    `blogwright-broken: plugin package "blogwright-broken"'s Plugin.name is required - the CLI
    namespace it claims, e.g. "analytics"` - discovery's own message verbatim, no stack trace,
    not a generic "failed". Exit **0**. The failure travels as data:
    `discover` → `DiscoveryResult.failures` → `PluginListing.failures` → `render.ts`; nothing
    in `plugin-commands.ts` catches it.
  - *Exit-code contract.* 0, on the stated grounds that a listing is a report and `--help`
    already has that contract. **Verified, not accepted:** `cli.ts:316` returns 0 for `--help`,
    and `cli.test.ts:359` drives `--help` with the same broken plugin, asserting `code` is 0
    with the failure section printed. The claim holds.
  - *Mutations.* **M5** return early from `runPluginList` when `failures.length > 0`: 2 failed.
    **M20** failure line drops the package name: 2 failed. **M6** `runPluginList` returns 1:
    7 failed. All restored.
  - *Status:* ☑ SATISFIED

- **O4 - Empty and unknown-input space.**
  - *Claim:* no plugins → an empty-state line naming `blogwright plugin add`, exit 0;
    `blogwright plugin` with no action or an unknown action → the namespace's actions printed,
    exit 1.
  - *Evidence.* One test each, all four asserted end to end plus a real-CLI trace:
    `plugin list` (empty repo) → exit 0; `plugin` → exit 1; `plugin bogus` → exit 1.
    The refusal listing is built by `renderPluginNamespaceActions()` from
    `PLUGIN_NAMESPACE_ACTIONS`, the same table `runPluginNamespace` dispatches against, so it
    cannot advertise an action that does not run; the test pins it as a hand-typed literal
    rather than importing that table.
  - *Mutations.* **M11** drop `blogwright plugin add` from the empty-state line: 2 failed.
    **M7** unknown-action returns 0: 3 failed. **M19** guard weakened to `action === undefined`
    only: 1 failed. **M26** change the `list` summary text: 3 failed. **M23** `cli.ts` passes
    `positionals` instead of `positionals.slice(1)`: 2 failed. All restored.
  - *Non-vacuity of the laziness assertion (the sibling defect that shipped in task 14).*
    `plugin-commands.test.ts:1550`'s three empty recorded-call assertions run against
    `listingPorts()` - a fixture carrying two *resolvable* plugins that the sibling `list`
    cases drive to a real two-row listing. Proven by **M21**: insert a bare
    `await discover(await findRepoRoot(ports.fs), cliPackageDir(), ports)` before the guard,
    leaving every printed line and the exit code untouched. Observed exactly one failure -
    `expected [ { …(2) }, { …(2) } ] to deeply equal []` - so the lists are empty because the
    guard returned, not because discovery threw first. Restored.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Six gates, workspace root, CI order.* `pnpm build` 0 · `pnpm typecheck` 0 ·
    `pnpm test` 0 (**667 passed | 1 skipped** across 5 packages; cli 310/310) ·
    `pnpm lint` 0 (only pre-existing `no-shadow` warnings in `nodes.test.ts`) ·
    `pnpm exec oxfmt --check .` 0 ("All matched files use the correct format", 148 files) ·
    `pnpm knip` 0.
  - **Changeset: MISSING.** `.changeset/` carries a file for every sibling task in this build
    (`cli-help-plugin-sections`, `generic-plugin-dispatch`, `plugin-init-action`,
    `plugin-lifecycle-verbs`, `init-wizard-plugin-blocks`) and none for task 17. The change is
    unambiguously user-facing on two counts: a brand-new `blogwright plugin list` command, and
    a changed `blogwright --help` / `USAGE` body. See D5.
  - *Status:* ☐ NOT SATISFIED (gates green; the changeset this obligation names does not exist)

- **O6 - Reviewable: the listing is driven entirely by in-memory fixtures.**
  - *Claim:* a reviewer can run the named command and observe the healthy plugin's version
    coming from the in-memory `package.json` the test wrote, with no test constructing a real
    `ModuleLoader` or reading from disk.
  - *Evidence.* `pnpm --filter blogwright exec vitest run plugin-commands --reporter=verbose`
    → 41 passed. The mixed good/broken case prints `2.0.0`, seeded by
    `buildDiscoveryPorts([{ …, version: '2.0.0' }])` into `createMemoryFileSystem`; M17 proves
    the coupling. `grep -n "createNodeModuleLoader\|node:fs\|makeTempDir"
    plugin-commands.test.ts` → **no matches**: no real `ModuleLoader` anywhere in the file.
  - *"reads from disk" - the disclosed caveat, adjudicated.* `plugin-commands.test.ts:62`
    (`realRepoRoot`) calls `findRepoRoot(createNodeFileSystem())`, which walks the real
    filesystem. **Not a breach of this task.** The call is pre-existing (task 13's `realRepoRoot`
    helper, unmodified by this diff) and is structural to task 10's `buildDiscoveryPorts`, which
    makes the same call for *every* test in the file: the fixture must seed the same absolute
    repo root that `runPlugin`'s non-injectable `findRepoRoot` resolves to. Read literally the
    `Reviewable:` line was unsatisfiable the moment task 10 chose that fixture design, and
    reworking another task's fixture is out of scope. The clause's actual intent - that no
    plugin manifest, module or version is read from disk - holds without qualification: every
    manifest and module in the file comes from `createMemoryFileSystem` and the map-backed
    loader fake. Leaving it was the right call, correctly disclosed.
  - *Status:* ☑ SATISFIED (as intended; the literal reading is a pre-existing task-10 property)

## Design decisions judged

- **Exit 0 for `list` even when plugins failed to load.** ACCEPT. Verified rather than accepted:
  `cli.ts:316` returns 0 for `--help`, and `cli.test.ts:359` pins `--help` printing a failure
  section at exit 0. The spec (§CLI → `blogwright plugin`) mandates no exit code. Consistent
  with `status`'s drift contract. A report's exit code says the report was produced.
- **Version read in `plugin-commands.ts` rather than folded into `discover`.** ACCEPT, with the
  stated justification downgraded. The design argument stands - `DiscoveryResult` would carry a
  field only one of four discovery callers renders, and `plugins.ts` would have to own a
  render-only missing-vs-malformed decision. But the *performance* half of the comment ("so
  `--help` and dispatch pay nothing for this field") is thin: `loadCandidate` has already read
  and parsed that exact manifest, so carrying `version?: string` would cost one property read,
  while the chosen design re-reads and re-parses the file once per plugin on `plugin list`. Net
  more I/O on the one command that needs it, for a cleaner `DiscoveryResult`. Defensible trade;
  the comment overstates its case.
- **`DiscoveryResult` gains `installed`, with `plugins` derived at the single construction
  point.** ACCEPT. `plugins.ts:524` reads
  `return { plugins: installed.map((e) => e.plugin), installed, failures }` - one construction
  site, no drift possible. `runPlugin`, `buildHelp` and `initSite` are byte-untouched by the
  diff (`init.ts` is not in it at all) and all three still read `.plugins`. **M16** (`plugins:
  []`) fails 30+ tests across three files, so the derivation is heavily pinned. The carried path
  is `packageJsonPathFor`'s (`manifestPath.path`, `plugins.ts:330`), **not** one derived from
  `resolve`'s entry file - correct, and the one place this task departs from its own task text
  and this certificate's original O2 wording. See D1: correct, but unpinned.
- **The switch's `default:` arm is now provably unreachable, kept wired and documented.** ACCEPT,
  unreachability **verified** rather than accepted. `KNOWN_COMMANDS` (`known-commands.ts:57`)
  holds exactly nine names; the switch has a `case` for eight of them; `plugin`, the ninth, is
  intercepted at `cli.ts:361` ahead of the `KNOWN_COMMANDS.has` test at `:379`. No path reaches
  `default:`. Keeping it wired to the same help text as the other four USAGE print sites is the
  right call for the next name added to the set.
- **`withBrokenPlugin` moved to `test-support.ts`, `as` cast replaced with narrowing.** ACCEPT
  for its original caller, with a caveat - see D4. `cli.test.ts:359` is the only prior caller
  and its behaviour is unchanged today, because `buildDiscoveryPorts` writes a repo manifest
  containing `dependencies` and nothing else.
- **`USAGE` gained a `plugin list` line and task 07's `EXPECTED_USAGE` pin was updated.** ACCEPT.
  The pin was updated deliberately and still pins: `EXPECTED_USAGE` (`cli.test.ts:46`) is an
  independent hand-typed copy, never an import of the live constant. **M13** - delete the two
  `plugin list` lines from `cli.ts`'s `USAGE` only - fails **14 tests**. A pin edited to match
  whatever the code emits would have failed none.
- **Task 11's missing-vs-malformed distinction.** HONOURED in code: `readPackageVersion` has no
  `try`/`catch`; a manifest declaring no `version` (or a non-string/empty one) returns
  `undefined` → `(unknown)`, while an unreadable or unparseable manifest propagates, matching
  `cli.ts`'s `isMissingPackageJsonError` reasoning. Not pinned by any test - see D2.

## Regression check

- `packages/cli/src/cli.ts` `main` with argv `['plugin','list']` → intercepted at `:361`, no
  longer unknown. Argv `['nonsense']` → real CLI prints `✗ no built-in command or installed
  plugin claims "nonsense" - run \`blogwright plugin list\` to see what is installed`, exit 1 :
  ☑ PRESERVED
- `packages/cli/src/plugins.ts` (`discover`) from task 10's dispatch path → the widened result
  changes no dispatch behaviour; `plugins.test.ts` 19/19 and the whole cli package 310/310 pass;
  the only edits to `plugins.test.ts` are three `toEqual` pins gaining `installed: []` :
  ☑ PRESERVED
- `KNOWN_COMMANDS` with `plugin` in it → task 09's reserved-name rejection unchanged
  (`RESERVED_COMMANDS` untouched; `plugins.test.ts:475` still passes) : ☑ PRESERVED
- `blogwright plugin list` outside a repo, or in a repo with no `package.json`, exits 1 with an
  actionable one-line message and no stack trace (verified against the real binary). `--help`
  degrades further and still prints usage; the asymmetry is deliberate and defensible - a
  listing without a manifest could only answer with a falsehood : ☑ PRESERVED

## Integration check

**This task changes no call sequence or output that another landed task pins.** Stated
explicitly, as required:

- The only code pin of `USAGE`/`--help` output in the repo is `EXPECTED_USAGE` in
  `cli.test.ts`, which this diff owns and updated. `grep -rl "preview teardown"` over the whole
  tree finds no second pin in code - the other hits are prose in `docs/` and `.specs/`.
- `DiscoveryResult` gained a field. The only `toEqual` pins of a whole discovery result are the
  three in `plugins.test.ts`, updated in this diff. No package outside `packages/cli` references
  `DiscoveryResult` or imports from the CLI (`grep` over `analytics`/`pds`/`core` → empty), as
  the hexagonal rule requires.
- No existing code path gains a call. `runPluginNamespace` calls `discover` once on a **new**
  path; `readPackageVersion`'s `fs.readText` calls occur only inside that new command. Built-in
  commands still load no plugin module.
- **Merge cleanliness.** The workspace is based on `0dc38d28` (26/62, task 16); the bookmark has
  since advanced to `dcfb0ea2` (28/62) with tasks 44 and 35. Those two touch only
  `packages/analytics/**` and `.specs/**` - **zero file overlap** with this task's eight files,
  all under `packages/cli/src/`. A plain merge is clean.

## Defects

- **D1 (medium, coverage - the review brief's named hazard).** `packages/cli/src/plugins.ts:330`
  - the provenance of `InstalledPlugin.packageJsonPath` is entirely unpinned. **M15**: replace
  `packageJsonPath: manifestPath.path` with a path derived from `resolve`'s entry file
  (`entry.path.replace(/\/[^/]+$/, '/package.json')`) → **310/310 cli tests still pass**, across
  the whole package, because every map-backed fixture puts `package.json` and `index.js` in the
  same directory. The property is load-bearing and its violation is silent, proven against the
  real binary: a real on-disk `blogwright-dual@7.7.7` with `exports: {".": "./dist/index.js"}`
  and a `dist/package.json` stub of `{"type":"module"}` lists as
  `dual blogwright-dual 7.7.7 dual` with the shipped code and
  `dual blogwright-dual (unknown) dual` with M15 applied - a plausible wrong answer for every
  dual-package-layout plugin, still exit 0. **The fixture that would catch it already exists**:
  `plugins.test.ts:668` ("discovers a plugin published with the dual-package layout…") builds
  exactly that package on real disk through the real loader and asserts only
  `result.plugins.map(p => p.name)`. One added assertion on
  `result.installed[0].packageJsonPath` kills M15 (verified: adding it fails that test under
  M15 and nothing else). It must be written as a suffix/`toMatch` check, not `toEqual(join(…))`
  - macOS realpaths the temp dir to `/private/var/…` while `makeTempDir` returns `/var/…`.
- **D2 (low, coverage).** `packages/cli/src/plugin-commands.ts:768` - the missing-vs-malformed
  distinction is implemented correctly but no test can fail if it regresses. **M14**: wrap the
  `JSON.parse` in `try { … } catch { return undefined; }` - the exact blanket catch task 11's
  note forbids → **77/77 pass**. Mitigating: the branch is close to unreachable in a single run,
  since `loadCandidate` read and parsed the same file successfully moments earlier in the same
  process, so only a TOCTOU race reaches it. The doc comment already says as much. Worth one
  test, or worth shortening the comment's claim.
- **D3 (low, coverage).** `packages/cli/src/render.ts` - the pretty branch of the failure
  heading is unexercised: both broken-plugin tests use `interactive: false`. **M25**: drop
  `colors.bold` from `lines.push(pretty ? colors.bold(FAILED_TO_LOAD_HEADING) : …)` → 77/77
  pass. Cosmetic only.
- **D4 (low, latent).** `packages/cli/src/test-support.ts` - the moved `withBrokenPlugin` writes
  `JSON.stringify({ dependencies: { … } })`, where the original spread `...repoPkg` first. Every
  other top-level field of the fixture repo manifest is now silently dropped. No behaviour
  change for its original caller today (`buildDiscoveryPorts` writes only `dependencies`), so
  the "confirm no behaviour changed" check passes - but `collectCandidates` reads
  `devDependencies` too (`plugins.ts:197`), so a future fixture seeding those would have them
  erased by this helper, and the helper's own comment ("has to JOIN whatever
  `buildDiscoveryPorts` already declared") then reads as a promise the code does not keep. The
  `as`-cast removal was worth doing; dropping the spread with it was not necessary.
- **D5 (completeness).** No changeset. A new user-facing command plus a changed `--help` body
  require one, per the plan's DoD baseline and O5's own evidence line. It should also correct
  a now-false sentence in the already-landed `.changeset/cli-help-plugin-sections.md`, which
  claims enriched help appears at "an unrecognised `blogwright plugin` (bare)" - task 17 removed
  that path, and `cli.test.ts:382` was rewritten in this diff to pin the new behaviour instead.
  (Note: the review brief described a nine-file diff; the diff is eight files. The absent ninth
  is most plausibly this changeset.)

## Falsifiability audit

All **11** `it` blocks added by this diff were shown to fail under at least one mutation - 2 in
`cli.test.ts`, 9 in `plugin-commands.test.ts`. No assertion in this diff is vacuous, and the
specific shape that shipped in task 14 (empty call lists against an empty filesystem) is
demonstrably absent here (M21). 24 mutations run, 21 killed, 3 survived (M14, M15, M25 - all
recorded above as D2, D1, D3). Every mutation was restored; restoration proven by
`shasum -a 256 -c` on all eight files and by a byte-identical `jj diff --git` against the
pre-verification dump.

## Residue

- The exit-0-for-a-broken-plugin choice is now settled and consistent with `--help`; tasks 18
  and 19 should not diverge from it when they add `add`/`remove` to `PLUGIN_NAMESPACE_ACTIONS`.
- `known-commands.ts`'s doc comment still describes `KNOWN_COMMANDS` as "the eight names" while
  the set holds nine. Pre-existing (task 10 added `plugin`), not introduced here; task 20's
  closure pass should correct it.
- `docs/src/content/docs/reference/cli.md` does not mention `plugin list`. Documentation is
  task 20's surface, not this task's.
- The version shown is the installed package's, not the SPI it was built against - the spec's
  open question, carried at task 20. `plugin list` still does not verify a plugin's `configKey`
  block is present in config; that is task 19's surface.

## Conclusion

CORRECTNESS: **CONCERNS** (confidence: high)
COMPLETENESS: **PARTIAL** (confidence: high)

VERDICT: ☑ PARTIAL
CONFIDENCE: ☑ high
SUMMARY: Every behaviour the task exists for is correct and demonstrably pinned - the headline
no-config/no-credentials property is proven twice over (M1 plus a real-binary run on an
unconfigured repo), all 11 new `it` blocks were shown to fail under mutation, and all six gates
are green - but the diff ships without the changeset O5 requires, and the `packageJsonPath`
provenance this task introduced survives a mutation that silently degrades every
dual-package-layout plugin to `(unknown)` in the real CLI, with the fixture that would catch it
already sitting unused in `plugins.test.ts:668`.
