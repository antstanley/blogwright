# Task 06 — Builder ping port

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (no bare `fetch` in domain modules; function-typed ports preferred)
**Depends on:** 01
**Produces:** the MicroVM wake-up nudge in `deploy.ts` goes through a function-typed `PingBuilder` port; `pollBuild`'s nudge behaviour gains its first test
**Pointers:** `packages/cli/src/deploy.ts:34-44` (`nudge` and its `fetch`), `packages/cli/src/deploy.ts:70` (the `pollBuild` call site), `packages/cli/src/deploy.test.ts` (currently covers only `microvmLogGroup`)

## Steps

- [x] Define `PingBuilder` in the CLI's port module (`packages/cli/src/ports.ts`) as a single function type: `(endpoint, token) => Promise<void>` — best-effort, never throws.
- [x] Move the current `fetch` body (proxy headers, 2.5 s timeout, swallowed errors) into the node adapter; keep the timeout as a named constant.
- [x] `pollBuild` receives the port via `ctx.ports.ping`; document at the call site that the wake-up, not the response, is the point.
- [x] Add tests with a recording fake: the nudge fires each poll cycle with the proxy endpoint and token, and a rejecting ping does not fail the poll loop.

## Definition of done

- [x] `deploy.ts` contains no `fetch` call; the adapter owns it with the timeout as a named constant.
- [x] `pollBuild` nudge behaviour is tested: fires per cycle, correct endpoint/token, resilient to ping failure.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm test -- deploy`; confirm the new tests cover the nudge path that previously had none.
