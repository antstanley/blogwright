# Done Certificate - Task 47: The Plugin export, the manifest field, the command table, and the analytics init contributor

**Task:** [47-analytics_plugin_export_and_init.md](47-analytics_plugin_export_and_init.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 47. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 47) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/analytics/src/plugin.ts` default-exports a `Plugin` claiming the `analytics` namespace with `configKey: 'analytics'`, task 44's validator, an `init` contributor and a command table consistent with task 16's precedence, and `packages/analytics/package.json` declares the manifest field so the CLI discovers the package as a plugin.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the CLI's plugin discovery and boundary check (`packages/cli/src/plugins.ts` from task 08 and `validatePlugin` in `packages/core/src/plugin.ts`), the analytics package's existing named exports and build scripts from task 32, or task 44's config validator, which this task binds rather than reimplements.

## Verification environment

Workspace `/Users/ant/code/blogwright-task-47`, working copy `qrmrutow 900069b8` over parent
`uwuypuoz 85c7f096` (build 41/62). `jj st` shows exactly five files: `packages/analytics/package.json`
(M), `src/commands.ts` (A), `src/index.ts` (M), `src/plugin.test.ts` (A), `src/plugin.ts` (A).
Sources are 246 lines (`plugin.ts`) and 593 lines (`plugin.test.ts`), 28 `it` cases.

**This round verifies a delta** over the 2026-08-30 gate, which returned PARTIAL on D1 and D2.
Findings that round established and this delta did not touch are inherited: the verbatim
`validateConfig` binding and its stakes against the real host, task 19's absent-block path,
`Number(port)` being load-bearing, the `ANALYTICS_NAMESPACE` move, the decision not to prompt
`tableBucket`/`saltSecretName`, SPI consistency, the manifest field, the absent changeset, the
real `runPlugin('analytics', ['init'])` over the built `dist`, and the DoD-unsatisfiability
analysis (upheld, recorded in Residue as a plan defect).

**Falsifiability harness (this gate's own, not the caller's table).** A driver that, per mutation,
(a) aborts unless the anchor occurs **exactly once**, (b) aborts unless the file **hash changes**
after writing, (c) runs vitest under `--reporter=json` and names the failing cases, (d) restores
from a pre-verification copy and asserts the restored hash equals the pre-mutation hash. All four
controls were run before any result was trusted: a **green control** (comment insert → 28/28), a
**red control** (`configKey: 'analytix'` → 2 named failures), an **absent-anchor** abort, and an
**identical-write** abort. 34 mutations were then run. All mutations were reverted and the revert
proved by `shasum -a 256 -c` against a baseline of all five files, twice mid-run and once at the
end, plus a final `jj st` showing the same five entries and no stray file.

## Obligations

- **O1 - Default export, manifest field, and the discovery-shaped load.**
  - *Claim:* the package default-exports a `Plugin` with `name: 'analytics'`, a one-line description, `configKey: 'analytics'`, task 44's `validateConfig`, an `init` contributor and a `commands` table; `packages/analytics/package.json` carries `{ "blogwright": { "plugin": "analytics" } }`; and a test loads the package as CLI discovery does and passes it through `validatePlugin` by package name.
  - *Evidence collected:* `plugin.ts:207-245` declares all six members; `index.ts:30` is
    `export { default, ANALYTICS_NAMESPACE } from './plugin.js';`; `package.json:3-5` carries the
    manifest block. `pnpm --filter blogwright-analytics exec vitest run plugin --reporter=verbose`
    inside `packages/analytics` → **28 passed** (24 last round + the delta's four new cases).
    The discovery-shaped case (`plugin.test.ts:233`) calls `validatePlugin(analyticsModule,
    PACKAGE_NAME)` with `PACKAGE_NAME = 'blogwright-analytics'`, handing the whole MODULE - what
    `loadCandidate` hands it - not the default export.
  - *Delta re-checks:* the manifest field, the barrel re-export and the identity binding are all
    still pinned - `T1-manifest` (`"plugin": "analytix"`), `TI-barrel` (drop `default` from the
    barrel) and `T12-wrapper` (`(raw) => validateAnalyticsConfig(raw)`) each redden exactly the
    intended case. `T3-desc-empty` (`description: ''`) reddens the `validatePlugin` case.
    Inherited from the prior gate: the identity assertion, the reshaping-wrapper stakes against
    the real host, and the built-`dist` discovery run.
  - *Status:* ☑ SATISFIED

- **O2 - Command table matches task 16's precedence.**
  - *Claim:* the declared action set is exactly what task 16's precedence leaves to the plugin plus the spec's declared optional action (`status`, `dashboard` and `backfill`; neither `bootstrap`, `destroy`, nor `init`), collides with no generic verb the CLI owns, and every `summary` is non-empty, one help line long, and names `--yes` for any destructive action.
  - *Evidence collected:* re-confirmed against the CLI at this base -
    `plugins.ts:522` `RESERVED_LIFECYCLE_ACTIONS = new Set(['bootstrap', 'destroy'])` and
    `plugins.ts:480` `GENERIC_INIT_ACTION = 'init'`. `plugin.test.ts:81`'s
    `RESERVED_ACTIONS = ['bootstrap', 'destroy', 'init']` is therefore their union IN FULL, not a
    sample, and `status` is correctly excluded. Declared table (`plugin.ts:217-241`) is
    `status, dashboard, backfill`, each pointing at a named function in `commands.ts`.
  - *Delta check - D4, the help line brought under 80 columns.* **The cap itself was NOT widened.**
    `MAX_HELP_LINE_WIDTH` is `80` at `plugin.test.ts:93`, the same constant and value the prior
    gate recorded; what changed is the description, from a 76-character form (heading 90 columns)
    to a 66-character one (heading **exactly 80**, at the cap, not over). The test was widened in
    the right direction only - it now holds the plugin's own `  <name> - <description>` line to
    the same cap as the action lines (`plugin.test.ts:301-303`), in addition to, not instead of,
    the per-action cap at `:305-310`. Three mutations, three kills, all naming
    `gives the plugin and every action a one-line summary…`:
    - `D4-desc90` - restore the 90-column description → **RED**.
    - `D4-desc81` - a description one column over (heading 81) → **RED**; the boundary binds exactly.
    - `D4-action` - push one *action* summary over the cap → **RED**; the action half was not
      weakened by the widening.
    No information was lost in the shortening ("logs into an Iceberg table … over it" →
    "logs in an Iceberg table"), and the noun-phrase voice matches the sibling
    `PDS_DESCRIPTION` (task 25).
  - *Other checks:* `T5-reserved` (`backfill` → `destroy`) and `T6-initcmd` (`dashboard` → `init`)
    each redden the collision case and the exact-set case; `T4-order` reddens table order;
    `T7-nodes` (add `nodes: () => []`) reddens the task-54 gate case; `T8-runners` reddens the
    named-body case; `T9-tasknum` (task 55 → 57 in `commands.ts`) reddens the refusal-message
    case; `T11-yes` (add `--yes` to a summary) reddens the no-`--yes` case.
  - *Ruling on the end-to-end sub-item (inherited, upheld).* The DoD clause "an end-to-end test
    asserts `blogwright analytics init` reaches the generic splice path and writes the block" is
    **unsatisfiable as a committed test** - a test in `packages/analytics` would have to import
    `blogwright`, which bullet 4 forbids; a test in `packages/cli` would need
    `blogwright-analytics` in either dependency map, which `pluginDependencyNames`
    (`plugins.ts:218-228`) turns into a bundled discovery candidate. Recorded in Residue as a plan
    defect. The prior gate confirmed the property itself by driving the real `runPlugin` over the
    built `dist`; this gate re-confirmed the seal half of it directly (see O3).
  - *Status:* ☑ SATISFIED

- **O3 - `analytics init` returns a block and writes nothing.**
  - *Claim:* the contributor returns `ConfigBlockEntry[]` for both an all-defaults and a customised answer set, performs no filesystem write, and returns an empty array rather than `undefined` when declined.
  - *Evidence collected:* both init cases drive `createScriptedTerminal` through `runContributor`
    (`plugin.test.ts:195`); the all-defaults case asserts the five prompts INCLUDING their
    `[default]` suffixes and all four rendered entries; the customised case asserts the four
    properties. The decline case asserts `Array.isArray(entries)`, `toEqual([])` and that exactly
    one prompt was asked. Each is falsifiable: `T15-prompt`, `T17-render`, `T23-decline`,
    `T24-noninteractive`, `T21-nan`, `T22-padded` each redden the intended case.

  - *Delta check - D1, the two previously-unpinned prompt validators.* **Closed, and closed at the
    right level.**
    - `D1-table` (`validate: () => undefined` on `table`) → **RED on both** the new table pin
      (`plugin.test.ts:426`) *and* the new splice case (`:542`), exactly as required.
    - `D1-bots` (`validate: () => undefined` on `bots`) → **RED** on the new bots pin (`:449`).
    - The splice case asserts on **the composed document, not the prompt's return**:
      `plugin.test.ts:564-565` builds `composeDocument([renderBlock('analytics', entries)])` and
      asserts `not.toContain('tableBucket')` against *that*. It then **round-trips**:
      `parseConfigDocument(document)` → `pluginBlock` → `validateBlock` →
      `resolveAnalyticsConfig({ env: 'staging', … })` → `expect(resolved.tableBucket).toBe(
      'staging-example-analytics')` (`:569-575`) - the seal proved intact *with the environment
      carried*, not merely proved absent.
    - **The stakes were re-derived here, not taken on trust.** Against the built
      `packages/analytics/dist/config.js` and `packages/core/dist/index.js`, the document the
      wizard would compose for the answer `x", "tableBucket": "evil` was fed through the real
      pipeline: `parseConfigDocument` accepts it, `validateAnalyticsConfig` accepts it
      (`tableBucket` is a legitimate key and `evil` matches `TABLE_BUCKET_PATTERN`), and
      `resolveAnalyticsConfig` then returns `tableBucket = "evil"` for **both** `staging` and
      `production` - staging and production sharing one Iceberg table bucket, which is the
      staging-`destroy --yes`-deletes-production hazard in full. The seal at
      `config.ts:467` (`overrides.tableBucket ?? defaultTableBucket(site)`) is bypassed exactly as
      D1 described. The `table` prompt's validator is the only thing standing in front of it, and
      it is now pinned twice.

  - *Delta check - D2, the unfalsifiable assertion deleted.* **Correctly deleted, and the
    surviving half genuinely binds.**
    - `PluginInitIo` (`packages/core/src/plugin.ts`) names only `isInteractive`, `logger` and
      `ask` - **no `fs`** - re-read this round, so the DoD's "assert the in-memory `FileSystem`
      was not written" clause is structurally undischargeable and its deletion is right, not a
      loss of coverage.
    - The source-grep half (`plugin.test.ts:496-511`) binds against **real code**, not only
      comments. Three mutations, three kills, all naming `performs no filesystem write of its own`:
      `D2-writeText` (a genuine `await (io as …).fs.writeText(…)` behind an unreachable
      `if (defaults.namespace === '\0never')` branch) → **RED**; `D2-portsfs` (a real
      `shim.ctx.ports.fs` reference behind the same unreachable branch) → **RED**;
      `D2-nodefs` (`import * as nodefs from 'node:fs'`) → **RED**. The implementer's report of an
      unreachable real `writeText` reddening it is confirmed.
    - **No leftovers.** `grep` for `createRecordingFileSystem`, `SEED_CONFIG`, `MemoryFileSystem`,
      `createMemoryFileSystem` over `plugin.test.ts` → nothing. Every remaining import from
      `blogwright-core` is used; `pnpm lint` and `pnpm knip` are both clean (see O5), which is what
      would flag an orphaned import or helper.

  - *Delta check - `required: true` removed from all four prompts.* **Removed, unreachability
    correctly recorded, and no regression to the pins that existed.**
    - `grep -rn required` over `plugin.ts` returns only the doc paragraph at `:151-153`; no prompt
      carries the flag.
    - The unreachability claim was checked against the **real host**, not restated: `ask`
      (`packages/cli/src/init.ts:61-77`) substitutes the default at line 63
      (`(await terminal.question(…)).trim() || q.defaultValue`) *before* the `!answer` branch at
      :64 consults `q.required` at :65. Every one of the four defaults is a non-empty string, so
      the flag had no reachable effect. Removing it is a no-op on behaviour.
    - **M3/M4 do not regress:** `M3-namespace` (`validate: () => undefined` on `namespace`) →
      **RED** on `re-prompts with the message the config validator raises`; `M4-port`
      (`validate: () => undefined`) → **RED** on `quotes a non-numeric port back to the operator
      rather than NaN`. The implementer's report is confirmed.
    - The test stand-in's own `if (!question.required)` branch (`plugin.test.ts:150`) is retained
      deliberately and correctly: it restates the host's `ask`, which does have that branch, and
      `createInitIo`'s `?? ''` matches `buildInitIo`'s (`init.ts:95`) verbatim.

  - *Delta check - D3, the defaults mechanism pinned at source level.* **Sound instrument,
    partially binding implementation - see Finding D3'.**
    - The premise is correct: the four offered defaults are the same strings whether read off
      `validateAnalyticsConfig(undefined)` or restated, so **no behavioural test can distinguish
      them**, by construction. Provenance is a source-level property, and a source-level assertion
      is therefore the right *kind* of instrument, not a workaround - the same reasoning that makes
      D2's surviving grep the right instrument for "reaches no filesystem it is never handed".
      The file already carries that precedent and the new test states its reasoning
      (`plugin.test.ts:384-390`).
    - The named mutation does redden it: `D3-literal` (`defaultValue: defaults.namespace` →
      `'web'`) → **RED** on `offers defaults read off the validator, rather than literals restated
      here`, via the `defaults.`-prefix count at `:395`.
    - **But the headline counterfactual escapes.** `D3-call` - replacing
      `const defaults = validateAnalyticsConfig(undefined)` (`plugin.ts:168`) with a restated
      literal object, i.e. *literally the thing the test's title forbids* - leaves **28/28 green**.
      Cause: `expect(source).toContain('validateAnalyticsConfig(undefined)')` (`:392`) is satisfied
      by the **doc comment at `plugin.ts:145`**, which names the call in backticks and would not be
      touched by that refactor. That assertion cannot fail. Recorded as D3'.
  - *Other inherited checks (unchanged by the delta):* defaults come from the same call the CLI
    makes for an operator with no `analytics` key; `tableBucket`/`saltSecretName` are correctly not
    prompted; nothing reaches around the `ENV_DERIVED` seal; `Number(port)` is load-bearing
    (`T22-padded` and `T26-badjson` both redden).
  - *Status:* ☑ SATISFIED (D1 and D2 discharged; D3' recorded as a non-blocking finding)

- **O4 - No CLI type and no `blogwright` dependency.**
  - *Claim:* `PluginContext` from `blogwright-core` is the only host type the package imports, and `packages/analytics/package.json` depends on `blogwright` in neither `dependencies` nor `devDependencies`.
  - *Evidence collected:* `grep -rn "from 'blogwright'" packages/analytics/src/` → no output
    (exit 1). `dependencies` = `['blogwright-core']`; `devDependencies` =
    `['@types/node', 'oxlint', 'typescript', 'vitest']`. `plugin.ts:70` imports only
    `ConfigBlockEntry, Plugin, PluginInitIo` (types) from `blogwright-core`. `pnpm-lock.yaml` is
    unmodified in `jj st`. Falsifiable: `T2-dep` (add `"blogwright": "workspace:*"` to
    `devDependencies`) → **RED** on `names the CLI package in neither dependencies nor
    devDependencies`.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the **workspace root**, in `ci.yml` order:
    - `pnpm build` → all packages Done.
    - `pnpm typecheck` → 6 projects Done.
    - `pnpm test` → core 149 passed / 1 skipped, build-agent 27, pds 117, **analytics 468**
      (464 + the delta's four), cli 346 - **1107 passing, 0 failing**.
    - `pnpm lint` → exit 0; `packages/analytics lint: Done` with **no analytics warnings**. The
      only warnings in the run are the pre-existing `no-shadow` notes in
      `packages/cli/src/nodes.test.ts`, a file this task does not touch.
    - `pnpm exec oxfmt --check .` → "All matched files use the correct format", 177 files.
    - `pnpm knip` → exit 0, no findings (this is what would catch an orphan left by D2's deletion).
    Limits are named constants (`MAX_ATTEMPTS`, `HELP_LINE_INDENT`, `PLUGIN_LINE_INDENT`,
    `MAX_HELP_LINE_WIDTH`, `YES_ANSWERS`).
  - *Falsifiability (the baseline's "watch it fail" obligation).* **Every one of the 28 `it` cases
    was reddened by at least one mutation** - the walk is complete, not sampled. 34 mutations were
    run under the guarded harness described above: **33 killed**, naming the intended case;
    **1 survived** (`D3-call`, Finding D3'). The four cases the delta added are each falsifiable:
    the table pin and the bots pin by `D1-table`/`D1-bots`, the splice case by `D1-table` (and
    `T26-badjson`), the defaults-source case by `D3-literal`.
  - *Reproduction claim (spot-checked, and it holds).* The implementer's claim that the D1 gap was
    **real rather than inferred** was reproduced independently. The pre-delta test file was
    reconstructed by removing exactly the four delta-added `it` blocks
    (`:383-397`, `:426-448`, `:449-468`, `:542-581`), yielding **24 `it` cases, 24/24 green** -
    the prior round's count. Against that reconstruction:
    | validator removed | pre-round result |
    |---|---|
    | `table` | **24 passed (SURVIVED)** |
    | `bots` | **24 passed (SURVIVED)** |
    | `namespace` | 1 failed \| 23 passed |
    | `port` | 1 failed \| 23 passed |
    This matches the implementer's report exactly: `table` and `bots` were unpinned, `namespace`
    and `port` were not. The reconstruction is 495 lines against the reported 514; the 19-line
    difference is precisely the D2 material (`createRecordingFileSystem`, `SEED_CONFIG_PATH` and
    the memory-`FileSystem` half) that the implementer's reconstruction restored and this one did
    not - and that material cannot affect a green/red outcome, since it could not fail. The
    reconstruction is therefore consistent, and the finding is confirmed real.
  - *Changeset.* None shipped, and that remains correct: task 58's DoD owns the single new-package
    entry, and no analytics task 32-46 shipped one either.
  - *Status:* ☑ SATISFIED. The falsifiability clause held open at D1 and D2 last round is now
    **discharged at both**; one new minor instance is recorded as D3'.

- **O6 - Run the plugin tests inside `packages/analytics` and confirm the discovery-shaped case, the collision list and the manifest block (Reviewable).**
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run plugin --reporter=verbose`
    from `packages/analytics` → **28/28 passed**, every case named in the verbose output.
    The discovery-shaped case names `blogwright-analytics` in its `validatePlugin` call
    (`PACKAGE_NAME` constant, `plugin.test.ts:63`, used at `:233`). The collision test enumerates
    `['bootstrap', 'destroy', 'init']` - re-derived this round as exactly
    `RESERVED_LIFECYCLE_ACTIONS` (`plugins.ts:522`) ∪ `GENERIC_INIT_ACTION` (`plugins.ts:480`),
    the set in full rather than a sample. `grep -n '"blogwright"' packages/analytics/package.json`
    → **line 3 only**, the manifest block, no dependency entry.
  - *Status:* ☑ SATISFIED

