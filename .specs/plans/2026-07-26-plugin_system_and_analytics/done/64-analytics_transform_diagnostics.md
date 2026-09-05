# Task 64 — Emit the promised transform diagnostics without record or secret data

**Plan:** [plan.md](../plan.md) · **Certificate:** [64-analytics_transform_diagnostics-certificate.md](64-analytics_transform_diagnostics-certificate.md)

**Implements:** [Analytics observability](../../../changes/merged/2026-07-26-analytics_plugin.md) and [owned-log-groups amendment](../../../changes/merged/2026-08-31-analytics_owned_log_groups.md) §Observability.
**Depends on:** 42, 50
**Produces:** The existing transform log group receives bounded mapping/failure and secret-read diagnostics while Firehose responses and secret-read semantics remain unchanged.
**Pointers:** packages/analytics/src/transform/handler.ts, its composition entry and tests; map-record.ts; transform bundling; DEVELOPMENT.md ports and secret handling.

## Steps

- [x] Introduce an injected diagnostic port and wire the real Lambda composition root to a logging adapter. Keep console/process side effects outside domain logic and do not add AWS logging calls or dependencies.
- [x] Emit bounded structured per-batch mapping/ProcessingFailed counts and fixed reason categories, plus secret-read success/failure events. Categories must not interpolate arbitrary input or error strings. Never emit records, identifiers, viewer IPs, request values, secret names/values or raw error messages.
- [x] Preserve existing Ok/ProcessingFailed envelopes byte-for-byte, order and IDs, cached successful salt reads, retry after failed reads and thrown error identity. The spec’s drop path means ProcessingFailed, never a new Dropped response.
- [x] Prove mixed, successful, failed/empty batches, secret success/cache/failure/retry and sensitive-data exclusion with recording diagnostics. Add changeset and negative controls; run the six repo gates and focused transform tests.

## Definition of done

- [x] Actual Lambda wiring emits bounded mapping/ProcessingFailed summaries with fixed failure categories and uncached salt-read success/failure diagnostics; sensitive payloads, identifiers, secret data and arbitrary error text are absent.
- [x] Existing response envelopes, ordering, record IDs, mapping output, successful secret caching, retry-on-failure and original thrown failures are preserved; no new Dropped outcome or AWS calls appear.
- [x] An injected diagnostic port keeps side effects in the composition/adapter boundary; the shipped transform bundle contains the real wiring, and recording tests exercise the same handler.
- [x] All six repo gates pass: pnpm build, pnpm typecheck, TZ=America/New_York pnpm test, pnpm lint, pnpm exec oxfmt --check ., pnpm knip. A changeset exists and targeted assertions fail under a reverted diagnostic mutation, then pass after exact restoration.
- [x] Reviewable: run the analytics transform handler/map-record tests, inspect the built transform wiring, and demonstrate diagnostic cardinality, reason safety and unchanged valid/failed record behavior with current evidence.
