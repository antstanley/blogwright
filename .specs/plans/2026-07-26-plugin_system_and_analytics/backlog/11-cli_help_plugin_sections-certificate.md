# Done Certificate — Task 11: Build the help output's Plugins section from discovered plugins

**Task:** [11-cli_help_plugin_sections.md](11-cli_help_plugin_sections.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 11. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 11) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** Help text is assembled at runtime — today's static base plus one section per discovered plugin — with failed loads surfaced and the no-plugins output byte-identical to today's `USAGE`.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the six sites that print help today (`packages/cli/src/cli.ts:103,119,171,200,256,288`), the exit codes at `:102-106`, or the task-07 byte-exact pin in `packages/cli/src/cli.test.ts`.

## Obligations

- **O1 — `--help` runs discovery, deliberately.**
  - *Claim:* the help path triggers discovery, a test proves it, and the module comment records the exception to task 10's laziness rule with the pds-migration reason.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the help-discovery case — expect a test asserting the `ModuleLoader` fake recorded at least one call for a `--help` invocation; read the module comment in `packages/cli/src/cli.ts` and confirm it names the paths that run discovery — plugin dispatch, `--help` and a bare invocation, `blogwright plugin list` (task 17) and `blogwright init` (task 14) — against the built-in commands that do not, which are `deploy`, `bootstrap` and `status`, and states the reason for the help case (task 29 removes the static `pds` block at `:33-47`, and all six pds actions must still be listed). A comment naming only three paths is a defect: task 14 runs discovery in the `init` branch at `packages/cli/src/cli.ts:107-110`.
  - *Checks:* resolve the discovery call in the help branch (`packages/cli/src/cli.ts:102-106`) — confirm it is the same `discover` from `packages/cli/src/plugins.ts` that dispatch uses, not a second, differently-scoped reader.
  - *Status:* ☐ unverified

- **O2 — The no-plugins output is unchanged, exit codes included.**
  - *Claim:* with nothing discovered, `blogwright --help` emits today's `USAGE` byte for byte, and `--help` still exits 0 while a bare invocation still exits 1.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the task-07 pins — expect them to pass with their assertions unedited; read `git diff packages/cli/src/cli.test.ts` (or `jj diff`) and confirm the pinned help expectation is byte-unchanged; read `buildHelp` and confirm the empty-discovery path returns the base string with no appended separator, heading or trailing newline.
  - *Checks:* trace `main(['--help'], …)` through `packages/cli/src/cli.ts:102-106` — confirm the return expression still yields 0 for `--help` and 1 for a bare invocation after the help text became a computed value.
  - *Status:* ☐ unverified

- **O3 — Plugin sections render, deterministically.**
  - *Claim:* one section per plugin is appended, showing the plugin's `description` and one line per command from `action` plus `summary`, in a deterministic order.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the two-plugin case — expect the output to contain both descriptions and every declared `action`/`summary` pair; re-run the fixture with the two plugins supplied in the reverse order and confirm byte-identical output.
  - *Status:* ☐ unverified

- **O4 — A failed load does not break help.**
  - *Claim:* when one plugin fails to load, the remaining sections still render and the failure is surfaced without a stack trace.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` › the failed-load case — expect the good plugin's section present in the output, the failing package named in a single line, and the assertion to confirm the output contains no `at ` stack frame and no `Error:` prefix carrying a trace.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewer checks the pin, the ordering and the broken plugin (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- cli` and observe the no-plugins case matching the task-07 byte-exact pin, two fake plugins rendering in name order regardless of fixture order, and a plugin that throws on load leaving the other section intact.
  - *Evidence to collect:* run the command and record the passing test names; swap the two plugins in the ordering fixture, re-run, confirm identical output; read the failed-load test's assertions and confirm the surviving section is asserted present alongside the named failure.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:119` prints help after `unknown command: x` → expect the assembled text, not a stale `USAGE` constant, and the exit code still 1 : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:200` prints help after `unknown pds action: …` → expect the assembled text and exit code 1, with the hardcoded `pds` branch at `:114` still live until task 29 : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:256` and `:288` print help after an unknown `preview` action → expect the assembled text and exit code 1 : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/bin.ts:9` invokes `main` for a real `blogwright --help` → expect the built CLI to print today's text plus any installed plugin sections, verified by running `node packages/cli/dist/bin.js --help` after `pnpm build` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: this task makes the error paths pay for discovery too, because they share the help text; whether that is acceptable is not an obligation here, but a measurable slowdown on `unknown command` is worth recording. The exact section heading wording (a `Plugins:` banner versus bare per-plugin blocks) is an implementation choice constrained only by O2's byte-identity requirement for the empty case. Whether `--help` should suppress discovery under `--plain` is not specified and is not an obligation.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
