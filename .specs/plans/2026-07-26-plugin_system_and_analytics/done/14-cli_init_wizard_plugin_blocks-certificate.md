# Done Certificate - Task 14: Ask every discovered plugin's questions during `blogwright init`

**Task:** [14-cli_init_wizard_plugin_blocks.md](14-cli_init_wizard_plugin_blocks.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 14. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.
>
> Third pass, 2026-08-30, by a third validating agent, over the TEST-ONLY delta that repairs
> the previous pass's D1/D2/D3. The production-code verdict is inherited under a byte-identity
> proof (P5 below), not re-asserted; everything the delta touches was re-derived from scratch.
> Every mutation named here was RUN by this gate against this working copy, its failure
> observed at a named `file:line`, and the file restored and hash-checked afterwards. No status
> is inherited from the earlier passes' account of them.

## Definition

DONE(Task 14) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `blogwright init` on a repo with plugins installed writes a single `config/production.jsonc` carrying the core entries plus every answered plugin block, and is byte-for-byte unchanged on a repo with no plugins.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `initSite`'s four core questions and their validators, the non-interactive refusal, the existing-file guard (`init.ts:238-241`), or the composition root's pre-context `init` branch (`cli.ts:300-341`).
- **P4 - Rebase premise.** The diff sits on `a936daf9`, which already carries task 11 and its "make the repo-root guard structural" follow-up; task 11's four-discovery-paths enumeration must survive this task's edit of the same comment.
- **P5 - Byte-identity premise (established, not assumed).** The previous gate returned CORRECT on `cli.ts` and `init.ts`. Those two files are byte-identical to that approved state, so its correctness verdict carries. Evidence: `jj evolog -r qxprqksm` gives the change's 13 recorded revisions; `cli.ts` has been `700b138f29f34e27c0ad993e2a77a2462dc3a127` since `17120acac7e2` (12:59) and `init.ts` `2fea81ba27984c3d40f031dc0020d5ed37f03cfa` since `03c46091454a` (13:05) - the revision carrying the `parseConfig(rendered)` pre-write guard the previous certificate discharges under O6, hence the state it reviewed. `jj diff --from 03c46091454a --to @` is empty for both files and reports exactly two changed files, `cli.test.ts` and `init.test.ts`. The delta is therefore test-only, and full re-verification of the production code was not triggered.

## Obligations

- **O1 - The no-plugins path is byte-for-byte unchanged.**
  - *Claim:* with no plugins installed, `blogwright init` writes exactly today's file, and the existing-file guard still returns 1 with its current message.
  - *Evidence collected (re-derived this pass):* the parent revision's `renderConfig` was extracted (`jj file show -r @- packages/cli/src/init.ts`, lines 64-91), transliterated with types stripped into a standalone script, and run for the `(myblog, us-east-1, blog.example.com, ant/myblog)` vector. `EXPECTED_NO_PLUGIN_CONFIG` (`init.test.ts:27-34`) was extracted from the TEST FILE AS TEXT - never by importing the module under test - and compared: **byte-identical**. The pin is therefore a true record of the parent's output, not a transcription of the new renderer's. `init.test.ts:114` compares with `toBe`, not `toContain`.
  - *Falsifiability:* `initSite`'s body replaced with an immediate `return 0` - the pinned no-plugins test fails, as do all 11 others (see O5's sweep). The existing-file guard test (`init.test.ts:154`) fails the same way.
  - *Structural check:* `renderTopLevelItem` (`init.ts:168-172`) reproduces the old comma rule exactly - the comma precedes the `// comment` suffix, and `i === items.length - 1` negates the old `i < entries.length - 1`. With `pluginBlocks` empty, `items` is the old `entries` array unchanged. `init.ts:229-241` is untouched by the diff.
  - *Status:* ☑ SATISFIED

