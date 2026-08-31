# Done Certificate - Task 29: Delete runPds and route `blogwright pds` through generic plugin dispatch

**Task:** [29-cli_remove_runpds_dispatch.md](29-cli_remove_runpds_dispatch.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 29. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 29) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright pds <action>` is answered by the plugin's declared commands with no pds knowledge left in `cli.ts`, multi-word `secret status`/`secret delete` are declared rather than hand-shifted, and the post-deploy sync is provably intact.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the six pds commands as users invoke them, the `preview` and built-in command branches in `packages/cli/src/cli.ts:107-121`, the post-deploy sync at `packages/cli/src/commands.ts:97`, or the `blogwright/rkey` re-export at `packages/cli/src/rkey.ts:7`.

## Validation record

Validated in the task workspace `/Users/ant/code/blogwright-task-29` (jj, parent = build 49
`zzqqpprn 917c26eb`). Diff is five paths, as claimed. The implementer's mutation table was NOT
accepted; an independent battery of eleven mutations was run with a green control before and a
byte-identical `jj diff --git` restore after (`diff` against the pre-mutation patch: identical,
verified twice). No code was edited outside the mutations, and this file is the only thing written
under `.specs/`.

**Control (pre-mutation, workspace root):** `pnpm build` clean · `pnpm test` 1327 passed
(cli 363/363) · `pnpm lint` exit 0 (pre-existing `no-shadow` warnings in `nodes.test.ts`, untouched
file) · `pnpm exec oxfmt --check .` clean, 191 files · `pnpm knip` exit 0, no output ·
`pnpm typecheck` clean.

**Independent mutation battery** (all restored; each run from `packages/cli/node_modules/.bin/vitest`
to avoid the pnpm manifest-verification relink hazard):

| # | Mutation | Result | Reads |
|---|---|---|---|
| M1 | Restore `import * as pds`, the `command === 'pds'` branch ahead of the `KNOWN_COMMANDS` test, `PdsValues` and `runPds` verbatim | **11 failures**, all in `main - pds dispatch (generic, through runPlugin)` | The plugin path is load-bearing, not shadowed by a leftover branch. Reproduces the implementer's count exactly. The one case in that block that survives is the `--help` rendering case, which does not go through dispatch - correct. |
| M2 | `matchAction`: `command.action.split(' ')` → `[command.action]` | **6 failures** (5 in `cli`, incl. all three multi-word pds cases; 1 in `plugin-commands.test.ts`) | Multi-word matching is by declaration. Reproduces the implementer's "5 tests" under the `cli` reviewable filter. |
| M3 | `validatePdsConfig`: `raw as PdsConfig` → `(raw ?? {}) as PdsConfig` (the obvious task-28 fix) | **1 failure**: the task-28 pin, at `cli.test.ts:1433` `expect(cause).toBeInstanceOf(TypeError)` - `expected Error: config.pds.name is required to be an instance of TypeError` | The pin genuinely fails under the fix. Task 28 cannot ignore it. |
| M4 | `runPlugin`: `rest.slice(match.wordCount)` → `rest.slice(1)` | **5 failures**, incl. `pds secret status staging` | Env positional is resolved past the *matched* action's word count. |
| M4b | `runPlugin`: `values.env ?? envPositional ?? DEFAULT_ENV` → `values.env ?? DEFAULT_ENV` (the "silently targets production" regression the DoD names) | **7 failures**, incl. both new pds `staging` cases | The environment-positional regression cannot ship green. |
| M5a | `commands.ts`: drop `await syncAfterDeploy(ctx)` | **1 failure**: `runs the sync for production with a pds block` - and nothing else in the repo | The new deploy case is the ONLY thing in the repo that catches deletion of the post-deploy sync. Before this task the deletion was silent. |
| M5b | `syncAfterDeploy`: remove the `ctx.env !== 'production' \|\| !ctx.config.pds` guard | **2 failures**: both skip cases | The two skip cases assert the sync was not reached, not merely that nothing threw. `packages/pds`' own suite does not catch this either. |
| M6 | `packages/cli/package.json`: move `blogwright-pds` to `optionalDependencies` | **3 failures**, incl. `keeps blogwright-pds a non-optional dependency of the CLI package` (and two `plugins.test.ts` discovery cases) | The dependency assertion is real and reads the source manifest. Restored before any pnpm invocation; no relink was needed. |
| M7 | `renderActions`: drop the generic lifecycle lines | **4 failures**, incl. both pds refusal cases | The refusal listing is pinned including the three lifecycle verbs. |
| M8 | `cli.ts`: delete `identifier: { type: 'string' }` from the option table | **2 failures**, incl. `pds login --identifier alice.example` | The flag's survival at `cli.ts` is pinned; deleting it as "unused" fails. |
| M9 | `packages/pds/src/plugin.ts`: change the `secret status` **summary** | **3 failures** (both refusals + the `--help` case) | The fixture is the shipped plugin and the summaries are pinned hand-typed. |
| M10 | `packages/pds/src/plugin.ts`: change the `secret status` **action string** to `secret` | **5 failures** | The six declared action strings dispatched against are the shipped ones, not a fixture's. |

**Execution against the real binary.** A throwaway consuming repo (`.git`, a `package.json`
depending only on `blogwright`, `node_modules/blogwright` symlinked to `packages/cli`) driven with
`node packages/cli/dist/bin.js`:

- `--help` → exit 0, `Plugins:` section renders `pds - standard.site (AT Protocol) publishing: …`
  followed by all six actions with their one-line summaries and the three lifecycle verbs.
- `pds bogus` → exit 1, stderr `✗ unknown pds action: bogus`, stdout `"pds" actions:` + nine lines.
- `pds` (bare) → exit 1, stderr `✗ unknown pds action: (none)`, same listing.
- The widened first-run message was reproduced exactly against the built packages:
  `plugin "pds" rejected the "pds" config block: Cannot read properties of undefined (reading 'name')`,
  `cause` a `TypeError`. `bin.ts` prints `err.message` only, so no stack leaks.

## Obligations

- **O1 - `cli.ts` holds no pds knowledge.**
  - *Claim:* `packages/cli/src/cli.ts` has no `runPds`, no `PdsValues`, no `blogwright-pds` import, no `command === 'pds'` branch, and no static pds lines in `USAGE`.
  - *Evidence collected:* `grep -in "pds" packages/cli/src/cli.ts` → **zero hits, exit 1** (file is 560 lines). The diff removes the namespace import (`:4`), `PdsValues`, `runPds` and the `command === 'pds'` branch, and touches no line of `USAGE` - task 26 had already stripped the static block (verified: `jj diff -r slnlzpkwynmv packages/cli/src/cli.ts` removes `pds login --identifier <handle-or-did>`), so this is not the first commit at which help is correct. The `identifier` flag survives in the option table with a comment explaining why it may not be deleted as unused; M8 proves the comment is load-bearing.
  - *Status:* ☑ SATISFIED

- **O2 - Dispatch reaches the same functions with the same arguments, and refuses the same way.**
  - *Claim:* `pds sync` reaches `sync`; `pds secret status` and `pds secret delete --yes` reach `secretStatus`/`secretDelete` with the right options via the declared multi-word action and no positional shifting; `pds login --identifier alice.example` passes the identifier through; `blogwright pds` and `blogwright pds bogus` exit non-zero with a message of the same shape as today.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` → 45/45 pass. The `main - pds dispatch (generic, through runPlugin)` block holds twelve cases (the DoD's six, plus the two environment-positional regressions, the closed 26→29 gap, the `--help` rendering pin, the unclaimed-namespace case and the task-28 pin). Every success case asserts through `reached(calls)` = `{ action, args }` **plus** `contexts.map(ctx => ctx.env)` - arguments and environment, not exit code alone: `sync`/`[]`/`production`; `login`/`['--identifier','alice.example']`; `secret status`/`[]`; `secret delete`/`['--yes']`; `sync`/`[]`/`staging`; `secret status`/`[]`/`staging`. Both refusals assert `code === 1`, `errors === ['✗ unknown pds action: …']` (task 07's shape, verified on the real binary) and `calls === []`.
  - *Checks resolved:* `secret status` is matched by the plugin's declared two-word action. `matchAction` (`plugin-commands.ts:232-252`) splits `command.action` on spaces and takes the longest match; `runPlugin` then slices `rest` by `match.wordCount`. There is **no** `positionals[2]`/`positionals[3]` index arithmetic on plugin actions anywhere in `plugin-commands.ts`. M2 and M4 each break exactly the multi-word behaviour and fail; M10 proves the action strings under test are the shipped ones.
  - *One deliberate shape change, verified:* `secret delete --yes` now reaches the plugin as the token `['--yes']` rather than an options object `{ yes: true }`; the plugin's own `run` reads `args.includes('--yes')` (`packages/pds/src/plugin.ts`). Observationally identical.
  - *Status:* ☑ SATISFIED

