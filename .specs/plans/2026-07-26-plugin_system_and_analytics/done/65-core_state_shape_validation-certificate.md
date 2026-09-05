# Done Certificate — Task 65: Validate persisted state shapes at the S3 boundary

**Task:** [65-core_state_shape_validation.md](65-core_state_shape_validation.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-09-05

## Definition

DONE(Task 65) means all five obligations are satisfied with current evidence and every regression check is preserved.

## Premises

- The integrated base contains the dependencies listed in the task.
- This task closes a discovered normative gap; it does not weaken the source requirement.
- The validator is independent from implementer and certificate author.

## Obligations

### O1

- Claim: StateStore.load validates unknown parsed data against the existing OpsState/ResourceOutputs field shapes, including omitted updatedAt, and returns only validated state; invalid envelopes or output shapes raise contextual Error before graph execution.
- Evidence to collect: Inspect current exported state types and validation path. Exercise null/array/missing/wrong envelope fields and nested or non-string-array output values; verify errors name bucket/key/field but omit raw state.
- Status: SATISFIED

### O2

- Claim: Missing buckets/objects retain existing empty-state behavior, malformed JSON retains contextual cause handling, and shape-invalid state is never converted to empty state; both scoped and unscoped keys are covered.
- Evidence to collect: Run missing-bucket/key, malformed JSON/cause and invalid shape tests for both key forms; trace failures through context/lifecycle before graph effects.
- Status: SATISFIED

### O3

- Claim: Valid historical serialization, all supported output value types, unknown fields and unconstrained typed version/env/timestamp values remain compatible; no unrequested format, identity or version restrictions are introduced.
- Evidence to collect: Run representative historical round trips with omitted updatedAt, unknown fields, alternate typed version/env/timestamp strings and all output types. Compare parser acceptance with type contract.
- Status: SATISFIED

### O4

- Claim: All six repo gates pass: pnpm build, pnpm typecheck, TZ=America/New_York pnpm test, pnpm lint, pnpm exec oxfmt --check ., pnpm knip. A changeset exists and targeted assertions fail when shape validation is bypassed, then pass after exact restoration.
- Evidence to collect: Execute all six gates and bypass-validation mutation, record exact exits/counts and restored hash; inspect changeset.
- Status: SATISFIED

### O5

- Claim: Reviewable: run focused core state and CLI context/plugin lifecycle suites; show invalid stored state cannot reach graph effects, inspect round-trip/default behavior and verify the unchecked JSON.parse-as-state boundary has been removed.
- Evidence to collect: Run focused state/context/plugin lifecycle suites and inspect call paths; demonstrate early failure and existing state preservation without reading arbitrary JSON as trusted OpsState.
- Status: SATISFIED

## Regression check

- Existing state serialization, missing-state defaults and unknown-field compatibility — PRESERVED
- CLI and plugin graph execution receives valid state only — PRESERVED
- No state values disclosed in new diagnostic errors — PRESERVED

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or any regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: DONE
CONFIDENCE: high
SUMMARY: All five obligations are independently satisfied; all six gates pass (1609 tests passed, 1 skipped), focused state/CLI suites pass (73/105), the validation bypass fails 52 assertions and exact restoration passes, and all regression traces are preserved. Evidence: /tmp/verify65-review.md and /tmp/verify65-*.log; reviewed revision a57b3ffaca704a75bc548014f2c5510936935446; restored state.ts SHA256 72e7f4c8406363e40b289ce26c480dc1b289d92f54542dba8a27e514ff02819d.
