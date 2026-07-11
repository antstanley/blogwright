# Task 04 — VCS port

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (the ban on `node:child_process` in domain modules; "adapters translate errors")
**Depends on:** 01
**Produces:** a `Vcs` port (`revisionHash`, `listFiles`) with a jj/git process adapter; `buildRepoZip` reads file contents through the `FileSystem` port; deploy orchestration is testable with a fake VCS
**Pointers:** `packages/cli/src/repo.ts:16,38,68` (revisionHash / listRepoFiles / buildRepoZip), `packages/cli/src/repo.ts:18,30,40` (jj/git execFile calls), `packages/cli/src/commands.ts` (the deploy-side consumers)

## Steps

- [x] Define the `Vcs` port in the CLI's port module (`packages/cli/src/ports.ts` — CLI-only, unlike the shared core ports): `revisionHash(cwd)` and `listFiles(cwd)` — the two operations the domain needs, in domain vocabulary.
- [x] Write the process adapter in `packages/cli/src/adapters/process-vcs.ts` owning `execFile`: jj-first with git fallback for the hash, `git ls-files` for the listing, errors translated with the command and cwd in the message.
- [x] Rework `repo.ts` so `buildRepoZip` takes file contents through the `FileSystem` port and the ignore/`COMMIT_FILE` logic stays pure; consumers in `commands.ts` use `ctx.ports.vcs`.
- [x] Split tests: a fake-`Vcs` unit test for the zip pipeline (deterministic file set, `COMMIT_FILE` stamping), and the existing tmp-dir real-git test retained as the adapter integration test.

## Definition of done

- [x] `node:child_process` is imported only by `adapters/process-vcs.ts`.
- [x] The zip pipeline (ignore handling, `COMMIT_FILE` injection, deterministic ordering) is unit-tested with a fake `Vcs` and in-memory files.
- [x] The adapter integration test still exercises real jj/git in a tmp dir and passes.
- [x] Adapter errors name the failed command and directory; no raw `execFile` error escapes.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm test -- repo`; confirm the unit test needs no git binary and the integration test still uses one.