- **O3 - `--help` still documents all six actions, and any lost guidance is named.**
  - *Claim:* `blogwright --help` lists all six pds actions with one-line summaries built at runtime from the plugin's `description` and its commands' `summary` fields, and any guidance lost relative to the current multi-line `pds login` / `pds sync` text is named in the commit description.
  - *Evidence collected:* the real-binary `--help` run above (not only the test) prints all six with summaries plus the three lifecycle verbs, sourced from the plugin object. The test pin `EXPECTED_HELP_WITH_PDS` is hand-typed, not derived - M9 (changing one shipped summary) fails it. Guidance lost relative to `cli.ts:33-47` was lost at **task 26**, whose changeset `.changeset/pds-discoverable-as-a-plugin.md` enumerates all five omissions verbatim; task 29's changeset states "No help text is lost beyond what the previous release already named" - verified true, since this diff does not touch `USAGE`.
  - *Status:* ☑ SATISFIED

- **O4 - The post-deploy sync path is intact and its wart is recorded.**
  - *Claim:* `packages/cli/src/commands.ts:2` still statically imports `syncAfterDeploy`, `blogwright-pds` is still a non-optional `dependencies` entry, the reason is recorded at the import, and a test asserts `deploy` reaches `syncAfterDeploy` for `env === 'production'` with a `pds` block and skips it otherwise.
  - *Evidence collected:* `packages/cli/src/commands.ts:2-25` carries a 24-line comment giving both reasons (the SPI declares `commands`/`nodes`/`configKey`/`validateConfig`/`init` and no post-deploy hook - confirmed against `blogwright-core`'s `plugin.ts`; and the package ships non-optionally). `import { syncAfterDeploy } from 'blogwright-pds'` at `:26`; the single call at `:240`. `packages/cli/package.json` still declares `"blogwright-pds": "workspace:*"` under `dependencies` and has no `optionalDependencies` block at all. Four new `commands.test.ts` cases run the **real** `commands.deploy` end to end against a memory filesystem and stub AWS clients - the first deploy test in the repo - observing `syncAfterDeploy`'s own unique "not initialised" line and confirming the deploy still completed (`deployed <hash> in …`).
  - *Non-vacuity proven:* M5a (drop the call) fails only the production case, while the `deployed …` assertion still passes - so the failure is specifically the missing sync, and nothing else in the repository caught the deletion. M5b (remove the guard) fails **both** skip cases, so they assert the sync was not reached rather than that nothing threw. M6 fails the manifest case.
  - *Check resolved:* `syncAfterDeploy` at `commands.ts:240` binds to the module-scope static import, not to a dispatch lookup - M5a's edit at that one line is what changes the observed behaviour.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates run from the workspace root, clean (control block above), and re-run clean after every mutation was restored. `pnpm knip` raises nothing after the namespace import is gone and does not flag `blogwright-pds` as an unused CLI dependency. A changeset exists (`.changeset/pds-dispatched-as-a-plugin.md`, `blogwright: minor`) and names the known issue explicitly under "Known issue on an unconfigured repo", with both the old and the new message spelled out.
  - *Exception recorded:* the mechanical gates are clean, but the change leaves **eight source comments and two test titles describing the branch it deleted** (see Defects, D1). No gate can catch this; it is quality debt, not a behaviour defect, and three of the sites name task 29 as their owner.
  - *Status:* ☑ SATISFIED (with D1 recorded)

- **O6 - Reviewable: `pnpm test -- cli`, `pnpm knip`, and a zero-hit grep (Reviewable).**
  - *Claim:* a reviewer can run the reviewable commands and see zero grep hits, passing dispatch cases, and `--help` naming all six actions.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` → 45/45 pass, twelve pds dispatch cases named individually in the output. `pnpm knip` → exit 0, no output. `grep -n "pds" packages/cli/src/cli.ts` → empty, exit 1. `--help` captured from the real binary, naming all six actions with summaries.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/bin.ts` calls `main(argv, …)` with `['pds', 'secret', 'delete', '--yes']` → `secret delete` reached with `['--yes']`, exit 0 : ☑ PRESERVED (asserted; M2/M4 both break it)
- `packages/cli/src/bin.ts` calls `main(argv, …)` with `['pds', 'sync', 'production']` → environment positional still resolved now that the shift is gone : ☑ PRESERVED (the stronger `staging` cases are asserted for both the one-word and the two-word action; M4b proves they fail if the positional is dropped)
- `packages/cli/src/commands.ts` `deploy` for `env === 'production'` with a `pds` block → `syncAfterDeploy` invoked : ☑ PRESERVED (newly asserted; M5a/M5b prove non-vacuity)
- `cli.ts`'s `preview` branch and the `KNOWN_COMMANDS` membership test → unchanged by the pds removal : ☑ PRESERVED (the diff touches neither; `main - preview dispatch`'s two cases and the whole `main - generic plugin dispatch` block pass unchanged)
- `packages/cli/src/rkey.ts:7` re-export → ☑ PRESERVED (untouched; `rkey.test.ts` green)

