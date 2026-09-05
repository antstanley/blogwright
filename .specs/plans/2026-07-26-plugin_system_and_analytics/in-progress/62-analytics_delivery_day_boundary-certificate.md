# Done Certificate — Task 62: Keep the initial delivery day conservative across UTC midnight

**Task:** [62-analytics_delivery_day_boundary.md](62-analytics_delivery_day_boundary.md) · **Plan:** [plan.md](../plan.md)
**State:** Validating 2026-09-05

## Definition

DONE(Task 62) means every obligation O1–O5 is satisfied with recorded evidence.

## Premises

- P1: A CreateDelivery request crossing UTC midnight cannot cause backfill to include a day on which live delivery may already have started.
- P2: One obligation per DoD item, in order; O5 is Reviewable.
- P3: Preserve the downstream behavior listed under Regression check; use the current integrated base, never an old passing verdict.

## Obligations

### O1

- Claim: The first successful create stores the UTC day sampled before the request, including a request spanning midnight; it cannot store the later response day.
- Evidence to collect: Inspect the date sampling and createDelivery call order. Run a fake that begins before UTC midnight and resolves after it; mutate sampling back after await and record the failing assertion, then restore.
- Status: ☐ unverified

### O2

- Claim: Existing createdDay is never advanced by rereconcile or replacement; read-only hydration does not invent one; failed creation does not record a successful creation day.
- Evidence to collect: Run existing first-create/preserved-date/replacement/adoption cases and a failed-create fake; inspect record calls and state before/after.
- Status: ☐ unverified

### O3

- Claim: Backfill still admits only complete UTC days strictly before the stored day, refusing the live day; beta.3 logging configuration and fourteen-node graph are preserved.
- Evidence to collect: Run backfill boundary tests and beta.3 log-group/stream policy tests; trace the strict to<createdDay guard through the request.
- Status: ☐ unverified

### O4

- Claim: Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- Evidence to collect: Run six gates, inspect analytics changeset and failure demonstration.
- Status: ☐ unverified

### O5

- Claim: Reviewable: run `pnpm --filter blogwright-analytics exec vitest run nodes backfill --reporter=verbose`; observe the deterministic midnight test fail with the old sampling order and pass with the fix.
- Evidence to collect: Execute named tests and record the concrete date input/output and reverted negative control.
- Status: ☐ unverified

## Regression check

- analytics backfill whole-day range validation and occupied-day idempotency. — ☐ (PRESERVED / REGRESSION)
- analytics graph reconciliation, source ownership guards and beta.3 logging nodes. — ☐ (PRESERVED / REGRESSION)

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or a regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: ☐
CONFIDENCE: ☐
SUMMARY: ☐
