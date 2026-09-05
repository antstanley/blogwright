# Plugin architecture and host contracts

**Status:** Implemented · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [overview](00-overview.md), [domain model](01-domain-model.md) and [development guidelines](../../../DEVELOPMENT.md).

## Responsibilities and boundaries

[core/plugin.ts](../../../packages/core/src/plugin.ts) defines callable TypeScript
vocabulary; the CLI owns discovery, dispatch and reconciliation. Feature packages
declare a manifest and default export, own one optional config key, and supply
commands, nodes and/or an init contributor. There are no lifecycle hooks,
plugin-to-plugin dependencies or contributed ports/adapters in this interface.

## Plugin and command contract

`Plugin<TConfig = never>` requires `name`, `description` and `commands`.
Optional members are `nodes(ctx): ResourceNode[]`, `configKey`,
`validateConfig(raw: unknown): TConfig` and
`init(io): Promise<ConfigBlockEntry[]>`. The validator receives only the raw
block, so site/environment-derived defaults belong in a feature consumer
resolver. `PluginCommand<TConfig>` requires `action`, one-line `summary`, and
`run(ctx: PluginContext<TConfig>, args: string[]): Promise<void>`.

The default `never` prevents property reads on unconfigured plugin config. It
still permits assigning the whole field to arbitrary types because `never` is
assignable to everything; this is a recorded TypeScript limitation. Method
signatures make commands/nodes bivariant so typed plugins join the host's
`Plugin<unknown>[]` registry. The host constructs `PluginContext<unknown>`,
never a fabricated `PluginContext<never>`. `validatePlugin` checks the module's
default object, name pattern, description and command action/summary/run shapes;
it does not execute commands, validators, init or nodes. It is not a security
sandbox for imported code or property getters. See [type/boundary tests](../../../packages/core/src/plugin.test.ts).

## PluginContext

| Member | Contract |
| --- | --- |
| `env` | Required environment string |
| `domain` | Required property, value string or undefined |
| `preview` | Required boolean; generic plugin dispatch currently constructs it false, even when env is `preview` |
| `config` | Required `OpsConfig`; no index signature for arbitrary plugin keys |
| `pluginConfig` | Required `TConfig`, validator return for this dispatched plugin only |
| `names` | Required derived `Names`, including deliverySource and githubRole |
| `accountId` | Required AWS account id |
| `clients` | Required shared `AwsClients`, including primary signing and signingUsEast1 |
| `ports` | Required `PluginPorts`: filesystem and terminal only |
| `tags` | Sole optional member: `Record<string,string> | undefined` |
| `logger` | Required info/step/ok/warn/error methods taking strings |
| `store` | Required plugin-scoped StateStore |
| `state` | Required mutable plugin OpsState |
| `siteState` | Required SiteState with readonly resources and readonly output maps |
| `record(nodeId, outputs)` | Records outputs in plugin state's resources |
| `save()` | Persists that plugin state through that plugin store |

`siteState` is a type-level readonly view, not a runtime frozen object. Its
interface exposes resources only, although the supplied object is site OpsState.
The boundary builds six members: pluginConfig, siteState, record, state, store,
save. Only the first three are absent from OpsContext's type, so a compile check
alone cannot detect passing the site's save closure through by mistake.
[toPluginContext](../../../packages/cli/src/plugin-commands.ts) creates the scoped
store, loads its state, narrows ports, and closes save over both. Tests verify
separate S3 keys and persistence in [plugin commands tests](../../../packages/cli/src/plugin-commands.test.ts).

Core `parseConfigDocument(text)` returns `{config, raw}`; `parseConfig` returns
its config half. The composition root retains raw on CLI-only `configDocument`.
Dispatch reads `raw[configKey]` through `pluginBlock` and invokes only that
plugin's validator, including `undefined` for an absent key. With no key or no
callable validator it supplies `{}`. Validator errors propagate with the plugin
name/key and original message. A plugin's unrelated malformed block does not
break site commands. PDS's existing typed `OpsConfig.pds` is a deliberate
exception for the specifically preserved narrow PdsContext/direct post-deploy contract,
including its own IAM contributor sharing the consumer resolver. This exception
adds no other typed plugin keys and never permits site graph plugin-config reads;
it is detailed in [PDS](03-pds.md).