## Findings

- **D1 - CLOSED.** Both prompt validators are now pinned, and pinned at the level that matters.
  `() => undefined` on `table` reddens the table pin *and* the splice case; on `bots`, the bots
  pin. The splice case asserts against the composed document and round-trips through
  `parseConfigDocument` → `validateBlock` → `resolveAnalyticsConfig` with the environment carried.
  The hazard was re-derived against the built `dist` this round: a spliced `tableBucket` survives
  the re-parse and the validator and yields the **same env-less bucket for staging and
  production**. Verified fixed.

- **D2 - CLOSED.** The memory-`FileSystem` half and `createRecordingFileSystem` are gone, no
  orphaned import or helper remains (`lint` and `knip` both clean), and the surviving source-grep
  half binds against real code for all three tokens (`writeText`, `ports.fs`, `node:fs`), each
  behind an unreachable branch so the mutation is a pure source-level change. `PluginInitIo` was
  re-read and carries no `fs`, so the DoD clause it replaced is genuinely undischargeable.
  Verified fixed.

- **D3' - one assertion that cannot fail, newly introduced by this delta (non-blocking).**
  `packages/analytics/src/plugin.test.ts:392` -
  `expect(source).toContain('validateAnalyticsConfig(undefined)')`.
  The string occurs **twice** in `plugin.ts`: at `:168` (the code the assertion exists to guard)
  and at `:145` (a doc comment naming the call in backticks). Deleting the call therefore leaves
  the assertion green.
  *Concrete failure scenario:* a later task rewrites `askAnalyticsBlock` to drop the `config.js`
  import and inlines the defaults as
  `const defaults = { namespace: 'web', table: 'page_views', bots: 'flag', dashboard: { port: 4317 } };`,
  keeping the four `defaultValue: defaults.X` reads. This is exactly what the test's title forbids
  ("rather than literals restated here"). Verified: **28/28 stay green** (`D3-call`). Task 44 then
  changes `DEFAULT_NAMESPACE` and the wizard silently offers the stale value, which is the drift
  the test was written to make visible.
  *Judgement on the instrument:* a source-level assertion is the **right kind** of instrument here
  - provenance is not observable behaviourally, by construction, and the file already uses the same
  technique correctly for D2 - so this is not a workaround. The *implementation* is half-bound: the
  `defaults.`-prefix count at `:395` does catch inlining at each `defaultValue`, which is why
  `D3-literal` reddens, but nothing catches the `defaults` binding itself changing provenance.
  *Fix (one line):* strip comment lines before the `toContain`, e.g. assert against
  `source.split('\n').filter((l) => !l.trimStart().startsWith('*'))`, or assert on the code line
  directly - `expect(source).toContain('const defaults = validateAnalyticsConfig(undefined)')`.
  Not blocking: the *property* remains double-pinned behaviourally - `offers the task 44 defaults…`
  (`:360`) asserts the four offered values verbatim and `resolves end to end…` (`:338`) asserts the
  same four from task 44's side, so a defaults change reddens both together. The prior gate had
  ruled this mechanism needed no pin at all; the delta's attempt is a net improvement that stops
  short of its own title.

