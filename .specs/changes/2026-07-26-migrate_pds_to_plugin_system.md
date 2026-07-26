# Change: Migrate blogwright-pds onto the plugin system

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** packages/pds (plugin export, config ownership, one IAM node) + packages/cli (dispatch, site-graph pds removal) + packages/core (config)

`blogwright-pds` becomes a plugin: it declares a manifest field, exports a
`Plugin`, owns and validates its `pds` config key, contributes the one resource
node its feature needs, and answers
`blogwright pds <action>` through generic dispatch instead of the hardcoded
`runPds`. It remains a default dependency of the CLI, so nothing changes for
users — `blogwright pds sync` keeps working with no install step. The migration
is a plugin by architecture, not by distribution, and exists to validate the SPI
against a second consumer before anything is frozen.

---

## Motivation

The plugin SPI proposed in
[`2026-07-26-cli_plugin_system.md`](2026-07-26-cli_plugin_system.md) is designed
against exactly one real feature. An abstraction validated by one example is the
wrong abstraction waiting to be discovered — and DEVELOPMENT.md's Clean Code
section says so directly. Migrating pds gives the SPI a second consumer with a
genuinely different shape: pds does its work through Secrets Manager and repo
files, has an interactive OAuth flow, and contributes exactly one resource node
where analytics contributes twelve. If the contract survives both, it is close
to right.

It also closes a layering leak. The site's GitHub-OIDC deploy role grants
Secrets Manager access to the pds secret, which means the CLI's own resource
graph reads a plugin's config key and derives a plugin's resource name — the
one place plugin topography still lives outside its plugin. Moving it is what
makes "a plugin owns its own topography" true rather than aspirational.

The migration is also a straightforward simplification. `runPds`
([`cli.ts:187`](../../packages/cli/src/cli.ts)) hand-rolls positional shifting
for the `secret` sub-action and maintains its own set of known actions; core's
`validateConfig` ([`config.ts:314`](../../packages/core/src/config.ts)) knows
about handle resolvers and secret-name character classes, which is pds domain
knowledge living in the package that should know least about it. Both move to
where they belong.

---

## Affected spec pages

| Canonical page | Nature of change |
|---|---|
| *(none — no canonical page for CLI dispatch or the pds feature yet)* | `pds` dispatch moves from hardcoded to plugin-provided; `pds` config validation moves from core into the plugin |
| [DEVELOPMENT.md](../../DEVELOPMENT.md) → Hexagonal architecture | The "features live in their own packages" note gains the plugin manifest as the mechanism |

Depends on [`2026-07-26-cli_plugin_system.md`](2026-07-26-cli_plugin_system.md);
this change cannot land before it.

---

## Proposed changes

### `blogwright-pds` → Package manifest (Add)

> `packages/pds/package.json` declares the plugin manifest field:
>
> ```json
> { "blogwright": { "plugin": "pds" } }
> ```
>
> The package name is unchanged. `blogwright-pds` stays published under that
> name and `blogwright/rkey` keeps re-exporting `blogwright-pds/rkey`.

### `blogwright-pds` → Plugin export (Add)

> The package's default export is a `Plugin` declaring the `pds` namespace, its
> six actions (`keygen`, `login`, `init`, `sync`, `secret status`,
> `secret delete`), the `pds` config key, its config validator, and `nodes(ctx)`
> — the one resource node §Its own IAM policy node describes. Each command
> wraps the existing exported function; the functions themselves keep their
> current signatures and stay individually exported, so `syncAfterDeploy` and
> the rest remain importable.

### `blogwright-pds` → Context (Modify)