## Discovery

[discover](../../../packages/cli/src/plugins.ts) unions consumer and CLI
`dependencies`/`devDependencies` whose names start with `blogwright-`.
Consumer candidates resolve from the repo root; bundled candidates resolve from
the CLI package directory. An unresolved consumer declaration still falls back
to the bundled copy; a resolved consumer plugin or failure prevents a second
probe. Missing manifest fields are silently skipped. Malformed manifests,
resolution/import failures and invalid exports become named failure entries.
One broken candidate does not abort unrelated installed plugins.

The [Node module loader](../../../packages/cli/src/adapters/node-module-loader.ts)
resolves the entry point using `createRequire` anchored at each fromDir, then
walks upward to a package.json with a name, ignoring name-less dist stubs.
It never requires an exported package.json subpath. The sole `cliPackageDir()`
helper is in [context.ts](../../../packages/cli/src/context.ts), deriving the
host location from import.meta.url; discovery callers pass it rather than
attempting to resolve the CLI's unexported root entry.

The reserved namespaces are init, bootstrap, deploy, rollback, delete, destroy,
history, logs, status, preview and plugin. All members of a duplicate namespace
or config-key group are rejected; there is no first-wins collision. Declaring
bootstrap/destroy is rejected; declaring both an init command and init
contributor is rejected. A declared status or init command takes precedence.
Manifest namespace spelling and export name are individually checked, but their
equality is not an additional host check.

Discovery runs for generic dispatch, plugin list, interactive first-run init,
help and bare usage. Ordinary context-taking built-ins do no discovery. Help
falls back to built-in usage outside a repo or when package.json is missing;
other failures still propagate. Noninteractive init refuses before discovery.
[plugins.test.ts](../../../packages/cli/src/plugins.test.ts) includes real-loader
bundled-only cases; [context.test.ts](../../../packages/cli/src/context.test.ts)
pins the discovery-free built-in path and config typing/validation.

## Invocation, management and init

Global parseArgs rejects unknown flags. Bare invocation exits 1; --help exits 0.
Unknown first words are dispatched as plugin namespaces and fail with plugin-list
guidance if unavailable. Longest declared multi-word action wins. After consuming
its words, the first remaining positional is env; `--env` overrides it and
production is the default. Remaining positionals and recognized forwarded flags
reach run. The host has no generic arbitrary plugin flag registration mechanism.

`plugin add` expands a short name to `blogwright-<name>`; an already prefixed or
scoped name stays literal. Names must be npm-name shaped; version specs, URLs and
paths are rejected. It installs the CLI's current version exactly. An existing
manifest declaration is a no-op, not an upgrade. Scoped names can be installed
but the current discovery prefix filter does not scan them. `plugin list` shows
namespace/package/version/config key and load failures, and returns 0 even when
failures are listed.

`plugin remove` requires a direct manifest dependency. It loads only that package;
when it has nodes, an interactive session asks about teardown with No default.
Yes destroys the selected environment before uninstalling; an error prevents
removal. No uninstalls while retaining resources/config. Noninteractive removal
of a loadable node plugin refuses unless `--yes` is supplied. Here `--yes` means
**uninstall and retain resources**, not approve teardown. A missing/broken module
can be removed without a node prompt. Bundled-only dependencies cannot be removed
from the consumer's manifest. Reinstall to regain a removed plugin's destroy verb.

