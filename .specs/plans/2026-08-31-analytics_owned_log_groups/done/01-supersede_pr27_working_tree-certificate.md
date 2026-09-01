# Done Certificate - Task 01: Reset PR #27's three paths, keep this spec's own two, and close that PR unmerged

**Task:** [01-supersede_pr27_working_tree.md](01-supersede_pr27_working_tree.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 01. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 01) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a command's output, or a version-control state) - not by assertion.

## Premises

- **P1 - Goal.** The working tree carries none of PR #27, that PR is closed unmerged, and this
  spec's own `.specs/README.md` registration and the 2026-07-26 plan's lessons block both survive
  with the block's two superseded sentences corrected.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item,
  in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not lose the two documents this spec's own drafting put in the tree
  (`.specs/README.md`'s Standalone entry and the lessons block appended to
  `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md`), and must not leave
  `packages/analytics/src/nodes.ts` and `packages/analytics/src/nodes.test.ts` in disagreement -
  resetting the source without the test reddens the whole-document `toStrictEqual` on the
  transform role's policy.

## Obligations

- **O1 - The three paths are reset and nothing else under `packages/` or `.changeset/` moved.**
  - *Claim:* `git diff packages/ .changeset` is empty, and `git status --short` lists exactly four
    paths, all under `.specs/`: `.specs/README.md` (modified),
    `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md` (modified), the untracked
    `.specs/changes/2026-08-31-analytics_owned_log_groups.md`, and the untracked
    `.specs/plans/2026-08-31-analytics_owned_log_groups/`.
  - *Evidence to collect:* run `git status --short` and `git diff --stat packages/ .changeset`;
    record both verbatim. Confirm the changeset is gone from the **index** as well as the worktree -
    it was staged (`A ` in the short status before the task), so a `git checkout --` alone leaves
    it staged and invisible to `git diff` without `--cached`. Run `git diff --cached --stat` too.
    The fourth path is this plan's own folder and is a **KEEP**, not a leftover: it holds the task
    file being discharged, so it is necessarily present while the task runs, and O1's own check
    pins HEAD at `3d47969`, so it cannot have been committed away either. Git reports an untracked
    directory as a single `??` line whatever its kanban subfolders hold, so it contributes exactly
    one path however many task files have moved. A validator that reads this obligation as "three
    paths" fails it on a correct tree.
  - *Checks:* confirm `git log --oneline -1` is still `3d47969` - a task that reset by committing
    or by resetting to a different base changed what "reset" means for every later task's pointers.
  - *Status:* **SATISFIED** (with one recorded deviation from the obligation's literal wording)
    - `git diff --stat packages/ .changeset` -> empty. `git diff --cached --stat` -> empty.
      `git status --porcelain --untracked-files=all -- packages/ .changeset/` -> empty.
      `git diff HEAD --stat -- packages/analytics/src/nodes.ts packages/analytics/src/nodes.test.ts`
      -> empty, so both files are byte-identical to `3d47969`, not merely close to it.
    - The changeset is gone from the **index** as well as the worktree:
      `git ls-files --error-unmatch .changeset/transform-log-group-grant.md` ->
      `pathspec ... did not match any file(s) known to git`; `ls .changeset/` does not list it.
      No new changeset was added.
    - `git status --short` output as collected (15 lines):
      ` M .specs/README.md` · ` A .specs/changes/2026-08-31-analytics_owned_log_groups.md` ·
      ` M .specs/plans/2026-07-26-plugin_system_and_analytics/plan.md` ·
      ` D backlog/01-supersede_pr27_working_tree{,-certificate}.md` (2 lines) ·
      ` A backlog/0{2,3,4,5}-*{,-certificate}.md` (8 lines) · ` A .../plan.md` ·
      `?? .../in-progress/`. Every line is under `.specs/`; nothing under `packages/` or
      `.changeset/`, staged or unstaged.
    - **Deviation (validator's finding, not the implementer's defect).** This repo is a **jj
      colocated** repo. jj intent-to-adds every new file into the git index individually, so
      the plan folder does **not** collapse to a single `??` line as the obligation's prose
      assumes; it yields one ` A ` line per file plus a `??` for the not-yet-tracked
      `in-progress/`. A literal four-line listing is therefore unachievable on a correct tree,
      and a validator insisting on one would fail correct work - the very "check that cannot
      pass" class this plan's baseline warns about. Discharged on the obligation's intent:
      **exactly these four path groups and nothing else** - `.specs/README.md`,
      `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md`,
      `.specs/changes/2026-08-31-analytics_owned_log_groups.md`, and
      `.specs/plans/2026-08-31-analytics_owned_log_groups/**`. Confirmed.
    - The two ` D ` lines are the orchestrator's kanban move of task 01 from `backlog/` to
      `in-progress/`, not damage from the reset: both files were confirmed present on disk at
      `.specs/plans/2026-08-31-analytics_owned_log_groups/in-progress/` (`ls -la`).
    - *Check:* `git log --oneline -1` -> `3d47969 Version packages for release (beta) (#26)`,
      before and after every command this validation ran. PASS.

- **O2 - The two kept files still carry what this spec put in them.**
  - *Claim:* `.specs/README.md`'s Standalone entry for this spec is present and resolves to
    `changes/2026-08-31-analytics_owned_log_groups.md`, and the lessons block is still at the end
    of `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md`.
  - *Evidence to collect:* read `.specs/README.md` §Change specs and confirm the Standalone entry
    is present with a resolving link; run `tail -40` on the 2026-07-26 plan and confirm the lessons
    block ("The first production run found two observability gaps…") is present rather than
    truncated. Run `git diff --stat .specs/` and confirm both files show insertions, not a reversal
    to their committed state.
  - *Checks:* a blanket `git checkout .`, `git restore .` or `git stash` would have reverted both.
    If either file's diff against HEAD is empty, this obligation is UNSATISFIED regardless of what
    the task's report says.
  - *Status:* **SATISFIED**
    - `.specs/README.md` §Change specs carries the Standalone entry
      "The analytics plugin owns its two CloudWatch log groups" linking
      `changes/2026-08-31-analytics_owned_log_groups.md`, which resolves on disk
      (`.specs/changes/2026-08-31-analytics_owned_log_groups.md`, 33273 bytes). The §Plans list
      also gained an "Analytics-owned log groups" entry linking
      `plans/2026-08-31-analytics_owned_log_groups/plan.md`, which also resolves.
    - `tail -47` on `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md` shows the
      lessons block ("The first production run found two observability gaps...") intact at the
      end of the file, not truncated.
    - `git diff --numstat` -> `.specs/README.md` **29 insertions / 3 deletions**;
      `.../2026-07-26-plugin_system_and_analytics/plan.md` **47 insertions / 0 deletions**.
      Both are net insertions; neither diff is empty, so no blanket reset reverted them.
    - *Note:* the implementer reported README as `+32/-3`. The diffstat's `32` is the combined
      changed-line count (29 + 3), not the insertion count. Cosmetic misreading; the obligation
      is unaffected.

- **O3 - The lessons block's two superseded sentences are corrected.**
  - *Claim:* the block states fourteen nodes rather than "a thirteenth node", no longer says the
    missing-grant finding was "Fixed by granting it, scoped to the function's own group", and
    points a reader at this plan rather than at a closed PR.
  - *Evidence to collect:* read the lessons block in full; quote the two sentences as they now
    stand. Confirm the rest of the block is unchanged - in particular its closing paragraph on
    record-level failure signals versus explanatory logs, which is the argument this change is
    built on and is not this task's to rewrite.
  - *Checks:* `grep -n "thirteenth" .specs/plans/2026-07-26-plugin_system_and_analytics/plan.md`
    returns nothing. This grep can fail: the word appears exactly once in the tree today, in the
    sentence being corrected, and no replacement text has a reason to reintroduce it.
  - *Status:* **SATISFIED**
    - Sentence 1, as it now stands: "... the one artifact that says *why* the transform did
      what it did did not exist. **Not fixed by granting it:**
      [`changes/2026-08-31-analytics_owned_log_groups.md`](...) supersedes that fix and has the
      plugin own the group as a resource node instead, so the role keeps the two actions it
      has. A node that owns the group gets a lifecycle, a 365-day retention policy and a
      teardown; the grant would have got a group that appears at some unpredictable first
      invocation, retained forever, that nothing reconciles and nothing removes. Planned in
      [`plans/2026-08-31-analytics_owned_log_groups/plan.md`](...)."
    - Sentence 2, as it now stands: "... enabling it means **owning that group as a node** with
      a lifecycle, a teardown and a retention policy ... Both gaps are taken together by
      [`changes/2026-08-31-analytics_owned_log_groups.md`](...), which gives each writer its own
      group: **two nodes, taking the plugin's set from twelve to fourteen.**"
    - Both new relative links resolve from the plan file's depth: `../../changes/...md` ->
      `.specs/changes/2026-08-31-analytics_owned_log_groups.md` (exists);
      `../2026-08-31-analytics_owned_log_groups/plan.md` -> exists.
    - **The rest of the block is provably unchanged.** PR #27's branch carries the original
      block, so the comparison is exact rather than remembered: `git fetch origin
      fix/analytics-observability` then `diff -u` of `git show FETCH_HEAD:...plan.md | tail -34`
      against `tail -47` of the working tree shows changes confined to the two sentences above.
      The closing paragraph on record-level failure signals versus explanatory logs is
      **byte-identical** to PR #27's version.
    - *Check:* `grep -n "thirteenth" .specs/plans/2026-07-26-plugin_system_and_analytics/plan.md`
      -> no output, exit 1. PASS.
    - *Note on that check's stated justification:* the obligation claims the word "appears
      exactly once in the tree today". It does not - `grep -rn thirteenth .specs/` also matches
      `.specs/changes/2026-08-31-analytics_owned_log_groups.md:362` (which quotes the sentence
      being corrected) and this task file and certificate. The **command as written** is scoped
      to the one plan file and is sound and falsifiable there; only its justifying prose
      overstates. Recorded, not held against the work.

- **O4 - PR #27 is closed unmerged, and its grant is nowhere in the tree.**
  - *Claim:* `gh pr view 27` reports `CLOSED` with a null `mergedAt`, the closing comment names
    this change spec, and the transform role's inline policy statement is
    `['logs:CreateLogStream', 'logs:PutLogEvents']`.
  - *Evidence to collect:* run `gh pr view 27 --json state,mergedAt,url` and record the output;
    read the closing comment. Read `packages/analytics/src/nodes.ts:1032` and
    `packages/analytics/src/nodes.test.ts:1668-1682` and confirm both name the two-action statement.
    Run `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` and confirm
    the `analytics-transform-role` policy case passes.
  - *Checks:* do **not** discharge this with `grep -rn "logs:CreateLogGroup" packages/analytics/`.
    It works today only because no comment mentions the action; task 03 adds one that does, in
    order to say the role is deliberately not granted it, at which point the grep matches its own
    documentation. Read the policy array, or run the policy test.
  - *Status:* **SATISFIED**
    - `gh pr view 27 --json state,mergedAt,url,title,headRefName,closedAt` ->
      `{"closedAt":"2026-08-31T19:38:54Z","headRefName":"fix/analytics-observability",`
      `"mergedAt":null,"state":"CLOSED","title":"Grant the transform role logs:CreateLogGroup",`
      `"url":"https://github.com/antstanley/blogwright/pull/27"}`. CLOSED, `mergedAt` null.
    - The closing comment (read via `gh pr view 27 --comments`) opens "Superseded by the change
      spec `.specs/changes/2026-08-31-analytics_owned_log_groups.md` ... planned in
      `.specs/plans/2026-08-31-analytics_owned_log_groups/plan.md`. Closing unmerged rather than
      merging.", keeps the finding, and states the owning-beats-granting rationale (lifecycle,
      365-day retention, teardown versus a group at an unpredictable first invocation, retained
      forever, that nothing reconciles and nothing removes). It also records that the branch is
      left in place - confirmed independently: `git ls-remote --heads origin
      fix/analytics-observability` -> `15ab4137... refs/heads/fix/analytics-observability`.
    - *Check honoured:* discharged by **reading the policy array and running the policy test**,
      not by `grep -rn "logs:CreateLogGroup" packages/analytics/`.
      `packages/analytics/src/nodes.ts:1032` is
      `Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],` inside `applyTransformRolePolicy`
      (`:1026`), and `packages/analytics/src/nodes.test.ts:1668-1682`'s whole-document
      `toStrictEqual` asserts the same two actions. `nodes.ts:912` reads
      `**No node creates this group.**`; the file is 3067 lines.
    - `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` ->
      `analytics-transform-role > grants on two concrete ARNs and no wildcard resource` PASS;
      168/168 passed.
    - **Mutation reproduced by this validator, not taken on report.** sha256 recorded first
      (`e112a053...` nodes.ts). Line 1032 rewritten to
      `Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],`; the run
      gave `FAIL src/nodes.test.ts > analytics-transform-role > grants on two concrete ARNs and
      no wildcard resource` / `AssertionError: expected { Version: '2012-10-17', ...(1) } to
      strictly equal ...` with the diff line `+ "logs:CreateLogGroup"`. That `+` line is the
      **recorded PutRolePolicy body**, which proves the mutated line *executed* rather than
      merely changed. Exactly one test reddened, and the assertion that reddened is the
      strongest one (the whole-document `toStrictEqual` at `:1668`), not a dominated sibling -
      the `resources` length/wildcard assertions below it never ran. Restored from a
      pre-mutation copy; sha256 re-taken and **identical** (`e112a053...`), a stricter check
      than `git diff`.

