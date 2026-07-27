# Done Certificate — Task 18: Add `blogwright plugin add` and `blogwright plugin remove`

**Task:** [18-cli_plugin_add_remove_commands.md](18-cli_plugin_add_remove_commands.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 18. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 18) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `blogwright plugin add <name>` and `blogwright plugin remove <name>` install and uninstall plugin packages in the consuming repo through the `PackageManager` port, resolving short names to `blogwright-*` and pinning the installed version to the running CLI's own — with `remove` asking whether the plugin's teardown should run first (settled 2026-07-27), and refusing in sessions that cannot ask.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `blogwright plugin list` (task 17), the port wiring at `packages/cli/src/context.ts:111-116`, or the ban on `node:child_process` outside adapters enforced by `.oxlintrc.json`.

## Obligations

- **O1 — Name resolution, three cases.**
  - *Claim:* `analytics` → `blogwright-analytics`; a name containing `/` is literal; a name already starting with `blogwright-` is literal.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the three resolution tests; confirm each asserts the resolved package name (or the spec string handed to the fake), and that the `/` case uses a scoped example such as `@scope/thing`.
  - *Checks:* read `resolvePluginPackage` in `packages/cli/src/plugin-commands.ts` — confirm it is pure (no port, no I/O) so the tests exercise the real branching rather than a mocked path.
  - *Status:* ☐ unverified

- **O2 — The pinned version comes from the composition root.**
  - *Claim:* the requested version is the running CLI's own, sourced at the composition root, and the test asserts the exact spec string.
  - *Evidence to collect:* read where the version is obtained — expect `packages/cli/src/context.ts` (the composition root, exempt from the restricted-import rule), resolved the way `agentDir` is at `context.ts:118`; run `pnpm test -- plugin-commands` and confirm the assertion compares the full spec string `blogwright-analytics@<version>`.
  - *Checks:* grep `packages/cli/src/plugin-commands.ts` for `package.json`, `findRepoRoot` and `import.meta.url` — confirm the module does not walk the filesystem for its own version; confirm the test derives the expected version from `packages/cli/package.json` rather than hardcoding `0.3.3`.
  - *Status:* ☐ unverified

- **O3 — Already installed is a no-op, and no test touches a process or the network.**
  - *Claim:* installing an already-installed plugin reports that, exits 0, and never calls the package manager.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the already-installed test; confirm the recording fake's call list is asserted empty and the exit code asserted 0; grep the test file for `execFile`, `spawn`, `child_process` and `fetch` — expect no matches.
  - *Checks:* trace how "already installed" is determined — confirm it reads the consuming repo's `package.json` through `ctx.ports.fs`, not by asking the package manager.
  - *Status:* ☐ unverified

- **O4 — `remove` asks before it forecloses, and refuses when it cannot ask or nothing is installed.**
  - *Claim:* with a node-contributing plugin and an interactive terminal, a scripted "y" runs the plugin's generic destroy before the port's `remove` and a scripted "n" (or bare Enter — No is the default) removes without it, stating that configuration and provisioned resources are untouched and naming `blogwright <name> destroy`; a non-interactive or `--plain` session with nodes and no `--yes` refuses with a message naming both ways forward, exits non-zero, and calls neither the destroy path nor the port; `--yes` removes without asking; removing an uninstalled plugin reports that and exits non-zero without shelling out; a plugin without nodes, or whose load fails, is removed directly.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; read the yes case and confirm the recorded call order shows the destroy path before the package-manager call; read the no case and the pinned output — the "untouched" statement and the literal teardown verb with the plugin's name interpolated; read the non-interactive refusal case and confirm the message names both `blogwright <name> destroy --yes` and `--yes`, the exit code is non-zero, and both fakes' call lists are empty; read the not-installed test (non-zero, fake recorded nothing) and the no-nodes/load-failure cases (removed directly).
  - *Checks:* trace how the plugin is loaded — a single resolve-and-load through `ports.loader` of the one package being removed, not a discovery pass; and confirm the interactive question goes through the `confirm` helper (`packages/cli/src/logger.ts:34`) with `defaultYes: false`, guarded by an `isInteractive` check that refuses rather than letting `confirm` silently answer No in CI.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists in `.changeset/` naming the two new user-facing commands with the semver impact stated.
  - *Status:* ☐ unverified

- **O6 — Reviewable: the spec string carries the real CLI version and the no-op paths record nothing (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin-commands` and observe that the recorded spec string carries the version from `packages/cli/package.json` rather than a literal in the test, and that both "nothing to do" paths leave the recording fake's call list empty.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; read the two assertions named in the claim and confirm they are the ones the tests actually make.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/plugin-commands.ts` (`plugin list`, task 17) dispatched after `add`/`remove` join the namespace → expect `blogwright plugin list` output unchanged; task 17's pinned output tests pass unmodified : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.ts:110` (`createContext`) constructs the ports for every command → expect `blogwright status` and `blogwright deploy` still build a context with no new required option, and the version read adds no failure mode when the CLI's own `package.json` is present : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: the pinned-version strategy is the only compatibility mechanism in v1 — nothing declares or checks an SPI version, so a version-skewed plugin fails at `validatePlugin` at best and mid-command at worst; that gap is carried forward as an open question at task 20. Also outside the DoD: what `add` should do when the repo's package manager cannot be detected, and whether `add` should offer to run the plugin's `init` afterwards. The teardown-on-yes runs for the one environment the invocation resolves; scoped state in other environments is deliberately untouched and remains protected by task 16's `blogwright destroy` refusal — confirm the pinned output does not claim otherwise.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