- **O2 - Plugin questions asked in a deterministic order, blocks written into one file.**
  - *Claim:* each plugin's questions are asked in a deterministic order and each answered block lands in the single written file in the core commented style.
  - *Evidence collected:* `init.test.ts:166-216` passes two fake plugins in reverse order (`[zebra, apple]`) and asserts both the contributor order and the FULL scripted prompt sequence (four core prompts, then `apple`, then `zebra`). `cli.test.ts:507-561` drives the same property through `main` over `buildDiscoveryPorts`.
  - *D2 repair verified - the package/plugin-name inversion is real, not assumed.* The fixture now installs `blogwright-zzz` exporting the plugin named `aaa` and `blogwright-aaa` exporting the plugin named `zzz` (`cli.test.ts:541-544`). Two independent confirmations that discovery delivers `zzz` FIRST, so the asserted `['aaa','zzz']` can only come from `init.ts`:
    1. *Structural:* `plugins.ts:157-165` `pluginDependencyNames` ends in `[...names].sort()`; `collectCandidates` (`:201-204`) maps that sorted list straight to candidates; `discover`'s loop (`:416-426`) preserves candidate order; `rejectDeclaredInitCollisions` (`:374-391`) and `resolveNamespaceCollisions` (`:320-353`, a Map iterated in insertion order) both preserve it. Order out of `discover` is PACKAGE-name order.
    2. *Executed:* removing the sort at `init.ts:153` (`const sorted = [...plugins];`) makes `cli.test.ts:555` fail with **`expected [ 'zzz', 'aaa' ] to deeply equal [ 'aaa', 'zzz' ]`**. The observed receipt of `zzz` first is direct proof that discovery re-ordered the fixture array (written `zzz`-package-first, i.e. plugin `aaa` first) into package-name order. Restored; `shasum` back to `2fea81ba…`, 270/270 green.
  - *Mutation-verified, the gate's required two-file check:* that same single mutation now fails **both** files - `init.test.ts:196` (`expected [ 'zebra', 'apple' ] to deeply equal [ 'apple', 'zebra' ]`) and `cli.test.ts:555`. Under the pre-delta fixture only `init.test.ts` failed. The composition root's path is now pinned as well as the domain module's.
  - *The delta's new order assertion is a live, independent signal:* `cli.test.ts:560` (`written.indexOf('"aaa"') < written.indexOf('"zzz"')`). Mutating `init.ts` to `pluginBlocks.reverse()` after `collectPluginBlocks` - write order diverging from ask order, which the `toEqual`/`toContain` assertions cannot see - fails exactly `cli.test.ts:560` and `init.test.ts:234`, 268/270. Restored.
  - *Status:* ☑ SATISFIED

- **O3 - Declining and throwing contributors leave a valid or absent file.**
  - *Claim:* a plugin contributing no block adds nothing and leaves no stray comma (the file re-parses through `parseConfig`), and a plugin whose `init` throws leaves nothing written.
  - *D3 repair verified - the last-position comma is now pinned, byte-exact.* `init.test.ts:218-235` renders two blocks with the second last and compares to `EXPECTED_TRAILING_BLOCK_CONFIG` (`:52-63`). Both directions executed:
    - `renderTopLevelItem` (`init.ts:170`) always appending a comma: fails **only** `init.test.ts:234`, 269/270 - i.e. the mutation the previous gate showed was invisible to all 269 tests is now caught, and caught by this test alone.
    - `renderTopLevelItem` never appending one: the call rejects at `init.ts:276`'s pre-write `parseConfig` before writing, failing at the `initSite(...)` call sites `init.test.ts:193` and `:231`. Both directions the constant's doc comment claims are real.
  - *The constant was recorded independently, not copied from the implementation's output.* Re-derived by this gate without reading `init.ts`: assembled from (a) the parent revision's core-entry line style and header, (b) `renderConfigBlock`'s output shape written from `config-block.test.ts:14-21`'s OWN byte pin (`config-block.ts` is untouched by this diff, so its pin is an independent anchor - the reconstruction reproduces that pin exactly), and (c) the JSON grammar's comma rule (a comma between members, none after the last, placed before any same-line `//` suffix). The derived string is **byte-identical** to `EXPECTED_TRAILING_BLOCK_CONFIG`. It also discriminates: it parses as strict JSON once line comments are stripped, and does NOT parse either with a comma added after the last block or with the comma after `"alpha"` removed.
  - *D3 repair verified - the decline assertion is no longer trivially true.* `init.test.ts:267` now pins the two-decliner output byte-exact against `EXPECTED_NO_PLUGIN_CONFIG` (with the same four answers that constant was recorded for). Live signal: mutating `init.ts:159` to `blocks.push(block ?? '')` - a decliner emitting an empty block, whose name never appears, so `not.toContain('declines')` and `not.toContain('silent')` both still pass - fails at exactly `init.test.ts:267`, 11/12. Deleting the decline early-return (`init.ts:133`) fails at `:259`, 269/270. Restored after each.
  - *The "nothing written" assertions are live, not carried by the rejection.* Inserting `await fs.writeText(configPath, 'PARTIAL')` before `collectPluginBlocks` (the write-per-plugin design the DoD forbids) leaves every rejection intact but fails all three absence assertions - `init.test.ts:291`, `:303`, `:321` - 3 failed / 9 passed. Restored.
  - *Status:* ☑ SATISFIED

