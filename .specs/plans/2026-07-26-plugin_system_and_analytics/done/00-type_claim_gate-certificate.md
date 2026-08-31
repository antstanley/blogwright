# Done Certificate - Task 00: Own the type-claim gate that compiles the corpus's compiler claims

**Task:** [00-type_claim_gate.md](00-type_claim_gate.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 00. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation. Task 00 is plan
> infrastructure with ongoing obligations; it is discharged at plan close, not at authoring.

## Definition

DONE(Task 00) ≡ every obligation O1…O5 below holds, each backed by the evidence the obligation
names (a file location, a command's captured output, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `type-claims/` compiles every type-level claim the three change specs make against the repo's real types and its own TypeScript, fails loudly naming the claim and the document it pins when either side drifts, and is maintained through the plan: transcriptions follow the specs, ground-truth-today claims retire when their tasks land, and transcriptions become real imports as the SPI lands.
- **P2 - Obligations.** The task is done iff O1…O5 all hold. One Oi per definition-of-done item, in DoD order; O5 is the `Reviewable:` item.
- **P3 - Invariants.** Must not affect the production toolchain: `pnpm-workspace.yaml` globs only `packages/*` and `docs`, `knip.json` scans only the four package workspaces, and no CI step or root script names `type-claims/`. Must not require network or AWS.

## Obligations

- **O1 - The gate passes on the corpus and fails naming the claim.**
  - *Claim:* `node check.mjs` exits 0 on the corpus as committed, and a drifted transcription, claim, or real type produces a non-zero exit whose output names the broken claim's `Cnn` id and cited document section.
  - *Evidence to collect:* run `node .specs/plans/2026-07-26-plugin_system_and_analytics/type-claims/check.mjs` and capture the PASS line with its claim count; reintroduce `extends PluginContext` on `ResourceNode` in `transcriptions.ts`, re-run, capture the FAIL naming claim C16 with `TS2344`, revert, re-run, capture the PASS again.
  - *Status:* ☑ SATISFIED. Collected 2026-08-29. Baseline run, exit 0:
    `PASS: 29 claims held (12 compiled positives, 17 pinned compile-errors) against the repo's TypeScript.`
    Probe (`ResourceNode<Ctx extends PluginContext = PluginContext>` in `transcriptions.ts`), exit 1:
    `FAIL: 2 claim(s) broke (of 29):` / `BROKEN CLAIM C16 [cli_plugin_system §Vocabulary relocation / task 02] expects clean -` /
    `claims.ts:202 error TS2344: Type 'OpsContext' does not satisfy the constraint 'PluginContext<never>'.`, with the elaboration
    `missing the following properties …: pluginConfig, siteState, record`. Revert restored byte-identical files (sha256 verified)
    and exit 0 with the same PASS line. The claim count 29 matches the task file and `plan.md:68`/`:831`.
    Defect recorded (non-blocking, does not falsify this obligation): the PASS line's *breakdown* is wrong. `claimStats()`
    (`check.mjs:39-43`) tests `/expects clean/` against the claim's FIRST comment line only, so the four positives whose comment
    wraps the words onto the next line - C11, C20, C23, C25 - are miscounted as pinned compile-errors. The true split is
    16 compiled positives / 13 pinned compile-errors (13 `@ts-expect-error` directives, verified by direct count and by stripping
    every directive and reading the 13 diagnostics tsc emits). The total, the exit codes and the claim-naming are all correct;
    only the parenthetical is wrong, and task 00's step-1 record inherits the same wrong 12/17 figure.

- **O2 - Citations and codes are complete.**
  - *Claim:* every transcribed declaration cites its spec section; every claim comment names the document section or task it pins and the exact diagnostic code that document quotes; every negative claim sits under `@ts-expect-error`.
  - *Evidence to collect:* read `transcriptions.ts` and confirm each exported declaration's doc comment names a spec file and section; run `grep -c "CLAIM C" claims.ts` and compare against the runner's reported count; for each `expects TS…` claim confirm the code appears in the cited document (or the claim's comment says the document claims the behaviour without a code, naming the code tsc actually emits); confirm no negative claim lacks the directive by checking each `expects TS` comment is followed by `@ts-expect-error` before the expression.
  - *Status:* ☑ SATISFIED. All fourteen exported declarations in `transcriptions.ts` carry a doc comment naming a spec file and
    section (`PluginLogger`, `PluginPorts`, `SiteState`, `PluginContext`, `PluginCommand`, `ResourceNode`, `EngineContext`,
    `applyGraphProposed`, `Plugin`, `ServiceDescriptor`, `ProposedPdsConfig`, `ResolvedPdsConfig`, `ProposedPdsContext`,
    `AnalyticsConfig`). `grep -c "CLAIM C" claims.ts` = 30; the anchored count `grep -cE '^\s*// CLAIM C[0-9]+'` = 29, matching the
    runner - the extra hit is the header docblock's `// CLAIM Cnn` format template, not a claim. `grep -c '@ts-expect-error'` = 14,
    of which one is that same header prose: 13 real directives, exactly one per `expects TS…` claim (C01, C04, C06, C07, C08, C09,
    C10, C13, C14, C17, C24, C26, C28), each immediately above its expression. Every code was checked against the emitting
    compiler, not just the document: stripping all 13 directives and re-running produced exactly 13 diagnostics, each matching the
    code its claim quotes (C01/C06 TS2339, C04/C24/C26 TS2322, C07 TS7053, C08 TS2739, C09/C10 TS2345, C13 TS2542, C14 TS18048,
    C17 TS2344, C28 TS2339) - so no directive is masking a different error, which is the residue's named risk.
    Four claims spot-checked against the cited spec text (specs re-read as amended by the eighth review, 2026-08-29): C08's
    `TS2739` is quoted verbatim in `cli_plugin_system.md` §Assumptions ("the assignment is `TS2739` naming exactly those three"),
    and tsc's message names `pluginConfig, siteState, record` exactly; C12's sixteen-member enumeration matches §`PluginContext`'s
    "It names exactly … and nothing else" member-for-member; C09/C10's `TS2345` and its "Property 'pluginConfig' is missing in type
    'OpsContext'" elaboration are quoted verbatim in `migrate_pds_to_plugin_system.md` §Config ownership; C22's nine left-out
    members match §Context's "nine of its sixteen members" list name-for-name; C16 matches §Vocabulary relocation's
    "The CLI keeps `type ResourceNode = CoreResourceNode<OpsContext>`"; C17's `TS2344` is quoted in task 02 (`:12`, `:24`) and
    cert 02 O3 (`:36`); C14's `TS18048` is quoted verbatim in task 01 (`:19`); and `AnalyticsConfig`'s six fields match
    `analytics_plugin.md` §Configuration and its `Type changes` JSON fragment exactly. No stale or drifted citation found.
    One citation-precision nit, in task 00's own prose rather than in `claims.ts`: the task file's `Implements:` line credits
    "§The two state surfaces' `TS2542`/`TS18048`", but that spec section names neither code - it asserts both behaviours in prose
    ("The type is readonly …", "the engine refuses to compile against it") and the codes come from task 01 (`:19`, `:30`) and the
    seventh review's verification record, which is what C13 and C14 actually cite.

- **O3 - The production toolchain is untouched.**
  - *Claim:* `pnpm knip`, `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm exec oxfmt --check .` behave identically with and without `type-claims/`, and no CI step or root `package.json` script names it.
  - *Evidence to collect:* run `pnpm knip` and `pnpm build` from the repo root with the directory present - expect clean; run `grep -rn "type-claims" package.json .github/` and expect no output; read `pnpm-workspace.yaml` and `knip.json` and confirm their globs cannot reach `.specs/`.
  - *Status:* ☑ SATISFIED. All five commands were run twice from the repo root - once with `type-claims/` present, once with the
    directory moved out of the tree - and behaved identically: `pnpm knip` exit 0 (no output) both ways; `pnpm build` exit 0 both
    ways with a byte-identical five-target fan-out (`docs`, `packages/core`, `packages/pds`, `packages/cli`,
    `packages/build-agent`); `pnpm test` exit 0 both ways with identical per-package pass counts; `pnpm lint` exit 0 both ways with
    an identical warning count (the pre-existing `no-shadow` warnings in `packages/cli/src/nodes.test.ts`); `pnpm exec oxfmt
    --check .` exit 0 and "All matched files use the correct format" both ways. `grep -rn "type-claims" package.json .github/
    packages/` returns nothing (exit 1), and no workflow references `.specs` at all - `.github/workflows/ci.yml` runs only the five
    production commands. `pnpm-workspace.yaml` globs `packages/*` and `docs`; `knip.json` ignores `.` and `docs` and scopes the
    four workspaces to `src/**/*.ts`: neither can reach `.specs/`.
    One scope caveat, already documented by the harness's own README §Why it lives here: `oxfmt --check .` does reach the
    directory - 121 matched files with it present, 118 without, the difference being `transcriptions.ts`, `claims.ts` and
    `check.mjs`. The *behaviour* is identical because those three are correctly formatted (`check.mjs` was reformatted by the
    parent commit "chore: reformat with oxfmt 0.57" and still passes), but the obligation holds on observable behaviour, not on
    scope: an unformatted edit to the harness would fail the repo's CI, which is the README's stated reason to run
    `pnpm exec oxfmt` over edited harness files.

- **O4 - Retirements are deliberate, and transcriptions do not outlive ground truth.**
  - *Claim:* claims C23, C26 and C28 are either still pinning today's ground truth or were deleted in the commit that landed task 27, 31 or 38 respectively, with the task named in the commit description; and once tasks 01–04 land the SPI in `packages/core`, the corresponding transcriptions are replaced by imports of the real declarations.
  - *Evidence to collect:* if the tasks have not landed - run the gate and confirm the three claims still hold; if any has landed - read the landing commit's description for the named retirement, confirm the claim is gone rather than weakened, and confirm the gate passes; read `transcriptions.ts` against `packages/core/src/plugin.ts` (once it exists) and confirm no type is declared in both places.
  - *Status:* ☑ SATISFIED for what is due; the forward half is not yet reachable. None of tasks 27, 31 or 38 has landed - all
    three still sit in `backlog/` and the plan has no `done/` directory - so the three pins were checked against ground truth
    directly, not only through the gate. C23: `PdsConfig.secretName` is still a required `string`
    (`packages/core/src/config.ts:43`). C26: `SendOptions.service` is still `ServiceKey` (`packages/core/src/aws/signer.ts:27`)
    and `ServiceKey = keyof typeof SIGNING_NAMES` (`packages/core/src/aws/endpoint.ts:33`), the closed union tsc prints as
    `"s3" | "sts" | "iam" | "logs" | "acm" | "cloudfront" | "route53" | "secretsmanager" | "microvms"`. C28: `AwsClients`
    (`packages/core/src/clients.ts:21-39`) carries `signing` and `logsUsEast1` but no `signingUsEast1`. All three still error with
    the code their claim quotes, so none has been silenced or weakened. The SPI has not landed either: `packages/core/src/plugin.ts`
    does not exist and no `PluginContext`, `Plugin` or `SiteState` is declared anywhere under `packages/*/src/`, so no transcribed
    type is declared in two places. Tasks 01 and 04 are in `in-progress/`, 02 and 03 in `backlog/`; the transcription-to-import
    replacement this obligation also names becomes checkable when they land, and is out of reach today.

- **O5 - Reviewable: one PASS, one provoked FAIL, one revert.**
  - *Claim:* a reviewer can run the gate and observe PASS with the claim count, provoke the recorded failure by adding `extends PluginContext` to `ResourceNode`, observe FAIL naming claim C16 with `TS2344`, and revert to PASS.
  - *Evidence to collect:* the three command outputs, captured verbatim.
  - *Status:* ☑ SATISFIED. Exercised end to end on 2026-08-29, not reasoned about. (1) `node …/type-claims/check.mjs` →
    exit 0, `PASS: 29 claims held (12 compiled positives, 17 pinned compile-errors) against the repo's TypeScript.` (2) Probe
    applied - `export interface ResourceNode<Ctx extends PluginContext = PluginContext>` at `transcriptions.ts:106` - re-run →
    exit 1, `FAIL: 2 claim(s) broke (of 29):`, first entry
    `BROKEN CLAIM C16 [cli_plugin_system §Vocabulary relocation / task 02] expects clean -` with
    `claims.ts:202 error TS2344: Type 'OpsContext' does not satisfy the constraint 'PluginContext<never>'.` and the elaboration
    `Type 'OpsContext' is missing the following properties from type 'PluginContext<never>': pluginConfig, siteState, record` -
    the same `TS2344` the seventh review found by hand, naming the same three members task 01's `TS2739` gate rests on.
    (3) Reverted from a pre-probe copy; sha256 of both claim files matches the baseline, `jj status` shows no modification under
    `type-claims/`, and the re-run is exit 0 with the identical PASS line.
    One cosmetic wrinkle in the FAIL output: the probe also breaks `transcriptions.ts:133` (`applyGraphProposed`'s
    `ResourceNode<Ctx>` where `Ctx extends EngineContext`), and because no `// CLAIM` comment precedes that line the runner
    reports it as `BROKEN (no claim comment above this line)`, inflating the headline to "2 claim(s) broke". The required naming -
    C16 with its cited section and `TS2344` - is present and first, so a reviewer is pointed at the right document.

## Regression check

For each surface the task touched, the validator traces one downstream consumer:

- `pnpm knip` at the repo root with `type-claims/` present → expect clean, because `knip.json` scans only the four package workspaces : ☑ PRESERVED (exit 0, no output, with and without the directory)
- `pnpm build` at the repo root → expect the four-package fan-out unchanged, because `pnpm-workspace.yaml` never reaches `.specs/` : ☑ PRESERVED (exit 0 and an identical target list with and without the directory)
- The plan's review rounds → expect the gate run recorded whenever a proposed type changed, per the README's rule : ☑ PRESERVED. The seventh review (2026-07-27) records the run that created the gate. The eighth (2026-08-29) amended `cli_plugin_system.md` and `analytics_plugin.md` on disk today; its seven findings are behavioural and editorial (delivery-source guards, `cliPackageDir`'s supplier, task 11's pointers, merge-plan ownership, teardown ordering, the declared-action decision's home, task 59's pair numbering) and none changes a proposed type, so the README's rule did not fire and no transcription needed updating. Verified rather than assumed: the gate is green against the specs *as amended today*, and every claim spot-checked above resolves to a section that still says what the claim pins.

## Residue

The gate checks type-level claims only - dependency-edge counts, file anchors, AWS behaviour and
prose consistency stay with human review; the integrity checks in the plan's review protocol are
the companion mechanical net for the graph. `@ts-expect-error` suppresses any error on its line,
not only the quoted code, which the claims mitigate by keeping each negative to one minimal
expression with a positive sibling nearby - a validator spot-checking a few negatives against the
exact code (delete the directive, read the error) is worth the five minutes. Whether the gate
graduates into CI at plan close is task 00's last step and is deliberately open until then.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: ☑ O1–O5 are all SATISFIED on directly collected evidence - a green 29-claim gate, a provoked `TS2344` failure naming C16 and a byte-verified revert, five production commands behaving identically with and without the directory, and C23/C26/C28 checked against `packages/core` rather than only through the runner - and all three regression traces are PRESERVED, so the rubric yields DONE for everything task 00 owes today; the two defects found are recorded and neither falsifies an obligation: the PASS line's positive/negative breakdown is wrong (16/13, not the reported 12/17, because `claimStats()` reads only a claim comment's first line) and task 00's `Implements:` line credits §The two state surfaces with `TS2542`/`TS18048` codes that section states only as prose.

<!-- Validator's note, 2026-08-29. Task 00's steps 2-5 are ongoing by design and remain open: re-run on every spec change, the
C23/C26/C28 retirements at tasks 27/31/38, the transcription-to-import swap as tasks 01-04 land, and the CI-graduation decision at
task 58/59. This certificate discharges the five obligations as they stand today; the preamble's "discharged at plan close" still
applies to those steps. Two follow-ups worth doing before then, neither blocking: fix `claimStats()` to scan the whole claim
comment rather than its first line (and correct the 12/17 figure in task 00's step-1 record), and give the runner a claim comment
above `transcriptions.ts`'s `applyGraphProposed` so a probe there is attributed rather than reported as
"(no claim comment above this line)". -->
