# Done Certificate - Task 06: Add the PackageManager port and its process adapter

**Task:** [06-cli_package_manager_port.md](06-cli_package_manager_port.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 06. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 06) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `PackageManager` port (`detect`, `add`, `remove`) exists with a lockfile-detecting process adapter, wired at `createContext` and defaulted to a recording fake in `createTestContext`.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the existing `Ports` construction in `packages/cli/src/context.ts` and `packages/cli/src/test-support.ts`, nor the `no-restricted-imports` override list in `.oxlintrc.json:71-84`, which every package's `pnpm lint` run resolves against.

This is the **second** validation pass. The first returned `pending correctness fix` on four
defects (D1 typecheck red, D2 `add`/`remove` untested, D3 stale `process-vcs.ts` comment,
D4 missing `maxBuffer`). The whole task was re-verified from scratch; the previous pass's
conclusions were treated as claims, not evidence.

Validation ran against the isolated workspace `/Users/ant/code/blogwright-task-06`
(`jj diff --git` over parent `de581e55`, tasks 00/01/04 in the base). The workspace was left
as found (`jj status`: the same eight paths, before and after).

## Obligations

- **O1 - Domain vocabulary and port-mediated detection.**
  - *Claim:* `PackageManager` exposes `detect(repoRoot)`, `add(spec, opts)` and `remove(name)` in the repo's own vocabulary, and detection reads lockfiles through the `FileSystem` port rather than `node:fs`.
  - *Evidence collected:* `packages/cli/src/ports.ts:17-44` declares `PackageManagerName`, `AddPackageOptions { dev?: boolean; exact?: boolean }` and the three-method `PackageManager`. Every manager's flag spelling (`--save-dev`, `--dev`, `--save-exact`, `--exact`) and every verb (`add`/`install`, `remove`/`uninstall`) is confined to the adapter's private `PACKAGE_MANAGERS` table (`packages/cli/src/adapters/process-package-manager.ts:45-74`); nothing on the port names a CLI flag. `grep -rn "node:fs" packages/cli/src` finds the adapter only in its header prose (`:3`), never an import; the adapter's imports are `node:child_process`, `node:path`, `node:util` and `blogwright-core`.
  - *Checks (function resolution):* the `fs` inside `detectManager` (`:83-94`) resolves to the `FileSystem` parameter of `createProcessPackageManager` (`:123-126`), closed over by `detect`, `resolveRepo` and `findRepoRoot`. `createContext` supplies the same instance it puts on `ports.fs` (`packages/cli/src/context.ts:112,118`). No module-level `createNodeFileSystem()` exists in the adapter. `.oxlintrc.json:71-84` already covers `packages/cli/src/adapters/**`, so no new exception was added.
  - *Status:* SATISFIED

