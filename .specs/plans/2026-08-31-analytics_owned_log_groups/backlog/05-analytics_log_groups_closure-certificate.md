# Done Certificate - Task 05: Amend the merged analytics spec, refresh its stale citations, and close this change spec

**Task:** [05-analytics_log_groups_closure.md](05-analytics_log_groups_closure.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-08-31 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

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
  - *Status:* ☐ unverified

## Regression check

This task touches documents rather than code, so the regression surface is the link graph and the
index:

- `.specs/README.md`'s two remaining pending entries (the plugin-system and pds change specs, named
  as tasks 60's and 61's) → expect both still listed with resolving links :
  ☐ (PRESERVED / REGRESSION)
- Every inbound link to `.specs/changes/2026-08-31-analytics_owned_log_groups.md` from this plan's
  five task files and its `plan.md` → expect each still resolving after the move, or updated :
  ☐ (PRESERVED / REGRESSION)
- `.specs/changes/merged/2026-07-26-analytics_plugin.md`'s pre-existing links, which this task did
  not touch → expect all still resolving; a bulk find-and-replace on `../../` would have broken them
  : ☐ (PRESERVED / REGRESSION)
- The 2026-07-26 plan's own §Assumptions and open questions and its lessons block, which reference
  the analytics spec → expect unchanged : ☐ (PRESERVED / REGRESSION)

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

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
