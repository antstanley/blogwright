# Done Certificate — Task 05: Add the ModuleLoader port and its node adapter

**Task:** [05-cli_module_loader_port.md](05-cli_module_loader_port.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 05. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 05) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** A `ModuleLoader` port (`resolve`, `load`) exists with a `createRequire`-plus-dynamic-`import()` adapter, wired at `createContext`, defaulted to a fail-fast fake in `createTestContext`, and enforced by `no-restricted-imports`.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the existing `Ports` construction in `packages/cli/src/context.ts:111-116` and `packages/cli/src/test-support.ts:155-160` — every existing CLI test builds its context through `createTestContext`, and every existing domain module reads `ctx.ports`.

## Obligations

- **O1 — Port shape and explicit absence.**
  - *Claim:* `ModuleLoader` in `packages/cli/src/ports.ts` exposes `resolve(specifier, fromDir)` and `load(path)`, and a failed resolution is expressed in the type rather than as `null`.
  - *Evidence to collect:* read the `ModuleLoader` declaration in `packages/cli/src/ports.ts` and the `loader` field on the `Ports` interface; confirm `resolve`'s return type is a discriminated result (or an `exactOptionalPropertyTypes`-compatible optional), and grep the file for `| null` — expect no match on the new declarations.
  - *Status:* ☐ unverified

- **O2 — `node:module` is confined and mechanically enforced.**
  - *Claim:* only `packages/cli/src/adapters/node-module-loader.ts` imports `node:module` outside the composition root, the root `.oxlintrc.json` restricts `node:module` and `module`, and `pnpm lint` passes with no new override path.
  - *Evidence to collect:* run `grep -rn "node:module\|from 'module'" packages/core/src packages/cli/src packages/pds/src` — expect only `packages/cli/src/adapters/node-module-loader.ts` (and its test); read `.oxlintrc.json` `rules.no-restricted-imports.paths` for `node:module` and `module` entries; read `.oxlintrc.json` `overrides[0].files` and confirm it is unchanged from `packages/core/src/adapters/**`, `packages/cli/src/adapters/**`, `packages/cli/src/bin.ts`, `packages/cli/src/context.ts`, `packages/cli/src/test-support.ts`, `packages/pds/src/test-support.ts`, `packages/build-agent/**`; run `pnpm lint` — expect clean.
  - *Checks:* add `import { createRequire } from 'node:module'` to `packages/cli/src/commands.ts`, run `pnpm lint`, confirm it errors on that line, then revert.
  - *Status:* ☐ unverified

- **O3 — Error translation and the real-directory integration test.**
  - *Claim:* adapter failures become repo `Error`s naming the specifier and the directory, and an integration test covers a resolvable and an unresolvable specifier against a real directory.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- node-module-loader` — expect a passing case that resolves a real specifier from a `makeTempDir` directory and a case where an unresolvable specifier yields the not-found result rather than a raw `MODULE_NOT_FOUND`; read the failure-translation branch in `packages/cli/src/adapters/node-module-loader.ts` and compare it to `packages/cli/src/adapters/process-vcs.ts:17-26` for the same shape (message names the operation and the directory, original attached as `cause`).
  - *Checks:* confirm the test tears down its directory through `removeTempDir` (`packages/cli/src/test-support.ts:137`), so no temp directory leaks.
  - *Status:* ☐ unverified

- **O4 — Wiring, test default, and the ports table.**
  - *Claim:* `ports.loader` is constructed at the composition root and defaults in tests to a fail-fast fake naming its override, and DEVELOPMENT.md's ports table lists the port.
  - *Evidence to collect:* read `packages/cli/src/context.ts:111-116` for `loader: opts.ports?.loader ?? createNodeModuleLoader()`; read the `rejectAllLoader` constant and the `ports` object in `packages/cli/src/test-support.ts` and confirm both methods throw a message containing `ports.loader`; read DEVELOPMENT.md §Hexagonal architecture's ports table for a `ModuleLoader` row naming `cli/src/ports.ts`, `createNodeModuleLoader` (`cli/src/adapters/node-module-loader.ts`) and the test substitute.
  - *Checks:* resolve `createNodeModuleLoader()` at `packages/cli/src/context.ts` — confirm it is imported from `./adapters/node-module-loader.js` and constructed only there, not inside a domain module.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewer runs the loader tests and proves the lint gate bites (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- node-module-loader` and observe both cases pass without registry access, then add a `node:module` import to a domain module and observe `pnpm lint` reject it.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- node-module-loader` and record the passing test names; add `import { createRequire } from 'node:module'` at the top of `packages/cli/src/commands.ts`, run `pnpm lint`, record the error and the message text, then revert the edit and re-run `pnpm lint` to confirm clean.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/deploy.test.ts` calls `createTestContext()` with no `ports` override → expect the suite still passes with `ports.loader` present and never called : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.test.ts:12` calls `loadConfig` through a memory filesystem → expect unchanged behaviour after `createContext`'s port block grows a field : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/adapters/process-vcs.test.ts` imports `node:child_process` under the existing adapter override → expect the widened `no-restricted-imports` path list leaves it lint-clean : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the choice of a discriminated resolution result versus an optional property is left to the implementer, and either satisfies O1 as long as `null` is absent. Whether `load` should validate anything is deliberately out of scope — validation belongs to task 08's boundary check. `node:module`'s `register`/`syncBuiltinESMExports` surfaces are not used and are not covered by any obligation.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
