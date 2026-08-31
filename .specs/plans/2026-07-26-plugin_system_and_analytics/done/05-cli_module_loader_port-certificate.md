# Done Certificate - Task 05: Add the ModuleLoader port and its node adapter

**Task:** [05-cli_module_loader_port.md](05-cli_module_loader_port.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 05. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 05) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `ModuleLoader` port (`resolve`, `load`) exists with a `createRequire`-plus-dynamic-`import()` adapter, wired at `createContext`, defaulted to a fail-fast fake in `createTestContext`, and enforced by `no-restricted-imports`.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the existing `Ports` construction in `packages/cli/src/context.ts:111-116` and `packages/cli/src/test-support.ts:155-160` - every existing CLI test builds its context through `createTestContext`, and every existing domain module reads `ctx.ports`.

**Premise re-verified at validation time (2026-08-29).** The design rests on Node's exports
encapsulation, and it still holds in this workspace. From `packages/cli`:

```
require.resolve('blogwright-pds')             -> /…/packages/pds/dist/index.js
require.resolve('blogwright-pds/package.json') -> THROW ERR_PACKAGE_PATH_NOT_EXPORTED
require.resolve('blogwright')                  -> THROW ERR_PACKAGE_PATH_NOT_EXPORTED
require.resolve('blogwright/package.json')     -> THROW ERR_PACKAGE_PATH_NOT_EXPORTED
```

The real adapter was then driven against the real package (not the temp fixture):
`packageJsonPathFor('blogwright-pds', '<repo>/packages/cli')` returns
`{ found: true, path: '<repo>/packages/pds/package.json' }`, and
`resolve('blogwright', …)` raises `failed to resolve "blogwright" from <dir>: No "exports"
main defined …` with `cause.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'` - exactly the limit the
port's doc comment records. The load-bearing claim is true of reality, not only of a fixture.

## Obligations

- **O1 - Port shape and explicit absence.**
  - *Claim:* `ModuleLoader` in `packages/cli/src/ports.ts` exposes `resolve(specifier, fromDir)` and `load(path)`, and a failed resolution is expressed in the type rather than as `null`.
  - *Evidence collected:* `packages/cli/src/ports.ts:28` declares
    `export type ModuleResolution = { found: true; path: string } | { found: false }` - a
    discriminated union, so absence is a variant, not a sentinel. `ModuleLoader`
    (`ports.ts:37-63`) exposes all three members with the mandated signatures:
    `resolve(specifier, fromDir): Promise<ModuleResolution>`,
    `packageJsonPathFor(specifier, fromDir): Promise<ModuleResolution>`,
    `load(path): Promise<unknown>` - `unknown`, so the caller validates at the boundary.
    `Ports` gains `loader: ModuleLoader` (`ports.ts:70`). `grep -n "null" packages/cli/src/ports.ts`
    returns exactly one hit, line 25, inside the doc comment that explains why `string | null`
    is *not* used. `fromDir` is a per-call parameter, not construction state.
  - *Status:* ☑ SATISFIED

- **O2 - `node:module` is confined and mechanically enforced.**
  - *Claim:* only `packages/cli/src/adapters/node-module-loader.ts` imports `node:module` outside the composition root, the root `.oxlintrc.json` restricts `node:module` and `module`, and `pnpm lint` passes with no new override path.
  - *Evidence collected:* `grep -rn "node:module\|from 'module'\|require('module')"` over
    `packages/core/src packages/cli/src packages/pds/src packages/build-agent` returns only
    `packages/cli/src/adapters/node-module-loader.ts:11` (plus its doc comment at :3), its own
    test at `node-module-loader.test.ts:10`, and `packages/build-agent/dist/server.js:1` -
    compiled output, excluded by `.oxlintrc.json`'s `ignorePatterns: ["dist"]` and covered by
    the pre-existing `packages/build-agent/**` override. `.oxlintrc.json` `no-restricted-imports.paths`
    gains two entries, `node:module` and `module`, each with the message
    *"Domain modules resolve and import plugin packages through the ModuleLoader port
    (ctx.ports.loader); only adapters/node-module-loader.ts touches node:module. See
    DEVELOPMENT.md §Hexagonal architecture."* `overrides[0].files` is byte-identical to the
    baseline list (`packages/core/src/adapters/**`, `packages/cli/src/adapters/**`,
    `packages/cli/src/bin.ts`, `packages/cli/src/context.ts`, `packages/cli/src/test-support.ts`,
    `packages/pds/src/test-support.ts`, `packages/build-agent/**`) - the diff touches no
    override. `pnpm lint` exits 0 with zero errors (pre-existing `no-shadow` warnings only).
  - *Checks run:* the validator re-ran the implementer's probe independently. Prepending
    `import { createRequire } from 'node:module';` to `packages/cli/src/commands.ts` makes
    `pnpm lint` exit 1 with
    `src/commands.ts:1:1: error eslint(no-restricted-imports): 'node:module' import is restricted
    from being used. help: Domain modules resolve and import plugin packages through the
    ModuleLoader port (ctx.ports.loader); only adapters/node-module-loader.ts touches
    node:module. See DEVELOPMENT.md §Hexagonal architecture.` The edit was reverted from a
    byte-for-byte backup and `pnpm lint` returned to exit 0. The rule genuinely bites.
  - *Status:* ☑ SATISFIED