> `PdsContext` becomes a narrowing of core's `PluginContext<PdsConfig>` rather
> than an independently declared interface. The types it names — `PdsLogger`,
> `PdsPorts` — resolve to the core equivalents.
>
> The narrowing is stated positively, as a `Pick` of exactly the members
> `PdsContext` has today: `env`, `domain`, `config`, `clients` (narrowed to
> `{ secrets }`, because
> [`test-support.ts:102`](../../packages/pds/src/test-support.ts) supplies only
> that one client), `ports` (narrowed to `fs` and `terminal`), `logger`, and
> optional `tags`. Everything else on `PluginContext` is left out — nine of its
> sixteen members, not the five a dispatch boundary populates: `preview`,
> `names`, `accountId` and `save()` are host surface pds has never needed, and
> `pluginConfig`, `state`, `siteState`, `store` and `record()` exist only behind
> a dispatch boundary that no pds command function runs behind. `deploy` calls
> `syncAfterDeploy(ctx)` with its plain `OpsContext`
> ([`commands.ts:97`](../../packages/cli/src/commands.ts)), which reaches
> `syncPds` and `requirePdsConfig` with nothing having built a plugin context.
>
> Picking rather than omitting is what preserves the structural-satisfaction
> property and keeps
> [`createTestContext`](../../packages/pds/src/test-support.ts) buildable:
> `OpsContext` ([`context.ts:25-51`](../../packages/cli/src/context.ts)) still
> satisfies `PdsContext` by plain assignment, the pds test factory still builds
> a complete context from one client and two ports, and the package still
> imports no CLI type. An `Omit` of the five dispatch-boundary members would
> drag `preview`, `names`, `accountId` and `save()` in — every pds test would
> then have to fabricate a `Names` and stub a `save()`. (`tags` stays optional
> either way: `Pick` and `Omit` both preserve a retained property's optionality,
> and the SPI declares `tags?: Record<string, string> | undefined` for exactly
> this reason.) The plugin's one resource node is the exception and says so: it
> receives a full `PluginContext<PdsConfig>` from the lifecycle verbs, because
> only the engine path has a boundary to build one.

### `blogwright-pds` → Config ownership (Add)

> The plugin owns the `pds` config block end to end. Its `validateConfig`
> performs the checks core's `validateConfig` performs today — `name` is
> required and non-empty, `handleResolver` must be an https URL when present,
> `secretName` must match the permitted character class — applies the
> `<siteName>/atproto` default for `secretName` when it is absent, and
> **returns** the resolved block.
>
> Returning it is what keeps the migration type-safe. `secretName` is read as a
> required `string` at a dozen call sites across `commands.ts`, `oauth.ts` and
> `secret.ts`, all of which reach it through `requirePdsConfig`
> ([`sync.ts:50`](../../packages/pds/src/sync.ts)), which today returns
> `ctx.config.pds` verbatim and relies on core having already applied the
> default. Moving the default into the plugin without giving it somewhere to
> land would widen every one of those reads to `string | undefined`.
>
> `requirePdsConfig` instead returns a `ResolvedPdsConfig` — core's `PdsConfig`
> with `secretName` narrowed to `string` — applying the `<siteName>/atproto`
> default inside the package, through the same `resolvePdsSecretName` the
> validator uses. Every call site keeps a total type, and it works on the paths
> that have no dispatch boundary: `syncAfterDeploy(ctx)` is called with a plain
> `OpsContext`, which has no `pluginConfig` to read. Reading `ctx.pluginConfig`
> there would not compile — passing an `OpsContext` to a parameter typed with
> `pluginConfig` is `TS2345`, elaborated as *"Property 'pluginConfig' is missing
> in type 'OpsContext' but required in type …"* (checked against this repo's
> tsc 6.0.3) — and the breakage would land on the post-deploy sync, the one
> path this migration promises not to touch. `validateConfig` still returns the
> resolved block for the dispatch path; the two agree because they share one
> resolver.

### `blogwright-pds` → Its own IAM policy node (Add)

> The plugin contributes one resource node. The site's GitHub-OIDC deploy role
> currently carries a Secrets Manager statement that exists only for pds — the
> site graph branches on `ctx.config.pds`
> ([`nodes.ts:913`](../../packages/cli/src/nodes.ts)) and interpolates that
> plugin's secret name into the ARN at `nodes.ts:925`. That is plugin topography
> in the site graph, and it moves.
>
> pds instead attaches a **named inline policy** to the site's role —
> `putRolePolicy(role, 'blogwright-pds', …)` — granting `GetSecretValue`,
> `PutSecretValue` and `CreateSecret` on its own secret's ARN. `IamClient`
> already exposes `putRolePolicy`, `listRolePolicies` and `deleteRolePolicy`
> ([`iam.ts:84,93,108`](../../packages/core/src/aws/iam.ts)), so the site's node
> keeps managing only its own document and the plugin's grant is created and
> removed with the plugin.
>
> The node needs the role's **name**, and today that name has no home. It is
> derived privately inside `githubOidcRoleNode` as `` `${ctx.names.prefix}-gh` ``
> ([`nodes.ts:826`](../../packages/cli/src/nodes.ts)); only the ARN reaches
> state (`nodes.ts:966`), and `Names`
> ([`config.ts:333-345`](../../packages/core/src/config.ts)) does not carry it.
> Core's `deriveNames` therefore gains `githubRole: '<prefix>-gh'` and the CLI's
> node reads it from there, so the derivation has one home — the rule
> DEVELOPMENT.md §Limits and bounds states for every derived AWS name. The
> plugin's node reads `names.githubRole` and confirms the role's ARN is in the
> site's state before it calls.
>
> The node is **skipped** when `config.githubRepo` is unset, because the site
> graph only adds `githubOidcRoleNode` for a non-preview stack when it is set
> ([`nodes.ts:1082`](../../packages/cli/src/nodes.ts)) — a site with no CI
> deploys is fully bootstrapped and simply has no deploy role to attach to.
> When `githubRepo` *is* set and the role is absent from the site's state, the
> node fails with an actionable message naming `blogwright bootstrap`.
>
> This gives pds resource nodes, which it does not have today. It also makes it
> the second consumer to exercise `nodes(ctx)`, rather than only the no-nodes
> path.

