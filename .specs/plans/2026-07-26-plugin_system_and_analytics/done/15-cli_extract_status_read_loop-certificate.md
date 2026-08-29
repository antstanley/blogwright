# Done Certificate - Task 15: Extract the node status read loop from commands.status

**Task:** [15-cli_extract_status_read_loop.md](15-cli_extract_status_read_loop.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 15. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 15) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A named read-loop function over a node set and a context that `commands.status` calls and task 16's plugin `status` verb reuses, with `blogwright status` output pinned by the first tests `commands.ts` has ever had.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `commands.status`'s observable output in either mode, `renderStatusTree` (`packages/cli/src/render.ts:72`) and the `StatusEntry` shape (`render.ts:59`), `buildNodes` (`packages/cli/src/nodes.ts:1053`), or `ctx.state.resources` reads - this is a behaviour-neutral refactor.

## Obligations

- **O1 - `blogwright status` output is unchanged in both modes.**
  - *Claim:* the pinned lines for a small node set are identical before and after the refactor, interactive and plain.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run commands --reporter=verbose` - 9/9 pass. `packages/cli/src/commands.test.ts:81` and `:101` assert on the full captured `info`/`warn` arrays with `toEqual` (exact strings, in order), not substrings; assertions are `stripColors`-normalised, and `colors` (`packages/core/src/colors.ts:14`) has no `NO_COLOR` branch, so the pinned strings are colour-environment independent (residue item closed). The revision history is a single working-copy change, so history alone cannot prove the assertions predate the refactor - the validator therefore established the invariant *directly* rather than by provenance: a gate-only differential test reinstated the base-revision `status` body verbatim (from `jj file show -r @- packages/cli/src/commands.ts`, lines 301-329) alongside the new one and compared **channel-tagged, ordered, JSON-quoted transcripts** of both across 10 node-set scenarios x 2 modes = 20 cases - present-with-detail, present-without-detail, missing-with-detail, missing-without-detail, error first / middle / last, all-nodes-error, empty node set, `new Error('')`, a non-`Error` throw (a bare string), a message containing tab, newline, `%s`, `${x}`, backticks, parentheses and raw ANSI escapes, and a `JSON.stringify` detail containing ANSI and braces. All 20 pass: post-refactor output is byte-identical to the base revision, including the trailing space on a detail-less plain line and the `╰─`/`├─` connectors. The temporary test was removed; `jj diff --stat` re-confirmed afterwards.
  - *Checks:* `ctx.ports.terminal.isInteractive` is the only mode selector in both revisions (`commands.ts:340`); `createTestContext` (`packages/cli/src/test-support.ts`) sets it from `overrides.ports.terminal` via `createScriptedTerminal({ interactive })` - a port substitution, no env var and no flag argument. `grep -rn 'vi.mock' packages/` returns nothing (exit 1).
  - *Mutation evidence (the suite fails when it should):* eight mutations applied to `commands.ts`, each killed by `commands.test.ts` - status word `present`→`ok` (2 failed), plain-mode error branch deleted (3), `entries.reverse()` (5), `entry.detail || 'unknown'` (1 - precisely the empty-message test), `return` after `renderStatusTree` dropped (2), a logger write inside `readNodeStatus` (6), error `detail` dropped (6), present/missing swapped (4). `commands.ts` restored and verified identical to the diff under review.
  - *Status:* ☑ SATISFIED

- **O2 - The extracted function is a query over an injected node set.**
  - *Claim:* it takes the node set and the context, returns `StatusEntry[]`, and writes nothing to the logger.
  - *Evidence collected:* `packages/cli/src/commands.ts:308` - `export async function readNodeStatus<Ctx extends GraphContext>(nodes: ResourceNode<Ctx>[], ctx: Ctx): Promise<StatusEntry[]>`. The body (`:312-325`) contains only `node.read(ctx)`, `ctx.state.resources[node.id]`, `JSON.stringify`, and `entries.push`; no `ctx.logger` occurrence - confirmed by reading the body, not only by its test. The generic bound matches `applyGraph`/`destroyGraph` (`packages/cli/src/graph.ts:69,103`), so task 16 can hand it a plugin's node set and scoped context.
  - *Checks:* the node argument at the `status` call site resolves to the `nodes` **parameter** (`commands.ts:337`), whose default `= buildNodes(ctx)` is evaluated per call with `ctx` already bound (it precedes `nodes` in the list); it is not read from `ctx` inside `readNodeStatus`. `commands.test.ts:177` exercises the default against the real production graph and asserts `info.length - 1 + warn.length === buildNodes(ctx).length`; `buildNodes` (`nodes.ts:1055`) branches only on `ctx.domain`/`ctx.preview`/`ctx.config`, never on `ctx.state`, so that second call is deterministic and the assertion is not flaky. No command/query deviation to record.
  - *Status:* ☑ SATISFIED

- **O3 - The read-failure path degrades identically.**
  - *Claim:* a throwing `node.read` yields an `error` entry when interactive and a warning line when plain, with the same message text as today.
  - *Evidence collected:* interactive - `commands.test.ts:93` asserts `'╰─ ✗ exec role AccessDenied: iam:GetRole'`, and `readNodeStatus` returns `{ title, state: 'error', detail: message }` (`commands.test.ts:213`). Plain - `commands.test.ts:106` and `:112` assert the exact line `exec role: read failed (AccessDenied: iam:GetRole)`, matching the base revision's inline `` `${node.title}: read failed (${(err as Error).message})` `` at old `commands.ts:313`. The reconstruction from a `StatusEntry` (`commands.ts:349`) was checked at three edges, independently of the implementer's tests: a normal message (identical), `new Error('')` → `blank error node: read failed ()` (identical; `commands.test.ts:148` asserts exactly this string and is the *only* test that kills the `detail || 'unknown'` mutation), and a message carrying tab/newline/`%s`/`${x}`/backtick/ANSI (identical - both revisions interpolate the same value through the same template, and a `String` round-trip through a field cannot alter it). A non-`Error` throw also matches: both revisions evaluate `(err as Error).message`, so a thrown string yields `read failed (undefined)` in each and `throw null` raises the same `TypeError` in each. The loop continues after a failure (`continue` at `commands.ts:319`), pinned by the error-in-the-middle and error-first differential cases.
  - *Status:* ☑ SATISFIED

- **O4 - The diff is confined to `commands.ts` and its test.**
  - *Claim:* no node implementation, no rendering code and no state handling changed.
  - *Evidence collected:* `jj diff --stat` in `/Users/ant/code/blogwright-task-15` lists exactly `packages/cli/src/commands.test.ts` (new, 236 lines) and `packages/cli/src/commands.ts` (+63/-19); `jj status` shows `A` + `M` on those two paths only.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* from the worktree root - `pnpm build` exit 0, `pnpm typecheck` exit 0, `pnpm test` exit 0 (cli 18 files / 152 tests, core 104+1 skipped, pds 85, build-agent 27), `pnpm lint` exit 0 with zero findings on either changed file (the only warnings are pre-existing `no-shadow` notices in `nodes.test.ts`), `pnpm exec oxfmt --check .` exit 0 ("All matched files use the correct format", 127 files), `pnpm knip` exit 0 with no output. No magic numbers, no new external interaction, no `null` for a domain value, no duplicated logic (the mark/detail composition exists once). `.changeset/` holds only `config.json` and `README.md` - no changeset added, correct for an internal refactor.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `pnpm test -- commands` passes and the loop takes an injected node set (Reviewable).**
  - *Claim:* a reviewer can run the `Reviewable:` line and observe the characterization cases passing, and read the extracted signature to confirm task 16 can hand it a plugin's nodes.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run commands --reporter=verbose` - 1 file, 9 tests, all pass. The four characterization cases are present and named: `status (interactive) > renders the heading and a status tree: present, missing, and an error entry`; `status (interactive) > reports a failed read as a tree entry carrying the exact error message`; `status (plain) > prints the heading and one line per node, plain form`; `status (plain) > reports a failed read as a warning line carrying the exact error message` - plus the empty-message reconstruction, the default-node-set fallback, a colour sanity check, and two `readNodeStatus` query tests. `nodes` is the first parameter of `readNodeStatus` (`commands.ts:309`) and the generic `Ctx extends GraphContext` admits a plugin context, so task 16 substitutes a plugin's node set for `buildNodes(ctx)` without touching this function.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:179` (`main`, `case 'status'`) calls `commands.status(ctx)` with a real context, one argument, unchanged by this diff; the default parameter reaches the real `buildNodes(ctx)`. `cli.test.ts > main - status dispatch` passes: exit code 0 and `Status for "production" (bucket …)` as the first write : ☑ PRESERVED
