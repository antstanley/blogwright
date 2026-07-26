# Done Certificate — Task 44: The analytics config block, its defaults and its validator

**Task:** [44-analytics_config_block.md](44-analytics_config_block.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 44. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 44) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `AnalyticsConfig`, its defaults and `validateAnalyticsConfig` live in `packages/analytics/src/config.ts`: an empty block validates and yields every default, every limit is a named constant, every rejection names the offending key and value, and the table-bucket-per-environment open question is settled in code.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `blogwright-core`'s config surface: `parseConfig`/`mergeConfig`/`validateConfig` at `packages/core/src/config.ts:242-340` gain no `analytics` knowledge, `DEFAULT_CONFIG` at `:122-150` is unchanged, and every existing test in `packages/core/src/config.test.ts` still passes.

## Obligations

- **O1 — Shape, defaults and named constants.**
  - *Claim:* `AnalyticsConfig` carries `tableBucket`, `namespace` (default `web`), `table` (default `page_views`), `bots` (`'flag' | 'filter'`, default `flag`) and `dashboard.port` (default `4317`); a `{}` block validates and produces every default; defaults and limits are named module constants; the port default is one exported constant.
  - *Evidence to collect:* read `packages/analytics/src/config.ts` and compare its fields, patterns and defaults against `.specs/changes/2026-07-26-analytics_plugin.md:230-246`; run `pnpm test -- config` in `packages/analytics` › the `{}` case and confirm it asserts each default field by name; run `grep -n "4317\|1024\|65535\|63" packages/analytics/src/` and confirm each number appears once, in a named constant declaration, not at a call site.
  - *Checks:* resolve the port-default identifier the dashboard server will import — confirm it is exported from this module, so task 55 can share it rather than restate `4317`.
  - *Status:* ☐ unverified

- **O2 — The table-bucket open question is settled and implemented.**
  - *Claim:* the module records the decision (one bucket per environment, or one bucket with a namespace per environment) and implements it; a test asserts two environments cannot derive the same bucket name if per-environment was chosen.
  - *Evidence to collect:* read the decision note in the doc comment of `packages/analytics/src/config.ts` and confirm it states the answer and the reason (the proposed `<siteName>-analytics` default carries no environment); run `pnpm test -- config` › the two-environment case and confirm it derives the bucket for two different environment names and asserts the outcome the decision requires; confirm the derivation is a function of the environment, not a literal.
  - *Status:* ☐ unverified

- **O3 — Boundary and negative-space rejection, with named-value errors.**
  - *Claim:* `tableBucket` is tested at 2, 3, 63 and 64 characters and `dashboard.port` at 1023, 1024, 65535 and 65536; `namespace`/`table` outside `^[a-z0-9_]+$`, `bots` outside the union and an unknown key are all rejected; every message names the offending key and value.
  - *Evidence to collect:* run `pnpm test -- config` in `packages/analytics` and read the test-name list — expect eight distinct boundary cases (four accept, four reject) and four rejection cases; for each rejection, read the asserted message and confirm it contains both the dotted key path (`config.analytics.…`) and the offending value, matching the vocabulary at `packages/core/src/config.ts:275-277,281-283`.
  - *Status:* ☐ unverified

- **O4 — Optional-not-null, and the block is inert for core.**
  - *Claim:* absence is `?: T | undefined` with no `null` for a domain value, and a config carrying an `analytics` block passes core's `parseConfig` untouched when the plugin is not loaded.
  - *Evidence to collect:* run `grep -n "null" packages/analytics/src/config.ts` — expect no `null` return or parameter for a domain value; run `pnpm test -- config` › the inert-block case and confirm it calls `parseConfig` from `blogwright-core` with a document containing an `analytics` block, asserts no throw, and asserts the block survives on the returned config unchanged.
  - *Checks:* resolve `parseConfig` in that test — confirm it is the import from `blogwright-core` (`packages/core/src/config.ts:242`), not a local helper.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Reviewable: named defaults and eight named boundary tests (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- config` inside `packages/analytics` and observe that the `{}` case asserts every default by name and that each of the eight boundary cases is its own named test carrying the value in its name.
  - *Evidence to collect:* run `pnpm test -- config` from `packages/analytics` with reporter output showing test names; read `packages/analytics/src/config.test.ts` and confirm the `{}` assertion enumerates `tableBucket`, `namespace`, `table`, `bots` and `dashboard.port`, and that the boundary test names contain `2`, `3`, `63`, `64`, `1023`, `1024`, `65535` and `65536`.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/core/src/config.ts:242` `parseConfig` is called by the CLI's config loading with a document containing an `analytics` block → expect the existing `packages/core/src/config.test.ts` suite to pass unchanged and the block to survive as an unvalidated passthrough : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/index.ts` re-exports the package surface consumed by later tasks → expect `pnpm knip` to report no unused export after the config module is added : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: `OpsConfig` in core carries no `analytics` field, so the inert-block test may need a cast at the boundary — a `JSON.parse(…) as T` style cast is acceptable per DEVELOPMENT.md §Error handling only when validation follows; flag a cast that hides a missing validation. Whether the plugin's `configKey`/`validateConfig` wiring reaches the CLI is task 47's obligation, not this one's — this task only owns the shape, the defaults and the validator. The `bots` default's effect on query defaults is task 45's obligation.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
