# Done Certificate — Task 15: Extract the node status read loop from commands.status

**Task:** [15-cli_extract_status_read_loop.md](15-cli_extract_status_read_loop.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 15. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 15) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** A named read-loop function over a node set and a context that `commands.status` calls and task 16's plugin `status` verb reuses, with `blogwright status` output pinned by the first tests `commands.ts` has ever had.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `commands.status`'s observable output in either mode, `renderStatusTree` (`packages/cli/src/render.ts:72`) and the `StatusEntry` shape (`render.ts:59`), `buildNodes` (`packages/cli/src/nodes.ts:1053`), or `ctx.state.resources` reads — this is a behaviour-neutral refactor.

## Obligations

- **O1 — `blogwright status` output is unchanged in both modes.**
  - *Claim:* the pinned lines for a small node set are identical before and after the refactor, interactive and plain.
  - *Evidence to collect:* run `pnpm test -- commands` and read `packages/cli/src/commands.test.ts`; confirm both mode cases assert on the full captured line array (exact strings, in order), not on substrings; check the revision history of the test file to confirm the assertions were authored against the pre-refactor implementation and not edited afterwards (`jj log`/`git log -p packages/cli/src/commands.test.ts`).
  - *Checks:* trace `ctx.ports.terminal.isInteractive` from `createTestContext` (`packages/cli/src/test-support.ts:148`) into `status` — confirm the two modes are selected by the port, not by an env var or a flag argument.
  - *Status:* ☐ unverified

- **O2 — The extracted function is a query over an injected node set.**
  - *Claim:* it takes the node set and the context, returns `StatusEntry[]`, and writes nothing to the logger — or the deviation is stated with its reason in the change description.
  - *Evidence to collect:* read the extracted function in `packages/cli/src/commands.ts` and record its signature; grep its body for `ctx.logger` — expect no matches; if any exist, read the change description and confirm it names the deviation and the reason.
  - *Checks:* resolve the node argument at the `status` call site — confirm it is `buildNodes(ctx)` passed in as a parameter, not read from `ctx` inside the function.
  - *Status:* ☐ unverified

- **O3 — The read-failure path degrades identically.**
  - *Claim:* a throwing `node.read` yields an `error` entry when interactive and a warning line when plain, with the same message text as today.
  - *Evidence to collect:* run `pnpm test -- commands` and read the two failure tests; confirm the interactive case asserts an entry with `state: 'error'` and the thrown message in `detail`, and the plain case asserts the exact line `  ${node.title}: read failed (${message})` shape emitted at `packages/cli/src/commands.ts:313` on the current branch; confirm the loop still continues to the next node after a failure.
  - *Status:* ☐ unverified

- **O4 — The diff is confined to `commands.ts` and its test.**
  - *Claim:* no node implementation, no rendering code and no state handling changed.
  - *Evidence to collect:* run `jj diff --stat` (or `git diff --stat` against the task's base) and confirm the only paths listed are `packages/cli/src/commands.ts` and `packages/cli/src/commands.test.ts`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; this is an internal refactor, so confirm no changeset was added for it.
  - *Status:* ☐ unverified

- **O6 — Reviewable: `pnpm test -- commands` passes and the loop takes an injected node set (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- commands` and observe the four characterization cases passing, and read the extracted function's signature to confirm task 16 can hand it a plugin's nodes instead of `buildNodes(ctx)`.
  - *Evidence to collect:* run `pnpm test -- commands`; capture the four passing test names; read the extracted signature in `packages/cli/src/commands.ts` and confirm the node set is its first parameter.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:167` (`main`, `case 'status'`) calls `commands.status(ctx)` with a real context → expect the same lines and the same exit code 0 : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/render.ts:72` (`renderStatusTree`) is called with the entries the extracted function returns → expect the same tree connectors and marks for the same node set; `pnpm test -- render` passes unmodified : ☐ (PRESERVED / REGRESSION)

## Residue

Not obligations, for the validator's awareness: `commands.ts` gains its first test file here, so coverage of the other exported commands (`bootstrap`, `deploy`, `destroy`, `history`) remains absent and is not this task's scope; the plain-mode branch colours its marks with `colors.green`/`colors.yellow`, so the pinned strings carry escape codes unless `NO_COLOR` is honoured in the test — worth confirming the tests are not colour-environment dependent.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
