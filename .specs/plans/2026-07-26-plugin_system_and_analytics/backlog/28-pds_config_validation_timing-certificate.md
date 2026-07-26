# Done Certificate — Task 28: Keep an invalid pds config block failing on built-in commands after validation moves into the plugin

**Task:** [28-pds_config_validation_timing.md](28-pds_config_validation_timing.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 28. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 28) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** A decided, tested answer to when a plugin-owned config block is validated — either eager validation on every config load, or a recorded divergence in the change spec and the changeset — so a malformed `pds` block cannot start passing silently on `bootstrap`, `deploy` or `status`.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `loadConfig`/`createContext` for a repo with no plugins (`packages/cli/src/context.ts:85,110`), the laziness of discovery for built-in commands (`packages/cli/src/plugins.ts`, task 08), or the existing `loadConfig` cases at `packages/cli/src/context.test.ts:8-55`.

## Obligations

- **O1 — Both malformed blocks have a pinned outcome on a built-in path.**
  - *Claim:* tests load a config whose `pds.name` is blank and one whose `pds.handleResolver` is `http://resolver` through `loadConfig`/`createContext` — the path `bootstrap` takes — and assert the resulting behaviour.
  - *Evidence to collect:* run `pnpm test -- context` in `packages/cli`; record both case names and their assertions; confirm the fixture reaches `createContext`/`loadConfig` rather than invoking a pds command, by reading the test body.
  - *Checks:* resolve which function performs the pds check in that trace — core's `validateConfig` (should no longer contain it after task 27), the plugin's `validateConfig` via task 19, or nothing at all; the answer determines which branch of O2 applies.
  - *Status:* ☐ unverified

- **O2 — The chosen resolution is implemented and bounded, or recorded as a divergence.**
  - *Claim:* either plugin-owned keys are validated wherever config is loaded with a bounded cost (no full plugin load for a repo with no plugin installed), or the divergence is written into the change spec's Open questions and into the changeset.
  - *Evidence to collect:* if eager — read `packages/cli/src/context.ts:110-124` for the validation call and run the test that counts `ModuleLoader` invocations for `deploy`/`status` with no plugin installed, recording the count; if divergence — read `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md` §Assumptions and open questions and the new `.changeset/*.md`, confirming both name the same commands and the same inputs.
  - *Status:* ☐ unverified

- **O3 — No silent change of verdict in either direction.**
  - *Claim:* no config valid today becomes invalid and none invalid today is silently accepted, without a test asserting that outcome and the commit description naming it.
  - *Evidence to collect:* run `pnpm test -- config` and `pnpm test -- context` across `packages/core` and `packages/cli`; enumerate the pds-block inputs covered (valid block, blank name, `http://` resolver, non-URL resolver, bad `secretName`) and confirm each has an asserted verdict somewhere in the suite; read the commit description for the named outcome.
  - *Status:* ☐ unverified

- **O4 — Rejection messages are core's original strings.**
  - *Claim:* a rejected `pds` block reports `config.pds.name is required` and `config.pds.handleResolver must be https, got "http://resolver"` — the strings core raised before task 27.
  - *Evidence to collect:* read the assertions in the new cases and confirm they compare the full message, not a loose regex on `pds`; diff the strings against the pre-task-27 `packages/core/src/config.ts:314-330` in git history.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists if the outcome is user-facing (it is, on the divergence branch).
  - *Status:* ☐ unverified

- **O6 — Reviewable: `pnpm test -- context` plus the recorded decision (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- context` in `packages/cli`, observe both malformed-block cases asserting a concrete outcome, and read the recorded decision in the commit description or the change spec.
  - *Evidence to collect:* run `pnpm test -- context` in `packages/cli` and capture the case names and results; capture the decision paragraph from the commit description, the change spec's Open questions, or the changeset.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:134` (`createContext` for `bootstrap`) loads a valid production config with a `pds` block → expect the same context as before, with no new load or network call : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.test.ts:46` ("surfaces validation failures instead of trying the next candidate") → expect the existing `siteName is required` behaviour untouched by any new validation stage : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/commands.ts:97` (`deploy` → `syncAfterDeploy`) for a repo with no plugin installed → expect no additional plugin load on the deploy path : ☐ (PRESERVED / REGRESSION)

## Residue

This task must ship in the same release as task 27, not later: the gap only becomes observable once
core stops validating, so a release cut between the two would ship a window in which a malformed
`pds` block passes `bootstrap`. The two resolutions have different residues — eager validation puts
plugin loading on the hot path for every command (a latency question the DoD bounds but does not
close), while accepting the divergence contradicts the spec's headline claim of no user-visible
change and must therefore be stated, not implied. Not covered by the DoD: whether the same gap
exists for the analytics config key once that plugin ships; the mechanism chosen here decides it.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
