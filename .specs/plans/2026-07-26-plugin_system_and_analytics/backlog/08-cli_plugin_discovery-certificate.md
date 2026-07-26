# Done Certificate — Task 08: Discover installed plugins from the consuming repo and from the CLI's own bundle

**Task:** [08-cli_plugin_discovery.md](08-cli_plugin_discovery.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 08. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 08) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `discover(repoRoot, cliPackageDir, ports)` in a new `packages/cli/src/plugins.ts` returns loaded plugins and load failures for both consumer-installed and CLI-bundled plugin packages, each resolved from its own directory.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the `Ports` contract in `packages/cli/src/ports.ts:24-29` or core's boundary validator `validatePlugin` (`packages/core/src/plugin.ts`, task 03), and must add no new import that the root `.oxlintrc.json` `no-restricted-imports` rule would reject in a domain module.

## Obligations

- **O1 — Reading and filtering the consumer manifest.**
  - *Claim:* `<repoRoot>/package.json` is read through `ports.fs`, absence and unparseability raise errors naming the path and the fix, and only `blogwright-*` names from `dependencies` and `devDependencies` become candidates.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- plugins` › the manifest-reading cases — expect a passing test whose raised message contains the full `<repoRoot>/package.json` path for the absent case and one for the malformed-JSON case; read the candidate-filter code and confirm both dependency maps are consulted; read the non-matching-dependency test and confirm it asserts the `ModuleLoader` fake's `resolve` was never called with that name.
  - *Checks:* resolve the file read at the top of `discover` — confirm it is `ports.fs.readText`, not `node:fs`, and that `FileNotFoundError` (`packages/core/src/ports.ts:53`) is the branch taken for absence rather than a generic catch-all.
  - *Status:* ☐ unverified

- **O2 — Bundled plugins are discovered.**
  - *Claim:* a plugin shipped as a dependency of `blogwright` itself is discovered from a consumer `package.json` whose only dependency is `blogwright`.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- plugins` › the bundled-plugin case — expect the memory filesystem to hold a consumer `package.json` listing only `blogwright`, plus a CLI `package.json` listing a `blogwright-*` dependency, and the returned `plugins` array to contain that plugin.
  - *Checks:* trace how the CLI's own `package.json` is located — confirm `cliPackageDir` is derived from `import.meta.url` at the composition root and passed in, and that neither `'blogwright'` nor `'blogwright/package.json'` is ever handed to `ports.loader`. Both throw `ERR_PACKAGE_PATH_NOT_EXPORTED` (verified 2026-07-26: `packages/cli/package.json` declares an `exports` map with a `./rkey` entry and no `.` entry), so a resolver call there is a defect that no map-backed fake can expose. Then confirm the bundled candidate is resolved with `fromDir = cliPackageDir`, not `repoRoot`, because under pnpm the consumer's `node_modules` holds only the `blogwright` symlink and `blogwright-pds` is not resolvable from there at all. Confirm `plugins.ts` itself imports neither `node:module` nor `import.meta.url`.
  - *Status:* ☐ unverified

- **O3 — The manifest and validation negative space.**
  - *Claim:* a missing manifest field is a silent skip with no load; a malformed manifest and a failing default export are each a reported failure naming the package and the reason.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- plugins` › the manifest cases — expect three passing tests: no `blogwright.plugin` field yields no entry in `failures` and an assertion that the fake loader's `load` was not called for that package; a wrong-typed field and a namespace violating `^[a-z0-9-]+$` each yield a failure whose message contains the package name; a default export rejected by `validatePlugin` yields a failure carrying the validator's reason.
  - *Checks:* resolve the validator call — confirm it is core's `validatePlugin` from `blogwright-core`, applied to the loaded module's default export, and not a hand-rolled shape check duplicated in `plugins.ts`.
  - *Status:* ☐ unverified

- **O4 — Return shape, recorded decision, and import discipline.**
  - *Claim:* `discover` returns both collections with no `null`/`undefined`, the module comment records why failures are collected rather than thrown, and the module imports only ports and core.
  - *Evidence to collect:* read the return type declaration in `packages/cli/src/plugins.ts` and confirm both fields are non-optional arrays; read the module comment for the collect-versus-throw rationale; run `grep -n "^import" packages/cli/src/plugins.ts` — expect only `blogwright-core` and local `./` imports; run `pnpm lint` — expect clean.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewer runs discovery against in-memory fakes (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- plugins` and observe every case running against `createMemoryFileSystem` and a map-backed `ModuleLoader` fake, including the bundled-plugin case with a consumer manifest whose only dependency is `blogwright`.
  - *Evidence to collect:* run the command and record the passing test names; read the test file's setup and confirm no `makeTempDir`, no `node:fs`, and no real package resolution appears; confirm the bundled-plugin test's consumer `package.json` fixture lists exactly one dependency, `blogwright`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- No existing callers in scope — `packages/cli/src/plugins.ts` is new and nothing dispatches to it until task 10; the only shared surface it consumes is `Ports` (`packages/cli/src/ports.ts:24-29`), which it reads and does not change.
- `packages/cli/src/deploy.test.ts` calls `createTestContext()` → expect the suite still passes, confirming the new module adds no import cycle or eager side effect at module load : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the shape of the candidate set (a `Map` keyed by package name, a sorted array) is an implementation choice; O2 constrains only that bundled candidates are resolved from the CLI package's directory. Duplicate and reserved-name handling is deliberately absent here — it is task 09's contract, and a discovery implementation that silently allows a duplicate at this task is not a defect against these obligations. Whether a candidate that appears in both the consumer's and the CLI's dependency lists is deduplicated is not fixed by an obligation; if it produces a spurious duplicate at task 09, that is a task-09 finding.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
