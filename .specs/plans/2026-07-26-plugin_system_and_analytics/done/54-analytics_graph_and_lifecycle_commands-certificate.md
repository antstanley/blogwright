# Done Certificate - Task 54: Assemble the twelve-node graph and run it through the plugin lifecycle verbs

**Task:** [54-analytics_graph_and_lifecycle_commands.md](54-analytics_graph_and_lifecycle_commands.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 54. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 54) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `buildAnalyticsNodes(ctx)` returns the spec's twelve nodes, wired to the plugin's `nodes(ctx)` and reconciled by the CLI's engine against `state/<env>.analytics.json`, with the site's `state/<env>.json` and the site's node set provably untouched.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `packages/cli/src/nodes.ts:1053` `buildNodes` or the site's `bootstrap`/`destroy` (`packages/cli/src/commands.ts:44,54`), task 16's generic verbs and their precedence rule, or task 47's command table, which this task wires `nodes(ctx)` into without editing.

## Obligations

- **O1 - Twelve nodes in the spec's order, with a well-formed graph.**
  - *Claim:* `buildAnalyticsNodes(ctx)` returns exactly the spec's twelve nodes and is wired to `nodes(ctx)`; the dependency edges match the stated ordering; no `dependsOn` names an unknown node; the edges contain no cycle.
  - *Evidence to collect:* read `buildAnalyticsNodes` in `packages/analytics/src/nodes.ts` and the `nodes(ctx)` member in `packages/analytics/src/plugin.ts`; run `pnpm test -- commands` in `packages/analytics` and confirm the ordering test names all twelve ids explicitly and asserts each edge of the four chains the spec states.
  - *Checks:* pass the node set through `packages/cli/src/graph.ts:18` `topoSort` in the CLI-side test and confirm neither the unknown-dependency error at `:29` nor the cycle error at `:53` is raised.
  - *Status:* ☑ SATISFIED. `buildAnalyticsNodes()` (`packages/analytics/src/nodes.ts:2977`)
    returns the twelve factories in the spec table's order; `plugin.ts:242` wires it as
    `nodes: buildAnalyticsNodes` by reference. Four cases in `commands.test.ts` assert the ids in
    order, the edges against a hand-typed table, that no `dependsOn` names an unknown node or a
    node later in the array (the witness that the returned order is topological, hence acyclic),
    and the titles. Independently re-mutated: dropping a node, swapping two entries, dropping the
    `analytics-firehose-role -> analytics-table` edge and adding an unknown dependency each fail
    with the named assertion. The certificate's own check is discharged on the CLI side - inverting
    `topoSort`'s unknown-dependency test (`graph.ts:40`) makes the twelve-node case fail with
    `node "analytics-namespace" depends on unknown node "analytics-table-bucket"`, proving the real
    `topoSort` walks the real edge shape and raises neither of its two errors on the shipped set.
    *Deviation, adjudicated correct:* the function ships zero-arg, not `(ctx)`. All twelve factories
    are themselves zero-arg, the set's membership, ids, titles and edges are compile-time constants,
    the SPI declares `nodes?(ctx)` (a zero-arg function is assignable), and the host calls
    `nodesOf(ctx)` (`plugin-commands.ts:485,522,527`) - so the parameter would be an unused binding
    and a false claim that the set varies with context. The DoD's literal wording is what is wrong.

