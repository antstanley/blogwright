> **Current scope reconciliation (2026-09-05):** Historical steps/evidence below describe the original execution. Any remaining canonical/spec/public-doc closure belongs to task 63 under the current [plan](../plan.md). Historical certificate verdicts are retained, not promoted to a current pass.

# Task 20 - Document the plugin surface and execute the plugin-system spec's documentation steps

**Plan:** [plan.md](../plan.md) · **Certificate:** [20-plugin_system_docs_and_closure-certificate.md](20-plugin_system_docs_and_closure-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §Merge plan](../../../changes/2026-07-26-cli_plugin_system.md) (step 2; step 1's canonical-page fallback and steps 4–5's `Status:` flip and move are deliberately deferred - see this task's two decision notes) and §Ports → `ModuleLoader` and §Ports → `PackageManager` (the two rows the ports table gains)
**Depends on:** 05, 06, 11, 14, 16, 18, 19
**Produces:** consumer docs for `blogwright plugin add|list|remove` and `blogwright <plugin> <action>`, the two new ports recorded in DEVELOPMENT.md's ports table, a changeset for the whole user-facing surface, and both deferrals written down - the canonical-page fallback, and the `Status:` flip that waits for the transport seam at tasks 31 and 38 and lands at task 58 - with the spec's unanswered questions carried forward
**Pointers:** `README.md:40-56` (the Commands block that gains the plugin lines), `DEVELOPMENT.md:72-81` (§Hexagonal architecture's ports table), `DEVELOPMENT.md:356-366` (the lint-enforcement Decisions bullet listing the adapter exceptions), [the plugin-system change spec](../../../changes/2026-07-26-cli_plugin_system.md) (its `Status:` header line, its §Plugin SPI → Plugin-supplied AWS services block - the one this task cannot claim has landed - its §Merge plan and its §Open questions), `.specs/plans/2026-07-26-plugin_system_and_analytics/backlog/31-core_transport_seam.md` and `38-analytics_client_bundle.md` (where that block lands), `58-analytics_docs_and_closure.md` (which performs the deferred flip), `.specs/README.md` §Change specs (the pending and merged lists - line anchors are deliberately not given for a file this plan's own tasks keep editing)

> **ROUTED FINDINGS - added 2026-08-30 from task 18's verification gate.**
> **1. `Ports.packages` is orphaned.** Task 06 added the member in
> `packages/cli/src/ports.ts` for task 18 to use; task 18 correctly chose a
> `PackageManagerFactory` seam instead, because a member of `OpsContext` is
> unreachable from a command that dispatches BEFORE `createContext` - and
> `plugin add` must, since `createContext` calls `sts.getAccountId()` and add is
> what an operator runs before the repo is configured. So nothing reads
> `ctx.ports.packages` and no backlog task will, while every `deploy`, `status`
> and `bootstrap` constructs an adapter it never calls (`context.ts:219`).
> No behavioural cost; the cost is permanently misleading port wiring. **`knip`
> cannot see it** - it has no issue type for interface members, the blind spot
> already recorded in this plan's open questions. Delete it, or record why it
> stays.
> **2. Cosmetic, same file.** `plugin-commands.ts:1216`'s empty-name check is
> `=== undefined` only, so `blogwright plugin add ""` resolves to `blogwright-`,
> which the pattern accepts, and the operator gets pnpm's error rather than the
> CLI's actionable one. Same for `.` and `..`. No path, flag or version
> smuggling - the gate probed 35 hostile shapes and all 17 malicious ones were
> rejected with an empty call list.

## Steps

- [x] Record why merge-plan step 1 is not executed: it says to apply the Proposed-changes blocks to a canonical page and, if none exists, to record the SPI as a NEW canonical page and index it. No canonical spec set exists, so that fallback is live rather than conditional - but the spec's own decision keeps the SPI internal and undocumented until it has carried two features through a release cycle, and publishing a canonical SPI page now would contradict it. Write the deferral and its owner into this task's decision note and into plan.md's open questions; do not silently skip the step.
- [x] Add the plugin commands to `README.md`'s Commands block (`README.md:40-56`) beside the existing `preview` and `pds` lines, and add a short paragraph stating that the plugin SPI is internal and unversioned so no third party should write against it yet.
- [x] Confirm the `ModuleLoader` and `PackageManager` rows added by tasks 05 and 06 are present in the ports table and match the `Vcs` row's column shape, adding either only if missing - authorship belongs to 05 and 06, so this step is a verification and now agrees with this task's own definition of done at `DEVELOPMENT.md:72-81`, each naming the port file, the real adapter and the test substitute, in the same column shape as the `Vcs` and `PingBuilder` rows.
- [x] Write the changeset covering the user-facing surface this spec adds - the `plugin` namespace, generic plugin dispatch, the plugin lifecycle verbs, and the help output's Plugins section - with the semver impact stated.
- [x] Do NOT flip the spec's `Status:` here, and record why: §Plugin SPI → Plugin-supplied AWS services - the transport seam and `signingUsEast1` on `AwsClients` - lands at tasks 31 and 38 in M5, after this task, so a `Merged` header written now would claim work that has not happened. Merge-plan steps 4 and 5 therefore belong to task 58, which depends on this task and transitively on 38. Write that deferral and its owner into this task's decision note and into plan.md, the same way merge-plan step 1's deferral is recorded, and leave `.specs/README.md`'s pending list at three.
- [x] Carry the two questions the spec still leaves open forward in writing rather than dropping them - SPI version declaration (task 18's pinning is the only mechanism today) and whether `preview` becomes a plugin - and restate, with where each landed, the decisions that closed the others: the lifecycle-verb precedence and the `blogwright destroy` refusal at task 16, and `plugin remove`'s teardown question, settled 2026-07-27 as ask-first (refusing where it cannot ask) at task 18.

## Definition of done

- [x] `README.md` documents `blogwright plugin add|list|remove` and `blogwright <plugin> <action>` alongside the existing command list, and states that the SPI is internal and unversioned so no third party writes against it yet.
- [x] `DEVELOPMENT.md` §Hexagonal architecture's ports table contains the `ModuleLoader` and `PackageManager` rows added by tasks 05 and 06, each naming the port file, the real adapter and the test substitute.
- [x] A changeset covers the user-facing surface added by this spec with the semver impact stated, and merge-plan step 2 is executed. Steps 4 and 5 are NOT: `.specs/changes/2026-07-26-cli_plugin_system.md` still reads `Status: Proposed`, still sits outside `merged/`, and `.specs/README.md`'s pending list still holds three proposals - with the deferral and its owner (task 58) written down here and in plan.md, because §Plugin-supplied AWS services lands at tasks 31 and 38. A silent skip is the failure this item exists to prevent.
- [x] The two open questions this work did not answer are carried forward in writing rather than dropped - SPI version declaration and whether `preview` becomes a plugin - as are, restated as settled with their owners, the lifecycle-verb precedence and destroy-refusal decisions (task 16) and the `plugin remove` ask-first decision (settled 2026-07-27, task 18).
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`, then confirm `.specs/changes/2026-07-26-cli_plugin_system.md` is still at that path with `Status: Proposed`, that the deferral to task 58 is written in this task's decision note and in plan.md, and that no link in `.specs/README.md` is broken.

## Decision notes

Written 2026-08-30 while implementing this task. The first two are the
deferrals this task's definition of done exists to make explicit; the same two
are appended to [plan.md](../plan.md)'s `**Open questions**` block, which no
other line of was touched.

### D1 - Merge-plan step 1 is deferred, not skipped. Owner: the spec's owner (Ant Stanley)

Step 1 says to apply the spec's `Proposed changes` blocks to whichever
canonical page first documents CLI dispatch, the graph engine and the state
store, and, "if none exists, record the SPI as a new canonical page and index
it". This repo has no canonical spec set at all - `.specs/` holds change specs
and plans and nothing else - so the fallback is the live branch rather than a
conditional one.

It is refused anyway, because executing it would contradict the same spec's
own decision: *"The SPI is internal. Undocumented and unversioned until it has
carried two features through a release cycle."* A canonical SPI page IS
documentation, and indexing it would publish a contract the spec deliberately
withholds. The two obligations cannot both be honoured, so the step is
recorded as deferred with its reason rather than ticked or dropped.

Owner: the spec's owner, because what unblocks it is the product decision the
spec names, not a task. Explicitly NOT task 58: two features through a
*release cycle* is not satisfied at the end of this plan either - the pds
migration and the analytics plugin ship **in** the release this stream
produces, so the clock the spec sets starts after it, not during it.

Merge-plan step 3 (fold the `PluginManifest` `$def` into the canonical schema
"when one exists") is vacuous for the first half of the same reason - there is
no canonical schema - and carries the same owner.

### D2 - Merge-plan steps 4 and 5 are deferred to task 58. Owner: task 58

The spec's `Status:` is **not** flipped here, it is not moved to
`.specs/changes/merged/`, and `.specs/README.md`'s pending list is left at
three. The outcome is the plan's; the *reason* this task's own steps and
definition of done give for it is false, and is corrected here and in plan.md
rather than repeated. (Written 2026-08-30 on the stale premise below; rewritten
2026-08-31 once the premise was checked against the build log.)

**The stale reason.** This task's Steps, its definition of done, and
plan.md's *The plugin-system spec's merge is split across two tasks* bullet all
say §Plugin SPI -> Plugin-supplied AWS services - the transport seam and
`signingUsEast1` on `AwsClients` - "lands at tasks 31 and 38 in M5, after task
20". It does not. Task 31 landed at build 16/62 and task 38 at build 33/62,
both ancestors of this task's base at 42/62, and the seam is in this very tree:
`packages/core/src/aws/signer.ts:32` declares
`service: ServiceKey | ServiceDescriptor` and `packages/core/src/clients.ts:33`
declares `signingUsEast1: SigningClient`. This task's own Pointers line still
addresses those two files as `backlog/31-core_transport_seam.md` and
`38-analytics_client_bundle.md`, which are in `done/` - the one signal that the
premise had gone stale. A later reader of this task or of plan.md will find the
stale wording still standing in the DoD, which is not this task's to rewrite;
this note is where it is contradicted.

**The true reason.** A `Merged` header is a claim that the whole spec shipped,
and one of its `Proposed changes` blocks has not. §Plugin SPI -> A plugin owns
its own topography requires that "no config key of a plugin's is read by a site
node"; the CLI's site graph still reads `ctx.config.pds` at
`packages/cli/src/nodes.ts:971` and interpolates its secret name at `:983`.
Task 59 removes it, and task 59 is in `backlog/`. Steps 4 and 5 also do not
decompose usefully: step 5 rewrites `.specs/README.md`'s Change specs section
down to exactly two pending entries naming tasks 60 and 61, which task 58 does
in one edit covering all three specs' paperwork, and task 58's own definition
of done makes the flip conditional on re-verifying the seam - "recorded as
unmet rather than flipped if it is not" - so nothing is taken on trust there.

Task 58 owns both steps regardless: it already depends on this task and
transitively on 38, and it already closes the other specs' paperwork. Verified
at the end of this task: `.specs/changes/2026-07-26-cli_plugin_system.md` is
still at that path, still reads `Status: Proposed`, and `.specs/README.md`
still lists three pending proposals.

One PRE-EXISTING defect this task's Reviewable check surfaces and deliberately
does not fix: of `.specs/README.md`'s 11 relative links, one is broken -
`:9`'s `plans/2026-07-11-hexagonal_ports_adoption/plan.md`, whose plan has
since moved to `plans/merged/`. It is broken identically at this task's base
commit, `.specs/README.md` is not a file this task writes, and it is outside
the `.specs/` write exception this task holds. Recorded so the Reviewable item
is not read as a regression, and so whoever next edits that file (task 58,
which rewrites its Change specs section) fixes the path rather than preserving
it.

### D3 - `Ports.packages` is deleted (routed finding 1)

Deleted from `packages/cli/src/ports.ts`, with it the construction at
`packages/cli/src/context.ts` and the default at
`packages/cli/src/test-support.ts`. `PackageManager` remains a port - the
interface, the real adapter, the recording substitute and the ports-table row
all stay - it is simply no longer a member of the `Ports` bag, and
`ports.ts`'s doc comment now says why, so nobody re-adds it.

The reason is task 18's, restated: `plugin add` and `plugin remove` are the
port's only callers and both must dispatch *before* any `OpsContext` exists,
because `createContext` calls `sts.getAccountId()` and installing a plugin is
what an operator does on a repo with neither config nor credentials. A member
of `Ports` is therefore unreachable from the only code that wants it, while
every `deploy`, `status` and `bootstrap` constructed an adapter none of them
call. `cli.ts`'s `PackageManagerFactory`, wired from `bin.ts`, is still a
composition-root seam, so no port discipline is relaxed by the member's
absence.

Deleting rather than documenting-and-keeping, because `knip` has no issue type
for interface members: left in place it would have been invisible to every
gate this repo runs, forever. Evidence, not assertion:

- **Control.** Baseline `pnpm build`, `pnpm typecheck` and `pnpm test` green
  before any edit (1121 passed, 1 skipped).
- **Mutation.** Replacing `createTestContext`'s `ports.packages` with a stub
  that throws on `detect`/`add`/`remove` left all 348 CLI tests passing - the
  member is unobserved by the whole suite. Restored.
- **Total check.** `pnpm typecheck` is total over the readers of a typed
  member where `knip` is silent; it is green with the member gone, so there is
  no reader anywhere in the workspace.

One consequence: `DEVELOPMENT.md`'s `PackageManager` row named
`createTestContext` `ports.packages` overrides as its test substitute, which
this deletion made untrue. Its last column now names
`createRecordingPackageManager` passed as `main`'s `PackageManagerFactory`.
That is maintenance of a fact this task changed, not authorship of the row -
the row itself is task 06's, and both it and `ModuleLoader` were already
present and already in the `Vcs` row's column shape, so the verification step
added neither.

### D4 - The empty and dotted plugin names are refused (routed finding 2)

`blogwright plugin add ""` resolved to the bare prefix `blogwright-`, and `.`
and `..` to `blogwright-.` and `blogwright-..`, all three of which the package
name pattern accepts - so the operator read the package manager's 404 instead
of the CLI's actionable message. Fixed in `plugin-commands.ts`: an empty name
is treated as a missing one, and the pattern is now asked of the **raw** name
as well as the resolved one, because the `blogwright-` expansion is exactly
what hides a leading `.`.

It is NOT true that every name the resolved form accepts the raw form accepts
too - if it were, the raw test would be inert and the right edit would be to
delete it. The raw test costs exactly the names the prefix would have made
respectable: a non-empty name of otherwise-legal package characters opening
with `-`, `.` or `_`. Enumerated over a corpus of 8438 names (every string of
length 1-3 over `abz09~-._@/`, space, tab, `\`, `!`, `$`, `:`, `A`, newline,
`*`, plus hand-picked realistic and hostile names): the raw test accepts **0**
names the resolved test rejected, rejects **279** the resolved test accepted,
every one of those 279 opens with `-`, `.` or `_`, and **0** of them is
stranded - `blogwright-<name>` is a working spelling for each, since it starts
with the prefix, resolves to itself and clears both tests. The comment at
`plugin-commands.ts:1232-1242` now says this rather than the false converse.

Both tests were watched failing first (`add .` and `add ""` each returned 0
having called the package manager), then passing, then each half of the guard
was mutated away in turn and the matching test failed alone. No changeset
entry: `.changeset/plugin-add-remove-commands.md` already claims this
behaviour ("a filesystem path like `./thing` ... is refused rather than passed
to the package manager") for an unreleased command, and the fix makes that
sentence true rather than adding to it.

### D5 - Open questions carried forward, settled ones restated with owners

**Still open, carried forward in writing:**

- *SPI version declaration.* Nothing declares or checks an SPI version; task
  18's exact-version pin of a plugin to the running CLI is the entire
  compatibility mechanism, and it breaks down as soon as a user upgrades one
  and not the other. Already carried in plan.md's own `SPI versioning` bullet
  (unchanged by this task), and now also stated to consumers: `README.md` says
  the interface is unversioned and can change in any release.
- *Does `preview` become a plugin?* It is the one remaining built-in namespace
  shaped like one, but it shares the site's resource graph and `OpsContext` in
  ways a plugin deliberately cannot - a plugin owns a separate node set and a
  separate state key. Newly appended to plan.md's open questions; nothing in
  this plan is blocked on the answer.

**Settled, restated so the closure does not read as silence:**

- *Lifecycle-verb precedence.* Settled at **task 16**: `bootstrap` and
  `destroy` are always the generic verbs over a plugin's own `nodes`, and a
  plugin declaring either as one of its own commands is rejected at discovery,
  naming the plugin and the action; a plugin may still declare its own
  `status`, which wins over the generic one.
- *The `blogwright destroy` refusal.* Settled at **task 16**: a site teardown
  and `preview teardown` refuse while any plugin's scoped state object
  (`state/<env>.<plugin>.json`) still exists, naming each plugin and the
  runnable command that clears it, `blogwright <plugin> destroy <env> --yes`.
  Tearing the site down first would empty the bucket that holds those records
  and orphan whatever they tracked.
- *Teardown on `plugin remove`.* Settled **2026-07-27** at **task 18**:
  ask first, No by default, because removal forecloses its own remedy - the
  generic `destroy` verb exists only while the package is installed. A session
  that cannot be asked (non-interactive, or `--plain`) is refused with both
  ways forward named rather than defaulted, since one answer strands AWS
  resources and the other destroys them; `--yes` is the scripted "uninstall,
  keep the resources" answer.

### D6 - What this task did not document, and why

`docs/src/content/docs/reference/cli.md` does not mention `plugin list` (or
any plugin command), observed by task 17's gate. This task's definition of
done names `README.md` and `DEVELOPMENT.md` only, so the Astro reference page
is deliberately out of scope rather than overlooked - the plugin surface is
documented in `README.md` and in `blogwright --help`, which the reference page
mirrors. Worth a task of its own alongside the M5 analytics docs; it is not
one this task may quietly take on.