- **O4 - The loader stays at the composition root.**
  - *Claim:* the `ModuleLoader` `initSite` needs is constructed in `cli.ts`, not inside `init.ts`, and lint reports no new restricted import there.
  - *Evidence collected:* unchanged from the approved state under P5 - `cli.ts:301-341` builds ports from the same `makeDiscoveryPorts()` factory dispatch uses and calls `discover(repoRoot, cliPackageDir(), discoveryPorts)`; `initSite` takes `plugins: readonly Plugin[]` and holds no loader. `init.ts` imports only `blogwright-core`, `./config-block.js` and `./logger.js`. `pnpm -r lint` exits 0 with zero errors and no warning in any of the four touched files (25 warnings total, all pre-existing `no-shadow` in `src/nodes.test.ts`).
  - *Rebase check (P4):* `cli.ts` is byte-identical to the state whose four-path enumeration the previous gate verified (P5), and `jj diff` still reports zero deleted lines in `cli.test.ts`.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, limits are named constants, and - per plan.md's 2026-08-30 baseline additions - every assertion can fail.
  - *Six CI gates, run from the workspace root in CI order:* `pnpm -r build` Done; `pnpm -r typecheck` Done; `pnpm -r test` clean (core 140+1 skipped, analytics 2, build-agent 27, pds 100, cli 22 files / **270** tests); `pnpm -r lint` **exit 0**, 0 errors; `pnpm exec oxfmt --check .` "All matched files use the correct format" (142 files); `pnpm knip` **exit 0**. A changeset exists (`.changeset/init-wizard-plugin-blocks.md`, `"blogwright": minor`).
  - *D1 repair verified - the `--plain` laziness test can now fail.* `cli.test.ts:591-627` now builds its fixture with `buildDiscoveryPorts([{ packageName: 'blogwright-aaa', … }])` - a repo where a plugin genuinely IS installed and resolvable. Deleting `cli.ts:302-310`'s `if (!terminal.isInteractive)` block makes it fail at **`cli.test.ts:623:33`** - `expect(loader.resolveCalls).toEqual([])`, `expected [ { …(2) } ] to deeply equal []` - exactly the assertion the gate named, 33/34. Under the pre-delta empty-`createMemoryFileSystem()` fixture that same deletion left the file 34/34 green. Restored; `cli.ts` hash back to `700b138f…`, 34/34.
  - *Falsifiability walk - all 46 `it` blocks in both files accounted for, by execution:*
    - **`init.test.ts` 12/12:** replacing `initSite`'s body with an immediate `return 0` fails **every one** of the 12.
    - **`cli.test.ts` 30/34:** replacing `main`'s body with an immediate `return 0` fails 30.
    - The 4 survivors are accounted for individually, each killed by a targeted mutation: `RESERVED_COMMANDS > equals the CLI's own dispatch set` and `> does not reserve "pds"` do not call `main` (seeding `'pds'` into `RESERVED_COMMANDS` fails both, at `cli.test.ts:1069` and `:1087`); `toPluginContext > adapts an OpsContext` does not call `main` (`pluginConfig: { MUTATED: true }` in `plugin-commands.ts:247` fails it at `cli.test.ts:937`); and `main - generic plugin dispatch > never touches the ModuleLoader for deploy, status or bootstrap` (task 11's, outside this diff) is itself a "nothing happened" test that a no-op `main` trivially satisfies - forcing `cli.ts:349`'s `!KNOWN_COMMANDS.has(command)` to `true` so every built-in falls through to `runPlugin` fails it at `cli.test.ts:918` (`expected 3 to be +0`), and its fixture carries a real installed `blogwright-fake`, so its loader lists are live signals too.
    - Additional per-assertion probes beyond the `it` level are recorded under O2 (`cli.test.ts:560`), O3 (`init.test.ts:267`, `:291`, `:303`, `:321`) and O6 (`init.test.ts:319`). One residual near-tautology found and recorded as **D4** below; no obligation rests on it.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: the no-plugins vector is an exact comparison and the throwing case asserts nothing was written.**
  - *Claim:* a reviewer running the task's command observes both properties.
  - *Evidence collected:* the command was run exactly as written - `pnpm --filter blogwright exec vitest run init --reporter=verbose` - **12 passed** (the 11 the previous pass listed, plus "closes the object cleanly when a plugin block is the last top-level item, and commas the one before it (pinned byte-for-byte)"). The two named assertions are `expect(await fs.readText(…)).toBe(EXPECTED_NO_PLUGIN_CONFIG)` (`init.test.ts:114`) - an exact string comparison, and the constant independently confirmed equal to the PARENT revision's `renderConfig` output under O1 - and `expect(await fs.exists('/repo/config/production.jsonc')).toBe(false)` (`init.test.ts:291`), an absence assertion proven live under O3, not an assertion on a partial file.
  - *`parseConfig` symmetry:* removing `init.ts:276`'s `parseConfig(rendered)` fails exactly one test in the whole monorepo - `init.test.ts:319` ("never writes an unloadable config file…"), 269/270. That test is the sole live pin for the pre-write guard. Restored.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/cli.ts` and `packages/cli/src/init.ts` - byte-identical to the state the previous gate discharged (P5, `jj diff --from 03c46091454a --to @` empty for both). Its executed evidence against the BUILT binary (missing `package.json` warns and completes; malformed propagates with nothing written; `--plain` imports no plugin module; nine-vector byte identity against the parent renderer) carries unchanged. : ☑ PRESERVED
- `packages/cli/src/cli.test.ts` - the delta renames a fixture's plugin/package names, swaps one fixture, rewrites two comments and ADDS one assertion (`:560`). No assertion removed, no test deleted; 34/34. : ☑ PRESERVED
- `packages/cli/src/init.test.ts` - adds one constant and one test, strengthens one test's answers and its assertion, removes two assertions (`not.toMatch(/,\s*}/)`, one `parseConfig` round-trip) both shown redundant. 12/12. : ☑ PRESERVED
- Whole monorepo - 539 tests across five packages, all green; all six CI gates exit 0. : ☑ PRESERVED
- Working copy restored after every mutation: `cli.ts` `700b138f…`, `init.ts` `2fea81ba…`, `cli.test.ts` `bf80a706…`, `init.test.ts` `48d5c340…`, plus `known-commands.ts`, `context.ts` and `plugin-commands.ts` (`8dd1114a…`) all matching their pre-gate hashes; `jj diff --stat` is the original five files, 604 insertions / 31 deletions. : ☑ PRESERVED

## Residue

- Ordering by plugin `name` is one deterministic choice among several the DoD allows.
- `blogwright init` now reads the repo's root `package.json` where it never did before; a malformed manifest blocks initialisation until fixed. Deliberate, matching task 11's decision for `helpText`.
- A contributor with no `configKey` aborts the whole wizard, mirroring `runGenericInit` rather than `plugins.ts`'s collect-never-throw discipline. Argued in the function's doc comment; accepted.
- Nothing validates `configKey` against the core keys. Task 19 owns the duplicate-`configKey` rejection; the core-key case is out of scope for every current task.
- `plugin-commands.ts:381` still says "cli.ts's `init` branch already constructs a `FileSystem` directly with no context at all", which this task makes false. Stale prose in an untouched file.
- `isNoRepoRootError`'s doc comment (`cli.ts:137-144`) claims message-prefix matching while the body is `instanceof RepoRootNotFoundError`. Pre-existing drift inherited by the rebase.
- `init.test.ts:150` (`expect(terminal.prompts).toEqual([])`) and `cli.test.ts:652` (`fs.exists(…) === false`) are second signals that their tests' earlier assertions reach first under every mutation tried. Both `it` blocks are falsifiable; the redundancy is the codebase's documented two-signal discipline, not a vacuity.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: high
SUMMARY: The delta is test-only - `cli.ts` and `init.ts` are byte-identical to the state the previous gate returned CORRECT on (`jj diff` empty for both against `03c46091454a`, the revision carrying the `parseConfig` pre-write guard that certificate discharges), so that verdict carries and the scope stayed on test quality. All three repairs were re-proven by mutations this gate ran itself: deleting `cli.ts:302`'s guard now fails `cli.test.ts:623` on `loader.resolveCalls` where the old fixture stayed 34/34 green; removing `init.ts:153`'s sort now fails BOTH files, and the observed `['zzz','aaa']` receipt is direct proof that `discover` really does deliver in package-name order, so the D2 name inversion pins the sort in `init.ts` and nothing else; making `renderTopLevelItem` always comma fails `init.test.ts:234` alone, 269/270, where before it was invisible to all 269. Both byte-exact constants were re-derived without reading the implementation - `EXPECTED_NO_PLUGIN_CONFIG` from the parent revision's own `renderConfig`, `EXPECTED_TRAILING_BLOCK_CONFIG` from `config-block.test.ts`'s independent block pin plus the JSON grammar - and both matched byte for byte. The falsifiability walk covers all 46 `it` blocks by execution: 12/12 in `init.test.ts` and 30/34 in `cli.test.ts` die to a no-op module, and each of the four survivors was killed by a targeted mutation. All six CI gates green from the workspace root; the `Reviewable:` command passes 12/12 with both named properties present. One residual defect (D4) is recorded - it is redundant coverage, not the sole evidence for any obligation, so it does not withhold the verdict.

### Defects for the correctness gate

- **D4 (minor, non-blocking) - `packages/cli/src/init.test.ts:215` is a round-trip assertion no single-point mutation can fail, and the comment at `:268-273` names it as load-bearing.** `written` is whatever `initSite` wrote, and `initSite` writes only after `parseConfig(rendered)` succeeds at `init.ts:276`, writing exactly that string - so `expect(() => parseConfig(written)).not.toThrow()` is determined by the production guard. Confirmed by execution: with `init.ts:276` removed, `init.test.ts:166`'s test still passes (only `:319` fails), so `:215` fires under neither the guard's presence nor its absence. This is the same tautology the implementer correctly deleted at `:267`; the comment left in its place - "The round-trip is asserted where the output is NOT a fixed constant (the two plugin tests above)" - over-claims twice: of the two plugin tests above, `:218` compares against a fixed constant (so by the comment's own reasoning a round-trip there would be a tautology too) and `:166`'s is the dominated assertion just described. The property is genuinely pinned, but by `init.test.ts:306` (below, not above), which this gate proved is the sole killer of removing `init.ts:276`. *Failure scenario:* a reader trusts the comment, treats `:306` as redundant with `:215`, and deletes it; `init.ts:276` can then be removed with all 269 remaining tests green, and a plugin composing invalid JSON into its block writes a `config/production.jsonc` the CLI's own parser cannot load back - the one thing the feature promises never to do. *Repair:* point the comment at `:306` instead, and either drop `:215` or replace it with an assertion on the parsed value (e.g. `parseConfig(written).apple`), which the guard does not determine.