- **O2 - One engine, scoped state, and a visible region pin.**
  - *Claim:* the set reconciles through the CLI's engine with no second implementation in `packages/analytics`, against `state/<env>.analytics.json`; the site's `state/<env>.json` is never written during a bootstrap or a teardown; and `us-east-1` appears in the captured bootstrap output via the node titles.
  - *Evidence to collect:* run `grep -rn "topoSort\|applyGraph\|destroyGraph" packages/analytics/src/` and expect no output; run `pnpm test -- commands` in `packages/analytics` and read the recording S3 client's written-key list for both directions; read the captured logger lines and confirm `us-east-1` appears in `create ${node.title}` lines emitted by `packages/cli/src/graph.ts:70`.
  - *Checks:* resolve the store the plugin verbs write through - confirm it is a `StateStore` scoped to `analytics` (`packages/core/src/state.ts:17`), not the site's unscoped store.
  - *Status:* ☑ SATISFIED. The step-7 grep was correctly replaced (see the task file, beneath step 7):
    the original returns 49 comment matches on the final tree and returned 30+ before the task began,
    so it could never pass. Both replacements return nothing and both are falsifiable - appending
    `export function topoSort() {}` and `import type { X } from 'blogwright';` to a package file makes
    each match, and the trailing quote is genuinely load-bearing (29 legitimate `blogwright-core`
    imports match the naive pattern). The scoped store is `new StateStore(ops.clients.s3,
    ops.names.bucket, ops.env, pluginName)` (`plugin-commands.ts:331`); dropping the scope argument
    fails fourteen CLI cases. All twelve titles carry the literal `us-east-1` (three literal, nine via
    `ANALYTICS_REGION = 'us-east-1'`); removing it from one title fails the region case, and changing
    `applyGraph`'s `create ${node.title}` to `create ${node.id}` (`graph.ts:84`) fails the CLI case
    that asserts the printed lines equal the twelve titles and each contains `us-east-1`. State
    isolation is asserted on *recorded requests*, not return values: a node injected to PUT
    `state/test.json` and a node injected to GET it each fail the bootstrap case.
    *Deviation, adjudicated correct:* two of the twelve titles say "global - IAM is not regional; it
    serves the us-east-1 pipeline" rather than "created in us-east-1". §Region pinning states verbatim
    that "a role is a global resource, so \"created in us-east-1\" is not a property it has"
    (`2026-07-26-analytics_plugin.md:189`), and the DoD's actual requirement - `us-east-1` in the
    captured bootstrap output - holds for all twelve.
    *Adjudicated on the code:* `commands.test.ts`'s `reconcile`/`tearDown` are not a second engine.
    Neither reads `dependsOn`; `reconcile` iterates the caller's array and `tearDown` iterates its
    reverse. They derive no order from the graph, so DoD 2 holds. The ordering property is proved
    where a hand-written sequence cannot fake it: the real `applyGraph`/`topoSort` run over an
    edge-identical twelve-node stand-in in `plugin-commands.test.ts`, and reversing `topoSort`'s
    output there fails the per-edge position assertion.

- **O3 - The destroy refusal.**
  - *Claim:* `analytics destroy` without `--yes` refuses with the same error shape as `packages/cli/src/commands.ts:56` and deletes nothing, and the plugin's command table cannot shadow the generic verb.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` in `packages/cli` and read the refusal case for a twelve-node plugin - confirm it asserts the message text and an empty recorded call list; run `pnpm test -- plugin` in `packages/analytics` and confirm the table test asserts no `destroy` entry.
  - *Status:* ☑ SATISFIED. `runGenericDestroy` refuses with
    `refusing to destroy "analytics" in "production" without --yes` and the CLI case compares that
    shape against the site verb's own real message rather than a restated literal. Deleting the
    `if (!yes) throw` guard (`plugin-commands.ts:517-519`) fails it with
    `promise resolved "+0" instead of rejecting`, and the case also asserts `run.deleted` is empty,
    all twelve still standing, and `calls` is the single scoped `get`. The command table cannot
    shadow it: `plugin.test.ts:250` asserts the plugin declares none of
    `['bootstrap','destroy','init']`.

- **O4 - The site graph is untouched.**
  - *Claim:* `buildNodes` in the CLI still returns only the site's node ids with the analytics plugin installed, and `blogwright bootstrap`/`destroy` touch no plugin resource and no plugin state key.
  - *Evidence to collect:* run `pnpm test -- plugin-commands` and `pnpm test -- nodes` in `packages/cli`; confirm one case asserts the exact `buildNodes` id list with the plugin installed and one asserts the state keys touched by a site bootstrap are `state/<env>.json` alone.
  - *Status:* ☑ SATISFIED. The new CLI case installs the twelve-node plugin through real discovery
    (asserting `typeof discovered.plugins[0].nodes === 'function'`, so the case is not vacuous), runs
    `blogwright bootstrap`, and asserts none of the twelve ids is in `buildNodes(ctx)`, none is in
    `ctx.state.resources`, `run.created` is empty and the only state key touched is
    `state/production.json`. Pushing a node with a plugin id into `buildNodes` fails it with
    `expected [ Array(12) ] to not include 'analytics-table-bucket'`. The site teardown is driven end
    to end: the plugin's own generic `bootstrap` writes `state/production.analytics.json` into the
    shared bucket, then `destroy(site, { yes: true })` refuses naming
    `blogwright analytics destroy production --yes` with `bucket.deletes` empty. Deleting
    `assertNoScopedState(ctx)` from `commands.ts:200` fails it; making the guard issue one delete
    before it throws fails the zero-delete assertion specifically.
    *Evidence deviation, non-blocking:* the case asserts the twelve are absent from the returned ids
    rather than asserting the exact site id list this certificate's evidence line names. No test in
    the repo asserts that exact list. The property the DoD states ("asserted on the returned node ids")
    holds and is falsifiable.

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☑ SATISFIED. Re-run from the workspace root in `.github/workflows/ci.yml` order, all
    exit 0: `pnpm build`, `pnpm typecheck`, `pnpm test` (core 149+1 skipped, build-agent 27, pds 150,
    analytics 740, cli 376), `pnpm lint` (three pre-existing `no-shadow` warnings in an untouched
    `nodes.test.ts`, no errors), `pnpm exec oxfmt --check .` (201 files), `pnpm knip`. `jj st` lists
    only the eight intended files, no stray artefacts. `.changeset/analytics-lifecycle-verbs.md`
    exists and is accurate. Baselines measured directly by reverting the five code files to
    `eb4ee83e`: analytics 734 -> 740 (+6) and cli 371 -> 376 (+5), both matching the cases added.
    The change adds no class or interface members, so knip's blind spot does not apply here.

