# Change: An internal plugin system for the CLI

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** packages/core (plugin SPI, state scoping) + packages/cli (discovery, dispatch, `plugin` commands)

The CLI gains a plugin system: a small service-provider interface in
`blogwright-core`, discovery of installed plugins by a manifest field in their
`package.json`, and generic dispatch so that an installed plugin named `x`
answers `blogwright x <action>`. A plugin contributes commands, resource-graph
nodes, one config key, and an `init` contributor; it owns its own state key and
lifecycle verbs. The SPI is internal — undocumented and unversioned — until it
has carried two features through a release cycle.

---

## Motivation

`blogwright-pds` is already a plugin in everything but name. Its
[`PdsContext`](../../packages/pds/src/context.ts) is a narrowed structural
interface that the CLI's `OpsContext` satisfies by plain assignment, with no
import from the CLI in either direction — the exact shape a plugin boundary
wants. What is missing is the generic half: `runPds`
([`cli.ts:187`](../../packages/cli/src/cli.ts)) hardcodes the dispatch, the
`pds` config block is validated inside core's `validateConfig`
([`config.ts:314`](../../packages/core/src/config.ts)), and nothing lets a
feature ship outside the CLI's dependency tree.

The immediate driver is the analytics feature, which must not ship with the CLI
by default. But building a bespoke install/dispatch/config path for one feature
would leave the next feature to build its own again. Four decisions that would
otherwise be analytics-specific — how a module is installed, where its config
type lives, how its config block is written into an existing JSONC file, and
whether its resources join the main graph — become one mechanism solved once.
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
| *(none — no canonical page for CLI dispatch or the graph engine yet)* | New plugin SPI in `blogwright-core`; `ResourceNode` vocabulary relocates to core; new discovery, dispatch, and `plugin` commands in the CLI; `StateStore` gains an optional scope |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Hexagonal architecture | New `ModuleLoader` and `PackageManager` ports join the ports table |

Companion change specs:
[`2026-07-26-migrate_pds_to_plugin_system.md`](2026-07-26-migrate_pds_to_plugin_system.md)
(the second consumer that validates this SPI) and
[`2026-07-26-analytics_plugin.md`](2026-07-26-analytics_plugin.md) (the first
plugin that ships outside the CLI). Both depend on this change.

---

## Proposed changes

### Plugin SPI → The `Plugin` contract (Add)

> A plugin is a package that exports a `Plugin` object as its default export.
> The contract lives in `blogwright-core` so that plugins depend on core and
> never on the CLI:
>
> - `name` — the CLI namespace the plugin claims (`analytics` answers
>   `blogwright analytics <action>`). Lowercase alphanumerics and dashes.
> - `description` — one line, shown in `blogwright --help`.
> - `commands` — the actions the namespace accepts. Each carries an `action`
>   name, a `summary` for help output, and `run(ctx, args)`.
> - `nodes?(ctx)` — resource-graph nodes the plugin contributes, if any.
> - `configKey?` — the single config key the plugin owns.
> - `validateConfig?(raw)` — validates that key's block, raising in the repo's
>   own error vocabulary.
> - `init?(io)` — the init contributor, returning the config block to write.
>
> A plugin declares nothing else. There are no lifecycle hooks, no
> plugin-to-plugin dependencies, no contributed ports or adapters, and no
> merged config schemas beyond the one owned key.

### Plugin SPI → `PluginContext` (Add)

> `PluginContext` is the narrow slice of the host CLI's context a plugin
> command receives — environment, domain, config, the AWS clients, the shared
> ports, a logger, and resource tags. No plugin imports a CLI type; `PdsContext`
> is the existing precedent and becomes a narrowing of this interface.

### Plugin SPI → The two state surfaces (Add)

> A plugin sees state through two deliberately distinct fields, because it needs
> to read the site's resources while writing only its own:
>
> - `siteState` — a **read-only** view of the site's recorded outputs
>   (`state/<env>.json`). A plugin reads it to find resources the site owns; the
>   analytics log-delivery node reads the distribution ARN through it. The type
>   is readonly, so a plugin cannot write the site's state at all.
> - `state` and `store` — the plugin's **own** scoped outputs and the scoped
>   `StateStore` (`state/<env>.<plugin>.json`) they persist through. This is the
>   only state a plugin may write.
>
> The CLI builds this context when it dispatches; unlike `PdsContext`, an
> `OpsContext` does not satisfy it by plain assignment, because the two state
> surfaces come from two different stores. The adaptation is one function at the
> dispatch boundary and is covered by a test asserting both fields are populated
> from different keys.

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
> CLI. The *engine* — `topoSort`, `applyGraph`, `destroyGraph` — stays in the
> CLI. Core owns the vocabulary of a reconcilable resource; the CLI owns
> reconciliation.

### State → Scoped state stores (Modify)

