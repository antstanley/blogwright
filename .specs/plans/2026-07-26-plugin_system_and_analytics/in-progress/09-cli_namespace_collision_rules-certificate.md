# Done Certificate - Task 09: Reject plugins claiming a reserved or duplicate namespace

**Task:** [09-cli_namespace_collision_rules.md](09-cli_namespace_collision_rules.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 09. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 09) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `RESERVED_COMMANDS` set derived from the CLI's own dispatch set, plus reserved-name and duplicate-name rejection inside `discover`, so no plugin can shadow a built-in or race another plugin for a namespace.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break built-in dispatch in `packages/cli/src/cli.ts:107-121` (the `init`, `preview`, `pds` and `KNOWN_COMMANDS` arms) nor the discovery contract task 08 established in `packages/cli/src/plugins.ts`.

## Obligations

- **O1 - The reserved set is complete and derived.**
  - *Claim:* `RESERVED_COMMANDS` is exactly the eleven names, derived from the CLI's dispatch set, and includes `init` and `preview`, which are dispatched before `KNOWN_COMMANDS` is consulted.
  - *Evidence to collect:* read the `RESERVED_COMMANDS` declaration in `packages/cli/src/cli.ts` and confirm it is built from `KNOWN_COMMANDS` plus the names dispatched at `:107` (`init`), `:111` (`preview`) and the `plugin` namespace; run `pnpm --filter blogwright test -- cli` › the reserved-set equality test - expect it to compare against the literal set `init, bootstrap, deploy, rollback, delete, destroy, history, logs, status, preview, plugin`.
  - *Checks:* remove `status` from `KNOWN_COMMANDS` at `packages/cli/src/cli.ts:66-75`, re-run the equality test, confirm it fails (proving the derivation is live rather than a parallel literal), then revert.
  - *Status:* ☐ unverified

- **O2 - Reserved and duplicate names are rejected, order-independently.**
  - *Claim:* a plugin claiming a reserved name fails with both the package and the collided name in the message and is not dispatched; two plugins claiming the same name fail with both packages named, whatever the iteration order.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- plugins` › the collision cases - expect a reserved-name test asserting the failure message contains both the package name and the reserved name, and asserting the plugin is absent from the returned `plugins` array; expect a duplicate-name test asserting the message contains both package names.
  - *Checks:* re-run the duplicate-name fixture with its two candidates supplied in the reverse order and confirm the same failure message (sorted package list), so the outcome does not depend on `Object.keys` ordering of the consumer's dependency map.
  - *Status:* ☐ unverified

- **O3 - `pds` is deliberately unreserved and documented.**
  - *Claim:* `pds` is absent from the reserved set, the module comment says why, and a test documents the current behaviour.
  - *Evidence to collect:* confirm `pds` does not appear in `RESERVED_COMMANDS`; read the `packages/cli/src/plugins.ts` module comment for the recorded reason naming the hardcoded `command === 'pds'` branch at `packages/cli/src/cli.ts:114` and task 29 as the removal point; run `pnpm --filter blogwright test -- plugins` › the `pds` case - expect a passing test asserting a plugin claiming `pds` is discovered without a reserved-name failure.
  - *Status:* ☐ unverified

- **O4 - Built-ins are unaffected.**
  - *Claim:* built-in commands still win, their dispatch path is unchanged, and the task-07 pins pass unmodified.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- cli` - expect every test pinned in task 07 to pass with no edit to `packages/cli/src/cli.test.ts`'s existing assertions; run `git diff packages/cli/src/cli.ts` (or `jj diff`) and confirm the only change is the added `RESERVED_COMMANDS` export, with `:107`, `:111`, `:114` and `:117-121` untouched.
  - *Checks:* trace `blogwright status` through `packages/cli/src/cli.ts:117` - confirm the `KNOWN_COMMANDS` membership test still short-circuits before any discovery call.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewer breaks the derivation and reorders the duplicate fixture (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- plugins` and `pnpm --filter blogwright test -- cli`, observe the reserved-set equality test fail when `status` leaves `KNOWN_COMMANDS`, observe an order-independent duplicate failure, and observe the task-07 pins pass unmodified.
  - *Evidence to collect:* run both commands and record the passing test names; remove `status` from `KNOWN_COMMANDS`, re-run, record the failure, revert; swap the two duplicate candidates in the fixture, re-run, confirm an identical failure message; confirm `packages/cli/src/cli.test.ts`'s task-07 assertions are byte-unchanged in the diff.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:117` tests `KNOWN_COMMANDS.has(command)` for every non-`init`, non-`preview`, non-`pds` invocation → expect `deploy`, `status` and `bootstrap` to dispatch exactly as before the `RESERVED_COMMANDS` export was added : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/plugins.test.ts` (task 08) asserts a clean discovery over two well-formed plugins → expect the added collision checks to leave that result unchanged : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: whether a reserved-name or duplicate-name collision is surfaced as an entry in `failures` or as a thrown error is left open by the task's wording ("raises an error"); either satisfies O2 as long as the CLI run is not aborted for unrelated commands and both names appear in the message. The interaction between a bundled plugin and a consumer-installed plugin of the same package name (task 08's residue) may surface here as a false duplicate; if it does, record it as a finding against O2 rather than against task 08.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
