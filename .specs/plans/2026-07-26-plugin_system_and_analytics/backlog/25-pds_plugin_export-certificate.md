# Done Certificate - Task 25: Export a Plugin from blogwright-pds wrapping the six existing pds commands

**Task:** [25-pds_plugin_export.md](25-pds_plugin_export.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 25. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 25) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/pds/src/plugin.ts` declares the `pds` namespace with six commands wrapping the existing exported functions and a `nodes(ctx)` returning task 23's policy node, default-exported from `index.ts` beside the unchanged named exports, and is inert until the manifest field lands at task 26.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the six pds command functions (`packages/pds/src/commands.ts:32,68,82,106,118,169`), `syncAfterDeploy` (`:204`) as imported by `packages/cli/src/commands.ts:2`, the `blogwright-pds/rkey` subpath, task 23's `buildPdsNodes` and its tests, or the current `runPds` dispatch at `packages/cli/src/cli.ts:186-232`.

## Obligations

- **O1 - A conforming default export beside the unchanged named exports.**
  - *Claim:* `packages/pds/src/index.ts` default-exports a `Plugin` with `name: 'pds'`, `configKey: 'pds'` and `validateConfig` bound to task 21's validator, and every existing named export is still reachable with an unchanged signature.
  - *Evidence to collect:* read `packages/pds/src/plugin.ts` and `packages/pds/src/index.ts`; run `pnpm test -- plugin` in `packages/pds` and record the case that feeds `validateConfig` an invalid block, confirming the thrown message matches task 21's string exactly; run `git diff packages/pds/src/commands.ts` and confirm the only changes are those task 22 required.
  - *Checks:* resolve `validateConfig` on the exported object - confirm it is the function from `./config.js`, not a re-implementation declared inside `plugin.ts`; run core's `validatePlugin` from task 03 against the default export and confirm it passes.
  - *Status:* ☐ unverified

- **O2 - Exactly six declared actions, each summarised, with `init` bound to publication setup.**
  - *Claim:* `plugin.commands` declares `keygen`, `login`, `init`, `sync`, `secret status` and `secret delete` - no more, no fewer - each with a non-empty `summary`, and the plugin declares no `init` config contributor, so the `init` action resolves to `commands.init`.
  - *Evidence to collect:* run `pnpm test -- plugin` in `packages/pds`; record the enumeration test's asserted action list and the summary check; record the test proving the `init` command's `run` reaches `commands.init` (a spy or injected double, not a name comparison).
  - *Checks:* resolve `plugin.init` on the exported object - confirm it is absent/undefined, so the generic `<plugin> init` action added at task 13 does not shadow the publication-setup command.
  - *Status:* ☐ unverified

- **O3 - Argument pass-through pinned on the success path.**
  - *Claim:* `secret delete --yes` reaches `secretDelete` with `yes` true; `secret delete` without `--yes` yields `refusing to delete secret "…" without --yes`; `login --identifier alice.example` reaches `login` with that identifier; `login` without one yields `pds login requires --identifier <handle-or-did>`.
  - *Evidence to collect:* run `pnpm test -- plugin` in `packages/pds` and record all four cases; for the two success cases confirm the assertion inspects the arguments the wrapped function received (a recording double), not merely that the call did not throw.
  - *Status:* ☐ unverified

- **O4 - No cast at the context boundary, no `process.argv`, no CLI change.**
  - *Claim:* each command's `run` takes the plugin context by plain assignment, parses its flags from the supplied arguments, and this task changes no file under `packages/cli/src`.
  - *Evidence to collect:* run `grep -rnE "as PdsContext|as unknown as|process\.argv" packages/pds/src/plugin.ts` and expect no hits; run `git diff --stat packages/cli` and expect no output; run `pnpm test -- cli` in `packages/cli` and confirm the existing `runPds` behaviour is unaffected.
  - *Status:* ☐ unverified

- **O5 - The node contributor is declared and returns task 23's node.**
  - *Claim:* `plugin.nodes(ctx)` returns exactly `buildPdsNodes(ctx)` - the single `pds-oidc-policy` node - with no wrapper filtering or re-ordering it, so pds contributes topography through the SPI rather than through the site graph.
  - *Evidence to collect:* read the `nodes` member in `packages/pds/src/plugin.ts`; run `pnpm test -- plugin` in `packages/pds` and record the case asserting the returned ids.
  - *Checks:* confirm `nodes` takes the full `PluginContext<PdsConfig>` and not the narrowed `PdsContext` - only the lifecycle verbs build a plugin context, and a node reading `siteState`/`record()` cannot be typed on the command context; confirm task 23's `packages/pds/src/nodes.ts` is unchanged by this task apart from being imported.
  - *Status:* ☐ unverified

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean, with knip raising no unused-export complaint about the new default export; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; no changeset is needed while the plugin is inert.
  - *Status:* ☐ unverified

- **O7 - Reviewable: the six actions and the surviving named exports (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin` in `packages/pds` and inspect the built package's exports, observing the six actions and every pre-existing named export.
  - *Evidence to collect:* run `pnpm test -- plugin` in `packages/pds` and capture the pass list; run `pnpm build` then `node -e "import('blogwright-pds').then(m => console.log(m.default.name, m.default.commands.map(c => c.action), Object.keys(m)))"` from `packages/cli` and capture the printed namespace, action list and export names.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:2` imports `syncAfterDeploy` from `blogwright-pds` → expect the named import to resolve unchanged after the default export is added : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:213-229` calls `pds.keygen` / `pds.login` / `pds.secretStatus` / `pds.secretDelete` / `pds.init` / `pds.sync` through the namespace import → expect all six still resolve : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/rkey.ts:7` re-exports `blogwright-pds/rkey` → expect the subpath unaffected by the index change : ☐ (PRESERVED / REGRESSION)

## Residue

Two failure modes look like success here. First, a refusal-path-only test: `secret delete` without
`--yes` throws whether or not the flag was wired, so O3's success-path assertions are the real proof.
Second, a generic `init` contributor: if the plugin ever grows one, `blogwright <plugin> init` from
task 13 would shadow the publication-setup command that `blogwright pds init` means today - O2's
`plugin.init` check is what prevents that regression. Not covered by the DoD: whether the plugin's
`description` preserves the operational guidance in the current multi-line `pds login` and `pds sync`
help text; task 29 owns that question.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
