# Done Certificate - Task 60: Warn at `blogwright bootstrap` while a plugin's scoped state exists, and merge the pds spec

**Task:** [60-cli_bootstrap_plugin_state_warning.md](60-cli_bootstrap_plugin_state_warning.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-27 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 60. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 60) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** After a successful reconcile, `blogwright bootstrap` prints one warning per `state/<env>.<plugin>.json` in the site bucket - naming that plugin and its `blogwright <plugin> bootstrap` - with no discovery, no plugin module load and an unchanged exit code; and the pds change spec is merged now that its last `Proposed changes` block has landed.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site bootstrap's reconcile path (`packages/cli/src/commands.ts:44`), the `blogwright destroy` refusal from task 16 (whose listing helper this task shares), the discovery-laziness rule task 10 pins, or the link targets in `.specs/README.md`. Must not land before task 59, and must ship no later than the release that carries it.

## Obligations

- **O1 - One warning per scoped key; without one, unchanged but for the listing call.**
  - *Claim:* with `state/<env>.<plugin>.json` present, `bootstrap` warns after a successful reconcile naming the plugin and `blogwright <plugin> bootstrap` (once per key in the multi-plugin case); with none present, the output is byte-identical to today and the call sequence unchanged except for exactly one added `listObjects` on the `state/` prefix.
  - *Evidence to collect:* run `pnpm test -- commands plugin-commands` in `packages/cli`; read the with-key, multi-key and without-key cases; confirm the assertions run against a recording S3 client and a capturing logger, not the message alone.
  - *Checks:* the warning must fire AFTER `applyGraph` succeeds - a warning printed before the reconcile describes staleness the run has not yet caused and would also fire on a failed bootstrap; confirm the test pins the ordering.
  - *Status:* ☐ unverified

- **O2 - Key names only: one matcher, no discovery, warn not refuse.**
  - *Claim:* the scoped-key matcher is the same helper the destroy refusal uses (exactly one definition), no discovery runs and no plugin module loads during `bootstrap`, the exit code is unchanged, and the lines go through `logger.warn` so `--plain` sessions see them with nothing prompting.
  - *Evidence to collect:* grep for the matcher (the `state/<env>.<scope>.json` parse) across `packages/cli/src/` and confirm a single definition shared by both guards; run task 10's laziness test and confirm it still passes with the warning in place; read the warning path and confirm it derives the plugin name from the key, reads no config key and imports no plugin; confirm the recording S3 client shows exactly one added `listObjects` call.
  - *Checks:* a second, near-identical matcher is the drift this obligation exists to prevent - two regexes that agree today and diverge at the next scope-shape change would make destroy and bootstrap disagree about what a plugin key is.
  - *Status:* ☐ unverified

- **O3 - The limit is stated, not papered over.**
  - *Claim:* the code comment and the changeset both record that a stack with no scoped key sees no warning - the check cannot invent knowledge core does not hold - so the release notes' `blogwright pds bootstrap` instruction is complemented, not replaced.
  - *Evidence to collect:* read the comment where the warning lives and the changeset body; confirm both state the no-scoped-key limit and neither claims the warning covers a never-bootstrapped plugin.
  - *Status:* ☐ unverified

- **O4 - The release constraint is written down.**
  - *Claim:* the changeset states this ships no later than the release carrying task 59, whose `blogwright bootstrap` is the first to rewrite `<env>-deploy` without the site's pds statement.
  - *Evidence to collect:* read the changeset; confirm the constraint and its reason are stated; confirm task 59's change is either in the same release or an earlier unreleased state, not already released without this warning.
  - *Checks:* the constraint runs opposite to the usual direction - a LATER task that must not ship LATER than its dependency's release - so a validator who finds 59 released and 60 unshipped records the ordering as broken, not merely late.
  - *Status:* ☐ unverified

- **O5 - The pds change spec is merged.**
  - *Claim:* the spec's `Status:` is `Merged` with a `Merged:` date, the file lives at `.specs/changes/merged/2026-07-26-migrate_pds_to_plugin_system.md`, every relative link inside it resolves at the new depth, its three open questions are carried, and `.specs/README.md`'s pending list holds exactly one entry - the analytics spec, naming task 61.
  - *Evidence to collect:* run `ls .specs/changes .specs/changes/merged`; read the moved file's header and its Open questions; resolve every relative link in it - the plugin-system spec resolves as a `merged/` sibling (task 58 moved it), the analytics spec still needs `../` until task 61 moves it; read `.specs/README.md`.
  - *Checks:* this is the flip tasks 30 and 59 both deferred, because a spec is not merged while one of its `Proposed changes` blocks is outstanding - and this task lands the last one, §`bootstrap` warns while plugin state exists. If the analytics entry is also gone, task 61's spec was merged early; investigate rather than accept.
  - *Status:* ☐ unverified

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm the changeset from O4 exists.
  - *Status:* ☐ unverified

- **O7 - Reviewable: the warning in both directions, one matcher, and the moved spec (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- commands plugin-commands`, observe the with-key case warning with the verb named and the without-key case byte-identical, grep the matcher to one definition, and confirm the pds spec sits in `merged/` with a `Merged:` date and every `.specs/README.md` link resolving.
  - *Evidence to collect:* run the named test filter and capture the output; run the matcher grep; run `ls .specs/changes .specs/changes/merged` and resolve the README links.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts` `bootstrap` on a stack with no plugin state → expect today's output byte-identical and today's call sequence unchanged except for exactly one added `listObjects` on the `state/` prefix : ☐ (PRESERVED / REGRESSION)
- Task 16's `blogwright destroy` refusal, which shares the scoped-key helper → expect its refusal tests to pass unmodified after any extraction this task performed : ☐ (PRESERVED / REGRESSION)
- Task 10's laziness pinning (`deploy`, `status`, `bootstrap` load no plugin module) → expect it to pass with the warning in place, because the warning reads keys, not plugins : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: the warning fires on every bootstrap while any plugin is provisioned, including runs that changed nothing a plugin attaches to - the spec accepts that noise deliberately, because core cannot know which reconcile invalidated which attachment without plugin knowledge; do not "fix" it by suppressing the warning on no-op runs. Whether the warning should ever become a prompt ("run `blogwright pds bootstrap` now?") is unasked and undecided - it would put a question into a command scripts run non-interactively. The pds spec's three carried open questions (an `afterDeploy` hook, `OpsConfig` as an opaque map, shorter pds aliases) survive the move per task 30's recording; confirm the moved file still holds them.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