- **O3 - Error translation and the real-directory integration test.**
  - *Claim:* adapter failures become repo `Error`s naming the specifier and the directory, and an integration test covers a resolvable and an unresolvable specifier against a real directory.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run node-module-loader
    --reporter=verbose` - 8/8 passing, no network: resolvable (`fake-pkg` → entry file),
    unresolvable (`does-not-exist-anywhere` → `{ found: false }`), a non-`MODULE_NOT_FOUND`
    resolution failure raising a contextual error, `packageJsonPathFor` found and not-found,
    the `ERR_PACKAGE_PATH_NOT_EXPORTED` contrast, `load` success, and `load` failure
    translation. `packages/cli/src/adapters/node-module-loader.ts:22-32` (`resolutionFailure`)
    produces `failed to ${operation} "${specifier}" from ${fromDir}: ${message}` with
    `{ cause: err }` - the same shape as `runVcsCommand`
    (`packages/cli/src/adapters/process-vcs.ts:17-26`: `${command} ${args} failed in ${cwd}:
    ${message}`, `{ cause: err }`). Both the specifier and the directory are named.
    `resolveEntryPoint` (:41-49) returns `{ found: false }` only for `MODULE_NOT_FOUND` and
    raises with context for anything else, so a raw `MODULE_NOT_FOUND` never escapes the port.
  - *Checks run:* `afterEach` calls `removeTempDir(root)` (`node-module-loader.test.ts:55-57`,
    `test-support.ts:156-158`); after the full suite, `ls -d $TMPDIR/node-module-loader-*`
    matches nothing - no leak.
  - *Note on the fixture (deviation from the task file's literal wording, judged acceptable).*
    The DoD sentence names `blogwright-pds`; the committed test instead builds real on-disk
    packages under a `makeTempDir` root. The fixture reproduces the encapsulation shape
    faithfully - `exports: { '.': './index.js' }` with no `./package.json`
    (`node-module-loader.test.ts:50`) - and a second fixture, `no-entry-pkg`
    (`exports: { './sub': … }`, no `.`), reproduces `blogwright`'s own shape. The contrast test
    (:96-112) is non-vacuous: it asserts `caught` is an `Error` *and* that its `code` is
    `ERR_PACKAGE_PATH_NOT_EXPORTED`, so a no-throw would fail it. This satisfies the authority
    spec's actual requirement - *"at least one test using the real loader against a package on
    disk, not only the map-backed fake"* (`2026-07-26-cli_plugin_system.md` §Plugin discovery) -
    and avoids coupling a CLI unit test to `packages/pds/dist` having been built. The validator
    additionally drove the real adapter against the real `blogwright-pds` by hand (see Premises
    above) and it returns `packages/pds/package.json`. The claim is proven both ways.
  - *Note on the knip workaround (judged meaning-preserving).* The contrast test builds its
    subpath at runtime (`['fake-pkg', 'package.json'].join('/')`, :103) instead of passing a
    literal. The validator verified both halves: (a) restoring the literal makes `pnpm knip`
    exit non-zero with `Unlisted dependencies (1) fake-pkg/package.json
    …node-module-loader.test.ts:105:23`, so the workaround was necessary; (b) with the literal
    restored, the same test still passes with the same assertion, and the runtime-built string
    is character-identical (`'fake-pkg/package.json'`) at the `require.resolve` call. The test
    still exercises the exact resolution path it exists to contrast; only the static-analysis
    surface changed. Both probes were reverted.
  - *Status:* ☑ SATISFIED

- **O4 - Wiring, test default, and the ports table.**
  - *Claim:* `ports.loader` is constructed at the composition root and defaults in tests to a fail-fast fake naming its override, and DEVELOPMENT.md's ports table lists the port.
  - *Evidence collected:* `packages/cli/src/context.ts:117` reads
    `loader: opts.ports?.loader ?? createNodeModuleLoader(),` inside the `const ports: Ports`
    block of `createContext`. `packages/cli/src/test-support.ts:104-121` defines
    `rejectAllLoader`; all three methods throw, and each message contains
    `override ports.loader on createTestContext` - the `rejectAllVcs` shape - and echoes the
    arguments it was called with. It is defaulted at `test-support.ts:178`
    (`loader: overrides.ports?.loader ?? rejectAllLoader`). `DEVELOPMENT.md:82` adds the row
    `| ModuleLoader | cli/src/ports.ts | createNodeModuleLoader (cli/src/adapters/node-module-loader.ts) | fail-fast fake via createTestContext ports.loader overrides |`.
  - *Checks run:* `grep -rn "createNodeModuleLoader" packages/*/src` returns exactly three
    non-test sites: its declaration (`adapters/node-module-loader.ts:97`), its import
    (`context.ts:21`, from `./adapters/node-module-loader.js`) and its single construction
    (`context.ts:117`). No domain module constructs it.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the workspace root - `pnpm build` exit 0; `pnpm test` exit 0
    (core 104 passed/1 skipped, build-agent 27, pds 85, cli 136 - 352 passing across 44 files);
    `pnpm lint` exit 0; `pnpm exec oxfmt --check .` exit 0 ("All matched files use the correct
    format", 125 files); `pnpm knip` exit 0; `pnpm -r typecheck` exit 0 (this covers the test
    files, which `pnpm build` does not). No changeset is present and none is required: the
    change is internal plumbing with no user-visible behaviour, plan.md:81 scopes changesets to
    user-facing changes, and plan.md:232 assigns the plugin system's changeset to task 20. No
    new magic numbers; the `nearestPackageJson` walk (`node-module-loader.ts:85-94`) terminates
    provably on `dirname(dir) === dir` at the filesystem root rather than on a bare counter.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewer runs the loader tests and proves the lint gate bites (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- node-module-loader` and observe both cases pass without registry access, then add a `node:module` import to a domain module and observe `pnpm lint` reject it.
  - *Evidence collected:* the task file's `Reviewable:` command, run verbatim -
    `pnpm --filter blogwright exec vitest run node-module-loader --reporter=verbose` - reports
    8 passed / 8, listing each named case; resolution is filesystem-only against locally
    written fixtures, so no registry is contacted. The certificate's variant form
    (`pnpm --filter blogwright test -- node-module-loader`) also exits 0, though the `--`
    causes vitest to run the whole CLI suite (136 passed) rather than filtering - the task
    file's `exec vitest run` form is the one that actually filters. The lint probe and its
    revert are recorded under O2.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/deploy.test.ts` calls `createTestContext()` with no `ports` override → the suite passes with `ports.loader` present and never called; `rejectAllLoader` would have thrown loudly had any path touched it : ☑ PRESERVED
- `packages/cli/src/context.test.ts:12` calls `loadConfig` through a memory filesystem → unchanged after `createContext`'s port block grew a field; the `PluginContext composition` compile-time suite at :88 also still narrows `Ports` to the two-member `PluginPorts` (`pnpm -r typecheck` exit 0) : ☑ PRESERVED
- `packages/cli/src/adapters/process-vcs.test.ts` imports `node:child_process` under the existing adapter override → the widened `no-restricted-imports` path list leaves it lint-clean (`pnpm lint` exit 0, zero errors) : ☑ PRESERVED
- Additional: `packages/cli/src/repo.ts:29` takes `Pick<Ports, 'vcs' | 'fs'>` and is unaffected by the new member; `TestContextOverrides.ports` is `Partial<Ports>` (`test-support.ts:47`), so no existing caller is forced to supply `loader` : ☑ PRESERVED

## Residue

Notes for the validator: the choice of a discriminated resolution result versus an optional
property is left to the implementer, and either satisfies O1 as long as `null` is absent.
Whether `load` should validate anything is deliberately out of scope - validation belongs to
task 08's boundary check. `node:module`'s `register`/`syncBuiltinESMExports` surfaces are not
used and are not covered by any obligation.

**Validator-added residue - three behaviours confirmed empirically against the real adapter.**
All three follow from the algorithm the authority prescribes, so none is a defect in this
diff; all three are consequences task 07 (discovery) and task 08 (dispatch) will inherit, and
are routed to them rather than fixed here.

1. *A `package.json` nested under the entry point wins the walk.* A plugin published with a
   dual-package `dist/package.json` (`{"type":"module"}`) makes
   `packageJsonPathFor` return `…/node_modules/<name>/dist/package.json` - a manifest with no
   `name` and no `blogwright` field - so discovery would skip a real plugin **silently**.
   Verified against the real adapter with a fixture of that shape. The spec's own words are
   "the nearest `package.json` above that resolution", so the implementation is exactly
   compliant; a one-line guard (skip a candidate with no `name`, or stop at the
   `node_modules/<name>` boundary) would close it. This is the highest-value follow-up.
2. *An `import`-only conditional exports map is unresolvable.* `createRequire(...).resolve()`
   applies the CJS conditions, so a plugin publishing `exports: { ".": { "import": "…" } }`
   raises `ERR_PACKAGE_PATH_NOT_EXPORTED` and the adapter correctly re-raises it as a
   contextual error rather than `{ found: false }`. Loud, not silent - but discovery in task 07
   should decide whether one such dependency should abort the whole run.
3. *Installed-but-unbuilt reads as not installed.* A package whose exports target is missing
   throws `MODULE_NOT_FOUND`, which the adapter maps to `{ found: false }` per contract, so
   "broken install" and "not installed" are indistinguishable at the port.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied by collected evidence - the load-bearing
`packageJsonPathFor` claim was re-proved against the real `blogwright-pds` in this workspace
(not only against the temp fixture), the `no-restricted-imports` probe was independently re-run
and confirmed to fire and to revert clean, the knip workaround was shown to be both necessary
and meaning-preserving, and all five gates plus `pnpm -r typecheck` pass with no regression in
any traced consumer of `Ports` or `createTestContext`.
