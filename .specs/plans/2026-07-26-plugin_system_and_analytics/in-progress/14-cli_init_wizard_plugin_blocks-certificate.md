# Done Certificate - Task 14: Ask every discovered plugin's questions during `blogwright init`

**Task:** [14-cli_init_wizard_plugin_blocks.md](14-cli_init_wizard_plugin_blocks.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 14. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.
>
> Discharged fresh on 2026-08-30 by a second validating agent, after the implementation was
> rebased onto `plugin-system-and-analytics` @ `a936daf9` (`build(21/62)`) and the previous
> gate's D1/D3 findings were addressed. No status below is inherited from the earlier pass;
> every check was re-run, and the byte-identity and narrow-catch claims were re-established
> against the current parent revision and the BUILT binary rather than against the prior
> certificate's account of them.

## Definition

DONE(Task 14) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright init` on a repo with plugins installed writes a single `config/production.jsonc` carrying the core entries plus every answered plugin block, and is byte-for-byte unchanged on a repo with no plugins.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `initSite`'s four core questions and their validators, the non-interactive refusal, the existing-file guard (`init.ts:238-241`), or the composition root's pre-context `init` branch (`cli.ts:300-341`).
- **P4 - Rebase premise.** The diff now sits on `a936daf9`, which already carries task 11 (`build(19/62)`) and its "make the repo-root guard structural" follow-up. Task 11's own DoD requires `DiscoveryPortsFactory`'s doc comment to enumerate the four discovery-paying paths; that enumeration must survive this task's edit of the same comment.

## Obligations

- **O1 - The no-plugins path is byte-for-byte unchanged.**
  - *Claim:* with no plugins installed, `blogwright init` writes exactly today's file, and the existing-file guard still returns 1 with its current message.
  - *Evidence collected:* the parent revision's `renderConfig` was extracted verbatim (`jj file show -r @- packages/cli/src/init.ts`, lines 63-90), transliterated with types stripped, and run beside the new `renderConfig`+`renderTopLevelItem` (also verbatim) over all 9 combinations of `domain` ∈ {absent, empty, set} × `githubRepo` ∈ {absent, empty, set} with `pluginBlocks: []`: **every pair byte-identical** (`===` on the full strings, so the trailing newline and the comma-before-comment placement are included). Independently, the BUILT binary was driven through the wizard under a real pty in a fresh temp repo with no plugins; `od -c` of the written file matches the parent renderer's output byte for byte. `init.test.ts:26-33`'s `EXPECTED_NO_PLUGIN_CONFIG` was itself checked against the parent renderer for the (`myblog`, default region, domain, githubRepo) vector - equal - so the pin is a true record of today's output, and `init.test.ts:83` compares it with `toBe`, not `toContain`.
  - *Structural check:* `renderTopLevelItem` (`init.ts:168-172`) reproduces the old comma rule exactly: the comma precedes the `// comment` suffix, and `i === items.length - 1` is the negation of the old `i < entries.length - 1`. With `pluginBlocks` empty, `items` is the old `entries` array unchanged.
  - *Guard check:* `init.ts:229-241` (non-interactive refusal, root resolution, existing-file guard) is byte-identical to the parent revision - the diff touches neither region. Executed against the BUILT binary in a temp repo whose `config/production.jsonc` already existed: exit 1 and the message `… already exists - edit it directly, or pass --config elsewhere`, unchanged. The corresponding unit test differs from the parent's only by the one widened `[]` argument the new signature forces; its message, exit code and `'{}'`-preserved assertion are untouched.
  - *Status:* ☑ SATISFIED

- **O2 - Plugin questions asked in a deterministic order, blocks written into one file.**
  - *Claim:* each plugin's questions are asked in a deterministic order and each answered block lands in the single written file in the core commented style.
  - *Evidence collected:* `init.test.ts:139-186` passes two fake plugins in reverse order (`[zebra, apple]`) and asserts both the contributor call order and the FULL scripted prompt sequence (`terminal.prompts`, `init.test.ts:173-180`) - the four core prompts in their fixed order, then `apple`, then `zebra`. Both blocks are asserted present in the one written file, which is re-parsed with `parseConfig`.
  - *Mutation-verified (run, not assumed):* (a) replacing the sort with `[...plugins]` in `collectPluginBlocks` fails that test (`expected ['apple','zebra'], received ['zebra','apple']`) and the whole `packages/cli` suite goes 268/269; (b) hoisting `collectPluginBlocks` above the four core questions fails the same test on its prompt-sequence assertion, 268/269. Ordering is directly pinned, in both directions the gate asked for.
  - *End-to-end:* a temp repo with two REAL plugin packages (`blogwright-zeta`, `blogwright-alpha`, each with a `blogwright.plugin` manifest and an `init(io)` contributor) installed in its `node_modules`, driven through the BUILT binary under a pty: prompts came in order `site name → region → domain → githubRepo → alpha key → zeta key`, and the single written file was

    ```
    {
      "region": "us-east-1",
      "siteName": "myblog", // stable slug in every AWS resource name - never change it
      "githubRepo": "ant/myblog", // enables the GitHub OIDC deploy role
      "alpha": { "key": "ALPHAKEY" // from alpha },
      "zeta": { "key": "ZETAKEY" // from zeta }
    }
    ```

    (block bodies elided to one line here; on disk they are `renderConfigBlock`'s four-space entries under a two-space key, matching the core entries' style). The CLI's own bundled `blogwright-pds` was discovered on the same pass and correctly contributed nothing - it declares an `init` COMMAND, not a contributor. Exactly one `fs.writeText` remains (`init.ts:277`).
  - *Status:* ☑ SATISFIED

- **O3 - Declining and throwing contributors leave a valid or absent file.**
  - *Claim:* a plugin contributing no block adds nothing and leaves no stray comma (the file re-parses through `parseConfig`), and a plugin whose `init` throws leaves nothing written.
  - *Evidence collected:* `init.test.ts:189-212` (a plugin returning `[]` and a plugin with no `init`) asserts neither name appears, `not.toMatch(/,\s*}/)`, and `parseConfig(written)` does not throw. `init.test.ts:214-229` asserts `rejects.toThrow('kaboom')` then `fs.exists(configPath) === false`.
  - *End-to-end (BUILT binary):* with `blogwright-alpha` declining (blank answer) and `blogwright-zeta` answering, the written file carries only the `"zeta"` block and the core entries, with no stray comma anywhere. With `blogwright-alpha`'s contributor rewritten to throw, the run exited 1 with `✗ alpha contributor exploded` and **no `config/production.jsonc` was created** - `collectPluginBlocks` is awaited before the single `fs.writeText`, so there is no partial-write path.
  - *Coverage note (does not withhold the status - the DoD's obligation is the DECLINING case, which is covered):* the last-position comma for a plugin block is not pinned by any test. Mutating `renderTopLevelItem` to `return \`${item.block},\`` (always comma) leaves all 269 tests green, because `parseConfig` runs `stripTrailingCommas` and therefore cannot see one. Recorded as defect D3 below.
  - *Status:* ☑ SATISFIED

- **O4 - The loader stays at the composition root.**
  - *Claim:* the `ModuleLoader` `initSite` needs is constructed in `cli.ts`, not inside `init.ts`, and lint reports no new restricted import there.
  - *Evidence collected:* `cli.ts:301-341` builds the ports from the SAME `makeDiscoveryPorts()` factory generic dispatch uses (no second seam) and calls `discover(repoRoot, cliPackageDir(), discoveryPorts)` there; `initSite` takes `plugins: readonly Plugin[]` and holds no loader value at all. `init.ts`'s imports are `blogwright-core` (types plus `colors`/`findRepoRoot`/`parseConfig`), `./config-block.js` and `./logger.js` - no adapter, no `./plugins.js`, no `node:` module, and `init.ts` carries no `.oxlintrc.json` override, so the live `no-restricted-imports` rule applies to it. `pnpm -r lint` exits 0; the only warnings are pre-existing `no-shadow` ones in `src/nodes.test.ts`, none in `init.ts` or `cli.ts`.
  - *Rebase check (P4):* `DiscoveryPortsFactory`'s doc comment still carries task 11's enumeration of all four discovery-paying paths (`cli.ts:235-254`), with task 14's `init` prose folded into item 4 rather than replacing the list, and the "every other built-in pays nothing - `deploy`, `bootstrap`, `status`" paragraph intact - so task 11's DoD clause survives verbatim in substance. The only sentence lost is "mirroring the `init` branch below, which already constructs a `FileSystem` directly with no context; tests supply a map-backed pair instead", whose first clause this task makes FALSE (the `init` branch no longer constructs one); the surviving "tests supply a map-backed pair" half is documentation, not an obligation. `jj diff` on `cli.ts` is four hunks and nothing else; `cli.test.ts`'s diff has **zero deleted lines**, and `init.test.ts`'s deletions are exclusively the six `initSite(...)` call-signature updates. Nothing else of task 11's survived-conflict work is missing.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the workspace root in CI order: `pnpm -r build` clean; `pnpm -r typecheck` clean; `pnpm -r test` clean (cli 22 files / 269 tests, core, pds 100, build-agent 27, analytics 2); `pnpm -r lint` exit 0; `pnpm exec oxfmt --check .` "All matched files use the correct format" (142 files); `pnpm knip` exit 0. A changeset exists (`.changeset/init-wizard-plugin-blocks.md`, `"blogwright": minor`) describing the user-facing behaviour, the no-plugins guarantee and the discovery-failure fallback.
  - *Previous D1 (blanket catch) - fixed and re-proven:* `cli.ts:329-340` now narrows through the SAME two helpers `helpText` uses (`isNoRepoRootError`, `isMissingPackageJsonError`). Executed against the BUILT binary, not inherited: (i) temp repo with `.git` and NO `package.json` → warning `no package.json found at … - continuing with no plugins discovered`, wizard completed, file written, **exit 0**; (ii) temp repo with `.git` and `package.json` = `{ this is not json` (run from a subdirectory carrying its own valid manifest, so Node's own ESM entry resolution does not fail first and mask the result) → `✗ failed to parse …/package.json as JSON for the consuming repo: …`, **exit 1, nothing written**, wizard never started. Mutation-verified: widening the catch back to blanket fails `cli.test.ts:601` ("propagates a genuine discovery defect").
  - *Previous D3 (`--plain` importing every plugin) - fixed in the CODE, not pinned by its test:* `cli.ts:302-309` returns before `discover`. Proven decisively against the BUILT binary: a plugin module rewritten to `writeFileSync` a sentinel on import left NO sentinel after `blogwright init --plain` (exit 1, refusal message) and DID leave one after `blogwright --help` in the same repo. However, the test written to pin this - `cli.test.ts:581-599` - **cannot fail**: its fixture is an empty `createMemoryFileSystem()`, so `discover` aborts at `readDependencyManifest` before it ever reaches the loader, with or without the guard. Deleting the `!terminal.isInteractive` branch leaves the whole `packages/cli` suite green (34/34 in `cli.test.ts`). Three of that test's five assertions are inert. plan.md's baseline is explicit that "a verifier that finds an assertion which cannot fail should treat it as a defect, not a style note", and this test exists precisely to answer the previous gate. Recorded as **D1** below.
  - *Status:* ☒ NOT SATISFIED - solely on the inert-assertion clause of the repo baseline (D1). Every other named gate is green; the underlying behaviour is correct and independently proven.

- **O6 - Reviewable: the no-plugins vector is an exact comparison and the throwing case asserts nothing was written.**
  - *Claim:* a reviewer running the task's command observes both properties.
  - *Evidence collected:* the command was run exactly as written - `pnpm --filter blogwright exec vitest run init --reporter=verbose` - **11 passed**: "writes a commented production config from the answers", "with no plugins installed, writes exactly the file it writes today (pinned byte-for-byte)", "omits optional keys left blank", "re-asks until the site name is a valid slug", "refuses to run non-interactively", "refuses to overwrite an existing config", "asks each discovered plugin its own questions, in deterministic (name-sorted) order, and writes every answered block", "adds nothing and leaves no stray comma for a plugin that declines or carries no init contributor", "leaves the config file unwritten when a plugin init(io) contributor throws", "raises naming the plugin when its init(io) contributor has no configKey to file answers under", "never writes an unloadable config file, even when a plugin composes invalid JSON into its block". The two named assertions are `expect(await fs.readText(...)).toBe(EXPECTED_NO_PLUGIN_CONFIG)` (`init.test.ts:83`) and `expect(await fs.exists('/repo/config/production.jsonc')).toBe(false)` (`init.test.ts:228`) - an exact string comparison and an absence assertion, not a partial-file assertion.
  - *`parseConfig` symmetry (gate-requested):* `initSite` now re-parses the composed text before writing (`init.ts:276`), mirroring `runGenericInit`. The test that pins it (`init.test.ts:241-257`, a plugin composing `"unterminated": {`) is real, not decorative: removing the `parseConfig(rendered)` line makes it fail (the call resolves 0 and writes the file, so `rejects.toThrow()` fails). Mutation run, 10/11.
  - *Status:* ☑ SATISFIED

## Regression check

For each module the task touched, one downstream caller traced:

- `packages/cli/src/cli.ts` (`main`, `command === 'init'`) calls `initSite` with the widened signature on both branches. Exit codes verified against the BUILT binary in four real temp directories: 0 on success with plugins, 0 on success with a missing root `package.json` (plus warning), 1 on `--plain`/non-interactive with the unchanged refusal message, 1 on an existing config file with the unchanged message, 1 on a throwing contributor. : ☑ PRESERVED
- `packages/cli/src/init.test.ts` existing cases - each edited only by the one widened `[]` argument the new signature forces; no assertion, message or scripted answer changed; all pass. : ☑ PRESERVED
- `packages/cli/src/plugin-commands.ts` (task 13) shares the `ask` loop exported from `init.ts`, which this diff does not touch. `init.ts`'s new `buildInitIo` is a verbatim copy of `plugin-commands.ts`'s, and the no-`configKey` refusal message is character-identical between `askPluginBlock` and `runGenericInit`, so both paths reach a contributor identically. Full `packages/cli` suite (269 tests) passes. : ☑ PRESERVED
- `packages/cli/src/cli.ts` `helpText` and the five USAGE print sites (task 11) - untouched by the diff (four hunks, none in that region); `cli.test.ts`'s byte-exact `EXPECTED_USAGE` pin and the built-in laziness test (`cli.test.ts:865`) still pass. : ☑ PRESERVED

## Residue

Not obligations, recorded for the record:

- Ordering by plugin `name` is one deterministic choice among several the DoD allows.
- `blogwright init` now reads the repo's root `package.json` where it never did before, so a repo whose manifest is malformed can no longer be initialised until it is fixed. This is the deliberate consequence of the narrow catch and matches the decision task 11 recorded for `helpText`; the message names the file and the parse position.
- A plugin declaring an `init(io)` contributor with no `configKey` aborts the whole wizard (`init.ts:126-131`), mirroring `runGenericInit` rather than `plugins.ts`'s collect-never-throw discipline. The trade-off is argued at length in the function's own doc comment, the message names the offending plugin, and diverging would require `plugin-commands.ts` to diverge too. Accepted, not a defect.
- Nothing validates `configKey` against the core keys, so a plugin declaring `configKey: "region"` would emit a second `"region"` at the top level, which `parseConfig` accepts (last wins) rather than refusing - unlike the splice path, which refuses on a key already present. Two plugins sharing a `configKey` collide the same way. **Task 19 owns the duplicate-`configKey` rejection** ("two plugins declaring the same `configKey` is rejected with an error naming both"), so the second half closes there; the core-key case is out of every current task's scope.
- `plugin-commands.ts:381` still says "cli.ts's `init` branch already constructs a `FileSystem` directly with no context at all", which this task makes false. Stale prose in an untouched file; no behaviour depends on it.
- `isNoRepoRootError`'s doc comment (`cli.ts:137-144`) says "Matched by message prefix, not merely `instanceof Error`" while the body is `err instanceof RepoRootNotFoundError`. Pre-existing drift from the `fix: make the repo-root guard structural` commit, inherited by the rebase, untouched here.

## Conclusion

VERDICT: ☒ PARTIAL
CONFIDENCE: high
SUMMARY: O1-O4 and O6 are discharged against executed evidence - byte identity re-established against the current parent revision's own renderer over nine answer vectors and confirmed by `od -c` on the built binary's output; the narrow catch proven in both directions against the BUILT binary in real temp directories; ordering pinned by two killed mutations; the `parseConfig` symmetry pinned by a third; the rebase shown to preserve task 11's four-path enumeration with zero deletions in `cli.test.ts`; all six CI gates green. O5 fails on one clause only: the test written to pin the `--plain`-does-not-import property (`cli.test.ts:581-599`) cannot fail, which plan.md's baseline instructs a verifier to treat as a defect. The behaviour it claims to pin is correct and was independently proven; the repair is a fixture swap.

### Defects for the correctness gate

- **D1 (blocking completeness, not correctness) - `packages/cli/src/cli.test.ts:581-599`: three assertions that cannot fail.** The test "never touches the ModuleLoader for a non-interactive invocation" supplies `createMemoryFileSystem()` (empty) as the discovery `fs`. `discover` therefore throws out of `readDependencyManifest` on the very first read - the repo's own `package.json` - long before any candidate is resolved, so `loader.resolveCalls`/`packageJsonPathForCalls`/`loadCalls` are `[]` whether or not the guard exists. Verified by deleting the `!terminal.isInteractive` branch at `cli.ts:302`: `cli.test.ts` stays 34/34 green. *Failure scenario:* a later task moves discovery back above the interactive check (or the check is refactored away), `blogwright init --plain` in CI resumes dynamically importing every installed plugin's module before refusing, and no test reddens. *Repair:* build the fixture with `buildDiscoveryPorts([{ packageName: 'blogwright-aaa', namespace: 'aaa', plugin }])` instead of an empty memory FS - i.e. a repo where plugins genuinely ARE installed. Validated during this gate: that fixture passes as shipped and fails (`expected [ { …(2) } ] to deeply equal []`) with the guard removed. This mirrors the two-signal discipline the sibling laziness test at `cli.test.ts:865-870` already documents.

- **D2 (minor) - `packages/cli/src/cli.test.ts:530-531`: the comment claims more than the test proves.** "Discovered in `bbb` then `aaa` order - the wizard must still ask `aaa` first, proving cli.ts's wiring sorts rather than trusting discovery order." `discover` already returns candidates sorted by PACKAGE name (`plugins.ts`'s `pluginDependencyNames` ends in `[...names].sort()`), and `blogwright-aaa` sorts before `blogwright-bbb` regardless of the fixture array's order - so the fixture never presents unsorted input. Confirmed: with the sort removed from `collectPluginBlocks`, this test still passes while `init.test.ts`'s does not. The sort also lives in `init.ts`, not in "cli.ts's wiring". *Failure scenario:* a reader trusts the comment and deletes the `init.test.ts` pin as redundant, leaving ordering unpinned. *Repair:* reword to say what it does prove (both discovered plugins are reached through the composition root and both blocks land in one file), or name package-vs-plugin names that actually disagree (e.g. `blogwright-one` exporting plugin `zzz`).

- **D3 (minor) - `packages/cli/src/init.test.ts:209`: the no-stray-comma assertion is trivially true, and no test covers a block in last position.** In that test both plugins contribute nothing, so the output is the fixed no-plugins vector, which never contains `,}`. The case where a comma could actually appear - a plugin block as the final top-level item - is unpinned: mutating `renderTopLevelItem` (`init.ts:170`) to always append a comma after a block leaves all 269 tests green, because `parseConfig` runs `stripTrailingCommas` and cannot observe one. The DoD's own wording ties this obligation to the declining case, which is why O3 stands. *Failure scenario:* a future refactor of the comma discipline emits `"zeta": { … },\n}` and every gate stays green; the file still loads in blogwright but is not valid JSON for any other tool reading it. *Repair:* assert the exact tail of the two-plugin vector (`'  }\n}\n'`), or compare the whole rendered string rather than substrings.
