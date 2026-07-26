# Done Certificate — Task 54: Assemble the twelve-node graph and run it through the plugin lifecycle verbs

**Task:** [54-analytics_graph_and_lifecycle_commands.md](54-analytics_graph_and_lifecycle_commands.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 54. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 54) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `buildAnalyticsNodes(ctx)` returns the spec's twelve nodes, wired to the plugin's `nodes(ctx)` and reconciled by the CLI's engine against `state/<env>.analytics.json`, with the site's `state/<env>.json` and the site's node set provably untouched.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `packages/cli/src/nodes.ts:1053` `buildNodes` or the site's `bootstrap`/`destroy` (`packages/cli/src/commands.ts:44,54`), task 16's generic verbs and their precedence rule, or task 47's command table, which this task wires `nodes(ctx)` into without editing.

## Obligations

- **O1 — Twelve nodes in the spec's order, with a well-formed graph.**
  - *Claim:* `buildAnalyticsNodes(ctx)` returns exactly the spec's twelve nodes and is wired to `nodes(ctx)`; the dependency edges match the stated ordering; no `dependsOn` names an unknown node; the edges contain no cycle.
  - *Evidence to collect:* read `buildAnalyticsNodes` in `packages/analytics/src/nodes.ts` and the `nodes(ctx)` member in `packages/analytics/src/plugin.ts`; run `pnpm test -- commands` in `packages/analytics` and confirm the ordering test names all twelve ids explicitly and asserts each edge of the four chains the spec states.
  - *Checks:* pass the node set through `packages/cli/src/graph.ts:18` `topoSort` in the CLI-side test and confirm neither the unknown-dependency error at `:29` nor the cycle error at `:53` is raised.
  - *Status:* ☐ unverified

- **O2 — One engine, scoped state, and a visible region pin.**
  - *Claim:* the set reconciles through the CLI's engine with no second implementation in `packages/analytics`, against `state/<env>.analytics.json`; the site's `state/<env>.json` is never written during a bootstrap or a teardown; and `us-east-1` appears in the captured bootstrap output via the node titles.
  - *Evidence to collect:* run `grep -rn "topoSort\|applyGraph\|destroyGraph" packages/analytics/src/` and expect no output; run `pnpm test -- commands` in `packages/analytics` and read the recording S3 client's written-key list for both directions; read the captured logger lines and confirm `us-east-1` appears in `create ${node.title}` lines emitted by `packages/cli/src/graph.ts:70`.
  - *Checks:* resolve the store the plugin verbs write through — confirm it is a `StateStore` scoped to `analytics` (`packages/core/src/state.ts:17`), not the site's unscoped store.
  - *Status:* ☐ unverified

- **O3 — The destroy refusal.**
  - *Claim:* `analytics destroy` without `--yes` refuses with the same error shape as `packages/cli/src/commands.ts:56` and deletes nothing, and the plugin's command table cannot shadow the generic verb.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` in `packages/cli` and read the refusal case for a twelve-node plugin — confirm it asserts the message text and an empty recorded call list; run `pnpm test -- plugin` in `packages/analytics` and confirm the table test asserts no `destroy` entry.
  - *Status:* ☐ unverified

- **O4 — The site graph is untouched.**
  - *Claim:* `buildNodes` in the CLI still returns only the site's node ids with the analytics plugin installed, and `blogwright bootstrap`/`destroy` touch no plugin resource and no plugin state key.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and `pnpm test -- nodes` in `packages/cli`; confirm one case asserts the exact `buildNodes` id list with the plugin installed and one asserts the state keys touched by a site bootstrap are `state/<env>.json` alone.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run both command suites and confirm the twelve ids, the single state key and the region line (Reviewable).**
  - *Claim:* a reviewer can run the analytics and CLI command suites and observe an ordering test naming all twelve ids, a recording S3 client showing only `state/<env>.analytics.json` for a plugin bootstrap, and captured bootstrap lines containing `us-east-1`.
  - *Evidence to collect:* run `pnpm test -- commands` inside `packages/analytics` and `pnpm test -- plugin-commands` inside `packages/cli`; read the ordering test, the written-key assertion and the captured log lines.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:44` `bootstrap(ctx)` with the analytics plugin installed → expect `applyGraph(buildNodes(ctx), ctx)` over the site's ids alone and only `state/<env>.json` written : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/commands.ts:54` `destroy(ctx, { yes: true })` with `state/<env>.analytics.json` present → expect task 16's guard to refuse before `destroyGraph`, naming `blogwright analytics destroy --yes`, with no delete issued, the plugin's twelve resources untouched and its state object intact : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/plugin.ts` `nodes(ctx)` called by task 16's generic verbs → expect the same twelve-node array `buildAnalyticsNodes` returns, with no wrapper re-ordering it : ☐ (PRESERVED / REGRESSION)

## Residue

The engine-level assertions live in `packages/cli/src/plugin-commands.test.ts` because the analytics package may not depend on `blogwright`; the validator should confirm that split is real — a graph-shape test on the plugin side and an engine test on the CLI side — rather than an engine quietly reimplemented in the package. A site teardown would leave the plugin's delivery plumbing orphaned (the failure mode `packages/cli/src/nodes.ts:764` documents); task 16's guard is what prevents it by refusing while `state/<env>.analytics.json` exists, so the validator should confirm that guard fires for a twelve-node plugin rather than treating the orphan case as open. If task 16 decided a precedence other than the recommended one, the source of the bootstrap region line and the owner of the destroy refusal move with it.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