### `blogwright-cli` → The site graph drops its pds branch (Remove)

> `oidcRolePolicyStatements` ([`nodes.ts:863`](../../packages/cli/src/nodes.ts))
> loses its `if (ctx.config.pds)` branch entirely, and the CLI's resource graph
> stops importing anything from `blogwright-pds`.
>
> The two changes are sequenced additive-first: pds attaches its own policy
> before the site drops its statement. The policies are separately named, so
> both grants coexist for one step and there is never a commit at which a CI
> deploy loses access to the secret. Without that ordering this would be a
> user-visible break in a migration whose whole promise is that there is none.

### `blogwright-core` → Config (Modify)

> Core stops validating and defaulting the `pds` block. `mergeConfig` no longer
> branches on `raw.pds`, and `validateConfig` no longer contains pds-specific
> checks. The `PdsConfig` type stays on `OpsConfig` so that a config file
> carrying a `pds` block still typechecks and still round-trips, but
> `secretName` becomes optional on the type, since the plugin now supplies the
> default.
>
> `deriveNames` gains one field, `githubRole`, so the deploy role's name has a
> single home; the CLI's `githubOidcRoleNode` reads it instead of deriving it
> privately, and pds's node reads the same field. The derived value is
> unchanged (`<env>-<siteName>-gh`), so no existing role is renamed.

### `blogwright-cli` → Dispatch (Remove)

> `runPds` and its `PdsValues` interface are deleted, along with the
> `import * as pds from 'blogwright-pds'` at the top of `cli.ts` and the
> `command === 'pds'` branch. The `pds` section of the `USAGE` string is
> removed; the same six actions are produced at runtime from the plugin's
> `description` and its commands' `summary` fields. That section gets shorter:
> the SPI gives a plugin one line of `description` and one line of `summary` per
> action, while [`cli.ts:33-47`](../../packages/cli/src/cli.ts) is fifteen lines
> of prose — four of them explaining `pds login`'s paste flow and three
> explaining what `pds sync` reconciles. That guidance moves into the summaries
> where it fits and into the docs where it does not; the alternative is a
> multi-line `details` field on `PluginCommand`, which the SPI deliberately does
> not have. pds is a default dependency, so the generated section always renders
> and every user sees the shorter form — a small, deliberate, user-visible
> change inside a migration that otherwise has none, and the one thing here
> worth naming in the release notes. Multi-word actions such as
> `secret status` are declared as such by the plugin, so the positional shifting
> `runPds` performs by hand disappears — but the behaviour it implements does
> not. Generic dispatch resolves the trailing environment positional after the
> matched action, so `blogwright pds sync staging` and
> `blogwright pds secret status staging` keep selecting `staging`. Both are
> asserted by tests; a silent fall back to `production` is the most likely way
> this migration breaks its own no-user-visible-change promise.

### `blogwright-cli` → Post-deploy sync (Modify)

> `deploy` keeps importing `syncAfterDeploy` from `blogwright-pds` directly
> ([`commands.ts:2`](../../packages/cli/src/commands.ts)) and calling it with
> its own `OpsContext` ([`commands.ts:97`](../../packages/cli/src/commands.ts)).
> The plugin SPI has no lifecycle hooks, and pds remains a default dependency,
> so the static import resolves. This path is why `PdsContext` narrows
> `PluginContext` without `pluginConfig` and why `requirePdsConfig` resolves
> `secretName` inside the package: there is no dispatch boundary here to build a
> plugin context. This is a deliberate wart, recorded rather than designed away:
> one consumer wanting a hook is not evidence enough to add one.

