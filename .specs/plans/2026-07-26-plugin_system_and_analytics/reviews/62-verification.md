# Task 62 independent combined gate

P1: The change modifies nodes.ts analyticsLogDeliveryNode.create, nodes.test.ts makeContext and three date/failure cases, and .changeset/conservative-delivery-day.md.
P2: The task asks initial successful delivery creation to retain a conservative UTC day sampled before the request/retries, without advancing existing bounds.
P3: Preserve read/adoption, failed-create state, replacement/reconciliation, backfill day exclusion and idempotency, and beta.3 fourteen-node logging graph.

## Function resolution
For each changed call, resolution checks local → enclosing class → module → imported → builtin, stopping at match:
- utcDay: no local/enclosing class, module nodes.ts:3239; toISOString().slice(0,10) is UTC. No shadowing.
- new Date: no local/class/module/import binding, builtin Date; fake timer substitutes controlled clock in tests only.
- overrides.onRequest: local makeContext parameter overrides, optional callback; absent for all previous callers. Fake invokes synchronously after recording transport request and before returning response.
- it.each: no local/class/module, imported vitest it; parameterized undefined and 2020-01-01 cases.
- makeContext, ok, logsFailure, withLogDestination, deliveryCalls: no test-callback local/class definition, module helpers in nodes.test.ts (644, response helper, logs failure helper, 3668, 608). Their real clients issue the request through the local transport; callback is not the production boundary.
- expect and vi.useFakeTimers/setSystemTime/useRealTimers: no local/class/module binding, imported vitest. expect matcher methods resolve on returned Vitest assertion objects.
- ctx.record: ctx is local test result, record is the fixture callback assigning state.resources[nodeId]; production output uses the same plugin record contract.
- analyticsLogDeliveryNode: no local/class/module test definition, imported nodes.ts factory; .create resolves to its returned create method.
- Existing adjacent createDelivery resolves module logs(ctx) → ctx.clients.logsUsEast1 → core LogsClient.createDelivery (core/src/aws/logs.ts:160), which awaits this.call; output resolves nodes.ts:287 and records/reuses the existing resource object. No unresolved or behavior-changing shadowing.

## Execution trace and sufficiency
Before: clock 2026-08-31T23:59:59Z, absent state → request fake advances to 2026-09-01T00:00:01Z → successful await → utcDay(now) persisted 2026-09-01, wrongly permitting August 31 backfill.
After: same input → requestDay=2026-08-31 before logs client request → fake observes absent createdDay then advances clock → success persists requestDay=2026-08-31. Failure throws before output/record; existing 2020-01-01 wins over sampled day.
The placement addresses the root cause (response-time sampling), including retries below the awaited client call, rather than hiding the resulting backfill day. Byte-restored mutation confirmed the old-order defect: 1 failed/210 passed, expected 2026-08-31 received 2026-09-01.

## Regression traces
- Graph reconciliation calls create after read=false, receives unchanged delivery fields and conservative initial bound; existing date survives replacement Conflict detach/recreate. Source ownership tests preserve site delivery and source.
- runBackfill calls requireCreatedDay → candidateDays(bound, retention): back iterates retention down through 1, so maximum day is bound minus one UTC day. With bound 2026-08-20 and retention 3, candidate days are August 17–19; rowsAlreadyIn checks each day's occupancy with bots included; occupied days skip filterEvents and insertDay. filterEvents uses midnight start and next midnight end; mapDay excludes foreign-day events. No literal range.to guard exists; strict last-day < bound is structurally enforced by candidateDays. Boundary/second-run tests pass.
- Existing makeContext callers omit onRequest and preserve previous behavior; 211 nodes/backfill tests pass. Fourteen-node assertion passes in commands; beta.3 log group, DestinationDelivery stream and policy equality tests pass in nodes.
- The changeset declares blogwright-analytics patch and explains duplicate ingestion prevention.

## Edge cases
No unhandled edge cases introduced. An earlier sampled day can intentionally omit some history when a long request spans multiple UTC days; conservative omission is required by the contract. Existing core AlreadyExists treatment is unchanged.

## Dynamic evidence
- /tmp/verify62-target.log: exact required nodes/backfill verbose command, 211 passed.
- /tmp/verify62-negative.log: same command under old-order mutation, 1 failed/210 passed; deterministic date assertion above.
- Product bytes restored exactly; nodes.ts SHA256 210e547471fc696c9a504280b2e3f3348cbebd9fa419d3a318a554934eef4960.
- /tmp/verify62-restored.log: nodes/backfill pass and graph assertions pass; expanded commands suite has 6 sandbox-only listen EPERM failures, requiring unsandboxed full-suite verification.
- build, typecheck, lint, oxfmt --check ., knip each independently exited 0 (/tmp/verify62-{build,typecheck,lint,format,knip}.log).
- Full TZ suite passes, exit 0: /tmp/verify62-test-pass.log. CI Node24.19.0 + Corepack pnpm11.24.0, with temporary pnpm/system-Git launchers under /tmp/verify62-bin. External toolchain drift caused initial Node26 terminal tests to fail and missing Homebrew pcre2 caused Git to fail; those attempts retained in test-final/test-node24 logs. No product code changes were required.

CORRECTNESS: CORRECT (high confidence). All resolution, execution, sufficiency and regression checkpoints pass.
COMPLETENESS: DONE (high confidence). O1–O5 SATISFIED, both regressions PRESERVED, all six gates independently pass.
