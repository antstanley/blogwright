# PDS publishing and lifecycle

**Status:** Implemented · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [overview](00-overview.md), [domain model](01-domain-model.md) and [development guidelines](../../../DEVELOPMENT.md).

## Responsibilities and public paths

`blogwright-pds` remains a default CLI dependency. Its package manifest declares
`blogwright.plugin: pds`; its default export is `Plugin<PdsConfig>`. Named
command exports remain available and `blogwright/rkey` still re-exports
`blogwright-pds/rkey`. No config file, package name, slug derivation or rkey/TID
vector changes in the plugin migration.

## Command contract

The six declared actions are keygen, login, init, sync, secret status and secret
delete. Their wrappers parse forwarded identifier/yes flags and call existing
functions with a `PdsContext`. Generic bootstrap/status/destroy are supplied by
the host because the plugin contributes nodes. Multi-word actions match before
the environment positional: `pds secret status staging` selects staging;
`--env` wins. `pds sync staging` selects staging and then intentionally refuses
because records use production URLs.

| Action | Behavior |
| --- | --- |
| `keygen [env]` | Generates OAuth key; stores private JWK and clears old session in Secrets Manager; writes public client metadata and JWKS under configured public directory |
| `login [env] --identifier <handle-or-did>` | Checks deployed/local client docs, emits authorization URL, accepts pasted callback, stores OAuth session; bare DID skips handle resolution |
| `init [env]` | Creates/updates publication, writes well-known verification and atproto data files; refuses a publication belonging to a different account |
| `sync [env]` | Production-only reconciliation of local posts and site.standard.document; reports created/updated/unchanged, warns without deleting remote records for removed local posts |
| `secret status [env]` | Shows metadata and which key/session parts exist, never values |
| `secret delete [env] --yes` | Immediate secret deletion with no recovery window; requires flag |

All dispatched PDS actions validate the pds block; keygen/login/init/sync also
need the site's domain. Public OAuth files must be committed and deployed before
login/init verification. A normal production deploy calls syncAfterDeploy
non-fatally; rollback does not sync and warns if production PDS is configured.
The [publishing guide](../../../docs/src/content/docs/guides/publishing-standard-site.md)
and [commands](../../../packages/pds/src/commands.ts) detail the operator flow.

## Context and config ownership

`PdsContext` is a Pick of core PluginContext<PdsConfig> containing env, domain,
config, ports, logger and optional tags, plus clients narrowed to `{secrets}`.
`PdsLogger` and `PdsPorts` alias core vocabulary. It excludes preview, names,
accountId and all six plugin-boundary fields. A plain OpsContext satisfies this
narrow shape; the full PluginContext requires adaptation. Tests retain the
single-client/two-port PDS fixture and structural assignments.

[validatePdsConfig](../../../packages/pds/src/config.ts) checks required nonblank
name, optional HTTPS resolver (URL syntax before protocol), and optional secret
character class. Missing/null pds reports the existing missing-section message.
It returns PdsConfig with secretName still optional; it cannot see siteName.
`resolvePdsSecretName(pds, siteName)` supplies explicit secretName or
`<siteName>/atproto`; `requirePdsConfig(ctx)` applies it and returns
ResolvedPdsConfig to commands/OAuth/secret consumers. The IAM node uses the same
resolver. [Domain model](01-domain-model.md) lists all four JSON fields.

Core preserves raw pds data but no longer validates/defaults it. Consequently
malformed PDS config does not reject unrelated built-in bootstrap/status/deploy;
a dispatched PDS command rejects it, and post-deploy sync errors warn. This
boundary change is user-visible despite unchanged config syntax.

The PDS node and direct command consumers still read the typed config.pds member;
the dispatch boundary nevertheless validates its raw key and provides
pluginConfig. This retained typed seam is specific to the production post-deploy
path, not an arbitrary-key escape on OpsConfig. No site resource node reads pds.

## Plugin IAM node

The plugin contributes `pds-oidc-policy` when pds and githubRepo are present and
env is not `preview`. Direct buildPdsNodes can return empty without pds; normal
dispatch rejects an absent pds block before reaching it. The preview exclusion
checks env, not preview flag, because generic plugin contexts carry preview=false.
Staging remains eligible; the default secret is site-wide and the preview role's
any-ref trust must never gain it.

The node has no intra-plugin dependencies. It requires the site's `gh-oidc-role`
recorded ARN before read/apply and obtains role name from `names.githubRole`
(`<env>-<siteName>-gh`). It lists inline policy names, creates/reapplies only
`blogwright-pds`, and records `{roleName, policyName}` under its node id.
The grant is GetSecretValue, PutSecretValue and CreateSecret on
`arn:aws:secretsmanager:<region>:<accountId>:secret:<resolvedName>-*`.

Update re-puts this document so changed secret names reconcile. Delete removes
only that named policy, is harmless when role/state/policy is missing, and never
deletes the site role or the PDS secret. The secret has a separate explicit
command. Plugin state is `state/<env>.pds.json`; the lifecycle runs through the
shared graph engine and its save closure, not the site store.

## Upgrade and teardown behavior

The additive migration notice shipped in v0.4.0-beta.0 and the published
v0.4.0-beta.2 tarball contains the plugin policy, as recorded in historical
release verification. The current site graph removes its PDS statement after
that release boundary; this closure task does not claim a fresh publication.
Operators using GitHub OIDC run `blogwright pds bootstrap <env>` once per eligible
stack before site bootstrap removes the old grant. A missing grant makes
post-deploy sync warn; plugin bootstrap repairs it.

Five migration effects remain explicit: the bootstrap instruction; new generic
lifecycle verbs; site teardown refusal while scoped PDS state exists; shorter
generated help; and PDS validation moving off unrelated built-ins. Site bootstrap
warns from scoped keys, naming the current-env plugin bootstrap. Never-bootstrapped
plugins have no key and receive no state-derived warning. Site destroy refuses
until `blogwright pds destroy <env> --yes` removes scoped state. Preserve the
config needed to rebuild the plugin node set until teardown is complete.

## Implementation and verification

[plugin.ts](../../../packages/pds/src/plugin.ts),
[context.ts](../../../packages/pds/src/context.ts),
[nodes.ts](../../../packages/pds/src/nodes.ts) and
[sync.ts](../../../packages/pds/src/sync.ts) own the boundaries above.
[Plugin tests](../../../packages/pds/src/plugin.test.ts),
[node tests](../../../packages/pds/src/nodes.test.ts),
[config tests](../../../packages/pds/src/config.test.ts),
[rkey vectors](../../../packages/pds/src/rkey.test.ts) and
[CLI context tests](../../../packages/cli/src/context.test.ts) retain dispatch,
argument, missing-input, grant-scope and structural-type evidence.

## Assumptions and open questions

**Assumptions**

- The AWS account, credentials and installed packages are operator-controlled.

**Decisions**

- *Scope.* **Internal implementation contracts.** No supported third-party SPI is introduced.
- *Ownership.* **Separate graphs and state keys.** Each feature reconciles its own resources through shared vocabulary and the CLI engine.

**Open questions**

- Should an afterDeploy hook exist once a second consumer needs it?
- Should PdsConfig remain a typed core member indefinitely?
- Should PDS gain shorter action aliases? None are implemented by this migration.
