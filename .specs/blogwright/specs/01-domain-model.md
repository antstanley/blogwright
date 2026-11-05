# JSON entities, identities and state

**Status:** Implemented · **Date:** 2026-11-05 · **Owner:** Ant Stanley · **Scope:** blogwright product

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

The account id in the state bucket name (`<env>-<siteName>-<accountId>`)
comes from `sts:GetCallerIdentity` for the resolved credentials
([AWS identity](08-aws-identity.md)); every other derived name uses the
`<env>-<siteName>` prefix alone. An environment's config document may carry
an `aws` block (`profile`, `accountId`), validated by core as site-owned
config like `ssr`. When it pins `aws.accountId`, a mismatch fails before
`StateStore.load`, so the state bucket is never derived from, read in, or
created in an unintended account.

The site owns resource naming prefix `<env>-<siteName>` and `githubRole`
`<prefix>-gh`. Plugins read site outputs but record only their own map. Apply
persists after each node and on failure; destroy visits reverse dependencies,
removes each node's map entry and persists progress. Site teardown refuses while
any scoped key for that environment exists, including empty-state objects and
uninstalled plugins. The [architecture page](02-plugin-architecture.md) defines
the boundary and warning/refusal paths.

An environment's config document may carry an `ssr` block. Core validates it
as site-owned config (like `microvm`, `seo` and `paths`), and the site graph
gains `web-log-group`, `web-local-log-group`, `iam-web-role`, `web-oac`,
`web-cache-policy`, `web-code-bucket-policy`, `web-function` and
`web-function-policy` nodes; the `bucket` node enables S3 versioning, and
`cloudfront-distribution` grows a second origin and per-behavior policies and
records the serving `mode` (`static` or `ssr`; absent means `static`). Web
Function outputs are recorded in `OpsState` under those node ids; deployment
manifests gain a `webFunction` object (`revisionId`, `revisionArn`,
`fingerprint`, `artifactKey`, `artifactVersionId`, `artifactSha256`,
`settings`, `endpointName`, `endpointDomainName`) so history and rollback can
name the revision a hash is pinned to and reproduce it. `settings` holds the
revision-scoped values the revision was created with (`entryPoint`, `env`,
`timeoutSeconds`, `maxConcurrencyPerEnvironment`). The object is written only
for a revision that is serving and verified, and an SSR manifest's `status`
is the outcome of the whole deploy, not of the build alone. The Web Function
placeholder revision created at bootstrap is registered in state like any
other node output; no plugin state is involved.

## Site domains

An environment's hostnames are `domain` (the **primary**) plus the optional
`aliases` list. `domain` may still be supplied with `--domain`; `aliases` is
config-file only. Existing configs without `aliases` behave exactly as before.
The primary is the canonical origin: the host used for `robots.txt` and
`sitemap.xml` URLs, PDS records and OAuth client metadata, and the redirect
target when `redirectToPrimary` is set.

Each alias is an independent fully-qualified hostname. It need not be a
sub-domain of the primary and may live in a different DNS zone or at a
different registrar.

`aliases` is validated at config load. Every entry is a lowercase ASCII
hostname with at least two labels, with no scheme, port, path or wildcard.
Entries are unique and none equals `domain`. The primary and aliases together
number at most 10, the default ACM per-certificate name quota. `aliases`
without `domain` is rejected.

`redirectToPrimary` is a boolean, default `false`. When `false`, every
hostname serves the same content and the site's own canonical URLs identify
the primary. When `true`, a viewer-request CloudFront Function answers any
request whose `Host` is an alias with a `301` to the same path and query on
`https://<domain>`. The status is `301`.

`manageDns` is a boolean, default `false`. When `true`, the bootstrap creates
the validation and routing records itself for every hostname whose hosted
zone is in the account's Route 53, and prints guidance for the rest (see DNS
guidance).

In a preview environment, `aliases`, `redirectToPrimary` and `manageDns` are
rejected at config load with a message that the preview stack serves one
wildcard host.

## Certificate and validation

The certificate is one DNS-validated ACM certificate. CloudFront accepts one
certificate per distribution, so it covers every name: the primary is its
`DomainName` and every other name is a subject alternative name. The
**desired name set** is the primary, the configured aliases, and any
attached alias that config does not name and the operator has not pruned.

