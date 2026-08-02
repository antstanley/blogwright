# Change: An internal plugin system for the CLI

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** packages/core (plugin SPI, state scoping, the transport seam and `signingUsEast1` on `AwsClients`) + packages/cli (discovery, dispatch, `plugin` commands)

The CLI gains a plugin system: a small service-provider interface in
`blogwright-core`, discovery of installed plugins by a manifest field in their
`package.json`, and generic dispatch so that an installed plugin named `x`
answers `blogwright x <action>`. A plugin contributes commands, resource-graph
nodes, one config key, and an `init` contributor; it owns its own state key and
lifecycle verbs. The SPI is internal - undocumented and unversioned - until it
has carried two features through a release cycle.

---

## Motivation

`blogwright-pds` is already a plugin in everything but name. Its
[`PdsContext`](../../packages/pds/src/context.ts) is a narrowed structural
interface that the CLI's `OpsContext` satisfies by plain assignment, with no
import from the CLI in either direction - the exact shape a plugin boundary
wants. What is missing is the generic half: `runPds`
([`cli.ts:187`](../../packages/cli/src/cli.ts)) hardcodes the dispatch, the
`pds` config block is validated inside core's `validateConfig`
([`config.ts:314`](../../packages/core/src/config.ts)), and nothing lets a
feature ship outside the CLI's dependency tree.

The immediate driver is the analytics feature, which must not ship with the CLI
by default. But building a bespoke install/dispatch/config path for one feature
would leave the next feature to build its own again. Four decisions that would
otherwise be analytics-specific - how a module is installed, where its config
type lives, how its config block is written into an existing JSONC file, and
whether its resources join the main graph - become one mechanism solved once.
The JSONC-insertion problem in particular is worth solving in exactly one place.

---

## Affected spec pages

No canonical spec pages exist yet; the nearest documentation is
[DEVELOPMENT.md](../../DEVELOPMENT.md) §Hexagonal architecture, whose
"Features live in their own packages" rule this change formalises. If a
canonical CLI or architecture page exists by merge time, the blocks below fold
into it.

| Canonical page | Nature of change |
|---|---|
| *(none - no canonical page for CLI dispatch or the graph engine yet)* | New plugin SPI in `blogwright-core`; `ResourceNode` vocabulary relocates to core; the transport seam accepts a plugin-supplied service descriptor and `AwsClients` gains `signingUsEast1`; new discovery, dispatch, and `plugin` commands in the CLI; `StateStore` gains an optional scope |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Hexagonal architecture | New `ModuleLoader` and `PackageManager` ports join the ports table |

