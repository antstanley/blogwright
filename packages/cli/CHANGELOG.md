# blogwright

## 0.4.0-beta.2

### Patch Changes

- Updated dependencies []:
  - blogwright-core@0.4.0-beta.2
  - blogwright-pds@0.4.0-beta.2

## 0.4.0-beta.1

### Patch Changes

- Updated dependencies []:
  - blogwright-core@0.4.0-beta.1
  - blogwright-pds@0.4.0-beta.1

## 0.4.0-beta.0

### Minor Changes

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright --help` now appends one section per installed plugin, built from its `description` and its commands' `action`/`summary` fields, so help output reflects what is actually installed; a plugin that fails to load is listed by package name and reason (no stack trace) rather than breaking `--help`. The same enriched help now also appears wherever a USAGE-style error already printed it - `blogwright pds <bogus-action>` and `blogwright preview <bogus-action>`. With no plugins installed, `--help` output is unchanged. `--help` and a bare invocation still print full help and keep their existing exit codes even outside a repo or in a repo with no root `package.json` yet - discovery's own preconditions no longer prevent `--help` from answering at all.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `SendOptions.service` and `resolveEndpoint` now also accept a plugin-supplied service descriptor (`{ service, signingName, global? }`) alongside core's own `ServiceKey`, so a plugin can sign SigV4 requests against an AWS service core does not enumerate without an edit to core. `SIGNING_NAMES` is unchanged - core's own clients keep signing exactly as before, byte-identical requests included.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Add generic plugin dispatch: `blogwright <plugin> <action> [env] [args]` now routes to any installed plugin's command, matching multi-word actions (e.g. `secret status`) by declaration rather than positional shifting, resolving the environment the same way every built-in command does (a trailing positional, overridden by `--env`, defaulting to `production`), and forwarding flag values through to the command. An unknown first positional now reports that no built-in command or installed plugin claims it and suggests `blogwright plugin list`, instead of the previous generic "unknown command" message; an unknown action inside a known plugin lists that plugin's declared actions. Built-in commands (`deploy`, `bootstrap`, `status`, etc.) are unaffected and still load no plugin module. No plugin ships with the CLI yet beyond the existing `pds` branch, so this has no effect until a plugin is installed.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright init` now asks each installed plugin's questions too: after the four core questions, it runs every discovered plugin's `init(io)` contributor - in deterministic, name-sorted order - and writes every answered block into the same new `config/production.jsonc`, alongside the core entries, in one write. A plugin that declines (or carries no `init(io)` contributor) contributes nothing. A repo with no plugins installed is unaffected: the wizard writes exactly the file it always has. Discovery runs unconditionally when `init` is invoked, matching every other discovery-running path (`blogwright --help`, a bare invocation, `blogwright plugin list`); on a genuinely first run, with no repo root or package.json yet, discovery's failure is warned and treated as "no plugins installed" so the plain wizard still completes.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright-pds` now declares `"blogwright": { "plugin": "pds" }` in its own `package.json`, so the copy the CLI already bundles is discovered as the `pds` plugin with no install step: a repo that depends only on `blogwright` gets it. `blogwright plugin list` reports it - namespace `pds`, package `blogwright-pds`, the version that repo pins, and the `pds` config key it owns.

  `blogwright --help` therefore lists the six pds actions in its `Plugins:` section, built from the plugin's own description and per-command summaries, and the static `pds …` block has been removed from the command list above so nothing is listed twice. The rendered guidance is shorter: the one-line summaries drop the "commit + release `public/oauth/*` before `pds login`" note, the description of the paste-back OAuth callback flow, the reminder that `pds sync` also runs after every successful production deploy, the note that `pds login`'s session is refreshed automatically on every sync, and `pds init`'s reminder to commit the files it writes. All five remain in the docs, and the commands themselves are unchanged.

  The six `pds` actions themselves are unaffected - `keygen`, `login`, `init`, `sync`, `secret status` and `secret delete` behave exactly as before - and `blogwright/rkey` still re-exports `blogwright-pds/rkey` unchanged. What changed beneath them is described in the accompanying entry: `blogwright pds <action>` is no longer answered by a built-in branch in `cli.ts`, but by this plugin's own declared commands. Because that branch was removed in this same release, the transient gap this change would otherwise have opened never reaches a user: help lists the generic `bootstrap`, `status` and `destroy` verbs under `pds` because the plugin contributes resource nodes, and all three of those verbs now run.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright pds <action>` is now answered by the bundled plugin's own declared commands rather than a hardcoded branch in the CLI: `cli.ts` contains no reference to pds at all, and the namespace falls through to the same generic dispatcher every other installed plugin uses. All six actions behave as before - `keygen`, `login`, `init`, `sync`, and the two-word `secret status` and `secret delete`, which are now matched by declaration instead of by shifting positionals. `--identifier` and `--yes` still reach `pds login` and `pds secret delete`, and the environment positional still resolves: `blogwright pds sync staging` and `blogwright pds secret status staging` target `staging`, not `production`.

  Two user-visible changes come with it. `blogwright pds bootstrap`, `pds status` and `pds destroy` now work: because the plugin contributes resource nodes, `blogwright --help` has advertised those three generic lifecycle verbs since the plugin became discoverable, while the old branch refused them with `unknown pds action: …`. That gap is closed. And an unknown action - `blogwright pds` with no action, or `blogwright pds bogus` - still exits 1 with the same `unknown pds action: …` message, but now prints the plugin's own action listing (all six, plus the three lifecycle verbs) instead of the CLI's full usage text. No help text is lost beyond what the previous release already named when the static `pds …` block moved out of the command list.

  The post-deploy PDS sync is unchanged and still runs from `blogwright deploy`: the CLI reaches `syncAfterDeploy` through a direct import, because the plugin SPI has no post-deploy lifecycle hook and `blogwright-pds` ships with the CLI as a non-optional dependency.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - **Upgrading a deployed stack: run `blogwright pds bootstrap <env>` once per environment. It is required, not optional - see item 1 below.**

  `blogwright-pds` is now a plugin. It declares the `blogwright.plugin` manifest field in its own `package.json`, default-exports a `Plugin` claiming the `pds` namespace and its six actions, owns and validates the `pds` config key, contributes the one resource node its feature needs (its own named inline policy on the GitHub-OIDC deploy role), and answers `blogwright pds <action>` through the CLI's generic plugin dispatch instead of a hardcoded `runPds` branch. It is a plugin by architecture, not by distribution: it remains a non-optional dependency of `blogwright`, so `blogwright pds sync` keeps working with no install step, `blogwright/rkey` still re-exports `blogwright-pds/rkey`, and the package keeps its name.

  **Nothing on disk changes.** `config/<env>.jsonc` needs no migration. The `pds` block's shape, its keys and its defaults are all identical, `secretName` still defaults to `<siteName>/atproto`, and a block that is valid today stays valid. What moved is _where the default is resolved and where the block is validated_: out of `blogwright-core`'s `parseConfig`/`validateConfig` and into `blogwright-pds` (`resolvePdsSecretName`, `validatePdsConfig`), which the CLI's plugin dispatch calls with the block off the raw config document. The only consequence of that move for an operator is a change in _when_ a malformed block is rejected - item 5 below.

  ## Semver

  - **`blogwright-core` - minor.** Its config module no longer knows what a `pds` block contains: `parseConfig` stops defaulting `pds.secretName` and `validateConfig` stops checking `name`, `handleResolver` and `secretName`. `PdsConfig.secretName` is therefore now optional (`string | undefined`) on a published type, so code that read it off `OpsConfig['pds']` and relied on core having filled it in must resolve the default itself - `blogwright-pds` exports `resolvePdsSecretName` for exactly that. `Names` gains `githubRole` (`<env>-<siteName>-gh`), byte-identical to the name the CLI derived privately before, so no deployed role is renamed. Pre-1.0, minor is this repo's breaking channel.
  - **`blogwright-pds` - minor.** New surface: the manifest field, the default `Plugin` export, `validatePdsConfig`/`resolvePdsSecretName`, and the plugin's own resource node. `PdsContext` is re-expressed as a narrowing of core's `PluginContext`, and the CLI's `OpsContext` still satisfies it by plain assignment. Every existing named export keeps its name and signature; the six commands behave as before.
  - **`blogwright` - minor.** `pds` dispatch is now generic: `cli.ts` contains no reference to pds at all. The six actions are unchanged, three lifecycle verbs are new, and the `pds` help section is rebuilt from the plugin's own declarations.

  ## Upgrading a deployed stack

  Five things change for an operator, and this list is complete.

  1. **`blogwright pds bootstrap` must be run once per stack**, and it is the only step that is not optional. Contributing a resource node is what lets the plugin own its Secrets Manager grant, and the grant materialises on the real role only when that verb runs. The site's own statement covers the gap until a later release removes it - that removal is **not** in this release, and this is the release its instruction travels in. After that release, the next `blogwright bootstrap` rewrites the `<env>-deploy` inline policy document wholesale, without the pds statement. A stack that never ran `pds bootstrap` loses the grant at that point, and the post-deploy sync starts warning - non-fatally, so a deploy still succeeds, and the next `blogwright pds bootstrap` heals it. From the release that removes the site's statement, the instruction will also print in the terminal: every `blogwright bootstrap` run while `state/<env>.pds.json` exists will warn that the plugin's resources may be stale and name `blogwright pds bootstrap` - so a stack that ran the verb once is reminded at the exact command that rewrites the role, and only a stack that never ran it still depends on these notes. That warning is also not in this release. Run it now, once per environment, after upgrading: `blogwright pds bootstrap production`, and again for any other environment with a `pds` block. It needs the site's own deploy role to exist already, and refuses with a message naming `blogwright bootstrap --env <env>` if the role is not yet in that environment's state. It contributes nothing, and fails nothing, on a stack with no `pds` block, on one with no `githubRepo` (which has no deploy role at all), and on the shared preview stack, which never carried the grant.
  2. **`blogwright pds bootstrap|status|destroy` exist**, where before there were no pds lifecycle verbs. They come from the plugin SPI, not from this package: a plugin that contributes nodes gets the host's generic lifecycle verbs over its own node set and its own scoped state object. `blogwright --help` had advertised all three since the plugin became discoverable, while the old hardcoded branch still refused them with `unknown pds action: bootstrap`; that gap is closed in this same release, so no user ever meets it.
  3. **`blogwright destroy` refuses while `state/<env>.pds.json` exists**, naming the runnable command that clears it. This starts once `pds bootstrap` has been run and is the plugin SPI's scoped-state rule, which exists so that emptying the site's bucket cannot orphan a plugin's resources. `blogwright preview teardown` refuses on the same rule. The refusal names the environment as well as the verb - `blogwright pds destroy production --yes` - because a plugin command with no environment positional silently targets `production`.
  4. **The `pds` help section is shorter**, one line per action, rendered from the plugin's own description and per-command summaries rather than from a static block in the CLI. All six actions are still listed, with the three lifecycle verbs beneath them.
  5. **A malformed `pds` block no longer fails the built-in commands.** Core's `validateConfig` used to reject it during config parsing, so a blank `name` or an `http://` handle resolver failed every command. The block is now validated at dispatch, only for the plugin being dispatched, so `bootstrap`, `deploy` and `status` accept a config core would have rejected - `blogwright pds <action>` still rejects it, with core's original messages. `deploy`'s post-deploy sync checks the block's presence, not its validity, and its failure path was already a non-fatal warning. The block still fails loudly at the first command that actually uses it; what an operator loses is the early rejection on commands that never touch the PDS. Both directions are held by tests.

  ## Beyond those five

  Everything else this migration changes that an operator or a downstream consumer can observe, stated rather than left implied:

  - **Validation failure messages gain a prefix.** Each check's own message string is byte-identical, but the plugin dispatch wraps whatever `validatePdsConfig` throws, so `config.pds.handleResolver must be a URL, got "nope"` now reads `plugin "pds" rejected the "pds" config block: config.pds.handleResolver must be a URL, got "nope"`. The original error is kept as the wrapper's `cause`. Anything matching on the exact text - a log filter, a test - has to allow for the prefix.
  - **A repo with no `pds` block gets the same sentence it always did.** `blogwright pds <action>` against a config that has never written the block reports `plugin "pds" rejected the "pds" config block: config has no "pds" section - add it to config/production.jsonc`, from one string shared with `requirePdsConfig`. Those commands already refused without the block and each still refuses before doing any work or making an AWS call. `"pds": null` counts as absent, which is what it has always meant.
  - **An unknown `pds` action prints the plugin's own action listing.** `blogwright pds` with no action, or `blogwright pds bogus`, still exits 1 with the same `unknown pds action: …` message, but now lists that plugin's nine actions instead of the CLI's full usage text.
  - **Five notes left `--help` and live only in the docs**: commit and release `public/oauth/*` before `pds login`; the paste-back OAuth callback flow; that `pds sync` also runs after every successful production deploy; that `pds login`'s session is refreshed automatically on every sync; and `pds init`'s reminder to commit the files it writes. The commands themselves are unchanged, and all five remain in the guides.
  - **The post-deploy PDS sync is untouched.** `blogwright deploy` still runs it, reaching `syncAfterDeploy` through a direct import rather than an SPI hook, because the SPI has no post-deploy lifecycle hook and `blogwright-pds` ships with the CLI.

  `blogwright pds keygen`, `login`, `init`, `sync`, `secret status` and `secret delete` are otherwise unaffected - same arguments, same flags, same behaviour - and the environment positional still resolves the same way every built-in command resolves it.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Add `blogwright plugin add <name>` and `blogwright plugin remove <name>`, which install and uninstall plugin packages in the consuming repo. Both take the same short name: `analytics` resolves to the package `blogwright-analytics`, while a name containing a `/` (a scoped package) or already starting with `blogwright-` is used as a literal package name. Anything that is not a package name once resolved - a filesystem path like `./thing`, or a name carrying its own version like `analytics@9.9.9` - is refused rather than passed to the package manager. Neither command shells out itself: both go through the `PackageManager` port, whose adapter detects pnpm, npm, yarn or bun from the lockfile the repo carries.

  `plugin add` installs at the running CLI's own version and pins it exactly, so the CLI and its plugins cannot drift apart between two checkouts of the same repo and `blogwright plugin list`'s version column keeps meaning "the version this repo pins". Installing a plugin the manifest already declares reports that and exits 0 without running the package manager at all.

  `plugin remove` asks before it forecloses its own remedy: the generic `blogwright <plugin> destroy` verb exists only while the package is installed, so the command loads the one plugin it is about to remove and, when that plugin contributes resources, asks whether they should be torn down first - No by default, and the environment resolved the usual way (a trailing positional, overridden by `--env`). Yes runs that plugin's generic destroy and only then uninstalls; No uninstalls and prints that configuration and provisioned resources are untouched, naming the teardown verb that is no longer available. A session that cannot be asked - a non-interactive terminal, or `--plain` - refuses with a message naming both ways forward rather than picking a default, since one answer strands AWS resources and the other destroys them; `--yes` is the scripted "uninstall, keep the resources" answer. A plugin that contributes no resources, or whose module fails to load, is uninstalled directly. Removing a plugin the repo does not declare reports that and exits non-zero, in contrast to `add`'s already-installed path, because it is the shape of a mistyped name.

  Both dispatch before any `OpsContext` is built, like `blogwright plugin list`, so they work on a repo with no `config/<env>.jsonc` and no AWS credentials - which is exactly when a plugin gets installed. `blogwright --help` now lists both, and a bare `blogwright plugin` lists all three actions.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Validate a plugin's own config block through that plugin, on dispatch. `loadConfig` now returns the raw config document beside the parsed `OpsConfig`, `createContext` keeps it on the CLI's own context as `configDocument`, and `blogwright <plugin> <action>` reads the block the dispatched plugin's `configKey` names off it and hands it to that plugin's own `validateConfig`. Whatever the validator returns is what the plugin's command reads on `ctx.pluginConfig`, so a plugin's defaults are applied by the plugin rather than guessed at by the CLI. A block that fails validation stops the command with the plugin's own message, prefixed with the plugin and the key it refused, before the command does any work or the dispatch makes an AWS call; the CLI exits non-zero.

  The validator is also called when the config file carries no block for that plugin at all, with nothing - so a plugin that defaults every setting works on a repo that has never written its block, which is the documented way to install one. Only a plugin that owns no config key at all gets an empty block, because there is no validator to ask.

  Only the plugin being dispatched is validated. A block belonging to a plugin that is not installed - or to one that is installed but is not the one being run - stays valid and inert, and still survives onto the config object, the same contract the `pds` block has today. Built-in commands (`deploy`, `bootstrap`, `status`, and the rest) still load no plugin module.

  Two installed plugins declaring the same `configKey` are now both rejected at discovery, naming both packages and the shared key, the same way two plugins claiming one namespace already are: a plugin owns exactly one top-level config key end to end, and whichever of the pair won would silently be handed the other's block. `blogwright plugin list` reports the rejection.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Add the generic `blogwright <plugin> init` action: on a repo with an existing config, it runs an installed plugin's `init(io)` contributor - prompting through the same terminal port and prompt/validate/retry loop `blogwright init` itself uses - renders the answered block, and splices it into the environment's resolved config file (`config/<env>.jsonc`, `ops.config.jsonc`, or `--config`) without disturbing any other byte, comments included. A plugin that declares its own `init` command (like `blogwright-pds`, which creates the publication record) keeps it; declaring both an `init` command and an `init(io)` contributor is rejected at discovery, naming the plugin, because the contributor would never run. A plugin with neither reports the action unavailable and lists what it does have; a config already carrying the plugin's key is refused with the file left untouched; a contributor that gathers no answers writes nothing.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Add the generic `blogwright <plugin> bootstrap|status|destroy` lifecycle verbs: for a plugin declaring `nodes(ctx)`, they run the same engine the site itself uses (`applyGraph`, `destroyGraph`, and the status read loop) over the plugin's own resource graph, recorded in its own scoped state object (`state/<env>.<plugin>.json`) rather than the site's. `bootstrap` and `destroy` are always the generic verbs - a plugin declaring either as one of its own commands is rejected at discovery, naming the plugin and the action, because a plugin cannot run the CLI's own engine itself; a plugin may still declare its own `status` command, which wins over the generic one. `destroy` refuses without `--yes`, the same contract the site's own `destroy` uses; a plugin declaring neither `nodes` nor a matching command reports the action unavailable, listing what it does have.

  All three of `blogwright <plugin> bootstrap|status|destroy` are listed wherever a plugin's actions are, for a plugin that contributes `nodes`: in `blogwright --help`'s plugin section and in the refusal an unknown action prints. A plugin that contributes no `nodes` answers none of the three and now advertises none of them either.

  `blogwright destroy` and `blogwright preview teardown` now refuse while any installed (or since-uninstalled) plugin's scoped state object still exists in the bucket, naming each one and the command that clears it: `blogwright <plugin> destroy <env> --yes`, with the environment being torn down filled in, so the printed command is runnable exactly as shown. The environment matters - a plugin's own `destroy` falls back to `production` when given none, which on a `preview teardown` refusal would be the wrong stack every time. Tearing down the site or the preview stack first would otherwise empty that bucket, including every plugin's own state record, orphaning whatever resources it tracked. The check is one extra listing under the bucket's `state/` prefix and adds no other overhead when no plugin has ever been bootstrapped. An environment whose bucket is already gone (an interrupted teardown) counts as having no scoped state, so re-running the teardown gets as far as it can: the roles, log groups, CloudFront function and log-delivery trio are all removed, and the run then still ends in an error when the bucket node reaches the bucket that is no longer there.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Add `blogwright plugin list`: one row per installed plugin - the namespace it claims, the package it came from, that package's own version, and the single top-level config key it owns - plus one line per plugin that failed to load, under a `failed to load:` heading, carrying discovery's own reason and no stack trace. Rows are sorted by namespace rather than by the order the `dependencies`/`devDependencies` maps happen to list them, so the listing is stable across manifests. On a TTY the columns are aligned under a bold header; with `--plain` (or any non-TTY) the same columns are single-space separated, the stable form for CI logs and agents.

  Each version is read from that plugin's own `package.json` on this machine - never a table in the CLI and never a registry lookup, so the listing works offline and reports what is actually installed. A plugin whose manifest declares no `version` is marked `(unknown)` and one that owns no config key `(none)`; neither cell is ever left blank, since a blank would shift every column after it for whatever is parsing the line. A repo with no plugins installed prints a single empty-state line naming `blogwright plugin add <name>`, rather than an empty table.

  The command exits 0 whenever the listing was produced, including when a plugin in it failed to load: this is a report, not a health check - the same contract `blogwright --help` already has. It also builds no `OpsContext`, so it answers on a repo that has no `config/<env>.jsonc` yet and with no AWS credentials configured, which is exactly when an operator needs it.

  `blogwright --help` now lists `plugin list` among its commands. A bare `blogwright plugin`, or an unrecognised `plugin` action, now prints that namespace's own actions and exits 1, in place of the full help text it previously echoed.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - The CLI gains a plugin system, and `README.md` now documents it. An installed plugin claims its own namespace: `blogwright <plugin> <action>` runs one of its commands, `blogwright <plugin> bootstrap|status|destroy` reconciles that plugin's own resource graph into that plugin's own state object, and `blogwright plugin add|list|remove` installs, lists and uninstalls plugin packages through the package manager the repo's lockfile names. `blogwright --help` grows a Plugins section built from what is actually installed. The surface is overwhelmingly additive, but not entirely. Two built-in commands change: `blogwright destroy` and `blogwright preview teardown` now refuse while a plugin's own scoped state object still exists, naming the command that clears it, and `blogwright init` now also asks each installed plugin's questions. And two changes reach a repo with no plugins installed at all: `blogwright --help` lists `plugin add`, `plugin list` and `plugin remove` among its commands everywhere - only the per-plugin sections beneath them wait for something to be installed - and an unrecognised first word now reports that no built-in command or installed plugin claims it and points at `blogwright plugin list`, where it previously printed `unknown command` above the full help.

  The plugin interface itself is internal and unversioned. It ships undocumented, it can change in any release without a major version, and it is not a public contract: no third party should write a plugin against it yet. It becomes a documented, versioned API only once it has carried two features through a release cycle. `blogwright plugin add` pins an installed plugin to the running CLI's own version, and that pin is the entire compatibility mechanism today.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Guard the shared CloudFront delivery source against cascading deletes.

  AWS permits one delivery source per distribution, so the analytics plugin's delivery necessarily hangs off the site's. `LogsClient.deliveriesForSource` now returns each delivery's `deliveryDestinationArn` alongside its id, and on that the site's log-delivery node tells its own delivery from anyone else's: `delete()` and the `ConflictException` self-heal both refuse, before deleting anything, when the source carries a delivery this site did not create, and the retry now removes only the site's own delivery instead of every delivery on the source.

  `blogwright destroy` can now fail where it previously threw a Conflict part-way through teardown, after the distribution was already gone. That is the point: it fails early, with nothing removed, and names the environment-scoped remedy (`blogwright analytics destroy <env> --yes`). `blogwright bootstrap`'s self-heal previously deleted the site's own delivery and then failed on the shared source, leaving a stack with no CloudWatch delivery; it now refuses up front instead.

