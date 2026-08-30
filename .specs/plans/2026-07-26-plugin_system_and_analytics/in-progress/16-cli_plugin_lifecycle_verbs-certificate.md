# Done Certificate - Task 16: Run plugin graphs through bootstrap, status and destroy against a scoped state store

**Task:** [16-cli_plugin_lifecycle_verbs.md](16-cli_plugin_lifecycle_verbs.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

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
- **P3 - Invariants.** Must not break `commands.bootstrap`/`commands.destroy`/`commands.status` (`packages/cli/src/commands.ts`), `buildNodes` (`packages/cli/src/nodes.ts:1055`), the graph engine's save-on-failure behaviour (`packages/cli/src/graph.ts:85-95`), or the unscoped `state/<env>.json` key (`packages/core/src/state.ts:17`).

## Validation scope

This validation gates a DELTA on the 2026-08-29 pass, which returned PARTIAL on O7 and raised
three findings in its Residue. The core of the task (O1-O6) was proven then by observed S3 keys
and is inherited here, not re-derived: the three scoped-state surfaces (`state`, `store`,
`save()`), the `siteState` inverse pin for task 53, the `destroy` guard's exactly-one-`listObjects`
and no-delete profile, the single engine in `graph.ts`, unchanged `status` output, and the
collision rejection living in task 13's pass with `status` correctly exempt.

Four delta items were verified here BY EXECUTION, each mutation applied one at a time and
restored between:

- **D1 - `previewTeardown` now guarded** (`commands.ts:325`), closing Residue finding 1.
- **D2 - `genericLifecycleActions`** (`plugin-commands.ts:557`), read by both `renderActions`
  (`plugin-commands.ts:253`) and `cli.ts`'s `renderPluginSection` (`cli.ts:100`), closing Residue finding 2.
- **D3 - a missing bucket counts as "no scoped state"** (`commands.ts:131-139`), closing Residue finding 3.
- **D4 - the site-bootstrap inverse pin** (`plugin-commands.test.ts:1099-1226`), closing O7's missing artifact.

Restore proven: `jj diff --git` after all mutations is byte-identical to the capture taken
before the first one (`diff` of the two captures is empty).

## Obligations

- **O1 - One engine, reused over the plugin's node set.**
  - *Claim:* the three verbs run `applyGraph`, `destroyGraph` and task 15's extracted read loop over `plugin.nodes(ctx)`, and no second copy of the engine exists.
  - *Evidence collected:* `packages/cli/src/plugin-commands.ts:456` (`runGenericBootstrap` calls `applyGraph<PluginContext<unknown>>`), `:478` (`runGenericStatus` calls `readNodeStatus` then `logStatusEntries`), `:498` (`runGenericDestroy` calls `destroyGraph` then `ctx.store.delete()`). `grep -rn "function topoSort\|function applyGraph\|function destroyGraph" packages/` returns `packages/cli/src/graph.ts:29,69,103` and, beyond that, only `packages/cli/dist/graph.{js,d.ts}` - the build artifact the verification `pnpm build` produced, which the plan's inherited DoD names as an expected knip-artifact hit.
  - *Checks:* both resolve through `import { applyGraph, destroyGraph } from './graph.js'` (`plugin-commands.ts:128`) and `import { readNodeStatus } from './commands.js'`. `pnpm typecheck` clean across all five packages.
  - *Status:* ☑ SATISFIED (inherited; grep re-run)

- **O2 - Precedence decided, recorded and tested in both directions.**
  - *Claim:* `bootstrap` and `destroy` are always generic and a plugin declaring either is rejected with an error naming the collision; `status` is generic unless the plugin declares one.
  - *Evidence collected:* the module comment at `plugin-commands.ts:61-104`; `rejectDeclaredLifecycleCollisions` (`plugins.ts:405-445`) called from `discover` (`plugins.ts:481`) immediately after task 13's `rejectDeclaredInitCollisions`, both feeding `resolveNamespaceCollisions`. `RESERVED_LIFECYCLE_ACTIONS = new Set(['bootstrap', 'destroy'])` excludes `status` by construction. Four tests: the `it.each(['bootstrap','destroy'])` rejection, `a declared "status" command is NOT a collision`, `a plugin's own declared status command wins over the generic verb`, and `never reaches dispatch`.
  - *Checks:* nothing added to core's `validatePlugin`. The delta adds a fifth listing-side pin, `omits the generic status from the listing when the plugin declares its own, and lists it once`, which is falsifiable: removing `.filter(([action]) => !declared.has(action))` from `genericLifecycleActions` fails exactly that test and nothing else (1 failed / 83 passed).
  - *Status:* ☑ SATISFIED

- **O3 - State isolation holds in both directions.**
  - *Claim:* a plugin bootstrap writes only `state/<env>.<plugin>.json`, and `blogwright bootstrap`/`destroy` with that plugin installed touch neither plugin nodes nor plugin state.
  - *Evidence collected:* inherited from the prior pass for the plugin half (five surface-by-surface mutations, each killed on an observed S3 key, plus the `siteState: state` inverse). NEW for the site half: `plugin-commands.test.ts:1186` runs `blogwright bootstrap` through `main` against a fully-provisioned graph and asserts `[...new Set(stateKeys)]` equals `['state/production.json']`, `buildNodes(ctx)` ids do not contain the plugin's node id, `world.size === 0`, and `ctx.state.resources[<plugin node>]` is undefined.
  - *Checks:* **Mutation-verified, both directions of the new pin.** (a) Appending a task-53-shaped plugin node to `buildNodes` (`nodes.ts:1080`) fails it: `expected [ Array(12) ] to not include 'demo-resource'`. (b) Re-pointing `commands.bootstrap`'s `save` at a scoped `StateStore` fails it on the observed key: `expected [ 'state/production.demo.json' ] to deeply equal [ 'state/production.json' ]`. Both restored.
  - *Status:* ☑ SATISFIED

- **O4 - Refusals: `--yes` and a plugin with no nodes.**
  - *Claim:* `<plugin> destroy` without `--yes` raises with the site verb's contract and destroys nothing; a plugin with no `nodes` contributor does not gain the verbs and asking for one lists its real actions and exits non-zero.
  - *Evidence collected:* `destroy without --yes refuses with the same contract as the site verb, and destroys nothing` (message `refusing to destroy "demo" in "production" without --yes`, the fake node survives, the only recorded S3 call is the context-building `get`). `a plugin with no nodes contributor does not gain the verbs` loops all three actions, asserts `code === 1` each, `calls === []`, the three `✗ unknown fake action:` lines - and NEW in the delta, that no listed line matches `/^ {2}(bootstrap|status|destroy) - /m`.
  - *Checks:* **Mutation-verified (D2, direction one).** Removing `if (!plugin.nodes) return [];` from `genericLifecycleActions` (`plugin-commands.ts:558`) fails this test on exactly the new assertion - `expected '"fake" actions:\n  sync - sync it\n  …' not to match /^ {2}(bootstrap|status|destroy) - /m` - so a nodes-less plugin advertising verbs it cannot run is caught at the refusal. Restored.
  - *Status:* ☑ SATISFIED

- **O5 - `blogwright destroy` refuses while a plugin's state object exists.**
  - *Claim:* with `state/<env>.analytics.json` present, `blogwright destroy --yes` refuses, names the scope and its teardown verb, and issues no delete at all; with none present its call sequence is unchanged.
  - *Evidence collected:* `assertNoScopedState` (`commands.ts:131`) awaited at `commands.ts:158`, before the `Destroying` log, `clearRunningMicrovms` and `destroyGraph`. `commands.test.ts:434` asserts `calls` equals exactly `['s3.listObjects my-bucket state/']`. `proceeds exactly as before the guard` pins `calls[0]`, `calls.at(-1)`, seven `toContain` deletes and `buildNodes(ctx)` at 11. Five direct `assertNoScopedState` tests cover site-only, empty, one-scope, many-scope (sorted) and wrong-environment.
  - *Checks (delta - the guard is now on BOTH teardown verbs, and its failure mode changed):*
    - **D1, direction one.** Deleting `await assertNoScopedState(ctx)` from `previewTeardown` fails two tests: the refusal (`promise resolved "undefined" instead of rejecting`) and the equivalence pin (`expected [ …(11) ] to deeply equal [ …(12) ]`).
    - **D1, direction two - the message-vs-client distinction the DoD exists for.** MOVING the guard to after `destroyGraph` keeps `rejects.toThrow('blogwright analytics destroy --yes')` passing, and the test still fails, on the client: `expected [ …(11) ] to deeply equal [ 's3.listObjects my-bucket state/' ]`. The refusal is genuinely asserted on the recording client, not on the printed message.
    - **D3, direction one.** Removing the `isNotFound` try/catch fails `treats an already-deleted bucket as no scoped state` with nothing cleaned: `expected [ 's3.listObjects my-bucket state/' ] to include 'iam.deleteRole production-example-bui…'`.
    - **D3, direction two.** Making the catch swallow EVERY error fails `still propagates a listing failure that is NOT a missing bucket` (`promise resolved "undefined" instead of rejecting`). Both directions fire.
    - **D3 fidelity, verified by trace rather than by comment.** The recorded call list for the bucket-gone run is, in order: `s3.listObjects my-bucket state/`, `logsUsEast1.deleteDeliverySource`, `logsUsEast1.deleteDeliveryDestination`, `iam.deleteRole …-exec-role`, `iam.deleteRole …-build-role`, `logs.deleteLogGroup /aws/lambda/microvms/…`, `logsUsEast1.deleteLogGroup /…/cloudfront`, `cloudfront.deleteFunction …-router`, `s3.deletePrefix my-bucket ` - nine calls, ending in the bucket node's own `deletePrefix` raising `NoSuchBucket`. `bucket` has `dependsOn: []`, so `topoSort(...).reverse()` puts it LAST; `destroyGraph` does not catch a node's `delete`, so the run ends in failure at the bucket node with every non-bucket resource already gone. That is what the doc comment claims and what actually happens.
    - `previewTeardown`'s `--yes` refusal is independently falsifiable: removing `if (!opts.yes) throw …` fails exactly `refuses without --yes and makes no client call at all`.
  - *Status:* ☑ SATISFIED (see Residue finding 1 for a message-content concern that is not an obligation breach)

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants.
  - *Evidence collected:* from the workspace root - `pnpm build` clean; `pnpm test` clean (core 140 + 1 skipped, analytics 2, build-agent 27, pds 96, cli **286** across 22 files, 0 failures; the delta adds 9 cli tests over the prior pass's 277); `pnpm typecheck` clean; `pnpm lint` exits 0 (only the pre-existing `no-shadow` warnings in the untouched `nodes.test.ts`); `pnpm exec oxfmt --check .` reports all 142 files correctly formatted; `pnpm knip` exits 0. `.changeset/plugin-lifecycle-verbs.md` declares `"blogwright": minor` and, after the delta, covers all four newly user-visible behaviours: the three verbs, the declaration rejection, the `--yes` refusal, the verbs appearing in `--help` and in the unknown-action refusal for a nodes-contributing plugin (and in neither for a nodes-less one), `blogwright preview teardown`'s refusal alongside `blogwright destroy`'s, and the already-gone-bucket teardown. Named constants: `STATE_PREFIX`, `GENERIC_LIFECYCLE_ACTIONS`, `YES_FLAG`, `RESERVED_LIFECYCLE_ACTIONS`, `DEFAULT_ENV`.
  - *Checks:* changeset text checked line by line against shipped behaviour; two wording nits recorded in the Residue, no factual mismatch.
  - *Status:* ☑ SATISFIED

- **O7 - Reviewable: the recorded state keys prove the scoping (Reviewable).**
  - *Claim:* running the `Reviewable:` line shows exactly one state key for a plugin bootstrap (`state/<env>.<plugin>.json`), only `state/<env>.json` for a site bootstrap with the same plugin installed, and BOTH teardown verbs refusing on the client.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run plugin-commands commands --reporter=verbose` - the line as WIDENED on 2026-08-30 - passes **53/53** across `commands.test.ts` and `plugin-commands.test.ts`, and shows all four named artifacts:
    1. plugin bootstrap: `expect(calls).toEqual([{op:'get',key:'state/production.demo.json'},{op:'put',key:'state/production.demo.json'}])` (full list, not membership);
    2. site bootstrap with the same plugin installed: `expect([...new Set(stateKeys)]).toEqual(['state/production.json'])` - the artifact the prior pass recorded as ABSENT, now present at `plugin-commands.test.ts:1186`, deliberately filed in `plugin-commands.test.ts` so the filter reaches it;
    3. `destroy --yes` refusing on the client: `expect(calls).toEqual(['s3.listObjects my-bucket state/'])`;
    4. `preview teardown --yes` refusing on the client: the same single-call assertion.
  - *Checks:* the new site-bootstrap test is NOT vacuous, verified three ways. `main` (`cli.ts:358-390`) does not catch, so `await main([...])` rejects on any node failure - confirmed by making a node late in the reverse-topo order throw, which fails the test outright. `expect(stateKeys.length).toBeGreaterThan(0)` rules out a run that saved nothing. `expect(keys).toContain('build/agent/agent-<hash>.zip')` proves the builder-image node genuinely reconciled. One precision note: the builder-image node is 7th of 11 in topological order, so the artifact assertion ALONE would survive a run truncated after it; it is `expect(code).toBe(0)` on a non-catching `main` that rules out the early exit, and the artifact assertion that rules out a vacuous no-op pass. The two together are sound; the inline comment's "which means the whole graph was walked" overstates what the artifact line alone carries.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/cli.ts:359` (`main`, `case 'bootstrap'`) with a node-contributing plugin installed → expect the same node set and the same `state/<env>.json` writes : ☑ PRESERVED (now pinned by a real test rather than only structurally - `plugin-commands.test.ts:1186` - and that pin is mutation-proven in both directions).
- `packages/cli/src/cli.ts:373` (`main`, `case 'destroy'`) with a scoped state object present → expect the refusal, no delete, plugin nodes untouched; with none, today's teardown : ☑ PRESERVED (recording-client test; the clean run is `listObjects` + the pre-existing sequence).
- `packages/cli/src/cli.ts:509` (`runPreview`, `case 'teardown'`) → expect the same graph teardown as before, plus the guard : ☑ PRESERVED (`adds exactly one listObjects at the head and nothing else` proves it by EQUIVALENCE: the un-guarded body is run against an identical recording context and the guarded verb's calls must equal that sequence with one listing prepended; `buildNodes(ctx)` still returns 13 for the preview graph).
- `packages/cli/src/commands.ts:355` (`status`) via `render.ts`'s extracted `logStatusEntries` → expect output unchanged : ☑ PRESERVED (`commands.test.ts`'s pre-existing status tests untouched and passing).
- `packages/cli/src/cli.ts:96` (`renderPluginSection`, `--help`) → expect a plugin with no `nodes` to be rendered exactly as before : ☑ PRESERVED and pinned (`cli.test.ts:333` asserts the whole help block byte for byte, with `gadget` listing only `poke`); removing the `plugin.nodes` gate fails it and six sibling help-text pins.
- `packages/cli/src/nodes.ts:1055` (`buildNodes`) → expect no plugin channel : ☑ PRESERVED (static literal array; now also pinned by an id-list assertion, not only a length count).

## Residue

Findings from this validation. None breaches an obligation above; the first is a correctness
concern carried to the parent gate.

1. **The guard's remedy line omits the environment, and on `preview teardown` it is therefore
   always wrong.** `assertNoScopedState` (`packages/cli/src/commands.ts:142-144`) prints
   `` - <scope>: run `blogwright <scope> destroy --yes` first ``. `runPlugin` resolves its
   environment as `values.env ?? envPositional ?? DEFAULT_ENV` with `DEFAULT_ENV = 'production'`
   (`plugin-commands.ts:138,675`), and `runPreview` always builds its context with `env: 'preview'`
   (`cli.ts:485`). So an operator refused by `blogwright preview teardown --yes` is told to run
   `blogwright analytics destroy --yes`, which targets **production**: at best it loads empty
   state, removes nothing and leaves the operator stuck in the same refusal; at worst it tears
   down the live production analytics stack. The correct command is
   `blogwright analytics destroy preview --yes` (`deriveNames` keys off `env` alone, so the
   env positional is sufficient - `preview: true` is not needed). The same gap exists for
   `blogwright destroy staging --yes`, but there the default only sometimes disagrees; on
   `previewTeardown` it disagrees always, and this delta is what put the guard there. The
   delta's own tests pin the env-less string (`commands.test.ts:434,559`), so nothing will
   catch it later. **Not an O5 breach:** the task file's DoD prescribes this exact message
   shape ("naming each scope and its `blogwright <scope> destroy --yes`"), so the fix is a task
   amendment plus a one-line change to interpolate `ctx.env`, not a defect against the contract
   as written.
2. `assertNoScopedState` treats ANY not-found from `listObjects` as "no scoped state"
   (`AwsError.isNotFound` also matches `NoSuchKey` and any 404). For a real S3 bucket a 404 on
   `ListObjectsV2` means `NoSuchBucket`, so this is sound today; against a non-AWS S3
   implementation reached through `--endpoint`, a spurious 404 would let the teardown proceed
   and empty a bucket that does hold plugin state. Low risk, documented in the guard's own doc
   comment, worth a line in the endpoint-override task if one exists.
3. Changeset wording nits, no factual error: paragraph 2 opens "Both
   `blogwright <plugin> bootstrap|status|destroy` are listed…" where three verbs are meant; and
   paragraph 3's "re-running the teardown still cleans up everything else" is true but does not
   say the run still ends in an error at the bucket node.
4. `plugin-commands.test.ts:877` uses `expect(terminal.writes.every(…)).toBe(true)`, which is
   vacuously true on an empty array. It is not vacuous as written (three writes are produced and
   asserted on immediately below), but it is the weaker form of the assertion beside it.
5. The narrowed `scopedStateOnlyS3()` (`test-support.ts:268`) is confirmed strictly better than a
   blanket stub, measured rather than asserted: with the `store: ops.store` defect reintroduced,
   `vitest run plugin-commands commands cli` gives **20 failures** with the narrowed default,
   **6** with `key.startsWith('state/')` and **6** with a fully blanket
   `async () => undefined`. The narrowing tolerates only keys of the scoped SHAPE
   (`/^state\/[^./]+\.[^./]+\.json$/`) - the site's two-part key never matches - and every test
   that cares asserts exact keys against its own recording client, so no read it should reject
   passes silently. (The implementer reported 5 rather than 6 for the blanket case; the
   direction and the conclusion are unaffected.)

Carried forward unchanged from the prior pass: whether `plugin remove` should offer to run the
plugin's teardown first (task 20); task 47's command table must be re-read against the
precedence fixed here; and whether a plugin verb should run when the site has never been
bootstrapped is not covered by the DoD.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All seven obligations are SATISFIED. The delta closes O7's missing artifact with a
site-bootstrap pin that is mutation-proven in both directions and provably non-vacuous, and
closes the prior pass's three Residue findings; each of the four delta items was verified by
execution rather than by the implementer's report, including the message-vs-client distinction
(moving `previewTeardown`'s guard after `destroyGraph` leaves `rejects.toThrow` passing and is
still caught, on the recorded call list) and both directions of the `isNotFound` swallow. Every
repo gate is clean and the widened `Reviewable:` line passes 53/53, showing all four artifacts
it promises. The one open concern - the guard's remedy string naming an environment-less
`blogwright <scope> destroy --yes` that resolves to production when the refusal came from
`preview teardown` - matches the DoD's own prescribed message shape and so is recorded as
Residue rather than an obligation breach, but it is a live misdirection on a destructive path
and is carried to the correctness gate.