Package management is a lazy `PackageManagerFactory` passed from bin.ts into
main, not a `packages` member on OpsContext/Ports. The adapter detects pnpm,
npm, yarn or bun from repo lockfiles and crosses the process boundary. Management
runs before config/AWS context creation, except an explicitly accepted teardown.
`ModuleLoader` stays on CLI Ports alongside fs, terminal, vcs and ping; plugin
ports expose only fs/terminal. [Port declarations](../../../packages/cli/src/ports.ts)
and [adapter tests](../../../packages/cli/src/adapters/process-package-manager.test.ts)
define manager commands and detection failures.

`PluginInitIo` exposes isInteractive, logger and ask(question). A question has
prompt and optional defaultValue, required, validate(answer); an unanswered
optional question becomes empty string. A `ConfigBlockEntry` has rendered
property and optional trailing comment. An empty returned array means declined.
First-run init asks contributors and writes one config. Generic `<plugin> init`
splices the answered key into existing JSONC before the closing object brace,
preserving comments/formatting. It refuses existing keys and non-object shapes;
validates the resulting site config before writing. PDS declares publication init
and has no config contributor. See [splice tests](../../../packages/cli/src/config-block.test.ts).

## Graph engine, state and teardown

`ResourceNode<Ctx = PluginContext>` has required id, dependsOn, title, read,
create, delete and optional update. The generic context is unconstrained; the
CLI engine instead requires structural GraphContext (logger, save, resources).
[topoSort/applyGraph/destroyGraph](../../../packages/cli/src/graph.ts) sort
stable node ids by dependencies, reject missing dependencies/cycles, read before
create/update, save per node including create/update failure progress (read failures precede
the best-effort failure-save block), and destroy in reverse
order while deleting completed resource records. Nodes record in-memory outputs;
the engine, not each node, owns persistence.

Generic plugin bootstrap/status/destroy operate only on plugin nodes and scoped
state. Destroy requires `--yes` and deletes the scoped key after graph completion.
Site and preview teardown check bucket state keys before terminating MicroVMs or
deleting resources. Any `state/<env>.<scope>.json` blocks, even an empty object
or uninstalled plugin, with an environment-qualified destroy command. NoSuchBucket
alone is treated as clear; access/transport/other listing failures abort teardown.

After successful site bootstrap, the same sorted/deduplicated current-env key
matcher emits one `<scope> bootstrap <env>` warning per scope. No key means no
warning; unrelated environments do not trigger one. A failed listing warns
contextually but leaves successful bootstrap successful. Neither path discovers
plugins or reads their config. [commands.ts](../../../packages/cli/src/commands.ts)
and [commands.test.ts](../../../packages/cli/src/commands.test.ts) own both paths.

Site nodes contain no plugin config branches. Shared attachments are independently
named: PDS owns its inline policy; analytics owns its delivery destination.
The site log-delivery delete and ConflictException retry refuse foreign deliveries
before mutation, matching own deliveries by destination ARN rather than order.

## Plugin AWS service seam

`SendOptions.service` accepts core ServiceKey or a descriptor
`{service: string, signingName: string, global?: boolean}` (global defaults false).
One resolveService helper feeds endpoint host,
signing name/region, S3 URI-escaping choice and AWS error service label; core's
SIGNING_NAMES/GLOBAL_SERVICES remain closed. The host exposes signingUsEast1
alongside signing so plugin clients retain credentials, endpoint override and
injected transport. [Endpoint](../../../packages/core/src/aws/endpoint.ts),
[signer](../../../packages/core/src/aws/signer.ts) and their tests pin descriptor
and built-in behavior; analytics's four new service clients remain plugin-local.

## Assumptions and open questions

**Assumptions**

- The AWS account, credentials and installed packages are operator-controlled.

**Decisions**

- *Scope.* **Internal implementation contracts.** No supported third-party SPI is introduced.
- *Ownership.* **Separate graphs and state keys.** Each feature reconciles its own resources through shared vocabulary and the CLI engine.

**Open questions**

- How should SPI compatibility be declared when CLI/plugins cease fixed-version releases?
- Should preview become a plugin despite its shared site graph?
- Should scoped npm packages become discovery candidates? Management accepts their names, but discovery currently scans only `blogwright-*`.
