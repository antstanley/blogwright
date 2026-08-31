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
- **P3 - Invariants.** Must not break the six pds commands as users invoke them, the `preview` and built-in command branches in `packages/cli/src/cli.ts`, the post-deploy sync in `packages/cli/src/commands.ts`, or the `blogwright/rkey` re-export at `packages/cli/src/rkey.ts:7`.

## Validation record

This certificate covers TWO passes over the same working copy, by two different gates.

**Pass 1 (2026-08-30, inherited).** Five paths - `cli.ts`, `cli.test.ts`, `commands.ts`,
`commands.test.ts`, `.changeset/pds-dispatched-as-a-plugin.md`. Discharged by an independent
eleven-mutation battery with a green control and a byte-identical restore. Its findings are
inherited here and re-stated in compressed form; the mutation table itself is not repeated. Its
verdict was DONE with a documentation-only CONCERNS (D1: eight stale source comments and two stale
test titles describing the deleted branch).

**Pass 2 (2026-08-31, this record).** The delta that answers pass 1's D1. Eight further paths, all
comments except two test titles and one changeset paragraph:
`plugins.ts`, `known-commands.ts`, `plugin-commands.ts`, `plugins.test.ts`, `pds/src/index.ts`,
`pds/src/plugin.ts`, `pds/src/plugin.test.ts`, `.changeset/pds-discoverable-as-a-plugin.md`.
Validated in `/Users/ant/code/blogwright-task-29` (jj workspace, parent = build 49
`zzqqpprn 917c26eb`, working copy `zroyomkt 0ba2be53`). No `package.json` was touched at any point,
so the pnpm workspace link for `blogwright-pds` was never pruned.

**Delta is comment-only, mechanically confirmed.** Filtering the eight-path diff for added/removed
lines that are not `*`-prefixed comment lines yields exactly two lines - the two `it(...)` titles at
`packages/cli/src/plugins.test.ts:629` and `packages/pds/src/plugin.test.ts:237`. **No test body, no
expected value, no fixture and no assertion changed this round.** The five pass-1 paths are
byte-unchanged: pass 1's own line citations still resolve exactly
(`cli.test.ts:1433` = `expect((err as Error).cause).toBeInstanceOf(TypeError)`, `:1456` = the
`preview` USAGE pin, `commands.ts:26` = the `syncAfterDeploy` import, `commands.ts:240` = its single
call site).

**Six gates from the workspace root, all clean:**
`pnpm build` 0 · `pnpm typecheck` 0 · `pnpm test` 0, **1327 passed** (core 149 +1 skipped,
build-agent 27, pds 145, analytics 643, cli 363/363) · `pnpm lint` 0 (seven pre-existing
`no-shadow` warnings in the untouched `packages/cli/src/nodes.test.ts`) · `pnpm exec oxfmt --check .`
clean, 191 files · `pnpm knip` exit 0, no output.

**`Reviewable:` line, run verbatim:**
`pnpm --filter blogwright exec vitest run cli --reporter=verbose` → **45/45 passed**, with all twelve
`main - pds dispatch (generic, through runPlugin)` cases named individually in the output ·
`pnpm knip` → exit 0, no output · `grep -n "pds" packages/cli/src/cli.ts` → **zero hits, exit 1**.

**Real binary, rebuilt from this tree.** A throwaway consumer (`git init`, a `package.json` naming
only `blogwright`, `node_modules/blogwright` symlinked to `packages/cli`) driven with
`node packages/cli/dist/bin.js --help` → exit 0, `Plugins:` renders
`pds - standard.site (AT Protocol) publishing: …` followed by all six actions with their one-line
summaries and the three generic lifecycle verbs.

### D1 - the RESERVED_COMMANDS experiment, re-run independently

`'pds'` was added to `RESERVED_COMMANDS` (`packages/cli/src/known-commands.ts`) and the cli suite
re-run from `packages/cli/node_modules/.bin/vitest` (never through pnpm, to avoid the manifest
re-verification relink). Control before: **363/363 green**. Mutated: **18 failed / 345 passed**,
reproducing the implementer's count exactly. Restored from a pre-mutation copy; `jj diff --git` is
byte-identical to the pre-review patch.

The mechanism the replacement comments claim was observed directly in the failure output, not
inferred:

