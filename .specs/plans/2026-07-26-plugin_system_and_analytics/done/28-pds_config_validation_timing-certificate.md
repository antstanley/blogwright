# Done Certificate - Task 28: Pin what an invalid pds config block does on built-in commands after validation moves into the plugin

**Task:** [28-pds_config_validation_timing.md](28-pds_config_validation_timing.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-31

> This certificate is a verification protocol for Task 28. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 28) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The settled dispatch-time validation is pinned by tests - a malformed `pds` block accepted by `bootstrap`, `deploy` and `status`, which load no plugin, and rejected by `blogwright pds <action>` with core's original messages - with the divergence carried in the changeset in the same words as the spec's §Upgrading a deployed stack item 5.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `loadConfig`/`createContext` for a repo with no plugins (`packages/cli/src/context.ts:197,210`), the laziness of discovery for built-in commands (`packages/cli/src/plugins.ts`, task 08), or the existing `loadConfig` cases at `packages/cli/src/context.test.ts:8-55`.

**Diff under review:** workspace `/Users/ant/code/blogwright-task-28`, change `wzuqozkx eb8ba726`,
parent `tvmyyxwv 40177c14` (build 53/62). Six paths: `.changeset/pds-config-validation-timing.md`
(new), `packages/cli/src/cli.test.ts`, `packages/cli/src/context.test.ts`,
`packages/pds/src/config.test.ts`, `packages/pds/src/config.ts`, `packages/pds/src/sync.ts`.

## The change, stated

`packages/pds/src/config.ts:76` inserts one guard as the FIRST statement of
`validatePdsConfig`, before the `const cfg = raw as PdsConfig` cast at :77 and therefore before
any dereference:

```ts
if (raw === undefined || raw === null) throw new Error(NO_PDS_SECTION_MESSAGE);
```

`NO_PDS_SECTION_MESSAGE` (`config.ts:43-44`) is the single production copy of the sentence;
`sync.ts:10` imports it and `requirePdsConfig` (`sync.ts:67`) raises it instead of its former
literal. `grep` over `packages/**/*.ts` finds exactly one production definition and one
production import - no second copy anywhere outside `dist/`.

## Obligations