- **O5 - Meets the repo definition of done.**
  - *Claim:* the six gates are green on the reset tree, and no changeset was added - the one in
    play was removed.
  - *Evidence to collect:* run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`,
    `pnpm exec oxfmt --check .` and `pnpm knip` from the repo root, in that order (the order
    `.github/workflows/ci.yml:21-40` runs them), and record each result. Run `ls .changeset/` and
    confirm `transform-log-group-grant.md` is absent and no new changeset was added.
  - *Checks:* this is the run whose greenness every later task's baseline claim inherits - "main
    plus this spec's documents". If a gate is red here, no later task's green gate means what it
    is taken to mean.
  - *Status:* **SATISFIED**
    - Run by this validator from the repo root, in `.github/workflows/ci.yml:21-40` order
      (pointer re-resolved and accurate):
      `pnpm build` exit 0 · `pnpm typecheck` exit 0 (337 files, 0 errors) ·
      `TZ=America/New_York pnpm test` exit 0 - core 153 passed / 1 skipped, build-agent 27,
      pds 150, analytics 800, cli 376 = **1506 passed, 1 skipped** ·
      `pnpm lint` exit 0 (only pre-existing `no-shadow` warnings in `packages/cli`, which do not
      fail the gate) · `pnpm exec oxfmt --check .` exit 0, "All matched files use the correct
      format", 208 files · `pnpm knip` exit 0, no output.
    - `ls .changeset/` -> `transform-log-group-grant.md` **absent**; the directory carries only
      pre-existing changesets, `config.json`, `pre.json` and `README.md`. `git status` reports
      nothing under `.changeset/`, so none was added either.
    - *Check:* this is the baseline every later task inherits, and it is green: "main plus this
      spec's documents" is an accurate description of the tree the gates ran on, since
      `git diff HEAD -- packages/ .changeset` is empty and HEAD is `3d47969`.

- **O6 - Reviewable: the three commands, the policy test, and the closed PR.**
  - *Claim:* a reviewer can run `git status --short`, `git diff --stat packages/ .changeset` and
    `git log --oneline -1` and see only the four `.specs` paths of O1, an empty diff and HEAD at
    `3d47969`; then see the transform-role policy case green and PR #27 closed unmerged.
  - *Evidence to collect:* run all three commands and record their output; run
    `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` and record the
    `analytics-transform-role` case; run `gh pr view 27`.
  - *Status:* **SATISFIED**
    - `git status --short` -> the four `.specs` path groups of O1 and nothing else (see O1 for
      the jj deviation on line count).
    - `git diff --stat packages/ .changeset` -> empty.
    - `git log --oneline -1` -> `3d47969 Version packages for release (beta) (#26)`.
    - `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` ->
      `analytics-transform-role > grants on two concrete ARNs and no wildcard resource` PASS
      (168/168), and demonstrably able to fail (see O4's mutation).
    - `gh pr view 27` -> CLOSED, `mergedAt` null, closing comment naming this change spec.
    - Exercised, not assumed: every command above was run by this validator.

## Regression check

This task removes code rather than adding it, so the regression surface is what the removal
restores:

- `packages/analytics/src/nodes.test.ts:1668`'s whole-document `toStrictEqual` on the transform
  role's policy → expect it to pass against a two-action statement, which it does only if the
  source and the test were reset together : **PRESERVED** - passes in the verbose run (168/168),
  and is not vacuous: reinstating `logs:CreateLogGroup` at `nodes.ts:1032` reddens exactly this
  assertion with `+ "logs:CreateLogGroup"` in the recorded request body, proving the mutated
  line executed rather than merely changed.
- `analyticsTransformRoleNode().create` → expect the recorded `PutRolePolicy` document to carry
  two statements and two actions in the first, identical to `main@3d47969` : **PRESERVED** -
  `create` (`nodes.ts:1238`) and `update` (`:1241`) both call `applyTransformRolePolicy`
  (`:1026`), whose `Resource: transformLogGroupArn(ctx)` at `:1033` resolves by the 5-step
  sequence to the module-level definition at `nodes.ts:922` (step 3) - a single definition, not
  exported and not imported anywhere, so no shadowing. `git diff HEAD` on `nodes.ts` and
  `nodes.test.ts` is empty, so the emitted document is byte-identical to `main@3d47969`.
- `.specs/README.md`'s Standalone entry and the 2026-07-26 plan's lessons block, as documents a
  wide reset would have taken → expect both present : **PRESERVED** - README +29/-3 with the
  Standalone entry resolving, the 2026-07-26 plan +47/-0 with the lessons block intact at the
  end of the file.

## Residue

Notes for the validator, not obligations. The `fix/analytics-observability` branch is deliberately
kept after the PR is closed; its presence is not a failure of O4. The spec's §Implementation notes
describe PR #27's working-tree diff as sitting at `:911` and `:1031`; the diff hunks put the comment
rewrite at `main:900-921` and the policy edit at `main:1032`, a one-line drift in the spec's prose
that changes nothing about what is reset. If the validator finds the transform role's policy has
three actions, the reset did not happen and every later task in this plan is building on the
superseded design - stop and report rather than reconciling.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: **DONE**
CONFIDENCE: **high**
SUMMARY: O1-O6 are all SATISFIED against evidence this validator collected and commands it ran
itself - `packages/` and `.changeset/` are byte-identical to `3d47969` with the staged changeset
gone from the index, both kept documents survive as net insertions with the two superseded
sentences reworded and the closing paragraph byte-identical to PR #27's, PR #27 is CLOSED with a
null `mergedAt` and a comment naming this spec, all six gates are green (1506 passed, 1 skipped),
and all three regression items are PRESERVED - with the single deviation that O1's "exactly four
paths" is discharged as four **path groups**, because jj colocation intent-to-adds each new file
individually and a literal four-line listing cannot occur on a correct tree in this repo.

**Correctness gate (semi-formal-review, same reading):** VERDICT **CORRECT**, CONFIDENCE **high**.
P1 - the change reverts `packages/analytics/src/nodes.ts` and `nodes.test.ts` to `3d47969`,
removes `.changeset/transform-log-group-grant.md` from worktree and index, and edits two
sentences of the lessons block in `.specs/plans/2026-07-26-plugin_system_and_analytics/plan.md`.
P2 - it must leave a tree carrying none of PR #27 while keeping this spec's own documents, and
close that PR unmerged. P3 - it must not desynchronise `nodes.ts` from `nodes.test.ts`, and must
not revert `.specs/README.md` or the lessons block. Function resolution: the only call in the
restored region, `transformLogGroupArn(ctx)` at `nodes.ts:1033`, resolves at step 3 to the
module-level definition at `:922`; single definition, not exported, no shadowing. Execution
trace: `analyticsTransformRoleNode().create(ctx)` -> `applyTransformRolePolicy` (`:1238`) ->
`putRolePolicy` with `Action: ['logs:CreateLogStream','logs:PutLogEvents']` and
`Resource: arn:aws:logs:us-east-1:<acct>:log-group:/aws/lambda/<prefix>-analytics-transform:*`
-> the test's whole-document `toStrictEqual` matches. Regression: the three items above, all
PRESERVED. Edge cases: none unhandled - no behavioural code changed, `git diff HEAD -- packages/`
is empty.