- **O6 - Run both command suites and confirm the twelve ids, the single state key and the region line (Reviewable).**
  - *Claim:* a reviewer can run the analytics and CLI command suites and observe an ordering test naming all twelve ids, a recording S3 client showing only `state/<env>.analytics.json` for a plugin bootstrap, and captured bootstrap lines containing `us-east-1`.
  - *Evidence to collect:* run `pnpm test -- commands` inside `packages/analytics` and `pnpm test -- plugin-commands` inside `packages/cli`; read the ordering test, the written-key assertion and the captured log lines.
  - *Status:* ☑ SATISFIED. `--reporter=verbose` confirmed a real vitest 4.1.10 flag. The task's
    `Reviewable:` line was run verbatim: the analytics command exits 0 with 12/12, the verbose list
    naming the ordering, edge, witness and region cases, and the state cases naming
    `state/test.analytics.json`; the CLI command exits 0 with 69/69, including the four new
    twelve-node cases. The CLI case asserts `calls[0]` is a get of
    `state/production.analytics.json` and that it is the only key touched, and that every printed
    `create` line contains `us-east-1`.

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:44` `bootstrap(ctx)` with the analytics plugin installed → expect `applyGraph(buildNodes(ctx), ctx)` over the site's ids alone and only `state/<env>.json` written : ☑ PRESERVED (`plugin-commands.test.ts`, "leaves buildNodes returning the site ids alone with a twelve-node plugin installed")
- `packages/cli/src/commands.ts:54` `destroy(ctx, { yes: true })` with `state/<env>.analytics.json` present → expect task 16's guard to refuse before `destroyGraph`, naming `blogwright analytics destroy --yes`, with no delete issued, the plugin's twelve resources untouched and its state object intact : ☑ PRESERVED (`plugin-commands.test.ts`, "refuses naming `blogwright analytics destroy production --yes`")
- `packages/analytics/src/plugin.ts` `nodes(ctx)` called by task 16's generic verbs → expect the same twelve-node array `buildAnalyticsNodes` returns, with no wrapper re-ordering it : ☑ PRESERVED (`plugin.test.ts` asserts `nodes` IS `buildAnalyticsNodes` by identity; wrapping it in `() => buildAnalyticsNodes()` fails that assertion)

## Residue

The engine-level assertions live in `packages/cli/src/plugin-commands.test.ts` because the analytics package may not depend on `blogwright`; the validator should confirm that split is real - a graph-shape test on the plugin side and an engine test on the CLI side - rather than an engine quietly reimplemented in the package. A site teardown would leave the plugin's delivery plumbing orphaned (the failure mode `packages/cli/src/nodes.ts:764` documents); task 16's guard is what prevents it by refusing while `state/<env>.analytics.json` exists, so the validator should confirm that guard fires for a twelve-node plugin rather than treating the orphan case as open. If task 16 decided a precedence other than the recommended one, the source of the bootstrap region line and the owner of the destroy refusal move with it.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED on collected evidence and all three regression traces are
PRESERVED - the twelve-node set, its edges and its region-stating titles are pinned by falsifiable
assertions on the analytics side, the real `topoSort`/`applyGraph`/`destroyGraph` reconcile an
edge-identical set against `state/<env>.analytics.json` alone on the CLI side, and both the plugin's
`--yes` refusal and the site teardown's scoped-state guard are proved to issue no delete; the two
places the implementation departs from the task's literal text (a zero-arg `buildAnalyticsNodes`, and
two IAM-role titles that state the pin as the pipeline they serve) were adjudicated against the change
spec and are correct, with the task's unfalsifiable step-7 grep correctly replaced and the replacement
itself shown to be falsifiable.
