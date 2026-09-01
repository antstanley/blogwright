# Done Certificate - Task 05: Amend the merged analytics spec, refresh its stale citations, and close this change spec

**Task:** [05-analytics_log_groups_closure.md](05-analytics_log_groups_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-09-01

> This certificate is a verification protocol for Task 05. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 05) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a document location, a resolved link, or a command's output) - not by assertion.

## Premises

- **P1 - Goal.** The merged analytics change spec carries the two new node rows, the restated
  counts, the new §Observability block and the corrected `logsUsEast1` sentence, with its thirteen
  stale prose citations refreshed; this change spec is `Merged`, moved and re-linked with its open
  questions carried; `.specs/README.md`'s Standalone pending list is empty and a merged entry sits
  beneath the analytics one; and a changeset states what an existing environment gains.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item,
  in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not alter `.specs/changes/merged/2026-07-26-analytics_plugin.md`'s
  header (it is already `Merged`, and this change's own record dates the amendment); must not
  rewrite that document's own §Implementation notes, which are a pre-implementation record whose
  pointers are deliberately against the tree as it was; must not remove the two entries
  `.specs/README.md` already carries for the pending plugin-system and pds change specs, which
  belong to tasks 60 and 61 of the 2026-07-26 plan and are not this task's to touch.

## Obligations

- **O1 - The five `Proposed changes` blocks are applied and every count reads fourteen.**
  - *Claim:* the Resource nodes table has fourteen rows with each group at the head of its chain,
    §Observability exists as a new block, Region pinning and §Namespace and commands both say
    fourteen, and §`LogsClient` delivery configuration carries the `ensureLogStream` paragraph and
    the corrected "four consumers where there were two" sentence.
  - *Evidence to collect:* read `.specs/changes/merged/2026-07-26-analytics_plugin.md`; count the
    node table's rows and confirm the two new ids sit at `analytics-transform-log-group` before
    `analytics-transform-role` and `analytics-firehose-log-group` before `analytics-firehose-role`.
    Read the new §Observability block and confirm it states the 365-day retention, the
    `DestinationDelivery` stream, and why the transform role is not granted `logs:CreateLogGroup`.
    Run `git diff` on that file and confirm the header line is untouched.
  - *Checks:* confirm the two chain-head paragraphs and the site-graph departure note travelled with
    the table - the spec's block includes the reasoning for why the two writers declare edges and
    the two roles do not, and a table pasted without it loses the design.
  - *Status:* **SATISFIED** - `.specs/changes/merged/2026-07-26-analytics_plugin.md:298-317` carries
    exactly **fourteen** `| \`analytics-*\` |` rows; `analytics-transform-log-group` sits immediately
    above `analytics-transform-role` and `analytics-firehose-log-group` immediately above
    `analytics-firehose-role`, each at the head of the chain that writes to it. The new
    §Analytics pipeline → Observability block (`:333-368`) states the 365-day retention re-applied on
    every `update`, the `DestinationDelivery` stream Firehose cannot create for itself, and why the
    transform role is **not** granted `logs:CreateLogGroup` (it has nothing to create, the site exec
    role's shape at `nodes.ts:214`). Counts: `:40` fourteen, `:86` "orphaning fourteen resources",
    `:165` "fourteen nodes", `:295` "contributes fourteen nodes". §`LogsClient` delivery configuration
    carries the `ensureLogStream` paragraph (`:431-437`) and §Region pinning carries the corrected
    "four consumers where there were two" sentence (`:189-192`).
    Header: `jj diff --git` on that file opens its first hunk at `@@ -16,7 +16,7 @@`, so lines 1-15 -
    the title and the `**Status:** Merged · **Date:** 2026-07-26 · **Merged:** 2026-08-31` line - are
    untouched.
  - *Checks:* discharged mechanically rather than by eye. Each of the five §Proposed changes blocks was
    extracted from the moved spec and searched for verbatim in the amended document: all five match
    exactly (44, 37, 6, 2 and 6 quoted lines). The Resource nodes block's 44 lines include both
    chain-head paragraphs *and* the site-graph departure note, so the reasoning travelled with the
    table rather than the table arriving alone.

- **O2 - Every relative link resolves at its new depth.**
  - *Claim:* every link inside the applied blocks resolves from `.specs/changes/merged/`, each
    having gained one `../`, and every link in the moved change spec resolves from its new location.
  - *Evidence to collect:* extract every relative link from both files and resolve each against the
    filesystem (e.g. with `ls` on the resolved path from the file's own directory). Record the count
    checked and any that failed.
  - *Checks:* the blocks were written to resolve from `.specs/changes/`, one level shallower than
    where they land - `../../packages/…` becomes `../../../packages/…`. Confirm this by comparing
    against a link that was already in the merged document, e.g.
    `.specs/changes/merged/2026-07-26-analytics_plugin.md:19`, which is `../../../packages/cli/src/nodes.ts`.
    Do **not** discharge this by counting `../` segments by eye: a link with the wrong depth renders
    as a link and fails only when followed.
  - *Status:* **SATISFIED** - resolved with an independent script (normpath each `](target)` against
    the containing file's own directory, then `os.path.exists`), not with the implementer's. Result
    over the four changed markdown files: **90 relative link occurrences, 34 distinct targets, 0
    broken.** Per file (occurrences / distinct): merged analytics spec 33 / 11, moved change spec
    29 / 10, `.specs/README.md` 13 / 13, `2026-07-26-plugin_system_and_analytics/plan.md` 15 / 7. The
    implementer's reported "11, 10, 13 and 7" are the **distinct** counts; both readings resolve
    fully, so this is a reporting nuance rather than a miss.
  - *Checks:* depth confirmed against the control the obligation names - the pre-existing
    `../../../packages/cli/src/nodes.ts` at `:19` of the merged spec - and every newly landed link in
    the applied blocks carries the same three segments. A wrong depth would have resolved to
    `.specs/packages/...`, which does not exist, so the resolver would have caught it; it caught
    nothing.

- **O3 - The thirteen stale citations are refreshed by symbol, the notes and `:130` are not, and `:40` is settled.**
  - *Claim:* the thirteen `file:line` citations in that document's prose are updated and each was
    re-verified by symbol against the shipped tree; its own §Implementation notes and the one
    exempt prose citation at `:130` are left unrefreshed with the reason recorded; and the
    §Affected spec pages row at `:40`, which the spec's blocks do not reach, is settled explicitly
    one way with the outcome named.
  - *Evidence to collect:* for each of the thirteen mappings - into `core/src/aws/logs.ts`
    (`:131→:172`, `:164-171→:211-218`, `:139→:180` twice, `:114→:146`, `:71→:95`), into
    `core/src/clients.ts` (`:68→:80`, `:28-33→:38-43`), into `core/src/aws/endpoint.ts`
    (`:36,43,65-66→:53,80,102-103`), into `cli/src/nodes.ts` (`:713→:766` twice, `:758→:817`,
    `:753-757→:813-816`, `:732→:785`) and into `core/src/config.ts` (`:352→:383`) - open the cited
    file at the new line and confirm the named symbol is there. Then confirm the one **exemption**
    is present and unrefreshed: `nodes.ts:751-761` at that document's `:130`, whose sentence
    ("Today it iterates `deliveriesForSource` and deletes every delivery") describes behaviour the
    shipped guard superseded, so its referent is gone rather than moved and there is nothing to
    renumber the pointer to. Read the task's report for the `:40` decision, for the
    §Implementation-notes reason, and for the `:130` exemption.
  - *Checks:* **`packages/core/src/aws/logs.ts` is the file task 02 edited.** Inserting
    `ensureLogStream` beneath `ensureLogGroup` shifts every line below it, and all five mappings
    into that file sit below the insertion point, so five of the thirteen were computed against a
    tree that no longer exists. A validator that accepts the recorded mapping without opening the
    file has verified nothing. If any of the five now lands on the wrong symbol, that is
    UNSATISFIED, not a rounding error. The remaining eight are into `clients.ts`, `endpoint.ts`,
    `cli/src/nodes.ts` and `config.ts`, which no task in this plan touches - they should land as
    written, and that is a check to run rather than an assumption to carry.
    A refreshed `:130`, or an exemption claimed for any citation other than `:130`, is
    UNSATISFIED: the exemption turns on the referent being **gone**, not merely on the sentence
    around it describing the pre-guard tree. Several refreshed citations (`logs.ts:139`,
    `cli/src/nodes.ts:753-757`) sit in exactly such sentences and are still refreshed, because
    §Merge plan step 3 refreshes pointers, not the prose they support.
  - *Status:* **SATISFIED** - all thirteen re-resolved **by symbol** against the shipped workspace
    tree, not against the recorded mapping. The five into `packages/core/src/aws/logs.ts`, the file
    task 02 edited, landed at the task file's numbers **+14** (task 02 inserted `ensureLogStream` at
    `:78`) and every one hits its symbol: `:186` is the `.find()` inside `findDeliveryIdBySource`
    (opens `:179`); `:225-232` is exactly `deleteDeliverySource` signature to closing brace, with the
    `isNotFound` catch at `:229`; `:194` is `deliveriesForSource`; `:160` is `createDelivery`; `:109`
    is `filterEvents`. The other eight land as written: `clients.ts:80` `secrets` over the
    primary-region signer; `clients.ts:38-43` the `logsUsEast1` doc comment and declaration;
    `endpoint.ts:53` `GLOBAL_SERVICES`, `:80` the `signingRegion` ternary, `:102-103`
    `canonicalHost`'s `case 'iam' / return 'iam.amazonaws.com'`; `cli/nodes.ts:766` `logDeliveryNode`;
    `:817` the `ConflictException` retry's `deleteDeliverySource`; `:813-816` that retry's
    `ownDeliveryIdsOrRefuse` call and delivery-deletion loop; `:785` the `createDelivery` inside
    `wire`; `config.ts:383` the `` `${env}-${cfg.siteName}` `` prefix inside `deriveNames` (opens
    `:379`).
    Exemption: `:130` still reads `nodes.ts:751-761`, unrefreshed, and the reason is recorded durably
    in the moved spec's §Merge plan step 3 rather than only in a report. §Implementation notes
    (`:567-668`) are unrefreshed, also with the reason recorded there. `:40` was **updated** to
    fourteen, with its reason and an in-document precedent stated.
  - *Checks:* the `:817` vs `:831` distinction is right - `:817` is the retry's call, `:831` is
    `delete()`'s own, and the sentence names the retry's. No citation was refreshed that should have
    been exempt, and no exemption was claimed beyond `:130`. The five citations the applied blocks
    newly introduce were also verified rather than assumed: `cli/nodes.ts:75` `logGroupNode`, `:157`
    and `:225` the two `dependsOn: ['bucket', 'microvm-log-group']` declarations, `:214` the exec
    role's `['logs:CreateLogStream', 'logs:PutLogEvents']` without `CreateLogGroup`, `:27-29`
    `logGroupArn`, and `logs.ts:61` `ensureLogGroup`.

- **O4 - Merge-plan steps 4 and 5 are recorded as not applicable, with a reason and an owner.**
  - *Claim:* step 4 (no schema fold) and step 5 (no `DEVELOPMENT.md` edit) are each recorded with
    the reason they do not apply and an owner, rather than passed over.
  - *Evidence to collect:* read the task's report and confirm both are named with their reasons -
    step 4 because this change has no `Type changes` schema fragment, `IcebergDestinationInput`
    being a TypeScript interface internal to the plugin's Firehose client; step 5 because there is
    no new port, no new toolchain entry and no change to the package split - and that both carry
    an owner. Compare against the precedents at
    `.specs/plans/2026-07-26-plugin_system_and_analytics/done/30-pds_migration_closure.md` and
    `done/58-analytics_docs_and_closure.md`.
  - *Checks:* a step passed over silently is indistinguishable from a step forgotten. Absence of a
    mention is UNSATISFIED, not UNVERIFIED.
  - *Status:* **SATISFIED** - an **Execution record (2026-09-01)** block appended to the moved spec's
    §Merge plan (`:426-449`) records step 4 (no schema fold: no `Type changes` entry carrying a schema
    fragment, `IcebergDestinationInput` being a TypeScript interface internal to the plugin's Firehose
    client with no `$def` to fold) and step 5 (no `DEVELOPMENT.md` edit: no new port, no new toolchain
    entry, no change to the package split) as **not applicable**, each with its reason and
    **Owner: Ant Stanley**. It also records which task executed steps 1, 2, 3, 6 and 7.
  - *Checks:* neither step is passed over silently, and the record is durable - it lives in the merged
    document a later reader opens, not only in a build report. The same block carries the `logs.ts`
    +14 correction, which is the shape the two closure precedents use.

- **O5 - This change spec is merged, moved, re-linked, and de-registered.**
  - *Claim:* its `Status:` is `Merged` with a `Merged:` date, it sits at
    `.specs/changes/merged/2026-08-31-analytics_owned_log_groups.md`, every relative link inside it
    resolves at the new depth, its four open questions are carried, and `.specs/README.md`'s
    Standalone pending list is empty with its introductory sentence corrected and a merged entry
    added beneath the analytics one.
  - *Evidence to collect:* run `ls .specs/changes .specs/changes/merged`; read the moved file's
    header and its Open questions block; resolve its links - its reference to the merged analytics
    spec is now a sibling, and its reference to this plan folder gained a level. Read
    `.specs/README.md` §Change specs.
  - *Checks:* the Standalone heading's introductory sentence counts what is pending; deleting only
    the entry leaves a sentence describing a list that no longer exists. Confirm the two linked
    2026-07-26 entries are still present and still named as tasks 60's and 61's - they belong to
    the other plan and this task must not clear them.
  - *Status:* **SATISFIED** - `ls .specs/changes` now shows only the two 2026-07-26 proposals and
    `merged/`; `ls .specs/changes/merged` shows `2026-08-31-analytics_owned_log_groups.md`. Its header
    reads `**Status:** Merged · **Date:** 2026-08-31 · **Merged:** 2026-09-01`. Its links were
    re-depthed (twenty `../../` → `../../../` for `packages/`, its plan-folder links to `../../plans/`,
    and its five §Affected spec pages links to the sibling `2026-07-26-analytics_plugin.md`) and all
    29 occurrences resolve. **Four** open questions are carried: the stream node's whole-destination
    guard (the plan's own, carried first and attributed to the plan), configurable retention, the
    site build role's `logs:CreateLogGroup`, and whether `analytics status` should report the groups.
    `.specs/README.md` has no Standalone heading or list left, and its introductory sentence was
    rewritten to "Pending - two of the three linked 2026-07-26 proposals, and no standalone ones",
    naming the 2026-08-31 spec as merged below. The merged entry sits directly beneath the analytics
    entry it amends (`:72-87`).
  - *Checks:* the introductory sentence was corrected, not merely orphaned - deleting only the entry
    would have left "one standalone proposal" describing nothing. Both linked 2026-07-26 entries
    survive untouched with resolving links and their flip-task attributions intact (both read
    "**Flipped at task 60.**"; the certificate's "tasks 60's and 61's" is slightly loose - task 61
    flipped the *analytics* entry - but the entries this task must not clear are both present).

- **O6 - A changeset states the operator consequence, and the six gates are green.**
  - *Claim:* a changeset names the semver impact and what an existing environment's next
    `analytics bootstrap` does - two new log groups, a 365-day retention, a new log stream, a fifth
    statement on the delivery role, and one in-place `UpdateDestination` that keeps the stream's ARN
    so the CloudFront delivery is untouched - and the repo's six gates pass.
  - *Evidence to collect:* read the changeset; confirm it names `blogwright-analytics` and states
    each of those five consequences plus that nothing needs a teardown. Run `pnpm build`,
    `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .` and `pnpm knip` from the
    repo root, in `.github/workflows/ci.yml:21-40` order, and record each.
  - *Checks:* the four published packages are one `fixed` group (`.changeset/config.json`), so this
    changeset versions all four together; a changeset naming only `blogwright-analytics` is correct
    and its release will still move the other three. Confirm the changeset does not claim the change
    is internal-only: it provisions AWS resources an operator pays for and widens an IAM policy.
  - *Status:* **SATISFIED** - `.changeset/analytics-owned-log-groups.md` exists, `minor` on
    **`blogwright-analytics`** and **`blogwright-core`**. It states all five operator consequences and
    the no-teardown claim in one sentence: "the next `blogwright analytics bootstrap` does five
    things, and needs no teardown to do any of them: it creates the two log groups, applies the
    365-day retention to each, creates the `DestinationDelivery` log stream, adds a fifth statement to
    the Firehose delivery role granting `logs:PutLogEvents` on that one stream's ARN, and issues one
    `UpdateDestination` against the live delivery stream" - plus "`UpdateDestination` keeps the
    stream's ARN, so the CloudFront log delivery pointed at it is untouched and no access log is
    lost." It does not present the change as internal-only.
    Six gates, run from the workspace root in `.github/workflows/ci.yml` order, all exit 0:
    `pnpm build` PASS · `pnpm typecheck` PASS (337 files, 0 errors) · `TZ=America/New_York pnpm test`
    PASS (core 156/1 skipped, build-agent 27, pds 150, analytics 824, cli 376 - 1533 passing) ·
    `pnpm lint` PASS (19 pre-existing `no-shadow` **warnings** in `cli/src/nodes.test.ts`, untouched by
    this task, exit 0) · `pnpm exec oxfmt --check .` PASS (208 files) · `pnpm knip` PASS.
  - *Checks:* the bump is defensible. `.changeset/config.json` `fixed` is
    `["blogwright","blogwright-core","blogwright-pds","blogwright-analytics"]`, so naming two of the
    four versions all four together; naming `blogwright-core` as well as `blogwright-analytics` is
    more precise than the obligation's minimum, since core genuinely gains a public method
    (`LogsClient.ensureLogStream`). `minor` is right for an additive API and two new nodes with no
    break. The repo is in changesets **pre** mode (`.changeset/pre.json`, tag `beta`,
    `initialVersions` at 0.3.3) and `pre.json` was **not** hand-edited - `jj diff --git
    .changeset/pre.json` is empty, and the new changeset's id is correctly absent from its
    `changesets` array, which `changeset version` populates.

- **O7 - Reviewable: the moved file, the fourteen-row table, the resolving links, and the count grep.**
  - *Claim:* a reviewer can run `ls .specs/changes .specs/changes/merged` and see this spec moved
    with a `Merged:` date; open the merged analytics spec and see fourteen table rows and a
    §Observability block; follow every relative link in both files and in the changed part of
    `.specs/README.md` and see each resolve; and run
    `grep -n "twelve" .specs/changes/merged/2026-07-26-analytics_plugin.md` and find only hits the
    task deliberately kept and named.
  - *Evidence to collect:* run both commands and record the output; resolve the links. For the grep,
    confirm each remaining hit is either inside that document's own §Implementation notes (two, at
    `:555-556` before this task's edits) or the §Affected spec pages row at `:40` **with the
    report's reason for keeping it**. A hit nobody named is a count nobody looked at, and makes this
    obligation UNSATISFIED.
  - *Status:* **SATISFIED** - all four exercised, not assumed. `ls .specs/changes
    .specs/changes/merged` shows the spec moved, with `**Merged:** 2026-09-01` in its header. The
    amended analytics spec opens on a fourteen-row node table and a §Analytics pipeline →
    Observability block. Every relative link in both files and in `.specs/README.md` resolves (90
    occurrences across the four changed files, 0 broken, by my own resolver).
    `grep -n "twelve" .specs/changes/merged/2026-07-26-analytics_plugin.md` returns **exactly two**
    hits, `:626` and `:627`, and both sit inside §Implementation notes, whose bounds I measured
    independently: `## Implementation notes` at `:567`, `## Merge plan` at `:668`. Both are hits the
    task named and justified. The `:40` hit the obligation contemplated keeping is **gone** - that row
    was updated to fourteen instead, which is the stronger outcome. **No surviving hit is one nobody
    named.**
  - *Note on the check's shape:* this grep is the one the hazard list flags as most exposed to going
    quiet for the wrong reason. It does not: it runs over the amended document itself, the two
    survivors are load-bearing prose in a block the task deliberately froze, and their containment in
    §Implementation notes was verified by line bounds rather than asserted.

## Regression check

This task touches documents rather than code, so the regression surface is the link graph and the
index:

- `.specs/README.md`'s two remaining pending entries (the plugin-system and pds change specs, named
  as tasks 60's and 61's) → both still listed, both links resolve, both flip-task attributions and
  outstanding-block notes intact; the diff touches only the paragraph above them :
  **PRESERVED**
- Every inbound link to `.specs/changes/2026-08-31-analytics_owned_log_groups.md` from this plan's
  five task files and its `plan.md` → **REGRESSION, out of the implementer's remit and deferred to
  the merge.** Eight link occurrences across six documents now dangle: `plan.md:3`, `:30`, `:46` and
  `:5` of each of the five task files. All eight live inside
  `.specs/plans/2026-08-31-analytics_owned_log_groups/`, which the build declared **off limits** to
  the implementer because it is this build's live kanban board. The implementer did not edit them and
  did flag them. It *did* fix the two equivalent links it was allowed to reach, at
  `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md:1943` and `:1961`, repointing both to
  `../../changes/merged/…`; both now resolve. **Handoff:** spec-builder must repoint the eight when it
  moves task 05 to `done/`, or they ship broken. Recorded here rather than charged to the task,
  because the fix was forbidden by the harness, not overlooked :
  **REGRESSION (deferred - orchestrator to repoint at merge)**
- `.specs/changes/merged/2026-07-26-analytics_plugin.md`'s pre-existing links, which this task did
  not touch → all 33 relative link occurrences in that file resolve (11 distinct targets, 0 broken).
  No bulk `../../` rewrite happened: the diff's link edits are confined to the thirteen refreshed
  citations and the newly landed blocks :
  **PRESERVED**
- The 2026-07-26 plan's own §Assumptions and open questions and its lessons block, which reference
  the analytics spec → substantively unchanged. The whole diff to that file is four lines: two link
  targets in the lessons block repointed from `../../changes/…` to `../../changes/merged/…` because
  the target moved. Leaving them would have been the regression. The block's prose, including its
  already-corrected "twelve to fourteen" sentence, is untouched :
  **PRESERVED**

## Residue

Notes for the validator, not obligations. This plan's own `plan.md` `Status:` is spec-builder's to
recompute from the kanban subfolders, not this task's to flip. The plan's four carried open
questions include one the change spec does not hold - whether the stream node's guard should
compare the whole live destination rather than a growing list of fields - and it should travel with
the three from the spec, since it is the cost this change's design leaves behind rather than a
question it answers. If the validator finds the merged analytics spec's own §Implementation notes
renumbered to the shipped tree, that is a defect and not an improvement: several of them say
outright that they describe the tree as it was, and renumbering makes a historical instruction
describe a state it was written to change.

## Conclusion

VERDICT: **DONE**
CONFIDENCE: **high**
SUMMARY: O1-O7 are all SATISFIED on evidence collected independently - fourteen table rows with each
group at the head of its chain, all five §Proposed changes blocks applied verbatim (95 quoted lines),
90 relative link occurrences resolving and 0 broken by my own resolver, all thirteen citations
re-resolved **by symbol** (the five into `logs.ts` at the task file's numbers +14, and the `:817` vs
`:831` `deleteDeliverySource` distinction correct), `grep -n "twelve"` down to exactly two named hits
both inside §Implementation notes with `:40` updated rather than kept, steps 4 and 5 recorded
not-applicable with reasons and an owner in a durable Execution record, the spec `Merged` and moved
with four open questions and a corrected README sentence, a `minor` changeset stating all five
operator consequences and the no-teardown claim over an unedited `pre.json`, and all six CI gates
green over an empty `jj diff --stat packages/`; the single regression - eight inbound links dangling
inside the off-limits plan folder - is a merge-time handoff the harness forbade the implementer to
fix and that the implementer flagged, so it is recorded against the orchestrator rather than charged
to the task.

**Validator deviations and notes.**
1. **`git` does not work in the workspace** (`/Users/ant/code/blogwright-task-05` has no `.git`;
   `git status` returns "fatal: not a git repository"). O1's "run `git diff` on that file" was
   discharged with `jj diff --git <path>`, which produces the same unified diff and showed the
   merged spec's first hunk at `@@ -16,7 +16,7 @@`, proving lines 1-15 untouched. Recorded as a
   deviation, not a failed obligation.
2. **The certificate's own pointers had drifted**, exactly as its O3 check warned. Every one was
   resolved by symbol instead: `:555-556` for the §Implementation notes "twelve" hits is now
   `:626-627`, and the notes block now spans `:567-668`. The `:130` exemption is still at `:130`.
3. **The `logs.ts` mapping in the *task file* is stale by +14** and is left stale, correctly: the
   moved spec's Execution record states the correction rather than rewriting the merge plan.
4. **The moved change spec's own citations were re-depthed but not renumbered** - e.g.
   `logs.ts:73` for `putRetentionPolicy`, which now sits at `:87` after `ensureLogStream`. This is
   right by the same convention that freezes §Implementation notes (a change spec is a
   pre-implementation record, and `:73` was correct against `main@3d47969`), and it is outside the
   thirteen this task owed. Worth noting only because, unlike the merged spec's notes, the moved spec
   does not say so on its own face.
5. **The whitespace claim holds.** The one non-link edit to the moved spec is a line-break reflow in
   §Observability ("...before this change\n- without a teardown." → "...before this\nchange - without
   a teardown."). Word streams are identical, and it fixes a real hazard: `> - without a teardown.`
   at a line start renders as a list item. The applied copy and the source block were compared
   line-for-line and are **textually identical**, 37 lines each.
6. **`.specs/README.md`'s pending entries are both attributed to task 60**, not "tasks 60's and 61's"
   as the certificate's O5 check words it; task 61 flipped the analytics entry. The obligation - that
   this task must not clear the two entries - is met either way.
