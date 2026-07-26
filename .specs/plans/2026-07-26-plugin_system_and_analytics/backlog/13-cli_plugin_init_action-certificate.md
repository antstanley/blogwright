# Done Certificate — Task 13: Add the generic `blogwright <plugin> init` action

**Task:** [13-cli_plugin_init_action.md](13-cli_plugin_init_action.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 13. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 13) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `blogwright <plugin> init` on a repo with an existing config runs the plugin's `init(io)` against the Terminal port and splices the returned block into the file the environment resolves to, with a plugin-declared `init` command taking precedence over the generic action.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `loadConfig` in `packages/cli/src/context.ts:85` (its candidate order and its `FileNotFoundError` branch are refactored, not changed), `createContext` (`context.ts:110`), the built-in `init` branch at `packages/cli/src/cli.ts:107`, or task 10's dispatch for actions other than `init`.

## Obligations

- **O1 — End-to-end splice into the resolved config file.**
  - *Claim:* the action calls the plugin's `init(io)`, renders the block, splices it into the environment's resolved config path, and the result re-parses through `parseConfig`.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the end-to-end test in `packages/cli/src/plugin-commands.test.ts`; confirm it seeds a config at `config/<env>.jsonc` in `createMemoryFileSystem`, drives answers through `createScriptedTerminal`, asserts the written text contains the plugin's key, and ends with a `parseConfig` of the re-read file; repeat the trace for the `--config <path>` case.
  - *Checks:* resolve the path the action writes to — confirm it comes from the shared `resolveConfigPath(fs, source)` that `loadConfig` also calls (`packages/cli/src/context.ts`), not from a second string built inside `plugin-commands.ts`.
  - *Status:* ☐ unverified

- **O2 — Prompting crosses the Terminal port only.**
  - *Claim:* the `io` handed to `init` prompts through `Terminal`, and no plugin path imports `node:readline`.
  - *Evidence to collect:* read the `io` construction in `packages/cli/src/plugin-commands.ts` and confirm every prompt call resolves to `ctx.ports.terminal.question`; run `pnpm lint` — expect clean; run `grep -rn "readline" packages/cli/src packages/core/src packages/pds/src` and confirm every hit is inside an adapter directory or a file listed in `.oxlintrc.json`'s override block.
  - *Checks:* confirm `packages/cli/src/plugin-commands.ts` is **not** in `.oxlintrc.json`'s `overrides.files` list, so the lint gate genuinely covers it.
  - *Status:* ☐ unverified

- **O3 — A declared `init` command wins over the generic action.**
  - *Claim:* dispatch consults the plugin's own `commands` before the generic `init` action, in both directions, so pds's record-creating `init` is never replaced by a config writer.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and locate the two tests: one fake plugin declaring an `init` command (assert its `run` was called and no file was written) and one carrying only an `init` contributor (assert the file was written); read the precedence comment in `packages/cli/src/plugin-commands.ts` and confirm it names pds as the reason.
  - *Checks:* trace the dispatch path for the argv `['pds', 'init']` shape through task 10's table — confirm the declared command is matched before the generic action is even constructed.
  - *Status:* ☐ unverified

- **O4 — Refusal and empty paths.**
  - *Claim:* no `init` at all → the action is reported unavailable, the plugin's real actions are listed, exit is non-zero; an already-present key → non-zero with the splice module's message and the file byte-identical; a contributor yielding no block → nothing written and the operator told so.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the three tests; for the already-present case confirm the assertion compares the in-memory file's contents to the exact seeded string (not merely "does not contain the key") and that the exit code assertion is non-zero; for the no-init case confirm the listed actions come from the fake plugin's `commands` array.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: `pnpm test -- plugin-commands` shows declared-command precedence and an untouched file (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin-commands` and observe that a fake plugin declaring `init` reaches its own `run` and never the config writer, and that the already-configured case leaves the in-memory file identical to what the test seeded.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; capture the passing test names; read the two assertions named in the claim and confirm they are the ones the test actually makes.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:120` (`createContext`) calls `loadConfig` with an env and no `configPath` → expect the same `OpsConfig` for the same files as before the `resolveConfigPath` extraction, and the same "no config found" message when none exists : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:107` (`main`, `command === 'init'`) calls `initSite` → expect unchanged behaviour; this task adds no plugin awareness to the built-in wizard (that is task 14) : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/init.ts:93-110` (`initSite`'s four questions) calls `ask` → expect identical prompting after `ask` is exported or lifted into a shared module; `pnpm test -- init` passes unmodified : ☐ (PRESERVED / REGRESSION)

## Residue

Not obligations, for the validator's awareness: the action's behaviour on a repo with *no* config at all (task 14's territory) is undefined here and worth a note if the implementation guesses; `secret status`-style multi-word actions are not exercised by this task; and whether the `io` surface should offer anything beyond a question/validate loop is deliberately left to the first plugin that needs more.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
