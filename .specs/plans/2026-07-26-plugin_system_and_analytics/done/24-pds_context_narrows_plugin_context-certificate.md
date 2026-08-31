# Done Certificate - Task 24: Redefine PdsContext as a narrowing of core's PluginContext

**Task:** [24-pds_context_narrows_plugin_context.md](24-pds_context_narrows_plugin_context.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 24. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 24) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `PdsContext` is expressed as a narrowing of core's `PluginContext`, with `PdsLogger`/`PdsPorts` as aliases of the core types, and an explicit compile-time assignability test replaces the implicit proof `runPds` provides today.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break every `PdsContext` consumer in `packages/pds` (`commands.ts`, `oauth.ts`, `secret.ts`, `sync.ts`, `content.ts`, `client-metadata.ts`), the `packages/pds/src/index.ts:8` type re-exports, or the CLI's ability to pass `OpsContext` straight into a pds function.

**Validation workspace:** `/Users/ant/code/blogwright-task-24` @ `zsyvnxxl 947b454f`, parent `lquvlrxx 87513f2c`.
All probes were reverted and `blogwright-pds` was rebuilt to its shipped state; post-validation
`jj status` shows the same two modified files, byte-identical (md5 `04ca6fb8…` / `d49f4eee…`).

## Obligations

- **O1 - No structural duplication, and the change is type-only.**
  - *Claim:* `packages/pds/src/context.ts` contains no re-declaration of core's logger or ports field shapes; `PdsLogger` and `PdsPorts` resolve to the core types and `PdsContext` is derived from `PluginContext`, narrowed to `{ secrets }` and the `fs`/`terminal` ports; no runtime file in `packages/pds/src` changed.
  - *Evidence collected:* `packages/pds/src/context.ts` holds exactly three declarations - `export type PdsLogger = PluginLogger` (`:17`), `export type PdsPorts = PluginPorts` (`:20`), and `export interface PdsContext extends Pick<PluginContext<PdsConfig>, …> { clients: { secrets: SecretsManagerClient } }` (`:48-52`). Both former interface bodies are gone. `jj diff --stat` reports exactly two changed files: `packages/pds/src/context.ts` (+45/-26) and `packages/cli/src/context.test.ts` (+22/-0). No module that emits runtime code was touched; `context.ts` is a pure type module and its emit is `export {}` (`packages/pds/dist/context.js`).
  - *Checks run:* a scratch compiled probe (`packages/pds/src/zz-probe.ts`, since deleted) asserted `Exact<PdsLogger, OldPdsLogger>`, `Exact<PdsPorts, OldPdsPorts>` and `Exact<keyof PdsPorts, 'fs' | 'terminal'>` against verbatim copies of the pre-change interfaces; `tsc -p tsconfig.typecheck.json` in `packages/pds` compiled it with zero diagnostics. The aliases are literal `type X = CoreType`, so resolution is by identity, not coincidence.
  - *Status:* ☑ SATISFIED

- **O2 - The package imports nothing from the CLI.**
  - *Claim:* `packages/pds` imports no type or value from `packages/cli`.
  - *Evidence collected:* `grep -rn "from 'blogwright" packages/pds/src --include=*.ts` returns eleven hits, every one `'blogwright-core'`; filtering out `blogwright-core` leaves zero lines. `grep -rn "\.\./\.\./cli\|from '\.\./\.\./" packages/pds/src` returns nothing. The module comment at `context.ts:1-5` still states the package never imports CLI types, and now also states the type is a narrowing of core's `PluginContext`.
  - *Status:* ☑ SATISFIED

- **O3 - The assignability proof is explicit and load-bearing.**
  - *Claim:* a compile-time test in the CLI asserts `OpsContext` satisfies `PdsContext` by plain assignment, and it would fail the build if the narrowing widened.
  - *Evidence collected:* `packages/cli/src/context.test.ts:194-200` - `const ops = createTestContext(); const pdsCtx: PdsContext = ops;` - a plain annotated assignment, no cast and no `satisfies`. `createTestContext` (`packages/cli/src/test-support.ts:205`) has an explicit `OpsContext` return type, so the right-hand side is not a fresh object literal and no excess-property check is doing the work; the assignment is genuine width-subtyping.
  - *Checks run:* the `PdsContext` symbol is imported from `'blogwright-pds'` (`context.test.ts:9`), which resolves through the package `exports` to `dist/index.d.ts` → the `index.ts:8` re-export, i.e. the public surface, not a local shape. `packages/cli/tsconfig.typecheck.json` sets `"exclude": []`, so `*.test.ts` **is** covered by `pnpm typecheck` (vitest does not typecheck, so this is the gate that matters). Deliberate break: adding `'pluginConfig'` to the `Pick` and rebuilding `blogwright-pds` produced `src/context.test.ts(197,11): error TS2741: Property 'pluginConfig' is missing in type 'OpsContext' but required in type 'PdsContext'.` That diagnostic is emitted at the test's own site, independently of the `cli.ts`/`commands.ts` ones, so it keeps earning its keep once task 29 deletes `runPds`. Reverted; `tsc` clean again.
  - *Status:* ☑ SATISFIED