### Patch Changes

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright-core`'s config module no longer knows what a `pds` block contains. `parseConfig` stops defaulting `pds.secretName` to `<siteName>/atproto` and stops validating the block's `name`, `handleResolver` and `secretName` - those checks and that default now live only in `blogwright-pds` (`validatePdsConfig` / `resolvePdsSecretName`), which the CLI's plugin dispatch calls with the block off the raw config document. A `pds` block round-trips through `parseConfig` exactly as written, `secretName` absence included.

  Two consequences worth stating plainly. `PdsConfig.secretName` is now optional (`string | undefined`) on a published type, so code that read it off `OpsConfig['pds']` and relied on core having filled it in must resolve the default itself - `blogwright-pds` exports `resolvePdsSecretName` for exactly that. And core no longer rejects a malformed `pds` block at parse time: a bad `handleResolver` or a `secretName` with illegal characters is now reported by the plugin when it runs, not by `parseConfig`, so a config that used to fail early on `blogwright <anything>` now fails when a `pds` command reaches it. Each check's own message string is byte-identical, but the operator no longer sees it on its own: the plugin dispatch wraps whatever `validatePdsConfig` throws, so a malformed block that used to be reported as `config.pds.handleResolver must be a URL, got "nope"` now reads `plugin "pds" rejected the "pds" config block: config.pds.handleResolver must be a URL, got "nope"` - and likewise for `config.pds.name is required` and `config.pds.secretName has invalid characters: "..."`. The original error is kept as the wrapper's `cause`. Anything matching on the exact text, a log filter or a test, has to allow for that prefix. Deploy-role behaviour, by contrast, is unchanged: the site's Secrets Manager statement applies the `<siteName>/atproto` default inline, so the ARN it writes is byte-identical to before for a block with or without an explicit `secretName`.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Tell an absent `pds` config block apart from a malformed one, and say so. Running `blogwright pds <action>` on a repo that has never written the block reported `plugin "pds" rejected the "pds" config block: Cannot read properties of undefined (reading 'name')` - a regression introduced earlier in this same release, when `pds` became a plugin and its dispatch began validating the block. It now reports `plugin "pds" rejected the "pds" config block: config has no "pds" section - add it to config/production.jsonc`, which is the sentence those commands raised before `pds` became a plugin, and it is one string shared with `requirePdsConfig` rather than two copies that can drift. The outcome is unchanged: every one of those commands already refused without the block, and each still refuses before doing any work or making an AWS call. A block that IS written and is wrong keeps naming the offending key - `config.pds.name is required`, `config.pds.handleResolver must be https, got "http://resolver"`, `config.pds.secretName has invalid characters: "..."` - because a first-run operator being told to fix a key inside a block they never wrote is not actionable. `"pds": null` counts as absent, which is what it has always meant: core's own check was gated behind a truthiness test and skipped it.

  With that settled, the user-visible divergence this migration carries is now pinned from both ends. **A malformed `pds` block no longer fails the built-in commands.** Core's `validateConfig` used to reject it during config parsing, so a blank `name` or an `http://` handle resolver failed every command. The block is now validated at dispatch, only for the plugin being dispatched, so `bootstrap`, `deploy` and `status` accept a config core would have rejected - `blogwright pds <action>` still rejects it, with core's original messages. `deploy`'s post-deploy sync checks the block's presence, not its validity, and its failure path was already a non-fatal warning. The block still fails loudly at the first command that actually uses it; what an operator loses is the early rejection on commands that never touch the PDS.

  No config file that is valid today becomes invalid, and none that is invalid today is silently accepted. Both directions are held by tests: a valid block dispatches through to the command on the same path; a blank `name` and an `http://` resolver are each accepted by `loadConfig` and by `bootstrap`/`deploy`/`status` (which load no plugin module at all, proved by a zero `ModuleLoader` call count) and each rejected on `blogwright pds <action>` with the message quoted above.

