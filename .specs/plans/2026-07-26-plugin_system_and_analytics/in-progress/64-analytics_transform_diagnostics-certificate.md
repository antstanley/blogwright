# Done Certificate — Task 64: Emit the promised transform diagnostics without record or secret data

**Task:** [64-analytics_transform_diagnostics.md](64-analytics_transform_diagnostics.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-09-05 — unverified

## Definition

DONE(Task 64) means all five obligations are satisfied with current evidence and every regression check is preserved.

## Premises

- The integrated base contains the dependencies listed in the task.
- This task closes a discovered normative gap; it does not weaken the source requirement.
- The validator is independent from implementer and certificate author.

## Obligations

### O1

- Claim: Actual Lambda wiring emits bounded mapping/ProcessingFailed summaries with fixed failure categories and uncached salt-read success/failure diagnostics; sensitive payloads, identifiers, secret data and arbitrary error text are absent.
- Evidence to collect: Inspect handler, adapter and entry wiring; run recording-logger tests with sensitive sentinel payloads and errors. Check emitted values come only from fixed categories/counts and are bounded by category count, not records.
- Status: ☐ unverified

### O2

- Claim: Existing response envelopes, ordering, record IDs, mapping output, successful secret caching, retry-on-failure and original thrown failures are preserved; no new Dropped outcome or AWS calls appear.
- Evidence to collect: Compare valid/mixed/failure response tests and secret cache/retry assertions before/after. Check original error propagation and no new transport calls.
- Status: ☐ unverified

### O3

- Claim: An injected diagnostic port keeps side effects in the composition/adapter boundary; the shipped transform bundle contains the real wiring, and recording tests exercise the same handler.
- Evidence to collect: Trace injected port through production entry into built transform bundle; inspect domain imports and adapter boundary.
- Status: ☐ unverified

### O4

- Claim: All six repo gates pass: pnpm build, pnpm typecheck, TZ=America/New_York pnpm test, pnpm lint, pnpm exec oxfmt --check ., pnpm knip. A changeset exists and targeted assertions fail under a reverted diagnostic mutation, then pass after exact restoration.
- Evidence to collect: Execute all six gates and reversible negative control, record exact exits/counts and restored hash; inspect changeset.
- Status: ☐ unverified

### O5

- Claim: Reviewable: run the analytics transform handler/map-record tests, inspect the built transform wiring, and demonstrate diagnostic cardinality, reason safety and unchanged valid/failed record behavior with current evidence.
- Evidence to collect: Run focused handler/mapping tests with verbose reporter and inspect diagnostic events/bundle; discharge every task claim against current code.
- Status: ☐ unverified

## Regression check

- Mapping privacy and Firehose per-record failure semantics — ☐ (PRESERVED / REGRESSION)
- Secret-read caching, retries and error propagation — ☐ (PRESERVED / REGRESSION)
- Existing fourteen-node graph and least-privilege logging configuration — ☐ (PRESERVED / REGRESSION)

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or any regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: ☐
CONFIDENCE: ☐
SUMMARY: ☐