## Integration

- **Merge onto the bookmark is clean.** `plugin-system-and-analytics` has advanced past build 49 to
  `wvqmnzvr f0e301d2` (build 50 - task 51 landed). `jj new @ plugin-system-and-analytics` produced an
  **empty** merge commit: no conflicts, zero path overlap (task 51 is `packages/analytics/**` and
  plan paperwork only). All six gates were re-run on the merged tree and are clean -
  analytics 691/691, cli 363/363, knip 0, oxfmt clean. The probe was abandoned and the workspace
  restored; `jj diff --git` is byte-identical to the pre-review patch.
- **Task 57** (in review) touches `.oxfmtrc.json`, `.oxlintrc.json`, `knip.json` and
  `packages/analytics/**`. No overlap with `packages/cli/**`; task 29 touches no root config file.
- **`commands.test.ts`'s pre-existing call sequences are untouched.** The diff to that file is two
  widened import lists and a `+155`-line append after the existing final `describe`. No existing
  test body, assertion or fixture is modified or deleted.

## Residue

The two deliberate behaviour changes were both verified as *replacements*, not weakenings:

- The refusal keeps its exit code and `unknown pds action: …` shape but prints `renderActions`'
  plugin listing instead of the whole of `USAGE`. Task 26's case pinning "an unknown pds action
  prints USAGE with a plugin section appended" was correctly **deleted**, because no such path
  exists: `cli.ts` has four `helpText()` call sites left and none of them is in a namespace branch.
  The property that an error path shows a discovery-fresh USAGE **does** survive elsewhere - it is
  still pinned at `cli.test.ts:1456` for `preview` (`EXPECTED_HELP_WITH_WIDGET`) and at `:427` for
  `--help` itself. `main`'s unknown-command switch default is documented and genuinely unreachable
  past the `KNOWN_COMMANDS` test, so no test can drive it; it stays wired to the same helper.