> `StateStore` takes an optional scope. An unscoped store keys
> `state/<env>.json` as today; a store scoped to a plugin keys
> `state/<env>.<plugin>.json`. A plugin's resources are therefore recorded
> separately from the site's, so tearing down one never discards the other's
> record of what exists.

### CLI → Plugin discovery (Add)

> The CLI discovers plugins from the consuming repository, not from its own
> dependencies. It reads `<repoRoot>/package.json`, takes every dependency and
> devDependency whose name starts with `blogwright-`, resolves each package
> directory, and reads that package's `package.json` for a manifest field.
>
> Resolution goes through the package's **entry point**, not through
> `<name>/package.json`. Every package in this workspace declares an `exports`
> map, and Node's exports encapsulation makes `require.resolve` of a subpath the
> map does not list throw `ERR_PACKAGE_PATH_NOT_EXPORTED` — which
> `blogwright-pds/package.json` does today. The loader therefore resolves the
> bare specifier and walks up from the resolved file to the nearest
> `package.json`, so discovery works against packages whose `exports` map the
> plugin author never adjusted. Discovery is covered by at least one test using
> the real loader against a package on disk, not only the map-backed fake —
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
> Discovery is lazy. It runs only when the first positional argument is neither
> a built-in command nor `plugin`, so ordinary `deploy` and `status` runs pay
> nothing for it.

### CLI → Namespace collisions (Add)

> Built-in commands always win. The reserved set is every name the CLI
> dispatches itself — `init`, `bootstrap`, `deploy`, `rollback`, `delete`,
> `destroy`, `history`, `logs`, `status`, `preview`, and `plugin`. A discovered
> plugin claiming a reserved name is rejected with an error naming the package
> and the collision, rather than being silently shadowed. Two plugins claiming
> the same name is likewise an error, not a race.

### CLI → `blogwright plugin` (Add)

> A new built-in namespace manages plugins:
>
> - `blogwright plugin list` — installed plugins, their namespaces, versions,
>   and the config key each owns. Also names plugins that failed to load, with
>   the reason.
> - `blogwright plugin add <name>` — installs a plugin into the consuming repo.
>   The short name `analytics` resolves to the package `blogwright-analytics`;
>   a name containing a `/` or already starting with `blogwright-` is treated
>   as a literal package name. The version installed matches the running CLI's
>   own version, so the two never drift. Installing an already-installed plugin
>   reports that and exits 0.
> - `blogwright plugin remove <name>` — uninstalls the package. Configuration
>   and provisioned resources are untouched; the command says so and names the
>   plugin's teardown verb.

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
> plugin-owned blocks; the CLI calls each loaded plugin's `validateConfig` after
> parsing. A config file carrying a block for a plugin that is not installed is
> valid and inert — the same contract `pds` has today.

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
> plugin that already has an `init` of its own keeps it — `blogwright pds init`
> creates the publication record today and must keep doing so. The consequence
> is a rule the SPI enforces: a plugin either declares an `init` command, in
> which case that command is responsible for writing its config block, or it
> declares none and the generic action handles it. Declaring an `init` command
> *and* relying on the generic action to write the block is rejected at
> discovery, because the resulting command would ask the questions and discard
> the answers.

### CLI → Plugin lifecycle (Add)

> A plugin that contributes nodes owns its own lifecycle verbs rather than
> joining the site graph. `blogwright <plugin> bootstrap`, `status`, and
> `destroy` run the same engine — `applyGraph`, `destroyGraph`, and the
> status read loop — over the plugin's node set against the plugin's scoped
> state store. `blogwright bootstrap` and `blogwright destroy` do not touch
> plugin resources, so a site teardown never takes a plugin's data with it.

### Ports → `ModuleLoader` (Add)

> Resolving and importing a plugin package is a side effect and crosses a port.
> `ModuleLoader` exposes `resolve(specifier, fromDir)` returning the resolved
> module path or nothing, and `load(path)` returning the imported module. The
> real adapter uses `createRequire` against the consuming repo's root and a
> dynamic `import()`; tests substitute a map of fake modules. No domain module
> imports `node:module`.

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

No change to `OpsConfig`'s shape. Core stops validating plugin-owned keys;
the keys themselves are unchanged on disk.

---

## Implementation notes