- **D4 - CLOSED.** The cap was not widened - `MAX_HELP_LINE_WIDTH` is still `80`; the description
  was shortened from 76 to 66 characters (heading 90 → exactly 80). Restoring the 90-column form
  reddens, a description one column over reddens, and an over-long *action* summary still reddens,
  so widening the test to cover the description line did not weaken the action half.

## Regression check

- `packages/cli/src/plugins.ts` (task 08 discovery) reads the manifest field and loads the module :
  ☑ **PRESERVED** - inherited from the prior gate's built-`dist` run; unchanged by this delta, and
  the reserved-verb constants were re-read at this base and still match the test's list.
- `packages/analytics/src/index.ts` re-exported named symbols (task 32's seeded barrel) imported by
  an existing package test → the four `export *` lines are untouched; `index.test.ts` is unedited
  and passes; the whole workspace suite is green (1107 passing) :
  ☑ **PRESERVED**
- *Prompt pins not regressed by the `required: true` removal* → `M3-namespace` and `M4-port` both
  still redden their named cases, and the removal was proved a behavioural no-op against the real
  `ask` (`init.ts:63-65`) :
  ☑ **PRESERVED**
- *Test-suite growth accounted for* → analytics 464 → 468, exactly the four cases the delta adds;
  no case was removed except D2's unfalsifiable half, which was not a passing behavioural check :
  ☑ **PRESERVED**
- *Integration with the build bookmark and the in-flight task.* `plugin-system-and-analytics` is at
  `yrkzxmyr 1c883882` (**build 44/62**, tasks 43 and 25 landed); this workspace's base is build 41.
  The only file both touch is `packages/analytics/package.json`: task 47 inserts the `blogwright`
  block after `name`, build 44 rewrites `scripts.build` for rolldown and adds `@duckdb/node-api`
  and `rolldown`. `git merge-file --diff3` over base / build-44 / task-47 exits **0**, no conflict
  markers, and the merged file is **valid JSON carrying both changes** (`blogwright` field present,
  rolldown build script present, duckdb and rolldown deps present, and `blogwright` still absent
  from both dependency maps). `packages/analytics/src/index.ts` is **byte-identical at builds 41
  and 44**, so that edit merges trivially. None of task 47's three new files
  (`plugin.ts`, `plugin.test.ts`, `commands.ts`) exists at build 44 - no add/add collision.
  Task 50 is in flight on `packages/analytics/src/nodes.ts`, which this task does not touch
  (`plugin.ts` declares no `nodes` and imports only `./commands.js` and `./config.js`).
  `packages/analytics/tsconfig.json`, `tsconfig.json`, `knip.json` and `pnpm-lock.yaml` are all
  **untouched** by this task (`jj st` shows five files) :
  ☑ **PRESERVED**

## Residue

- **Plan defect (recorded, not a task failure; carried forward unchanged).** DoD bullet 2's
  requirement for an end-to-end test that `blogwright analytics init` reaches the generic splice
  path cannot be met by any committed test: bullet 4 of the same DoD forbids the plugin importing
  `blogwright`, and the CLI cannot devDepend on `blogwright-analytics` without turning it into a
  bundled discovery candidate (`plugins.ts:218-228`). The plan should either drop the clause or
  route the property to an out-of-`packages/` harness in the shape of `type-claims/`. The property
  holds - the prior gate drove the real `runPlugin` over the built `dist` - but nothing in CI
  holds it.
- **D3'** above: one line in `plugin.test.ts:392` to fix when the file is next touched.
- *Cross-task observation, not a defect here.* Task 47 now holds its plugin heading to 80 columns
  while the sibling `pds` plugin (task 25, build 44) ships an 88-character `PDS_DESCRIPTION`,
  rendering at 96 columns. Task 47 is the stricter of the two; the build may want one convention.
- The `status`, `dashboard` and `backfill` bodies (`commands.ts`) raise naming tasks 55, 56 and 61;
  the test pins all three sentences (`T9-tasknum` reddens it). `blogwright --help` will advertise
  three actions that currently refuse - the task's stated intermediate state.
- Task 54 must flip `expect(analyticsPlugin.nodes).toBeUndefined()` (`plugin.test.ts:272`), which
  names task 54 in its title and comment (`T7-nodes` reddens it).
- `ANALYTICS_NAMESPACE`'s move into `plugin.ts` remains justified (prior gate reproduced the
  counterfactual cycle as a real `ReferenceError`); `index.test.ts` is unedited and green.
