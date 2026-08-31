# Done Certificate - Task 20: Document the plugin surface and execute the plugin-system spec's documentation steps

**Task:** [20-plugin_system_docs_and_closure.md](20-plugin_system_docs_and_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> Second gate, over the **delta** answering the first gate's five prose defects (D-1…D-5).
> Discharged against workspace `/Users/ant/code/blogwright-task-20` (jj, base `aa5bfb6d` =
> build 42/62). Full diff `jj diff --git` = SHA-256 `6f691696…63b98d`, **ten files, 402
> insertions / 10 deletions** - insertions up 80, **deletions unchanged at 10**, so the delta is
> pure prose and removed nothing further from the base. The delta itself, isolated from jj's
> evolution log as `3b1db184 → e0eacea9`, = SHA-256 `20f5573e…058e1e`, **five files, 105
> insertions / 25 deletions**, every deleted line being one this task had written earlier in the
> same round. Every mutation below was restored and the restore proved.

## Definition

DONE(Task 20 delta) ≡ each of the five corrections C1…C5 is **true of the artefact**, not merely
better-worded than what it replaced; plus the round's invariants (append purity, no unintended
edit, falsifiability, gates, merge) hold.

## Inherited, not re-litigated

Carried forward from the 2026-08-30 gate, none of it touched by this delta: `plan.md`'s append
purity and the write boundary; the `Ports.packages` deletion safe and complete (throwing stub →
348/348 pass, typecheck green, no surviving consumer, port still wired `bin.ts → cli.ts →
plugin-commands.ts`); the guard fix strictly narrowing over 4378 names with 36 hostile names
refused; `DEVELOPMENT.md`'s row correction compelled; declining `docs/…/reference/cli.md` right;
D1's reasoning sound; `.specs/README.md:9`'s broken link pre-existing, correctly disclosed, and
already fixed in the main tree (re-confirmed: 11 relative links, the one broken target in the
workspace resolves in the main tree).

**Delta scope proved, not assumed.** `jj diff --summary 3b1db184 → e0eacea9` lists exactly five
paths: `.changeset/plugin-system.md`, the task file, `plan.md`, `README.md`,
`packages/cli/src/plugin-commands.ts`. So `plugin-commands.test.ts` is **unchanged from the prior
round** and `DEVELOPMENT.md`, `context.ts`, `ports.ts` and `test-support.ts` were **not touched**
this round - verified by absence from the delta, not by re-reading the cumulative diff.

## The five corrections

- **C1 - "every built-in command behaves exactly as before" (was D-1). TRUE AS REPLACED.**
  - *Replacement:* "Two built-in commands change: `blogwright destroy` and `blogwright preview
    teardown` now refuse while a plugin's own scoped state object still exists, naming the command
    that clears it, and `blogwright init` now also asks each installed plugin's questions."
  - *Checked against the artefact:* `assertNoScopedState` is defined at `commands.ts:131` and
    called from **exactly two** sites - `commands.ts:176`, inside `destroy` (declared `:172`), and
    `commands.ts:345`, inside `previewTeardown` (declared `:338`) - each ahead of
    `clearRunningMicrovms`/`destroyGraph`, so the refusal is side-effect-free. Its throw names the
    runnable remedy `blogwright <scope> destroy <env> --yes` (`commands.ts:163-169`), so "naming
    the command that clears it" is literal, not a paraphrase. `init`: `cli.ts:384` calls
    `initSite(discoveryPorts.fs, terminal, logger, plugins, repoRoot)` and `init.ts:222-228`
    declares `plugins: readonly Plugin[]`, with `init.ts:100` asking "one plugin's `init(io)`
    contributor its questions". Corroborated inside the release by
    `.changeset/init-wizard-plugin-blocks.md` and `.changeset/plugin-lifecycle-verbs.md:9`, which
    the old sentence contradicted and the new one agrees with.
  - *Status:* ☑ CORRECTED

- **C2 - "a repo with no plugins installed sees no change at all, including in `--help`" (was
  D-2). TRUE AS REPLACED.**
  - *Baseline:* `jj file show -r b4ff1069 packages/cli/src/cli.ts` (292 lines) contains the string
    `plugin` **zero times** - so no `plugin` block in `USAGE`, and nothing plugin-shaped anywhere
    in the pre-release CLI.
  - *Now:* `cli.ts:43-48` is exactly the six-line static block (`plugin add` / `plugin list` /
    `plugin remove`, each over two lines), inside the `USAGE` constant, between the `preview` block
    (`:37-41`) and the `pds` block (`:50-`). It is in the constant, so it prints at **every** USAGE
    print site, including both `helpText` fallbacks (`cli.ts:222`, `:229`) that return bare `USAGE`
    outside a repo or before a root `package.json` exists - "everywhere" is literal.
  - *And only the dynamic half waits:* `buildHelp` (`cli.ts:137-138`) returns `base` **unchanged**
    when `discovered.plugins.length === 0 && discovered.failures.length === 0`, appending its
    `Plugins:` blocks only otherwise (`:156`). So a plugin-free repo gets the block and not the
    per-plugin sections - precisely what the sentence now says.
  - *Unrecognised first word:* `cli.ts:416`'s `!KNOWN_COMMANDS.has(command)` now routes to
    `runPlugin`, which reports `no built-in command or installed plugin claims "<x>" - run
    \`blogwright plugin list\` to see what is installed` (`plugin-commands.ts:646-650`). At the
    baseline, `cli-parent.ts:117-120` printed `unknown command: <x>` above the full `USAGE`. The
    changeset's before/after is exact.
  - *`cli.ts:486` genuinely unreachable:* `KNOWN_COMMANDS` (`known-commands.ts:57-67`) holds nine
    names; the `switch` (`cli.ts:452-478`) has the eight cases `bootstrap`, `deploy`, `rollback`,
    `delete`, `destroy`, `history`, `logs`, `status`, and the ninth, `plugin`, is claimed earlier
    at `cli.ts:386`. Membership is tested at `:416` before the switch, so `default` is dead code -
    the claim holds.
  - *Status:* ☑ CORRECTED

