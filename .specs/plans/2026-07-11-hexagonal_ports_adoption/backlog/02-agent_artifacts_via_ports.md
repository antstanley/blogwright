# Task 02 — Agent artifacts via ports

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) ("tests substitute at the port… If a test needs a module mock or an env-var override to isolate a side effect, that side effect is missing a port")
**Depends on:** 01
**Produces:** `agent-package.ts` reads its artifacts through the `FileSystem` port from a composition-root-resolved directory; `OPS_AGENT_DIR` is retired; the module gains its first test
**Pointers:** `packages/cli/src/agent-package.ts:14` (`process.env.OPS_AGENT_DIR`), `packages/cli/src/agent-package.ts:40` (artifact reads), `packages/cli/src/context.ts` (where `agentDir` is wired)

## Steps

- [ ] Resolve the agent artifact directory (`../agent` from the CLI's dist) in the composition root and carry it on the context (an `agentDir` string beside `ports`), removing the module-level `agentDir()` and its env read.
- [ ] Convert `packageAndUploadAgent` to read Dockerfile, `server.js`, and `agent-manifest.json` through `ctx.ports.fs`.
- [ ] Delete every `OPS_AGENT_DIR` reference (code and docs); tests inject a directory plus the in-memory adapter instead.
- [ ] Write `agent-package.test.ts` with `createTestContext`: manifest hash flows into the S3 key, and the missing-artifacts / invalid-manifest errors carry the directory and remedy in their message.

## Definition of done

- [ ] `agent-package.test.ts` covers the happy path and both failure paths (artifacts absent; manifest hash missing) without touching the real filesystem or env.
- [ ] `grep -r OPS_AGENT_DIR` over the repo returns nothing.
- [ ] `agent-package.ts` imports no `node:fs` or `node:url` API and reads no env var.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- agent-package`; confirm the new tests pass and the module's only inputs are `ctx.ports.fs` and `ctx.agentDir`.