- `resolveNamespaceCollisions` (`packages/cli/src/plugins.ts:383-422`) turns the **real bundled
  plugin** into a `failures` entry. `plugins.test.ts:786` fails with
  `{ packageName: "blogwright-pds", reason: "blogwright-pds declares plugin name \"pds\", which is
  reserved for the built-in \"pds\" command - built-in commands always win" }` where `[]` was
  expected. Both real-disk integration cases fail on exactly that reason string, as the comment says.
- `blogwright pds sync` exits 1: the dispatch case fails `expect(await run).toBe(0)` with `1`. The
  message is pinned independently at `cli.test.ts:1396` -
  `✗ no built-in command or installed plugin claims "pds" - run \`blogwright plugin list\` to see
  what is installed` - asserted for the argv `['pds','sync']` against an empty discovery, which is
  the state the reservation creates.
- `--help` lists none of the six: the `--help` case fails with the entire `Plugins:` block replaced
  by `Plugins that failed to load:` + the reserved reason line.
- `blogwright plugin list` blames a built-in that does not exist: the integration row case fails
  with `["no plugins installed - run \`blogwright plugin add <name>\` …", "failed to load:",
  "blogwright-pds: … reserved for the built-in \"pds\" command …"]`.

**Ruling on the replacement comments (`plugins.ts:36-51`, `known-commands.ts:47-60`): accurate, and
they state the real mechanism.** Every load-bearing clause was checked against code, not read as
prose: there is no built-in `pds` command left (`grep -in pds packages/cli/src/cli.ts` → zero);
`RESERVED_COMMANDS` is consulted only by `resolveNamespaceCollisions`; the two quoted user-facing
strings exist verbatim at `plugin-commands.ts:653` and `plugins.ts:402`; the "one name in this file
whose reservation would REMOVE a working command rather than protect one" holds, since every other
member of `RESERVED_COMMANDS` is a genuine built-in.