- **O2 - Lockfile mapping, positive and negative.**
  - *Claim:* each supported lockfile maps to its manager, and no lockfile raises with `repoRoot` and every candidate named.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run process-package-manager --reporter=verbose` → **19 passed**, including `detects pnpm|npm|yarn|bun from its lockfile` and `raises naming the repo root and every lockfile it looked for when none matches`. Each positive case seeds exactly one lockfile into `createMemoryFileSystem`; the negative seeds only `README.md`. The thrown message (`:93`) is `no supported package manager detected in ${repoRoot} - looked for ${lockfiles}`, and the test asserts `repoRoot` and every entry of `PACKAGE_MANAGER_LOCKFILES` appears in it.
  - *Checks:* one positive test per table entry, as the obligation requires. **Weakness recorded (Defect D6):** the positive `it.each` derives both the seeded lockfile and the expected manager from the exported `PACKAGE_MANAGER_LOCKFILES`, so the lockfile↔manager cells are not pinned by that suite. Three of the four cells are pinned literally elsewhere - `pnpm-lock.yaml → pnpm` and `yarn.lock → yarn` by the add/remove suite's `command:` assertions (`process-package-manager.test.ts:132,147` and `:160,174`), `package-lock.json → npm` by the literal error string at `:194`. `bun.lock → bun` is pinned by no literal anywhere.
  - *Status:* SATISFIED

- **O3 - Process ownership and error translation.**
  - *Claim:* only the new adapter imports `node:child_process`, and its failures carry the command, the arguments and the directory.
  - *Evidence collected:* `grep -rn "node:child_process" packages/cli/src` → `adapters/process-vcs.ts:3,8`, `adapters/process-vcs.test.ts:7`, `adapters/process-package-manager.ts:5,10`. Every path is under `packages/cli/src/adapters/`; the only *new* file among them is the adapter. `runPackageCommand` (`process-package-manager.ts:130-138`) mirrors `runVcsCommand` (`process-vcs.ts:18-27`) template-for-template: `` `${command} ${args.join(' ')} failed in ${cwd}: ${(err as Error).message}` `` with `{ cause: err }`.
  - *Checks:* **D4 (previous pass) is fixed and threaded.** `MAX_OUTPUT_BYTES = 64 * 1024 * 1024` (`:21`, matching `process-vcs.ts:16`) is passed at the single `runProcess` call site (`:132`), which is the only place either `add` or `remove` reaches a process - `add` (`:149-152`) and `remove` (`:154-157`) both funnel through `runPackageCommand`, so there is no unthreaded path. A test asserts the value passed through, not merely its presence: `expect(runs).toEqual([...{ options: { cwd: REPO_ROOT, maxBuffer: MAX_OUTPUT_BYTES } }])` (`:145-156`, `:172-178`) - `toEqual` on the whole recorded options object fails if `maxBuffer` is omitted or differs. **D3 is fixed:** `process-vcs.ts:2-5` now reads "One of only two modules outside the build-agent that may import `node:child_process` (the other is `process-package-manager.ts`)", which the grep above confirms.
  - *Status:* SATISFIED

- **O4 - Recording fake and the ports table.**
  - *Claim:* no test spawns a process, `createTestContext` defaults `ports.packages` to a recording fake, and DEVELOPMENT.md's ports table lists the port.
  - *Evidence collected:* `createRecordingPackageManager` at `packages/cli/src/test-support.ts:121-140`, defaulted at `:198` (`overrides.ports?.packages ?? createRecordingPackageManager()`), covered by two new tests in `test-support.test.ts:59-76` (detect default and configured; add/remove recorded). The new adapter test imports no `node:child_process` and calls no `execFile`/`spawn`: `add`/`remove` are driven entirely through the injected `runProcess` fake (`:134-140`, `:162-168`, `:184-189`, `:201-204`) over `createMemoryFileSystem`. `DEVELOPMENT.md:82` adds the `PackageManager` row naming `cli/src/ports.ts`, `createProcessPackageManager` (`cli/src/adapters/process-package-manager.ts`) and `createRecordingPackageManager`.
  - *Checks:* **D2 (previous pass) is fixed.** `addArgs`, `removeArgs`, `runPackageCommand` and `resolveRepo` now all have coverage, and the verb/flag table is a **genuine truth table with literal expectations**, not derived from `PACKAGE_MANAGERS`: `process-package-manager.test.ts:58-65` hardcodes `pnpm→add`, `npm→install`, `yarn→add`, `bun→add`; `:67-84` hardcodes `--save-dev`/`--save-exact` for pnpm and npm across `{dev}`, `{exact}`, `{dev,exact}`; `:86-103` hardcodes `--dev`/`--exact` for yarn and bun across the same three; `:106-115` hardcodes `pnpm→remove`, `npm→uninstall`, `yarn→remove`, `bun→remove`. All 4×4 add combinations and all 4 remove verbs are literal. Spot-checked against the real CLIs: pnpm/npm `--save-dev|--save-exact`, yarn (v1 and Berry) and bun `--dev|--exact`, `npm uninstall` - all correct. Flag order (dev before exact) is pinned by `:70-75`.
  - *Status:* SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, all six gates are green, and limits are named constants.
  - *Evidence collected:* run from the workspace root, in CI order - `pnpm build` **exit 0**; `pnpm typecheck` **exit 0** (core, build-agent, pds, cli all "Done"); `pnpm test` **exit 0** (core 104, build-agent 27, pds 85, cli 149 - all passing); `pnpm lint` **exit 0** (only the pre-existing `no-shadow` warnings in `nodes.test.ts`); `pnpm exec oxfmt --check .` **exit 0** (125 files); `pnpm knip` **exit 0**. The plan's type-claim gate (`node .specs/plans/…/type-claims/check.mjs`) also passes: "29 claims held". No changeset is required - internal-only, no user-visible surface consumes the port yet. `MAX_OUTPUT_BYTES` is a named constant; no magic numbers introduced.
  - *Checks:* **D1 (previous pass) is fixed, and by a genuine narrowing rather than a cast.** The `TS2339` at `process-package-manager.test.ts:38,40` is gone; the rejection is now obtained through the helper at `:24-33`, which narrows with `if (err instanceof Error) return err;` and rethrows otherwise. No `any`, no `@ts-ignore`, no `@ts-expect-error`, no `as unknown` appears anywhere in the added lines. The four remaining `as` uses are the `Object.entries` key-widening idiom already used in-repo (`process-package-manager.ts:80,84`, `test.ts:36`), two `it.each` table annotations (`test.ts:63,112`), and `(err as Error).message` copied verbatim from `process-vcs.ts:23`.
  - *Status:* SATISFIED

- **O6 - Reviewer runs the detect tests and greps the process boundary (Reviewable).**
  - *Claim:* a reviewer can run the task's two commands as written and observe in-memory detection with no spawn, and a grep confined to `adapters/`.
  - *Evidence collected:* both commands run verbatim. `pnpm --filter blogwright exec vitest run process-package-manager --reporter=verbose` → 19/19 passed in 5ms of test time, every case over `createMemoryFileSystem` or the injected `runProcess` fake. `grep -rn "node:child_process" packages/cli/src` → 5 hits across 3 files, all under `packages/cli/src/adapters/`.
  - *Status:* SATISFIED

## The widened constructor - deliberate judgement

`createProcessPackageManager(fs, { runProcess?, startDir? })` is **more than D2 strictly
demanded**. Assessed as justified, not scope creep, on four grounds:

1. **It is the only sanctioned route.** The task forbids spawning a process in tests, and
   DEVELOPMENT.md §Hexagonal architecture states the alternative out of bounds: "Tests
   substitute at the port, not by patching modules or globals. If a test needs a module mock
   … that side effect is missing a port." With `execFile` owned by the adapter, injection is
   the only way `add`/`remove` become testable at all.
2. **The cited precedent is real and analogous.** `createFetchPing(fetchImpl: typeof fetch = fetch)`
   exists at `packages/cli/src/adapters/fetch-ping.ts:14` - an adapter factory that injects its
   side-effecting primitive with the production value as the default, constructed only at the
   composition root. Identical shape.
3. **`startDir` has an even closer precedent and does not weaken the port.** The port contract
   is the `PackageManager` interface, which is unchanged - `add`/`remove` still take no
   directory, exactly as `ports.ts:31-44` documents. The widening is on the *factory*, which
   only `createContext` calls, and it calls it with one argument (`context.ts:118`), so
   production behaviour is unchanged. `findRepoRoot(fs, start = process.cwd())`
   (`packages/core/src/repo-root.ts:11`) already parameterises precisely this start directory
   with precisely this default; the adapter mirrors it. It makes an ambient `process.cwd()`
   dependency explicit and testable rather than hiding it.
4. **It is minimal.** Two optional fields on one options bag, no exported types, no new port
   surface, and the injected `ExecFileAsync` is narrower than `execFile`'s real signature
   (exactly `{ cwd, maxBuffer }`), so it cannot be used to smuggle other options past review.

The one cost: `startDir` is captured **eagerly** at construction (`:128`), whereas
`findRepoRoot`'s own default is evaluated per call. `grep -rn "process.chdir"` over
`packages/*/src` returns nothing, so this is behaviourally inert today (Defect D7, note only).

## Regression check

- **Execution trace, `add`'s full pipeline (production).** `createContext` → `fs = createNodeFileSystem()` (`context.ts:112`) → `createProcessPackageManager(fs)` (`:118`) → `runProcess = run` (promisified `execFile`), `startDir = process.cwd()`. `ports.packages.add('blogwright-analytics', { dev: true })` → `opts = { dev: true }` → `resolveRepo()` → `findRepoRoot(fs, cwd)` walks to the `.git`/`.jj` root → `detectManager(fs, root)` probes `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock` in that order through `fs.exists`, first match wins → `addArgs('pnpm', spec, { dev: true })` → `['add','blogwright-analytics','--save-dev']` → `runPackageCommand(root, 'pnpm', args)` → `run('pnpm', args, { cwd: root, maxBuffer: 67108864 })`; on rejection, `Error("pnpm add blogwright-analytics --save-dev failed in <root>: <msg>", { cause })`. Matches the change spec's §Ports → `PackageManager` in every clause : CORRECT
- `packages/cli/src/context.ts:111-119` builds `Ports` for every real CLI run → the only edit hoists `createNodeFileSystem()` into `const fs` and reuses that instance for `ports.fs` and `createProcessPackageManager(fs)`; `opts.ports?.fs` still wins, and the factory performs no I/O at construction : PRESERVED
- Full-`Ports` object literals exist only at `context.ts:113` and `test-support.ts:193`; both gained the field. `ContextOptions.ports` (`context.ts:74`) and `createTestContext` overrides (`test-support.ts:54`) are `Partial<Ports>`, so every existing partial-override call site still compiles : PRESERVED
- `repo.ts:29` and `repo.test.ts` use `Pick<Ports,'vcs'|'fs'>`; `core`'s `PluginPorts` (`plugin.ts:42-45`) and `pds`'s `PdsPorts` are separate structural subsets - widening `Ports` breaks none. `context.test.ts`'s `PluginContext` composition suite (the compile-time narrowing proof) still passes : PRESERVED
- `packages/cli/src/adapters/process-vcs.test.ts` still exercises `createProcessVcs` in a real tmp dir; the second `execFile`-owning adapter shares no module state : PRESERVED
- Whole-repo evidence: 365 tests across four packages pass, `pnpm typecheck` is green, and the plan's 29 type claims still hold : PRESERVED

## Residue

Which managers count as "supported" is an implementation choice; the obligations require only
that every entry in the module's lockfile table has a positive test and that the negative
message is derived from that table. Only `bun.lock` is tabled, so a bun < 1.2 repo
(`bun.lockb`) falls through to the "no supported package manager" error - contract-compliant,
since the task named `bun.lock`. Whether `add` pins the CLI's own version is task 18's concern.

Validator's addenda: `add`/`remove` resolve their own root from ambient `process.cwd()` while
`detect` is parameterised on a caller-chosen `repoRoot`; that asymmetry is what the change spec
prescribes, but a caller can still detect against one root and install into another. `execFile`
without a shell cannot invoke Windows `.cmd` shims (`npm.cmd`, `pnpm.cmd`), so `add`/`remove`
would fail on Windows - the same class of limit the existing `process-vcs.ts` carries, and out
of this task's scope.

## Defects

- **D6 (minor, test strength).** `packages/cli/src/adapters/process-package-manager.test.ts:36-44` - the positive `detect` cases derive both the seeded lockfile and the expected manager from the exported `PACKAGE_MANAGER_LOCKFILES`, so they cannot falsify a wrong cell. Compensated for pnpm, yarn and npm by literal assertions in the add/remove suite; `bun.lock → bun` is pinned by no literal. Failure scenario: a typo of bun's lockfile to `bun.lockb` in `process-package-manager.ts:68` keeps all 19 tests green while every bun ≥ 1.2 repo silently falls through to "no supported package manager detected".
- **D7 (minor, doc staleness - same class as D3).** `packages/core/src/plugin.ts:35` still reads "Deliberately narrower than the CLI's four-member `Ports`". This diff makes `Ports` five-member (`packages/cli/src/ports.ts:53-59`). D3 fixed exactly this staleness one file over and this one was left standing. Failure scenario: a reader of `PluginPorts` counts four and concludes `packages` is already in the narrow set. Documentation only - no behaviour depends on it.
- **D8 (informational).** `MAX_OUTPUT_BYTES = 64 * 1024 * 1024` is now declared twice - `process-vcs.ts:16` (private) and `process-package-manager.ts:21` (exported) - each with its own rationale comment. Mirroring `runVcsCommand` was the task's instruction, so this is accepted, but a third `execFile` adapter should extract it.

## Conclusion

VERDICT: DONE, pending nothing (O1…O6 all SATISFIED, all regressions PRESERVED)
CORRECTNESS: LIKELY_CORRECT (D6, D7, D8 - none behavioural)
CONFIDENCE: high
SUMMARY: All four prior defects are genuinely fixed - `pnpm typecheck` is green via an
`instanceof Error` narrowing rather than a cast, `add`/`remove` are covered by a literal
verb/flag truth table over all four managers, `MAX_OUTPUT_BYTES` is threaded to the single
`runProcess` call site and asserted through `toEqual`, and the `process-vcs.ts` comment now
matches the grep - with all six gates plus the type-claim gate green and no test spawning a
process; the widened constructor is justified by in-repo precedent and the repo's own ban on
module mocks, and the three residual findings are a table-derived `detect` suite, a stale
port-count comment in `plugin.ts`, and a duplicated 64 MiB constant.
