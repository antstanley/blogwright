# Done Certificate - Task 22: Resolve the secretName default inside blogwright-pds instead of relying on core

**Task:** [22-pds_resolved_secret_name.md](22-pds_resolved_secret_name.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 22. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 22) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `requirePdsConfig` returns a resolved pds config whose `secretName` is always a `string`, applied inside the package from task 21's resolver, so every pds call site keeps a total type with no cast and no `!`.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the six pds commands (`packages/pds/src/commands.ts`), the OAuth session store keyed on the secret name (`packages/pds/src/oauth.ts:57`), `loadPdsSecret`/`updatePdsSecret` (`packages/pds/src/secret.ts:70,85`), or the pinned rkey vectors (`packages/pds/src/rkey.test.ts`).

## Obligations

- **O1 - `requirePdsConfig` returns a total `secretName`, without a cast.**
  - *Claim:* the return type of `requirePdsConfig` has `secretName: string` (required), and no call site in `packages/pds` reads it as possibly-undefined or reaches totality via `!` or a cast.
  - *Evidence collected:* `packages/pds/src/sync.ts:58` returns `ResolvedPdsConfig`, built as `{ ...pds, secretName: resolvePdsSecretName(pds, ctx.config.siteName) }` (`sync.ts:63`); `packages/pds/src/config.ts:25-27` declares `export interface ResolvedPdsConfig extends PdsConfig { secretName: string }`. `grep -rnE "secretName!|as ResolvedPdsConfig|as PdsConfig|as unknown as" packages/pds/src` returns no hit in production code - the only `as PdsConfig` hits are `config.ts:44` (task 21's `unknown` boundary, untouched) and three test fixtures (`sync.test.ts:76`, `test-support.test.ts:22`, and the pre-existing `config.test.ts:69-70` whose convention they follow). `pnpm typecheck` clean in all six packages.
  - *Checks:* the default is applied through task 21's `resolvePdsSecretName` imported from `./config.js` (`sync.ts:10,63`); no template literal is re-derived in `sync.ts`. **Post-task-27 probe (the load-bearing check):** `PdsConfig.secretName` made `?: string | undefined` in core with core's `mergeConfig` pds branch and `validateConfig` pds block deleted (exactly task 27's steps), then core AND pds rebuilt so the CLI resolves `blogwright-pds` through a freshly emitted `dist/index.d.ts` (verified: `dist/sync.d.ts` declares `requirePdsConfig(ctx): ResolvedPdsConfig`, `dist/config.d.ts` carries the interface, core's `dist/config.d.ts` carries the optional field). Result: `packages/pds` typecheck = **1 error**, `packages/pds/src/config.ts:57` in task 21's `validatePdsConfig`; `packages/cli` typecheck = **clean**. Differential against the same probe run with the six task-22 files reverted to `@-`: **7 errors** - `commands.ts:44,84,109`, `config.ts:45`, `oauth.ts:57`, `secret.ts:71,75`. Task 22 removes six of the seven widenings; the seventh is identical in both arms, so it is inherited from task 21, not introduced here (see Residue). No cast or `!` appears anywhere on the resolution path in either arm. Vitest aliases `blogwright-core` to core's source, so the pds suite was also run against the mutated core: **100/100 pass** with core's defaulting deleted at runtime.
  - *Status:* ☑ SATISFIED

- **O2 - Resolution and the absent-block refusal are both pinned.**
  - *Claim:* a `pds` block without `secretName` resolves to `<siteName>/atproto`; an explicit `secretName` is returned unchanged; an absent block still throws `config has no "pds" section - add it to config/production.jsonc`.
  - *Evidence collected:* `vitest run src/sync.test.ts src/test-support.test.ts src/config.test.ts --reporter=verbose` - 33/33 pass, including `requirePdsConfig > resolves the default "<siteName>/atproto" secretName when absent`, `requirePdsConfig > returns an explicit secretName unchanged`, `requirePdsConfig > throws when the config has no "pds" section`. The absent-block assertion is `toThrow('config has no "pds" section - add it to config/production.jsonc')` - the exact full string, not a loose regex on `pds` - and the `throw` line in `sync.ts:61` is unchanged context in the diff, byte-identical to `@-`.
  - *Checks:* the three tests exercise the resolver rather than a merged config: `ctxWithPds` (`sync.test.ts:69-73`) assigns `ctx.config.pds` **after** `createTestContext`, bypassing both `mergeConfig` and `createTestContext`'s own resolution, so the assertion can only be satisfied by `requirePdsConfig`. Confirmed by mutation, under the shipped core: replacing `sync.ts:63` with `return pds as ResolvedPdsConfig` fails `resolves the default …` (`expected undefined to be 'my-site/atproto'`); rewording the throw to `config has no pds section, add one` fails `throws when the config has no "pds" section`; making `resolvePdsSecretName` ignore an explicit value fails 6 tests across `sync.test.ts`, `config.test.ts` and `commands.test.ts`.
  - *Status:* ☑ SATISFIED

- **O3 - `createTestContext` still yields a resolved secret name.**
  - *Claim:* `createTestContext` in `packages/pds/src/test-support.ts:96` produces a context whose `config.pds.secretName` is resolved even when the overrides omit it, so `packages/pds/src/test-support.test.ts:6` ("builds a complete pds context with merged, validated config defaults") stays true after task 27.
  - *Evidence collected:* `test-support.ts:102-104` resolves **after** `mergeConfig` (`const config = mergeConfig(...)` at `:101`, then `if (config.pds) config.pds = { ...config.pds, secretName: resolvePdsSecretName(config.pds, config.siteName) }`). `test-support.test.ts:17-24` asserts `createTestContext({ config: { pds: { name: 'Ant' } as PdsConfig } })` yields `ctx.config.pds?.secretName === 'example/atproto'` - a test, not inspection. `vitest run src/test-support.test.ts`: 6/6 pass, and the original claim at `:7` passes unmodified.
  - *Checks:* deleting the three-line resolution block from `test-support.ts` under the shipped core leaves the test green (core still defaults today), so it was re-run under the simulated post-27 core, where it fails with `expected undefined to be 'example/atproto'`. The obligation is therefore pinned for the state it exists to protect.
  - *Status:* ☑ SATISFIED

- **O4 - One construction site in the package, rkey vectors untouched, behaviour neutral.**
  - *Claim:* `packages/pds/src` builds the `<siteName>/atproto` template in exactly one place with no third copy anywhere in the repository, `packages/pds/src/rkey.ts` and `packages/pds/src/rkey.test.ts` are byte-identical, and every config naming a `secretName` today produces the same value as before.
  - *Evidence collected:* ``grep -rn '/atproto`' --include='*.ts' packages`` returns exactly two construction sites - `packages/pds/src/config.ts:34` (`defaultSecretName`) and `packages/core/src/config.ts:295` (core's copy, which task 27 deletes; the certificate's `:269` is line drift from tasks landed since it was authored). Every other `/atproto` hit is an assertion, a fixture, a doc comment, or the unrelated `src/data/atproto.json` path. `jj diff --name-only` lists only the six task files; `jj diff --stat packages/pds/src/rkey.ts packages/pds/src/rkey.test.ts` is empty and `jj file show -r @- <path> | diff - <path>` is empty for both. `pnpm test` in `packages/pds`: 100/100, with `sync.test.ts:174,257` and `commands.test.ts:25,176` (`secretName: 's'`) unmodified and passing.
  - *Checks:* behaviour neutrality traced directly, not assumed. `resolvePdsSecretName` is `pds.secretName ?? defaultSecretName(...)`, the same `??` core applies, so an explicit value is returned identically; a scratch probe asserted `requirePdsConfig(ctx)` is field-equal to `ctx.config.pds` with an identical key set for a block carrying `name`, `description`, `handleResolver` and `secretName`, and that a second call equals the first (idempotent). One deliberate delta: `requirePdsConfig` now returns a **copy** rather than `ctx.config.pds` itself. Checked safe - no consumer mutates the returned object (`grep -nE "^\s*pds\.[A-Za-z]+\s*=|Object\.assign\(pds"` finds nothing), no consumer compares it by identity, and neither `publicationRecord` (`sync.ts:104`) nor `clientMetadata` (`client-metadata.ts:41`) spreads the block wholesale - both read named fields, so an added `secretName` key cannot leak into a published record.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the repo root - `pnpm build` (all six packages Done), `pnpm test` (core 133, pds 100, cli 248, build-agent 27, analytics 2; 0 failures), `pnpm lint` (exit 0; the only warnings are 25 pre-existing `no-shadow` hits in `packages/cli/src/nodes.test.ts`, a file this task does not touch - `packages/pds` lint is clean), `pnpm exec oxfmt --check .` ("All matched files use the correct format", 142 files), `pnpm knip` (exit 0, no report - `ResolvedPdsConfig` is consumed by `sync.ts` and `oauth.ts` so the new export is not orphaned), `pnpm typecheck` (all six packages Done). Pinned rkey vectors pass inside the pds run. No changeset was added - `jj diff --name-only` lists six `packages/pds/src` files and nothing under `.changeset/` (the three changesets present are from earlier tasks), which is correct: `ResolvedPdsConfig` is internal to the package, `packages/pds/src/index.ts` re-exports only `./commands.js` and the context types, and nothing user-visible moves until task 27.
  - *Checks:* no new literal limits introduced; the one template lives in `defaultSecretName`.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `pnpm test` in `packages/pds` with untouched rkey files (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test` in `packages/pds` and observe the new resolution tests passing alongside every existing explicit-`secretName` fixture, with an empty rkey diff.
  - *Evidence collected:* `pnpm test` in `packages/pds` - `Test Files 10 passed (10)`, `Tests 100 passed (100)`, including the four new cases (three `requirePdsConfig` cases, one `createTestContext` case) and the untouched `oauth.test.ts:13`, `secret.test.ts:55`, `commands.test.ts:25,176`, `sync.test.ts:174,257` fixtures. rkey diff empty per O4.
  - *Caveat on the literal command:* `git diff packages/pds/src/rkey.ts packages/pds/src/rkey.test.ts` in this jj workspace prints a spurious rename-detected diff between the two files, because git's index is not the jj working copy. The authoritative checks - `jj diff --stat` on both paths, and `jj file show -r @-` piped to `diff` for each - are both empty, so the files are byte-identical to the parent. A reviewer running the `Reviewable:` line verbatim in a jj workspace should use the jj form.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/pds/src/commands.ts:107` (`secretDelete`) calls `requirePdsConfig` with a context whose config has `pds: { name: 'Ant Stanley', secretName: 's' }` → expect `pds.secretName === 's'` and the refusal message `refusing to delete secret "s" without --yes` : ☑ PRESERVED. `secretDelete` has no committed test (a pre-existing gap; `commands.ts` is untouched here), so this was discharged by execution: a scratch vitest probe confirmed the refusal message verbatim, that `--yes` calls `deleteSecret('s')`, and - with `secretName` deleted from the block to simulate post-27 - that it calls `deleteSecret('my-site/atproto')` rather than `deleteSecret(undefined)`.
- `packages/pds/src/oauth.ts:57` (`sessionStoreForSecret`) calls `requirePdsConfig(ctx).secretName` for a configured context → expect the same secret name the OAuth tests at `packages/pds/src/oauth.test.ts:13` already assume : ☑ PRESERVED. `oauth.test.ts` passes unmodified; the scratch probe additionally confirmed the store is keyed on the resolved name (`my-site/atproto`) when the block omits `secretName`. `requireClientKey`'s parameter retype (`PdsConfig` → `ResolvedPdsConfig`, `oauth.ts:33`) is a narrowing of a private function's parameter; its three call sites all pass a `requirePdsConfig` result.
- `packages/pds/src/secret.ts:70` (`loadPdsSecret`) calls `requirePdsConfig` → expect ``no secret at "s" - create it with `blogwright pds keygen` `` unchanged when the secret is missing : ☑ PRESERVED. `secret.test.ts` passes unmodified and the scratch probe asserted the full message string.

Cross-package: `packages/cli/src/commands.ts:2` imports `syncAfterDeploy`, the path that reaches `requirePdsConfig` with a plain `OpsContext` and no dispatch boundary. `packages/cli` typechecks clean both today and under the post-27 probe, so the structural satisfaction of `PdsContext` by `OpsContext` survives the new return type. No file outside `packages/pds` references `requirePdsConfig` or `ResolvedPdsConfig`.

## Residue

Core still applies its own default at `packages/core/src/config.ts:295` until task 27, so the
resolution added here is idempotent rather than load-bearing at this point in the order. The
implementation anticipated that: `sync.test.ts`'s `ctxWithPds` sets `ctx.config.pds` after
context construction, and the `createTestContext` case was verified by mutation under a
simulated post-27 core rather than against a merged config, so neither test is a tautology.

One forward hazard, found by the probe and **not introduced by this task**:
`packages/pds/src/config.ts:57` (`validatePdsConfig`, task 21) passes `cfg.secretName` to
`RegExp.test`, which becomes `string | undefined` the moment core's field goes optional -
`error TS2345`, present identically in the without-task-22 arm of the differential. It is
outside task 22's stated scope (the task's pointers enumerate the `commands.ts`/`oauth.ts`/
`secret.ts` consumers; `config.ts` is named only as the resolver this task consumes), but
task 27's DoD asserts "everything reading `secretName` compiles", and it will not until that
line is handled - either by resolving before the character-class check, or by treating an
absent `secretName` as valid at the boundary. Worth noting for whoever lands 27 or 28: at
runtime the untyped call is benign (`RegExp.test(undefined)` tests the string `"undefined"`,
which matches the permitted class), so this fails the build, not the behaviour.

`packages/cli/src/nodes.ts:925` still reads `ctx.config.pds.secretName` straight from core's
default; task 23 rewires it and task 27 adds the inline `??` in the interim. Confirmed still
present and untouched here.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied with executed evidence - a post-task-27 differential probe (core's field made optional, core and pds rebuilt so the CLI resolves the emitted `dist/index.d.ts`) cuts `packages/pds`'s `string | undefined` reads from seven to one inherited task-21 line with `packages/cli` clean, three implementation mutations confirm the new tests fire, and all six gates plus the pds suite (100/100, also 100/100 against the simulated post-27 core) are green with no cast, no `!`, no changeset, and byte-identical rkey files.
