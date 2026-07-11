# Task 03 — PDS file I/O via the FileSystem port

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (the domain-module import rule applied to the `pds/` modules)
**Depends on:** 01
**Produces:** all `pds` file access — content enumeration, atproto.json and well-known reads, keygen/init writes — goes through `ctx.ports.fs`
**Pointers:** `packages/cli/src/pds/content.ts:51,58` (readdir/readFile), `packages/cli/src/pds/sync.ts:60,76` (config reads), `packages/cli/src/pds/commands.ts:59-60,151-155` (keygen/init writes)

## Steps

- [ ] Convert `listPublishablePosts` (`content.ts`) to enumerate and read posts through the port (`listFiles` + `readText`), keeping `parseFrontmatter` pure.
- [ ] Convert `readAtprotoSiteConfig` and `readWellKnownUri` (`sync.ts`) to `readText` through the port.
- [ ] Convert `keygen` and `init` (`commands.ts`) document writes to `writeText` (which owns directory creation), dropping the direct `mkdir`/`writeFile` imports.
- [ ] Move the affected unit tests onto the in-memory adapter via `createTestContext`; keep one tmp-dir test per module as a node-adapter integration check.

## Definition of done

- [ ] No module under `packages/cli/src/pds/` imports `node:fs`; `node:path` remains only for pure path joining.
- [ ] `content`, `sync`, and `commands` unit tests run on the in-memory adapter; the retained tmp-dir tests still pass against the node adapter.
- [ ] Negative space holds: missing `atproto.json` and missing well-known file still produce the existing warn/skip behaviour, asserted in tests.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- pds`; grep `node:fs` under `packages/cli/src/pds/` and confirm zero hits.
