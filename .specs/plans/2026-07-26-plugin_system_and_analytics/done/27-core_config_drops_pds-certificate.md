# Done Certificate - Task 27: Remove pds validation and defaulting from blogwright-core's config

**Task:** [27-core_config_drops_pds.md](27-core_config_drops_pds.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 27. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 27) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright-core`'s config module holds no pds domain knowledge - no handle resolver, no secret-name character class, no `<siteName>/atproto` default - while a config file carrying a `pds` block still typechecks and round-trips unchanged.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `parseConfig`/`mergeConfig`/`validateConfig` for every non-pds field, `loadConfig` in the CLI, `createTestContext` in both packages, or the IAM policy derivation in `packages/cli/src/nodes.ts`.

## Validation history

First discharge. Verified in `/Users/ant/code/blogwright-task-27` (jj workspace, base
`2ff2cb01f213` = build 51). Change surface is exactly 11 files (`jj diff --stat`:
+168/-92); no file outside `.changeset/`, `packages/cli/src/nodes*.ts`,
`packages/core/src/config*.ts` and `packages/pds/src/*` is touched.

**Scope note discovered mid-review:** the mainline bookmark advanced to build 52
(`c972d4e5f74d`, task 29) *during* this discharge. Task 29 deletes `runPds` and the
`command === 'pds'` branch, which is what routes `pds` through `runPlugin` →
`resolvePluginConfig` → `validatePdsConfig`. This ordering is load-bearing and is
re-verified under O2/Residue below; both the build-51 base and the build-52 rebase were
gated in full.

## Obligations

- **O1 - Core holds no pds domain knowledge, and `secretName` is optional on an exported type.**
  - *Claim:* `packages/core/src/config.ts` contains no `handleResolver`, `secretName` or `atproto` occurrence; the only `pds` hits are the `PdsConfig` declaration and the `OpsConfig.pds` field; `PdsConfig.secretName` is `string | undefined` and `PdsConfig` is still exported and reachable as `OpsConfig['pds']`.
  - *Evidence collected:* the `raw.pds` branch (baseline `:292-295`) and the `cfg.pds` block (baseline `:340-354`) are both **gone**; the baseline grep and the current grep were diffed directly. `mergeConfig` now runs `...DEFAULT_CONFIG, ...raw, …` straight into `validateConfig(cfg)` (`packages/core/src/config.ts:293-307`). `secretName?: string | undefined` at `:57`. All six gates clean.
  - *Adjudication - **the DoD text is defective**.* Bullet 1 demands `config.ts` contain "no occurrence of … `secretName`", while step 3 of the same task requires keeping `PdsConfig` **and** spelling its member `secretName?: string | undefined`. The two cannot both hold: the bullet is unsatisfiable as literally written. The self-consistent reading is the one the `Reviewable:` line gives - hits confined to the `PdsConfig` declaration and the `OpsConfig` field - and that is the reading discharged here. This is the second structurally unsatisfiable DoD item this build has found; the contract, not the implementation, is at fault.
  - *Residual grep hits adjudicated (implementer's argument upheld).* `PathsConfig`'s doc (`:61`), `atprotoJson` (`:69,:72`), its `DEFAULT_CONFIG` default (`:160`) and `Names.githubRole`'s doc (`:363-364`) all appear **byte-for-byte in the build-51 baseline** at the corresponding lines. `paths` is a core-declared key on `OpsConfig` validated by core's own `for` loop; `Names.githubRole` is core's derivation with two readers by design (task 23). Removing either would be wrong. **The implementer added new hits only inside the `PdsConfig` doc comment** (`:34-38`, `:54-55`) - prose naming the owner of the behaviour that left. Within the declaration, so within the `Reviewable:` formulation; the *behaviour* is gone, which is what P1 asks.
  - *Reachability proved, not assumed:* `packages/cli/src/nodes.test.ts:1` imports `type PdsConfig` from `'blogwright-core'` and the CLI typechecks **through core's built `dist/index.d.ts`** (`packages/pds/node_modules/blogwright-core -> ../../core`, `exports['.'].types = ./dist/index.d.ts`); `dist/config.d.ts:53` reads `secretName?: string | undefined`.
  - *Status:* ☑ SATISFIED (under the `Reviewable:` reading; DoD bullet 1 defective as written)

- **O2 - Unknown keys survive, malformed unknown keys do not throw, and `pds` round-trips.**
  - *Claim:* an `analytics` block parses through with the key present and byte-equal; a malformed such block parses without throwing; a `pds` block comes back exactly as written, including the absence of `secretName`.
  - *Evidence collected:* three new cases in `packages/core/src/config.test.ts`, all green. Survival resolves to the `...raw` spread at `packages/core/src/config.ts:295`; **no allowlist or key filter was introduced** alongside the removal (`validateConfig` ends in a comment, not a branch).
  - *Falsifiability - four mutations run, each restored:*
    - **M1** re-add the `raw.pds` branch → `round-trips a pds block exactly as written` fails (`expected { name, …(3) } to deeply equal { name, …(2) }`). 1 failed / 148 passed.
    - **M2** re-add the `cfg.pds` validation block → `parses a malformed plugin block without throwing` fails (`expected [Function] to not throw an error but 'Error: config.pds.name is required' was thrown`).
    - **M3** `delete cfg['analytics']` before validation → `passes a plugin block core knows nothing about through byte-equal` fails (`expected undefined to deeply equal { table: 'events', sample: 0.5 }`).
    - **M6** (the `toEqual`-tolerance probe the brief demanded) set `secretName` to an **explicitly `undefined`** key → `toEqual` **passes**, `expect(cfg.pds?.secretName).toBeUndefined()` **passes**, and only `expect(Object.keys(cfg.pds ?? {})).toEqual([...])` at `config.test.ts:141` catches it. **The `Object.keys` line is the sole guard and is load-bearing.**
  - *Behaviour shift - ruled INTENDED and correctly scoped.* A present-but-malformed `pds` block used to fail at `parseConfig` on any `blogwright` command; it now parses and is refused at dispatch. Driven end-to-end against the built `dist` on the build-52 rebase (real `resolvePluginConfig` + real `parseConfigDocument` + the real exported `pds` plugin, `configKey = pds`): all four malformed inputs parse OK then reject as `plugin "pds" rejected the "pds" config block: <original message>`, inner strings byte-identical to core's, `new URL` ordering preserved (`nope` → "must be a URL" before `http://` → "must be https"); a valid block with no `secretName` is accepted and returned unchanged. This is exactly what §Plugin SPI → *A plugin owns its own topography* and §CLI → Config ownership require ("no config key of a plugin's is read by a site node"; core "no longer validate[s] plugin-owned blocks").
  - *Status:* ☑ SATISFIED

- **O3 - Coverage moved rather than disappeared.**
  - *Claim:* the four pds cases removed from `packages/core/src/config.test.ts` have one-to-one equivalents in `packages/pds/src/config.test.ts`, and the unknown-key-survival tests replace them in core.
  - *Mapping verified total, each equivalent read and compared:*
    - `applies pds defaults (secretName from siteName)` → `pds/config.test.ts:83-85` `derives "<siteName>/atproto" when secretName is absent`. Same derivation.
    - `keeps explicit pds overrides` → `secretName` half at `pds/config.test.ts:87-89`; `handleResolver` half at `:36-41`; the `description` half moved to core's new `round-trips a pds block exactly as written` (which asserts `description: 'd'` survives **and** pins key order) - the correct home, since pass-through is now core's only remaining duty for the block.
    - `rejects a pds section without a name` → `pds/config.test.ts:10-18` (`''` and `'   '`). Core asserted the regex `/pds.name/`; pds asserts the **exact string** `config.pds.name is required`. **Stronger.**
    - `rejects a non-https pds handleResolver` (two assertions) → `pds/config.test.ts:24-28` and `:30-34`, both exact strings, **plus** `:43-49` pinning the try/catch ordering core never pinned. **Stronger.**
  - *Counts measured directly at both revisions, not taken from either prior report.* Baseline (build 51, all 11 files reverted, full rebuild + `pnpm test`): core **149** (+1 skipped), build-agent 27, pds **145**, analytics 701, cli **353**. After: core **149**, build-agent 27, pds **146**, analytics 701, cli **354**. Core is net-zero by design (4 removed, 4 added); pds +1; cli +1. **No test disappeared silently.** The reviewer's brief said cli was 363 - that is build **52**'s number (the rebase measures 364); the implementer's 353 was correct for its own base.
  - *Status:* ☑ SATISFIED

- **O4 - Every `secretName` reader compiles without a non-null assertion, and a changeset states the impact.**
  - *Claim:* `packages/pds` (via task 22's `ResolvedPdsConfig`) and the CLI's inline `??` default compile against the now-optional field with no `!` and no cast, and a changeset records the semver impact.
  - *Evidence collected:* `pnpm typecheck` clean from the repo root; no `secretName!` / `pds!` anywhere. The default at `packages/cli/src/nodes.ts:995` is the inline `` ctx.config.pds.secretName ?? `${ctx.config.siteName}/atproto` `` - **not** an import: `grep -n "blogwright-pds" packages/cli/src/nodes.ts` returns nothing (exit 1). The comment at `:976-987` names task 59 as the owner that deletes it and says explicitly it must not be replaced by an import.
  - *Routed TS2345 reproduced as a control.* Reverting **only** the narrowing in `packages/pds/src/config.ts:63` yields exactly the predicted diagnostic at the predicted call: `src/config.ts(63,33): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.` The implementer narrowed (`cfg.secretName !== undefined && …`) rather than casting. Runtime equivalence confirmed empirically: `/^[\w/+=.@-]+$/.test(undefined) === true`, so the pre-guard code accepted an absent `secretName` too - the guard is a narrowing, not a behaviour change, as its comment claims.
  - *Cast removals controlled.* Reverting core's field to `secretName: string` and **rebuilding core** (pds resolves core through `dist`) produces exactly **five** errors, one per file whose `as PdsConfig` was dropped, every one naming `secretName`: `config.test.ts(80,9)` TS2741, `nodes.test.ts(74,3)` TS2322, `plugin.test.ts(73,3)` TS2322, `sync.test.ts(74,28)` TS2345, `test-support.test.ts(21,47)` TS2741. **The casts existed solely because core declared the field required; none was covering anything else.** (The brief said four files; it is five - `pds/config.test.ts` dropped two casts as well.)
  - *Changeset:* `.changeset/core-config-drops-pds.md`, `blogwright-core: minor` / `blogwright-pds: patch` / `blogwright: patch`. At 0.3.3, `minor` is this repo's established breaking bump (every other changeset in `.changeset/` uses `minor`, none uses `major`). Both consequences are stated: the optional published field with the migration pointer to `resolvePdsSecretName`, and the loss of parse-time rejection. See D2 for one imprecision in its wording.
  - *Status:* ☑ SATISFIED

- **O5 - The deploy role's secret ARN is total for every input.**
  - *Claim:* `oidcRolePolicyStatements` over a `pds` block with no `secretName` yields `arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*`, never contains `undefined`; the inline default carries a comment naming task 59; `grep -c blogwright-pds packages/cli/src/nodes.ts` returns 0.
  - *Evidence collected:* new case `derives the secret ARN from siteName when the pds block omits secretName` (`packages/cli/src/nodes.test.ts:313-329`), green. The certificate's own trap - "if the test asserts only the happy path with `secretName` set explicitly, mark UNSATISFIED" - does **not** fire: the new case passes `pds: { name: 'x' }` with no `secretName`.
  - *Falsifiability - M4, the mutation the brief flagged hardest, reproduced exactly.* Dropping the `??` default fails **exactly one** test of the CLI's 354, and `nodes.test.ts` alone reports **1 failed | 33 passed (34)** - the implementer's account is precise. The failing assertion is the `undefined`-naming one, and it fires **first**: `expected 'arn:aws:secretsmanager:us-east-1:1234…' not to contain 'undefined'`, received `arn:aws:secretsmanager:us-east-1:123456789012:secret:undefined-*`. So the single guard is real, is the one the DoD demanded, and catches a valid-looking string rather than an exception. Confirmed **not** a test-quality problem: `siteName` is total (`mergeConfig` throws when absent, `validateConfig` enforces `/^[a-z0-9-]+$/`), so the `??` makes the ARN total for every input.
  - *Defect found - see D1.* The **converse** half is pinned by nothing. Mutation **M7** (drop the `secretName` read entirely, always derive `<siteName>/atproto`) leaves **all 354 CLI tests green**, because both ARN fixtures collide: `PDS_WITH_SECRET_NAME.secretName === 'example/atproto'` is string-identical to the derived default for `siteName = 'example'`.
  - *Status:* ☑ SATISFIED as to the DoD's literal text (which names only the omitted-`secretName` case), with D1 recorded against the untested converse.

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass; the lint/format/dead-code gates are clean.
  - *Evidence collected:* all six gates, in CI order, from the workspace root - `pnpm build` **0**, `pnpm typecheck` **0**, `pnpm test` **0**, `pnpm lint` **0**, `pnpm exec oxfmt --check .` **0**, `pnpm knip` **0** (empty report; nothing orphaned, nothing suppressed). Re-run identically after every mutation was restored. Also run in full on the **build-52 rebase**: all six 0.
  - *Status:* ☑ SATISFIED

- **O7 - Reviewable: gates plus a grep of core's config module.**
  - *Claim:* `pnpm build && pnpm test && pnpm knip` clean, then `grep -nE "handleResolver|secretName|atproto|pds" packages/core/src/config.ts` shows only the `PdsConfig` declaration and the `OpsConfig.pds` field.
  - *Evidence collected:* the three gates clean. The grep, run verbatim, returns 15 lines: `:31,34,36,38` (PdsConfig doc), `:47,51` (`handleResolver` + doc), `:54,55,57` (`secretName` + doc), `:130` (`OpsConfig.pds`) - all within the stated formulation - plus `:61,69,72,160` (`PathsConfig` / `atprotoJson` / its default) and `:363-364` (`Names.githubRole` doc), all **pre-existing at build 51 and correctly core-owned** (adjudicated under O1).
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/context.ts` (`loadConfig` → `parseConfig`) on a config with a `pds` block and no `secretName` → parses, `cfg.pds.secretName` undefined, no throw : ☑ PRESERVED
- `packages/cli/src/nodes.ts:995` (`oidcRolePolicyStatements`) → `…:secret:example/atproto-*`, never `…:secret:undefined-*` : ☑ PRESERVED (M4 control)
- `packages/cli/src/nodes.ts` (`applyOidcRole` → `putRolePolicy`) rewrites the whole `<env>-deploy` document → same ARN for that config : ☑ PRESERVED
- `packages/pds/src/sync.ts:58` (`requirePdsConfig`) resolves the same config → `example/atproto` / `my-site/atproto` : ☑ PRESERVED (pds 146/146)
- `createTestContext` in both packages call `mergeConfig` with pds fixtures → every existing test in both packages passes : ☑ PRESERVED (core 149, cli 354, pds 146, analytics 701, build-agent 27)
- **Task 28's routed defect is unchanged in reachability** (both halves checked against the built `dist`): `validatePdsConfig(undefined)` throws `TypeError: Cannot read properties of undefined (reading 'name')` from `dist/config.js:27:14` - its **first** statement - so the new `secretName` guard at `dist/config.js:49` is **unreachable** for that input; and `resolvePluginConfig` (`packages/cli/src/plugins.ts:661`, **untouched by this diff**) already called it with `undefined` for a repo with no `pds` key, because core's `validateConfig` gated that path behind `if (cfg.pds)` and so never covered it. **This task neither created nor widened it.** : ☑ PRESERVED
- Pins not moved: `EXPECTED_USAGE` and the `--help` plugin section live in `packages/cli/src/cli.test.ts`, `commands.test.ts`'s call sequences in `packages/cli/src/commands.test.ts` - **neither file is in the change surface**, and both suites pass : ☑ PRESERVED
- **Integration.** Rebase onto the current mainline tip (build 52, `c972d4e5f74d`, task 29) is **conflict-free** despite both changesets touching `packages/pds/src/plugin.test.ts`; all six gates pass on the merged tree (cli 364, pds 146, core 149). Three-way merge against the in-flight task 53 (`packages/cli/src/nodes.test.ts`, the one overlap) is clean - `git merge-file` exit 0, zero conflict markers. The workspace was restored to its original parent (`jj op restore`) and all 11 files re-verified byte-identical by SHA-256. : ☑ PRESERVED

## Defects

- **D1 (CONCERNS, one-line fix, in a file this task already edits) - `packages/cli/src/nodes.test.ts:9`: an assertion that cannot fail.**
  `const PDS_WITH_SECRET_NAME: PdsConfig = { name: 'x', secretName: 'example/atproto' }` is string-identical to the value derived from `siteName = 'example'`, so **neither** ARN test can distinguish "reads the configured `secretName`" from "always derives the default". Proved: mutation **M7** removes the `secretName` read entirely and **all 354 CLI tests stay green**. The test named `grants secret read/write scoped to the pds secret when configured` cannot fail for the property its name claims, and the diff's own new comment - *"the block `pds: true` stands for: a `secretName` spelled out in the config"* - asserts a distinction the fixture does not establish.
  *Failure scenario:* an operator sets `"pds": { "name": "…", "secretName": "prod/atproto-oauth" }`. A later regression in the `??` expression (task 59 rewrites this statement) makes the deploy role grant on `arn:…:secret:example/atproto-*` instead of `…:secret:prod/atproto-oauth-*`. `applyOidcRole` writes the whole document on the next `blogwright bootstrap`, so the operator silently loses `GetSecretValue` on their real secret and gains it on one that does not exist - no exception, no red test. This is the exact failure class the task file calls "a live permission and not a test failure", and it is plan.md's own documented anti-pattern ("a vacuous fixture is the commonest way an assertion loses its teeth").
  *Verified fix:* set `PDS_WITH_SECRET_NAME.secretName` to a value distinct from `<siteName>/atproto` (e.g. `'me/custom-secret'`) and update the existing expected ARN at `nodes.test.ts:308-310`. Applied on top of M7, this makes `grants secret read/write scoped to the pds secret when configured` fail as it should; applied against the correct code, all 354 pass.

- **D2 (minor, wording) - `.changeset/core-config-drops-pds.md`: "Every message string is unchanged" is imprecise.**
  The *inner* message is byte-identical, but what an operator actually sees gains a prefix: `plugin "pds" rejected the "pds" config block: config.pds.handleResolver must be https, got "http://r"` (verified end-to-end). A reader can reasonably take the sentence to mean the visible output is unchanged. Suggest "every message string is unchanged, now prefixed by the plugin and key that refused it".

- **D3 (minor, plan hygiene, not in this task's DoD) - type-claim C23 not retired.**
  `type-claims/README.md` names **task 27** as the task at which C23 (`core's PdsConfig.secretName still required`) retires: "the gate fails on its claim; delete the claim and re-run". It now fails. Verified this is newly caused by this task by re-running the gate with only `config.ts` reverted: 1 broken claim (C28) at build 51, 2 (C23 + C28) after. **C28 is pre-existing debt from task 38** (already Done), so the same omission has now happened twice - worth fixing once, systemically. The harness is deliberately outside CI and outside the six-gate DoD, so this blocks nothing, but it erodes the gate's signal.

- **D4 (observation for the plan, no action on this task) - the 27/29 ordering is load-bearing and unenforced.**
  Task 29 (`Depends on: 10, 26`) and task 27 (`Depends on: 19, 23, 26`) do not depend on each other, so nothing in the graph forces 29 first. It happened to land first (build 52), which is what makes this changeset's dispatch-time claim true. **Had 27 landed on build 51 alone, a malformed `pds` block would have been validated by nothing on any command**: `cli.ts:397` routed `pds` to `runPds`, which calls `pds.<action>(ctx)` directly and never reaches `resolvePluginConfig`; `validatePdsConfig`'s only production call site is `packages/pds/src/plugin.ts:179`. The window was avoided, not designed away. Task 58 should not flip the spec to `Merged` on the strength of 27 + 59 alone without noting that 29 is what closes this half.

## Residue

The ordering constraint the authored certificate flagged held, and was checked rather than
assumed: 27 removes core's pds validation, 28 pins what replaces it, and **29 is what makes
the replacement reachable at all**. Task 28's own routed finding is unchanged in reachability
by this task (see Regression check), so 28 inherits exactly the defect it was already given.
Task 59 still owns deleting the `nodes.ts` statement and its inline `??` together; the comment
naming it is present and correct. Config files already on disk in consumer repos are unaffected
by construction - only the location of the default and the checks moved.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All seven obligations are satisfied on evidence - both removals reproduced under four
restored mutations, the routed TS2345 and the five cast removals reproduced as controls, the four
migrated test cases each mapped to a strictly stronger equivalent, and all six gates green at both
the build-51 base and the build-52 rebase - with one falsifiability defect (D1: colliding ARN
fixtures leave "an explicit `secretName` is honoured" untested, one line to fix) and two minor
documentation items (D2, D3) recorded against otherwise correct code.