---

## Type changes

```json
{
  "$comment": "Fragment for 2026-07-26-migrate_pds_to_plugin_system. Modifies PdsConfig: secretName becomes optional because the plugin now applies the default.",
  "$defs": {
    "PdsConfig": {
      "type": "object",
      "required": ["name"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "handleResolver": { "type": "string", "format": "uri", "pattern": "^https://" },
        "secretName": {
          "type": "string",
          "pattern": "^[\\w/+=.@-]+$",
          "description": "Optional as written on disk; the pds plugin's validateConfig applies the `<siteName>/atproto` default and returns a resolved block in which it is always present."
        }
      }
    }
  }
}
```

The on-disk config file shape is unchanged. Only where the default and the
validation live changes. Inside the package the resolved shape is a distinct
type, `ResolvedPdsConfig` — the same block with `secretName` narrowed to
`string` — which is what `requirePdsConfig` returns and what `validateConfig`
puts on `pluginConfig`.

---

## Implementation notes

```
1. packages/pds/package.json — add the `blogwright` manifest field.
2. packages/pds/src/plugin.ts (new) — the Plugin object: name, description,
   configKey 'pds', validateConfig, nodes(ctx) (step 5's node module), and six
   commands wrapping the existing exports in commands.ts (:32 keygen, :68 login,
   :82 secretStatus, :106 secretDelete, :118 init, :169 sync). Default-export it
   from index.ts, keeping the existing named exports (:7-8) intact —
   syncAfterDeploy (:204) is still imported directly by the CLI.
3. packages/pds/src/context.ts:25 — redefine PdsContext as a Pick over core's
   PluginContext<PdsConfig> of exactly env, domain, config, clients (narrowed
   to { secrets }), ports (narrowed to fs/terminal), logger and optional tags —
   the members it declares today. PdsLogger (:10) and PdsPorts (:19) become
   aliases. Check the result against test-support.ts:96-108, which must still
   build a complete PdsContext from one client and two ports.
4. packages/pds/src/config.ts (new) — validatePdsConfig, resolvePdsSecretName
   and ResolvedPdsConfig, lifted from core config.ts:266-271 and :314-330.
   sync.ts:50 requirePdsConfig returns ResolvedPdsConfig through the same
   resolver. Move the existing negative-space tests across with it.
5. packages/pds/src/nodes.ts (new) — the one resource node: it attaches the
   `blogwright-pds`-named inline policy to the site's deploy role through
   putRolePolicy (core iam.ts:84), reads through listRolePolicies (:93) and
   deletes through deleteRolePolicy (:108), reproducing the ARN at
   cli nodes.ts:925 from resolvePdsSecretName. Skipped when config.pds or
   config.githubRepo is absent. This lands BEFORE step 6: the grant must exist
   on the role before core stops defaulting secretName, and before step 7
   removes the site's own statement.
6. packages/core/src/config.ts — delete the raw.pds branch (:266-271) and the
   cfg.pds block in validateConfig (:314-330); make PdsConfig.secretName
   optional (:43); add `githubRole` to Names (:333-345) and to deriveNames
   (:360-372) as `${prefix}-gh`, and read it from nodes.ts:826.
7. packages/cli/src/nodes.ts — delete the `if (ctx.config.pds)` branch from
   oidcRolePolicyStatements (:913-927), so the site graph stops reading a
   plugin's config key and interpolating its secret name into an ARN (:925),
   and the CLI's graph imports nothing from blogwright-pds. Additive-first:
   step 5's separately-named inline policy is already on the role, so no
   commit leaves a CI deploy without the grant.
8. packages/cli/src/cli.ts — delete runPds (:187-232) and PdsValues
   (:177-184), the pds import (:4), and the `command === 'pds'` branch (:114).
   Remove the pds block from USAGE (:33-47). The `identifier` flag (:91) stays
   — it is now passed through to the plugin as an argument.
9. Tests: pds command dispatch through the plugin path reaches the same
   functions with the same arguments; the moved config validation keeps its
   negative-space coverage; `blogwright pds` with no action and with an unknown
   action still exit non-zero with the same shape of message; the plugin's node
   emits a policy document identical to the statement the site graph produces
   today.
10. Run `pnpm knip` — the removed core-side pds knowledge may orphan imports.
```