- `pds bootstrap` now runs the verb its help advertises. The replacing case asserts exit 0 and
  `runGenericBootstrap`'s two log lines positively, and that none of the six declared commands ran -
  strictly stronger than a weakened version of the old refusal assertion. M1 fails it. It reconciles
  an empty graph (the fixture seeds only `configDocument`, and `buildPdsNodes` reads `ctx.config.pds`),
  so it proves dispatch reaches the generic verb, not that pds's IAM node reconciles - which is
  proportionate and covered elsewhere.

The widened first-run exposure is ruled **acceptable to land** - see Defects, D2 for the reasoning
and the routed follow-ups. The task-28 pin was verified to fail under the obvious fix.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied on evidence - a zero-hit grep, twelve dispatch cases each
asserting arguments and environment over the shipped plugin object, `--help` and both refusals
captured from the real binary, and four non-vacuous deploy cases - with an independent eleven-mutation
battery (green control, byte-identical restore) confirming every one of them fails when the property
it names is broken; the only outstanding items are documentation debt (D1) and a disclosed,
pinned, pre-owned message regression that cannot reach a release before task 28 (D2).

## Defects and routed items

**D1 - CONCERNS: eight source comments and two test titles now describe a branch that no longer
exists; three of them name task 29 as their owner.** Documentation only - no behaviour, all gates
green - but this is the "one place fixed, echoes stale" pattern plan.md line 1212 already records as
a recurring finding in this build, and the implementer reworded exactly the three sites inside
`cli.ts` and stopped at the file boundary. The three cli.ts rewordings were checked and **are now
true**: `helpText`'s "four call sites" matches the four live `helpText(` sites at `cli.ts:335`
(`--help`/bare), `:490` (`main`'s switch default), `:520` and `:556` (`runPreview`'s two); both
`DiscoveryPortsFactory` comments match. The sites left behind:

