# Done Certificate — Task 22: Resolve the secretName default inside blogwright-pds instead of relying on core

**Task:** [22-pds_resolved_secret_name.md](22-pds_resolved_secret_name.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 22. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 22) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `requirePdsConfig` returns a resolved pds config whose `secretName` is always a `string`, applied inside the package from task 21's resolver, so every pds call site keeps a total type with no cast and no `!`.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the six pds commands (`packages/pds/src/commands.ts`), the OAuth session store keyed on the secret name (`packages/pds/src/oauth.ts:57`), `loadPdsSecret`/`updatePdsSecret` (`packages/pds/src/secret.ts:70,85`), or the pinned rkey vectors (`packages/pds/src/rkey.test.ts`).

## Obligations

- **O1 — `requirePdsConfig` returns a total `secretName`, without a cast.**
  - *Claim:* the return type of `requirePdsConfig` has `secretName: string` (required), and no call site in `packages/pds` reads it as possibly-undefined or reaches totality via `!` or a cast.
  - *Evidence to collect:* read `packages/pds/src/sync.ts:50` and the `ResolvedPdsConfig` declaration in `packages/pds/src/config.ts`; run `grep -rnE "secretName!|as ResolvedPdsConfig|as PdsConfig|as unknown as" packages/pds/src` and expect no hits; run `pnpm typecheck` in `packages/pds` and expect clean.
  - *Checks:* resolve the default application inside `requirePdsConfig` — confirm it calls task 21's `resolvePdsSecretName` from `./config.js`, not a locally re-derived template literal.
  - *Status:* ☐ unverified

- **O2 — Resolution and the absent-block refusal are both pinned.**
  - *Claim:* a `pds` block without `secretName` resolves to `<siteName>/atproto`; an explicit `secretName` is returned unchanged; an absent block still throws `config has no "pds" section — add it to config/production.jsonc`.
  - *Evidence to collect:* run `pnpm test -- sync` and `pnpm test -- config` in `packages/pds`; record the three test names and their results, and confirm the absent-block assertion matches the message string exactly rather than a loose regex on `pds`.
  - *Status:* ☐ unverified

- **O3 — `createTestContext` still yields a resolved secret name.**
  - *Claim:* `createTestContext` in `packages/pds/src/test-support.ts:96` produces a context whose `config.pds.secretName` is resolved even when the overrides omit it, so `packages/pds/src/test-support.test.ts:6` ("builds a complete pds context with merged, validated config defaults") stays true after task 27.
  - *Evidence to collect:* read `packages/pds/src/test-support.ts:96-109` and confirm the resolution happens after `mergeConfig`; run `pnpm test -- test-support` in `packages/pds` and confirm a case constructing `{ config: { pds: { name: 'Ant' } } }` (no `secretName`) asserts `ctx.config.pds.secretName === 'example/atproto'`.
  - *Status:* ☐ unverified

- **O4 — One construction site in the package, rkey vectors untouched, behaviour neutral.**
  - *Claim:* `packages/pds/src` builds the `<siteName>/atproto` template in exactly one place with no third copy anywhere in the repository, `packages/pds/src/rkey.ts` and `packages/pds/src/rkey.test.ts` are byte-identical, and every config naming a `secretName` today produces the same value as before.
  - *Evidence to collect:* run `grep -rn "/atproto" packages/pds/src packages/cli/src packages/core/src --include=*.ts` and confirm the only construction sites are `packages/pds/src/config.ts` and the pre-existing `packages/core/src/config.ts:269` (all other hits must be assertions or fixtures, not derivations); run `git diff --stat packages/pds/src/rkey.ts packages/pds/src/rkey.test.ts` (expect no output); run `pnpm test` in `packages/pds` and confirm the fixtures at `sync.test.ts:141,224` and `commands.test.ts:25,176` (all `secretName: 's'`) pass unmodified.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm the pinned rkey vectors in `packages/pds/src/rkey.test.ts` pass; confirm a changeset exists only if a published type changed (it should not here).
  - *Status:* ☐ unverified

- **O6 — Reviewable: `pnpm test` in `packages/pds` with untouched rkey files (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test` in `packages/pds` and observe the new resolution tests passing alongside every existing explicit-`secretName` fixture, with an empty rkey diff.
  - *Evidence to collect:* run `pnpm test` in `packages/pds` and capture the full pass list; run `git diff packages/pds/src/rkey.ts packages/pds/src/rkey.test.ts` and capture the empty output.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/pds/src/commands.ts:107` (`secretDelete`) calls `requirePdsConfig` with a context whose config has `pds: { name: 'Ant Stanley', secretName: 's' }` → expect `pds.secretName === 's'` and the refusal message `refusing to delete secret "s" without --yes` : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/oauth.ts:57` (`sessionStoreForSecret`) calls `requirePdsConfig(ctx).secretName` for a configured context → expect the same secret name the OAuth tests at `packages/pds/src/oauth.test.ts:13` already assume : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/secret.ts:70` (`loadPdsSecret`) calls `requirePdsConfig` → expect `no secret at "s" — create it with \`blogwright pds keygen\`` unchanged when the secret is missing : ☐ (PRESERVED / REGRESSION)

## Residue

Core still applies its own default at `packages/core/src/config.ts:269` until task 27, so the
resolution added here is idempotent rather than load-bearing at this point in the order — a test
that only exercises `createTestContext` would pass even if the resolver were not called. O2 and O3
are the obligations that distinguish the two, so verify them against the resolver directly, not
against a merged config. `packages/cli/src/nodes.ts:925` still reads `ctx.config.pds.secretName`
straight from core's default; task 23 rewires it.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