- **O1 - Both malformed blocks have a pinned outcome on a built-in path.**
  - *Claim:* tests load a config whose `pds.name` is blank and one whose `pds.handleResolver` is `http://resolver` through `loadConfig`/`createContext` - the path `bootstrap` takes - and assert the resulting behaviour.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run context --reporter=verbose` → 33/33 pass, 7 of them the new `pds config validation timing` block (`context.test.ts:840-1078`).
    `context.test.ts:939` drives `loadConfig` DIRECTLY over a memory FS holding `BLANK_NAME`
    (`{"siteName":"example","pds":{"name":"   "}}`) and `HTTP_RESOLVER`, asserting both halves of
    the result (`config.pds` and `raw['pds']`) survive unchanged. `context.test.ts:958` drives
    `main(['bootstrap'|'deploy'|'status'])` through a `ContextFactory` that calls the REAL
    `loadConfig` with the same three options `createContext` passes it, and `context.test.ts:1061`
    asserts both halves of the divergence against ONE `HTTP_RESOLVER` fixture.
  - *Checks:* the function that performs the pds check in that trace is **nothing at all** on the
    built-in path - confirmed structurally (`grep` finds `validatePdsConfig`'s only non-test caller
    is `plugin.ts:181`, wiring it as the plugin's `validateConfig`, reached only from
    `resolvePluginConfig` in the dispatch path) and empirically (`contexts` has length 3 and each
    carries `config.pds === { name: '   ' }`). Falsified by mutation: forcing discovery onto the
    built-in path (see O2) reddens `context.test.ts:992`. No eager validation crept in.
  - *Status:* ☑ SATISFIED

- **O2 - The settled divergence is pinned and recorded, not re-decided.**
  - *Claim:* the built-in commands accept the malformed block while loading no plugin module (task 19's dispatch-scoped validation), `blogwright pds <action>` rejects it, and the divergence appears in the changeset in the same words as the spec's §Upgrading a deployed stack item 5.
  - *Evidence collected:*
    - **Zero loads on the built-in path.** `context.test.ts:992-996` records
      `discoveryPortsCalls === 0`, `loader.resolveCalls === []`, `loader.packageJsonPathForCalls === []`,
      `loader.loadCalls === []` after `bootstrap`, `deploy` and `status` all ran with `BLANK_NAME`
      present - and `contexts` has length 3, so all three built a context (acceptance) rather than
      short-circuiting.
    - **The empty recorders are not vacuous.** The SAME `loader` object fills the moment a plugin is
      dispatched: `context.test.ts:1010` asserts `loader.loadCalls.length > 0` on the `pds keygen`
      refusal, and `context.test.ts:1053` asserts `s3Keys === ['state/production.pds.json']` on the
      valid dispatch against `[]` on the refusals (`context.test.ts:1006`), and
      `calls.map(a => a.action) === ['keygen']` against `calls === []`. Every empty-list assertion in
      the block has a filling counterpart on the same recorder.
    - **Rejection on the plugin path.** `context.test.ts:998` and `:1014` assert the full wrapped
      strings for the blank `name` and the `http://` resolver.
    - **Changeset vs spec.** Word-level diff of `.changeset/pds-config-validation-timing.md`
      paragraph 2 against `.specs/changes/2026-07-26-migrate_pds_to_plugin_system.md:451-462`
      (§Upgrading a deployed stack item 5): SequenceMatcher ratio 0.930, and the only differences are
      four tense edits (`Today core's` → `Core's`; `rejects` → `used to reject`; `fails` → `failed`;
      `After the migration the` → `The … now`). The bolded headline sentence, the named commands, the
      named inputs, the `deploy` post-deploy-sync clause and the closing clause are word-for-word.
      The spec still lists it at item 5.
  - *Checks:* not re-decided - no validation was added to `createContext`/`loadConfig`; the guard sits
    inside the plugin's own validator, which is reached only from `resolvePluginConfig`
    (`plugins.ts:662-677`). Falsified by **Mutation D**: inserting
    `await discover(await findRepoRoot(mutationDiscoveryPorts.fs), cliPackageDir(), mutationDiscoveryPorts)`
    ahead of the built-in `makeContext` call (`cli.ts:447`) turns the CLI suite red - 4 failures,
    including this task's `context.test.ts:992` and the two pre-existing laziness pins
    (`context.test.ts:814`, `:1052`). Restored; hash verified.
  - *Status:* ☑ SATISFIED