- `packages/cli/src/plugins.ts:36-44` and `packages/cli/src/known-commands.ts:45-56` - the same
  paragraph, duplicated in two modules: *"The hardcoded `command === 'pds'` branch in `cli.ts`
  (ahead of its `KNOWN_COMMANDS` membership test) already shadows any plugin that declares the name
  `pds` … Reserving `pds` here now would fix a problem this module does not have (nothing here lets
  `pds` through unchecked; `cli.ts` intercepts it first) while creating one task 29 would then have
  to undo."* **The most consequential of the set.** The conclusion (`pds` stays unreserved) is still
  right, but the stated *reason* is now false in both halves, and the real reason - that reserving
  `pds` would make `discover` reject the bundled `blogwright-pds` as a namespace collision, killing
  `blogwright pds <anything>` and the `--help` section outright - is written nowhere. Failure
  scenario: a future reader tidying `RESERVED_COMMANDS` reads "cli.ts intercepts it first", concludes
  the omission was a transitional hack that task 29 was meant to undo, adds `pds`, and breaks every
  pds command; only the two "does not reserve pds" tests stand between that edit and a broken CLI,
  and the comment argues *for* making it.
- `packages/cli/src/plugin-commands.ts:22-23` - *"never by the hand-rolled positional shifting
  `runPds` still does at `cli.ts:196` until task 29 deletes it."* A forward note addressed to this
  task, citing a line number that no longer exists.
- `packages/cli/src/known-commands.ts:20` - *"`cli.ts` (the dispatcher - it pulls in every command
  implementation **and the bundled `blogwright-pds` package**)"*. False as of this diff.
- `packages/pds/src/index.ts:9` - *"the CLI's own `runPds` branch still reaches all six command
  functions the same way."* False.
- `packages/pds/src/plugin.ts:111` - *"the positional shifting `runPds` hand-rolls"* (present tense).
- `packages/pds/src/plugin.ts:186-189` - *"Inert until `package.json` declares the
  `blogwright.plugin` manifest field … so `blogwright pds <action>` still routes through the CLI's
  own `runPds` branch."* Doubly false: the manifest field landed at task 26, and the branch is gone.
- `packages/cli/src/plugins.test.ts:629` (test title) - *"(cli.ts's hardcoded branch is the only
  thing shadowing it, until task 29)"*. This *is* task 29.