The `acm-certificate` output records `arn` and `domains`, the sorted desired
name set the certificate was requested for. On every run the certificate node
compares `domains` with the desired set. A mismatch requests a replacement
certificate rather than editing the existing one, because ACM cannot change
the names on an issued certificate. The idempotency token is derived from the
site name, the environment and a short hash of the sorted name set, so a
changed set requests a new certificate and an unchanged set reuses the
existing one. The old certificate stays attached and serving until the
replacement is `ISSUED` and the alias reconcile has attached it; only then
is the old certificate deleted. A failed or interrupted replacement leaves
the old certificate in place.

ACM returns one validation record per name, and a record is per hostname,
not per certificate. Records already satisfied for a name, such as an apex
validated by an earlier certificate, are not reprinted. Production does not
manage DNS: the bootstrap prints, grouped by hostname, each validation CNAME
that is still missing and waits for `ISSUED`. Preview stacks keep creating
their single validation record in Route 53.

## CloudFront aliases

The production distribution's alias list is `[domain, ...aliases]` plus any
retained undeclared alias, and its viewer certificate is the multi-name
certificate. The reconcile reads the live alias list and compares it with the
desired set order-insensitively, so a run with no drift changes nothing and
re-running `bootstrap` never drops an alias.

Drift is detected in both directions. A configured name missing from the
distribution is attached. An attached alias that config does not name is
reported with a warning that names it and says how to prune it, and it stays
attached, with the certificate still covering it. As today, an absent
`domain` never removes aliases from a live distribution.

Removing an alias is explicit and is never a side effect of editing config.
`blogwright bootstrap --prune-aliases` detaches every attached alias that
config does not name, requests a certificate for the narrower set, and
deletes the old certificate once the replacement is attached.

## DNS guidance

After the alias reconcile, the bootstrap prints the final routing record for
every hostname, pointing at the distribution's CloudFront domain. A zone
apex needs an ALIAS or ANAME record, or A and AAAA records at a DNS host that
cannot flatten a CNAME at the apex. Any other host, such as `www`, can be a
plain CNAME.

The bootstrap decides which case applies by asking DNS. For each hostname it
queries the SOA record at the host and then at each parent in turn, dropping
the leading label each time. The first name that answers with an SOA starts
a run; the run continues up through parents that answer with an identical
record and ends at the first that does not, and the highest name in the run
is the zone apex. The run matters because a resolver follows a CNAME when
asked for SOA, so a `www` that is a CNAME to the apex answers with the
apex's record and must not be taken for an apex itself. A host equal to the
apex is an apex. Using DNS rather than a
suffix list means a host under a multi-label public suffix such as
`example.co.uk` is classified correctly. If no name answers, as for a domain
not yet delegated, the bootstrap prints both the apex and the sub-domain
form for that host and says why.

The queries go to the system resolver first. If the system resolver fails to
answer (a timeout, `SERVFAIL`, `REFUSED` or a connection error), the same
query is retried once against public resolvers (`1.1.1.1`, then `8.8.8.8`).
A definite negative answer (`NXDOMAIN` or no SOA at that name) is not a
failure and does not trigger the fallback; the walk simply moves to the
parent.

By default the bootstrap creates none of these records, because the zone is
often at a registrar blogwright cannot reach. With `manageDns: true`, the
bootstrap looks for a Route 53 hosted zone that contains each hostname,
trying the host and then each parent. For a host with a zone it upserts the
A and AAAA alias records and any ACM validation CNAME there, as the preview
stack does. A host with no zone in the account is not an error: it falls
back to the printed guidance, so one site can mix Route 53 and registrar
hosted names.

## Path redirects

`redirects` is an optional list of path redirects in the environment's config
file. Each entry has `from` and `to`, and an optional `status`:

```jsonc
"redirects": [
  { "from": "/about.php", "to": "/about/" },
  { "from": "/old-blog/*", "to": "/news/:splat", "status": 301 }
]
```

`status` is `301` by default and may be `301`, `302`, `307` or `308`. `to` is
either a path on the same host, beginning with a single `/`, or an absolute
`https://` URL. Both `from` and `to` are printable ASCII with no whitespace;
any other character is written percent-encoded. A site with no `redirects`, or an empty list, runs a router
function byte-for-byte identical to one without the setting.

**Matching.** A redirect matches against the URI the viewer requested, before
the directory-index rewrite, case-sensitively and without decoding, so `from`
is written as the viewer sends it. A trailing slash is not significant: `from`
is stored without one (the root `/` excepted) and a request for `/a` or `/a/`
matches `/a`. A `from` ending in `/*` is a prefix match. It matches the prefix
with or without a trailing slash and any path beneath it, and the rest of the
path (empty when none) replaces `:splat` in `to`. An exact `from` wins over a
prefix `from`, and among prefixes the longest wins. `:splat` is valid only in
the `to` of a prefix redirect, and at most once.

