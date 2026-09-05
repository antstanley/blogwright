# JSON entities, identities and state

**Status:** Implemented · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [development guidelines](../../../DEVELOPMENT.md) and [spec index](../../README.md).

## Schema scope

[canonical-types.schema.json](canonical-types.schema.json) contains one definition
per JSON entity. `PluginManifest`, `PdsConfig`, `AnalyticsConfig` and `PageView`
fold the three source specs into one product schema. `ResolvedPdsConfig` and
`ResolvedAnalyticsConfig` explicitly describe resolved JSON projections; `OpsState`
and `ResourceOutputs` document persisted state. The sidecar is documentation, not
an installed runtime validator. JSON Schema defaults annotate values; they do not
mutate input. TypeScript methods, ports, private symbols and context instances
are not JSON values and have no fabricated schema equivalents.

## PluginManifest

The `blogwright` field in a plugin package's `package.json` contains required
`plugin: string`, matching `^[a-z0-9-]+$`. It is the declared namespace, distinct
from the npm package name. The schema closes this documented manifest shape;
[discovery](../../../packages/cli/src/plugins.ts) reads the field and ignores
extra manifest properties. Runtime dispatch uses the validated export's `name`;
it does not enforce equality between that name and the manifest field.

## PdsConfig and ResolvedPdsConfig

| Field | On disk / validated block | Meaning |
| --- | --- | --- |
| `name` | Required, nonblank string | Publication display name |
| `description` | Optional string | Publication description |
| `handleResolver` | Optional HTTPS URL | Overrides handle resolution |
| `secretName` | Optional string matching `^[\w/+=.@-]+$` | Explicit Secrets Manager name |

Core retains the `PdsConfig` TypeScript declaration and optional `OpsConfig.pds`
for the direct post-deploy integration, but no PDS validation/defaulting.
`validatePdsConfig(raw)` returns that raw block after its name/resolver/secret
checks; absent/null blocks are refused. It preserves an omitted `secretName`.
`requirePdsConfig` and the IAM graph's shared `resolvePdsSecretName(pds, siteName)`
apply `<siteName>/atproto`. `ResolvedPdsConfig` requires `secretName: string`.
The validator is hand-written, not a complete JSON Schema engine: the closed
schema describes intended authoring fields; it does not imply unknown-key or
all primitive-type rejection at runtime. See [config](../../../packages/pds/src/config.ts),
[consumer resolver](../../../packages/pds/src/sync.ts) and [tests](../../../packages/pds/src/config.test.ts).

## AnalyticsConfig and ResolvedAnalyticsConfig

The schema name `AnalyticsConfig` denotes the **on-disk** block. Every field is
optional, an absent block defaults like `{}`, and unknown keys are rejected both
at the top level and under `dashboard`. Null, arrays and malformed values fail.

| Field | Validation | Default |
| --- | --- | --- |
| `tableBucket` | 3–63 lowercase letters/digits/dashes | `<env>-<siteName>-analytics` |
| `namespace` | Nonempty lowercase letters/digits/underscores | `web` |
| `table` | Same identifier pattern | `page_views` |
| `bots` | `flag` or `filter` | `flag` |
| `saltSecretName` | Nonempty Secrets Manager character class | `<siteName>/<env>/analytics-salt` |
| `dashboard.port` | Integer 1024–65535 | 4317 |

The exported TypeScript `AnalyticsConfig` is a different, validated phase:
namespace/table/bots/dashboard.port are total, and tableBucket/saltSecretName
overrides are sealed under a private symbol. Only `resolveAnalyticsConfig(ctx)`
can apply the environment-aware defaults and return `ResolvedAnalyticsConfig`,
where every listed setting is required. The private-symbol object is deliberately
not modelled as JSON. Explicit overrides can still make environments share a
bucket or salt; defaults prevent that collision, not arbitrary operator choices.
See [config](../../../packages/analytics/src/config.ts) and [tests](../../../packages/analytics/src/config.test.ts).

## PageView

The Iceberg table has twenty lowercase columns, identity-partitioned by `day`.
The schema describes JSON rows destined for it: omitted optional properties map
to nullable columns; JSON `null` is not an emitted optional value.

