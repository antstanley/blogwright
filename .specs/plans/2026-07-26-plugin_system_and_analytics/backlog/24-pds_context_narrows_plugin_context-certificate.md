# Done Certificate — Task 24: Redefine PdsContext as a narrowing of core's PluginContext

**Task:** [24-pds_context_narrows_plugin_context.md](24-pds_context_narrows_plugin_context.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 24. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 24) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `PdsContext` is expressed as a narrowing of core's `PluginContext`, with `PdsLogger`/`PdsPorts` as aliases of the core types, and an explicit compile-time assignability test replaces the implicit proof `runPds` provides today.
- **P2 — Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break every `PdsContext` consumer in `packages/pds` (`commands.ts`, `oauth.ts`, `secret.ts`, `sync.ts`, `content.ts`, `client-metadata.ts`), the `packages/pds/src/index.ts:8` type re-exports, or the CLI's ability to pass `OpsContext` straight into a pds function.

## Obligations

- **O1 — No structural duplication, and the change is type-only.**
  - *Claim:* `packages/pds/src/context.ts` contains no re-declaration of core's logger or ports field shapes; `PdsLogger` and `PdsPorts` resolve to the core types and `PdsContext` is derived from `PluginContext`, narrowed to `{ secrets }` and the `fs`/`terminal` ports; no runtime file in `packages/pds/src` changed.
  - *Evidence to collect:* read `packages/pds/src/context.ts` in full and record each declaration; run `git diff --stat packages/pds/src` and confirm the only changed file is `context.ts` (plus tests), with no `.ts` module that emits runtime code touched.
  - *Checks:* resolve `PdsLogger` and `PdsPorts` in an editor or via `tsc --noEmit` diagnostics — confirm they alias core's declarations rather than being independently written interfaces that merely happen to match.
  - *Status:* ☐ unverified

- **O2 — The package imports nothing from the CLI.**
  - *Claim:* `packages/pds` imports no type or value from `packages/cli`.
  - *Evidence to collect:* run `grep -rn "from 'blogwright" packages/pds/src --include=*.ts` and confirm every specifier is `blogwright-core` (or `blogwright-core/...`); run `grep -rn "\.\./\.\./cli" packages/pds/src` and expect no hits.
  - *Status:* ☐ unverified

- **O3 — The assignability proof is explicit and load-bearing.**
  - *Claim:* a compile-time test in the CLI asserts `OpsContext` satisfies `PdsContext` by plain assignment, and it would fail the build if the narrowing widened.
  - *Evidence to collect:* read the new assertion in `packages/cli/src/context.test.ts`; temporarily add a required field to `PdsContext` locally and run `pnpm typecheck` in `packages/cli` to confirm the assertion fails, then revert.
  - *Checks:* resolve the `PdsContext` symbol the test imports — confirm it comes from `blogwright-pds`'s public surface (`packages/pds/src/index.ts:8`), not from a locally redeclared shape.
  - *Status:* ☐ unverified

- **O4 — The narrowing is a `Pick`, and the five dispatch-only fields are outside it.**
  - *Claim:* `PdsContext` is written as a `Pick` over `PluginContext<PdsConfig>` rather than an `Omit`, it names none of `pluginConfig`, `state`, `siteState`, `store` or `record`, and `packages/cli/src/commands.ts:97` still passes its plain `OpsContext` to `syncAfterDeploy` with no adaptation.
  - *Evidence to collect:* read the `PdsContext` declaration and confirm the picked set is exactly `env`, `domain`, `config`, `clients`, `ports`, `logger` and optional `tags` — an `Omit` here is a defect even when it typechecks, because it silently admits `preview`, `names`, `accountId` and `save()`; optionality is not the tell, since `Pick` and `Omit` preserve it identically and task 01 declares `tags` optional; run `grep -n "pluginConfig\|siteState\|record" packages/pds/src/context.ts` and expect no output; run `pnpm typecheck` from the repo root and confirm `packages/cli/src/commands.ts` compiles unchanged.
  - *Checks:* temporarily add `pluginConfig` to `PdsContext` and re-run `pnpm typecheck` — expect `TS2345: Argument of type 'OpsContext' is not assignable to parameter of type 'PdsContext'`, whose nested elaboration reads *"Property 'pluginConfig' is missing in type 'OpsContext' but required in type 'PdsContext'"*, pointing at `commands.ts:97`; then revert. The code is the argument-position one, not `TS2741`. That error is the failure this obligation exists to keep out of the post-deploy sync, which is the one path the migration promises not to disturb.
  - *Status:* ☐ unverified

- **O5 — The pds test factory stays cheap.**
  - *Claim:* `createTestContext` in `packages/pds/src/test-support.ts:96` still returns a complete `PdsContext` while constructing only a secrets client, an in-memory `FileSystem`, a silent `Terminal`, and a logger — no full `AwsClients` set, no `StateStore`.
  - *Evidence to collect:* read `packages/pds/src/test-support.ts:96-109` and list what it constructs; run `pnpm test -- test-support` in `packages/pds` and confirm the existing cases pass without new fixtures.
  - *Status:* ☐ unverified

- **O6 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; a type-only internal change needs no changeset.
  - *Status:* ☐ unverified

- **O7 — Reviewable: `pnpm typecheck && pnpm test` with an unchanged test count plus one (Reviewable).**
  - *Claim:* a reviewer can run `pnpm typecheck && pnpm test` from the repo root and observe the same tests as before plus the new assignability test, then read `packages/pds/src/context.ts` and see three declarations with no repeated field shapes.
  - *Evidence to collect:* run `pnpm typecheck && pnpm test` from the repo root and capture the totals before and after; capture `packages/pds/src/context.ts` verbatim.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/commands.ts:97` calls `syncAfterDeploy(ctx)` with an `OpsContext` → expect the call to typecheck by plain assignment with no cast : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/oauth.ts:44` reads `ctx.clients.secrets` and `ctx.ports.terminal` from a `PdsContext` → expect both still present and typed after the narrowing : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/commands.ts:57` calls `ctx.ports.fs.writeText(...)` → expect the `FileSystem` port surface unchanged : ☐ (PRESERVED / REGRESSION)

## Residue

The assignability proof matters more than it looks: until task 29, `packages/cli/src/cli.ts:213`
still passes `ctx` into `pds.keygen`, so a broken narrowing would be caught by the build anyway —
which means O3's test could pass vacuously today and only start earning its keep after `runPds` is
deleted. Verify O3 by the deliberate-break procedure, not by its presence. Note the asymmetry with
task 01: an `OpsContext` *is* assignable to `PdsContext` (the narrow, no-state slice) and is *not*
assignable to a full `PluginContext`, which is why task 01 gates a composition and this task gates a
plain assignment. `PluginContext` does carry a scoped `StateStore` (task 01), and the `Pick` leaves
it out, which is exactly what keeps `packages/pds/src/test-support.ts` from having to build one.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
