# Done Certificate — Task 43: Bundle the transform with rolldown and stamp a reproducible source hash

**Task:** [43-transform_bundle_and_source_hash.md](43-transform_bundle_and_source_hash.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 43. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 43) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** The package's `build` script produces a single-file ESM bundle of the transform plus a manifest carrying a source hash that is byte-stable across runs and changes on any source byte, and exports the zip key derived from it for task 50's function node.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the build-agent's own hashing (`packages/build-agent/src/agent-hash.ts`) or its `dist/agent-manifest.json` — a changed builder-image key forces a rebuild for every consumer; and must not break the package's existing `build`/`typecheck` scripts for `src/`, nor the lint gate for the four existing packages when the `.oxlintrc.json` override list is edited.

## Obligations

- **O1 — Single-file ESM bundle from a clean checkout.**
  - *Claim:* rolldown bundles the transform to one ESM file with `node:` builtins external, produced by the package's `build` script, reproducible from a clean checkout.
  - *Evidence to collect:* read `packages/analytics/src/transform/rolldown.config.ts` and confirm `platform: 'node'`, `format: 'esm'` and `codeSplitting: false` against `packages/build-agent/rolldown.config.ts`; run `pnpm --filter blogwright-analytics build` after removing the package's build output and confirm exactly one bundle file is emitted; run `grep -n "^import .*from 'node:" <bundle>` and confirm `node:` imports remain external rather than inlined.
  - *Status:* ☐ unverified

- **O2 — Source-hash inputs and stability.**
  - *Claim:* the hash covers the transform's source (not the bundle), includes the rolldown config, `tsconfig.json` and `package.json`, is byte-stable across two runs over identical source, and changes when one source byte changes.
  - *Evidence to collect:* read `packages/analytics/src/transform-hash.ts` and compare its input list against `packages/build-agent/src/agent-hash.ts:35-49`; confirm the bundle path is absent from the input list; run `pnpm test -- transform-hash` in `packages/analytics` and confirm both the stability test and the changed-byte test pass.
  - *Checks:* resolve the file-reading call inside `transform-hash.ts` — confirm whether it is `node:fs` (which requires an `.oxlintrc.json` override entry) or the injected `FileSystem` port from `blogwright-core`; either is acceptable, but an unlisted `node:fs` import fails `pnpm lint`, so confirm the lint gate is green either way.
  - *Status:* ☐ unverified

- **O3 — The hash is stamped into a build-time manifest.**
  - *Claim:* a manifest file beside the bundle carries the hash, written at build time, so the plugin reads it at runtime without the source tree.
  - *Evidence to collect:* run `pnpm --filter blogwright-analytics build` and read the emitted manifest file — expect a JSON object carrying the hash; confirm `packages/analytics/package.json` `build` invokes the manifest writer after the bundle step, mirroring `packages/build-agent/package.json:7`; confirm the manifest path is inside the package's `files` array so it ships.
  - *Status:* ☐ unverified

- **O4 — One home for the zip key.**
  - *Claim:* the zip key derived from the hash is exported from `packages/analytics/src/transform-hash.ts` and its format is written in exactly one module.
  - *Evidence to collect:* read the export and confirm it derives the key from the hash rather than accepting a pre-formatted string; run `grep -rn "\.zip" packages/analytics/` and confirm the key format literal appears in exactly one module; confirm `pnpm knip` does not report the export unused (task 50 is its consumer — if knip flags it, confirm the recorded exception carries a reason, as the CLI's `blogwright-build-agent` entry does at `knip.json:9`).
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: two builds agree, a changed byte disagrees (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics build` twice from a clean checkout and observe an identical manifest hash, then change one byte in `packages/analytics/src/transform/map-record.ts`, rebuild, and observe both the hash and the derived zip key change.
  - *Evidence to collect:* run the build twice, capturing the manifest contents after each; edit one byte of `packages/analytics/src/transform/map-record.ts` (a comment character suffices), rebuild, capture the manifest again, and confirm the hash differs from the first two; restore the file and rebuild to confirm the original hash returns.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `.oxlintrc.json:71-84` (the `no-restricted-imports` override list, edited here) is read by `oxlint` in every package's `lint` script → expect `packages/core`, `packages/cli`, `packages/pds` and `packages/build-agent` to still lint clean, and a deliberate `node:fs` import added to a domain module outside the list to still error : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/package.json` `build` (rewritten here) is invoked by the root `pnpm -r build` → expect `tsc -p tsconfig.json` still to emit `dist/` for `src/` alongside the new bundle step : ☐ (PRESERVED / REGRESSION)
- `packages/build-agent/src/agent-hash.ts` `agentSourceHash` is called by `packages/build-agent/src/write-manifest.ts` at build time → expect `dist/agent-manifest.json` to carry the same hash as before this task : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: whether the lockfile belongs in the hash inputs is a judgement call — `agentSourceHash` includes it at `packages/build-agent/src/agent-hash.ts:47` because a dependency bump within range changes the emitted bundle; the DoD names only the rolldown config, `tsconfig.json` and `package.json`, so a missing lockfile input is residue to note, not an obligation failure. The zip's actual construction and upload belong to task 50; this task only fixes the key. The hash truncation length (`agentSourceHash` slices to 12 hex characters) is unconstrained here.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
