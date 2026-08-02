# Done Certificate - Task 17: Add `blogwright plugin list`

**Task:** [17-cli_plugin_list_command.md](17-cli_plugin_list_command.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 17. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 17) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The built-in `plugin` namespace with its `list` action, printing one row per installed plugin - namespace, package name, version, owned config key - plus a row per plugin that failed to load with the reason, in both interactive and `--plain` modes.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 08's `discover(repoRoot, ports)` for the dispatch path, task 09's reserved-name and duplicate-name rejections, task 10's `blogwright <plugin> <action>` routing, or the built-in command switch at `packages/cli/src/cli.ts:142-173`.

## Obligations

- **O1 - One row per plugin, pinned in both modes.**
  - *Claim:* each installed plugin prints its namespace, package name, version and `configKey` (or a clear marker when it owns none), in interactive and `--plain` forms.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the output tests; confirm each asserts the full captured line array against exact strings; confirm one of the fake plugins in the fixture declares no `configKey` and that its row carries an explicit marker rather than an empty cell; compare the plain form's shape against `packages/cli/src/commands.ts:263-272` (`history`'s plain contract).
  - *Checks:* trace the mode selection to `ctx.ports.terminal.isInteractive` - confirm it is the port, not `process.stdout.isTTY` read in this module.
  - *Status:* ☐ unverified

- **O2 - Versions come from each package's own `package.json` through the FileSystem port.**
  - *Claim:* no hardcoded version map and no network call.
  - *Evidence to collect:* read the version-reading code in `packages/cli/src/plugin-commands.ts` and confirm it calls `ctx.ports.fs.readText` on a path derived from `ports.loader.resolve`; run `grep -n "fetch\|https://\|[0-9]\+\.[0-9]\+\.[0-9]\+" packages/cli/src/plugin-commands.ts` and confirm no version literal or URL is used for this purpose.
  - *Checks:* resolve the `readText` call - confirm it is the injected `FileSystem` port and not `node:fs`; run `pnpm lint` and expect the restricted-import rule to stay clean for this file.
  - *Status:* ☐ unverified

- **O3 - A broken plugin is listed with its reason and does not suppress the healthy ones.**
  - *Claim:* failed loads appear with the reason from `validatePlugin`/discovery, alongside the plugins that loaded.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the mixed good/broken test; confirm both rows are asserted, that the failure row contains the reason text discovery produced (not a generic "failed"), and that the asserted exit code matches the contract stated in the implementation.
  - *Checks:* trace the failure value from `discover` into the renderer - confirm the failure is carried as data, not caught inside `plugin-commands.ts` with the reason discarded.
  - *Status:* ☐ unverified

- **O4 - Empty and unknown-input space.**
  - *Claim:* no plugins → an empty-state line naming `blogwright plugin add`, exit 0; `blogwright plugin` with no action or an unknown action → the namespace's actions printed, exit 1.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the three cases; confirm the empty-state assertion checks the exact line and the exit code 0, and that the two failure cases assert exit code 1 and that the printed action list is derived from the namespace's registered actions rather than a duplicated literal.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewable: the listing is driven entirely by in-memory fixtures (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin-commands` and observe the healthy plugin's version coming from the in-memory `package.json` the test wrote, with no test constructing a real `ModuleLoader` or reading from disk.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; read the fixture setup and confirm the version string asserted in the output is the one written into `createMemoryFileSystem`; grep the test file for `createNodeModuleLoader` and `node:fs` and expect no matches.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:117` (`main`'s unknown-command branch) with argv `['plugin', 'list']` → expect it is no longer treated as unknown, and that argv `['nonsense']` still reports an unknown command and prints usage : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/plugins.ts` (`discover`) called from task 10's dispatch path → expect the widened failure result does not change dispatch behaviour for a healthy plugin; `pnpm test -- plugins` passes unmodified : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:66` (`KNOWN_COMMANDS`) with `plugin` added → expect task 09 still rejects a plugin claiming the `plugin` namespace : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: whether a listing containing a broken plugin should exit 0 or non-zero is an implementation choice the DoD only requires to be tested consistently; the version shown is the installed package's, not the SPI it was built against (the spec's open question, carried at task 20); and `plugin list` does not verify that a plugin's `configKey` block is actually present in the config - that is task 19's surface.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
