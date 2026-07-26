# Done Certificate — Task 29: Delete runPds and route `blogwright pds` through generic plugin dispatch

**Task:** [29-cli_remove_runpds_dispatch.md](29-cli_remove_runpds_dispatch.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 29. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 29) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `blogwright pds <action>` is answered by the plugin's declared commands with no pds knowledge left in `cli.ts`, multi-word `secret status`/`secret delete` are declared rather than hand-shifted, and the post-deploy sync is provably intact.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the six pds commands as users invoke them, the `preview` and built-in command branches in `packages/cli/src/cli.ts:107-121`, the post-deploy sync at `packages/cli/src/commands.ts:97`, or the `blogwright/rkey` re-export at `packages/cli/src/rkey.ts:7`.

## Obligations

- **O1 — `cli.ts` holds no pds knowledge.**
  - *Claim:* `packages/cli/src/cli.ts` has no `runPds`, no `PdsValues`, no `blogwright-pds` import, no `command === 'pds'` branch, and no static pds lines in `USAGE`.
  - *Evidence to collect:* run `grep -n "pds" packages/cli/src/cli.ts` and expect zero hits; read the diff for `packages/cli/src/cli.ts` and confirm the `identifier` flag at `:91` survived while the four pds constructs were removed.
  - *Status:* ☐ unverified

- **O2 — Dispatch reaches the same functions with the same arguments, and refuses the same way.**
  - *Claim:* `pds sync` reaches `sync`; `pds secret status` and `pds secret delete --yes` reach `secretStatus`/`secretDelete` with the right options via the declared multi-word action and no positional shifting; `pds login --identifier alice.example` passes the identifier through; `blogwright pds` and `blogwright pds bogus` exit non-zero with a message of the same shape as today.
  - *Evidence to collect:* run `pnpm test -- cli` in `packages/cli`; record all six case names and their assertions; for each success case confirm the assertion inspects the arguments the wrapped function received, not only the exit code; compare the two failure messages against the assertions task 07 pinned for `unknown pds action: …`.
  - *Checks:* resolve how `secret status` is matched — confirm it comes from the plugin's declared multi-word action, not from a re-introduced positional shift in the CLI, by grepping the dispatch module for `positionals[2]`-style index arithmetic on plugin actions.
  - *Status:* ☐ unverified

- **O3 — `--help` still documents all six actions, and any lost guidance is named.**
  - *Claim:* `blogwright --help` lists all six pds actions with one-line summaries built at runtime from the plugin's `description` and its commands' `summary` fields, and any guidance lost relative to the current multi-line `pds login` / `pds sync` text is named in the commit description.
  - *Evidence to collect:* run `blogwright --help` (or the test that captures it) and record the pds lines; diff them against `packages/cli/src/cli.ts:33-47` in git history and list what is no longer said; confirm the commit description names those omissions.
  - *Status:* ☐ unverified

- **O4 — The post-deploy sync path is intact and its wart is recorded.**
  - *Claim:* `packages/cli/src/commands.ts:2` still statically imports `syncAfterDeploy`, `blogwright-pds` is still a non-optional `dependencies` entry at `packages/cli/package.json:28`, the reason is recorded at the import or in `DEVELOPMENT.md`, and a test asserts `deploy` reaches `syncAfterDeploy` for `env === 'production'` with a `pds` block and skips it otherwise.
  - *Evidence to collect:* read `packages/cli/src/commands.ts:1-3,96-97` and `packages/cli/package.json:28`; run `pnpm test -- commands` (or `-- deploy`) in `packages/cli` and record the two cases and their results; confirm the skip case asserts the sync was not called rather than that nothing threw.
  - *Checks:* resolve `syncAfterDeploy` at `packages/cli/src/commands.ts:97` — confirm it binds to the static `blogwright-pds` import, not to a plugin command looked up through dispatch.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean, with knip raising nothing after the namespace import is gone and still not flagging `blogwright-pds` as an unused CLI dependency; confirm a changeset exists or is deferred to task 30 by explicit decision.
  - *Status:* ☐ unverified

- **O6 — Reviewable: `pnpm test -- cli`, `pnpm knip`, and a zero-hit grep (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- cli` and `pnpm knip` from the repo root, then `grep -n "pds" packages/cli/src/cli.ts`, seeing zero hits, six passing dispatch cases, and `--help` naming all six actions.
  - *Evidence to collect:* run both commands and capture the results; run the grep and capture its (empty) output; capture the pds portion of `blogwright --help`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/bin.ts` calls `main(argv, makeTerminal)` with `['pds', 'secret', 'delete', '--yes']` → expect `secretDelete` called with `{ yes: true }` and exit 0 : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/bin.ts` calls `main(argv, makeTerminal)` with `['pds', 'sync', 'production']` → expect the environment positional still resolved to `production` now that the shift is gone : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/commands.ts:97` (`deploy`) for `env === 'production'` with a `pds` block → expect `syncAfterDeploy` invoked exactly once : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:111` (`preview`) and `:117` (`KNOWN_COMMANDS`) → expect both branches unchanged by the pds removal : ☐ (PRESERVED / REGRESSION)

## Residue

This is the point of no return for `blogwright pds sync`: it is safe only if task 08's bundled-plugin
discovery works and task 11 made `--help` discover. If either is wrong, every consumer loses the pds
commands or their documentation, and the failure mode is a plain "unknown command" rather than a
crash — so O2 and O3 must be verified by running the CLI, not only by reading tests. One environment
positional deserves attention: `runPds` computed it as `positionals[secret ? 3 : 2]`, so
`blogwright pds secret status staging` worked; the generic dispatch must place it identically or
that invocation silently targets production. Not covered by the DoD: whether the multi-line guidance
in today's `pds login` help should reappear as longer per-command help under the plugin SPI.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