Behaviour is verified by the existing pds tests plus a dispatch test. The one
user-visible change to assert is the help section: `blogwright --help` still
lists all six actions, each with one line, and the longer `pds login` and
`pds sync` prose is gone from `USAGE`.

---

## Merge plan

1. Apply the `Proposed changes` blocks to whichever canonical page documents
   CLI dispatch and the pds feature, once one exists.
2. Fold the modified `PdsConfig` `$def` into the canonical schema.
3. Note in [DEVELOPMENT.md](../../DEVELOPMENT.md) §Hexagonal architecture that
   the feature-package pattern is now realised by the plugin manifest.
4. Flip this file's **Status:** to `Merged`, add **Merged:** date, move to
   `.specs/changes/merged/`.
5. Update `.specs/README.md` (remove from pending change specs).

---

## Assumptions and open questions

**Assumptions**

- `blogwright-pds` stays a default dependency of `blogwright`. Every guarantee
  here about "nothing changes for users" rests on that; if pds ever becomes
  optional, the static `syncAfterDeploy` import in `commands.ts:2` breaks and
  needs the hook this change deliberately does not add.
- No consumer imports `blogwright-pds` directly for anything but the `/rkey`
  subpath. The named exports stay in place regardless, so this holds either way.
- Existing `config/<env>.jsonc` files with a `pds` block need no migration —
  the block's shape, defaults, and validation outcomes are identical, only
  their implementation location moves.

**Decisions**

- *The pds grant moves to pds, and the move is additive-first.* **pds attaches
  its own named inline policy before the site drops its statement.** IAM inline
  policies are named, so the two coexist for one step and no commit leaves a CI
  deploy without access to the secret. Doing it in the other order would be a
  real outage inside a migration that promises no user-visible change.
- *pds ships by default; it becomes a plugin architecturally, not
  distributionally.* **No install step, no user-visible change.** The point of
  migrating is to validate the SPI against a second consumer, not to make
  standard.site publishing opt-in. Making it opt-in would be a separate,
  user-facing decision.
- *`syncAfterDeploy` keeps its direct import.* **One consumer is not evidence
  for a hook.** Analytics ingests continuously via Firehose and has no
  post-deploy work, so nothing else needs it. Adding an `afterDeploy` hook now
  would be speculative surface on a contract the whole point of which is to stay
  small.
- *Config validation moves into the plugin.* **The package that owns a config
  key owns its rules.** Core knowing about handle resolvers and secret-name
  character classes is exactly the coupling the package split was meant to
  remove.
- *`requirePdsConfig` resolves the default, rather than reading
  `pluginConfig`.* **`ResolvedPdsConfig` keeps `secretName` total on every
  path, including the ones with no dispatch boundary.** `deploy` calls
  `syncAfterDeploy(ctx)` with a plain `OpsContext`, which has no
  `pluginConfig`; reading it there would not compile, and the failure would land
  on the post-deploy sync — the exact path this migration promises not to
  disturb.
- *The deploy role's name joins `deriveNames`.* **One home for a derived AWS
  name.** It is currently a private lambda inside `githubOidcRoleNode`
  ([`nodes.ts:826`](../../packages/cli/src/nodes.ts)) and only the ARN reaches
  state, so the plugin's node would otherwise re-derive `<prefix>-gh`
  independently — the duplication DEVELOPMENT.md's derived-name rule exists to
  prevent. The value does not change, so no role is renamed.
- *The package is not renamed.* **`blogwright-pds` stays `blogwright-pds`.**
  It is published, `blogwright/rkey` re-exports from it, and the manifest field
  makes the namespace explicit without a rename.
- *Migrate before analytics ships, not after.* **The SPI is validated by two
  consumers before the first external plugin exists.** Migrating afterwards
  would mean freezing a contract designed against one example and then
  discovering its gaps with a shipped plugin in the field.

**Open questions**

- Should the SPI gain an `afterDeploy` hook once a second consumer wants one,
  and does that consumer exist? If analytics ever adds a backfill triggered by
  deploys, this stops being hypothetical.
- Core still carries the `PdsConfig` *type* for a feature it does not implement.
  Is that acceptable indefinitely, or should `OpsConfig` eventually hold plugin
  blocks as an opaque map keyed by plugin name? The latter is cleaner layering
  and a breaking change to the config type.
- Should `blogwright pds` actions get shorter aliases now that dispatch is
  generic and multi-word actions are declared rather than parsed?
