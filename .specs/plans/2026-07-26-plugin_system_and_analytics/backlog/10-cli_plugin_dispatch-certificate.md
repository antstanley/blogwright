# Done Certificate - Task 10: Route `blogwright <plugin> <action>` through generic dispatch

**Task:** [10-cli_plugin_dispatch.md](10-cli_plugin_dispatch.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 10. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 10) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright <plugin> <action>` dispatches to an installed plugin's command with flag values and multi-word actions intact, while discovery stays skipped for every built-in command.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break built-in dispatch (`packages/cli/src/cli.ts:107-175`), the hardcoded `pds` branch at `:114` (still live until task 29), `preview` dispatch at `:246-292`, or the task-07 pins in `packages/cli/src/cli.test.ts`.

## Obligations

- **O1 - Generic dispatch, multi-word actions, and exit codes.**
  - *Claim:* an unrecognised first positional reaches plugin dispatch with the remaining args, multi-word actions dispatch by declaration, and the command's return value becomes the exit code.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the dispatch cases - expect a test where a fake plugin declaring `secret status` is reached by `blogwright fake secret status` with the trailing positionals passed through, and a test where a command returning a non-zero code makes `main` return it; read the action-matching code and confirm it matches the longest declared action against the leading positionals.
  - *Checks:* trace `blogwright fake secret status extra` through `runPlugin` - confirm `extra` arrives in the args passed to `run`, and that no branch reproduces the positional shifting at `packages/cli/src/cli.ts:195`.
  - *Status:* ☐ unverified

- **O2 - Flag values arrive at `run`.**
  - *Claim:* a flag-carrying invocation reaches `run()` with the flag's value, asserted positively rather than through a refusal message.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the flag case - expect a test invoking a fake plugin with `--identifier alice.example` and `--yes`, whose `run` implementation records its `args` and whose assertion reads `identifier === 'alice.example'` and `yes === true`; confirm the assertion is on the recorded value, not on an error message.
  - *Checks:* resolve where `values` from `parseArgs` (`packages/cli/src/cli.ts:81-97`) is handed to `runPlugin` - confirm the flags task 29 needs (`identifier`, `yes`) are part of the args object rather than dropped between the parser and `run`.
  - *Status:* ☐ unverified

- **O3 - Unknown plugin and unknown action.**
  - *Claim:* an unknown plugin name and an unknown action each produce the specified message and exit code 1.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the unknown cases - expect one test asserting the message states that no built-in command or installed plugin claims the name and contains `blogwright plugin list`, with `main` returning 1; expect a second test asserting the message lists the known plugin's declared actions, with `main` returning 1.
  - *Status:* ☐ unverified

- **O4 - Laziness, the untyped-cast ban, and the changeset.**
  - *Claim:* built-in commands never trigger discovery, the plugin context is built by a named adaptation function with no cast, and a changeset records the new surface.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the laziness case - expect one test running `deploy`, `status` and `bootstrap` and asserting the `ModuleLoader` fake recorded zero `resolve` and zero `load` calls; grep `packages/cli/src/cli.ts` and `packages/cli/src/plugin-commands.ts` for `as PluginContext` and `as unknown as` - expect no matches; read `toPluginContext` and confirm it supplies exactly `pluginConfig`, `siteState` and `record` on top of the `OpsContext` and rewrites nothing the host already carries; list `.changeset/*.md` and confirm a new entry describes the dispatch surface and its semver impact.
  - *Checks:* resolve the discovery call site in `packages/cli/src/cli.ts` - confirm it sits after the `KNOWN_COMMANDS` membership test at `:117`, not before the built-in switch.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`), since this change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewer dispatches a multi-word action and breaks laziness (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- cli` and observe `blogwright fake secret status --yes` reaching `run()` with `yes` true, and observe the laziness test fail when `discover` is hoisted above the built-in switch.
  - *Evidence to collect:* run the command and record the passing test names; move the `discover` call above the `KNOWN_COMMANDS` membership test at `packages/cli/src/cli.ts:117`, re-run, record the laziness failure, then revert and re-run to confirm green.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:114` dispatches `blogwright pds sync` through `runPds` → expect the hardcoded branch to still win over generic dispatch, since task 29 has not landed : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:117-121` previously produced `unknown command: x` for any unrecognised first positional → expect that message to be replaced by the unknown-plugin message from O3, and the task-07 pin for it to be updated deliberately rather than deleted : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/bin.ts:9` invokes `main` for every real run → expect `blogwright deploy` to still reach `commands.deploy` with no discovery, verified through the laziness test : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: task 07's pin asserted `unknown command: x` for an unrecognised first positional. This task deliberately changes that surface, so the pin must be updated in the same change, with the new expectation recording the unknown-plugin message; a pin that was deleted rather than updated is a finding. The shape of the `args` object handed to `run` (positionals plus values, or a flattened record) is an implementation choice constrained only by O2. `blogwright plugin list` is suggested in the message but is not implemented until task 17; a message referencing a not-yet-existing command is expected here.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