Companion change specs:
[`2026-07-26-migrate_pds_to_plugin_system.md`](2026-07-26-migrate_pds_to_plugin_system.md)
(the second consumer that validates this SPI) and
[`2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) (the first
plugin that ships outside the CLI). Both depend on this change.

---

## Proposed changes

### Plugin SPI → The `Plugin` contract (Add)

> A plugin is a package that exports a `Plugin<TConfig = never>` object as its
> default export, generic over the shape of the config block it owns. The
> contract lives in `blogwright-core` so that plugins depend on core and never
> on the CLI:
>
> - `name` - the CLI namespace the plugin claims (`analytics` answers
>   `blogwright analytics <action>`). Lowercase alphanumerics and dashes.
> - `description` - one line, shown in `blogwright --help`.
> - `commands` - the actions the namespace accepts. Each carries an `action`
>   name, a `summary` for help output, and `run(ctx, args)`.
> - `nodes?(ctx)` - resource-graph nodes the plugin contributes, if any.
> - `configKey?` - the single config key the plugin owns.
> - `validateConfig?(raw: unknown): TConfig` - validates that key's block and
>   **returns it**, applying the plugin's own defaults, raising in the repo's own
>   error vocabulary when it does not hold.
> - `init?(io)` - the init contributor, returning the config block to write.
>
> A plugin declares nothing else. There are no lifecycle hooks, no
> plugin-to-plugin dependencies, no contributed ports or adapters, and no
> merged config schemas beyond the one owned key.
>
> The default type argument is `never`, not `unknown`, so a plugin that owns no
> `configKey` writes `Plugin` with no argument. Inside such a plugin
> `ctx.pluginConfig` is `never`, so every property read off it -
> `ctx.pluginConfig.anything` - is
> `TS2339: Property 'anything' does not exist on type 'never'`. That is the
> check worth having: under `unknown` the same plugin would have to narrow a
> value it has no schema for. The unsoundness `never` leaves is the whole-field
> assignment `const n: number = ctx.pluginConfig`, which compiles because
> `never` is assignable to everything; it is recorded here rather than designed
> around, because no plugin reads its config that way and the property-level
> check is what a mistake actually looks like.
>
> The host's registry is `Plugin<unknown>[]`; a `Plugin<PdsConfig>` and a
> `Plugin<AnalyticsConfig>` both join it because `commands[].run` and `nodes`
> are method-declared and therefore bivariant. The host dispatches through that
> registry, so the context it constructs is a `PluginContext<unknown>`. It is
> never a `PluginContext<never>`: nothing inhabits `never`, so that type has no
> constructible value at all, and reaching one would need the `as` cast
> DEVELOPMENT.md §Code style bans. For a plugin that owns no `configKey` the
> host puts an empty object in `pluginConfig` rather than `undefined`, per the
> no-null rule - and that plugin cannot read it either way.

### Plugin SPI → `PluginContext` (Add)

> `PluginContext<TConfig>` is the narrow slice of the host CLI's context a plugin
> command receives. It names exactly `env`, `domain`, `preview`, `config`,
> `pluginConfig`, `names`, `accountId`, `clients`, `ports`, `tags`, `logger`,
> `store`, `state`, `siteState`, `record(nodeId, outputs)` and `save()` (which
> `applyGraph` calls after every node) - and nothing else.
>
> Every member is required except `tags`, which is declared
> `tags?: Record<string, string> | undefined` - the shape `PdsContext` already
> has ([`context.ts:33`](../../packages/pds/src/context.ts)) and the reason
> [`createTestContext`](../../packages/pds/src/test-support.ts) can build a
> complete feature context without one. A required `tags` would propagate
> through the pds migration's `Pick` and break every existing pds test.
>
> The enumeration is exhaustive on purpose, because both consumers are written
> against the type before they exercise it. Analytics reads
> `ctx.names.deliverySource` to hang its delivery off the source the site owns;
> both plugins build IAM resource ARNs from `accountId` - pds reproduces
> `arn:aws:secretsmanager:<region>:<accountId>:secret:<name>-*`, and analytics
> scopes its Firehose and transform roles the same way. A field left out here
> surfaces as a compile error many tasks downstream.
>
> `ports` is a core-declared `PluginPorts` of `fs` and `terminal` - the two
> ports core owns. Everything else on the CLI's `Ports`
> ([`ports.ts:24`](../../packages/cli/src/ports.ts)) stays CLI-side: `vcs` and
> `ping` are declared in the CLI and DEVELOPMENT.md §Hexagonal architecture
> names them as the ports only the CLI uses, and the `loader` and `packages`
> ports this change adds join them - a `PluginContext` declared in core cannot
> name any of those types. `agentDir`
> ([`context.ts:40`](../../packages/cli/src/context.ts)), which locates the
> build-agent artifacts the CLI ships, stays CLI-side for the same reason, as
> does the raw config document the composition root keeps on `OpsContext` for
> dispatch (see §Typed plugin config). No plugin imports a CLI type;
> `PdsContext` is the existing precedent and becomes a narrowing of this
> interface.

### Plugin SPI → Typed plugin config (Add)

> `validateConfig` returns the validated, defaulted block and the CLI puts it on
> `PluginContext<TConfig>` as `pluginConfig`. A plugin reads its own settings
> from that field, never from `ctx.config`.
>
> The type system forces this. `OpsConfig`
> ([`config.ts:68`](../../packages/core/src/config.ts)) has no index signature,
> so `ctx.config.analytics` does not compile - under the repo's `strict` settings
> it is `TS2339: Property 'analytics' does not exist on type 'OpsConfig'`. `pds`
> only works today because `PdsConfig` is declared on `OpsConfig` at
> `config.ts:116`, and this spec forbids a per-plugin declaration. The
> alternatives are a cast or `any`, both banned by DEVELOPMENT.md.
>
> Returning the block also gives a plugin's defaults somewhere to live. Once core
> stops applying `pds.secretName`'s default, every reader of that field would
> otherwise widen to `string | undefined`; with `pluginConfig` the plugin applies
> its default once, at validation, and every call site keeps a total type.
>
> The host needs a typed way to reach the raw block, and today it has none.
> `parseConfig` ([`config.ts:242`](../../packages/core/src/config.ts)) discards
> the parsed document and returns `OpsConfig`, and `loadConfig`
> ([`context.ts:85`](../../packages/cli/src/context.ts)) returns the same. A
> plugin's key survives the `...raw` spread at `config.ts:255` at runtime, but
> nothing typed can index it: `config[plugin.configKey]` is
> `TS7053: No index signature with a parameter of type 'string' was found on
> type 'OpsConfig'`. Core therefore also exports
> `parseConfigDocument(text): { config: OpsConfig; raw: Readonly<Record<string, unknown>> }`,
> with `parseConfig` keeping its signature as the `config` half of it, and
> `loadConfig` returns both. The raw half needs somewhere to live between the
> composition root and dispatch, because `createContext` is what reads the file
> and `runPlugin` is what needs the block: `createContext` therefore keeps it on
> the CLI's own `OpsContext` as `configDocument`, so a plugin's block is reached
> without a second read of the file and no plugin ever sees the document. The
> CLI hands `configDocument[plugin.configKey]` - an `unknown` - straight to
> `validateConfig`. That one read is the sanctioned cast
> site under DEVELOPMENT.md §Error handling ("acceptable only when the very next
> step validates the result"), because the next step is the plugin's own
> validator.

### Plugin SPI → The two state surfaces (Add)

> A plugin sees state through two deliberately distinct fields, because it needs
> to read the site's resources while writing only its own:
>
> - `siteState` - a **read-only** view of the site's recorded outputs
>   (`state/<env>.json`). A plugin reads it to find resources the site owns; the
>   analytics log-delivery node reads the distribution ARN through it. The type
>   is readonly, so a plugin cannot write the site's state at all.
> - `state`, `store` and `save()` - the plugin's **own** `OpsState`
>   (`{ version, env, updatedAt, resources }`) loaded from the scoped
>   `StateStore` (`state/<env>.<plugin>.json`) it persists through, and the
>   persist call that closes over both. This is the only state a plugin may
>   write.
>
> `save()` belongs in that second bullet, not among the members that pass
> through from the host. The CLI's own is
> `async () => { await store.save(state); }`
> ([`context.ts:153-155`](../../packages/cli/src/context.ts)) - it closes over
> the *site's* store and the *site's* state object - and it is the only way the
> engine ever persists anything (`applyGraph` calls `ctx.save()` after every
> node, [`graph.ts:84`](../../packages/cli/src/graph.ts)). A boundary that
> passed the host's `save()` through would record every plugin node's outputs
> into the plugin's in-memory `state.resources` and then write
> `state/<env>.json`, leaving `state/<env>.<plugin>.json` empty; the plugin's
> next `destroy` would load nothing, read `false` from every node, and orphan
> every resource - the exact failure the scoped store exists to prevent. It is
> the trap in this block because it is the one member that typechecks either
> way.
>
> `state` is the site's own state *type*, not a bare outputs map, because the
> engine reaches through it: `destroyGraph` does
> `delete ctx.state.resources[node.id]`
> ([`graph.ts:94`](../../packages/cli/src/graph.ts)). A plugin state typed as
> the outputs map itself makes `state.resources` `undefined` and the engine
> refuses to compile against it. `siteState` is the same shape with `resources`
> readonly.
>
> The CLI builds this context when it dispatches; unlike `PdsContext`, an
> `OpsContext` does not satisfy it by plain assignment, because the two state
> surfaces come from two different stores. The adaptation is one function at the
> dispatch boundary and is covered by a test asserting both fields are populated
> from different keys.

### Plugin SPI → A plugin owns its own topography (Add)

> Every resource a plugin needs is declared by that plugin's own `nodes(ctx)`
> and reconciled against that plugin's own scoped state. Neither
> `blogwright-core` nor the CLI's site graph carries resource topography for any
> plugin: no config key of a plugin's is read by a site node, and no service
> exists in core solely because a plugin needs it.
>
> Where a plugin needs to attach something to a resource the *site* owns, it
> does so through a separately-named sub-resource it can create and delete
> without touching the site's own. The worked case is IAM: a plugin attaches a
> **named inline policy** to the site's deploy role, named for the plugin's
> **package** rather than its namespace
> (`putRolePolicy(role, '<package name>', …)` - `blogwright-pds` for the pds
> plugin), so the site's node manages only its own policy document and the
> plugin's grant is added and removed with the plugin. The package name is the
> durable half of the pair: an inline-policy name is on-the-wire state that
> `delete()` finds again through `listRolePolicies`/`deleteRolePolicy`
> ([`iam.ts:93,108`](../../packages/core/src/aws/iam.ts)), a namespace is
> declared in a manifest and can be re-declared, and changing the name later
> orphans the old policy on the role.

### Plugin SPI → Plugin-supplied AWS services (Add)

> A plugin may talk to AWS services core does not know. `SendOptions.service`
> accepts a **service descriptor** - the service name, its SigV4 signing name,
> and whether it is global - as well as the keys core's own clients use. A
> plugin constructs its clients over a `SigningClient` from its context and
> passes its own descriptors; core's `SIGNING_NAMES` stays closed around the
> services core itself uses.
>
> `AwsClients` gains `signingUsEast1` alongside `signing`. A `SigningClient`'s
> region is fixed at construction ([`signer.ts:83,89`](../../packages/core/src/aws/signer.ts)),
> and the us-east-1 signer `createClients` already builds is a local `const`
> ([`clients.ts:54`](../../packages/core/src/clients.ts)) reachable only through
> the pre-built `acm`/`cloudfront`/`route53`/`logsUsEast1` clients. A plugin can
> of course `new SigningClient({ region: 'us-east-1', … })` - the class and
> `createCredentialProvider` are both public exports of core - but not one that
> shares the host's: `credentials` and `transport` are `private readonly`
> ([`signer.ts:85-86`](../../packages/core/src/aws/signer.ts)), so a hand-built
> signer re-resolves credentials, drops the CLI's `--endpoint` override, and
> takes the real `fetchTransport` no matter what a test injected. Exposing the
> one the host already built is what keeps a plugin inside the transport-level
> substitution DEVELOPMENT.md §Testing rests on - and the analytics pipeline
> needs us-east-1 for every one of its services.
>
> Without this seam a plugin cannot reach a new service at all: `ServiceKey` is
> `keyof typeof SIGNING_NAMES` ([`endpoint.ts:33`](../../packages/core/src/aws/endpoint.ts))
> and `SendOptions.service` is typed to it, so every new service would mean an
> edit to core and a published-surface change. `canonicalHost`'s default branch
> already resolves `<service>.<region>.amazonaws.com` correctly, so *host*
> resolution is unchanged.
>
> Four sites key off `service`, and one resolution helper - the one that turns
> either form into `{ name, signingName, global }` - feeds all four.
> `GLOBAL_SERVICES` ([`endpoint.ts:36`](../../packages/core/src/aws/endpoint.ts))
> is a `Set<ServiceKey>` and stays the source of truth for core's own keys; a
> descriptor carries its own `global` flag instead of joining the set. In the
> signer, `SIGNING_NAMES[opts.service]`
> ([`signer.ts:124`](../../packages/core/src/aws/signer.ts)) takes the resolved
> **signing name**; `uriEscapePath: opts.service !== 's3'`
> ([`signer.ts:135`](../../packages/core/src/aws/signer.ts)) compares the
> resolved **service name** rather than the raw union - otherwise a descriptor
> silently takes the non-S3 escaping branch by virtue of not being a string; and
> `parseError(opts.service, response)`
> ([`signer.ts:163`](../../packages/core/src/aws/signer.ts)) takes the resolved
> service name too. That fourth one is easy to miss and worse to get wrong:
> `parseError`'s parameter is already `string` (`signer.ts:171`) so widening
> `opts.service` breaks the call, and widening the parameter to the union
> instead would put the descriptor object into `new AwsError({ service, … })`
> (`signer.ts:193`) - every AWS error a plugin's service raised would read
> `[object Object]` where the service name belongs, which is precisely the error
> context DEVELOPMENT.md §Error handling requires.
>
> `canonicalHost`'s parameter widens to `string` for the same reason, since
> `resolveEndpoint` hands it the resolved name; its branches and its outputs are
> unchanged.

### Plugin SPI → Recording node outputs (Add)

> A plugin's resource nodes record their outputs through
> `record(nodeId, outputs)` on `PluginContext`, which writes into the plugin's
> scoped state. This mirrors what the CLI's own nodes do through the private
> `output(ctx, id)` helper ([`nodes.ts:20`](../../packages/cli/src/nodes.ts)),
> and it is the mechanism `applyGraph` persists after every node and
> `destroyGraph` clears on teardown. A plugin node must not call
> `store.save()` directly: the engine saves the in-memory state after every
> node, and a direct write would be clobbered by the next save.

### Resource graph → Vocabulary relocation (Modify)

> The `ResourceNode` interface moves from `packages/cli/src/graph.ts` to
> `blogwright-core`, because plugins contribute nodes and cannot depend on the
> CLI. The *engine* - `topoSort`, `applyGraph`, `destroyGraph` - stays in the
> CLI. Core owns the vocabulary of a reconcilable resource; the CLI owns
> reconciliation.
>
> It moves as `ResourceNode<Ctx>`, generic over the context its methods receive,
> with the engine taking a structural constraint covering what it actually uses -
> `logger`, `save()`, and `state.resources`. A non-generic core node typed on
> `PluginContext` would break every site node, because a site node reads what
> stays CLI-side: `agentDir`
> ([`context.ts:40`](../../packages/cli/src/context.ts)), through
> `packageAndUploadAgent` ([`nodes.ts:11`](../../packages/cli/src/nodes.ts)),
> and the CLI's own `Ports` rather than the two-member `PluginPorts`. The
> CLI keeps `type ResourceNode = CoreResourceNode<OpsContext>` so `nodes.ts`
> genuinely changes only its import.

### State → Scoped state stores (Modify)

> `StateStore` takes an optional scope. An unscoped store keys
> `state/<env>.json` as today; a store scoped to a plugin keys
> `state/<env>.<plugin>.json`. A plugin's resources are recorded separately from
> the site's, so `blogwright <plugin> destroy` never discards the site's record
> of what exists.
>
> The other direction does not follow from the key alone, and the CLI closes it
> explicitly. A scope changes the object key, not the bucket - the store is
> constructed over `names.bucket` either way
> ([`context.ts:134`](../../packages/cli/src/context.ts)) - and the site's own
> bucket node empties every prefix before deleting the bucket
> (`deletePrefix(ctx.names.bucket, '')`,
> [`nodes.ts:66`](../../packages/cli/src/nodes.ts), which lists and deletes
> every object under the empty prefix,
> [`s3.ts:212`](../../packages/core/src/aws/s3.ts)). That node has no
> dependencies, so it is destroyed last, and a site teardown would otherwise
> delete `state/<env>.<plugin>.json` while every resource it records lives on:
> the plugin's next `destroy` loads empty state, every node's `read()` returns
> false, and nothing is removed. `blogwright destroy` therefore **refuses while
> any `state/<env>.<plugin>.json` exists**, naming that plugin's
> `blogwright <plugin> destroy --yes`. Tearing plugins down first is what makes
> the two records genuinely independent.

### CLI → Plugin discovery (Add)

> The candidate set is the union of two sources, each resolved from a different
> directory:
>
> - **The consumer's own dependencies.** Every `dependencies` and
>   `devDependencies` entry in `<repoRoot>/package.json` whose name starts with
>   `blogwright-`, resolved with `fromDir = <repoRoot>`.
> - **The CLI's own dependencies.** The CLI locates its own package root from
>   `import.meta.url` and walks up to the nearest `package.json` - the precedent
>   is `agentDir` ([`context.ts:118`](../../packages/cli/src/context.ts)), which
>   resolves the bundled build-agent the same way - reads the `blogwright-*`
>   entries out of it, and resolves each with
>   `fromDir = <blogwright package dir>`.
>
> Both sources are required, and each must be resolved from its own directory.
> A consuming repo depends on `blogwright`, which does not match the
> `blogwright-` prefix, so scanning the consumer alone finds nothing - this
> repo's own `package.json` has zero `blogwright-*` entries. Any plugin that
> ships inside the CLI (`blogwright-pds` today) would be invisible, and
> `blogwright pds sync` would stop working the moment the hardcoded branch is
> deleted. Resolving from the consumer root does not reach it either: under pnpm
> the consumer's `node_modules` holds only `blogwright`, so `blogwright-pds` is
> not resolvable from there at all. Self-location must not go through the
> resolver, because resolving the bare specifier `blogwright` throws too - see
> the Decision below.
>
> Resolution of a *plugin* goes through that package's **entry point**, not
> through `<name>/package.json`. A package that declares an `exports` map
> without a `"./package.json"` entry makes `require.resolve` of that subpath
> throw `ERR_PACKAGE_PATH_NOT_EXPORTED` under Node's exports encapsulation -
> which `blogwright-pds/package.json` does today. The loader therefore resolves
> the bare specifier and walks up from the resolved file to the nearest
> `package.json`, so discovery works against packages whose `exports` map the
> plugin author never adjusted. Discovery is covered by at least one test using
> the real loader against a package on disk, not only the map-backed fake -
> encapsulation failures are invisible to a fake.
>
> The manifest field is:
>
> ```json
> { "blogwright": { "plugin": "analytics" } }
> ```
>
> A package without the field is not a plugin and is skipped silently. A
> package with the field is loaded and its default export validated against the
> `Plugin` contract at the boundary; a module that does not satisfy it raises an
> error naming the package.
>
> Discovery runs for generic plugin dispatch, for `blogwright plugin list`, for
> `blogwright init`, and for `blogwright --help` and a bare invocation; every
> other built-in command pays nothing for it, so `deploy`, `bootstrap` and
> `status` load no plugin module at all. `plugin list` needs it because it names
> plugins that failed to load, which only a load attempt can discover. `init`
> needs it because the wizard asks each discovered plugin's questions and writes
> their blocks into the one file it produces - a built-in that cannot skip
> discovery and still do its job. Help needs it because help
> output must reflect what is actually installed - `--help` and a bare
> invocation reach the USAGE branch
> ([`cli.ts:101-106`](../../packages/cli/src/cli.ts)) with no positional or with
> a built-in one, so a rule keyed on the first positional alone would never let
> `--help` list a plugin at all. This becomes load-bearing at the pds migration,
> which deletes the static `pds` USAGE block and produces the same content from
> the plugin's `description`.

### CLI → Namespace collisions (Add)

> Built-in commands always win. The reserved set is every name the CLI
> dispatches itself - `init`, `bootstrap`, `deploy`, `rollback`, `delete`,
> `destroy`, `history`, `logs`, `status`, `preview`, and `plugin`. A discovered
> plugin claiming a reserved name is rejected with an error naming the package
> and the collision, rather than being silently shadowed. Two plugins claiming
> the same name is likewise an error, not a race.

### CLI → `blogwright plugin` (Add)

> A new built-in namespace manages plugins:
>
> - `blogwright plugin list` - installed plugins, their namespaces, versions,
>   and the config key each owns. Also names plugins that failed to load, with
>   the reason.
> - `blogwright plugin add <name>` - installs a plugin into the consuming repo.
>   The short name `analytics` resolves to the package `blogwright-analytics`;
>   a name containing a `/` or already starting with `blogwright-` is treated
>   as a literal package name. The version installed matches the running CLI's
>   own version, so the two never drift. Installing an already-installed plugin
>   reports that and exits 0.
> - `blogwright plugin remove <name>` - uninstalls the package, asking first
>   whether the plugin's teardown should run. Removal forecloses its own
>   remedy - the generic `blogwright <name> destroy --yes` resolves only while
>   the package is installed - so the command loads the one plugin it is about
>   to remove (a single resolve-and-load through the `ModuleLoader` port, not
>   discovery, so §Plugin discovery's laziness rule is untouched) and, when
>   that plugin contributes nodes, asks through `Terminal.question` with No as
>   the default. Yes runs the plugin's generic `destroy` for the environment
>   the invocation resolves - the usual positional/`--env` rule; scoped state
>   in other environments is untouched, and `blogwright destroy`'s refusal
>   keeps protecting it - and then uninstalls. No uninstalls and prints that
>   configuration and provisioned resources are untouched, naming the teardown
>   verb. In a non-interactive or `--plain` session the question cannot be
>   asked and the command refuses with an actionable message - run
>   `blogwright <name> destroy --yes` first, or re-run with `--yes` to remove
>   while keeping the resources - and `--yes` skips the question the same way
>   in an interactive one. A plugin that contributes no nodes has no teardown
>   to ask about and is removed directly, as is one whose module fails to
>   load - a broken plugin cannot run its teardown either way, and the
>   untouched-notice still prints.

### CLI → Plugin dispatch (Add)

> `blogwright <plugin> <action> [env] [args]` routes to the matching plugin
> command. An unknown plugin name reports that no built-in command or installed
> plugin claims it and suggests `blogwright plugin list`. An unknown action
> within a known plugin lists that plugin's actions. `blogwright --help` appends
> one section per discovered plugin, built from its `description` and its
> commands' `summary` fields, so help output reflects what is actually
> installed.
>
> Actions may be multi-word (`secret status`), so dispatch matches the longest
> declared action first. The environment keeps the positional behaviour every
> built-in command has: the first unconsumed positional after the matched action
> is the environment, and `--env` overrides it. This is the rule `runPds`
> implements by hand today ([`cli.ts:196`](../../packages/cli/src/cli.ts)), and
> preserving it is what makes `blogwright pds sync staging` keep working after
> the migration. Dispatch tests cover an action with and without a trailing
> environment, for both single- and multi-word actions.

### CLI → Config ownership (Add)

> A plugin owns exactly one top-level config key, named by `configKey`. Core's
> `parseConfig`/`mergeConfig` keep unknown keys intact and no longer validate
> plugin-owned blocks; the CLI reads the plugin's block out of the raw document
> `parseConfigDocument` returns and calls that plugin's `validateConfig` on it.
> A config file carrying a block for a plugin that is not installed is valid and
> inert - the same contract `pds` has today, and the reason the raw document is
> the read path rather than `OpsConfig`: an uninstalled plugin's key has no
> declaration on the config type and never gains one.

### CLI → `blogwright <plugin> init` (Add)

> Every plugin with an `init` contributor gains a generic `init` action that
> writes its config block into the environment's config file. Two paths reach
> the same contributor:
>
> - `blogwright init` on a repo with no config asks each discovered plugin's
>   questions and writes one file containing every answered block.
> - `blogwright <plugin> init` on a repo with an existing config asks that one
>   plugin's questions and inserts its block into the existing file.
>
> The insertion is textual, not a parse-and-restringify: the rendered block is
> spliced in before the config object's closing brace, preserving every comment
> and every hand-made formatting choice in the file. The command refuses rather
> than guesses when the file already contains the plugin's key, or when its
> shape is not a single top-level object.
>
> A plugin's own declared commands take precedence over the generic action, so a
> plugin that already has an `init` of its own keeps it - `blogwright pds init`
> creates the publication record today ([`commands.ts:118`](../../packages/pds/src/commands.ts))
> and must keep doing so. The rule the SPI enforces is stated as the rejection,
> because that is the only half of it a boundary check can decide: **a plugin
> may not declare both an `init` command and an `init?(io)` contributor.**
> Declaring both is rejected at discovery, because the generic action would
> never run and the contributor would ask its questions nowhere. Everything else
> follows from precedence rather than from a rule: a plugin that declares an
> `init` command owns whatever `blogwright <plugin> init` does - writing a
> config block if it wants one written, and nothing of the sort if, like pds, it
> has other work - and the generic action applies only where no `init` command
> is declared.

### CLI → Plugin lifecycle (Add)

> A plugin that contributes nodes owns its own lifecycle verbs rather than
> joining the site graph. `blogwright <plugin> bootstrap`, `status`, and
> `destroy` run the same engine - `applyGraph`, `destroyGraph`, and the
> status read loop - over the plugin's node set against the plugin's scoped
> state store. `blogwright bootstrap` and `blogwright destroy` do not reconcile
> or delete plugin nodes, so a site teardown never takes a plugin's own
> resources with it - and `blogwright destroy` refuses outright while a plugin's
> scoped state object exists, because emptying the site's bucket would take that
> record with it (see §State → Scoped state stores).
>
> **A plugin's declared commands take precedence over every generic action**,
> which settles which of the four verbs a plugin may declare:
>
> - `bootstrap` and `destroy` are always generic. A plugin may not import the
>   CLI and therefore cannot run `applyGraph`/`destroyGraph` itself, so a
>   declared command of either name could only shadow the verb with something
>   that does less. Declaring one is rejected at discovery with an error naming
>   the plugin and the colliding action.
> - `status` is generic unless the plugin declares its own, because `read()`
>   lives on the plugin's own nodes and a plugin may have more to report than
>   node presence.
> - `init` is generic unless the plugin declares its own, under the rule
>   §`blogwright <plugin> init` states: a plugin that declares an `init` command
>   owns whatever that action does, and a plugin that declares an `init` command
>   *and* an `init?(io)` contributor is rejected.
>
> Precedence is stated once, here, and applies to every generic action the CLI
> contributes.
>
> The guarantee is about ownership, not isolation. Where a plugin attaches to a
> resource the site owns, the site's node must not assume it is the only
> attachment: it deletes only what it created, and refuses rather than cascading
> when it finds others. The worked case is CloudFront log delivery - AWS permits
> exactly one delivery source per distribution, so the site and the analytics
> plugin necessarily share one; see the analytics change spec for the two guards
> this requires on `logDeliveryNode`.

### Ports → `ModuleLoader` (Add)

> Resolving and importing a plugin package is a side effect and crosses a port.
> `ModuleLoader` exposes `resolve(specifier, fromDir)` returning the resolved
> module path or nothing, `packageJsonPathFor(specifier, fromDir)` returning the
> nearest `package.json` above that resolution, and `load(path)` returning the
> imported module. `fromDir` is per call, not fixed at construction: discovery
> resolves the consumer's plugins from the repo root and the CLI's bundled
> plugins from the CLI's own package directory. The real adapter anchors
> `createRequire` on the `fromDir` it is given and loads through a dynamic
> `import()`; tests substitute a map of fake modules. No domain module imports
> `node:module`.

### Ports → `PackageManager` (Add)

> Installing and removing packages crosses a port. `PackageManager` exposes
> `detect(repoRoot)` returning which manager the repo uses, `add(spec, opts)`,
> and `remove(name)`. The real adapter detects the manager from the lockfile
> at the repo root and shells out, mirroring
> [`createProcessVcs`](../../packages/cli/src/adapters/process-vcs.ts); tests
> substitute a recording fake. No domain module imports `node:child_process`.

---

## Type changes

The plugin manifest is the only new on-disk shape. It is a field in a plugin
package's own `package.json`, not in blogwright's config.

```json
{
  "$comment": "Fragment for 2026-07-26-cli_plugin_system. Describes the `blogwright` field a plugin package declares in its package.json.",
  "$defs": {
    "PluginManifest": {
      "type": "object",
      "required": ["plugin"],
      "additionalProperties": false,
      "properties": {
        "plugin": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$",
          "description": "The CLI namespace this package claims. `analytics` answers `blogwright analytics <action>`."
        }
      }
    }
  }
}
```

No change to `OpsConfig`'s shape, and no change to any config key on disk. Core
stops validating plugin-owned keys and gains one export - `parseConfigDocument`,
returning the parsed `OpsConfig` alongside the raw document as a
`Readonly<Record<string, unknown>>` - so the CLI can reach a plugin's block
without indexing a type that has no index signature.

---

## Implementation notes

```
1. packages/core - new src/plugin.ts: Plugin, PluginCommand, PluginContext,
   PluginManifest, and validatePlugin(module, packageName) for the boundary
   check. Export from src/index.ts (:1-27).