- **O4 - The narrowing is a `Pick`, and the six fields the dispatch boundary builds are outside it.**
  - *Claim:* `PdsContext` is written as a `Pick` over `PluginContext<PdsConfig>` rather than an `Omit`, it names none of `pluginConfig`, `state`, `siteState`, `store` or `record`, and `packages/cli/src/commands.ts:97` still passes its plain `OpsContext` to `syncAfterDeploy` with no adaptation.
  - *Evidence collected:* the declaration is `Pick<PluginContext<PdsConfig>, 'env' | 'domain' | 'config' | 'ports' | 'logger' | 'tags'>` with `clients: { secrets: SecretsManagerClient }` narrowed in the interface body - `Pick`, never `Omit`, and the list names none of the five. Per the DoD's 2026-08-29 amendment this was checked against the **`Pick` list itself**, not by whole-file grep. The doc comment (`context.ts:22-47`) names all nine non-picked members plainly - `preview`, `names`, `accountId` as host surface pds never needed, and `pluginConfig`, `state`, `store`, `siteState`, `record()`, `save()` as dispatch-boundary members no pds command function runs behind - which is what the amendment asked for.
  - *Checks run:* (a) the compiled probe proved `Exact<keyof PdsContext, keyof OldPdsContext>` is `true`, that the pre-change interface and `PdsContext` are mutually assignable, that `tags` is still optional (`{} extends Pick<PdsContext,'tags'>`), and that `env`/`domain`/`config`/`clients`/`ports`/`logger` each resolve to the exact pre-change type - so the member set is **exactly seven**, no more and no fewer. (b) Negative control: adding `'preview'` to the `Pick` broke `Exact<keyof …>` with `TS2322` and the old→new assignment with `TS2741`, confirming the probe discriminates rather than passing vacuously. (c) `pluginConfig` probe (added to the `Pick`, `pnpm --filter blogwright-pds build`, then `tsc` in `packages/cli`) reproduced the implementer's claim exactly:
    - `src/commands.ts(97,25): error TS2345: Argument of type 'OpsContext' is not assignable to parameter of type 'PdsContext'.` → `Property 'pluginConfig' is missing in type 'OpsContext' but required in type 'PdsContext'.`
    - plus the same `TS2345` at `src/cli.ts` `226,24 / 229,23 / 232,30 / 235,30 / 238,22 / 241,22` (the six `pds.*` calls),
    - and `src/context.test.ts(197,11): error TS2741` at the new assertion.
    The argument-position code is `TS2345` and the bare-assignment one `TS2741`, as the certificate predicted. The rebuild step was necessary and is confirmed load-bearing: `blogwright`'s typecheck resolves `blogwright-pds` through `dist/index.d.ts`; CI runs `pnpm build` before `pnpm typecheck` (`.github/workflows/ci.yml:21-22`), so the gate is sound in CI too. Reverted and rebuilt.
  - *Status:* ☑ SATISFIED

- **O5 - The pds test factory stays cheap.**
  - *Claim:* `createTestContext` in `packages/pds/src/test-support.ts:96` still returns a complete `PdsContext` while constructing only a secrets client, an in-memory `FileSystem`, a silent `Terminal`, and a logger - no full `AwsClients` set, no `StateStore`.
  - *Evidence collected:* `packages/pds/src/test-support.ts` is not in the diff - untouched. `:96-108` returns `{ env, domain, config, clients: { secrets: testSecrets(…) }, ports: { fs: memory, terminal: silent }, logger }`: no `Names`, no `StateStore`, no `accountId`, no `preview`, no `save`. It compiles under `packages/pds`'s typecheck (which, with `"exclude": []`, includes it). `packages/pds/src/test-support.test.ts` (7 cases) and all 85 pds tests pass.
  - *Checks run:* the `preview` negative control produced `src/test-support.ts(98,3): error TS2741: Property 'preview' is missing in type '{ env … logger }' but required in type 'PdsContext'` - direct proof that the factory is a live gate against over-picking, not merely incidentally still compiling.
  - *Status:* ☑ SATISFIED

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six gates run from the repo root at the validated revision:
    - `pnpm build` - clean (core, pds, build-agent, cli, docs).
    - `pnpm typecheck` - clean, 4 projects.
    - `pnpm test` - core 123 passed / 1 skipped, pds 85 passed, build-agent 27 passed, cli 174 passed; 0 failures.
    - `pnpm lint` - exit 0. The 25 `eslint(no-shadow)` warnings are all in `packages/cli/src/nodes.test.ts`, a file this diff does not touch; they are pre-existing on the parent.
    - `pnpm exec oxfmt --check .` - "All matched files use the correct format", 130 files.
    - `pnpm knip` - exit 0, no output.
    - Pinned rkey vectors (`packages/pds/src/rkey.test.ts`) are inside the 85 passing pds tests.
    - No changeset: `DEVELOPMENT.md:320` exempts internal-only refactors, and the probe proved the two exported types (`PdsLogger`, `PdsPorts`) are shape-identical to what shipped, so there is no semver impact on `blogwright-pds`'s public surface.
  - *Status:* ☑ SATISFIED

