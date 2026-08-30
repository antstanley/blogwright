# Done Certificate - Task 14: Ask every discovered plugin's questions during `blogwright init`

**Task:** [14-cli_init_wizard_plugin_blocks.md](14-cli_init_wizard_plugin_blocks.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 14. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 14) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright init` on a repo with plugins installed writes a single `config/production.jsonc` carrying the core entries plus every answered plugin block, and is byte-for-byte unchanged on a repo with no plugins.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `initSite`'s four core questions and their validators (`packages/cli/src/init.ts:93-110`), the non-interactive refusal at `init.ts:78-84`, the existing-file guard at `init.ts:87`, or the composition root's pre-context `init` branch at `packages/cli/src/cli.ts:107-110`.

## Obligations

- **O1 - The no-plugins path is byte-for-byte unchanged.**
  - *Claim:* with no plugins installed, `blogwright init` writes exactly today's file, and the existing-file guard still returns 1 with its current message.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run init --reporter=verbose` - 10/10 pass. `packages/cli/src/init.test.ts:82-84` compares with `toBe(EXPECTED_NO_PLUGIN_CONFIG)` (a full string constant recorded at `init.test.ts:26-33`), not `toContain`. The fixture was NOT trusted: the parent revision's `init.ts` (`jj file show -r @-`) was reinstated as a second module in the workspace and both `initSite`s were run over the same scripted answers on separate memory filesystems, for all 8 combinations of `region` default/override x `domain` present/absent x `githubRepo` present/absent - every pair byte-identical (`JSON.stringify` compared, so the trailing newline and the comma-before-comment on `"githubRepo" // enables the GitHub OIDC deploy role` are included), as were the emitted logger lines and the prompt sequence. Scratch files removed; `jj diff --from <original snapshot> --to @` reports 0 files changed.
  - *Structural check:* `renderTopLevelItem` (`init.ts:157-161`) reproduces the old comma rule exactly - `comma` precedes the `// comment` suffix for a prop item, and `i === items.length - 1` is the same predicate as the old `i < entries.length - 1`; with `pluginBlocks` empty, `items` is the old `entries` array unchanged.
  - *Checks:* `init.ts:78-91` (non-interactive refusal, repo-root resolution, existing-file guard) is byte-identical to the parent revision; the diff touches neither. The "refuses to overwrite an existing config" test is unchanged apart from the one widened argument (`[]`) the new signature forces - message, exit code, and the `'{}'`-preserved assertion are untouched.
  - *Status:* ☑ SATISFIED

- **O2 - Plugin questions asked in a deterministic order, blocks written into one file.**
  - *Claim:* each plugin's questions are asked in a deterministic order and each answered block lands in the single written file in the core commented style.
  - *Evidence collected:* `init.test.ts:139-186` passes two fake plugins in reverse order (`[zebra, apple]`) and asserts BOTH the contributor call order (`askedOrder`) and the full scripted-terminal prompt sequence (`terminal.prompts`, `init.test.ts:173-180`), pinning the four core prompts first and then `apple` before `zebra`. Both blocks are asserted present in the one written file, and the result is re-parsed with `parseConfig`.
  - *Mutation-verified (not assumed):* (a) replacing the sort with `[...plugins]` fails the test - and still fails with the `askedOrder` assertion disabled, i.e. the `terminal.prompts` assertion catches it on its own; (b) moving `collectPluginBlocks` above the four core questions fails the test, and with the scripted answers padded so execution reaches the assertion, it is the `terminal.prompts` assertion that reports the swap. Ordering is directly pinned, not incidentally.
  - *Checks:* the plugins are passed to `initSite` as a plain array; no `ModuleLoader` and no on-disk package are involved. Block style comes from `renderConfigBlock` (`config-block.ts:40-47`), which is the same two-space/four-space indent and `// comment` suffix the core entries use - observed in the written text: `"zebra": {\n    "trackingId": "UA-ZEBRA" // from zebra\n  }`. One `fs.writeText` remains (`init.ts:250-253`).
  - *Status:* ☑ SATISFIED

