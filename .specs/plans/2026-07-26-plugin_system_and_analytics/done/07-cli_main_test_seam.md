# Task 07 - Give main() a test seam and pin today's dispatch behaviour

**Plan:** [plan.md](../plan.md) · **Certificate:** [07-cli_main_test_seam-certificate.md](07-cli_main_test_seam-certificate.md)

**Implements:** [DEVELOPMENT.md §Hexagonal architecture - ports and adapters](../../../../DEVELOPMENT.md) ("Tests substitute at the port, not by patching modules or globals" - `main` has no seam today, so no dispatch assertion is possible without AWS) and [2026-07-26-cli_plugin_system.md §CLI → Plugin dispatch](../../../changes/2026-07-26-cli_plugin_system.md) (the dispatch surface tasks 10 and 11 must assert against)
**Depends on:** -
**Produces:** an injectable context factory on `main`, defaulted to `createContext` at `bin.ts`, plus a new `packages/cli/src/cli.test.ts` that pins today's help, unknown-command, `pds` and `status` behaviour byte-exactly
**Pointers:** `packages/cli/src/cli.ts:80` (the `main` signature the factory parameter joins), `packages/cli/src/cli.ts:134-140` and `:203-209` and `:259-266` (the three direct `createContext` calls to route through the factory), `packages/cli/src/cli.ts:11-63` (the `USAGE` constant the pin asserts against), `packages/cli/src/cli.ts:101-106` (help and bare-invocation exit codes), `:117-121` (the unknown-command path), `:187-202` (`runPds`'s positional shifting and unknown-action message), `:166-168` (the `status` dispatch arm), `packages/cli/src/bin.ts:9` (the composition root's `main` call), `packages/cli/src/context.ts:119,132` (`findRepoRoot` and `sts.getAccountId` - the disk and AWS reach a test must not make), `packages/cli/src/test-support.ts:148` (`createTestContext`), `packages/core/src/adapters/script-terminal.ts:23` (`createScriptedTerminal` - the capturing terminal), `packages/cli/src/commands.ts:301` (`status`, which catches per-node read failures so it completes against a rejecting transport), `packages/cli/src/cli.test.ts` (new - no CLI dispatch test exists today)

## Steps

- [ ] Declare a `ContextFactory` type in `packages/cli/src/cli.ts` (`(opts: ContextOptions) => Promise<OpsContext>`) and take it as a parameter of `main` (`packages/cli/src/cli.ts:80`), threading it into `runPds` (`:187`) and `runPreview` (`:246`) so all three `createContext` call sites (`:134`, `:203`, `:259`) go through it.
- [ ] Default the factory to `createContext` at the composition root in `packages/cli/src/bin.ts:9`, so `cli.ts` no longer constructs the real context itself and `bin.ts` stays the only place adapters are wired.
- [ ] Create `packages/cli/src/cli.test.ts` driving `main` with `createScriptedTerminal` as the terminal factory and a stub context factory returning `createTestContext()` (`packages/cli/src/test-support.ts:148`), asserting on the terminal's captured `writes`/`errors` and on `main`'s returned exit code.
- [ ] Pin the help and error surface: `--help` prints `USAGE` and returns 0; a bare invocation prints `USAGE` and returns 1 (`packages/cli/src/cli.ts:102-106`); an unknown command prints `unknown command: x` plus `USAGE` and returns 1 (`:117-121`) - with the `USAGE` assertion byte-exact against the constant, not a substring match.
- [ ] Pin the `pds` and built-in arms: `blogwright pds` with no action and `blogwright pds bogus` each print today's `unknown pds action: …` message and return 1 (`:198-202`), and `blogwright status` reaches `commands.status` (`:166-168`), observed through the header line `commands.ts:302` writes.
- [ ] Confirm the change is behaviour-neutral - no user-visible difference, so no changeset - and that no test in the new file spawns a process, reads the real repo, or reaches AWS.

## Definition of done

- [ ] `main` takes its context factory as a parameter, defaulted to `createContext` at `bin.ts` (the composition root), so a test can supply `createTestContext`; no module mocking and no env-var override is used to isolate it - DEVELOPMENT.md: a side effect that needs a module mock is missing a port.
- [ ] `cli.test.ts` pins today's behaviour: `--help` prints `USAGE` and exits 0; a bare invocation prints `USAGE` and exits 1; an unknown command prints `unknown command: x` plus `USAGE` and exits 1; `blogwright pds` with no action and `blogwright pds bogus` exit 1 with today's message shape; `blogwright status` reaches `commands.status`.
- [ ] The pinned `USAGE` assertion is byte-exact against the constant at `packages/cli/src/cli.ts:11-63` - it is the regression net for tasks 11 and 29.
- [ ] No test spawns a process or reaches AWS, and the change is behaviour-neutral: no user-visible change and therefore no changeset.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright exec vitest run cli --reporter=verbose`; confirm the suite passes with no network or git access, then change one character inside the `USAGE` template literal at `packages/cli/src/cli.ts:11` and confirm the byte-exact pin fails.
