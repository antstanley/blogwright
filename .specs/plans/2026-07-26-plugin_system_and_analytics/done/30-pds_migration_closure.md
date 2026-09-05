# Task 30 - Ship the pds changeset and record the plugin manifest in DEVELOPMENT.md

**Plan:** [plan.md](../plan.md) · **Certificate:** [30-pds_migration_closure-certificate.md](30-pds_migration_closure-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §Merge plan](../../../changes/merged/2026-07-26-migrate_pds_to_plugin_system.md) step 3 (the DEVELOPMENT.md note), steps 1–2 recorded as not-applicable rather than skipped (see this task's first step), and §`blogwright-pds` → Package manifest (Add), §`blogwright-cli` → Post-deploy sync (Modify) and §Upgrading a deployed stack (the five operator-visible changes the release notes carry). Merge-plan steps 4–5 - the `Status:` flip, the move to `merged/` and the README update - are deferred to task 60, which lands the spec's last outstanding block (task 59 lands §The site graph drops its pds branch; task 60 lands §`bootstrap` warns while plugin state exists)
**Depends on:** 28, 29
**Produces:** the migration's changeset and release notes - including the five operator-visible changes the spec lists - and the `blogwright.plugin` manifest recorded as the feature-package mechanism in `DEVELOPMENT.md`, with the spec's `Status:` flip deferred to task 60
**Pointers:** `.changeset/` (where the changeset lands; `.changeset/config.json` holds the release config), `DEVELOPMENT.md:100-103` (§Hexagonal architecture, "Features live in their own packages" - the paragraph naming `PdsContext` and `OpsContext`), [the pds migration change spec](../../../changes/merged/2026-07-26-migrate_pds_to_plugin_system.md) (its `Status:` line, its §Merge plan and its three §Open questions), `.specs/README.md` §Change specs (the pending list, where the pds entry stays until task 60 - line anchors are deliberately not given for a file this plan's own tasks keep editing), `.specs/changes/merged/` (the destination task 60 moves the file to)

## Steps

- [x] Record why merge-plan steps 1 and 2 are not executed, rather than passing over them: step 1 applies the `Proposed changes` blocks to a canonical page documenting CLI dispatch and the pds feature "once one exists", and none does; step 2 says to fold the modified `PdsConfig` `$def` into the canonical schema, and it is written unconditionally although this repo has no `canonical-types.schema.json` for it to fold into. Both are therefore vacuous today, not done - write that, with an owner, into this task's decision note and into plan.md's open questions, exactly as task 20 records the plugin-system spec's step-1 deferral. Task 60 executes steps 4–5 against a spec whose first two steps stay recorded as not-applicable; the failure this step exists to prevent is a spec flipped to `Merged` with two silently unexecuted merge-plan steps.
- [x] Write the changeset naming `blogwright-core`, `blogwright-pds` and `blogwright` with their intended bumps, stating that the on-disk config file shape is unchanged and only the location of the pds default and validation moved.
- [x] Put the spec's §Upgrading a deployed stack list in the changeset verbatim, all five items, with `blogwright pds bootstrap` first and marked as required rather than optional. This is the release the instruction travels in: task 59 removes the site's own grant in a later one, and a stack that never ran the verb loses it at its next `blogwright bootstrap` after that. The other four - the three new `pds` lifecycle verbs, `blogwright destroy` refusing while `state/<env>.pds.json` exists, the shorter help section, and the built-in commands no longer rejecting a malformed `pds` block (task 19's dispatch-scoped validation, pinned by task 28's tests) - are consequences of pds contributing a node and of generic dispatch, and none of them was true before this milestone.
- [x] Fold in whatever task 28's tests pinned and whatever help text task 29 reshaped, so any behaviour divergence beyond the spec's five listed ones is stated in the changeset rather than left implied.
- [x] Update `DEVELOPMENT.md:100-103` so the feature-package paragraph names the `blogwright.plugin` manifest field as the mechanism, and re-read its `PdsContext`/`OpsContext` sentence against task 24's narrowing to confirm it still reads true.
- [x] Do NOT execute merge-plan steps 4 and 5. Two of the spec's `Proposed changes` blocks have not landed - §The site graph drops its pds branch (task 59, a release later, for the reason §Upgrading a deployed stack gives) and §`bootstrap` warns while plugin state exists (task 60) - and a spec is not merged while one of its blocks is outstanding. Record the deferral in the change description and in this task's residue, naming task 60 as the flip's owner, exactly as task 20 defers the plugin-system spec's flip to task 58. Leave the spec's entry in `.specs/README.md`'s pending list.
- [x] Carry the three unanswered open questions forward - an `afterDeploy` hook, `OpsConfig` holding plugin blocks as an opaque map, shorter pds action aliases - into the merged file's own Open questions or the plugin-system spec, so they survive the move.

## Definition of done

- [x] A changeset names `blogwright-core`, `blogwright-pds` and `blogwright` with their intended semver bumps and states that the on-disk config file shape is unchanged - only where the pds default and validation live moved.
- [x] `DEVELOPMENT.md:100-103` (§Hexagonal architecture, "Features live in their own packages") names the `blogwright.plugin` manifest field as the mechanism, and its `PdsContext` example still reads true after task 24's narrowing.
- [x] The changeset carries the spec's five operator-visible changes in full, `blogwright pds bootstrap` first and marked required, plus any behaviour divergence surfaced by task 28 or the help-text reshaping in task 29. A reviewer reading only the changeset can upgrade a deployed stack without losing the deploy role's Secrets Manager grant.
- [x] Merge-plan bookkeeping is correctly *incomplete* and every step is accounted for: steps 1–2 are recorded as not-applicable with their reason (no canonical page, and no canonical schema for the `PdsConfig` `$def` to fold into) and an owner, step 3's DEVELOPMENT.md note is done, steps 4–5 are explicitly deferred to task 60 in the change description with the reason named (two blocks outstanding, at tasks 59 and 60), the spec's `Status:` still reads `Proposed`, and its entry is still in `.specs/README.md`'s pending list. The three open questions this work did not answer (an `afterDeploy` hook, `OpsConfig` holding plugin blocks as an opaque map, shorter pds aliases) are recorded so task 60's move carries them forward rather than losing them.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm changeset status` and `pnpm test` from the repo root, then read `DEVELOPMENT.md:100-103` and `.specs/README.md`; confirm the three packages are listed with bumps, the manifest field is named, the changeset's first upgrade step is `blogwright pds bootstrap`, and the pds spec is still listed as pending with `Status: Proposed`.

## Decision notes

Written 2026-08-31 while implementing this task. D1, D2 and D4 are the three
merge-plan deferrals this task's definition of done exists to make explicit;
all three are also appended to [plan.md](../plan.md)'s `**Open questions**`
block, no other line of which was touched. The precedent for their shape is
task 20's D1/D2, which recorded the plugin-system spec's step-1 and step-4/5
deferrals the same way.

The pds spec's merge plan has five steps. All five are accounted for:
**1 - not applicable (D1)** · **2 - not applicable (D2)** · **3 - done (D3)** ·
**4 and 5 - deferred to task 60 (D4)**.

### D1 - Merge-plan step 1 is not applicable, not skipped. Owner: the spec's owner (Ant Stanley)

Step 1 reads: *"Apply the `Proposed changes` blocks to whichever canonical page
documents CLI dispatch and the pds feature, **once one exists**."* No canonical
page exists. `.specs/` holds `README.md`, `changes/`, `changes/merged/` and
`plans/` and nothing else; the spec's own §Affected spec pages table says so in
its first row - *"(none - no canonical page for CLI dispatch or the pds feature
yet)"* - and this plan's own baseline opens with "The repo has no canonical spec
pages". The step is therefore vacuous today: its precondition is unmet, so there
is nothing to apply the blocks to.

This is a weaker case than the one task 20 refused, and the difference is worth
recording because it is easy to conflate the two. The plugin-system spec's step
1 carries an explicit fallback - "if none exists, record the SPI as a new
canonical page and index it" - which made that step **live** and forced task 20
to refuse it on a conflicting instruction from the same spec. The pds spec's
step 1 has no fallback clause at all. It is conditional on its face, and the
condition is false. Nothing here is refused; the step simply has no target.

Owner: the spec's owner, because what unblocks it is the decision to create a
canonical spec set, which no task in this plan takes and none is scheduled to.
Explicitly NOT task 60: task 60 flips this spec's `Status:` and moves the file,
and it must do so against a merge plan whose first two steps stay recorded here
as not-applicable rather than quietly ticked. The failure this note exists to
prevent is a spec reaching `Merged` with two silently unexecuted steps.

### D2 - Merge-plan step 2 is not applicable, for a related but distinct reason. Owner: the spec's owner (Ant Stanley)

Step 2 reads: *"Fold the modified `PdsConfig` `$def` into the canonical
schema."* Unlike step 1 it is written **unconditionally** - no "once one
exists" - and that is what makes it worth a separate note rather than a clause
of D1: read literally it is an instruction to do something, and the reason it
is not done is not that a condition is unmet but that its object does not
exist.

Verified rather than assumed: `find .specs -name '*.schema.json'` returns
nothing. There is no `canonical-types.schema.json`, and no JSON Schema sidecar
of any kind anywhere under `.specs/`. The `$def` the step names has no
destination.

The consequence for a later reader is worth stating: when a canonical schema is
eventually created, the `PdsConfig` shape it must carry is **not** the one this
spec's §Type changes describes as "modified" in the abstract. It is the shape in
`packages/core/src/config.ts`'s `PdsConfig` today, whose `secretName` is now
optional (`string | undefined`) because task 27 removed core's defaulting, with
`blogwright-pds`'s `resolvePdsSecretName` owning the `<siteName>/atproto`
default. Folding the spec's `$def` in without that would encode a shape the code
does not have. Same owner as D1, for the same reason: creating the schema is the
unblocking act, and it is not a task in this plan.

### D3 - Merge-plan step 3 is done

`DEVELOPMENT.md` §Hexagonal architecture's *Features live in their own packages*
convention now names `"blogwright": { "plugin": "<namespace>" }` as the
mechanism, states what discovery scans for and what the default export declares,
and records that `cli.ts` carries no branch for a feature package.

**The `DEVELOPMENT.md:100-103` citation in this task's Pointers, definition of
done and certificate had already drifted, and it drifted further here.** The
paragraph was resolved by CONTENT, not by line number. At this task's base it
occupied lines **102-105**, two lines below the citation; after the amendment it
occupies **102-116**, so `100-103` now names the tail of the preceding
*dependency direction is inward* bullet plus the first two lines of this one.
The heading and the opening words - §Hexagonal architecture, *Features live in
their own packages* - are the durable address, and are what a reviewer should
use. Recorded because this build has measured cross-file line citations rotting
at four in five, including in files nobody had touched.

The paragraph's `PdsContext`/`OpsContext` sentence was re-read against task 24's
narrowing, as the step requires, and it still reads true - but it was made
precise rather than left as it stood, because "consumed by the CLI through a
narrow surface" was written when a hardcoded `runPds` branch did the consuming.
`PdsContext` is now a `Pick` over core's `PluginContext<PdsConfig>`
(`packages/pds/src/context.ts`), and an `OpsContext` is still assignable to it
with no cast and no adapter.

That claim is defended by an assertion that can fail, not by reading:
`packages/cli/src/context.test.ts`'s *OpsContext satisfies PdsContext* case
binds a `createTestContext()` result to a `PdsContext`. **Mutation:** add
`'pluginConfig'` to the `Pick` list in `packages/pds/src/context.ts`, rebuild
`packages/pds`, then `pnpm typecheck` in `packages/cli`. Observed, exit 2:

```
src/commands.ts(240,25): error TS2345: Argument of type 'OpsContext' is not assignable to parameter of type 'PdsContext'.
  Property 'pluginConfig' is missing in type 'OpsContext' but required in type 'PdsContext'.
src/context.test.ts(327,11): error TS2741: Property 'pluginConfig' is missing in type 'OpsContext' but required in type 'PdsContext'.
```

Both diagnostics task 24 predicted, in both positions - the argument-position
`TS2345` on the post-deploy sync and the bare-assignment `TS2741` on the test.
Restored; the tree is byte-identical to before the mutation.

One thing that mutation surfaced and that is NOT obvious: the CLI's typecheck
resolves `blogwright-pds` through its built `dist/*.d.ts`, so mutating
`packages/pds/src/context.ts` alone left `packages/cli`'s typecheck **green**
until `packages/pds` was rebuilt. CI runs `pnpm build` before `pnpm typecheck`
(`.github/workflows/ci.yml`), so the gate holds there; a developer running
`pnpm typecheck` alone against a stale `dist/` would not see it.

### D4 - Merge-plan steps 4 and 5 are deferred to task 60. Owner: task 60

The spec's `Status:` is **not** flipped, the file is **not** moved to
`.specs/changes/merged/`, and its entry stays second in `.specs/README.md`'s
pending list of three. This is deliberate and is the most important property of
this task.

The reason is the same one that split task 20 from task 58: a `Merged` header
claims the whole spec shipped, and two of its `Proposed changes` blocks have
not.

- **§The site graph drops its pds branch** - task 59. The CLI's site graph still
  reads `ctx.config.pds` in `githubOidcPolicy` and interpolates the plugin's
  secret name into the `<env>-deploy` document (`packages/cli/src/nodes.ts`,
  inside the `if (!ctx.preview)` branch). Task 59's diff was reviewed and proved
  CORRECT, but its own certificate's obligation O5 requires the release carrying
  **this** task to be published first, and no release can be cut from inside a
  build. It is parked at jj bookmark `parked/task-59` (`ed1e186422ce`) and its
  task file sits in `blocked/`.
- **§`bootstrap` warns while plugin state exists** - task 60, also in
  `blocked/`, inheriting task 59's release gate because its changeset must not
  ship before the one that removes the site's statement.

The parking is enforcement, not bookkeeping, and this task's changeset depends
on that: `changeset version` consumes `.changeset/` **whole**, so any release
cut while task 59's `cli-site-graph-drops-pds.md` sits in that directory would
ship the deploy-role grant removal in the same release as this task's migration
note - and every stack whose operator deploys before reading the notes loses the
grant at its next `blogwright bootstrap`, because `applyOidcRole`
(`packages/cli/src/nodes.ts`) replaces the `<env>-deploy` document wholesale on
every run. Holding that changeset out of the branch is the only mechanical
guarantee; the changeset's own warning is documentation, and documentation does
not stop `changeset version`. Verified: `.changeset/` holds 18 entries plus this
task's new one (19), plus `README.md`, and no `cli-site-graph-drops-pds.md`.

That is why §Upgrading a deployed stack's first item is written in this task's
changeset as forward-looking - "a later release removes it - that removal is
**not** in this release" - rather than as an accomplished fact. The same care
applies to the terminal warning: it is task 60's, it is not in this release, and
the changeset says so twice.

Owner: task 60, which lands the last outstanding block and therefore is the
first point at which a `Merged` header is honest. Verified at the end of this
task: the spec is still at `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md`,
its header still reads `Status: Proposed`, `.specs/changes/merged/` holds only
the two 2026-07-22 specs, and `.specs/README.md` still lists three pending
proposals with the pds spec second.

### D5 - The three open questions this work did not answer, carried forward

All three are in the spec's own §Assumptions and open questions and travel with
the file when task 60 moves it. They are restated here and in plan.md so the
move cannot lose them, and because two of them have acquired evidence during
this plan that their original wording does not carry:

- ***An `afterDeploy` hook.*** Still open, and now with a named cost. `deploy`
  reaches the post-deploy sync through a static import of `blogwright-pds` in
  `packages/cli/src/commands.ts`, which is a recorded wart only while
  `blogwright-pds` stays a non-optional dependency of `blogwright`. It becomes a
  bug the moment pds becomes optional. The spec's own assumption says exactly
  this; what is new is that the migration has now shipped with the import in
  place, so the question is load-bearing rather than hypothetical. Nothing in
  this plan is blocked on it: analytics ingests continuously through Firehose and
  has no post-deploy work, so the SPI still has one consumer's worth of evidence
  for the hook, which is none.
- ***`OpsConfig` holding plugin blocks as an opaque map.*** Still open. Core
  still declares the `PdsConfig` *type* for a feature it no longer implements
  (`packages/core/src/config.ts`), which this migration deliberately did not
  change: `OpsConfig.pds` is what lets the CLI's own deploy-role node keep
  compiling until task 59 removes it, and replacing the typed block with an
  opaque map is a breaking change to a published type. Worth revisiting after
  task 59 lands, when the last site-side reader of `OpsConfig.pds` is gone -
  which is a materially better moment than now, and is the one thing this plan
  can say about it that the spec could not.
- ***Shorter `blogwright pds` action aliases.*** Still open, and unaffected by
  anything that landed: dispatch matches declared multi-word actions, so an alias
  is now a one-line addition to the plugin's `commands` table rather than another
  positional shim. No user has asked; adding aliases would widen a surface this
  release is otherwise trying to keep identical.

### D6 - The `blogwright pds bootstrap` documentation gap: recorded, not closed. Recommended owner: task 58

Task 59's verification gate found that `blogwright pds bootstrap` - the one
required upgrade step - has nowhere in `docs/` a reader can look it up, and
named this task as the natural owner. It was considered and declined, on
evidence.

First, a correction to the finding's premise as it applies to **this** tree. It
reports `docs/src/content/docs/guides/ci-github-oidc.md:61` as the only place in
`docs/` naming the verb. That line belongs to task 59, which is parked, so at
this task's base `grep -rn 'blogwright pds bootstrap' docs/` returns **nothing
at all**. The gap is therefore wider here than the finding describes, not
narrower.

Second, the test the finding sets - *does `reference/cli.md` document plugin
verbs in a way that gives the three `pds` verbs a natural home?* - fails
plainly. `grep -n plugin docs/src/content/docs/reference/cli.md` returns zero
hits. The page has no plugin section, no `blogwright <plugin> <action>` row, and
no mention of `blogwright plugin add|list|remove`. Its §Invocation → Positional
layout table still describes the pre-migration dispatch model (it lists
`blogwright pds secret <action> [env]` as a distinct layout, which is now just a
declared two-word action), and its §Exit codes row still says `1` covers an
"unknown command, `preview` action, or `pds` action", which no longer describes
how an unrecognised first word is answered. Adding three verbs under `## pds
commands` would document host SPI verbs as if the pds package declared them,
while leaving the same page's two structural descriptions of dispatch wrong. It
would make the page more internally inconsistent, not less.

Third, this is the second finding to land on that page from the same cause: task
20's D6 recorded that it documents no plugin command at all and called it "worth
a task of its own alongside the M5 analytics docs". Two findings, one page, one
fix - a plugin-aware rewrite of `reference/cli.md`, which mirrors
`blogwright --help`, and whose help is now assembled from discovery.

So the scope is not silently expanded. Recommended owner: **task 58**, the
plan's remaining documentation task, which already depends on this one and
already carries the analytics docs. The caveat matters: nothing in task 58's
definition of done names `docs/`, so unless its DoD is amended this gap survives
the plan. It is recorded in plan.md's open questions for that reason.

What is NOT at risk in the meantime is the definition-of-done line this finding
bears on - *a reviewer reading only the changeset can upgrade a deployed stack*.
The changeset is self-contained: it names the verb, marks it required, gives the
form with an environment (`blogwright pds bootstrap production`), states its
precondition (the site's deploy role must already exist) and the three cases in
which it correctly does nothing. `blogwright --help` and
`blogwright pds <bogus>` both list all three lifecycle verbs from the plugin's
own declaration.

### D7 - Found while verifying, deliberately not fixed

- **`DEVELOPMENT.md`'s §Where validation lives table has a stale CLI-arguments
  row.** It reads "`parseArgs` plus explicit dispatch in `cli.ts`; unknown
  commands fail with usage". Since task 29 an unrecognised first word reports
  that no built-in command or installed plugin claims it and points at
  `blogwright plugin list`, and dispatch is no longer wholly explicit. Not fixed
  here: this task's certificate premise P3 forbids touching §Hexagonal
  architecture content beyond the one paragraph being amended, and this row is in
  a different section again. Owner: task 58, which already edits `DEVELOPMENT.md`
  in three places.
- **The scoped-state refusal names an environment the spec's list does not.**
  The spec's §Upgrading item 3 says the refusal names
  `blogwright pds destroy --yes`. The shipped message names
  `blogwright pds destroy <env> --yes` (`assertNoScopedState`,
  `packages/cli/src/commands.ts`), because an env-less plugin command silently
  targets `production` - which would be the wrong environment every time the
  guard fires from `preview teardown`. The code is right and the spec's prose is
  a release out of date. The changeset carries the shipped form, and this is the
  one place the five-item list is not reproduced word for word. No fix proposed:
  editing a `Proposed changes` block of a spec this task must not merge would be
  worse than the discrepancy.
- **`pnpm changeset status` cannot run in a NON-COLOCATED jj workspace, which is
  where every task in this build is implemented - and it is this task's
  `Reviewable:` command and its certificate's O1/O6 evidence step.** It
  exits 1 with `Failed to find where HEAD diverged from "main". Does "main"
  exist and it's synced with remote?`, because @changesets/git shells out to
  `git` and a non-colocated jj workspace has no `.git` directory - `git branch`
  in this workspace answers `fatal: not a git repository`. This is
  environmental, pre-existing, and unrelated to anything this task changed.
  **Corrected by this task's gate, and the correction matters:** the main tree at
  `/Users/ant/code/blogwright` is a *colocated* jj repo and does have a `.git`,
  so `pnpm changeset status` exits 0 there - the gate ran it read-only and it
  printed the four packages at minor. The `Reviewable:` line and O1/O6 are
  therefore dischargeable at merge time and are NOT defective; only the
  implementing workspace cannot run them. Equivalent evidence was produced
  in-workspace instead, by
  driving the same library `changeset status` itself uses - `@changesets/read`
  into `@changesets/assemble-release-plan` over `@manypkg/get-packages` and the
  repo's own `.changeset/config.json`. It reads 19 changesets and plans
  `blogwright`, `blogwright-core`, `blogwright-pds` (and `blogwright-analytics`,
  which rides the config's `fixed` group) all `0.3.3 -> 0.4.0`, `minor`, with
  this task's own front matter parsed as
  `[{blogwright-core, minor}, {blogwright-pds, minor}, {blogwright, minor}]`.
  That check can fail: flipping `"blogwright-core": minor` to `patch` in the
  changeset changed the parsed front matter accordingly; restored. Whoever
  re-checks this should either run the Reviewable command from a colocated
  checkout or use the equivalent, but should not read its exit 1 here as a
  finding against the changeset.
- **A pre-existing formatting defect in plan.md's Open questions.** Two bullets
  are joined without a line break: the *Cross-file line-number citations* bullet
  ends with the words "it does not work." immediately followed, on the same line
  and with no newline between them, by the `- *` that opens the *plugin list and
  plugin remove contradict each other* bullet - so the second renders as body
  text of the first. Present at this task's base. Not fixed: this task appends to that block and was told to append
  only, and repairing the join would rewrite a line belonging to another task's
  diff.