| Column | Iceberg type | Required | Source / meaning |
| --- | --- | --- | --- |
| `event_time` | timestamp | Yes | UTC instant from `timestamp(ms)` |
| `day` | date | Yes | UTC date of event_time, partition key |
| `host` | string | Yes | `x-host-header` |
| `uri` | string | Yes | `cs-uri-stem` |
| `query` | string | No | `cs-uri-query` |
| `method` | string | No | `cs-method` |
| `status` | int | Yes | `sc-status` |
| `referrer` | string | No | `cs(Referer)` |
| `user_agent` | string | No | `cs(User-Agent)` |
| `country` | string | No | `c-country` |
| `asn` | string | No | `asn` |
| `edge_location` | string | No | `x-edge-location` |
| `result_type` | string | No | `x-edge-result-type` |
| `bytes_sent` | long | No | `sc-bytes` |
| `time_taken` | double | No | `time-taken` |
| `content_type` | string | No | `sc-content-type` |
| `protocol` | string | No | `cs-protocol` |
| `request_id` | string | No | `x-edge-request-id` |
| `visitor_key` | string | No | Daily secret-salted viewer digest; absent when viewer IP is absent |
| `is_bot` | boolean | No | User-agent heuristic; mapper emits this even with no user agent |

[PAGE_VIEWS_COLUMNS](../../../packages/analytics/src/schema.ts) drives the
TypeScript row type, AWS table schema and mapper field sets. The JSON schema's
integer columns describe the Iceberg contract; the current mapper checks finite
numbers but does not reject fractional int/long input. CloudFront's field types
are the assumed source; no stronger generic input guarantee is implied.

## OpsState and ResourceOutputs

`OpsState` has required `version: number`, `env: string`, `resources`, and an
`updatedAt: string | undefined` property in memory. Empty state starts at version
1 with no timestamp and an empty map; JSON omits the undefined timestamp. Saving
sets it to an ISO timestamp and writes indented JSON. `resources` maps stable
node ids to `ResourceOutputs`, each a string-keyed map of strings, numbers,
booleans or string arrays (ARNs, names, flags and reconciliation fingerprints).

`StateStore(s3, bucket, env, scope?)` uses `state/<env>.json` for the site and
`state/<env>.<scope>.json` for a plugin, in the **same** site bucket. Scope matches
`^[a-z0-9-]+$`; it changes only the key. A missing object returns empty state;
invalid JSON raises contextual failure. Parsed envelopes, resources and each
node output map must be non-array objects; version is a number, env is a string,
and updatedAt is absent/undefined or a string. Each output must be a string,
number, boolean or string array. Invalid shapes fail with the bucket/key and
field path, never an empty-state fallback. Validation preserves the parsed object
and unknown envelope fields, and adds no env-equality, version-range or timestamp
format requirement. `delete()` catches deletion errors.
See [state implementation](../../../packages/core/src/state.ts) and [tests](../../../packages/core/src/state.test.ts).

## Relationships and lifecycle

```text
site env --> OpsConfig + raw config document
              | plugin.configKey
              v
         validator --> pluginConfig --> feature consumer resolver
site bucket --> state/env.json (site outputs, readonly to plugin)
            --> state/env.plugin.json (plugin-owned OpsState)
                     resources[nodeId] --> ResourceOutputs
```

The site owns resource naming prefix `<env>-<siteName>` and `githubRole`
`<prefix>-gh`. Plugins read site outputs but record only their own map. Apply
persists after each node and on failure; destroy visits reverse dependencies,
removes each node's map entry and persists progress. Site teardown refuses while
any scoped key for that environment exists, including empty-state objects and
uninstalled plugins. The [architecture page](02-plugin-architecture.md) defines
the boundary and warning/refusal paths.

## Assumptions and open questions

**Assumptions**

- Installed packages are trusted code; AWS services and the ambient credential provider remain external dependencies.

**Decisions**

- *Scope.* **Internal implementation contracts.** These pages describe the integrated CLI and its bundled/on-demand features without promising a supported third-party SPI.
- *Rules of the road.* **Retain root DEVELOPMENT.md.** A second guidelines copy would drift.

**Open questions**

- Should PDS config become opaque to core once the direct post-deploy seam has a replacement?
- Should full JSON entity validation replace the current hand-written/JSON-parse boundaries? This schema adds no runtime enforcement.
