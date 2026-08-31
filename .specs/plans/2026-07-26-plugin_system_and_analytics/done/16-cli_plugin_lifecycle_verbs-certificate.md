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
- **P3 - Invariants.** Must not break `commands.bootstrap`/`commands.destroy`/`commands.status` (`packages/cli/src/commands.ts`), `buildNodes` (`packages/cli/src/nodes.ts`), the graph engine's save-on-failure behaviour (`packages/cli/src/graph.ts:85-95`), or the unscoped `state/<env>.json` key (`packages/core/src/state.ts:20`).

## Validation scope

Third pass. It gates a DELTA on the 2026-08-30 pass, which returned DONE with Residue finding 1
(the guard's remedy string omitted the environment) carried to the correctness gate, and finding
2 (`isNotFound` too broad) and 3 (changeset wording) open. The task file's DoD was CORRECTED on
2026-08-30 so the remedy must now carry the environment, and its `Reviewable:` line was WIDENED
to `vitest run plugin-commands commands`.

Inherited from the two prior passes, not re-derived: the three scoped-state surfaces proven by
observed S3 keys (including the `save()` variant that typechecks while writing the wrong key);
the `siteState` inverse pin for task 53; `previewTeardown`'s guard caught on the client when
moved after `destroyGraph`; `genericLifecycleActions` in both listings and both directions; the
missing-bucket call trace; the site-bootstrap pin in both directions; `scopedStateOnlyS3()`
measured at 20 failures vs 6.

Verified here BY EXECUTION, each mutation applied singly and restored between:

- **D5 - the remedy carries `ctx.env`** (`commands.ts:162-164`), closing Residue finding 1.
- **D6 - the end-to-end loop**: the printed command dispatches against the printed environment
  (`plugin-commands.test.ts:860` against `plugin-commands.ts:675`).
- **D7 - the narrowing** from `err.isNotFound` to `err.code === 'NoSuchBucket'`
  (`commands.ts:145`), going beyond Residue finding 2's recommendation.
- **D8 - the D4 comment correction** (`plugin-commands.test.ts:1268-1276`) and the changeset.
- **D9 - full falsifiability walk** over every `it` added or touched.

Restore proven: `jj diff --git` after all seventeen mutations is byte-identical to the capture
taken before the first (`diff` of the two captures is empty); `jj st` lists exactly the diff's
ten files, with no scratch file left behind.

## Obligations

- **O1 - One engine, reused over the plugin's node set.**
  - *Claim:* the three verbs run `applyGraph`, `destroyGraph` and task 15's extracted read loop over `plugin.nodes(ctx)`, and no second copy of the engine exists.
  - *Evidence collected:* `plugin-commands.ts:456` (`runGenericBootstrap` → `applyGraph`), `:478` (`runGenericStatus` → `readNodeStatus` then `logStatusEntries`), `:498` (`runGenericDestroy` → `destroyGraph` then `ctx.store.delete()`). `grep -rn "function topoSort\|function applyGraph\|function destroyGraph" packages/` (excluding `dist/` and the vendored `agent/`) returns only `packages/cli/src/graph.ts:29,69,103`.
  - *Checks:* **Mutation-verified.** Deleting `await applyGraph<PluginContext<unknown>>(nodesOf(ctx), ctx)` fails exactly `bootstrap runs applyGraph over the plugin's own nodes…` (1 failed / 62 passed). Replacing `readNodeStatus`'s result with an empty list fails exactly `status reads the plugin's own nodes…` (1 / 62). Deleting `await ctx.store.delete()` fails exactly the two destroy tests (2 / 61). All restored.
  - *Status:* ☑ SATISFIED

- **O2 - Precedence decided, recorded and tested in both directions.**
  - *Claim:* `bootstrap` and `destroy` are always generic and a plugin declaring either is rejected with an error naming the collision; `status` is generic unless the plugin declares one.
  - *Evidence collected:* module comment `plugin-commands.ts:61-104`; `rejectDeclaredLifecycleCollisions` (`plugins.ts:407-445`) called from `discover` immediately after task 13's `rejectDeclaredInitCollisions`. `RESERVED_LIFECYCLE_ACTIONS = new Set(['bootstrap','destroy'])` (`plugins.ts:407`) excludes `status` by construction. Nothing added to core's `validatePlugin`.
  - *Checks:* **Mutation-verified in both directions.** Emptying `RESERVED_LIFECYCLE_ACTIONS` fails exactly the three rejection tests (3 / 60). Adding `'status'` to it fails exactly the three status-is-allowed tests - `a declared "status" command is NOT a collision`, `a plugin's own declared status command wins over the generic verb`, `omits the generic status from the listing…` (3 / 60). Making `matchAction` skip a declared `status` fails exactly `a plugin's own declared status command wins…` (1 / 62). Dropping `genericLifecycleActions`' `!declared.has(action)` filter fails exactly `omits the generic status… and lists it once` (1 / 62).
  - *Status:* ☑ SATISFIED

- **O3 - State isolation holds in both directions.**
  - *Claim:* a plugin bootstrap writes only `state/<env>.<plugin>.json`, and `blogwright bootstrap`/`destroy` with that plugin installed touch neither plugin nodes nor plugin state.
  - *Evidence collected:* inherited (five surface-by-surface mutations each killed on an observed S3 key, plus the `siteState` inverse and the site-bootstrap pin's two directions). Re-confirmed structurally here: `toPluginContext` (`plugin-commands.ts:299-303`) builds `new StateStore(ops.clients.s3, ops.names.bucket, ops.env, pluginName)` and passes `siteState: ops.state` unchanged; `pluginName` is `plugin.name` (`plugin-commands.ts:685`).
  - *Checks:* the scope token is provably the dispatch token - `runPlugin` finds by `candidate.name === command` (`plugin-commands.ts:622`) and `resolveNamespaceCollisions` keys by `entry.plugin.name` (`plugins.ts:328`), the same value that scopes the store. `StateStore`'s `SCOPE_PATTERN = /^[a-z0-9-]+$/` (`packages/core/src/state.ts:18`) forbids a dot in a scope, so the guard's `slice` of the key can never yield a non-dispatchable token.
  - *Status:* ☑ SATISFIED (inherited; re-confirmed)

- **O4 - Refusals: `--yes` and a plugin with no nodes.**
  - *Claim:* `<plugin> destroy` without `--yes` raises with the site verb's contract and destroys nothing; a plugin with no `nodes` contributor does not gain the verbs.
  - *Evidence collected:* `refusing to destroy "demo" in "production" without --yes`; the fake node survives; the only recorded S3 call is the context-building `get`.
  - *Checks:* **Mutation-verified.** Deleting `runGenericDestroy`'s `if (!yes) throw …` fails exactly `destroy without --yes refuses…` (1 / 62). Making `genericLifecycleCommand` ignore `plugin.nodes` fails exactly `a plugin with no nodes contributor does not gain the verbs` (1 / 62), and making `genericLifecycleActions` ignore it fails that test plus seven help-text pins (8 / 55) - the dispatch gate and the listing gate are each independently pinned.
  - *Status:* ☑ SATISFIED

- **O5 - Both teardown verbs refuse while a plugin's state object exists, naming the environment.**
  - *Claim:* with `state/<env>.analytics.json` present, `blogwright destroy --yes` and `blogwright preview teardown --yes` refuse, name each scope and its `blogwright <scope> destroy <env> --yes` **carrying the environment**, and issue no delete at all; with none present the call sequence is unchanged.
  - *Evidence collected:* `assertNoScopedState` (`commands.ts:131`) awaited at `commands.ts:176` (`destroy`) and `commands.ts:345` (`previewTeardown`), in each case after the `--yes` check and before the `Destroying`/`Tearing down` log, `clearRunningMicrovms` and `destroyGraph`. The remedy is built at `commands.ts:162-164` as `` run `blogwright ${scope} destroy ${ctx.env} --yes` first ``.
  - *Checks (the delta - the corrected DoD):*
    - **D5, the discriminator that matters.** Hardcoding `production` in place of `${ctx.env}` - the exact shape of the original defect - fails exactly the two PREVIEW cases: `assertNoScopedState > names the environment being torn down, not the plugin verb's production default` and `previewTeardown > refuses while a plugin state object exists` (2 / 54). Every production-only assertion still passes, confirming the coverage is what it claims: production-only pins CANNOT catch this, and the preview pins exist.
    - **D5, the whole-command-line pin.** Deleting `${ctx.env}` outright fails FIVE tests - the three `assertNoScopedState` message tests plus the `destroy` and `previewTeardown` client tests (5 / 51) - because each asserts the whole command line (`run \`blogwright analytics destroy production --yes\` first`), not just the scope name. A scope-only assertion would have passed on the broken form; these do not.
    - **D6, the end-to-end loop.** Dropping the env positional at `plugin-commands.ts:675` (`values.env ?? envPositional ?? DEFAULT_ENV` → `values.env ?? DEFAULT_ENV`) fails `destroy <env> --yes - the remedy the site teardown prints - targets that environment` on the observed S3 keys: `state/preview.demo.json` expected, `state/production.demo.json` received, for all three of get/put/delete. The printed command is therefore proven runnable-as-printed, not merely well-spelled.
    - **The remaining runnability links, checked rather than assumed.** `deriveNames(opts.env, accountId, config)` (`context.ts:176` → `packages/core/src/config.ts:374`) derives `bucket` from `env`/`siteName`/`accountId` alone and never reads `preview`, so `blogwright analytics destroy preview --yes` resolves the same bucket `previewTeardown` refused over; the comment's "`deriveNames` keys off `env` alone" holds. `runPreview` builds `env: 'preview', preview: true` unconditionally (`cli.ts:485`), so the preview case is the one where the old default could never accidentally be right. `runPlugin` never sets `preview: true`, so a plugin's bootstrap and its destroy see the same `ctx.preview`, and the remedy is exactly reversible.
    - **Guard placement, both verbs.** Removing the guard from `destroy` fails 5 tests; from `previewTeardown`, 2. Moving `destroy`'s guard ahead of its `--yes` check fails `refuses without --yes and makes no client call at all`. Dropping `previewTeardown`'s `--yes` refusal fails its own sibling. Each ordering constraint is independently pinned.
    - **Parsing.** Dropping the `key !== site` exclusion fails 3 tests; dropping the env-prefix filter fails `ignores an object for a different environment`; dropping `.sort()` fails `names every scope, sorted`; dropping the `scopes.length === 0` early return fails 5.
  - *Status:* ☑ SATISFIED

- **O5b - The narrowing to `NoSuchBucket` (the implementer went beyond what was asked).**
  - *Claim:* matching `err.code === 'NoSuchBucket'` rather than `err.isNotFound` (`commands.ts:145`) closes the spurious-404 orphaning hole without breaking D3's recovery path.
  - *The load-bearing claim, CHECKED rather than accepted:* the AWS `ListObjectsV2` API reference's `Errors` section documents exactly ONE error for the operation - **`NoSuchBucket`, HTTP 404, "The specified bucket does not exist"**. `listObjects` (`packages/core/src/aws/s3.ts:180`) issues that operation as a GET, whose error response carries an XML body, and `parseError` (`packages/core/src/aws/signer.ts:177-199`) reads `<Code>` from it. So against real AWS the narrowing is exact, not merely likely.
  - *Checks:* **Three-way mutation, each killed by a distinct test.** Reverting to `err.isNotFound` fails exactly `propagates a 404 that is not a missing bucket` (1 / 55) - the `NoSuchKey` case. Removing the clear-path entirely fails exactly `treats an already-deleted bucket as no scoped state, and still tears down every non-bucket resource` (1 / 55) - D3's recovery path still holds. Swallowing every error fails exactly `still propagates a listing failure that is NOT a missing bucket` and the `NoSuchKey` test (2 / 54) - `AccessDenied` propagation still holds. All three properties are separately pinned; none is a restatement of another.
  - *Residual, recorded not blocking:* `parseError` falls back to `code = 'Http<status>'` when an error body is empty or non-XML/JSON. A hypothetical S3-compatible endpoint reached through `--endpoint` that answered a listing with a **bodiless** 404 would now propagate where `isNotFound` (which also tests `statusCode === 404`) would have cleared - an aborted teardown. That is the safe direction the implementer's asymmetry argument names (a missed variant aborts and deletes nothing; a matched spurious 404 empties a live bucket), it is not documented behaviour of any mainstream S3 implementation, and `bucketExists`'s HEAD path (`s3.ts:52`), which genuinely does receive a bodiless 404, is a different call site and still uses `isNotFound`. Judged correct.
  - *Status:* ☑ SATISFIED

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests pass, the lint/format/dead-code gates are clean, the changeset matches what shipped.
  - *Evidence collected:* from the workspace root `/Users/ant/code/blogwright-task-16`, all six CI gates in `.github/workflows/ci.yml` order **exit 0**: `pnpm build`, `pnpm typecheck`, `pnpm test` (cli **289** across 22 files - 3 more than the prior pass's 286 - pds 96, build-agent 27, analytics, core; 0 failures), `pnpm lint` (only the pre-existing `no-shadow` warnings in the untouched `nodes.test.ts`), `pnpm exec oxfmt --check .` (142 files, "All matched files use the correct format"), `pnpm knip`.
  - *Checks - the changeset, line by line against what shipped:* `.changeset/plugin-lifecycle-verbs.md` declares `"blogwright": minor`, matching the convention of the two other cli-only changesets in the folder (`cli-help-plugin-sections.md`, `plugin-init-action.md`); the `fixed` group in `.changeset/config.json` carries the sibling packages. Paragraph 2's prior "Both … bootstrap|status|destroy" nit is CORRECTED to "All three of". Paragraph 3 now states the environment is filled in, why it matters (`DEFAULT_ENV` fallback vs `preview teardown`), and - the prior pass's third nit - that the already-gone-bucket run "**still ends in an error when the bucket node reaches the bucket that is no longer there**", which is exactly what `commands.test.ts:526` asserts (`rejects.toThrow('NoSuchBucket')` with `calls.at(-1) === 's3.deletePrefix my-bucket '`). Its "roles, log groups, CloudFront function and log-delivery trio" = 2 + 2 + 1 + 3 = the eight non-bucket AWS resources the test comment counts; the log-delivery node's `delete` (`nodes.ts:765-776`) really is a trio (delivery, source, destination), of which the fake exercises two because `findDeliveryIdBySource` answers `undefined`. No factual mismatch remains.
  - *Status:* ☑ SATISFIED

- **O7 - Reviewable: the recorded state keys prove the scoping.**
  - *Claim:* the WIDENED `Reviewable:` line shows one state key for a plugin bootstrap, only `state/<env>.json` for a site bootstrap with the same plugin installed, and BOTH teardown verbs refusing on the client.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run plugin-commands commands --reporter=verbose` passes **56/56** across both files (53 in the prior pass; the delta adds three). All four named artifacts present: (1) `expect(calls).toEqual([{get,'state/production.demo.json'},{put,'state/production.demo.json'}])`; (2) `expect([...new Set(stateKeys)]).toEqual(['state/production.json'])`; (3) `destroy --yes` → `expect(calls).toEqual(['s3.listObjects my-bucket state/'])`; (4) `preview teardown --yes` → the same single-call assertion, plus `expect(message).not.toContain('production')`.
  - *Checks - the D4 comment correction, verified independently rather than on the implementer's report:* the comment at `plugin-commands.test.ts:1268-1276` now attributes the early-exit ruling to `expect(code).toBe(0)` ("What rules an early exit out is `expect(code).toBe(0)` above") and demotes the artifact line to corroboration ("Corroboration, not proof of a full walk … what this line adds is that the graph was genuinely exercised rather than no-opped"). Its `main` premise holds: `main` contains only two `catch` blocks, both inside `helpText` (`cli.ts:215,222`) and both narrowed to help-path precondition errors, so nothing on the bootstrap dispatch path swallows a node failure. Its topological claim was re-derived here with a throwaway test run against `topoSort(buildNodes(ctx))`: the production order is `bucket, cloudfront-function, cloudfront-log-group, microvm-log-group, iam-build-role, iam-exec-role, microvm-image, oac, cloudfront-distribution, bucket-policy, cloudfront-log-delivery` - `microvm-image` is **7th of 11**, exactly as written, and the parenthetical's own listing matches term for term. The preview graph is 13, the production eleven plus `preview-dns` and `gh-oidc-role`, as `previewTeardown`'s test asserts. The scratch test was deleted; `jj st` shows the ten diff files and nothing else.
  - *Status:* ☑ SATISFIED

## Falsifiability walk

Every `it` added or touched by the diff is accounted for, each killed by at least one named
mutation. Seventeen mutations, applied singly and restored between.

| Test (new/touched) | Killed by |
| --- | --- |
| `assertNoScopedState` × site-only, empty, wrong-env | drop `key !== site`; drop env-prefix filter; drop `scopes.length === 0` return |
| `assertNoScopedState` × one scope, many scopes sorted | delete `${ctx.env}`; drop `.sort()` |
| `assertNoScopedState` × names the environment being torn down | delete `${ctx.env}`; **hardcode `production`** |
| `destroy` × refuses without `--yes` | move the guard ahead of the `--yes` check |
| `destroy` × refuses while plugin state exists | delete `${ctx.env}`; remove the guard |
| `destroy` × proceeds exactly as before | remove the guard; drop `key !== site`; drop the empty-scopes return |
| `destroy` × already-deleted bucket | remove the `NoSuchBucket` clear-path |
| `destroy` × propagates `AccessDenied` | swallow every listing failure |
| `destroy` × propagates a 404 `NoSuchKey` | revert to `err.isNotFound`; swallow every failure |
| `previewTeardown` × refuses without `--yes` | drop its `--yes` refusal |
| `previewTeardown` × refuses while plugin state exists | delete `${ctx.env}`; **hardcode `production`**; remove the guard |
| `previewTeardown` × one listObjects at the head | remove the guard; drop `key !== site`; drop the empty-scopes return |
| `runPlugin` × bootstrap / status / destroy-no-yes / destroy-yes | drop `applyGraph`; empty `readNodeStatus`; drop the `!yes` throw; drop `store.delete()` |
| `runPlugin` × **destroy `<env>` --yes (the remedy)** | drop the env positional at `plugin-commands.ts:675` |
| `runPlugin` × no-nodes plugin gains nothing | ignore `plugin.nodes` in the dispatch gate; ignore it in the listing gate |
| `runPlugin` × lists all three in the refusal; omits a declared status | drift a `GENERIC_LIFECYCLE_ACTIONS` summary; drop the `!declared.has` filter |
| `runPlugin` × declared status wins | make `matchAction` skip a declared `status`; reserve `status` |
| `discover` × rejects bootstrap/destroy (×2), never reaches dispatch | empty `RESERVED_LIFECYCLE_ACTIONS` |
| `discover` × a declared status is not a collision | reserve `status` |
| `cli.test` × lists the lifecycle verbs under a nodes plugin, none under one without | ignore `plugin.nodes` in the listing gate; drift a summary |
| `toPluginContext` × scoped store/state/save (both files) | inherited: five surface-by-surface key mutations |
| `the site's own bootstrap` × records into `state/<env>.json` only | inherited: task-53-shaped node in `buildNodes`; scoped store in `commands.bootstrap` |

No `it` in the diff is unfalsifiable, and none is vacuous on an empty collection except as noted
in the Residue.

## Regression check

- `cli.ts` `case 'bootstrap'` with a node-contributing plugin installed → same node set, same `state/<env>.json` writes : ☑ PRESERVED
- `cli.ts` `case 'destroy'` with / without a scoped object → refusal with no delete / today's teardown : ☑ PRESERVED
- `runPreview` `case 'teardown'` → the same graph teardown plus one prepended listing, proven by equivalence against the un-guarded body : ☑ PRESERVED
- `commands.ts` `status` via `render.ts`'s extracted `logStatusEntries` → output unchanged : ☑ PRESERVED (pre-existing status tests untouched and passing)
- `cli.ts:100` `renderPluginSection` → a plugin with no `nodes` rendered exactly as before : ☑ PRESERVED (whole help block asserted byte for byte)
- `nodes.ts` `buildNodes` → no plugin channel : ☑ PRESERVED (11 production / 13 preview, pinned by id list and length)
- `packages/core/src/aws/s3.ts:52` `bucketExists` and the other 30-odd `isNotFound` call sites : ☑ UNTOUCHED by the narrowing, which is local to `assertNoScopedState`

## Residue

1. **`parseError`'s `Http<status>` fallback vs the narrowing.** Recorded under O5b: an
   S3-compatible endpoint reached through `--endpoint` that answered a listing with a bodiless
   404 would now abort a teardown that `isNotFound` would have let recover. Safe direction,
   undocumented in any mainstream S3 implementation, and the deliberate trade. Worth one line in
   an endpoint-override task if one is ever opened; not a defect here.
2. `plugin-commands.test.ts:877` still uses `expect(terminal.writes.every(…)).toBe(true)`, which
   would be vacuously true on an empty array. Not vacuous as written (three writes are produced
   and asserted on immediately below) and outside this delta's scope. Carried forward unchanged.
3. Carried forward from the prior passes: whether `plugin remove` should offer to run the
   plugin's teardown first (task 20); task 47's command table must be re-read against the
   precedence fixed here; and whether a plugin verb should run when the site has never been
   bootstrapped is not covered by the DoD.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All obligations are SATISFIED, including the corrected O5 and the widened O7. The
delta's repair was verified by execution, not by reading: deleting `${ctx.env}` fails five tests
because the pins assert the whole command line rather than the scope name, hardcoding
`production` - the shape of the original defect - fails exactly the two preview cases while every
production-only assertion still passes, and dropping the env positional at
`plugin-commands.ts:675` fails the new test on the observed S3 keys, closing the loop from
printed remedy to dispatched environment. The runnability chain was checked link by link:
`deriveNames` reads `env` alone, the state-key scope is the same token `runPlugin` dispatches on,
and `SCOPE_PATTERN` forbids a scope that would not parse back. The narrowing to `NoSuchBucket`
is justified against the AWS `ListObjectsV2` reference, which documents that single error for the
operation, and its three properties - recovery, `AccessDenied` propagation, `NoSuchKey`
propagation - are each pinned by a distinct test. The D4 comment now attributes the early-exit
ruling to `expect(code).toBe(0)` and the artifact to corroboration, and its topological claim
(`microvm-image` 7th of 11) was re-derived here rather than taken on trust. Every repo gate exits
0, the widened `Reviewable:` line passes 56/56 showing all four artifacts, the changeset matches
what shipped, and all seventeen mutations were restored - the post-mutation `jj diff --git` is
byte-identical to the pre-mutation capture.
