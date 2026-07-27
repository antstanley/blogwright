# Task 21 — Add the pds config validator and secretName default to blogwright-pds

**Plan:** [plan.md](../plan.md) · **Certificate:** [21-pds_config_ownership-certificate.md](21-pds_config_ownership-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Config ownership (Add)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) (the plugin owns the `pds` block end to end: the three checks core performs today plus the `<siteName>/atproto` default)
**Depends on:** —
**Produces:** `packages/pds/src/config.ts`, owning the `pds` config block end to end — the three checks lifted verbatim from core plus the `<siteName>/atproto` secret-name derivation — with negative-space tests; purely additive, because core still validates at this point
**Pointers:** `packages/core/src/config.ts:314-330` (the `cfg.pds` block in `validateConfig` — the three checks and their exact message strings), `packages/core/src/config.ts:266-271` (the `raw.pds` branch in `mergeConfig`, where `secretName: raw.pds.secretName ?? \`${cfg.siteName}/atproto\`` lives at `:269`), `packages/core/src/config.ts:31-44` (the `PdsConfig` type the validator narrows to), `packages/pds/src/config.ts` (new — the validator and the secret-name resolver live here), `packages/pds/src/config.test.ts` (new — the moved negative-space coverage)

## Steps

- [ ] Create `packages/pds/src/config.ts` opening with a module comment stating that this package owns the `pds` config key, and export `validatePdsConfig(raw: unknown): PdsConfig` (the boundary check core performs today) plus `resolvePdsSecretName(pds: PdsConfig, siteName: string): string` (the `<siteName>/atproto` derivation), both importing only types from `blogwright-core`.
- [ ] Lift the three checks from `packages/core/src/config.ts:315-329` into `validatePdsConfig` with their message strings copied character for character — `config.pds.name is required`, `config.pds.handleResolver must be a URL, got "…"`, `config.pds.handleResolver must be https, got "…"`, `config.pds.secretName has invalid characters: "…"` — keeping the `new URL(...)` try/catch ordering so a non-URL resolver reports "must be a URL" and an `http://` resolver reports "must be https".
- [ ] Lift the derivation from `packages/core/src/config.ts:269` into `resolvePdsSecretName`, so the `<siteName>/atproto` template has one home in this package; keep the character-class regex `^[\w/+=.@-]+$` beside it as a named constant rather than an inline literal at the call site.
- [ ] Write `packages/pds/src/config.test.ts` pairing each rejection with its accepting neighbour: blank/whitespace `name` versus a real one, `http://resolver` and `nope` versus `https://resolver.example`, a `secretName` containing a character outside the class versus one inside it, and the default versus an explicit override.
- [ ] Leave `packages/core/src/config.ts` and `packages/core/src/config.test.ts` untouched — this task adds a second implementation deliberately; task 27 deletes core's.

## Definition of done

- [ ] `packages/pds/src/config.ts` exports a validator for the `pds` block plus a function deriving the secret name (`<siteName>/atproto` when `secretName` is absent, the explicit value otherwise), and imports only `blogwright-core` types — no `node:fs`, no `node:child_process`, no vendor SDK.
- [ ] The four error messages are byte-identical to the ones core raises today — `config.pds.name is required`, `config.pds.handleResolver must be a URL, got "…"`, `config.pds.handleResolver must be https, got "…"`, `config.pds.secretName has invalid characters: "…"` — so a reviewer can diff them against `packages/core/src/config.ts:314-330`.
- [ ] Negative-space tests cover each rejection: blank/whitespace `name`, an `http://` resolver, a non-URL resolver, and a `secretName` containing a character outside `^[\w/+=.@-]+$`; positive tests cover the derived default and an explicit `secretName` overriding it.
- [ ] No behaviour changes anywhere else: `mergeConfig` and `validateConfig` in `packages/core/src/config.ts` are byte-identical, the existing core config tests pass unmodified, and no changeset is written because nothing user-visible has moved yet.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- config` from the repo root; confirm the new `packages/pds/src/config.test.ts` cases pass, the existing `packages/core/src/config.test.ts` pds cases still pass, and `git diff packages/core` is empty.
