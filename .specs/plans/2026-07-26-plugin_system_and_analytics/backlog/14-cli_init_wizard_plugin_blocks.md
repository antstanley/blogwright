# Task 14 - Ask every discovered plugin's questions during `blogwright init`

**Plan:** [plan.md](../plan.md) · **Certificate:** [14-cli_init_wizard_plugin_blocks-certificate.md](14-cli_init_wizard_plugin_blocks-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → `blogwright <plugin> init` (Add)](../../../changes/2026-07-26-cli_plugin_system.md) ("`blogwright init` on a repo with no config asks each discovered plugin's questions and writes one file containing every answered block")
**Depends on:** 13
**Produces:** `blogwright init` on a repo with plugins installed writes a single `config/production.jsonc` carrying the core entries plus every answered plugin block, and is byte-for-byte unchanged on a repo with no plugins
**Pointers:** `packages/cli/src/init.ts:72` (`initSite` - gains the discovered plugins as an argument), `packages/cli/src/init.ts:42` (`renderConfig` - the core entries and the commented style), `packages/cli/src/init.ts:87` (the existing-file guard that must not change), `packages/cli/src/init.ts:112-115` (the single `fs.writeText` - still the only write), `packages/cli/src/cli.ts:107-110` (the composition root's `init` branch, where `createNodeFileSystem()` is constructed today and the `ModuleLoader` adapter must be constructed too), `packages/cli/src/plugins.ts` (task 08 - `discover(repoRoot, ports)`)

## Steps

- [ ] Widen `initSite` (`init.ts:72`) to take the already-discovered plugins from its caller - a plain array, not a loader - so `init.ts` gains no new import and stays a domain module.
- [ ] Construct the `ModuleLoader` adapter and run discovery in `cli.ts:107-110` beside the existing `createNodeFileSystem()`, passing the result into `initSite`; keep the "runs before any context exists" comment accurate. `init` is one of the four paths the spec's discovery rule names - with dispatch, help and `plugin list` - so task 11's module comment must already list it; if it does not, correct the comment here rather than leaving the code outside the stated rule.
- [ ] Ask each plugin's questions after the four core questions, in a deterministic order (sort by plugin `name`), reusing the same `ask`/`io` surface task 13 built so the two paths reach the contributor identically.
- [ ] Collect the answered blocks and render them into the one string `renderConfig` produces, appending each block inside the top-level object with the comma discipline the existing entry loop already uses (`init.ts:62-68`) - one `fs.writeText`, never a write per plugin.
- [ ] Add `init.test.ts` cases: no plugins (pinned byte-for-byte against today's output), two fake plugins (deterministic order, both blocks present, result re-parsed with `parseConfig`), one plugin declining, and one plugin whose `init` throws.

## Definition of done

- [ ] On a repo with no plugins installed the wizard is unchanged: `blogwright init` writes exactly the file it writes today (pinned byte-for-byte test against the current `renderConfig` output), and the existing-file guard at `init.ts:87` still returns 1 with its current message with the existing test passing untouched.
- [ ] With plugins installed, each plugin's questions are asked in a deterministic order and each answered block is rendered into the single written file in the same commented style as the core entries - test with two fake plugins and a scripted terminal, asserting both the order of prompts and the presence of both blocks.
- [ ] A plugin that contributes no block (declined, or carrying no `init`) adds nothing and leaves no stray comma, and a plugin whose `init` throws leaves the config file unwritten - the written file re-parses through `parseConfig`, and the throwing case asserts `fs.exists(configPath)` is false.
- [ ] `initSite` still runs before any context exists and stays a domain module: the `ModuleLoader` it needs is constructed by the composition root (`cli.ts`), not inside `init.ts`, and `pnpm lint` reports no new restricted import there.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- init`; confirm the no-plugins vector is an exact string comparison against today's output and that the throwing-plugin test asserts nothing was written rather than asserting on a partial file.