- **C3 - the guard comment's false converse (was D-3). TRUE AS REPLACED, AND PROVED EXHAUSTIVELY.**
  - *Guard lines byte-identical.* The delta hunk on `plugin-commands.ts` changes **comment lines
    only**: `if (name === undefined || name === '')` does not appear in the delta at all, and
    `if (!PACKAGE_NAME_PATTERN.test(name) || !PACKAGE_NAME_PATTERN.test(packageName))` appears as
    unchanged context. Both conditions are exactly what the prior gate verified.
  - *"No-op only for scoped and already-prefixed names."* True by construction:
    `resolvePluginPackage` (`plugin-commands.ts:936-940`) returns `name` unchanged iff
    `name.includes('/') || name.startsWith('blogwright-')`, so those are exactly the names for
    which the two tests examine the same string.
  - *"What it buys is exactly names opening with `-`, `.` or `_`."* Proved analytically over **all**
    strings, not only a corpus. For a name that is neither scoped nor prefixed, resolved =
    `blogwright-` + name; that matches `/^[a-z0-9~][a-z0-9\-._~]*$/` iff every character of the
    name is in `[a-z0-9\-._~]`. The raw test then fails iff the name is empty (caught one branch
    earlier) or its first character is `-`, `.` or `_`. Conversely nothing is newly accepted: if
    the raw test passes and the name is unprefixed and unscoped, prepending `blogwright-` keeps it
    matching. Independently re-enumerated over my own 8460-name corpus (all strings of length ≤3
    over a 20-character alphabet spanning every pattern class, plus 39 realistic and hostile
    names): **0 newly accepted, 279 newly rejected, opening characters exactly `{-, ., _}`, 0
    stranded**. The implementer's 8438/279 figures reproduce.
  - *Nothing stranded.* For every rejected name `n`, `blogwright-` + `n` starts with the prefix,
    so `resolvePluginPackage` is the identity on it and both tests see a string beginning `b`
    followed by allowed characters - it matches. Checked mechanically across all 279; zero
    exceptions.
  - *Mutation reproduced.* Collapsing the guard to `if (!PACKAGE_NAME_PATTERN.test(packageName))`
    and running `pnpm --filter blogwright exec vitest run plugin-commands`: **1 failed / 63
    passed**, the failure being `refuses a name whose \`blogwright-\` expansion would hide a path,
    installing nothing` at `plugin-commands.test.ts:1931` (`expected +0 to be 1`) - exactly one
    test, exactly the right one. **Restored:** `shasum -a 256` back to
    `48359343…48d9cc` (`shasum -c` OK) and `jj diff --from e0eacea9` empty, i.e. the whole tree is
    byte-identical to the reviewed state.
  - *Status:* ☑ CORRECTED