- `packages/pds/src/plugin.test.ts:29,234` - *"the CLI's own `runPds` set"*, *"the six actions runPds
  accepts today"*. Weakest of the set; historical phrasing rather than a false guarantee.

**D2 - RULING on the widened first-run exposure: acceptable to land, as pinned.** The report is
accurate and complete; I reproduced both messages and both code paths.

- *Severity confirmed as message-only.* Every one of the six commands did already refuse without a
  `pds` block. `login` is the near-miss - it does not call `requirePdsConfig` itself - but reaches
  `verifyClientAssets`, whose first statement is `requirePdsConfig(ctx)` (`packages/pds/src/oauth.ts:118`).
  Exit code (1), absence of side effects, and the no-stack-trace error surface are all unchanged;
  `bin.ts` prints `err.message` only.
- *Reachability is narrower than "any first run".* `createContext` calls `sts.getAccountId()` before
  `resolvePluginConfig`, so an operator needs valid AWS credentials and a config file for the
  environment to reach either message. That was equally true before, so the comparison is honest.
- *It was already task 28's, before task 29 existed.* `backlog/28-pds_config_validation_timing.md`
  carries a ROUTED FINDING dated 2026-08-30 naming this exact `TypeError` and saying "This is yours
  to fix", with a 2026-08-30 correction establishing it as already live from task 25 via
  `plugin add pds` → `plugin remove pds`. Task 29 widens the reach of a defect it did not create,
  and the DoD does not order 28 before 29 (28 depends on 25/26/27; 29 on 10/26 - siblings).
- *It cannot reach a release.* plan.md's release cut is **after task 30**, and task 30 depends on
  both 28 and 29. The plan already tolerates exactly this shape of intermediate-commit debt for the
  27→59 pair, in writing.
- *The pin is genuine.* M3 confirms the obvious fix `(raw ?? {})` fails `cli.test.ts:1433` at
  `expect(cause).toBeInstanceOf(TypeError)`. Task 28 cannot land without visiting it, and the
  comment instructs "update it, not delete it".

**Routed to task 28 (not fixed here):** task 28's DoD asks that rejection messages be "unchanged from
the strings core raises today - `config.pds.name is required` …". Read literally, `(raw ?? {})`
discharges it - and yields `plugin "pds" rejected the "pds" config block: config.pds.name is required`
for an **absent** block, which is still not the actionable `config has no "pds" section - add it to
config/production.jsonc`. Task 28's routed finding does allow for "a clear refusal may be right", but
its DoD does not distinguish the absent-block case from the malformed-block case, and the absent case
is the one task 29's pin covers. Worth stating explicitly in task 28 before it is built.

**Routed to task 30 (not fixed here):** task 26's changeset
(`.changeset/pds-discoverable-as-a-plugin.md`) states *"`blogwright pds <action>` is unaffected -
every one of the six actions still runs through the CLI's own built-in branch, which is checked ahead
of plugin dispatch"* and describes the lifecycle-verb refusal as a transient consequence. Both
changesets accumulate into the **same** version bump, so the released CHANGELOG will carry two
contradictory statements about the same behaviour with only file ordering to disambiguate. Task 30's
step "Fold in whatever task 28's tests pinned and whatever help text task 29 reshaped" is where this
reconciles.

**Reported, not fixed (confirmed as asked):** `--identifier` is absent from `USAGE`'s `Options:`
block. Confirmed **not introduced here** - `jj diff -r slnlzpkwynmv packages/cli/src/cli.ts` shows
task 26 (build 48) removed the only line that documented it, `pds login --identifier <handle-or-did>`,
from the static pds block; it was never an `Options:` entry, and this diff does not touch `USAGE`.
It is milder than "undocumented": the real `--help` run shows it survives in the plugin section as
`login - interactive OAuth bootstrap, storing the session in Secrets Manager (--identifier
<handle-or-did>)`, so it is still discoverable from `--help`, just not from `Options:` alongside the
other nine flags. Not in this task's DoD.