- [#21](https://github.com/antstanley/blogwright/pull/21) [`2c6d96b`](https://github.com/antstanley/blogwright/commit/2c6d96bca906227ed5652774159ce4066326d79b) Thanks [@antstanley](https://github.com/antstanley)! - Fix `bootstrap`, `deploy` and `analytics bootstrap` throwing `date not in range 1980-2099` outside UTC

  Every zip this CLI builds stamped its entries with `new Date('1980-01-01T00:00:00Z')`. A zip's DOS timestamp is **local** time, so west of Greenwich that value is 1979 and `fflate` refuses it outright. `blogwright bootstrap`, `blogwright deploy` and `blogwright analytics bootstrap` therefore failed for operators across most of the Americas, on the first command a new user runs.

  The crash was also hiding a second defect: in zones where it did not throw, the encoded timestamp still varied, so identical input produced different archive bytes — the exact opposite of the reproducibility the fixed timestamp exists to provide.

  `blogwright-core` now exports `REPRODUCIBLE_ZIP_MTIME`, a locally-constructed 1980-01-02 that is in range and byte-identical in every zone, and the three sites that hand-rolled the old value use it: `packages/cli/src/repo.ts`, `packages/cli/src/agent-package.ts` and the analytics transform bundle.

  Nothing about the archives changes for anyone already on UTC except the stamped date.

  The coverage was never missing — seven analytics tests already drove the failing path. CI ran `TZ=UTC`, the one setting where the bug is invisible, so the test job now runs in a negative-offset zone instead.

- Updated dependencies [[`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`2c6d96b`](https://github.com/antstanley/blogwright/commit/2c6d96bca906227ed5652774159ce4066326d79b), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a)]:
  - blogwright-core@0.4.0-beta.0
  - blogwright-pds@0.4.0-beta.0

## 0.3.3

### Patch Changes

- [#13](https://github.com/antstanley/blogwright/pull/13) [`b760320`](https://github.com/antstanley/blogwright/commit/b760320bef4a0ba479f847027ef66d1528d21d48) Thanks [@antstanley](https://github.com/antstanley)! - Ship smaller packages. The published tarballs no longer carry `.js.map` sourcemaps (`sourceMap` was set repo-wide in `tsconfig.base.json` and every emitted map was landing in `dist`), and `test-support.ts` - scaffolding imported only by `*.test.ts` - is now excluded from the build configs of `blogwright` and `blogwright-pds` rather than compiled into `dist`. It is still fully typechecked, since the `tsconfig.typecheck.json` files override `exclude` to `[]`.

  Unpacked sizes drop by a quarter overall: `blogwright` 540.4 kB → 437.9 kB, `blogwright-core` 205.1 kB → 127.8 kB, `blogwright-pds` 99.9 kB → 58.9 kB, and the three packages together go from 183 files to 121. No runtime code changed.

- Updated dependencies [[`b760320`](https://github.com/antstanley/blogwright/commit/b760320bef4a0ba479f847027ef66d1528d21d48)]:
  - blogwright-core@0.3.3
  - blogwright-pds@0.3.3

## 0.3.2

### Patch Changes

- [#11](https://github.com/antstanley/blogwright/pull/11) [`804edda`](https://github.com/antstanley/blogwright/commit/804eddace8698417a0ac99083daa8fe0e428c722) Thanks [@antstanley](https://github.com/antstanley)! - Make `bootstrap` resumable after a partial failure. The graph engine now persists whatever outputs a node recorded even when its create/update throws (best-effort - a save error never masks the node's own failure), and nodes record identity outputs before secondary mutations (bucket name before tagging, log-delivery ARNs as they are created). Re-running against a partial environment recovers automatically: the distribution node adopts an orphaned distribution on `CNAMEAlreadyExists`/`DistributionAlreadyExists` by matching the deterministic comment and verifying `CallerReference` (via a new `listDistributions` method on the CloudFront client), and the bucket node reconciles tagging and the public-access block on every apply. No more hand-editing `state/<env>.json` in S3.

- [#9](https://github.com/antstanley/blogwright/pull/9) [`df587d5`](https://github.com/antstanley/blogwright/commit/df587d5f07d455d3d7446615a65b3e580e24ae13) Thanks [@antstanley](https://github.com/antstanley)! - Two bootstrap fixes: wait for ACM to publish the DNS validation records before creating/printing them (a fresh certificate's first describe can return an empty set, which skipped validation entirely and stalled bootstrap until timeout), and scope the builder-image clientToken by image name so two environments bootstrapping concurrently in one account no longer collide on the shared agent hash.

- Updated dependencies [[`804edda`](https://github.com/antstanley/blogwright/commit/804eddace8698417a0ac99083daa8fe0e428c722), [`df587d5`](https://github.com/antstanley/blogwright/commit/df587d5f07d455d3d7446615a65b3e580e24ae13), [`df587d5`](https://github.com/antstanley/blogwright/commit/df587d5f07d455d3d7446615a65b3e580e24ae13)]:
  - blogwright-core@0.3.2
  - blogwright-pds@0.3.2

## 0.3.1

### Patch Changes

- [`d8a4b49`](https://github.com/antstanley/blogwright/commit/d8a4b49df73b6191e4c46c0d06bbf39642a25aa4) Thanks [@antstanley](https://github.com/antstanley)! - Fix a 0.3.0 regression that broke every CI deploy: object tagging needs
  `s3:PutObjectTagging`, which the build and exec role policies never granted.
  The tags ride on the PUT itself (`x-amz-tagging`), but AWS checks
  `PutObjectTagging` as a distinct action, so every tagged upload 403'd under the
  constrained MicroVM role - while local deploys with an operator's own
  credentials sailed through, which is how it escaped. Both roles now grant it;
  re-run `blogwright bootstrap <env>` to apply the policy.

  Tagging also fails soft now: a role that cannot tag uploads the files untagged,
  warns once with the remedy, and the deploy succeeds. Tags are metadata, not
  content - a permission gap should never fail a deploy whose files are fine. This
  also means an in-place upgrade deploys successfully _before_ the re-bootstrap
  that grants the action. ([#7](https://github.com/antstanley/blogwright/issues/7))

- Updated dependencies [[`d8a4b49`](https://github.com/antstanley/blogwright/commit/d8a4b49df73b6191e4c46c0d06bbf39642a25aa4)]:
  - blogwright-core@0.3.1
  - blogwright-pds@0.3.1

## 0.3.0

### Minor Changes

- [`10dacc3`](https://github.com/antstanley/blogwright/commit/10dacc3d5a0a79c02b77f48c8cedcd49399690df) Thanks [@antstanley](https://github.com/antstanley)! - Serve `.webmanifest` as `application/manifest+json`, and add the other content
  types a modern static site ships: `jsonld`, `ttf`, `otf`, `mp4`, `webm`, `m3u8`,
  `mp3`, `vtt`, `pdf`, `csv`. (`.ts` is deliberately left unmapped - in build
  output it is far more likely stray TypeScript than an HLS segment.) Unmapped
  extensions still fall back to `application/octet-stream`, but the build log now
  warns which ones did, so a wrong header cannot stay silent. ([#6](https://github.com/antstanley/blogwright/issues/6))

  New `deploy --refresh` re-uploads every built file even when its content is
  unchanged. A deploy normally skips content-identical files, but S3 writes object
  metadata (content type, tags) only on a PUT - so a fix like the one above, or
  the object tags added in this release, would never reach objects already live.
  Run `blogwright deploy --refresh` once after upgrading to push the corrected
  metadata (it also invalidates the CDN, which caches the old headers).

- [`5249df4`](https://github.com/antstanley/blogwright/commit/5249df4413e9080cfafba04d66e3070d5f44915d) Thanks [@antstanley](https://github.com/antstanley)! - Tag every created AWS resource with `environment` and `app`. The bucket, IAM
  roles (reconciled on re-bootstrap too), ACM certificate, log groups, CloudFront
  distribution, log-delivery source, and the pds Secrets Manager secret all carry
  both tags; synced site files get them as S3 object tags, with preview deploys
  stamping the PR into the value (`environment: preview-pr-42`). The `app` value
  comes from the new `app` config option, falling back to the domain, then the
  repo directory name. CloudFront Functions, OACs, and Route53 records do not
  support tags.

### Patch Changes

- Updated dependencies [[`10dacc3`](https://github.com/antstanley/blogwright/commit/10dacc3d5a0a79c02b77f48c8cedcd49399690df), [`5249df4`](https://github.com/antstanley/blogwright/commit/5249df4413e9080cfafba04d66e3070d5f44915d)]:
  - blogwright-core@0.3.0
  - blogwright-pds@0.3.0

## 0.2.1

### Patch Changes

- [`6635054`](https://github.com/antstanley/blogwright/commit/6635054d39a7c61979dc5efb08982eec57383d17) Thanks [@antstanley](https://github.com/antstanley)! - Retry MicroVM launch on gateway errors after a builder-image update. The
  lambda-microvms control plane can answer 502 for a short window right after
  the builder image changes (fresh agent hash), which failed every consumer's
  first deploy after a blogwright upgrade. The launch call now retries 502/503/504
  with bounded backoff (~90s window); it is idempotent via the launch client
  token, so a retry can never start a second builder.

- [`1601303`](https://github.com/antstanley/blogwright/commit/16013031529679ca01a1281f1bae3d1625f0ce04) Thanks [@antstanley](https://github.com/antstanley)! - Fix two bootstrap failures reported from non-us-east-1 stacks:

  - CloudFront access-log delivery (and its log group) now lives in us-east-1,
    where the CloudFront LogType is supported - bootstrap in eu-west-1 previously
    failed its final node with `PutDeliverySource … ValidationException` and left
    the stack without access logs. ([#3](https://github.com/antstanley/blogwright/issues/3))
  - `preview bootstrap` now actually creates the wildcard DNS record: A and AAAA
    **alias** records pointing at the distribution (Z2FDTNDATAQYW2), replacing
    the printed manual instruction. A pre-existing CNAME - from an older
    bootstrap or a manual workaround - is cleared first, since Route53 refuses
    aliases alongside it; re-running bootstrap migrates existing stacks. ([#4](https://github.com/antstanley/blogwright/issues/4))

- Updated dependencies [[`6635054`](https://github.com/antstanley/blogwright/commit/6635054d39a7c61979dc5efb08982eec57383d17), [`1601303`](https://github.com/antstanley/blogwright/commit/16013031529679ca01a1281f1bae3d1625f0ce04)]:
  - blogwright-core@0.2.1
  - blogwright-pds@0.2.1

## 0.2.0

### Minor Changes

- [`aefd6c8`](https://github.com/antstanley/blogwright/commit/aefd6c8f1edd612f0fdc99eab70e0edc7c65cfab) Thanks [@antstanley](https://github.com/antstanley)! - First changesets-managed release, recapping the 0.1.x line and shipping a real
  package README.

  New in this release:

  - A full getting-started README on the `blogwright` npm package (the npmjs page
    previously showed a three-line stub): requirements, the
    `init` → `bootstrap` → `deploy` path, a command reference, configuration
    with the non-Astro knobs, a copy-paste OIDC CI workflow, and output modes.

  Recap of what 0.1.0 shipped, for the changelog record:

  - **Deploy any static site**: `paths.app`/`paths.dist` for monorepo apps,
    `spa: true` for client-side-routing fallback, and `sourceInclude` for
    pre-built gitignored artifacts (wasm bundles built in CI) - alongside the
    original Astro-shaped defaults.
  - **A CLI that helps**: `blogwright init` first-run wizard, live MicroVM build
    progress, a deploy summary card, `status` as a drift tree, `history` with a
    `← live` marker - pretty on a TTY, stable plain text for CI and agents
    (`--plain`, `NO_COLOR`).
  - **Hexagonal internals**: every side effect behind a port (filesystem,
    terminal, VCS, network), enforced by lint; the standard.site integration
    extracted into `blogwright-pds` with the `blogwright/rkey` contract intact.
  - **A full-project review's worth of hardening**: devDependencies install
    correctly in MicroVM builds, domains added after bootstrap attach to the
    existing distribution, OIDC trust policies reconcile on `githubRepo` change,
    concurrent deploys can no longer destroy the standard.site OAuth session,
    wrong-region S3 responses fail loudly, and JSONC configs accept trailing
    commas.

### Patch Changes

- Updated dependencies [[`aefd6c8`](https://github.com/antstanley/blogwright/commit/aefd6c8f1edd612f0fdc99eab70e0edc7c65cfab)]:
  - blogwright-core@0.2.0
  - blogwright-pds@0.2.0
