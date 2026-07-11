# Task 05 — Terminal port

**Plan:** [plan.md](../plan.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture — ports and adapters](../../../../DEVELOPMENT.md) (the domain-module import rule applied to terminal I/O; composition-root wiring)
**Depends on:** 01
**Produces:** a `Terminal` port (write/error lines, `isInteractive`, `question`) with a node adapter; `Logger`, `confirm`, and the `pds login` prompt are built on it and testable with a scripted terminal
**Pointers:** `packages/cli/src/logger.ts:5` (module-load `isTTY` capture), `packages/cli/src/logger.ts:42-56` (`confirm` readline), `packages/cli/src/pds/commands.ts:78-84` (login readline), `packages/cli/src/bin.ts:10`, `packages/cli/src/cli.ts:68` (bare `createLogger` calls)

## Steps

- [ ] Define the `Terminal` port in `blogwright-core` (`packages/core/src/ports.ts`, beside `FileSystem` — the pds package needs it in task 08): `write`, `error`, `isInteractive`, `question(prompt)`; write the node adapter owning `console`, `process.stdout.isTTY`, and `node:readline/promises` — TTY state read at adapter construction, not module load.
- [ ] Rebuild `createLogger(terminal)` as pure formatting (colors keyed off `isInteractive`) over the port; `confirm` uses `terminal.question` and refuses non-interactive sessions as it does today.
- [ ] Replace the `pds login` inline readline with `terminal.question` supplied through the context (the existing `promptLine` parameter becomes the port call).
- [ ] Wire one terminal adapter at the composition root (`bin.ts`/`cli.ts` → `createContext`); the pre-context logger in `cli.ts` and `bin.ts` builds on the same adapter.
- [ ] Add tests with a scripted terminal: logger formatting (TTY and non-TTY), `confirm` yes/no/non-interactive, and the login prompt round-trip.

## Definition of done

- [ ] `console`, `process.stdout`/`stdin`, and `node:readline` are touched only by the terminal adapter.
- [ ] `logger.ts` has tests for the first time: formatting in both TTY modes, `confirm` in all three outcomes, asserted against a scripted terminal.
- [ ] `pds login` prompting is covered without a real stdin.
- [ ] No behaviour change: colors in a TTY, plain text otherwise, `confirm` still refuses non-interactive sessions.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- logger`; run any command in a terminal and piped to a file, confirming colored and plain output respectively.