```
1. packages/core — new src/plugin.ts: Plugin, PluginCommand, PluginContext,
   PluginManifest, and validatePlugin(module, packageName) for the boundary
   check. Export from src/index.ts (:1-27).
2. packages/core — move ResourceNode out of packages/cli/src/graph.ts:4 into
   src/plugin.ts (or src/resource.ts); re-export from index. graph.ts keeps
   topoSort/applyGraph/destroyGraph and imports the type from core.
   nodes.ts (1,087 lines) changes only its import.
3. packages/core/src/state.ts:22 — StateStore gains an optional 4th ctor arg
   `scope`; stateKey(:17) becomes `state/${env}.json` or
   `state/${env}.${scope}.json`.
4. packages/core/src/config.ts — remove the pds-specific branches from
   mergeConfig (:266-271) and validateConfig (:314-330); keep the `pds` key
   on OpsConfig. Unknown keys already survive the spread at :253.
   (The pds side of this lands in the companion migration change spec.)
5. packages/cli/src/ports.ts:25 — add `loader: ModuleLoader` and
   `packages: PackageManager` to Ports; define both interfaces there.
   New adapters: adapters/node-module-loader.ts (createRequire + import),
   adapters/process-package-manager.ts (lockfile detect + spawn), modelled on
   adapters/process-vcs.ts. Wire both in context.ts:111-116.
6. packages/cli — new src/plugins.ts: discover(repoRoot, ports) reading
   <repoRoot>/package.json via ports.fs, filtering `blogwright-*` deps,
   resolving each via ports.loader, reading its package.json for the manifest
   field, loading and validating. Reserved-name and duplicate-name checks here.
7. packages/cli — new src/plugin-commands.ts for `plugin add|list|remove`,
   and src/config-block.ts for the textual JSONC block splice used by
   `<plugin> init`. init.ts:42 renderConfig is the style to match; the
   existing-file guard at init.ts:87 stays for `blogwright init`.
8. packages/cli/src/cli.ts — extend KNOWN_COMMANDS (:66) with `plugin`;
   after the built-in switch, fall through to plugin dispatch instead of the
   unknown-command error at :117. USAGE (:11) gains a Plugins section built at
   runtime from discovered plugins.
9. Tests: discovery (manifest present/absent/malformed, reserved name,
   duplicate name), dispatch (unknown plugin, unknown action), the JSONC
   splice (comments preserved, existing key refused, non-object refused),
   scoped state keys, and both new ports substituted with fakes.
```

Order matters: steps 1–4 (the SPI and the core moves) land first and are
behaviour-neutral; steps 5–9 add the CLI surface. The pds migration follows,
then analytics.

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
- `PdsContext`'s structural-satisfaction trick generalises. It has worked since
  the 2026-07-11 package extraction and is verified at compile time.

**Decisions**

- *Manifest field, not name convention.* **A plugin declares its namespace in
  `package.json`; the CLI does not infer it from the package name.** A
  convention like `blogwright-plugin-*` would force renaming the published
  `blogwright-pds` — which `blogwright/rkey` re-exports from — and would let any
  package claim a namespace by name alone. Declaration costs one extra file
  read per candidate dependency.
- *Resolve the entry point and walk up, never `<name>/package.json`.* **Node's
  exports encapsulation makes the direct subpath throw.** Verified against this
  workspace on 2026-07-26: `require.resolve('blogwright-pds/package.json')`
  raises `ERR_PACKAGE_PATH_NOT_EXPORTED`, because that package's `exports` map
  lists only `.` and `./rkey`. Requiring every plugin author to add
  `"./package.json"` to their exports map would make discovery fail for anyone
  who forgot, in a way no map-backed test fake would ever catch.
- *`plugin add`/`list`/`remove`, not bare `plugin <name>`.* **Explicit verbs.**
  Bare `blogwright plugin analytics` reads ambiguously between installing and
  invoking, and leaves nowhere to put `list`.
- *The SPI is internal.* **Undocumented and unversioned until it has carried
  two features through a release cycle.** A plugin API is a public contract
  that cannot be changed casually once third parties write against it; at 0.3.x
  that commitment is premature. Publishing it is a separate product decision.
- *Two consumers before the abstraction is trusted.* **pds migrates in the same
  effort as analytics ships.** DEVELOPMENT.md prefers a little duplication over
  the wrong abstraction; designing a plugin API against one example is how the
  wrong abstraction happens. Two differently-shaped features — one that is
  mostly secrets and repo files, one that is mostly graph nodes — will surface
  bad assumptions before anything is frozen.
- *Plugins own their lifecycle, not the site graph.* **Separate node set,
  separate state key, separate verbs.** Folding plugin nodes into `buildNodes`
  ([`nodes.ts:1053`](../../packages/cli/src/nodes.ts)) would mean
  `blogwright destroy --yes` deletes a plugin's data along with the site.
- *No lifecycle hooks in v1.* **Commands, nodes, config, init — nothing else.**
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
- Should `blogwright destroy` refuse, or warn, when a plugin's scoped state
  shows live resources that reference site resources? The analytics change spec
  raises the concrete case: its log delivery references the site's distribution
  and its shared delivery source.
- Should `plugin remove` offer to run the plugin's teardown verb first, or is
  naming it in the output enough?
- Does `preview` eventually become a plugin? It is the one remaining built-in
  namespace shaped like one, but it shares the site's resource graph and
  context in ways a plugin deliberately cannot.
