# blogwright-pds

## 0.4.0-beta.1

### Patch Changes

- Updated dependencies []:
  - blogwright-core@0.4.0-beta.1

## 0.4.0-beta.0

### Minor Changes

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `SendOptions.service` and `resolveEndpoint` now also accept a plugin-supplied service descriptor (`{ service, signingName, global? }`) alongside core's own `ServiceKey`, so a plugin can sign SigV4 requests against an AWS service core does not enumerate without an edit to core. `SIGNING_NAMES` is unchanged - core's own clients keep signing exactly as before, byte-identical requests included.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Add generic plugin dispatch: `blogwright <plugin> <action> [env] [args]` now routes to any installed plugin's command, matching multi-word actions (e.g. `secret status`) by declaration rather than positional shifting, resolving the environment the same way every built-in command does (a trailing positional, overridden by `--env`, defaulting to `production`), and forwarding flag values through to the command. An unknown first positional now reports that no built-in command or installed plugin claims it and suggests `blogwright plugin list`, instead of the previous generic "unknown command" message; an unknown action inside a known plugin lists that plugin's declared actions. Built-in commands (`deploy`, `bootstrap`, `status`, etc.) are unaffected and still load no plugin module. No plugin ships with the CLI yet beyond the existing `pds` branch, so this has no effect until a plugin is installed.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright-pds` now declares `"blogwright": { "plugin": "pds" }` in its own `package.json`, so the copy the CLI already bundles is discovered as the `pds` plugin with no install step: a repo that depends only on `blogwright` gets it. `blogwright plugin list` reports it - namespace `pds`, package `blogwright-pds`, the version that repo pins, and the `pds` config key it owns.

  `blogwright --help` therefore lists the six pds actions in its `Plugins:` section, built from the plugin's own description and per-command summaries, and the static `pds …` block has been removed from the command list above so nothing is listed twice. The rendered guidance is shorter: the one-line summaries drop the "commit + release `public/oauth/*` before `pds login`" note, the description of the paste-back OAuth callback flow, the reminder that `pds sync` also runs after every successful production deploy, the note that `pds login`'s session is refreshed automatically on every sync, and `pds init`'s reminder to commit the files it writes. All five remain in the docs, and the commands themselves are unchanged.

  The six `pds` actions themselves are unaffected - `keygen`, `login`, `init`, `sync`, `secret status` and `secret delete` behave exactly as before - and `blogwright/rkey` still re-exports `blogwright-pds/rkey` unchanged. What changed beneath them is described in the accompanying entry: `blogwright pds <action>` is no longer answered by a built-in branch in `cli.ts`, but by this plugin's own declared commands. Because that branch was removed in this same release, the transient gap this change would otherwise have opened never reaches a user: help lists the generic `bootstrap`, `status` and `destroy` verbs under `pds` because the plugin contributes resource nodes, and all three of those verbs now run.

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

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `Names` gains `githubRole` (`<env>-<siteName>-gh`), so the GitHub Actions OIDC deploy role's name is derived in `deriveNames` alongside every other AWS name instead of privately inside the CLI's own role node. The derived value is byte-identical to what the CLI derived before, so no deployed role is renamed; a test pins it.

  `blogwright-pds` gains a resource node that attaches its own `blogwright-pds`-named inline policy to that role, granting `secretsmanager:GetSecretValue`, `PutSecretValue` and `CreateSecret` scoped to the plugin's own secret ARN - byte for byte the statement the site's `<env>-deploy` policy carries on a non-preview stack today, now owned by the plugin that needs it. Because IAM inline policies are named, the two documents are independent objects on the same role: creating and deleting the plugin's grant never reads or writes the site's, and both are live at once. The site's own statement is unchanged and stays until a later release, so nothing is lost on upgrade. The node is not reachable from the CLI yet - the plugin export that returns it lands separately.

  The node is skipped, not failed, for a site with no `pds` block, for a site with no `githubRepo` (which has no deploy role at all), and for the shared preview stack. The preview skip mirrors the site's own graph, which withholds this same statement there: the preview role's OIDC trust accepts any ref of the repo where production is release-gated, and the PDS secret is one credential shared by every environment. `staging` is unaffected and still gets the grant.

### Patch Changes

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - `blogwright-core`'s config module no longer knows what a `pds` block contains. `parseConfig` stops defaulting `pds.secretName` to `<siteName>/atproto` and stops validating the block's `name`, `handleResolver` and `secretName` - those checks and that default now live only in `blogwright-pds` (`validatePdsConfig` / `resolvePdsSecretName`), which the CLI's plugin dispatch calls with the block off the raw config document. A `pds` block round-trips through `parseConfig` exactly as written, `secretName` absence included.

  Two consequences worth stating plainly. `PdsConfig.secretName` is now optional (`string | undefined`) on a published type, so code that read it off `OpsConfig['pds']` and relied on core having filled it in must resolve the default itself - `blogwright-pds` exports `resolvePdsSecretName` for exactly that. And core no longer rejects a malformed `pds` block at parse time: a bad `handleResolver` or a `secretName` with illegal characters is now reported by the plugin when it runs, not by `parseConfig`, so a config that used to fail early on `blogwright <anything>` now fails when a `pds` command reaches it. Each check's own message string is byte-identical, but the operator no longer sees it on its own: the plugin dispatch wraps whatever `validatePdsConfig` throws, so a malformed block that used to be reported as `config.pds.handleResolver must be a URL, got "nope"` now reads `plugin "pds" rejected the "pds" config block: config.pds.handleResolver must be a URL, got "nope"` - and likewise for `config.pds.name is required` and `config.pds.secretName has invalid characters: "..."`. The original error is kept as the wrapper's `cause`. Anything matching on the exact text, a log filter or a test, has to allow for that prefix. Deploy-role behaviour, by contrast, is unchanged: the site's Secrets Manager statement applies the `<siteName>/atproto` default inline, so the ARN it writes is byte-identical to before for a block with or without an explicit `secretName`.

- [#19](https://github.com/antstanley/blogwright/pull/19) [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a) Thanks [@antstanley](https://github.com/antstanley)! - Tell an absent `pds` config block apart from a malformed one, and say so. Running `blogwright pds <action>` on a repo that has never written the block reported `plugin "pds" rejected the "pds" config block: Cannot read properties of undefined (reading 'name')` - a regression introduced earlier in this same release, when `pds` became a plugin and its dispatch began validating the block. It now reports `plugin "pds" rejected the "pds" config block: config has no "pds" section - add it to config/production.jsonc`, which is the sentence those commands raised before `pds` became a plugin, and it is one string shared with `requirePdsConfig` rather than two copies that can drift. The outcome is unchanged: every one of those commands already refused without the block, and each still refuses before doing any work or making an AWS call. A block that IS written and is wrong keeps naming the offending key - `config.pds.name is required`, `config.pds.handleResolver must be https, got "http://resolver"`, `config.pds.secretName has invalid characters: "..."` - because a first-run operator being told to fix a key inside a block they never wrote is not actionable. `"pds": null` counts as absent, which is what it has always meant: core's own check was gated behind a truthiness test and skipped it.

  With that settled, the user-visible divergence this migration carries is now pinned from both ends. **A malformed `pds` block no longer fails the built-in commands.** Core's `validateConfig` used to reject it during config parsing, so a blank `name` or an `http://` handle resolver failed every command. The block is now validated at dispatch, only for the plugin being dispatched, so `bootstrap`, `deploy` and `status` accept a config core would have rejected - `blogwright pds <action>` still rejects it, with core's original messages. `deploy`'s post-deploy sync checks the block's presence, not its validity, and its failure path was already a non-fatal warning. The block still fails loudly at the first command that actually uses it; what an operator loses is the early rejection on commands that never touch the PDS.

  No config file that is valid today becomes invalid, and none that is invalid today is silently accepted. Both directions are held by tests: a valid block dispatches through to the command on the same path; a blank `name` and an `http://` resolver are each accepted by `loadConfig` and by `bootstrap`/`deploy`/`status` (which load no plugin module at all, proved by a zero `ModuleLoader` call count) and each rejected on `blogwright pds <action>` with the message quoted above.

- Updated dependencies [[`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a), [`2c6d96b`](https://github.com/antstanley/blogwright/commit/2c6d96bca906227ed5652774159ce4066326d79b), [`59eafb4`](https://github.com/antstanley/blogwright/commit/59eafb40fecd1afedf79bdcce028c255e9b3ab1a)]:
  - blogwright-core@0.4.0-beta.0

## 0.3.3

### Patch Changes

- [#13](https://github.com/antstanley/blogwright/pull/13) [`b760320`](https://github.com/antstanley/blogwright/commit/b760320bef4a0ba479f847027ef66d1528d21d48) Thanks [@antstanley](https://github.com/antstanley)! - Ship smaller packages. The published tarballs no longer carry `.js.map` sourcemaps (`sourceMap` was set repo-wide in `tsconfig.base.json` and every emitted map was landing in `dist`), and `test-support.ts` - scaffolding imported only by `*.test.ts` - is now excluded from the build configs of `blogwright` and `blogwright-pds` rather than compiled into `dist`. It is still fully typechecked, since the `tsconfig.typecheck.json` files override `exclude` to `[]`.

  Unpacked sizes drop by a quarter overall: `blogwright` 540.4 kB → 437.9 kB, `blogwright-core` 205.1 kB → 127.8 kB, `blogwright-pds` 99.9 kB → 58.9 kB, and the three packages together go from 183 files to 121. No runtime code changed.

- Updated dependencies [[`b760320`](https://github.com/antstanley/blogwright/commit/b760320bef4a0ba479f847027ef66d1528d21d48)]:
  - blogwright-core@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [[`804edda`](https://github.com/antstanley/blogwright/commit/804eddace8698417a0ac99083daa8fe0e428c722), [`df587d5`](https://github.com/antstanley/blogwright/commit/df587d5f07d455d3d7446615a65b3e580e24ae13), [`df587d5`](https://github.com/antstanley/blogwright/commit/df587d5f07d455d3d7446615a65b3e580e24ae13)]:
  - blogwright-core@0.3.2

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