2. packages/core - move ResourceNode out of packages/cli/src/graph.ts:4 into
   src/plugin.ts (or src/resource.ts); re-export from index. graph.ts keeps
   topoSort/applyGraph/destroyGraph and imports the type from core.
   nodes.ts (1,087 lines) changes only its import.
3. packages/core/src/state.ts:26 - StateStore gains an optional 4th ctor arg
   `scope`; stateKey(:17) becomes `state/${env}.json` or
   `state/${env}.${scope}.json`.
4. packages/core/src/config.ts - remove the pds-specific branches from
   mergeConfig (:266-271) and validateConfig (:314-330); keep the `pds` key
   on OpsConfig. Unknown keys already survive the `...raw` spread at :255.
   Add parseConfigDocument returning { config, raw }; parseConfig (:242-245)
   becomes its `config` half. loadConfig (cli/src/context.ts:85) returns both,
   and createContext (:110) keeps the raw half on OpsContext as
   `configDocument` - the CLI-side field dispatch reads a plugin's block from.
   (The pds side of this lands in the companion migration change spec.)
5. packages/core/src/aws - the transport seam: endpoint.ts:33,36
   (ServiceKey and the GLOBAL_SERVICES Set<ServiceKey>) and signer.ts:124,135,163
   (SIGNING_NAMES[opts.service], `uriEscapePath: opts.service !== 's3'` and
   parseError(opts.service, response)) all read the resolved service through one
   helper rather than the raw union. canonicalHost's parameter (:63) widens to
   `string`; its branches and outputs are unchanged. In the same step
   packages/core/src/clients.ts:21,42 exposes `signingUsEast1` alongside
   `signing`: the us-east-1 SigningClient is a local const at :54, and a
   SigningClient's region is fixed at construction (signer.ts:83,89), so without
   it a plugin cannot build a us-east-1 client that shares the host's credential
   provider, endpoint override and injected transport - `credentials` and
   `transport` are private (signer.ts:85-86). (The analytics plugin is its
   first consumer and lists both in its own notes.)
