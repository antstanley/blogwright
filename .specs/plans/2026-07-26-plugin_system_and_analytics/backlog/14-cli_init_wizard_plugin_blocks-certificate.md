# Done Certificate - Task 14: Ask every discovered plugin's questions during `blogwright init`

**Task:** [14-cli_init_wizard_plugin_blocks.md](14-cli_init_wizard_plugin_blocks.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 14. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 14) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright init` on a repo with plugins installed writes a single `config/production.jsonc` carrying the core entries plus every answered plugin block, and is byte-for-byte unchanged on a repo with no plugins.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `initSite`'s four core questions and their validators (`packages/cli/src/init.ts:93-110`), the non-interactive refusal at `init.ts:78-84`, the existing-file guard at `init.ts:87`, or the composition root's pre-context `init` branch at `packages/cli/src/cli.ts:107-110`.

## Obligations

- **O1 - The no-plugins path is byte-for-byte unchanged.**
  - *Claim:* with no plugins installed, `blogwright init` writes exactly today's file, and the existing-file guard still returns 1 with its current message.
  - *Evidence to collect:* run `pnpm test -- init` and read the pinned test in `packages/cli/src/init.test.ts`; confirm it compares the written text to a full expected string (not `toContain`), and that the expected string matches what `renderConfig` (`packages/cli/src/init.ts:42`) produces on the current branch for the same answers; confirm the pre-existing "already exists" test is present and unmodified in the diff.
  - *Checks:* diff `packages/cli/src/init.ts:78-91` against the previous revision - confirm the guard and the non-interactive refusal are untouched.
  - *Status:* ☐ unverified

- **O2 - Plugin questions asked in a deterministic order, blocks written into one file.**
  - *Claim:* each plugin's questions are asked in a deterministic order and each answered block lands in the single written file in the core commented style.
  - *Evidence to collect:* run `pnpm test -- init` and read the two-fake-plugin test; confirm the scripted terminal's recorded prompt sequence is asserted and not only the file contents, that the assertion fixes the order by plugin name, and that both blocks appear in the one written file; compare the block indentation and `// comment` style against `packages/cli/src/init.ts:62-68`.
  - *Checks:* confirm the test's plugins are supplied to `initSite` as an argument - the test must not need a real `ModuleLoader` or a real package on disk.
  - *Status:* ☐ unverified

- **O3 - Declining and throwing contributors leave a valid or absent file.**
  - *Claim:* a plugin contributing no block adds nothing and leaves no stray comma (the file re-parses through `parseConfig`), and a plugin whose `init` throws leaves nothing written.
  - *Evidence to collect:* run `pnpm test -- init`; for the declining case confirm the assertion ends in `parseConfig(written)` and that the written text contains no `,,` or a comma immediately before `}`; for the throwing case confirm the assertion is `await fs.exists(configPath)` → `false`, and that the test's plugin throws from `init`, not from rendering.
  - *Status:* ☐ unverified

- **O4 - The loader stays at the composition root.**
  - *Claim:* the `ModuleLoader` `initSite` needs is constructed in `cli.ts`, not inside `init.ts`, and lint reports no new restricted import there.
  - *Evidence to collect:* read `packages/cli/src/cli.ts:107-110` and confirm the adapter and discovery call live there; read the import block of `packages/cli/src/init.ts` and confirm it imports no adapter and no `node:` module; run `pnpm lint` - expect clean.
  - *Checks:* resolve the loader value inside `initSite` - confirm it arrives as a parameter (or the plugins arrive already discovered), never via a module-scope `createNodeModuleLoader()` call in `init.ts`.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewable: `pnpm test -- init` shows an exact no-plugins vector and an unwritten file on throw (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- init` and observe that the no-plugins vector is an exact string comparison against today's output and that the throwing-plugin test asserts nothing was written rather than asserting on a partial file.
  - *Evidence to collect:* run `pnpm test -- init`; capture the passing test names; read the two assertions named in the claim in `packages/cli/src/init.test.ts` and confirm they are the ones the tests actually make.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:109` (`main`, `command === 'init'`) calls `initSite(createNodeFileSystem(), terminal, logger)` with the widened signature → expect the same exit codes (0 on success, 1 on non-interactive, 1 on existing file) : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/init.test.ts` existing cases ("writes a commented production config from the answers", "omits optional keys left blank") call `initSite(fs, terminal, logger, '/repo')` → expect they pass with no edit to their bodies : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/plugin-commands.ts` (task 13) calls the shared `ask`/`io` surface → expect `blogwright <plugin> init` still behaves as task 13 pinned it; `pnpm test -- plugin-commands` passes : ☐ (PRESERVED / REGRESSION)

## Residue

Not obligations, for the validator's awareness: the wizard's non-interactive refusal fires before any plugin question, so a plugin can never prompt in CI - worth confirming but not required by the DoD; ordering by plugin `name` is a choice the DoD only requires to be deterministic; and whether a plugin block should be omitted entirely versus written with commented-out defaults when declined is left to the contributor.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
