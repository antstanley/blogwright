# Task 07 — Lint enforcement and guideline closure

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (the import rule, made mechanical) and §Assumptions and open questions (retiring the migration exception list)
**Depends on:** 02, 03, 04, 05, 06
**Produces:** the hexagonal import rule is a failing lint check, not a convention; DEVELOPMENT.md reflects the completed migration
**Pointers:** `.oxlintrc.json`, `packages/cli/src/adapters/` (the allowed location), `DEVELOPMENT.md` §Assumptions and open questions (the exception list to remove), §Hexagonal architecture (the ports table to extend)

## Steps

- [x] Configure `no-restricted-imports` (or oxlint's equivalent) to forbid `node:fs`, `node:fs/promises`, `node:child_process`, and `node:readline/promises` outside `packages/cli/src/adapters/` and the composition root; if oxlint cannot scope by path, add a small check script to `pnpm lint` instead and record the decision.
- [x] Verify the gate catches a violation (add one deliberately, watch lint fail, remove it).
- [x] Update DEVELOPMENT.md: extend the ports table with `FileSystem`, `Vcs`, `Terminal`, `PingBuilder`; delete the open-question exception list; record the enforcement mechanism in Decisions.
- [x] Confirm knip is clean after the migration (no orphaned exports in the ports/adapters modules).

## Definition of done

- [x] A direct `node:fs` import added to a domain module fails `pnpm lint` locally and in CI.
- [x] DEVELOPMENT.md's ports table lists every port with its adapters; the migration exception in Open questions is gone.
- [x] All four gates (`build`, `test`, `lint`, `knip`) pass with the new rule active.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: add `import { readFile } from 'node:fs/promises'` to `commands.ts`, run `pnpm lint`, watch it fail, revert.
