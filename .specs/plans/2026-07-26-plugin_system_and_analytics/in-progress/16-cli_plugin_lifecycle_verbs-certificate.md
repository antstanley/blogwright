# Done Certificate - Task 16: Run plugin graphs through bootstrap, status and destroy against a scoped state store

**Task:** [16-cli_plugin_lifecycle_verbs.md](16-cli_plugin_lifecycle_verbs.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 16. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 16) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright <plugin> bootstrap|status|destroy` reconcile, read and tear down a plugin's `nodes(ctx)` set through the CLI's existing engine against `state/<env>.<plugin>.json`, the site's own `destroy` refuses while such an object exists, and the precedence between these generic verbs and plugin-declared commands of the same name is decided and tested.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `commands.bootstrap`/`commands.destroy`/`commands.status` (`packages/cli/src/commands.ts:44,54,301`), `buildNodes` (`packages/cli/src/nodes.ts:1053`), the graph engine's save-on-failure behaviour (`packages/cli/src/graph.ts:74-85`), or the unscoped `state/<env>.json` key (`packages/core/src/state.ts:17`).

## Obligations

- **O1 - One engine, reused over the plugin's node set.**
  - *Claim:* the three verbs run `applyGraph`, `destroyGraph` and task 15's extracted read loop over `plugin.nodes(ctx)`, and no second copy of the engine exists.
  - *Evidence to collect:* read the three verb implementations in `packages/cli/src/plugin-commands.ts` and record which functions each calls; run `grep -rn "function topoSort\|function applyGraph\|function destroyGraph" packages/` - expect only `packages/cli/src/graph.ts`.
  - *Checks:* resolve `applyGraph` and `destroyGraph` at their call sites in `plugin-commands.ts` - confirm they are the imports from `./graph.js`, not locally redefined helpers; resolve the status loop call and confirm it is the function task 15 extracted from `commands.ts`.
  - *Status:* ☐ unverified

- **O2 - Precedence decided, recorded and tested in both directions.**
  - *Claim:* `bootstrap` and `destroy` are always generic and a plugin declaring either is rejected with an error naming the collision; `status` is generic unless the plugin declares one.
  - *Evidence to collect:* read the module comment at the top of `packages/cli/src/plugin-commands.ts` and confirm it states the rule and the constraint (a plugin may not import the CLI, so it cannot run the engine); run `pnpm test -- plugin-commands` and locate four tests - a plugin declaring `bootstrap` rejected, a plugin declaring `destroy` rejected, a plugin declaring `status` reaching its own `run`, a plugin without `status` reaching the generic verb; confirm the rejection messages name both the plugin and the action.
  - *Checks:* trace where the rejection fires - confirm it is at load time, in task 09's collision pass in `packages/cli/src/plugins.ts`, beside the `init` rejection task 13 put there (the home task 13 decided), and NOT in core's `validatePlugin`: core declares the `Plugin` contract and must not know which actions a host contributes generically. It must not fire on first dispatch of the action either. If the two declared-action rejections have landed in two different modules, that is the defect this check exists to catch.
  - *Status:* ☐ unverified

- **O3 - State isolation holds in both directions.**
  - *Claim:* a plugin bootstrap writes only `state/<env>.<plugin>.json`, and `blogwright bootstrap`/`destroy` with that plugin installed touch neither plugin nodes nor plugin state.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and read the recording-S3-client tests; for the plugin bootstrap, confirm the recorded `putObject` keys are exactly `['state/<env>.<plugin>.json']`; for the site bootstrap with the same plugin installed, confirm the recorded keys contain `state/<env>.json` and no key containing the plugin name, and that the `buildNodes(ctx)` id list is asserted equal to the pre-task list.
  - *Checks:* resolve `ctx.store` inside a plugin verb - confirm it is a `StateStore` constructed with the plugin scope (`packages/core/src/state.ts`), that `ctx.state` came from that store's own `load()`, and that `ctx.save()` writes through it, not through the site store built at `packages/cli/src/context.ts:134`.
  - *Status:* ☐ unverified

- **O4 - Refusals: `--yes` and a plugin with no nodes.**
  - *Claim:* `<plugin> destroy` without `--yes` raises with the site verb's contract and destroys nothing; a plugin with no `nodes` contributor does not gain the verbs and asking for one lists its real actions and exits non-zero.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; for the `--yes` case confirm the assertion matches the message shape at `packages/cli/src/commands.ts:56` and that the recording S3 client shows no `deleteObject` and the fake nodes' `delete` was never called; for the no-nodes case confirm the listed actions come from the fake plugin's `commands` array and the exit code assertion is non-zero.
  - *Status:* ☐ unverified

- **O5 - `blogwright destroy` refuses while a plugin's state object exists.**
  - *Claim:* with `state/<env>.analytics.json` present in the site's bucket, `blogwright destroy --yes` refuses, names the scope and its `blogwright analytics destroy --yes`, and issues no delete at all; with no scoped object present its call sequence is unchanged from today.
  - *Evidence to collect:* read the guard in `packages/cli/src/commands.ts` ahead of `destroyGraph(buildNodes(ctx), ctx)` at `:62`; run `pnpm test -- plugin-commands` (or `-- commands`) in `packages/cli` and record both cases from the recording S3 client - the refusing run's call list must contain no `DELETE`, and the clean run's must match the pre-task sequence.
  - *Checks:* confirm the guard reads the bucket listing rather than the plugin registry, so it still fires for a plugin that has been uninstalled; confirm it lives inside `destroy` and not in `createContext`, so no other command pays for it and discovery stays lazy.
  - *Status:* ☐ unverified

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists in `.changeset/` naming the three new user-facing verbs and stating the semver impact.
  - *Status:* ☐ unverified

- **O7 - Reviewable: the recorded state keys prove the scoping (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugin-commands` and observe exactly one state key for a plugin bootstrap - `state/<env>.<plugin>.json` - and only `state/<env>.json` for a site bootstrap with the same plugin installed.
  - *Evidence to collect:* run `pnpm test -- plugin-commands`; read the two recording-client assertions and confirm they assert on the full key list, not on membership.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:143` (`main`, `case 'bootstrap'`) calls `commands.bootstrap(ctx)` on a repo with a node-contributing plugin installed → expect the same node set and the same `state/<env>.json` writes as before this task : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:156` (`main`, `case 'destroy'`) calls `commands.destroy(ctx, { yes })` with a plugin's scoped state object present → expect the refusal, no delete issued, and the plugin's nodes untouched; with none present, expect today's teardown unchanged : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/commands.ts:301` (`status`) calls task 15's extracted read loop → expect `blogwright status` output unchanged; `pnpm test -- commands` passes unmodified : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/state.ts` (`StateStore`) constructed without a scope by `packages/cli/src/context.ts:134` → expect `state/<env>.json`, unchanged : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator, not obligations: the spec settles `blogwright destroy` against live plugin state by refusing (§State → Scoped state stores), which O5 discharges - what remains open, and is carried forward at task 20, is whether `plugin remove` should offer to run the plugin's teardown first; the analytics change spec declares its own `bootstrap`/`status`/`destroy`, so task 47's command table must be re-read against whatever precedence this task fixed; and whether a plugin verb should run when the site itself has never been bootstrapped is not covered by the DoD.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
