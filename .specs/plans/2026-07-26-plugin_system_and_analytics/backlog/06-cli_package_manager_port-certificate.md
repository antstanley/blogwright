# Done Certificate - Task 06: Add the PackageManager port and its process adapter

**Task:** [06-cli_package_manager_port.md](06-cli_package_manager_port.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

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
- **P3 - Invariants.** Must not break the existing `Ports` construction in `packages/cli/src/context.ts:111-116` and `packages/cli/src/test-support.ts:155-160`, nor the `no-restricted-imports` override list in `.oxlintrc.json:71-84`, which every package's `pnpm lint` run resolves against.

## Obligations

- **O1 - Domain vocabulary and port-mediated detection.**
  - *Claim:* `PackageManager` exposes `detect(repoRoot)`, `add(spec, opts)` and `remove(name)` in the repo's own vocabulary, and detection reads lockfiles through the `FileSystem` port rather than `node:fs`.
  - *Evidence to collect:* read the `PackageManager` declaration in `packages/cli/src/ports.ts` and confirm `opts` names repo concepts (dev dependency, exact version) and not a manager's flag strings (`--save-dev`, `-D`); read `packages/cli/src/adapters/process-package-manager.ts` and confirm `detect` calls `fs.exists`/`fs.readText` on an injected `FileSystem`; grep the adapter for `node:fs` - expect no match.
  - *Checks:* resolve the `fs` used inside `detect` - confirm it is the constructor-injected `FileSystem` port, not a module-level `createNodeFileSystem()` call.
  - *Status:* ☐ unverified

- **O2 - Lockfile mapping, positive and negative.**
  - *Claim:* each supported lockfile maps to its manager, and no lockfile raises with `repoRoot` and every candidate named.
  - *Evidence to collect:* run `pnpm --filter blogwright test -- process-package-manager` › the `detect` cases - expect one passing positive test per supported manager, each seeding only its own lockfile in `createMemoryFileSystem`, plus a negative test asserting the raised message contains the `repoRoot` value and every lockfile name the adapter probes.
  - *Checks:* read the module-level lockfile table and confirm the negative test's expected list is derived from it rather than hand-copied, so adding a manager cannot silently desynchronise the message.
  - *Status:* ☐ unverified

- **O3 - Process ownership and error translation.**
  - *Claim:* only the new adapter imports `node:child_process`, and its failures carry the command, the arguments and the directory.
  - *Evidence to collect:* run `grep -rn "node:child_process\|from 'child_process'" packages/cli/src` - expect only files under `packages/cli/src/adapters/`; read the `add`/`remove` failure branch and compare it to `packages/cli/src/adapters/process-vcs.ts:17-26`, confirming the message contains the command, the joined arguments and the directory, and that the original error is attached as `cause`.
  - *Status:* ☐ unverified

- **O4 - Recording fake and the ports table.**
  - *Claim:* no test spawns a process, `createTestContext` defaults `ports.packages` to a recording fake, and DEVELOPMENT.md's ports table lists the port.
  - *Evidence to collect:* read the recording fake and the `ports` object in `packages/cli/src/test-support.ts` and confirm `ports.packages` is defaulted there; run `pnpm --filter blogwright test` and confirm no test invokes `createProcessPackageManager` (grep the test files for it - expect only `adapters/process-package-manager.test.ts`, and confirm that file exercises `detect` only, never `add`/`remove` against a real manager); read DEVELOPMENT.md §Hexagonal architecture's ports table for a `PackageManager` row naming `cli/src/ports.ts`, `createProcessPackageManager` (`cli/src/adapters/process-package-manager.ts`) and the recording fake.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewer runs the detect tests and greps the process boundary (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright test -- process-package-manager` and `grep -rn "node:child_process" packages/cli/src` and observe in-memory detection with no spawn, and a grep confined to `adapters/`.
  - *Evidence to collect:* run both commands; record the passing test names and the full grep output, confirming every path is under `packages/cli/src/adapters/`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/deploy.test.ts` calls `createTestContext()` with no `ports` override → expect the suite still passes with `ports.packages` present and never called : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/adapters/process-vcs.test.ts` exercises `createProcessVcs` in a tmp dir → expect the second `execFile`-owning adapter changes nothing about it : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.ts:110` `createContext` builds the `Ports` object for every real CLI run → expect the added field to require no new adapter construction outside the composition root : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: which managers count as "supported" is an implementation choice; the obligations require only that every entry in the module's lockfile table has a positive test and that the negative message is derived from that table. Whether `add` pins the CLI's own version is task 18's concern, not this task's. Bun's two historical lockfile names (`bun.lockb`, `bun.lock`) may both appear in the table; either way O2 requires a test per table entry.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