**Ruling on omitting the failing-test count: correct restraint.** The count is the one part of the
observation that is guaranteed to rot - it moves whenever a case is added to `cli.test.ts` or
`plugins.test.ts`, neither of which is closed. This build has already paid that price once: pass 1
had to independently re-measure the "11 failures" figure to confirm it. What the comments keep
instead is the *stable* falsifier - the named reason string and which class of case fails - which a
future reader can reproduce in one edit and which no test addition can invalidate. The recipe
("Verified by adding `'pds'` to the set: discovery rejects the real bundled package and this file's
real-disk integration cases fail on exactly that reason string") is strictly more useful than a
number, and it is true.

### D2 - the corrected comments, checked against code

| Site | Claim | Verdict |
|---|---|---|
| `known-commands.ts:17-21` | `cli.ts` names no plugin package; `blogwright-pds` reaches it only transitively through `commands.ts` | **True.** `cli.ts:11` imports `* as commands from './commands.js'`; `commands.ts:26` is the sole non-test `blogwright-pds` import in `packages/cli/src`. |
| `plugin-commands.ts:19-25` | step 2 "is now the only thing that resolves a multi-word action anywhere in the CLI" | **True.** `grep -rn "split(' ')" packages/cli/src` returns exactly one hit, `plugin-commands.ts:243`, inside `matchAction`. The built-in `plugin` namespace's own actions (`list`/`add`/`remove`) are single words. |
| `plugin-commands.ts:159-166` | `PdsValues` was the sibling narrowing, now deleted; `PluginValues` + `serialiseFlags` carry `--identifier` to `pds login` | **True.** `PluginValues.identifier` at `:175`, `FORWARDED_FLAGS` includes `'identifier'` at `:195`, `serialiseFlags` at `:208` emits the `--identifier <value>` pair, and `packages/pds/src/plugin.ts:129` reads it back via `flagValue(args, IDENTIFIER_FLAG)`. `cli.ts:323` still declares the parse option (pass 1's M8 proves that entry is load-bearing too), but the *transport* claim is what the comment makes. |
| `plugins.test.ts:629` (title) | reserving `pds` would reject the bundled plugin, deleting the namespace | **True** - established by the D1 experiment above, and by the two real-disk cases in the same file. |
| `pds/src/plugin.ts:105-112` | these declarations are now the only definition of the namespace's actions; renaming one removes the action | **True.** Dispatch matches `command.action` only; pass 1's M10 (retyping `secret status` → `secret`) fails 5 cases. |
| `pds/src/plugin.ts:184-193` | task 26 added the manifest field, which is what makes discovery import it; remove it and the namespace stops existing | **True.** `jj diff -r slnlzpkwynmv packages/pds/package.json` shows task 26 adding `"blogwright": { "plugin": "pds" }`; `plugins.ts:336` skips any package without a `blogwright` field, silently, and there is no branch left to fall back to. |
| `pds/src/plugin.test.ts:29` + `:237` (title) | `RUNPDS_ACTIONS` is frozen as the pre-migration contract and stays hand-written | **True and well-judged** - see below. |
| `pds/src/index.ts:5-16` | the six command functions no longer reach the CLI by name; `syncAfterDeploy` "is the ONE named export the CLI still imports" | **Substantively right, universally over-claimed** - see Defects, D-a. |

**Ruling on the `RUNPDS_ACTIONS` decision: right, and the stated reason is true.** The list
`['keygen','login','init','sync','secret status','secret delete']` was checked against the deleted
branch itself - `jj file show -r @- packages/cli/src/cli.ts` line 499 is
`const known = new Set(['keygen', 'login', 'init', 'sync', 'secret status', 'secret delete']);` -
identical, **including order**, so "frozen here as they stood before task 29 deleted that branch" is
literally accurate. Deriving the list from the plugin instead would make
`expect(plugin.commands.map(c => c.action)).toEqual(RUNPDS_ACTIONS)` compare the declaration with
itself, which is the failure mode the comment names and avoids. `cli.test.ts`'s `PDS_ACTION_LINES`
is not a duplicate record of the same thing: it is hand-typed from the *post*-migration declaration
and its summaries, pinning help rendering, not the pre-migration contract. The claim "the only
remaining record of it" survives.

### D3 - the task-26 changeset correction

Both changesets are unconsumed in `.changeset/` and both declare `"blogwright": minor`
(task 26's also bumps `"blogwright-pds": minor`), so they do land in one version bump and one
CHANGELOG - the premise of the correction is real.

The old final paragraph carried four claims. Checked one by one:

1. *"every one of the six actions still runs through the CLI's own built-in branch, which is checked ahead of plugin dispatch"* - **falsified by this diff, removed.** ✔
2. *"and `blogwright/rkey` still re-exports `blogwright-pds/rkey` unchanged"* - **still true, kept.** `packages/cli/src/rkey.ts` is not among the diff's 13 paths and still reads `export * from 'blogwright-pds/rkey';`. **Confirmed untouched.** ✔
3. *"help now also lists the generic `bootstrap`, `status` and `destroy` verbs under `pds` because the plugin contributes resource nodes"* - **still true, kept.** Reproduced on the real binary above. ✔
4. *"those three are still refused with `unknown pds action: …` for as long as the built-in branch answers the namespace"* - **falsified, replaced** with "all three of those verbs now run", which the `pds bootstrap` case asserts positively. ✔

**No over-deletion.** This is task 17's precedent discharged correctly: of the four claims in the
deleted sentences, exactly the two falsified ones were dropped and the two accurate ones were carried
into the replacement text. Nothing accurate was lost; the two paragraphs above the edit were not
touched, and remain true.

## Obligations

- **O1 - `cli.ts` holds no pds knowledge.**
  - *Evidence:* `grep -in "pds" packages/cli/src/cli.ts` → zero hits, exit 1. Task 26 had already stripped the static `USAGE` block, so this is not the first commit at which help is correct. The `identifier` flag survives at `cli.ts:323` with the comment explaining why it may not be deleted as unused. *(Inherited from pass 1, re-run and re-confirmed here.)*
  - *Status:* ☑ SATISFIED

- **O2 - Dispatch reaches the same functions with the same arguments, and refuses the same way.**
  - *Evidence:* the twelve `main - pds dispatch (generic, through runPlugin)` cases, all named in the verbose run above, each asserting `{ action, args }` **and** `contexts.map(ctx => ctx.env)`. Pass 1's M1/M2/M4/M4b/M9/M10 proved each property fails when broken; the delta changed no case body or expected value, mechanically confirmed above, so those proofs carry.
  - *Status:* ☑ SATISFIED

- **O3 - `--help` still documents all six actions, and any lost guidance is named.**
  - *Evidence:* real-binary `--help` capture above - six actions with summaries plus three lifecycle verbs, sourced from the plugin object. Pass 1's M9 proves the pin is hand-typed, not derived. The lost guidance was lost at task 26 and is enumerated verbatim in `.changeset/pds-discoverable-as-a-plugin.md`, whose first two paragraphs the delta left intact.
  - *Status:* ☑ SATISFIED

- **O4 - The post-deploy sync path is intact and its wart is recorded.**
  - *Evidence:* `commands.ts:2-25` carries the two-reason comment; `:26` the static import; `:240` the single call. `packages/cli/package.json` still declares `"blogwright-pds": "workspace:*"` under `dependencies` with no `optionalDependencies` block. The four deploy cases pass. Pass 1's M5a/M5b/M6 established non-vacuity and that these cases are the only thing in the repo catching a deleted post-deploy sync. **No `package.json` was mutated in this pass**, and the real-disk integration cases that resolve `blogwright-pds` pass, which is the proof the workspace link is intact.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Evidence:* all six gates run from the workspace root, clean (above), and re-run clean after the D1 mutation was restored. Two changesets exist and are now mutually consistent (D3). Pass 1's O5 exception - "eight source comments and two test titles describing the branch it deleted" - is **discharged by this delta for eight of the ten**, plus two the implementer found itself. Two residual items remain (Defects, D-b).
  - *Status:* ☑ SATISFIED (with D-a and D-b recorded)

- **O6 - Reviewable.**
  - *Evidence:* `pnpm --filter blogwright exec vitest run cli --reporter=verbose` → 45/45; `pnpm knip` → exit 0; `grep -n "pds" packages/cli/src/cli.ts` → empty, exit 1; `--help` from the real binary naming all six actions.
  - *Status:* ☑ SATISFIED

## Regression check

- Six pds commands as users invoke them → ☑ PRESERVED (twelve dispatch cases; real-binary `--help`).
- `preview` and the `KNOWN_COMMANDS` branch in `cli.ts` → ☑ PRESERVED (untouched by the delta; the `preview` USAGE pin still resolves at `cli.test.ts:1456`).
- Post-deploy sync at `commands.ts:240` → ☑ PRESERVED (untouched by the delta; four cases pass).
- `packages/cli/src/rkey.ts:7` re-export → ☑ PRESERVED (**not in the diff**, verified by path list and by reading the file).
- `packages/pds` own suite → ☑ PRESERVED (145/145; the delta touches only comments and one title there).
- Comment-only delta cannot regress behaviour → ☑ CONFIRMED mechanically (two title strings are the sole non-comment lines).

## Integration

- **Merge onto build 51 is clean and empty.** `plugin-system-and-analytics` is at
  `qnumvmqu 2ff2cb01` (build 51 - task 57 landed after task 51). `jj new @ plugin-system-and-analytics`
  produced an **empty** merge commit: no conflicts. Path overlap between build 49→51 and this task's
  13 paths is **zero** - the bookmark moved `.gitignore` (the new `.playwright-mcp/` and loose-image
  rules), `.oxfmtrc.json`, `.oxlintrc.json`, `knip.json`, `pnpm-lock.yaml`, `packages/analytics/**`
  and plan paperwork; task 29 touches `packages/cli/**`, `packages/pds/**` and two changesets, and no
  root config file.
- **The moved root configs were re-checked on the merged tree**, because `.oxfmtrc.json`,
  `.oxlintrc.json` and `knip.json` are the ones that could newly flag task 29's files:
  `pnpm exec oxfmt --check .` clean over **201** files, `pnpm knip` exit 0 no output, cli 363/363,
  pds 145/145. The new config entries are Svelte- and analytics-scoped and reach neither package.
- **Probe removed.** `jj edit zroyomktlovl` then `jj abandon ksustottzpwv`; working copy back at
  `zroyomkt 0ba2be53`.

## Restore proof

Two mutations were made in this pass and both were restored:

1. `'pds'` added to `RESERVED_COMMANDS` → restored from a byte copy taken before the edit.
2. The merge probe commit → abandoned.

`jj diff --git` after restore was `diff`-compared against the patch captured before any mutation:
**byte-identical**, verified twice (once after the mutation restore, once after the probe was
abandoned). `pnpm build` refreshed `dist/`, which is gitignored and does not appear in the diff.
No code was edited outside those two mutations. This certificate is the only thing written under
`.specs/`.

## Residue

- The two deliberate behaviour changes (refusal prints `renderActions` rather than USAGE; `pds bootstrap` now runs) were verified as replacements, not weakenings, in pass 1, and the delta does not touch either path.
- The widened first-run `TypeError` exposure stands as ruled in pass 1: **acceptable to land** - message-only, already live from task 25, owned by task 28 in writing, pinned at `cli.test.ts:1433`, and unable to reach a release because plan.md cuts after task 30, which depends on both 28 and 29.
- Pass 1's "Routed to task 30" item - the two changesets contradicting each other in one CHANGELOG - is **now closed at source** by D3 and no longer needs task 30 to reconcile it.
- Pass 1's "Reported, not fixed" item (`--identifier` absent from `USAGE`'s `Options:` block, introduced at task 26, still discoverable in the plugin section) is unchanged and out of this task's DoD.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations hold - a zero-hit grep, twelve dispatch cases asserting arguments and
environment over the shipped plugin object, `--help` from the real binary, four non-vacuous deploy
cases, six clean gates and a clean empty merge onto build 51 - and the delta is provably
comment-only (two test-title strings are its sole non-comment lines), so pass 1's mutation battery
carries intact. The delta's own charter is largely discharged: the `RESERVED_COMMANDS` experiment
reproduces at 18 failures with the claimed mechanism observed directly in the failure output, seven
of the eight replacement comments are accurate against code, and the task-26 changeset correction
removed exactly the two falsified claims while keeping the two true ones. Two documentation defects
remain (D-a, D-b) - neither affects behaviour, both are one-line fixes.

## Defects

**D-a - CONCERNS: `packages/pds/src/index.ts:11` states a universal that is false.** The replacement
comment says *"`syncAfterDeploy` is the ONE named export the CLI still imports"*. It is not:
`packages/cli/src/context.test.ts:16` is `import type { PdsContext } from 'blogwright-pds';`, and
`PdsContext` is a **named** export of this very file - `export type { PdsContext, PdsLogger, PdsPorts }
from './context.js';` sits two lines below the comment that denies it. The substantive point (the six
command functions no longer reach the CLI by name; `syncAfterDeploy` does, because the SPI has no
post-deploy hook) is correct and worth keeping; the emphatic "the ONE named export" is what
overreaches. *Failure scenario:* a future reader trimming this package's public surface reads the
comment, concludes the three context-type re-exports are dead, deletes the `export type { … }` line,
and breaks the `OpsContext satisfies PdsContext` boundary check at
`packages/cli/src/context.test.ts:324-327` - the one test whose whole purpose is to pin that
dependency boundary. Caught by `pnpm typecheck`, so the blast radius is small, but this is precisely
the "a replacement that is differently wrong" hazard the delta was chartered against. *Fix:* narrow
to the one true reading, e.g. "the one named export the CLI's shipped code still imports at runtime"
- the context types are a type-only import in a test.

**D-b - CONCERNS (minor): `packages/cli/src/plugin-commands.ts:230` still cites `cli.ts:196`, in the
same file two comments were corrected in.** `matchAction`'s doc reads *"rather than by shifting a
fixed number of positionals (the approach this function replaces, `cli.ts:196`'s hand-rolled `secret`
shift)"*. The module comment 200 lines above it had the identical `cli.ts:196` citation and was
corrected; this second occurrence was not. The substance ("this function replaces a hand-rolled
shift") stays true - only the pointer dangles - so it is weaker than the D1 items, but it is the same
class, and it was missed in a file the delta edited. *Failure scenario:* a reader follows the
citation into `cli.ts`, finds an unrelated line (the file has zero `pds` hits), and cannot tell
whether the comment is stale or the code moved. *Fix:* drop the line number, as the module comment
already does. **Same class, out of this task's paths:** `packages/core/src/plugin.ts:165` cites
`packages/cli/src/cli.ts:198` as the home of the `secret status` example. Reported, not routed -
`packages/core` is not in task 29's scope, and the citation was already stale before this task (the
branch sat at `cli.ts:486-530` in the parent commit, not at `:196`/`:198`).
