# Task 15 - Extract the node status read loop from commands.status

**Plan:** [plan.md](../plan.md) · **Certificate:** [15-cli_extract_status_read_loop-certificate.md](15-cli_extract_status_read_loop-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → Plugin lifecycle (Add)](../../../changes/merged/2026-07-26-cli_plugin_system.md) ("`blogwright <plugin> bootstrap`, `status`, and `destroy` run the same engine - `applyGraph`, `destroyGraph`, and the status read loop"; this task gives that loop one home)
**Depends on:** 02
**Produces:** a named read-loop function over a node set and a context that `commands.status` calls and task 16's plugin `status` verb reuses, with `blogwright status` output pinned by the first tests `commands.ts` has ever had (internal refactor - no changeset)
**Pointers:** `packages/cli/src/commands.ts:301` (`status` - the function being split), `packages/cli/src/commands.ts:305-326` (the per-node read/report loop to extract), `packages/cli/src/commands.ts:327-329` (the interactive tree render that stays in the command), `packages/cli/src/render.ts:59` (`StatusEntry`), `packages/cli/src/render.ts:72` (`renderStatusTree`), `packages/cli/src/nodes.ts:1053` (`buildNodes` - the node set `status` passes today), `packages/cli/src/commands.test.ts` (new - `commands.ts` has no test file today, so the characterization tests are written first)

## Steps

- [ ] Write `packages/cli/src/commands.test.ts` **before** touching `commands.ts`: capture the exact lines `status` emits for a small fake node set through a capturing logger, once with `ports.terminal.isInteractive` true and once false, plus one read-throwing node in each mode.
- [ ] Extract `readNodeStatus(nodes, ctx)` from `commands.ts:305-326`, returning `StatusEntry[]` - `present`/`missing` from `node.read(ctx)`, `error` with the message when it throws, and `detail` from `ctx.state.resources[node.id]` - and keep it free of logger writes so it is a query, not a command.
- [ ] Reduce `commands.status` to: the heading line, one call to `readNodeStatus(buildNodes(ctx), ctx)`, then the interactive `renderStatusTree` branch or the plain per-entry lines, so the plain-mode warning for a failed read is emitted by the command from the `error` entry rather than inside the loop.
- [ ] Re-run the characterization tests unmodified and confirm every captured line is byte-identical; if a plain-mode line cannot be reproduced from a `StatusEntry` alone, record the command/query deviation and its reason in the change description rather than silently widening the return type.

## Definition of done

- [ ] `blogwright status` output is unchanged in both interactive and plain modes - the pinned tests capturing the current lines for a small node set were written before the refactor and pass unmodified after.
- [ ] The extracted function takes the node set and the context and returns `StatusEntry[]` without writing to the logger, or the deviation from command/query separation is stated with its reason in the change description.
- [ ] The read-failure path still degrades the same way - an `error` entry when interactive, a warning line when plain - with one test each, both asserting the exact message text.
- [ ] No node implementation changed, no rendering code in `render.ts` changed and no state handling changed: `git diff --stat` (or `jj diff --stat`) lists only `packages/cli/src/commands.ts` and `packages/cli/src/commands.test.ts`.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright exec vitest run commands --reporter=verbose`; confirm the four characterization cases pass and that `readNodeStatus` is called with a node set passed in, so task 16 can hand it a plugin's nodes instead of `buildNodes(ctx)`.
