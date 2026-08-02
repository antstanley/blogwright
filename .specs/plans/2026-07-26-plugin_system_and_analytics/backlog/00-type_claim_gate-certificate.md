# Done Certificate - Task 00: Own the type-claim gate that compiles the corpus's compiler claims

**Task:** [00-type_claim_gate.md](00-type_claim_gate.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-27 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

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
  - *Status:* ☐ unverified

- **O2 - Citations and codes are complete.**
  - *Claim:* every transcribed declaration cites its spec section; every claim comment names the document section or task it pins and the exact diagnostic code that document quotes; every negative claim sits under `@ts-expect-error`.
  - *Evidence to collect:* read `transcriptions.ts` and confirm each exported declaration's doc comment names a spec file and section; run `grep -c "CLAIM C" claims.ts` and compare against the runner's reported count; for each `expects TS…` claim confirm the code appears in the cited document (or the claim's comment says the document claims the behaviour without a code, naming the code tsc actually emits); confirm no negative claim lacks the directive by checking each `expects TS` comment is followed by `@ts-expect-error` before the expression.
  - *Status:* ☐ unverified

- **O3 - The production toolchain is untouched.**
  - *Claim:* `pnpm knip`, `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm exec oxfmt --check .` behave identically with and without `type-claims/`, and no CI step or root `package.json` script names it.
  - *Evidence to collect:* run `pnpm knip` and `pnpm build` from the repo root with the directory present - expect clean; run `grep -rn "type-claims" package.json .github/` and expect no output; read `pnpm-workspace.yaml` and `knip.json` and confirm their globs cannot reach `.specs/`.
  - *Status:* ☐ unverified

- **O4 - Retirements are deliberate, and transcriptions do not outlive ground truth.**
  - *Claim:* claims C23, C26 and C28 are either still pinning today's ground truth or were deleted in the commit that landed task 27, 31 or 38 respectively, with the task named in the commit description; and once tasks 01–04 land the SPI in `packages/core`, the corresponding transcriptions are replaced by imports of the real declarations.
  - *Evidence to collect:* if the tasks have not landed - run the gate and confirm the three claims still hold; if any has landed - read the landing commit's description for the named retirement, confirm the claim is gone rather than weakened, and confirm the gate passes; read `transcriptions.ts` against `packages/core/src/plugin.ts` (once it exists) and confirm no type is declared in both places.
  - *Status:* ☐ unverified

- **O5 - Reviewable: one PASS, one provoked FAIL, one revert.**
  - *Claim:* a reviewer can run the gate and observe PASS with the claim count, provoke the recorded failure by adding `extends PluginContext` to `ResourceNode`, observe FAIL naming claim C16 with `TS2344`, and revert to PASS.
  - *Evidence to collect:* the three command outputs, captured verbatim.
  - *Status:* ☐ unverified

## Regression check

For each surface the task touched, the validator traces one downstream consumer:

- `pnpm knip` at the repo root with `type-claims/` present → expect clean, because `knip.json` scans only the four package workspaces : ☐ (PRESERVED / REGRESSION)
- `pnpm build` at the repo root → expect the four-package fan-out unchanged, because `pnpm-workspace.yaml` never reaches `.specs/` : ☐ (PRESERVED / REGRESSION)
- The plan's review rounds → expect the gate run recorded whenever a proposed type changed, per the README's rule : ☐ (PRESERVED / REGRESSION)

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
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
