# Done Certificate - Task 26: Declare the plugin manifest field in packages/pds/package.json

**Task:** [26-pds_package_manifest.md](26-pds_package_manifest.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 26. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 26) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright-pds` is discoverable as the `pds` plugin from a consuming repo depending only on `blogwright`, with `blogwright plugin list` reporting it, while `blogwright pds <action>` still runs through the hardcoded branch so nothing user-visible moves yet.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the published `blogwright-pds` export map (`packages/pds/package.json:9-18`), the `blogwright/rkey` re-export (`packages/cli/src/rkey.ts:7`), or the current `runPds` dispatch (`packages/cli/src/cli.ts:114-116`).

## Obligations

- **O1 - The manifest field is present and nothing else in the package moved.**
  - *Claim:* `packages/pds/package.json` declares `"blogwright": { "plugin": "pds" }`, keeps `"name": "blogwright-pds"`, and leaves the `.` and `./rkey` export conditions byte-identical.
  - *Evidence to collect:* run `git diff packages/pds/package.json` and confirm the only added lines are the `blogwright` object; run `node -e "const p=require('./packages/pds/package.json'); console.log(p.name, p.blogwright, JSON.stringify(p.exports))"` and compare the exports string against the pre-change value.
  - *Status:* ☐ unverified

- **O2 - Bundled discovery works from a consumer that depends only on `blogwright`.**
  - *Claim:* the CLI discovers `blogwright-pds` when the consuming repo's `package.json` lists `blogwright` and nothing else - the guarantee the migration's "no install step" claim rests on.
  - *Evidence to collect:* run `pnpm test -- plugins` in `packages/cli`; record the test whose fixture repo `package.json` has `dependencies: { blogwright: '…' }` only, and confirm the assertion is that `pds` appears in the discovered set.
  - *Checks:* resolve the discovery path taken in that test - confirm it goes through the CLI's own bundle (the `blogwright-pds` entry at `packages/cli/package.json:28`) via the injected `ModuleLoader` port, not through a bare dynamic `import()` and not by scanning the consumer's dependency list.
  - *Status:* ☐ unverified

- **O3 - `plugin list` reports the pds row.**
  - *Claim:* `blogwright plugin list` reports `pds` with its namespace, the package version, and the `pds` config key.
  - *Evidence to collect:* run `pnpm test -- plugin` in `packages/cli` and record the `plugin list` case's asserted output line; confirm it asserts all three fields, not the namespace alone.
  - *Status:* ☐ unverified

- **O4 - The rkey subpath and today's pds dispatch are untouched.**
  - *Claim:* `blogwright/rkey` still re-exports `blogwright-pds/rkey` with `packages/cli/src/rkey.test.ts` unmodified, and `blogwright pds <action>` still reaches `runPds`.
  - *Evidence to collect:* run `git diff packages/cli/src/rkey.test.ts` (expect no output) and `pnpm test -- rkey` in `packages/cli`; read `packages/cli/src/cli.ts:114-116` and confirm the `command === 'pds'` branch is still present and still precedes any plugin dispatch; run `pnpm test -- cli` and confirm the pds dispatch cases pass unchanged.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; a changeset is not required while behaviour is unchanged, and task 30 writes the migration's changeset.
  - *Status:* ☐ unverified

- **O6 - Reviewable: `pnpm test -- plugins` and `pnpm test -- rkey` (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- plugins` and `pnpm test -- rkey` in `packages/cli` and observe the bundled-discovery case passing, the `plugin list` row naming `pds`, and the rkey vectors untouched.
  - *Evidence to collect:* run both commands in `packages/cli` and capture the pass lists; capture `git diff packages/pds/package.json`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/rkey.ts:7` re-exports from `blogwright-pds/rkey` → expect resolution unchanged after the manifest field is added : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/cli.ts:115` calls `runPds(positionals, values, terminal, logger)` for `blogwright pds sync` → expect the same exit code and the same `sync` call as before : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/plugins.ts` (task 08 discovery) now finds a second candidate → expect no reserved-name or duplicate-name error, since `pds` is neither a built-in command nor claimed twice : ☐ (PRESERVED / REGRESSION)

## Residue

`pds` is not in the reserved set from task 09 (`init`, `bootstrap`, `deploy`, `rollback`, `delete`,
`destroy`, `history`, `logs`, `status`, `preview`, `plugin`) - deliberately, since task 29 hands the
namespace to the plugin. A validator should confirm the collision rules still let `pds` through
rather than assuming it. Not covered by the DoD: whether discovery cost is measurable on the
built-in command paths now that a plugin actually exists to find; task 28 owns the eager/lazy
question.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
