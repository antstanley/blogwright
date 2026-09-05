# Done Certificate — Task 62: Keep the initial delivery day conservative across UTC midnight

**Task:** [62-analytics_delivery_day_boundary.md](62-analytics_delivery_day_boundary.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-09-05

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
- Status: SATISFIED
- Evidence: Inspected nodes.ts:3297/3298/3329: UTC sample precedes awaited CreateDelivery; persistence follows success. Required verbose nodes/backfill run passed 211 tests (/tmp/verify62-target.log). Old-order mutation failed exactly the absent-day crossing-midnight assertion: expected 2026-08-31, got 2026-09-01 (/tmp/verify62-negative.log); source restored byte-identically (SHA256 210e547471fc696c9a504280b2e3f3348cbebd9fa419d3a318a554934eef4960).

### O2

- Claim: Existing createdDay is never advanced by rereconcile or replacement; read-only hydration does not invent one; failed creation does not record a successful creation day.
- Evidence to collect: Run existing first-create/preserved-date/replacement/adoption cases and a failed-create fake; inspect record calls and state before/after.
- Status: SATISFIED
- Evidence: First-create UTC, existing 2020-01-01, adoption without a day, hydration preserving 2024-05-06, replacement preserving 2026-03-04, and denied midnight request cases all passed. Failed fake observes undefined state before request response and after rejection. output() is reached only after success and reuses existing resource outputs.

### O3

- Claim: Backfill still admits only complete UTC days strictly before the stored day, refusing the live day; beta.3 logging configuration and fourteen-node graph are preserved.
- Evidence to collect: Run backfill boundary tests and beta.3 log-group/stream policy tests; trace the strict to<createdDay guard through the request.
- Status: SATISFIED
- Evidence: Backfill boundary, foreign-day rejection, occupied-day/bot occupancy and second-run cases pass. runBackfill → requireCreatedDay → candidateDays iterates back>=1: maximum admitted day is createdDay minus one UTC day, structurally enforcing the requested strict upper bound (there is no literal to<createdDay expression). backfillDay then requests [UTC midnight, next midnight) and rejects foreign-day rows. Fourteen-node command graph and beta.3 group/stream/policy cases pass in full suite.

### O4

- Claim: Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- Evidence to collect: Run six gates, inspect analytics changeset and failure demonstration.
- Status: SATISFIED
- Evidence: All six gates exited 0 independently: /tmp/verify62-{build,typecheck,lint,format,knip}.log and /tmp/verify62-test-pass.log. Full timezone suite used CI Node24.19.0, Corepack pnpm11.24.0 via /tmp/verify62-bin/pnpm, and working system Git via temporary shim after external toolchain drift removed pnpm and Homebrew pcre2. Earlier Node26 terminal-output failures and broken-Git failures are retained in /tmp/verify62-test-final.log and /tmp/verify62-test-node24.log; no product change was needed. Analytics 827 tests and CLI376 pass. Patch changeset inspected; negative control recorded under O1.

### O5

- Claim: Reviewable: run `pnpm --filter blogwright-analytics exec vitest run nodes backfill --reporter=verbose`; observe the deterministic midnight test fail with the old sampling order and pass with the fix.
- Evidence to collect: Execute named tests and record the concrete date input/output and reverted negative control.
- Status: SATISFIED
- Evidence: Executed exact pnpm --filter blogwright-analytics exec vitest run nodes backfill --reporter=verbose: 211 passed. Executed same command with reverted sampling: one failure with input 2026-08-31T23:59:59Z and response clock 2026-09-01T00:00:01Z. Restored source and reran nodes/backfill in expanded verbose run (both pass), then full suite passes. Detailed independent resolution/trace report: /tmp/verify62-review.md.

## Regression check

- analytics backfill whole-day range validation and occupied-day idempotency. — PRESERVED; see O3 and /tmp/verify62-review.md.
- analytics graph reconciliation, source ownership guards and beta.3 logging nodes. — PRESERVED; see O3 and /tmp/verify62-review.md.

## Conclusion

NOT_DONE if any obligation is UNSATISFIED or a regression exists; PARTIAL if any is UNVERIFIED and none fails; DONE only if all are SATISFIED and regressions are PRESERVED.

VERDICT: DONE
CONFIDENCE: high
SUMMARY: All five obligations are SATISFIED by independent traces, six passing gates and the byte-restored negative control; both named regression surfaces are PRESERVED.