6. packages/cli/src/ports.ts:24 - add `loader: ModuleLoader` and
   `packages: PackageManager` to Ports; define both interfaces there.
   New adapters: adapters/node-module-loader.ts (createRequire + import),
   adapters/process-package-manager.ts (lockfile detect + spawn), modelled on
   adapters/process-vcs.ts. Wire both in context.ts:111-116.
7. packages/cli - new src/plugins.ts: discover(repoRoot, ports) reading
   <repoRoot>/package.json via ports.fs, filtering `blogwright-*` deps,
   resolving each via ports.loader from repoRoot; and the CLI's own
   package.json, located from import.meta.url as context.ts:118 locates
   agentDir, whose `blogwright-*` deps resolve from the CLI package dir.
   Reserved-name and duplicate-name checks here.
8. packages/cli - new src/plugin-commands.ts for `plugin add|list|remove`,
   and src/config-block.ts for the textual JSONC block splice used by
   `<plugin> init`. init.ts:42 renderConfig is the style to match; the
   existing-file guard at init.ts:87 stays for `blogwright init`.
9. packages/cli/src/cli.ts - extend KNOWN_COMMANDS (:66) with `plugin`;
   after the built-in switch, fall through to plugin dispatch instead of the
   unknown-command error at :117. USAGE (:11) gains a Plugins section built at
   runtime from discovered plugins, which is why the help branch (:101-106)
   runs discovery.