**Query string.** The request's query string is carried over unchanged, using
the same handling as the alias redirect. If `to` already contains a query, the
request's query is appended to it with `&`. `to` and `from` may not contain a
fragment, and `from` may not contain a query.

**Validation.** `redirects` is validated before any AWS call: the shape rules
at config load, and the rules that need the effective primary domain, the
serving mode or the stack kind at context creation. `from` begins with `/` and has no scheme, host, query or fragment, and at most
one `*`, which must be the final segment. After the trailing slash is
removed, no two entries share a `from`. `to` is a path or an `https://` URL
with a host. A redirect whose `to` is its own `from` is rejected, and so is a
two-entry loop in which each entry's `to` is the other's `from`. A prefix
redirect whose `to` falls beneath its own prefix (`/docs/*` to
`/docs/v2/:splat`) is rejected too, since its own output matches it again.
Longer cycles are not detected. `status` is one of the four allowed codes. The list holds at
most 500 entries, and the compiled router function source must fit the
CloudFront Function limit of 10,240 bytes; a map that does not fit fails with
the compiled size, the limit and a count of entries, and says to shorten the
map or move redirects to the application.

**Hosts.** A path redirect applies to every hostname the environment serves.
A relative `to` answers a relative `location` on the host that was requested.
When `redirectToPrimary` is set and the request is for an alias host, the
path redirect is evaluated first and answers a single redirect to the final
URL on the primary host: `https://<domain><to>` for a relative `to`, or `to`
itself when it is absolute. An alias request whose path has no redirect
answers the alias host redirect as before.

**Previews.** `redirects` is rejected at context creation in a preview
environment, with a message that the preview host router does not apply
redirects. A preview answers `403` for a path that production redirects.

## Alias redirect

When `redirectToPrimary` is `true`, the alias redirect composes with the
existing router function. A distribution allows one function per event type,
so the redirect is not a second function: the router function's source gains
a host check ahead of its directory-index rewrite, and the combined function
stays the single viewer-request association. When `redirectToPrimary` is
`false` the router function's source is unchanged.

The router function holds the path-redirect check, then the alias host check,
then the directory-index rewrite, in that order. A distribution allows one
function per event type, so these stay one function. When `redirects` is
empty and `redirectToPrimary` is `false`, the source is the directory-index
rewrite alone.

## Router function publication

The router function's source is generated from config: it varies with the
alias redirect and the path redirects. The `cloudfront-function` output
records `codeHash`, the SHA-256 of the source last published. A reconcile
compares the hash of the source the config now produces with `codeHash` and
republishes only on a difference, so a run with an unchanged config changes
nothing.

`bootstrap` reconciles the function as part of the resource graph. A
`deploy`, static or SSR, reconciles it too, holding the environment lock and
after the new site content is live, so a redirect to a new page never answers
before the page exists; it records the new `codeHash` in state. The reconcile
does not invalidate the cache: the function runs on the viewer request, ahead
of the cache. A stack with no `cloudfront-function` output is not
bootstrapped: `deploy` says so and does not create the function. If the
publish fails, the deploy fails after the content is live, naming
`blogwright bootstrap <env>` as the way to retry. `rollback`, `stage` and
`promote` do not touch the function, because redirects belong to the
environment's config and not to a release. The deploy summary reports whether
the redirect function was republished or unchanged, and the count of
redirects in it. `preview deploy` and the preview router are unchanged.

A deploy publishes code only; it never edits the distribution. A static
distribution always has the function associated, so a deploy is enough there.
An SSR distribution associates it only when the config needs it, and that
association is made by `bootstrap`. The distribution's recorded output notes
whether the router is associated; when the config now needs it and the
record says it is not, `deploy` warns that redirects are not live until
`blogwright bootstrap <env>` runs, as it does for an unattached response
headers policy.

## Assumptions and open questions

**Assumptions**

- Installed packages are trusted code. AWS services, the shared AWS config files and the AWS CLI (for sign-in) remain external dependencies.

**Decisions**

- *Scope.* **Internal implementation contracts.** These pages describe the integrated CLI and its bundled/on-demand features without promising a supported third-party SPI.
- *Rules of the road.* **Retain root DEVELOPMENT.md.** A second guidelines copy would drift.

**Open questions**

- Should PDS config become opaque to core once the direct post-deploy seam has a replacement?
- Should full JSON entity validation replace the current hand-written/JSON-parse boundaries? This schema adds no runtime enforcement.
