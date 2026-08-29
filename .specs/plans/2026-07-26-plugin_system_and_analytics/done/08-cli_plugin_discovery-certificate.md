# Done Certificate - Task 08: Discover installed plugins from the consuming repo and from the CLI's own bundle

**Task:** [08-cli_plugin_discovery.md](08-cli_plugin_discovery.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 08. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 08) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `discover(repoRoot, cliPackageDir, ports)` in a new `packages/cli/src/plugins.ts` returns loaded plugins and load failures for both consumer-installed and CLI-bundled plugin packages, each resolved from its own directory.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the `Ports` contract in `packages/cli/src/ports.ts:24-29` or core's boundary validator `validatePlugin` (`packages/core/src/plugin.ts`, task 03), and must add no new import that the root `.oxlintrc.json` `no-restricted-imports` rule would reject in a domain module.

## Obligations

- **O1 - Reading and filtering the consumer manifest.**
  - *Claim:* `<repoRoot>/package.json` is read through `ports.fs`, absence and unparseability raise errors naming the path and the fix, and only `blogwright-*` names from `dependencies` and `devDependencies` become candidates.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run plugins --reporter=verbose` - 14/14 pass, including the three `discover - repo-level preconditions` cases and `never resolves a non-matching dependency name through the loader`, which asserts `loader.resolveCalls` and `loader.packageJsonPathForCalls` are both `[]` for `some-lib`/`react`/`another-lib`. `pluginDependencyNames` (`packages/cli/src/plugins.ts:139-148`) iterates `[pkg.dependencies, pkg.devDependencies]`, covered by `considers both dependencies and devDependencies, filtered to the blogwright- prefix`.
  - *Checks run:* the read at the top of `discover` is `ports.fs.readText` inside `readDependencyManifest` (`plugins.ts:110`); no `node:fs` import exists in the module (`grep -n "^import" packages/cli/src/plugins.ts` yields only `node:path`, `blogwright-core`, `./ports.js`). The `FileNotFoundError` branch is the one taken, not a catch-all: a probe run against `createMemoryFileSystem` produced `no package.json found at /repo/package.json for the consuming repo - plugin discovery reads its "dependencies"/"devDependencies" to find installed blogwright-* plugins; create one there.` with `cause = FileNotFoundError: file not found: /repo/package.json`.
  - *Status:* ☑ SATISFIED

- **O2 - Bundled plugins are discovered.**
  - *Claim:* a plugin shipped as a dependency of `blogwright` itself is discovered from a consumer `package.json` whose only dependency is `blogwright`.
  - *Evidence collected:* the case `never hands the resolver the bare "blogwright" specifier, and discovers a bundled plugin from a consumer package.json listing only "blogwright"` passes: the memory filesystem holds `/repo/package.json` with the single dependency `blogwright`, `/cli-pkg/package.json` with `blogwright-pds`, and the returned `plugins` is `['pds']` with `failures` `[]`.
  - *Checks run:* `cliPackageDir()` is a standalone export at `packages/cli/src/context.ts:94-96`, outside `createContext`, and `packages/cli/src/context.test.ts` calls it with no context and asserts the directory holds a `package.json` whose `name` is `blogwright`. Neither `'blogwright'` nor `'blogwright/package.json'` reaches the port: `pluginDependencyNames` filters on the `blogwright-` prefix before any resolution, the bare name never matches, and no code path constructs a `<name>/package.json` specifier (the test asserts no recorded call carries the `blogwright` specifier). The bundled candidate is resolved with `fromDir = cliPackageDir`: the test asserts `packageJsonPathForCalls` contains `{ specifier: 'blogwright-pds', fromDir: CLI_DIR }` and contains no call with `fromDir: REPO_ROOT`. Confirmed against the real workspace: `packageJsonPathFor('blogwright-pds', cliPackageDir())` returns `packages/pds/package.json`, and `('blogwright-core', …)` returns `packages/core/package.json`. `grep -n "import.meta" packages/cli/src/plugins.ts` returns nothing; the module imports neither `node:module` nor `import.meta.url`.
  - *Regression check on the refactor this obligation induced:* `createContext`'s `agentDir` was rewritten from `fileURLToPath(new URL('../agent', import.meta.url))` to `join(cliPackageDir(), 'agent')` (`context.ts:143`). Probed empirically in both layouts after `pnpm build`: from `packages/cli/src/` both expressions yield `/…/packages/cli/agent`; from the shipped `packages/cli/dist/` both yield `/…/packages/cli/agent`; `Dockerfile`, `server.js` and `agent-manifest.json` are all present there. `tsc` uses `rootDir: src`, `outDir: dist`, so `context.js` sits at the package root's `dist/` in the published layout (`files: ["dist","agent"]`), where `..` is the package root. The two derivations are equal by construction and empirically. `packageAndUploadAgent` (`packages/cli/src/agent-package.ts:29`) is the only runtime reader of `agentDir`; its suite and the whole CLI suite (189 tests) pass.
  - *Status:* ☑ SATISFIED

- **O3 - The manifest and validation negative space.**
  - *Claim:* a missing manifest field is a silent skip with no load; a malformed manifest and a failing default export are each a reported failure naming the package and the reason.
  - *Evidence collected:* `skips a candidate with no "blogwright" field silently, with no failure and no load` asserts `{ plugins: [], failures: [] }` plus `loader.loadCalls === []` and `loader.resolveCalls === []`. `reports a failure for a "blogwright" field of the wrong type` asserts the single failure `{ packageName: 'blogwright-bad', reason: /\/bad\/package.json/ }` with `loadCalls === []`. `reports a failure for a namespace violating ^[a-z0-9-]+$` asserts one failure naming `blogwright-badname`, again with no load. `reports a failure naming the package and the reason when the default export fails validatePlugin` asserts one failure whose `reason` matches `/blogwright-broken/` and that `loadCalls === ['/broken/index.js']`.
  - *Checks run:* the validator call is core's `validatePlugin(mod, candidate.packageName)` imported from `blogwright-core` (`plugins.ts:200`), applied to the imported module - `validatePlugin` reads `module.default` itself (`packages/core/src/plugin.ts`), so the default export is what is checked. No hand-rolled shape check is duplicated in `plugins.ts`; the only local parsing is the `package.json` manifest field, which core does not own. `PLUGIN_NAME_PATTERN` is imported from core rather than re-declared, and carries no `g` flag, so `.test` is stateless.
  - *Status:* ☑ SATISFIED

- **O4 - Return shape, recorded decision, and import discipline.**
  - *Claim:* `discover` returns both collections with no `null`/`undefined`, the module comment records why failures are collected rather than thrown, and the module imports only ports and core.
  - *Evidence collected:* `DiscoveryResult` (`plugins.ts:48-51`) declares `readonly plugins: readonly Plugin[]` and `readonly failures: readonly PluginLoadFailure[]`, both non-optional; `discover` returns `{ plugins, failures }` built from two arrays initialised empty. The module comment (`plugins.ts:1-20`) states the collect-versus-throw choice and names the two preconditions that do throw. `grep -n "^import"` yields `node:path`, `blogwright-core`, `./ports.js`. `pnpm lint` is clean (exit 0; the only warnings are pre-existing `no-shadow` warnings in `nodes.test.ts`).
  - *Deviation noted, not a defect:* the certificate's evidence line says "expect only `blogwright-core` and local `./` imports", while the module also imports `join` from `node:path`. The DoD's own rule is "no `node:fs`, no `node:module` - as `pnpm lint` verifies"; `.oxlintrc.json`'s `no-restricted-imports` does not restrict `node:path`, `node:path` performs no I/O, and `context.ts` and the rest of the CLI use it the same way.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the task workspace root, all six gates green: `pnpm build` (exit 0, including `copy-agent.mjs`), `pnpm typecheck` (exit 0), `pnpm test` (exit 0 - core 123+1 skipped, build-agent 27, pds 85, cli 189), `pnpm lint` (exit 0), `pnpm exec oxfmt --check .` (exit 0, 132 files), `pnpm knip` (exit 0). `PLUGIN_PACKAGE_PREFIX` is a named constant; the namespace pattern is core's `PLUGIN_NAME_PATTERN`, not a literal. No changeset: the change is internal-only (nothing dispatches to `discover` until task 10), which DEVELOPMENT.md §Definition of done exempts, and the plan's other landed tasks (03, 06, 15) shipped none either.
  - *Judgement on the unexported `PluginLoadFailure`:* verified empirically rather than accepted on assertion. Adding `export` to the interface makes `pnpm knip` fail with `Unused exported types (1) PluginLoadFailure  interface  packages/cli/src/plugins.ts:45:18`, so exporting it at this task would break a gate the repo DoD requires clean. The type is not hidden from task 17: it is reachable structurally as `DiscoveryResult['failures'][number]`, and exporting it is a one-line change at the moment `blogwright plugin list` imports it, at which point knip is satisfied by the real consumer. This is the repo's standard knip workflow, not an API shaped around a dead-code check.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewer runs discovery against in-memory fakes (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- plugins` and observe every case running against `createMemoryFileSystem` and a map-backed `ModuleLoader` fake, including the bundled-plugin case with a consumer manifest whose only dependency is `blogwright`.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run plugins --reporter=verbose` (the task's `Reviewable:` line, run verbatim) reports 14 passing cases. The twelve unit cases across `discover - repo-level preconditions`, `discover - candidate selection` and `discover - manifest handling` build every fixture through `createMemoryFileSystem` and `createFakeModuleLoader`; no `makeTempDir` and no `node:fs` appear in them. The two remaining cases sit in the block `discover (integration - real ModuleLoader adapter, real disk)`, marked as such in the title and in the block's doc comment. The bundled-plugin fixture's consumer `package.json` lists exactly one dependency, `blogwright`.
  - *Additional checks the task's DoD names, run rather than accepted:*
    - Removing the name-carrying guard (`isPackageManifest` reduced to a plain existence check) fails exactly two cases and no others: `node-module-loader.test.ts › walks past a nested package.json with no "name"` and `plugins.test.ts › discovers a plugin published with the dual-package layout`. The fixture is the right shape - the outer manifest carries `exports: {".": "./dist/index.js"}` plus a name-less `dist/package.json` of `{"type": "module"}` - in both the adapter test and the on-disk integration fixture.
    - Reverting `packageJsonPathFor` to resolve `<name>/package.json` directly fails exactly the two integration cases while all twelve fake-backed cases stay green, with the reason `failed to resolve "blogwright-core/package.json" from …/packages/cli/: Package subpath './package.json' is not defined by "exports"` (and the same for `blogwright-pds`). That also proves the first integration case really drives the CLI-bundled half of the candidate set through the real resolver.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- No existing callers in scope - `packages/cli/src/plugins.ts` is new and nothing dispatches to it until task 10; the only shared surface it consumes is `Ports` (`packages/cli/src/ports.ts:24-29`), which it reads and does not change (the diff adds only a doc paragraph to `ModuleLoader.packageJsonPathFor`).
- `packages/cli/src/deploy.test.ts` calls `createTestContext()` → the suite passes; the whole CLI suite is 20 files / 189 tests green, so the new module adds no import cycle or eager side effect at module load : ☑ PRESERVED
- `packages/cli/src/context.ts` - the one behavioural edit outside the new module. `agentDir` is the only consumer surface changed; `packageAndUploadAgent` (`agent-package.ts:29`) is its only runtime reader and resolves to the identical directory in both the source and built layouts (see O2's regression check) : ☑ PRESERVED
- `packages/cli/src/adapters/node-module-loader.ts` - task 05's tests are extended, never edited: the diff adds a helper and one case and leaves every existing case's body untouched; all eight adapter cases pass : ☑ PRESERVED

## Residue

Notes for the validator: the shape of the candidate set (a `Map` keyed by package name, a sorted array) is an implementation choice; O2 constrains only that bundled candidates are resolved from the CLI package's directory. Duplicate and reserved-name handling is deliberately absent here - it is task 09's contract, and a discovery implementation that silently allows a duplicate at this task is not a defect against these obligations. Whether a candidate that appears in both the consumer's and the CLI's dependency lists is deduplicated is not fixed by an obligation; if it produces a spurious duplicate at task 09, that is a task-09 finding.

Carried forward from this validation, none of them blocking:

1. `cliPackageDir()` returns a path with a trailing separator (`/…/packages/cli/`), unlike every other directory value in the CLI. Harmless through `join` and `createRequire`, but a caller among tasks 10, 11, 14 and 17 that interpolates it into a template (`${cliPackageDir()}/x`) gets a doubled separator in the resulting string and in any message built from it.
2. The first integration case asserts only `failures === []` - no plugin is discovered from this workspace, because `blogwright-pds` has no `blogwright.plugin` field until the pds-migration stream adds one. It is non-vacuous (reverting the resolver turns it red, naming both CLI-bundled candidates), but it would not catch a regression that dropped the CLI half of the candidate set entirely; the fake-backed bundled-plugin case is what covers that. Worth strengthening when task 29 lands the pds manifest field.
3. A `blogwright` field that is present but carries no `plugin` key (`"blogwright": {}`) is reported as a malformed-manifest failure, not a silent skip. Defensible under the DoD's "wrong type" wording, and slightly stricter than §Plugin discovery's "a package without the field is skipped silently".
4. The parsed `PluginManifest.plugin` is used only in error messages; discovery never reconciles the declared namespace with the loaded `Plugin.name`. A package declaring `"plugin": "pds"` whose default export names itself something else is accepted here. That reconciliation, if wanted, belongs with task 09's collision rules.
5. `cliPackageDir()` uses a fixed `new URL('..', import.meta.url)` rather than the change spec's literal "walks up to the nearest `package.json`". It matches this task's DoD ("the way `agentDir` does at `:118`") and was verified equal in the source, built and published layouts; it would need revisiting only if `context.ts` ever moved out of the package's top-level source directory, which would break the pre-existing `agentDir` derivation in the same way.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED against run evidence - 14/14 `plugins` cases plus the two mutation experiments the DoD names (removing the `name` guard fails exactly the two cases that cover it; reverting to `<name>/package.json` fails only the two real-adapter cases) - and all six repo gates are green, with the one load-bearing refactor, `agentDir` deriving from `cliPackageDir()`, proven to resolve to the identical directory in both the source and the shipped layouts.
