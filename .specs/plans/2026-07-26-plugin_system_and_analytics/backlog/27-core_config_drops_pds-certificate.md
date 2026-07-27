# Done Certificate — Task 27: Remove pds validation and defaulting from blogwright-core's config

**Task:** [27-core_config_drops_pds.md](27-core_config_drops_pds.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 27. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 27) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `blogwright-core`'s config module holds no pds domain knowledge — no handle resolver, no secret-name character class, no `<siteName>/atproto` default — while a config file carrying a `pds` block still typechecks and round-trips unchanged.
- **P2 — Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break `parseConfig`/`mergeConfig`/`validateConfig` for every non-pds field (`packages/core/src/config.ts:242-331`), `loadConfig` in the CLI (`packages/cli/src/context.ts:85`), `createTestContext` in both packages (`packages/cli/src/test-support.ts:151`, `packages/pds/src/test-support.ts:97`), or the IAM policy derivation at `packages/cli/src/nodes.ts:925`.

## Obligations

- **O1 — Core holds no pds domain knowledge, and `secretName` is optional on an exported type.**
  - *Claim:* `packages/core/src/config.ts` contains no `handleResolver`, `secretName` or `atproto` occurrence; the only `pds` hits are the `PdsConfig` declaration and the `OpsConfig.pds` field; `PdsConfig.secretName` is `string | undefined` and `PdsConfig` is still exported and reachable as `OpsConfig['pds']`.
  - *Evidence to collect:* run `grep -nE "handleResolver|secretName|atproto" packages/core/src/config.ts` (expect no hits) and `grep -n "pds" packages/core/src/config.ts` (expect only the type and the field); read `packages/core/src/config.ts:31-44`; run `pnpm typecheck` in `packages/core` and expect clean under `exactOptionalPropertyTypes`.
  - *Status:* ☐ unverified

- **O2 — Unknown keys survive, malformed unknown keys do not throw, and `pds` round-trips.**
  - *Claim:* an `analytics` block parses through with the key present and byte-equal; a malformed such block parses without throwing; a `pds` block comes back exactly as written, including the absence of `secretName`.
  - *Evidence to collect:* run `pnpm test -- config` in `packages/core` and record the three new case names and results; confirm the byte-equality assertion compares the parsed value against the literal written into the JSONC source, not against a hand-built object.
  - *Checks:* resolve where the unknown key survives — confirm it is the spread at `packages/core/src/config.ts:255`, and that no new allowlist or key filter was introduced alongside the removal.
  - *Status:* ☐ unverified

- **O3 — Coverage moved rather than disappeared.**
  - *Claim:* the four pds cases removed from `packages/core/src/config.test.ts:90-120` have one-to-one equivalents in `packages/pds/src/config.test.ts`, and the unknown-key-survival tests replace them in core.
  - *Evidence to collect:* list the four removed case names from `git diff packages/core/src/config.test.ts`; list the case names in `packages/pds/src/config.test.ts` and map each removed case to its equivalent; confirm the mapping is total, with the same inputs and the same expected messages.
  - *Status:* ☐ unverified

- **O4 — Every `secretName` reader compiles without a non-null assertion, and a changeset states the impact.**
  - *Claim:* `packages/pds` (via task 22's `ResolvedPdsConfig`) and `packages/cli/src/nodes.ts:925` (via this task's inline `??` default) compile against the now-optional field with no `!` and no cast, and a changeset records the semver impact of removed validation plus an optional published field.
  - *Evidence to collect:* run `pnpm typecheck` from the repo root and expect clean; run `grep -rnE "secretName!|pds!" packages --include=*.ts` and expect no hits; read the new `.changeset/*.md` and confirm it names `blogwright-core` with a bump and states both consequences.
  - *Checks:* resolve the default at `packages/cli/src/nodes.ts:925` — it must be the inline `` ctx.config.pds.secretName ?? `${ctx.config.siteName}/atproto` ``, NOT an import of `resolvePdsSecretName` from `blogwright-pds`. No task rewires this line to the plugin's resolver, and importing it would put plugin knowledge back into the site graph. Typechecking clean is not evidence here: `${string | undefined}` is legal in a template literal, so the wrong answer compiles.
  - *Status:* ☐ unverified

- **O5 — The deploy role's secret ARN is total for every input.**
  - *Claim:* `oidcRolePolicyStatements` over a `pds` block with no `secretName` yields `arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*` and never contains the substring `undefined`; the inline default carries a comment naming task 59 as its owner; `grep -c blogwright-pds packages/cli/src/nodes.ts` returns `0`.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/cli` and record the new case's name and result; read `packages/cli/src/nodes.ts:913-927` and confirm both the `??` and the comment; run the grep.
  - *Checks:* this is the obligation the task exists to protect, and it is invisible to the type system. `applyOidcRole` rewrites the entire `<env>-deploy` inline policy on every `blogwright bootstrap` (`packages/cli/src/nodes.ts:840-842,962`), so a `secret:undefined-*` here is a wrong permission written into a live role on the next routine bootstrap — never an exception, never a red test unless this one exists. If the test asserts only the happy path with `secretName` set explicitly, mark UNSATISFIED: that case passes with or without the default.
  - *Status:* ☐ unverified

- **O6 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean, with any import orphaned by the removal deleted rather than suppressed; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; confirm the changeset from O4 exists.
  - *Status:* ☐ unverified

- **O7 — Reviewable: gates plus a grep of core's config module (Reviewable).**
  - *Claim:* a reviewer can run `pnpm build && pnpm test && pnpm knip` from the repo root and then `grep -nE "handleResolver|secretName|atproto|pds" packages/core/src/config.ts`, seeing only the `PdsConfig` declaration and the `OpsConfig.pds` field.
  - *Evidence to collect:* run the three gates and capture the results; run the grep and capture its full output.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:94` (`loadConfig` → `parseConfig`) parses a production config carrying a `pds` block with no `secretName` → expect a successful parse with `cfg.pds.secretName` undefined and no throw : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:925` (`oidcRolePolicyStatements`) derives the secret ARN for that same config → expect `…:secret:example/atproto-*`, never `…:secret:undefined-*` : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:962` (`applyOidcRole` → `putRolePolicy`) is the consumer that makes the previous check load-bearing → expect the `<env>-deploy` document it sends for that config to carry the same ARN, since it is rewritten wholesale on every bootstrap : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/sync.ts:50` (`requirePdsConfig`) resolves the same config → expect `secretName` `example/atproto` : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/test-support.ts:151` and `packages/pds/src/test-support.ts:97` call `mergeConfig` with pds fixtures → expect every existing test in both packages to pass unmodified : ☐ (PRESERVED / REGRESSION)

## Residue

This is the deduplicated form of the plugin spec's core-stops-validating change and the pds spec's
core-drops-pds change; discharging it discharges both. Ordering is load-bearing, but not in the
way an earlier draft of this plan claimed. Task 23 does not touch
`packages/cli/src/nodes.ts:925` — it adds the plugin's own node and lifts `githubRole` into
`deriveNames` — so landing after it protects nothing about the ARN; the inline default this task
adds is what does, and it is why O5 exists. The edge to 23 is real for two other reasons: 23 makes
the grant reachable from the plugin, and it edits the same `packages/core/src/config.ts`. What must
hold as an ordering is the release constraint with task 28 — 27 removes core's pds validation and
28 pins what replaces it, and the validation-timing gap only becomes observable once core stops
validating. A validator should confirm that constraint held, not merely that the tests pass. Not covered by the DoD: config
files already on disk in consumer repos — they are unaffected by construction, since only the
location of the default and the checks moved.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