10. Tests: discovery (manifest present/absent/malformed, reserved name,
    duplicate name), dispatch (unknown plugin, unknown action), the JSONC
    splice (comments preserved, existing key refused, non-object refused),
    scoped state keys, and both new ports substituted with fakes.
```

Order matters: steps 1–5 (the SPI, the core moves and the transport seam) land
first and are behaviour-neutral; steps 6–10 add the CLI surface. The pds
migration follows, then analytics.

---

## Merge plan

1. Apply the `Proposed changes` blocks to whichever canonical page first
   documents CLI dispatch, the graph engine, and the state store; if none
   exists, record the SPI as a new canonical page and index it.
2. Add `ModuleLoader` and `PackageManager` to the ports table in
   [DEVELOPMENT.md](../../DEVELOPMENT.md) §Hexagonal architecture.
3. Fold the `PluginManifest` `$def` into the canonical schema when one exists.
4. Flip this file's **Status:** to `Merged`, add **Merged:** date, move to
   `.specs/changes/merged/`.
5. Update `.specs/README.md` (remove from pending change specs).

---

## Assumptions and open questions

**Assumptions**

- The consuming repo has a `package.json` at the root `findRepoRoot`
  ([`repo-root.ts`](../../packages/core/src/repo-root.ts)) resolves. Discovery
  reads it through the `FileSystem` port and reports a clear error when absent.
- A package present in the consumer's dependency tree is trusted. Installing a
  package already runs its install scripts; requiring a second opt-in step in
  config would add ceremony without adding a security boundary.
- `PdsContext`'s structural-satisfaction trick generalises to the *narrow*
  slice a feature package needs - the fields the host already carries. It has
  worked since the 2026-07-11 package extraction and is verified at compile
  time. It does not extend to the full `PluginContext`: `pluginConfig`,
  `siteState` and `record()` have no counterpart on `OpsContext` at all, so the
  assignment is `TS2739` naming exactly those three, which is why §The two state
  surfaces specifies an adaptation function rather than an assignment. Those
  three are what the *compiler* catches, not what the boundary builds: `state`,
  `store` and `save()` do have counterparts on `OpsContext` and must still be
  re-pointed at the plugin's scoped store, so the boundary builds six members
  and the type system only insists on three. An adaptation written to the
  diagnostic rather than to §The two state surfaces compiles and is wrong.

**Decisions**

- *Manifest field, not name convention.* **A plugin declares its namespace in
  `package.json`; the CLI does not infer it from the package name.** A
  convention like `blogwright-plugin-*` would force renaming the published
  `blogwright-pds` - which `blogwright/rkey` re-exports from - and would let any
  package claim a namespace by name alone. Declaration costs one extra file
  read per candidate dependency.
- *Resolve the entry point and walk up, never `<name>/package.json`.* **Node's
  exports encapsulation makes the direct subpath throw.** Verified against this
  workspace on 2026-07-26: `require.resolve('blogwright-pds/package.json')`
  raises `ERR_PACKAGE_PATH_NOT_EXPORTED`, because that package's `exports` map
  lists only `.` and `./rkey`. Requiring every plugin author to add
  `"./package.json"` to their exports map would make discovery fail for anyone
  who forgot, in a way no map-backed test fake would ever catch.
- *The CLI locates itself from `import.meta.url`, not through the resolver.*
  **Self-location is a composition-root concern, and the resolver cannot do it
  anyway.** Verified 2026-07-26: from a consuming repo's root, both
  `require.resolve('blogwright')` and `require.resolve('blogwright/package.json')`
  raise `ERR_PACKAGE_PATH_NOT_EXPORTED`, because
  [`packages/cli/package.json`](../../packages/cli/package.json) declares an
  `exports` map with a `./rkey` entry and no `.` entry - the CLI is consumed
  through its `bin`, not imported. Walking up from `import.meta.url` is the same
  move `agentDir` already makes
  ([`context.ts:118`](../../packages/cli/src/context.ts)) and is the only route
  to the CLI's own dependency list.
- *`plugin add`/`list`/`remove`, not bare `plugin <name>`.* **Explicit verbs.**
  Bare `blogwright plugin analytics` reads ambiguously between installing and
  invoking, and leaves nowhere to put `list`.
- *`plugin remove` asks about teardown; a session that cannot ask is refused,
  not defaulted.* **The question is load-bearing because removal forecloses
  its own remedy: the plugin's generic `destroy` verb exists only while the
  package is installed.** Settled 2026-07-27. Naming the verb in the output -
  the previous shape - tells the operator what they can no longer run. The
  house `confirm` helper answers with its default when no TTY is attached
  ([`logger.ts:34-40`](../../packages/cli/src/logger.ts)), which is right
  where one answer is safe; here neither is - teardown is destructive, and
  skipping it strands AWS resources behind a reinstall the output would have
  to explain - so the non-interactive path follows `init`'s refusal pattern
  ([`init.ts:78`](../../packages/cli/src/init.ts)) with a message naming both
  ways forward, and `--yes` is the scripted "remove, keep the resources"
  answer.
- *The SPI is internal.* **Undocumented and unversioned until it has carried
  two features through a release cycle.** A plugin API is a public contract
  that cannot be changed casually once third parties write against it; at 0.3.x
  that commitment is premature. Publishing it is a separate product decision.
- *Two consumers before the abstraction is trusted.* **pds migrates in the same
  effort as analytics ships.** DEVELOPMENT.md prefers a little duplication over
  the wrong abstraction; designing a plugin API against one example is how the
  wrong abstraction happens. Two differently-shaped features - one that is
  mostly secrets and repo files, one that is mostly graph nodes - will surface
  bad assumptions before anything is frozen.
- *A plugin's topography lives entirely in the plugin.* **Core and the site
  graph carry nothing plugin-specific - not a config branch, not a service
  client.** Two concrete consequences were found while planning. One is in the
  code today: the site's OIDC role policy branches on `ctx.config.pds`
  ([`nodes.ts:913`](../../packages/cli/src/nodes.ts)) and interpolates that
  plugin's secret name into an ARN at `nodes.ts:925`; it moves into the pds
  plugin. The other was in an earlier draft of this change, which put the
  analytics pipeline's four AWS clients in core; they are instead created in
  `blogwright-analytics` over the transport seam below, and core gains no
  service it does not use itself. `pnpm knip` is why the draft was wrong: core
  would have exported four clients nothing in core or the CLI consumes.
- *Plugins own their lifecycle, not the site graph.* **Separate node set,
  separate state key, separate verbs.** Folding plugin nodes into `buildNodes`
  ([`nodes.ts:1053`](../../packages/cli/src/nodes.ts)) would mean
  `blogwright destroy --yes` deletes a plugin's data along with the site.
- *A site teardown refuses while a plugin's state object exists.* **`blogwright
  destroy` stops and names the plugin's own teardown verb.** The scope changes
  the state key, not the bucket, and the site's bucket node empties every prefix
  before deleting the bucket ([`nodes.ts:66`](../../packages/cli/src/nodes.ts)) -
  so the alternative is a plugin's record deleted while its resources live on,
  which no later `<plugin> destroy` can find. Refusing costs the operator one
  extra command; warning and proceeding leaves AWS resources only the console
  can reach.
- *No lifecycle hooks in v1.* **Commands, nodes, config, init - nothing else.**
  Hooks, middleware, plugin-to-plugin dependencies, and contributed ports are
  all easy to add once a real consumer needs them and impossible to remove.
- *Textual JSONC insertion, not parse-and-rewrite.* **The block is spliced in;
  the file is never restringified.** Config files carry meaningful comments
  (see [`init.ts:42`](../../packages/cli/src/init.ts)); round-tripping through
  `JSON.parse`/`stringify` would destroy every one of them.

**Open questions**

- How does a plugin declare which SPI it was built against? Nothing enforces
  compatibility today beyond `plugin add` pinning the CLI's own version, which
  breaks down as soon as a user upgrades one and not the other. A
  `blogwright.spi` integer in the manifest is the obvious answer; it is not
  specified here because the SPI is internal and both consumers version in
  lockstep with the CLI.
- Does `preview` eventually become a plugin? It is the one remaining built-in
  namespace shaped like one, but it shares the site's resource graph and
  context in ways a plugin deliberately cannot.
