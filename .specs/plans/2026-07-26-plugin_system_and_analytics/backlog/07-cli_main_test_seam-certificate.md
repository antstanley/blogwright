# Done Certificate — Task 07: Give main() a test seam and pin today's dispatch behaviour

**Task:** [07-cli_main_test_seam.md](07-cli_main_test_seam.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 07. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 07) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `main` accepts an injectable context factory defaulted to `createContext` at `bin.ts`, and a new `packages/cli/src/cli.test.ts` pins today's help, unknown-command, `pds` and `status` behaviour byte-exactly.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break real CLI invocation through `packages/cli/src/bin.ts:9`, nor the behaviour of `runPds` (`packages/cli/src/cli.ts:187-232`) and `runPreview` (`:246-292`), which both build their own context today.

## Obligations

- **O1 — The seam is a parameter, not a mock.**
  - *Claim:* `main` takes its context factory as a parameter, `bin.ts` supplies `createContext`, and no module mock or env-var override appears in `cli.test.ts`.
  - *Evidence to collect:* read the `main` signature at `packages/cli/src/cli.ts:80` and confirm the factory is a parameter; read `packages/cli/src/bin.ts:9` and confirm `createContext` is passed there; grep `packages/cli/src/cli.test.ts` for `vi.mock`, `vi.stubEnv`, `vi.stubGlobal` and `process.env` — expect no matches.
  - *Checks:* resolve every `createContext` reference inside `packages/cli/src/cli.ts` — expect none remaining at `:134`, `:203` and `:259`; each must call the injected factory instead, so a test never reaches `packages/cli/src/context.ts:119` (`findRepoRoot`) or `:132` (`sts.getAccountId`).
  - *Status:* ☐ unverified

- **O2 — Today's behaviour is pinned.**
  - *Claim:* `cli.test.ts` asserts `--help` → `USAGE` and 0; bare invocation → `USAGE` and 1; unknown command → `unknown command: x` plus `USAGE` and 1; `blogwright pds` with no action and `blogwright pds bogus` → 1 with today's message shape; `blogwright status` reaches `commands.status`.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` and record each named test; read the assertions and confirm the exit codes are `main`'s return value, not a process exit; for the `status` case confirm the assertion observes the header line written by `packages/cli/src/commands.ts:302` (`Status for "test" (bucket …)`) rather than a spy on the module.
  - *Checks:* trace `blogwright pds` with no action through `packages/cli/src/cli.ts:195-202` — confirm the pinned message matches the `unknown pds action: (none)` form the code produces today, character for character.
  - *Status:* ☐ unverified

- **O3 — The USAGE pin is byte-exact.**
  - *Claim:* the help assertion compares the full `USAGE` string, not a substring or a normalised form.
  - *Evidence to collect:* read the help assertions in `packages/cli/src/cli.test.ts` and confirm they use an equality comparison against the whole expected text (a checked-in literal or the exported constant), with no `toContain`, no `trim()`, and no whitespace collapsing.
  - *Checks:* mutate one character inside the `USAGE` template literal at `packages/cli/src/cli.ts:11-63`, re-run `pnpm --filter blogwright test -- cli`, confirm the pin fails, then revert.
  - *Status:* ☐ unverified

- **O4 — No process, no AWS, and behaviour-neutral.**
  - *Claim:* the new tests spawn nothing and reach no cloud, and the change makes no user-visible difference, so no changeset is required.
  - *Evidence to collect:* grep `packages/cli/src/cli.test.ts` for `execFile`, `spawn`, `fetch` and `node:child_process` — expect no matches; confirm the stub factory returns `createTestContext()`, whose transport rejects every AWS request (`packages/cli/src/test-support.ts:53-57`) and whose `ports.vcs` fails fast (`:91-102`); run `git diff --stat` (or `jj diff --stat`) and confirm the only production change is the added factory parameter and its default at `bin.ts`, with `USAGE` and every message string unchanged.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing (here it is not, so expect none added).
  - *Status:* ☐ unverified

- **O6 — Reviewer runs the CLI suite and breaks the pin (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- cli` and observe a passing suite with no network or git access, then change one character of `USAGE` and observe the byte-exact pin fail.
  - *Evidence to collect:* run the command and record the passing test names; edit one character inside the `USAGE` template literal at `packages/cli/src/cli.ts:11`, re-run, record the failing assertion and its diff output, then revert and re-run to confirm green.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/bin.ts:9` calls `main(process.argv.slice(2), makeTerminal)` → expect the real CLI still builds its context, verified by running `node packages/cli/dist/bin.js --help` after `pnpm build` and observing today's usage text and exit code 0 : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:203` `runPds` builds a context for `pds sync` → expect the factory-routed call passes the same `ContextOptions` (env, configPath, domain, endpointOverride, terminal port) it passed before : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:259` `runPreview` builds a context with `preview: true` → expect the preview flag survives the routing : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the exact name and placement of the `ContextFactory` type is an implementation choice. Whether the factory is a required third parameter or an optional one with a default inside `cli.ts` is not fixed by the obligations, but a default that references `createContext` from `cli.ts` weakens O1's intent — the composition root should own the real construction. `preview` dispatch is pinned by no obligation here; it is exercised only through the regression check.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