- **O3 - Declining and throwing contributors leave a valid or absent file.**
  - *Claim:* a plugin contributing no block adds nothing and leaves no stray comma (the file re-parses through `parseConfig`), and a plugin whose `init` throws leaves nothing written.
  - *Evidence collected:* `init.test.ts:188-212` covers a plugin returning `[]` and a plugin with no `init` at all, asserting neither name appears, `not.toMatch(/,\s*}/)`, and `parseConfig(written)` does not throw. `init.test.ts:214-229` asserts `rejects.toThrow('kaboom')` and then `await fs.exists(configPath)` is `false` - the plugin throws from `init`, not from rendering. Structurally: `collectPluginBlocks` returns only non-empty rendered blocks, and it is awaited before the single `fs.writeText`, so a throw aborts ahead of any write - there is no partial-write path to test.
  - *Status:* ☑ SATISFIED

- **O4 - The loader stays at the composition root.**
  - *Claim:* the `ModuleLoader` `initSite` needs is constructed in `cli.ts`, not inside `init.ts`, and lint reports no new restricted import there.
  - *Evidence collected:* `cli.ts:141-151` builds the ports from the SAME `makeDiscoveryPorts()` factory generic dispatch uses (no second seam) and calls `discover(repoRoot, cliPackageDir(), discoveryPorts)` there. `init.ts`'s import block is `blogwright-core` (types plus `colors`/`findRepoRoot`), `./config-block.js`, `./logger.js` - no adapter, no `./plugins.js`, no `node:` module. `pnpm lint` exits 0; the 25 warnings are pre-existing `no-shadow` warnings in `src/nodes.test.ts`, untouched by this diff, and none is in `init.ts` or `cli.ts`. The `no-restricted-imports` gate is live (`.oxlintrc.json`).
  - *Resolution check:* the loader value inside `initSite` does not exist - `plugins` arrives already discovered, as a `readonly Plugin[]` parameter.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the workspace root, in CI order: `pnpm build` clean, `pnpm typecheck` clean, `pnpm test` clean (cli 22 files / 255 tests; core 133; pds 96; build-agent 27; analytics 2), `pnpm lint` exit 0, `pnpm exec oxfmt --check .` "All matched files use the correct format", `pnpm knip` exit 0. A changeset exists (`.changeset/init-wizard-plugin-blocks.md`, `"blogwright": minor`) and describes the user-facing behaviour, including the no-plugins guarantee and the discovery-failure fallback.
  - *Note (does not withhold the status, the named evidence is green):* DEVELOPMENT.md rule 10 limits warn-and-continue to deliberately non-fatal paths. `cli.ts:144-150` catches every error `discover` raises, so a malformed root `package.json` is absorbed into "no plugins installed". See defect D1 under Conclusion; the fix is confined to `cli.ts` and disturbs no obligation discharged above.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `pnpm test -- init` shows an exact no-plugins vector and an unwritten file on throw (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- init` and observe that the no-plugins vector is an exact string comparison against today's output and that the throwing-plugin test asserts nothing was written rather than asserting on a partial file.
  - *Evidence collected:* the task's `Reviewable:` command was run as written - `pnpm --filter blogwright exec vitest run init --reporter=verbose` - 10 passing tests, named: "writes a commented production config from the answers", "with no plugins installed, writes exactly the file it writes today (pinned byte-for-byte)", "omits optional keys left blank", "re-asks until the site name is a valid slug", "refuses to run non-interactively", "refuses to overwrite an existing config", "asks each discovered plugin its own questions, in deterministic (name-sorted) order, and writes every answered block", "adds nothing and leaves no stray comma for a plugin that declines or carries no init contributor", "leaves the config file unwritten when a plugin init(io) contributor throws", "raises naming the plugin when its init(io) contributor has no configKey to file answers under". The two named assertions are `expect(await fs.readText(...)).toBe(EXPECTED_NO_PLUGIN_CONFIG)` and `expect(await fs.exists('/repo/config/production.jsonc')).toBe(false)` - the ones the tests actually make.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/cli.ts:151` (`main`, `command === 'init'`) calls `initSite(discoveryPorts.fs, terminal, logger, plugins, repoRoot)` with the widened signature. Exit codes verified unchanged: 0 on success (executed against the BUILT binary under a pty in two real temp directories - one with no repo marker and no `package.json`, one with a `.git` marker and no `package.json` - wizard completed, file written, contents exactly the two-entry no-plugins output), 1 on non-interactive (executed with stdin closed: the refusal message is unchanged), 1 on an existing file (unit test). : ☑ PRESERVED
- `packages/cli/src/init.test.ts` existing cases ("writes a commented production config from the answers", "omits optional keys left blank", "re-asks until the site name is a valid slug", "refuses to run non-interactively", "refuses to overwrite an existing config") - each edited only by the one widened `[]` argument the new signature forces; no assertion, message, or scripted answer changed; all pass. : ☑ PRESERVED
- `packages/cli/src/plugin-commands.ts` (task 13) shares the `ask` loop exported from `init.ts`, which this diff does not touch; the full `packages/cli` suite (255 tests, including `plugin-commands.test.ts`) passes. `init.ts`'s new `buildInitIo` is a verbatim copy of `plugin-commands.ts`'s, so both paths construct the contributor's `io` identically, and the no-`configKey` refusal message is character-identical between `askPluginBlock` and `runGenericInit`. : ☑ PRESERVED

## Residue

Not obligations, recorded for the record:

- The non-interactive refusal still fires before any plugin question (`collectPluginBlocks` runs after the four core questions), so a plugin can never prompt in CI - confirmed. Discovery itself, however, now runs BEFORE the refusal, so `blogwright init --plain` loads every installed plugin module and then refuses. Wasted work, not a behaviour change.
- Ordering by plugin `name` is one deterministic choice among several the DoD allows.
- `cli.test.ts`'s init-dispatch test comments that it proves "cli.ts's wiring sorts"; the sort is in `init.ts`, and `discover` already returns candidates sorted by PACKAGE name, so with `blogwright-aaa`/`blogwright-bbb` that test's ordering claim is largely incidental. The direct, mutation-verified pin is in `init.test.ts`.
- `cli.test.ts`'s no-repo test asserts the wizard completes but does not assert the warning is emitted; making the catch silent would break no test. Emission was verified by executing the built binary.
- The `init` path does not re-parse the composed text with `parseConfig` before writing, unlike `runGenericInit`, which does so and calls it "the one thing this whole feature promises never to do". A plugin returning malformed `property` text would write an unloadable config and report success.
- A plugin declaring an `init(io)` contributor with no `configKey` aborts the whole wizard (mirroring `runGenericInit`), which sits awkwardly beside `plugins.ts`'s rule that one bad dependency must not make a built-in command unusable.
- Merge hazard, not a defect of the diff: this workspace is based on `build(18/62)`; `main` is at `build(21/62)`, and task 11 (`build(19/62)`, plus its "make the repo-root guard structural" follow-up) rewrote both regions of `cli.ts` this diff edits. Task 14's replacement `DiscoveryPortsFactory` doc comment DELETES task 11's four-discovery-paths enumeration, which task 11's own DoD requires; keep main's enumeration and fold task 14's `init` prose into it. `createNodeFileSystem` also becomes unused in `cli.ts` once the `init` branch stops calling it.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: high
SUMMARY: All six obligations are discharged against executed evidence - byte identity proven by running the parent revision's own `initSite` side by side over eight answer vectors, ordering proven by two mutations, the unwritten-on-throw and no-stray-comma paths proven by their assertions, and all six CI gates green - with one correctness concern (D1) that lies outside the authored obligations.

### Defects for the correctness gate

- **D1 (CONCERNS) - `packages/cli/src/cli.ts:144-150`: the discovery catch is not narrow.** It absorbs every error `discover` throws into `plugins = []` plus a warning. `discover` documents exactly two throwing preconditions, and `readDependencyManifest` (`plugins.ts`) distinguishes them: a MISSING `package.json` (wrapped with `cause: FileNotFoundError`) versus a MALFORMED one (a JSON parse error, or a non-object document). `main`'s already-landed sibling for the same situation - `helpText`'s `isMissingPackageJsonError` (task 11) - tolerates only the first, on the recorded grounds that "a malformed one is an actual defect in the repo worth surfacing as an error, not a 'nothing set up yet' state". Executed against the built binary in a temp repo containing `{ this is not json`: `blogwright init` printed `could not discover installed plugins: failed to parse .../package.json as JSON for the consuming repo ... - continuing with none` and then wrote a config with no plugin blocks and exited 0. An operator with a typo'd `package.json` and an installed plugin therefore ends the wizard believing their plugin was simply not installed, and only discovers otherwise when a later `blogwright <plugin> ...` fails. `FileNotFoundError` is already exported from `blogwright-core` at this workspace's base revision, so the narrow guard was available; post-merge it is a four-line reuse of main's existing `isMissingPackageJsonError`/`isNoRepoRootError` helpers. `cli.ts:142`'s `findRepoRoot(...).catch(() => process.cwd())` is blanket for the same reason, though it reproduces `init.ts`'s own pre-existing line rather than widening anything.