- `packages/cli/src/render.ts:72` (`renderStatusTree`) is called with the entries the extracted function returns, in the same order and with the same `detail` snapshot point (detail is captured inside the read loop in both revisions, so a `read()` that hydrates `ctx.state` is observed identically). `render.ts` is untouched; `vitest run render cli.test` - 15/15 pass unmodified : ☑ PRESERVED

## Residue

Not obligations, for the validator's awareness: `commands.ts` gains its first test file here, so coverage of the other exported commands (`bootstrap`, `deploy`, `destroy`, `history`) remains absent and is not this task's scope. The colour-environment concern is closed - `colors` is unconditional and the pinned assertions run through `stripColors`, with one raw (non-stripped) sanity assertion at `commands.test.ts:191`.

One accepted, non-defect behaviour change is recorded here rather than left implicit: in **plain** mode the base revision emitted each node's line immediately after that node's `read()` resolved, so a long `status` streamed progressively; the refactor reads every node first and then emits. The emitted lines, their channels and their order are byte-identical (proved by the 20-case differential above) - only the arrival timing changes, and interactive mode was already buffered. This is the structure the task's own step 3 mandates ("one call to `readNodeStatus(...)`, then ... the plain per-entry lines"), so it is in-contract; it is noted because it is the one observable difference a reader tracing the two revisions will find.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are SATISFIED with independent evidence - a 20-case differential against the verbatim base-revision `status` proves the output is byte-identical in both modes (including the reconstructed plain-mode warning at its empty-message and formatting-character edges), eight mutations of the extracted loop are each killed by the authored suite, `readNodeStatus` is a logger-free query over an injected node set with the production call site unchanged, the diff is confined to the two named files with no `vi.mock` anywhere, and all six repo gates plus the `Reviewable:` line run clean.