- **O3 - No silent change of verdict in either direction.**
  - *Claim:* no config valid today becomes invalid and none invalid today is silently accepted, without a test asserting that outcome and the commit description naming it.
  - *Evidence collected:* `pnpm test` at the workspace root → 5 packages, 1398 tests, 0 failures
    (core 149+1 skipped, build-agent 27, pds 150, analytics 701, cli 371). Enumerated pds-block
    inputs and their asserted verdicts:
    | input | verdict | asserted at |
    |---|---|---|
    | valid block | dispatches through, `main` returns 0, `pluginConfig` is the validated block | `context.test.ts:1044` |
    | blank `name` | accepted on built-in, refused at dispatch with `config.pds.name is required` | `context.test.ts:958`, `:998`; `config.test.ts:66` |
    | `http://` resolver | accepted on built-in, refused at dispatch with `…must be https, got "http://resolver"` | `context.test.ts:1014`, `:1061`; `config.test.ts` |
    | non-URL resolver | refused, `…must be a URL` (try/catch ordering also pinned) | `config.test.ts` (pre-existing, green) |
    | bad `secretName` | refused, `…has invalid characters` | `config.test.ts` (pre-existing, green) |
    | absent block (`undefined`) | refused with the section sentence, plain `Error` | `config.test.ts:32,38`; `context.test.ts:1025`; `cli.test.ts:1420` |
    | `"pds": null` | refused as absent | `config.test.ts:49` |
    | non-object (`42`, `"pds"`, `[]`) | falls through unchanged, keeps `config.pds.name is required` | `config.test.ts:57-68` |
    The commit description names both directions verbatim ("No config file that is valid today
    becomes invalid, and none that is invalid today is silently accepted. Both directions are
    asserted: …").
  - *Checks:* the ONLY value class whose verdict changed is absent/`null`, which moved from
    `TypeError` to a plain `Error` with a better sentence - both refusals, so no config gained or
    lost validity. `null`-as-absent is justified by the two gates that always treated it so: core's
    `if (cfg.pds)` (now deleted by task 27) and `requirePdsConfig`'s `if (!pds)` (`sync.ts:66`);
    `syncAfterDeploy` (`commands.ts:210`) also returns early on `!ctx.config.pds`, so `"pds": null`
    stays a no-op there, consistent with the new refusal. Falsified by mutation:
    - **Mutation C** (`raw === undefined` only, dropping `null`) → 1 failure, `config.test.ts:49`.
    - **Mutation E** (widen the guard to `|| typeof raw !== 'object'`) → 1 failure,
      `config.test.ts:62`: `Received: "Error: config has no \"pds\" section …"` where
      `config.pds.` was expected. The guard's narrowness is pinned.
    Both restored; hashes verified.
  - *Status:* ☑ SATISFIED

- **O4 - Rejection messages are core's original strings.**
  - *Claim:* a rejected `pds` block reports `config.pds.name is required` and `config.pds.handleResolver must be https, got "http://resolver"` - the strings core raised before task 27.
  - *Evidence collected:* the assertions compare the FULL message with `toBe`, not a regex on `pds`:
    `context.test.ts:1002` → `` `${REFUSED}config.pds.name is required` ``;
    `context.test.ts:1017` and `:1074` → `` `${REFUSED}config.pds.handleResolver must be https, got "http://resolver"` ``,
    where `REFUSED` is the literal `'plugin "pds" rejected the "pds" config block: '` spelled out at
    `context.test.ts:876`. `config.ts:77-90` is unchanged in the diff - the strings are the ones task
    21 lifted verbatim from core, and the diff adds no edit to any of them.
  - *Checks - THE TASK'S CENTRAL TRAP, independently reproduced.* The DoD's "unchanged messages"
    is satisfied *literally* by a bare `(raw ?? {})` guard, which would leave an absent block
    reporting `config.pds.name is required`. **Mutation B** applied exactly that - deleting
    `config.ts:76` and rewriting `:77` to `const cfg = (raw ?? {}) as PdsConfig;`, applied under an
    assert-count-then-abort (`assert s.count(old)==1`). Result, with the real exit code read by
    redirect-then-`$?`:
    - `packages/cli` `vitest run cli.test` → **exit 1**, 1 failed / 44 passed. Task 29's pin
      (`cli.test.ts:1428`) reports
      `Expected: "plugin "pds" rejected the "pds" config block: config has no "pds" section - add it to config/production.jsonc"`
      / `Received: "plugin "pds" rejected the "pds" config block: config.pds.name is required"`.
    - `packages/cli` `vitest run context` → **exit 1**, `context.test.ts:1025` fails.
    - `packages/pds` `vitest run` → **exit 1**, 2 failures (`config.test.ts:32`, `:49`).
    The pin does NOT go green over the still-wrong message. The trap is avoided.
    Also falsified: **Mutation A** (guard deleted entirely, restoring the `TypeError`) → 5 failures
    across both packages (`cli.test.ts:1420`, `context.test.ts:1025`, `config.test.ts:32,38,49`).
    **Mutation F** (the shared constant's string changed to `'MUTATED absent-block sentence'`) →
    5 failures across both packages, including the PRE-EXISTING
    `sync.test.ts:83 requirePdsConfig > throws when the config has no "pds" section` - so the
    shared-constant refactor is pinned by a string literal at BOTH refusal sites and cannot drift
    silently. All mutations restored; SHA-256 of every touched file matches the pre-mutation value.
  - *Checks - self-reference discipline.* `grep -rn NO_PDS_SECTION_MESSAGE packages/ --include='*.ts'`
    returns **zero** hits in any `*.test.ts`. Every one of the five test-side occurrences of the
    sentence (`config.test.ts:34,53,63`, `sync.test.ts:86`, `context.test.ts:1036`, `cli.test.ts:1430`)
    is a written-out literal. No assertion compares the code's constant with itself; Mutation F
    proves the assertions can fail.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the workspace root, in `ci.yml` order, exit
    codes read by redirect-then-`$?` (harness validated first with a control: `false > /dev/null 2>&1`
    → 1, `true` → 0, and the zsh pipeline defect confirmed - `false | tail -1; echo $?` → 0):
    | gate | exit | note |
    |---|---|---|
    | `pnpm build` | 0 | all 5 packages |
    | `pnpm typecheck` | 0 | all 5 packages |
    | `pnpm test` | 0 | 1398 passed, 1 skipped |
    | `pnpm lint` | 0 | 5 pre-existing `no-shadow` warnings in `cli/src/nodes.test.ts`, untouched by this diff |
    | `pnpm exec oxfmt --check .` | 0 | 201 files, all correctly formatted |
    | `pnpm knip` | 0 | clean; `NO_PDS_SECTION_MESSAGE` has a real consumer (`sync.ts:10`), no manufactured one |
    A changeset exists and the change is user-facing.
  - *Checks:* the new limit is a named constant (`NO_PDS_SECTION_MESSAGE`), not a literal; no logic is
    duplicated (one definition, one import); the error is raised with context and no `null` is
    returned for a domain value. No assertion in the new tests can pass unconditionally - each was
    driven red by at least one of Mutations A-F.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `pnpm test -- context` plus the recorded divergence (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- context` in `packages/cli`, observe both malformed-block cases asserting the settled outcome - acceptance on the built-in path, core's exact message on the `pds` path - and read the recorded divergence in the changeset and the spec's §Upgrading a deployed stack item 5.
  - *Evidence collected:* the task's own `Reviewable:` line run VERBATIM from `packages/cli` -
    `pnpm --filter blogwright exec vitest run context --reporter=verbose` → **exit 0**, 33 passed.
    The seven `pds config validation timing` cases all green, by name:
    `parses a malformed \`pds\` block without complaint - nothing on the built-in path validates it`;
    `lets \`bootstrap\`, \`deploy\` and \`status\` run on a malformed block, loading no plugin module`;
    `rejects the same blank \`name\` on \`blogwright pds <action>\`, with core's original message`;
    `rejects an http:// handleResolver on \`blogwright pds <action>\`, with core's original message`;
    `names the missing section, not a key inside it, when the repo has no \`pds\` block at all`;
    `still dispatches a VALID block through to the command, on the same path`;
    `accepts the malformed block on the built-in path even where it is dispatch-rejected`.
    The divergence paragraph is `.changeset/pds-config-validation-timing.md:8`; the spec's item 5 is
    `2026-07-26-migrate_pds_to_plugin_system.md:451-462`; both quoted and diffed under O2.
  - *Status:* ☑ SATISFIED

## Regression check

- `packages/cli/src/cli.ts:447` (the single `makeContext` call every context-taking built-in reaches,
  formerly cited as :134) loads a valid production config with a `pds` block → the diff adds no code
  on this path; `validatePdsConfig`'s only non-test caller is `plugin.ts:181`, reached only from
  `resolvePluginConfig` in the dispatch path. Full CLI suite 371/371 green. : ☑ PRESERVED
- `packages/cli/src/context.test.ts` `surfaces validation failures instead of trying the next candidate`
  → green in the baseline and in the `Reviewable:` run; no new validation stage exists to disturb it. : ☑ PRESERVED
- `packages/cli/src/commands.ts` (`deploy` → `syncAfterDeploy`) for a repo with no plugin installed →
  `syncAfterDeploy` (`packages/pds/src/commands.ts:210`) returns early on `ctx.env !== 'production' || !ctx.config.pds`
  (a PRESENCE check, unchanged), and every downstream failure is caught into a non-fatal
  `pds sync failed (deploy unaffected): …` warning (`commands.ts:218-220`). `"pds": null` takes the
  early return, matching the new absent-block decision. `deploy` loads no plugin module
  (`context.test.ts:992`). pds suite 150/150 green. : ☑ PRESERVED
- **Additional, not in the authored list.** `blogwright plugin remove pds` answered *yes* on a repo
  with no `pds` block - the live sequence the ROUTED FINDING's CORRECTION named. Path:
  `destroyBeforeRemoval` → `resolvePluginConfig` → `validatePdsConfig(undefined)`. Before: wrapped
  `TypeError`. After: wrapped `config has no "pds" section - add it to config/production.jsonc`. The
  teardown is still refused (the rejection propagates and the uninstall does not run, by design -
  `plugin-commands.ts:1081-1085`), but the refusal is now a validator's own sentence rather than a
  property-access failure, which is the latitude the routed finding granted ("a clear refusal may be
  right - but a bare `TypeError` is neither"). Answering *no*, or passing `--yes`, still uninstalls.
  : ☑ PRESERVED (improved)

## Integration

- **Overlap with in-flight task 59** (`zpstzynv ed1e1864`, which touches `.changeset/cli-site-graph-drops-pds.md`,
  `docs/…/ci-github-oidc.md`, `packages/cli/src/nodes.ts`, `packages/cli/src/nodes.test.ts`,
  `packages/core/src/config.ts`, `packages/pds/src/nodes.ts`, `packages/pds/src/nodes.test.ts`):
  `comm -12` over the two sorted path sets is **empty**. Zero overlap, including the changeset
  filenames.
- **Overlap with build 54** (`qzromurttlrx acababca`, task 53 - `packages/analytics/src/nodes.{ts,test.ts}`,
  `packages/cli/src/nodes.test.ts`, plan/spec files): zero overlap with this task's six paths.
- **Merge is clean.** Read-only `git merge-tree --write-tree --messages` (this is a colocated
  jj/git repo, so no working copy or operation log is touched):
  `acababca` (build 54) × `eb8ba726` (task 28) → exit 0, tree `278b0066`, no conflict messages;
  `ed1e1864` (task 59) × `eb8ba726` → exit 0, tree `c3ec018f`, no conflict messages.

## Disclosed gaps - ruling

1. **`createContext` is never invoked by the tests (real STS/S3 required); `loadConfig` is exercised
   directly and `main(['bootstrap'|'deploy'|'status'])` is driven through a `ContextFactory` calling
   the real `loadConfig`. Sufficient?** **YES - sufficient.** Verified against the source:
   `createContext` (`context.ts:210-227`) does exactly ONE piece of config work - the
   `loadConfig(ports.fs, { env, root, configPath })` call at :222 - and everything after it is
   `sts.getAccountId()` and `StateStore.load()`, neither of which reads the `pds` block. The
   fixture's factory (`context.test.ts:895-901`) reproduces that call with the same three options.
   The residual - that `createContext` passes those three options correctly - is `loadConfig`'s own
   contract and is pinned by the pre-existing `loadConfig` describe block. The pattern is also not
   novel to this task: `buildDispatchFixture` (`context.test.ts:448`), landed by task 19, does the
   same thing for the same reason.
2. **`packages/pds/src/nodes.ts:195` still reads `ctx.config.pds` rather than `ctx.pluginConfig`.**
   **Out of scope, and harmless today.** `buildPdsNodes` is not a validation site, and it is
   unreachable from the built-in path (zero `ModuleLoader` calls). On the dispatch path the block
   has already been validated before `nodes` is called, and `ctx.config.pds` and `pluginConfig`
   derive from the same document, so no divergence exists. Task 59 is the change that owns this file.
   *Observation for whoever lands 59:* the doc comment at `nodes.ts:191-192` ("the CLI does not
   populate `pluginConfig` from a plugin's own validator until later in this migration") is now
   stale - task 19 landed that, and `context.test.ts:1055` asserts it - but the comment is not in
   this diff and is not this task's to fix.

## Residue

Task 27's changeset and this one are both still pending in `.changeset/`, so the "ship in the same
release" constraint the authored certificate names is satisfied by construction: no release has been
cut between them (`packages/cli/CHANGELOG.md` tops out at 0.3.3, and no changelog mentions the
`Cannot read properties of undefined` message).

**One release-prep item, not a defect in this task.** `.changeset/pds-config-validation-timing.md:6`
attributes the `TypeError` to "the known issue **the previous release** named", and
`.changeset/pds-dispatched-as-a-plugin.md:9` (task 29) still carries that known issue with "a fix to
the plugin's own config validator **follows**". Both changesets are unreleased and will aggregate
into ONE version bump, so the released notes would announce a known issue that the same release
fixes. The construction is the build's own established changeset convention - task 29's changeset
uses the identical "the previous release already named" phrasing about another same-batch changeset -
and this task's commit description gets it right ("This closes the known issue task 29's changeset
named"). Whoever cuts the release should drop or reword task 29's known-issue paragraph.

Not covered by the DoD, and unchanged by this verdict: whether the same absent-block gap exists for
the `analytics` config key once that plugin ships (the dispatch-scoped mechanism means it does; task
44's validator is likewise reached only at dispatch, and task 19's contract already hands it
`undefined` - it answers with a fully-defaulted block rather than a refusal, which is the right answer
for a plugin that HAS derivable defaults, as this one does not).

Two weaknesses worth naming without failing anything:
- `context.test.ts:975` proves `status` "accepted" the block by asserting `main` did not *throw*,
  not that it returned 0. Mutation G (`case 'status': … return 7;`) leaves `vitest run context` GREEN.
  Structurally the built-in `switch` (`cli.ts:454-493`) has exactly one non-default exit and it is
  `return 0`, so non-throw ≡ exit 0 today; and the wider CLI suite DOES catch Mutation G
  (`reaches commands.status, which completes despite a rejecting AWS transport`). No hole in the
  suite as a whole.
- `context.test.ts:981-982` asserts `bootstrap` and `deploy` merely fail *truthily*. Inspected by
  temporary assertion swap (restored, hash verified): `bootstrap` fails with
  `unexpected AWS request in test: HEAD https://s3.us-east-1.amazonaws.com/production-example-…`
  and `deploy` with `RepoRootNotFoundError: could not find the repo root …` - both well past config
  parsing, which corroborates the acceptance claim the in-file comment makes.

## Mutation ledger

Every mutation applied under an assert-count-then-abort, run with the real exit code read by
redirect-then-`$?` (the pipeline form was confirmed to report `tail`'s status and was not used), and
restored with SHA-256 verification.

| # | mutation | file | caught by | exit |
|---|---|---|---|---|
| A | guard deleted entirely (restores the `TypeError`) | `config.ts:76` | 5 tests, both packages | 1 / 1 |
| B | `(raw ?? {})` - the naive guard the DoD's literal reading admits | `config.ts:76-77` | `cli.test.ts:1428`, `context.test.ts:1025`, `config.test.ts:32,49` | 1 / 1 / 1 |
| C | `null` no longer absent | `config.ts:76` | `config.test.ts:49` | 1 |
| D | built-in path runs discovery | `cli.ts:447` | `context.test.ts:992` + 2 pre-existing laziness pins + 1 | 1 |
| E | guard widened to swallow non-objects | `config.ts:76` | `config.test.ts:62` | 1 |
| F | shared constant's string changed | `config.ts:43` | 5 tests incl. pre-existing `sync.test.ts:83` | 1 / 1 |
| G | `status` returns 7 without throwing (probe, not a claimed mutation) | `cli.ts:479` | NOT by `context`; caught by the wider CLI suite | 0 / 1 |
| I | inspection swap to reveal `bootstrap`/`deploy` failure strings | `context.test.ts:981-982` | n/a | 1 |

**Restore proof.** Post-restore SHA-256 equals the pre-mutation value for all three mutated files -
`packages/pds/src/config.ts` `d84e2ff9…`, `packages/cli/src/cli.ts` `516b2c26…`,
`packages/cli/src/context.test.ts` `b29d7fc6…`; `grep` for the mutation markers
(`mutationDiscoveryPorts`, `MUTATED absent`, `__PRINT_`) over `packages/**/*.ts` returns 0 hits;
`jj status` in the workspace lists the same six paths and no others; and the six gates were run
AFTER the restore.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are satisfied with named evidence - the guard splits ABSENT from
MALFORMED before the first dereference at `config.ts:76`, the two refusal sites share one exported
constant asserted only through written-out literals, six mutations (including the `(raw ?? {})` trap
the task existed to avoid and the discovery-on-the-built-in-path mutation) each drive at least one
new assertion red, all six CI gates and the verbatim `Reviewable:` line are green from the workspace
root, the changeset carries §Upgrading a deployed stack item 5 word-for-word bar four tense edits and
closes the known issue task 29's changeset named, and the change merges cleanly onto build 54 with
zero path overlap with in-flight task 59.