- Changeset: deliberately none. Task 58's DoD owns analytics documentation and changeset coverage.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: high
SUMMARY: All six obligations hold, and the two points that held O5's falsifiability clause open
last round are discharged and independently re-verified - D1's `table` and `bots` validators are
now pinned, with the splice case asserting on the composed document and round-tripping through the
real parse/validate/resolve chain (the env-less-`tableBucket` hazard re-derived against the built
`dist`, sharing one bucket across staging and production); D2's unfalsifiable assertion is deleted
with no orphans and its surviving grep binds against real code for all three tokens; D4 shortened
the description rather than widening the 80-column cap, and the boundary binds exactly; and
`required: true` is gone from all four prompts with the unreachability proved against the real
host `ask` and no regression to the `namespace`/`port` pins. The pre-round gap was reproduced
independently - `table` and `bots` removal left 24/24 green on a 24-case reconstruction, `namespace`
and `port` did not - confirming the finding was real. All 28 `it` cases were reddened by at least
one of 34 guarded mutations (33 killed, 1 survived), all six CI gates are clean from the workspace
root, the `Reviewable:` line and its greps are discharged, and a plain merge onto build 44 is clean
with `tsconfig.json`, `knip.json` and `pnpm-lock.yaml` untouched. The single survivor - D3's
`toContain` guard, satisfied by a doc comment so that restating the defaults as literals leaves
28/28 green - is a redundant assertion inside an otherwise-binding test whose property is pinned
twice behaviourally, so it is recorded as a one-line follow-up rather than held against the task.
