# Done Certificate - Task 25: Export a Plugin from blogwright-pds wrapping the six existing pds commands

**Task:** [25-pds_plugin_export.md](25-pds_plugin_export.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 25. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

Discharged against workspace `/Users/ant/code/blogwright-task-25` (`nwwwlwzy 6e9bbb78`, parent
`build(41/62)`), bookmark `plugin-system-and-analytics` at build 42. Diff is three files:
`packages/pds/src/index.ts` (M), `packages/pds/src/plugin.ts` (A), `packages/pds/src/plugin.test.ts` (A).
Every mutation applied during discharge was reverted; the working-copy `jj diff --git` was captured
before the first mutation and re-diffed after the last, byte-identical.

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
  - *Evidence collected:* `packages/pds/src/index.ts:15` adds `export { default } from './plugin.js';` beside the untouched `export * from './commands.js'` and the `PdsContext`/`PdsLogger`/`PdsPorts` type re-export. `packages/pds/src/plugin.ts:173-183` builds the object; `:190` is `const pdsPlugin: Plugin<PdsConfig> = createPdsPlugin();` and `:192` default-exports it. `packages/pds/src/commands.ts` is **not in the change set** (`jj diff --stat` lists three files, none of them `commands.ts`), so no signature moved. Test `satisfies core's Plugin contract as a package default export` runs core's `validatePlugin({ default: plugin }, 'blogwright-pds')` and asserts it returns the same object; `claims the pds namespace and owns the pds config key` pins `name`/`configKey`; `rejects a bad block with the message core raises for it today` asserts the thrown text is exactly `config.pds.name is required`, task 21's string.
  - *Checks run:* against the **built** package from `packages/cli`, `m.default.validateConfig === (await import('.../pds/dist/config.js')).validatePdsConfig` → `true`, so `validateConfig` is the imported function itself, not a re-implementation. Mutation M-I (an inline re-implementation raising the identical message) and M-Q/M-R (a permissive validator, and one that validates then returns `{}`) each redden the identity test plus one behavioural test - 1, 2 and 2 failures respectively.
  - *Status:* ☑ SATISFIED

- **O2 - Exactly six declared actions, each summarised, with `init` bound to publication setup.**
  - *Claim:* `plugin.commands` declares `keygen`, `login`, `init`, `sync`, `secret status` and `secret delete` - no more, no fewer - each with a non-empty `summary`, and the plugin declares no `init` config contributor, so the `init` action resolves to `commands.init`.
  - *Evidence collected:* `declares exactly the six actions runPds accepts today` compares `plugin.commands.map(c => c.action)` against a locally spelled-out `RUNPDS_ACTIONS` constant, not against the plugin itself; the order matches `runPds`'s own `known` set (`packages/cli/src/cli.ts:190`) exactly. `gives every declared action a non-empty summary` pins both the trimmed summaries and the length. `declares none of the generic lifecycle verbs` asserts `bootstrap`/`status`/`destroy` are absent. `reaches the publication-setup init, not a config contributor` runs the **real** `init` and asserts `pds init requires a configured domain` - the refusal only `commands.init` raises.
  - *Checks run:* `plugin.init` resolves to `undefined` on the built package (`JSON.stringify` omits it; `expect(plugin.init).toBeUndefined()` passes). Mutation M-J (a declared `bootstrap`) reddens three tests including the lifecycle one; M-K (an added `init?(io)` contributor) reddens the contributor test; M-N (a whitespace summary) reddens the summary test; M-W (the `init` wrapper calling `fns.keygen`) reddens both the double test and the real-path init test.
  - *Order pin, judged:* `renderPluginSection` (`packages/cli/src/cli.ts:102-112`) maps `plugin.commands` in **declaration order** with no sort, so declaration order is observable `--help` output, not an internal detail; the pinned order is also the order the DoD itself spells and the order of `runPds`'s `known` set. The isolated swap (M-C, `init`↔`sync`) reddens **exactly one** test. The pin is right, not over-tight. One cosmetic note, not a defect: the static `USAGE` pds block (`cli.ts:50-63`) lists `secret status`/`secret delete` before `init`/`sync`, so once task 26 strips that block the rendered order changes; the six strings and their meanings do not.
  - *Status:* ☑ SATISFIED

- **O3 - Argument pass-through pinned on the success path.**
  - *Claim:* `secret delete --yes` reaches `secretDelete` with `yes` true; `secret delete` without `--yes` yields `refusing to delete secret "…" without --yes`; `login --identifier alice.example` reaches `login` with that identifier; `login` without one yields `pds login requires --identifier <handle-or-did>`.
  - *Evidence collected:* all four cases present, plus a fifth (`--identifier` placed between other forwarded flags) and a sixth (routing the four flagless actions). The two success cases assert on **recorded arguments**: `expect(calls).toEqual([{ fn: 'secretDelete', ctx, opts: { yes: true } }])` and `…{ fn: 'login', ctx, opts: { identifier: 'alice.example' } }` - the recording double captures both the context identity and the options object. The real-path success cases assert on the recording Secrets Manager client's transcript: `expect(secretCalls).toEqual([{ op: 'deleteSecret', name: 'example/atproto' }])` and `[{ op: 'describeSecret', … }]`, never "did not throw".
  - *Checks run:* Mutation M-H (making `secret delete`'s `run` an awaited no-op) reddens **four** tests, including both real-path secretDelete cases - proving the success paths assert on transcripts, not on absence of a throw. M-B (`yes: true` hardcoded) reddens one double and one real-path test. M-A (`args[index]` instead of `args[index + 1]`) reddens the two `--identifier` double tests. M-S (`flagValue` returning `''` for an absent flag) reddens the undefined-identifier double test in isolation.
  - *Recorded discrepancy (non-blocking):* the implementer's sweep note claims **each** flag mutation reddens both a double test and a real-path test. Measured, that holds for `--yes` (M-B) but **not** for `--identifier` by index (M-A: two double tests, zero real-path tests). The real path cannot see it - with `identifier` set to the literal `'--identifier'` the command's refusal never fires and execution reaches `oauthLogin`, whose first act is `verifyClientAssets`. This is the same limitation the seam exists for (see the test-seam finding below); the DoD and this obligation both accept a recording double for the success case, which is what is there.
  - *Status:* ☑ SATISFIED

- **O4 - No cast at the context boundary, no `process.argv`, no CLI change.**
  - *Claim:* each command's `run` takes the plugin context by plain assignment, parses its flags from the supplied arguments, and this task changes no file under `packages/cli/src`.
  - *Evidence collected:* `grep -rnE "as PdsContext|as unknown as|process\.argv" packages/pds/src/plugin.ts` → no hits. `grep -nE "\bas \b"` on the same file hits only four prose lines inside doc comments. `grep -rn "process.argv" packages/pds/src/` → no hits anywhere in the package. `jj diff --stat packages/cli` → `0 files changed`, so `EXPECTED_USAGE` (`cli.test.ts:51`), `buildHelp`'s plugin section and `commands.test.ts`'s call sequences are untouched by construction.
  - *Checks run:* `pnpm -r typecheck` (which includes the test files) is clean, so `fns.keygen(ctx)` with `ctx: PluginContext<PdsConfig>` against `keygen(ctx: PdsContext, …)` is a compiler-checked ordinary assignment, not a silenced one. `packages/cli` tests: 22 files, 346 tests, all passing - `runPds` behaviour unaffected. `pds` remains absent from `RESERVED_COMMANDS` (`known-commands.ts`), pinned by `plugins.test.ts:612` and `cli.test.ts:1219-1220`, both green - so task 26's manifest field will not be rejected at discovery.
  - *Status:* ☑ SATISFIED

- **O5 - The node contributor is declared and returns task 23's node.**
  - *Claim:* `plugin.nodes(ctx)` returns exactly `buildPdsNodes(ctx)` - the single `pds-oidc-policy` node - with no wrapper filtering or re-ordering it.
  - *Evidence collected:* `packages/pds/src/plugin.ts:181` is `nodes: buildPdsNodes,` - the imported function itself. Test `is buildPdsNodes itself - nothing wraps, filters or re-orders it` asserts `plugin.nodes === buildPdsNodes` by reference; confirmed on the **built** package too (`m.default.nodes === (await import('.../pds/dist/nodes.js')).buildPdsNodes` → `true`). Two behavioural tests back it: the configured site returns `['pds-oidc-policy']` and the same ids `buildPdsNodes(ctx)` returns; the unconfigured site returns `[]`.
  - *Checks run:* `nodes` is declared on `Plugin<PdsConfig>` as `(ctx: PluginContext<PdsConfig>) => ResourceNode[]` and `buildPdsNodes` takes the full `PluginContext<PdsConfig>`, not the narrowed `PdsContext`; typecheck is clean, and the method-declared bivariance core documents is what makes `PdsNode[]` assignable. `packages/pds/src/nodes.ts` is **not in the change set** - `jj status` lists three files, none of them `nodes.ts`, and its SHA-256 is unchanged from the pristine capture - so task 23's three-way skip (`!pds || !githubRepo || ctx.env === 'preview'`) and its `expect(ctx.preview).toBe(false)` guard at `nodes.test.ts:279` are structurally intact.
  - *Wrapper-escalation check (the parent's M24):* mutation M-E replaced `nodes: buildPdsNodes` with `nodes: (ctx) => buildPdsNodes({ ...ctx, env: 'preview' })` - a wrapper that mutates the context before delegating, which is exactly the privilege-escalation shape task 23's preview skip exists to prevent. It reddens **two** tests: the reference-identity test and the behavioural `returns task 23's single deploy-role grant` test. So the escalation is caught even if the identity assertion were later "simplified" away. M-D (a behaviour-preserving arrow wrapper) reddens the identity test alone; M-X (a wrapper injecting a `pds` block for a site that has none) reddens identity plus the empty-contribution test.
  - *Status:* ☑ SATISFIED

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected, all run from the workspace root:*
    - `pnpm build` → exit 0, every package including `packages/cli`.
    - `pnpm test` → core 149 passed / 1 skipped, build-agent 27, **pds 145 in 12 files**, analytics 440, cli 346 in 22 files. No failures anywhere.
    - `pnpm lint` → exit 0. `packages/pds lint: Done` with no diagnostics; the only output is pre-existing `no-shadow` **warnings** in `packages/cli/src/nodes.test.ts`, a file this task does not touch.
    - `pnpm exec oxfmt --check .` → `All matched files use the correct format.` (176 files).
    - `pnpm knip` → exit 0, no output; no unused-export complaint about `createPdsPlugin`, `PdsCommandFunctions` or the new default export.
    - `pnpm -r typecheck` (CI's extra gate) → exit 0 across all six projects.
    - `packages/pds/src/rkey.test.ts` re-run in isolation → 10 tests passed, pinned vectors unchanged.
  - *Named constants:* `PDS_NAMESPACE`, `PDS_CONFIG_KEY`, `PDS_DESCRIPTION`, `IDENTIFIER_FLAG`, `YES_FLAG` - no literal appears twice.
  - *Changeset:* none, and that is correct. The plugin is inert (no `blogwright.plugin` field in `packages/pds/package.json`, verified); task 23's `.changeset/pds-owns-its-deploy-role-grant.md` already states *"the plugin export that returns it lands separately"*; and task 20's in-flight `.changeset/plugin-system.md` states the SPI *"is internal and unversioned … not a public contract"*. `createPdsPlugin` is deliberately **not** re-exported from `index.ts`, so the published surface gains exactly one name (`default`) and no test seam - confirmed against the built package, whose exports are `['default','init','keygen','login','secretDelete','secretStatus','sync','syncAfterDeploy']`.
  - *Status:* ☑ SATISFIED

- **O7 - Reviewable: the six actions and the surviving named exports (Reviewable).**
  - *Claim:* a reviewer can run the plugin tests in `packages/pds` and inspect the built package's exports, observing the six actions and every pre-existing named export.
  - *Evidence collected:* `pnpm --filter blogwright-pds exec vitest run plugin --reporter=verbose` from `packages/pds` → **28 passed (28)**, 1 file, exactly as the task's `Reviewable:` line spells it. Against the **built** package from `packages/cli`:
    `node -e "import('blogwright-pds').then(m => console.log(m.default.name, m.default.commands.map(c => c.action), Object.keys(m)))"` →
    `pds` · `['keygen','login','init','sync','secret status','secret delete']` ·
    `['default','init','keygen','login','secretDelete','secretStatus','sync','syncAfterDeploy']`.
    All six declared actions present in the declared order; all seven pre-existing named exports present, and identity-checked against `dist/commands.js` (`m.keygen === cmdMod.keygen`, `m.syncAfterDeploy === cmdMod.syncAfterDeploy` → `true`).
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/commands.ts:2` imports `syncAfterDeploy` from `blogwright-pds` → resolves unchanged; built package exports it as the same function object as `dist/commands.js`; `pnpm build`, `pnpm -r typecheck` and 346 cli tests all green : ☑ **PRESERVED**
- `packages/cli/src/cli.ts:10` namespace-imports `blogwright-pds` and `:213-229` calls all six through it → all six still resolve on the built package; `runPds` source unchanged (`jj diff --stat packages/cli` → 0 files) : ☑ **PRESERVED**
- `packages/cli/src/rkey.ts:7` re-exports `blogwright-pds/rkey` → subpath resolves with its four exports (`documentUri`, `extractDate`, `postPath`, `tidFromPath`); `rkey.test.ts` 10/10 : ☑ **PRESERVED**
- `packages/pds/src/nodes.ts` (task 23) → not in the change set; SHA-256 identical to pristine; `nodes.test.ts`'s `ctx.preview === false` guard intact : ☑ **PRESERVED**

## Falsifiability audit (validator's own sweep, independent of the implementer's table)

21 mutations applied one at a time from a proven-green control, each reverted and hash-checked before
the next. Every one of the 28 tests fell into at least one kill set, verified by the validator rather
than accepted from the report: M-A (identifier index, 2), M-B (`yes` hardcoded, 2), M-C (action order
swap, **1**), M-D (nodes arrow wrapper, 1), M-E (nodes wrapper mutating `ctx.env`, 2), M-F (default
table `secretStatus`→`secretDelete`, 1), M-G (default table `login`→`init`, 1), M-H (`secret delete`
no-op, 4), M-I (validator re-implemented, 1), M-J (declared `bootstrap`, 3), M-K (`init` contributor,
1), M-L (index drops the default re-export, 1), M-M (multi-line description, 1), M-N (blank summary,
1), M-O (namespace renamed, 1), M-Q (permissive validator, 2), M-R (validator returning `{}`, 2),
M-S (`flagValue` returning `''`, 1), M-T (`sync` wrapper→`secretStatus`, 2), M-U (empty description,
2), M-V (default table `keygen`→`sync`, 1), M-W (`init` wrapper→`keygen`, 2), M-X (nodes wrapper
injecting a block, 2), M-Y (index drops `keygen`, 1). One survivor: **M-P** - a wrapper passing an
extra positional (`fns.keygen(ctx, '/repo')`) survives all 28 tests, because the recording doubles
ignore extra arguments and the real path's refusal fires before `repoRoot` is read. Nothing in the
DoD requires that pin and the wrappers as written pass only `ctx`; recorded as residue.

Fixture integrity confirmed as specified: `createClients({ …, credentials: staticCredentials(…),
transport: rejectAllTransport })` builds **real** core clients (`IamClient`, `S3Client`, … per
`packages/core/src/clients.ts:52-82`) over a transport that throws `unexpected AWS request in test`,
and the recording Secrets Manager client is `Object.create(base.secrets)` with only `describeSecret`
and `deleteSecret` overridden - so `getSecretValue`/`putSecretValue` delegate to the real client and
hit the rejecting transport. No `vi.mock`/`vi.spyOn` anywhere in `packages/pds/src` (grep), so
DEVELOPMENT.md §Hexagonal architecture's ban on module patching holds.

## Test-seam judgement (`createPdsPlugin(fns = pdsCommandFunctions)`)

The account is **verified and correct**. `commands.login(ctx, opts, runLogin = oauthLogin)` refuses on
`!opts.identifier` and otherwise calls `oauthLogin`, whose very first statement is
`await (deps.verifyAssets ?? verifyClientAssets)(ctx)` (`packages/pds/src/oauth.ts:167`); the
identifier is not touched until `flow.authorize(identifier)` at `:173`, four awaits later and behind
a real client key, two global-`fetch` document comparisons and an OAuth client build. So no port can
observe what `login` was handed - only *that* it was reached. `commands.ts` already uses this exact
default-parameter seam for `generateClientKey` (`:34`), `oauthLogin` (`:71`), `openPdsRepo` and
`verifyClientAssets` (`:120-121`), so the shape is the package's own precedent, not a new one.
Production never supplies the parameter: the only non-test call is `createPdsPlugin()` at
`plugin.ts:190`, and `grep -rn createPdsPlugin packages/` outside `dist/` finds callers only in
`plugin.test.ts`. Critically, the seam does **not** create a blind spot about which functions the
default export is built over: mutations M-F, M-G and M-V each mis-wire one entry of
`pdsCommandFunctions` and are each killed by the `default export runs the real command functions`
suite, which the doubles never touch.

## Residue

Two failure modes look like success here, and both are closed. A refusal-path-only test would pass
whether or not `--yes` was wired - closed by M-H, which shows the success assertions read the
recording client's transcript. A generic `init` contributor would let task 13's
`blogwright <plugin> init` shadow publication setup - closed by the `plugin.init` check (M-K).

Open residue, none blocking: (a) M-P above; (b) the test named *"describes the secret and never reads
its value"* is weaker than its name - the recorded `describeSecret` returns `undefined`, so
`secretStatus` short-circuits at `if (!meta)` and never reaches `loadPdsSecret` for reasons of the
fixture rather than of the command's discipline (the transcript assertion it makes is still exact);
(c) whether the one-line `description` preserves the operational guidance in the current multi-line
`pds login`/`pds sync` help text - task 29 owns that, per the authored certificate.

## Cross-task defect found and confirmed (routed, not fixed here)

`validatePdsConfig(undefined)` throws `TypeError: Cannot read properties of undefined (reading 'name')`
- reproduced by the validator against the **built** package. `packages/pds/src/config.ts:56` does
`const cfg = raw as PdsConfig; if (!cfg.name?.trim())`, and `resolvePluginConfig`
(`packages/cli/src/plugins.ts:655-670`) calls a plugin's validator **with `undefined` when the block
is absent** - documented there as deliberate, and promised in task 19's shipped changeset text
(*"The validator is also called when the config file carries no block for that plugin at all, with
nothing"*). Routing the fix to task 28 (which owns pds config validation leaving core) is right; not
fixing `config.ts` in task 25 is right - it is task 21's file and outside this task's scope.

**The reachability timing in the implementer's note is wrong at the call site it names.**
`plugin-commands.ts:1097` sits inside `destroyBeforeRemoval`, reached from `runPluginRemove` via
`loadPluginForRemoval`, which resolves and loads the package **directly through the `ModuleLoader`
port and never through `discover`** (its own doc comment says so explicitly). It therefore never
consults the `blogwright.plugin` manifest field, so task 26's manifest field is *not* the gate on that
path; `isDeclaredDependency` is. Concretely, at build 42 with this task merged:
`blogwright plugin add pds` (no name gate - `resolvePluginPackage('pds')` → `blogwright-pds`, which
passes `PACKAGE_NAME_PATTERN`) declares the package, then `blogwright plugin remove pds` in an
interactive session, answered "yes" to teardown, on a repo whose config carries no `pds` block, reaches
`validatePdsConfig(undefined)` and fails with
`plugin "pds" rejected the "pds" config block: Cannot read properties of undefined (reading 'name')`,
leaving the package installed. Before this diff the same path stopped at `validatePlugin` ("has no
default export") and silently skipped teardown - so **this task is what opens it**, one task earlier
than reported. Impact is a confusing message and a refused teardown on a contrived sequence; no data
loss, no security consequence. Consequence for the build: task 28 must not be allowed to slip on the
assumption the defect stays dormant until task 26.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All seven obligations are satisfied with collected evidence - six actions in `runPds`'s own
order with `--help`-observable ordering, flags parsed from the SPI's `args` with no `process.argv` and
no cast, `nodes` and `validateConfig` bound to task 23's and task 21's functions by reference (verified
on the built package), zero files changed under `packages/cli/src`, and all six repo gates plus
`typecheck` clean - and an independent 21-mutation sweep put every one of the 28 tests in a kill set,
so the task is DONE with one already-routed cross-task defect (`validatePdsConfig(undefined)`) whose
live-date this validation corrects from task 26 to task 25.