- **C4 - `plan.md`'s deferral-2 reason, false and mislabelled "from execution" (was D-4). THE NEW
  REASON IS TRUE; THE STALENESS IS FLAGGED, NOT FIXED.**
  - *The outstanding obligation is real.* The plugin-system spec's §Plugin SPI → *A plugin owns its
    own topography* (`2026-07-26-cli_plugin_system.md:226-232`) requires, verbatim, "no config key
    of a plugin's is read by a site node". `packages/cli/src/nodes.ts:971` reads `if
    (ctx.config.pds)` inside `oidcRolePolicyStatements` (declared `:921`), the site graph's own
    deploy-role policy builder, and `:983` interpolates
    `${ctx.config.pds.secretName}` into the secret ARN. The spec's own Decisions block names this
    same code as the thing that must move (`:793-798`). Task **59** is in `backlog/`
    (`59-cli_drop_pds_from_site_graph.md`) and its `**Implements:**` line names that very spec
    section, so the block is unshipped until it runs. `.changeset/pds-owns-its-deploy-role-grant.md`
    corroborates independently: "The site's own statement is unchanged and stays until a later
    release." **Real, and load-bearing.**
  - *Supporting claim on steps 4 and 5.* Task 58's final step does rewrite `.specs/README.md`'s
    Change specs section in one edit "so the merged list gains the plugin-system spec and the
    pending section holds exactly two entries" naming tasks 60 and 61 - all three specs' paperwork
    in one pass. The quoted conditional is verbatim in task 58's DoD: "recorded as unmet rather
    than flipped if it is not". Both supporting claims check out.
  - *Evidence citations spot-checked byte-exact.* `packages/core/src/aws/signer.ts:32` =
    `  service: ServiceKey | ServiceDescriptor;`; `packages/core/src/clients.ts:33` =
    `  signingUsEast1: SigningClient;`; tasks 31 and 38 are both in `done/`.
  - *Flagged, not silently fixed.* The stale wording still stands, unedited, at `plan.md:264`
    (task-graph row), `:342` (the ordering paragraph), `:391` (the M3 gate), `:565-570` (the
    **Decisions** bullet), and in task 20's own Steps and definition of done - and the correction
    says so and adds "Do not re-derive the deferral from that wording." Zero deletions on
    `plan.md` against the base confirms nothing was quietly rewritten.
  - *Status:* ☑ CORRECTED (one unrouted consequence - defect **E-1**)

- **C5 - `README.md`'s "so the two cannot drift apart" (was D-5). TRUE AS REPLACED.**
  - *Replacement:* "The pin is taken at install time, not maintained: upgrading the CLI on its own
    leaves the plugin at the version it was pinned to, and nothing declares or checks an interface
    version, so nothing reports the gap - re-running `blogwright plugin add` will not close it
    either, since a package the manifest already declares is left untouched."
  - *Checked against the artefact:* `runPluginAdd` (`plugin-commands.ts:1015-1030`) calls
    `isDeclaredDependency` **first** (`:1022`); on a hit it logs "`<pkg>` is already installed -
    nothing to do" and returns 0 at `:1023-1024`, before `deps.cliVersion()` is ever read (`:1026`)
    and before the port is built or called (`:1027`). `isDeclaredDependency` (`:984-996`) is a bare
    `Object.hasOwn(declared, packageName)` over `dependencies`/`devDependencies` - **no version is
    read, parsed or compared anywhere on that path**. So a re-run cannot close the drift, exactly
    as the sentence now says. The doc comment at `:1001-1004` states the same ordering as the
    contract.
  - *Judging the same phrase left in `plugin-add-remove-commands.md`:* **correct to leave.** There
    it reads "pins it exactly, so the CLI and its plugins cannot drift apart **between two
    checkouts of the same repo**" - the qualifier makes it true, because `exact: true` writes a
    pinned version into `package.json` and every checkout resolves that one version. The same
    file's own doc comment (`plugin-commands.ts:1006-1013`) reasons in exactly that scope. The
    unqualified README sentence was the only false one, and it is the one that changed.
  - *Status:* ☑ CORRECTED

## Append purity, re-checked against interference

`plan.md` against the task's base: **one hunk**, `@@ -776,6 +776,85 @@`, **+79 / -0**. Zero
deletions ⇒ no existing bullet reflowed, reworded or renumbered. The hunk sits at the tail of the
`**Open questions**` block (block head at `:596`, closing `---` at `:780`).

The main tree's copy has since gained a **41-line bullet prepended** immediately after that same
block's `**Open questions**` header (uncommitted; `plan.md` is byte-identical across builds 42, 43
and 44, so the change is working-tree only). Head and tail do not overlap. Proved by three-way
merge: `git merge-file` with base = build 42, ours = main working tree, theirs = task 20 →
**exit 0, zero conflict markers, 1193 lines = 1073 + 41 + 79**, with both the prepended
*transform Lambda CloudWatch logs* bullet and task 20's *Merge-plan steps 4 and 5* bullet present
in the result. **No interference.**

## Falsifiability, gates, integration

- **No test changed this round** - `plugin-commands.test.ts` is absent from the delta, and its two
  new cases from the prior round are still the ones that redden under mutation (above).
- **Six gates from the workspace root, one run, exit 0:** `pnpm build`; `pnpm typecheck` (all six
  projects); `pnpm test` - core 149 (+1 skipped), build-agent 27, pds 117, analytics 482, **cli
  348** = 1123 passed, 1 skipped, unchanged from the prior round; `pnpm lint` (Done; the
  `no-shadow` warnings are all in `nodes.test.ts`, a file no round of this task touches);
  `pnpm exec oxfmt --check .` (176 files, all correct); `pnpm knip` (silent).
- **`Reviewable:` chain:** `.specs/changes/2026-07-26-cli_plugin_system.md` still at that path,
  header still `**Status:** Proposed`, still outside `merged/`; `.specs/README.md`'s pending list
  still holds exactly three proposals; the deferral and its owner (task 58) are in the task's D2
  and in `plan.md`'s appended bullet. Link sweep over `.specs/README.md`: 11 relative links, 10
  resolve, the 11th is the already-handled pre-existing one.
- **Merge onto build 44 is clean.** Bookmark `plugin-system-and-analytics` = `1c883882` (build
  44/62). `git merge-tree --write-tree 1c883882 e0eacea9` → tree `1a85ce36`, **exit 0, no conflict
  messages**, merge base `aa5bfb6d` = build 42. Builds 43 and 44 touch no file this task edits.
  In-flight tasks 47 and 50 touch only `packages/analytics/*` - zero overlap.

## Defects

- **E-1 (new; unrouted consequence of C4's own finding).** `plan.md`'s appended bullet and the
  task file's **D2** now correctly identify §Plugin SPI → *A plugin owns its own topography* -
  `packages/cli/src/nodes.ts:971`, removed by task **59**, still in `backlog/` - as the reason the
  `Merged` flip cannot happen at task 20. But they hand the flip to task **58**, which **does not
  depend on task 59** (`plan.md:302`: deps 20, 30, 55, 57) and whose definition of done conditions
  the flip on the *seam* alone. The note's reassurance - "task 58's own definition of done makes
  the flip conditional on re-verifying the seam … so nothing is taken on trust there" - is true of
  the seam and does not cover the blocker the note itself just named.
  **Failure scenario:** task 58 becomes runnable once 20, 30, 55 and 57 land; task 59 is
  additionally release-gated ("this is the release task 59 waits for", `plan.md:397`; task 59's own
  DoD: "ships in a **later release** than task 30"), so 58-before-59 is the expected order. Task 58
  verifies `SendOptions.service` and `signingUsEast1`, finds both present, flips `Status:` to
  `Merged` with a `Merged:` date and moves the spec to `.specs/changes/merged/` - while
  `nodes.ts:971` still reads `ctx.config.pds`. The merged header then claims a `Proposed changes`
  block that has not shipped: the exact failure `plan.md:1044`'s risk row exists to prevent,
  reproduced one task downstream. **Fix (one sentence, in the same bullet the delta already
  wrote):** state that task 58 must not flip while §topography is outstanding, i.e. add task 59 to
  what 58 re-verifies, or add the edge. Not a false statement and not a missed DoD item - the
  deferral, its owner and its reason are all recorded as the task contract requires - but a
  consequence that this delta was the first work to make visible and that only this note is
  positioned to route.
- **Inherited and now discharged:** D-1…D-5 of the 2026-08-30 certificate are each closed by
  C1…C5 above. D-2's parenthetical ruling that
  `.changeset/cli-help-plugin-sections.md`'s "With no plugins installed, `--help` output is
  unchanged" is acceptable *because it is scoped to the dynamic section* is inherited unchanged;
  the delta did not touch that file, and the same scoping standard that keeps
  `plugin-add-remove-commands.md`'s qualified phrase (C5) keeps this one.

## Conclusion

```
CORRECTNESS:  CORRECT        confidence: high
COMPLETENESS: DONE           confidence: high
```

SUMMARY: All five corrections are true of the artefacts rather than merely better-worded -
`assertNoScopedState` really is called from `destroy` and `previewTeardown` alone and `init` really
does ask plugins' questions; the six-line `plugin` block really is in the static `USAGE` and absent
at `b4ff1069`, with `buildHelp` returning `base` untouched for a plugin-free repo and `cli.ts:486`
provably dead; the guard comment's new claim is exhaustively true (0 newly accepted, 279 newly
rejected all opening `-`/`.`/`_`, 0 stranded) with the two condition lines byte-identical and the
raw half reddening exactly one test under mutation; §topography really is outstanding at
`nodes.ts:971` with task 59 in `backlog/`, and the stale wording is flagged in place rather than
rewritten; and `runPluginAdd` really does exit 0 on an already-declared package without reading a
version - so every definition-of-done item stays discharged, with the six gates green, the append
still `+79/-0` and non-interfering with the main tree's prepended bullet, and the merge onto build
44 clean; the single new defect (E-1) routes a consequence of this delta's own finding onward to
task 58 and asserts nothing false.