- **O7 - Reviewable: `pnpm typecheck && pnpm test` with an unchanged test count plus one (Reviewable).**
  - *Claim:* a reviewer can run `pnpm typecheck && pnpm test` from the repo root and observe the same tests as before plus the new assignability test, then read `packages/pds/src/context.ts` and see three declarations with no repeated field shapes.
  - *Evidence collected:* the `Reviewable:` line was run verbatim from the repo root and exited 0. CLI totals 174; the base version of `packages/cli/src/context.test.ts` has 10 `it(` cases and the new one has 11, and no other test file changed - so the delta is exactly the one new assignability test (base cli total 173). `packages/pds/src/context.ts` holds three declarations, and no field shape is written twice: the logger and ports bodies are gone, `clients` is a one-member narrowing over the imported `SecretsManagerClient`, and every other member's type is inherited from `PluginContext`.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/commands.ts:97` calls `syncAfterDeploy(ctx)` with an `OpsContext` → typechecks by plain assignment, no cast; traced through `syncAfterDeploy` (`packages/pds/src/commands.ts:204-223`), which reads `ctx.env`, `ctx.config.pds`, `ctx.ports.fs`, `ctx.logger.{info,step,warn}` and hands `ctx` to `syncPds` → `openPdsRepo` → `ctx.clients.secrets`; every one of those member types was proved identical to its pre-change type : ☑ PRESERVED
- `packages/pds/src/oauth.ts:43` (`buildClient`) reads `ctx.clients.secrets` (`:57`) from a `PdsContext`; `ctx.ports.terminal.question` is read at `packages/pds/src/commands.ts:77` → both present and identically typed after the narrowing (`PluginPorts` is exactly `{ fs: FileSystem; terminal: Terminal }`, and `AwsClients.secrets` is `SecretsManagerClient`, so the narrowing is a true subtype) : ☑ PRESERVED
- `packages/pds/src/commands.ts:57` calls `ctx.ports.fs.writeText(...)` → `FileSystem` port surface unchanged; core's `PluginPorts.fs` is the same `FileSystem` the old `PdsPorts.fs` named : ☑ PRESERVED
- Every other `PdsContext`/`PdsLogger`/`PdsPorts` consumer swept: `oauth.ts` (6 sites), `commands.ts` (8), `secret.ts`, `sync.ts` (3), `content.ts`, `client-metadata.ts`, `index.ts:8`, `test-support.ts` (3), and the five pds test files including `commands.test.ts:204`'s mutable `c.ports.terminal = terminal` write - all compile and pass : ☑ PRESERVED

## Residue

Three observations, none defects:

1. The doc comment forward-references `nodes.ts` as "the plugin's one resource node", but `packages/pds/src/nodes.ts` does not exist at this revision - task 23 (`backlog/23-pds_inline_policy_node.md`) creates it. The task contract's step 3 explicitly directed this forward reference; it resolves when the plan lands, and a reader of the merged tree will find the file.
2. `clients: { secrets: SecretsManagerClient }` restates the member type rather than deriving it (`Pick<PluginContext<PdsConfig>['clients'], 'secrets'>`). If core ever retyped `AwsClients.secrets`, `PdsContext` would silently diverge from `PluginContext` - but the new assignability test in `packages/cli/src/context.test.ts` is exactly the gate that would catch it, so the risk is covered by O3 rather than by the declaration.
3. `PdsLogger`/`PdsPorts` change from `interface` to `type` alias, so a downstream consumer can no longer reopen them by declaration merging or module augmentation. Nothing in or out of this repo does; the shapes are provably identical, so this is not a semver-visible break.

The certificate's own residue note held up: O3 could have passed vacuously today, since `cli.ts:226` and `commands.ts:97` still prove assignability implicitly. It was therefore discharged by the deliberate-break procedure, and the `TS2741` at `context.test.ts:197` is emitted at the test's own site, independent of those two - so it will still fail the build after task 29.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All seven obligations are SATISFIED with collected evidence - a compiled probe proves `PdsContext` has exactly its seven pre-change members with identical types and `tags` still optional, the `Pick` list names none of the dispatch-boundary six, the deliberate-break probe reproduced the predicted `TS2345` at `commands.ts:97` and `TS2741` at the new CLI assignability test, `createTestContext` is untouched and demonstrably still gates over-picking, and all six repo gates plus the `Reviewable:` line run clean with the CLI test count up by exactly one.
