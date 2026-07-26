# Change: Migrate blogwright-pds onto the plugin system

**Status:** Proposed · **Date:** 2026-07-26 · **Owner:** Ant Stanley · **Target:** packages/pds + packages/cli (dispatch) + packages/core (config)

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
where analytics contributes eleven. If the contract survives both, it is close
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
> `secret delete`), the `pds` config key, and its config validator. Each command
> wraps the existing exported function; the functions themselves keep their
> current signatures and stay individually exported, so `syncAfterDeploy` and
> the rest remain importable.

### `blogwright-pds` → Context (Modify)

> `PdsContext` becomes a narrowing of core's `PluginContext` rather than an
> independently declared interface. The types it names — `PdsLogger`,
> `PdsPorts` — resolve to the core equivalents. The structural-satisfaction
> property is unchanged: the CLI's `OpsContext` still satisfies it by plain
> assignment, and the package still imports no CLI type.

### `blogwright-pds` → Config ownership (Add)

> The plugin owns the `pds` config block end to end. Its `validateConfig`
> performs the checks core's `validateConfig` performs today — `name` is
> required and non-empty, `handleResolver` must be an https URL when present,
> `secretName` must match the permitted character class — and applies the
> `<siteName>/atproto` default for `secretName` when it is absent.

### `blogwright-pds` → Its own IAM policy node (Add)

> The plugin contributes one resource node. The site's GitHub-OIDC deploy role
> currently carries a Secrets Manager statement that exists only for pds — the
> site graph branches on `ctx.config.pds` and derives the secret ARN from that
> plugin's config key ([`nodes.ts:906`](../../packages/cli/src/nodes.ts)). That
> is plugin topography in the site graph, and it moves.
>
> pds instead attaches a **named inline policy** to the site's role —
> `putRolePolicy(role, 'blogwright-pds', …)` — granting `GetSecretValue`,
> `PutSecretValue` and `CreateSecret` on its own secret's ARN. `IamClient`
> already exposes `putRolePolicy`, `listRolePolicies` and `deleteRolePolicy`
> ([`iam.ts:84,93,108`](../../packages/core/src/aws/iam.ts)), so the site's node
> keeps managing only its own document and the plugin's grant is created and
> removed with the plugin. The node reads the role name from the site's state
> and fails with an actionable message when the site is not bootstrapped.
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

### `blogwright-cli` → Dispatch (Remove)

> `runPds` and its `PdsValues` interface are deleted, along with the
> `import * as pds from 'blogwright-pds'` at the top of `cli.ts` and the
> `command === 'pds'` branch. The `pds` section of the `USAGE` string is
> removed; the same content is produced at runtime from the plugin's
> `description` and its commands' `summary` fields. Multi-word actions such as
> `secret status` are declared as such by the plugin, so the positional shifting
> `runPds` performs by hand disappears — but the behaviour it implements does
> not. Generic dispatch resolves the trailing environment positional after the
> matched action, so `blogwright pds sync staging` and
> `blogwright pds secret status staging` keep selecting `staging`. Both are
> asserted by tests; a silent fall back to `production` is the most likely way
> this migration breaks its own no-user-visible-change promise.

### `blogwright-cli` → Post-deploy sync (Modify)

> `deploy` keeps importing `syncAfterDeploy` from `blogwright-pds` directly
> ([`commands.ts:2`](../../packages/cli/src/commands.ts)). The plugin SPI has no
> lifecycle hooks, and pds remains a default dependency, so the static import
> resolves. This is a deliberate wart, recorded rather than designed away: one
> consumer wanting a hook is not evidence enough to add one.

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
          "description": "Defaults to `<siteName>/atproto`, applied by the pds plugin."
        }
      }
    }
  }
}
```

The on-disk config file shape is unchanged. Only where the default and the
validation live changes.

---

## Implementation notes

```
1. packages/pds/package.json — add the `blogwright` manifest field.
2. packages/pds/src/plugin.ts (new) — the Plugin object: name, description,
   configKey 'pds', validateConfig, and six commands wrapping the existing
   exports in commands.ts (:32 keygen, :68 login, :82 secretStatus,
   :106 secretDelete, :118 init, :169 sync). Default-export it from index.ts,
   keeping the existing named exports (:6-7) intact — syncAfterDeploy (:204)
   is still imported directly by the CLI.
3. packages/pds/src/context.ts:25 — redefine PdsContext in terms of core's
   PluginContext. PdsLogger (:10) and PdsPorts (:19) become aliases.
4. packages/pds/src/config.ts (new) — validatePdsConfig + the secretName
   default, lifted verbatim from core config.ts:266-271 and :314-330.
   Move the existing negative-space tests across with it.
5. packages/core/src/config.ts — delete the raw.pds branch (:266-271) and the
   cfg.pds block in validateConfig (:314-330); make PdsConfig.secretName
   optional (:43).
6. packages/cli/src/cli.ts — delete runPds (:187-232) and PdsValues
   (:177-184), the pds import (:4), and the `command === 'pds'` branch (:114).
   Remove the pds block from USAGE (:33-47). The `identifier` flag (:91) stays
   — it is now passed through to the plugin as an argument.
7. Tests: pds command dispatch through the plugin path reaches the same
   functions with the same arguments; the moved config validation keeps its
   negative-space coverage; `blogwright pds` with no action and with an unknown
   action still exit non-zero with the same shape of message.
8. Run `pnpm knip` — the removed core-side pds knowledge may orphan imports.
```

Behaviour is verified by the existing pds tests plus a dispatch test; there is
no user-visible change to assert beyond "the same commands still work".

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
