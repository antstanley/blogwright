# Integrated specification closure — 2026-09-05

**Status:** Implemented; independent validation follows · **Owner:** Ant Stanley · **Task:** 63

This report records current conformance against the integrated code. It does not
rewrite historical certificate verdicts, claim a newly published release, or treat
transport mocks as live AWS evidence. Runtime tasks59/60/62/64/65 are integrated; final gates run on that combined tree.

## Scope and evidence boundary

The three linked July change specs and the analytics-owned-log-groups amendment
are reconciled into [current internal specifications](../blogwright/README.md),
the [JSON schema](../blogwright/specs/canonical-types.schema.json), root
[README](../../README.md), [DEVELOPMENT](../../DEVELOPMENT.md), the
[CLI reference](../../docs/src/content/docs/reference/cli.md), and
[analytics guide](../../packages/analytics/README.md).

The internal SPI remains unversioned and unsupported as a third-party API.
Callable interfaces are source/prose contracts; no fake JSON function schema is
introduced. The sidecar distinguishes on-disk config from resolved projections.
Root DEVELOPMENT.md remains the rules-of-road source. Documentation-only changes
need no changeset under its Definition of done; runtime tasks carry their own.

## Source requirements and current counterparts

| Required group | Current code/test evidence | Canonical artifact / resolution |
| --- | --- | --- |
| Plugin/context/logger/ports/command/manifest vocabulary; generic never/unknown and readonly site state | core/src/plugin.ts + plugin.test.ts; cli/src/context.test.ts | Plugin architecture §§Plugin and command contract, PluginContext; schema PluginManifest |
| Two scoped state surfaces; record/save closure; graph vocabulary and engines | core/src/state.ts/state.test.ts; cli/src/plugin-commands.ts/plugin-commands.test.ts; graph.ts/graph.test.ts | Domain model §§OpsState, Relationships; architecture §Graph engine |
| Raw config preservation, selected-plugin validation/defaulting, config isolation | core/src/config.ts/config.test.ts; cli/src/plugins.ts; context.test.ts | Domain model config phases; architecture §PluginContext |
| Two-origin discovery, real loader, nameless manifest traversal, collisions and lazy dispatch/help | cli/src/plugins.ts/plugins.test.ts, adapters/node-module-loader.ts + tests, cli.ts/cli.test.ts | Architecture §§Discovery, Invocation |
| PackageManagerFactory before AWS/config, package add/list/remove and refused noninteractive node removal | cli/src/cli.ts; plugin-commands.ts + tests; process-package-manager adapter + tests | Architecture §Invocation; CLI plugin management reference |
| Textual JSONC contributor/splice, precedence and collision rejection | cli/src/config-block.ts/config-block.test.ts, init.ts/init.test.ts, plugins.test.ts | Architecture §Invocation; CLI init docs |
| Independent lifecycle; same-env state warnings and guarded site/preview teardown | cli/src/commands.ts/commands.test.ts, plugin-commands.ts + tests | Architecture §Graph engine; CLI bootstrap/destroy/preview teardown |
| Descriptor endpoint/signing/escaping/error identity and shared us-east-1 signer | core/src/aws/endpoint.ts/endpoint.test.ts, signer.ts/signer.test.ts; clients.ts; analytics/aws/clients.test.ts | Architecture §Plugin AWS service seam |
| PDS default dependency/manifest/export, six actions, narrow context, unchanged rkeys | pds/package.json, index.ts, plugin.ts/plugin.test.ts, context.ts; rkey.test.ts; cli/context.test.ts | PDS §§Responsibilities, Command, Context |
| Raw PDS validation, optional secretName, shared siteName consumer default | pds/src/config.ts/config.test.ts, sync.ts; core/config.ts | Domain model PdsConfig/ResolvedPdsConfig; PDS §Context |
| Named PDS policy, preview exclusion, derived githubRole; no site PDS config branch | pds/src/nodes.ts/nodes.test.ts; core/config.ts; cli/nodes.ts/nodes.test.ts | PDS §Plugin IAM node; task59 integrated |
| Additive release boundary, post-deploy sync, five operator migration effects | Historical release review; pds/commands.ts and cli/commands.ts/cli.test.ts | PDS §Upgrade; consumer CLI/README; task60 warnings integrated |
| Optional analytics config/manifest/commands/init with environment-derived sealed overrides | analytics/src/plugin.ts, config.ts + tests | Analytics §§Responsibilities, region; domain model AnalyticsConfig/ResolvedAnalyticsConfig |
| Four plugin AWS clients and shared primary/us-east-1 transport | analytics/src/aws clients/tests | Analytics §Data path |
| Twenty columns, partition, field selection, hashing/bots, ProcessingFailed envelope and error storage privacy | analytics/src/schema.ts/schema.test.ts, transform/map-record.ts/handler.ts and tests | Domain model PageView; analytics §Record transformation; consumer privacy disclosure |
| Transform bundle, source hash, independent code/config reconcile and bounds | analytics/src/transform-hash.ts + tests, nodes.ts/nodes.test.ts | Analytics §Reconciliation |
| Fourteen-node graph, table/catalog/salt/roles/error bucket/stream/destinations, shared-source guards | analytics/src/nodes.ts/nodes.test.ts; cli/nodes.ts/nodes.test.ts; core/aws/logs.ts/logs.test.ts | Analytics §§Fourteen resource nodes, Reconciliation, Observability |
| Owned log groups, retention and stream re-ensure, IAM fifth statement, live logging guard and in-place updates | analytics nodes/firehose client + tests; core LogsClient.ensureLogStream + tests | Analytics §Observability; beta.3 amendment preserved |
| Bounded transform mapping/drop and salt-read diagnostics | analytics/src/transform/diagnostics.ts, handler.ts, adapters/transform-diagnostics.ts and tests; entry.ts wiring | Analytics §Observability; task64 integrated and independently reviewed, original promise implemented |
| State JSON shape validation with compatible existing envelopes | core/src/state.ts/state.test.ts validateState and boundary/compatibility tests | Domain model §OpsState; task65 integrated and independently reviewed, DEVELOPMENT boundary enforced |
| Readonly dashboard, named parameterized queries, supplied credentials, ports and prebuilt app | analytics/src/server.ts/server.test.ts, queries.ts/queries.test.ts, adapters/* tests, app/ | Analytics §Dashboard, domain query row types in prose |
| Backfill conservative createdDay, whole-day range, same mapper/salt, occupied-day skip, transactions and boundary loss | analytics/src/backfill.ts/backfill.test.ts, nodes.ts/nodes.test.ts, adapters/duckdb-ingest.test.ts | Analytics §Optional backfill; task62 request-time midnight fix integrated |
| Source closures, schema/entity coverage, six current gates and retired planning checks | This report and retained retirement README | Final evidence recorded below after integrations |

All code paths above are relative to packages/. Source-spec historical Implementation
notes retain proposal-era line numbers and migration ordering; current canonical
links name files/symbols instead. Source contradictions about PDS defaulting and
PackageManager placement are corrected in their original blocks. Both source
specs also name PDS's specific typed-config compatibility exception, justified by
the preserved narrow PdsContext/direct post-deploy requirement, while keeping
site graph nodes free of plugin configuration. These are not hidden by a
contradictory appendix. Analytics privacy is table-specific and preserves required
ProcessingFailed original-record storage.

## Every merge-plan step

| Source | Step | Concrete artifact / evidence |
| --- | --- | --- |
| Plugin system | 1 | Plugin architecture covers every Proposed changes block: SPI/context/config/state/topography/service seam/record/graph/discovery/collisions/management/init/lifecycle/ports |
| Plugin system | 2 | DEVELOPMENT ports table has ModuleLoader and PackageManager; factory seam clarified in architecture and source |
| Plugin system | 3 | canonical-types.schema.json $defs.PluginManifest; domain model §PluginManifest |
| Plugin system | 4 | Merged source under changes/merged/ with Merged header and 2026-09-05 date, after64/65 integration and canonical reconciliation |
| Plugin system | 5 | Final index removes pending entry and links merged history |
| PDS migration | 1 | PDS page covers manifest/export/context/config/IAM/site-branch removal/bootstrap warning/core-default removal/dispatch/post-deploy; CLI reference covers five upgrade effects |
| PDS migration | 2 | Schema PdsConfig plus ResolvedPdsConfig projection; domain model explicitly separates validator and resolver |
| PDS migration | 3 | DEVELOPMENT feature-package rule names manifest discovery and narrow PDS structural seam |
| PDS migration | 4 | Merged source under changes/merged/ with Merged header and 2026-09-05 date, after64/65 integration and canonical reconciliation |
| PDS migration | 5 | Final index removes pending entry and links merged history |
| Analytics | 1 | Analytics page covers all Proposed changes, including current fourteen nodes and owned observability; replaces historical no-canonical-target disposition |
| Analytics | 2 | Schema AnalyticsConfig and PageView plus resolved JSON projection; every entity/field explained in domain model |
| Analytics | 3 | DEVELOPMENT records Vite/SvelteKit and AnalyticsQuery/AnalyticsIngest ports; rolldown includes transform |
| Analytics | 4 | DEVELOPMENT five package directories plus private docs; README lists analytics and four fixed publishable packages |
| Analytics | 5 | Historical task61 merge remains 2026-08-31; this task folds canonical coverage without changing its merge date |
| Analytics | 6 | Index links existing merged analytics history and current canonical page |
| Owned log groups | 1 | Historical task01/PR27 supersession retained; current transform role lacks CreateLogGroup and owned nodes provide both groups; no new remote action claimed |
| Owned log groups | 2 | Existing merged analytics amendment retained; canonical analytics node/observability/region sections fold both sources together |
| Owned log groups | 3 | Historical amendment refreshed its then-current line references; new canonical links use current files/symbols to avoid implying those historical lines are current |
| Owned log groups | 4 | No JSON entity delta; no retention knob invented. Existing analytics entities fold into the canonical schema |
| Owned log groups | 5 | No original DEVELOPMENT change required; current toolchain/ports/count corrections come from analytics/plugin merge steps |
| Owned log groups | 6 | Historical Merged header/date 2026-09-01 retained |
| Owned log groups | 7 | Index retains merged amendment and points to current fourteen-node canonical implementation |

## Historical grouped coverage reconciliation

The [historical appendix](../plans/2026-07-26-plugin_system_and_analytics/reviews/2026-09-05-historical-coverage.md)
was read as a review of old evidence, not rerun certificate discharge. Original
certificates were not edited or read during this implementation task.

| Historical row | Evidence handling and current closure |
| --- | --- |
| 01 D2 | Real-export positive pluginConfig.foo and negative config.foo compiler probe recorded below; a source comment alone is not negative evidence |
| 01 D3 | Historical O3 groups both state-surface/record isolation and destroyGraph deletion; current context/plugin/graph suites exercise these boundaries |
| 05 D2 | Historical O3 includes real loader/exports contrast; current real-loader tests remain in the full suite |
| 08 D5 | Fresh source inspection finds exactly one exported cliPackageDir() in cli/src/context.ts; production callers import it and plugins.ts does no executable import.meta self-location |
| 08 D7 | Historical O6 killed nameless-manifest guard mutation; current adapter and dual-package discovery tests remain |
| 08 D8 | Historical O6 killed direct package.json-subpath resolution with real integration cases; current real-loader suite remains |
| 10 D4 | cli/src/plugin-commands.test.ts has “calls discover with all three arguments ... bundled ... only blogwright”; cli.test.ts bundled-only dispatch and source discover(repoRoot, cliPackageDir(), ports) close the grouped omission |
| 17 D1 | Historical inherited-findings paragraph proves no-context listing; current main management tests and built help/list checks exercise the surface |
| 27 D4 | Historical O4 negative narrowing proof remains historical; current PDS config tests and downstream typecheck cover optional secretName |
| 29 D2 | Current cli.test.ts contains pds sync staging and pds secret status staging; final full suite includes both |
| 31 D7 | Historical independent 54-pair request proof remains historical; current signer tests retain S3/logs equivalent-descriptor byte identity |
| 58 D4 | Current merge-step table supersedes old no-canonical-target disposition; analytics stays historically merged at task61 |

Task20 remains a scoped delta certificate with its original COMPLETENESS DONE
verdict for C1–C5; it is not expanded into fabricated historical obligations.
Task58 remains historically PARTIAL with O4/O6 unsatisfied. Task63 now owns its
outstanding canonical documentation, schema, conformance and merge work, with
runtime prerequisites59/60/62 and the additional64/65 fixes. Historical checked
boxes are not current closure evidence.

## Planning gate retirement

Root ran the unchanged proposal-era checker on integrated59/60/62 immediately
before removing its executable duplicate transcriptions. Exact retained evidence:

```text
PASS: 29 claims held (12 compiled positives, 17 pinned compile-errors) against the repo's TypeScript.
```

Exit 0 on 2026-09-05, Node24.19.0, jj change krvxmzqk. The checker remains reachable
in commit55c2f0f5dcbc5ae26b302c7924c29553415b5dd3, while the final tree keeps only
[type-claims/README.md](../plans/2026-07-26-plugin_system_and_analytics/type-claims/README.md).
This is root-executed pre-retirement evidence, not a claim that a deleted command
ran on the final tree. Ordinary build/typecheck/tests are the enduring checks.

## Fresh verification

Executed 2026-09-05 with PATH prefixed by `/private/tmp/blogwright-tools`,
Node24.19.0 and pnpm11.21.0, in `/private/tmp/blogwright-complete-63`.
The checked documentation/source snapshot is jj change `koqpyurupkus`, commit
`50a7b5f0a8e3b4debb72d661781f7d93514d501a`, on integrated parent
`ea3c75ea` (vtyyvutk). Only this evidence report was completed after those gates;
the final handoff identifies its resulting snapshot. Runtime prerequisites
59/60/62/64/65 were already independently reviewed and integrated before these
fresh checks. This run does not inherit their earlier passing counts.

| Gate | Fresh result | Log in /tmp |
| --- | --- | --- |
| `pnpm build` | Exit0; core/PDS/build-agent/analytics transform+dashboard/CLI/docs built | blogwright-task63-final-build.log |
| `pnpm typecheck` | Exit0; TypeScript and svelte-check,0Svelte errors/warnings | blogwright-task63-final-typecheck.log |
| `TZ=America/New_York pnpm test` | Exit0;1617passed,1skipped across78passing test files and1skipped file | blogwright-task63-final-test.log |
| `pnpm lint` | Exit0;30existing warnings (core no-delete-property and CLI test no-shadow), no errors | blogwright-task63-final-lint.log |
| `pnpm exec oxfmt --check .` | Exit0;207matched files formatted correctly | blogwright-task63-final-format.log |
| `pnpm knip` | Exit0; no unused-code/dependency findings | blogwright-task63-final-knip.log |

Test totals by package: core220passed/1skipped; build-agent27; PDS150;
analytics835; CLI385. The skip is the opt-in integration fixture, not a suppressed
new failure. Typechecking still includes shipped declarations and source tests;
no proposal-era duplicate checker remains. Task63 introduces no runtime assertions
or behavior changes, only documentation/schema and one source-comment link repair.
The new runtime assertions in64/65 carry their separately reviewed negative-control
evidence; this documentation task does not fabricate new mutation experiments.

### Exported-type positive and negative probe

Ran `node /private/tmp/blogwright-exported-type-probe.cjs /private/tmp/blogwright-complete-63`.
The temporary probe uses the CLI's actual tsconfig and the built
`blogwright-core` export with virtual source; it copies no interface and suppresses
no diagnostic. Exact output:

```text
positive: import type { PluginContext } from 'blogwright-core';
declare const ctx: PluginContext<{ foo: string }>;
const value: string = ctx.pluginConfig.foo;
PASS positive: expected diagnostics []
negative: import type { PluginContext } from 'blogwright-core';
declare const ctx: PluginContext<{ foo: string }>;
const value: string = ctx.config.foo;
TS2339: Property 'foo' does not exist on type 'OpsConfig'.
PASS negative: expected diagnostics [2339]
```

### Built artifacts and links

The built CLI ran from a temporary consumer containing only a package.json
`blogwright` dependency and a repo marker, with no config or node_modules.
`--help` exited0 and showed all six PDS publishing actions plus generic
bootstrap/status/destroy. Bare invocation printed usage and exited1.
`plugin list --plain` exited0 and printed
`pds blogwright-pds 0.4.0-beta.3 pds`; an unknown PDS action exited1 with action
help. These are fresh real-loader bundled-only checks, not just fake-loader tests.
The installed tarball/runtime version remains beta.3; no release was published.

Built docs inspection covered the rendered CLI/configuration/PDS guide content:
management/removal semantics, PDS bootstrap/migration and analytics configuration
appear in the HTML. All18built HTML pages were parsed;1074local hrefs and fragment
anchors resolve, with0missing. This is built HTML/content/anchor verification,
not a claimed browser screenshot review. The source Markdown path scan checked
684non-certificate local references with0missing. Root separately checked719local
spec Markdown links including certificates with0missing; certificate contents
remained outside this implementer's read scope. Independent validation repeats it.

### Schema and source conformance

Ran `/private/tmp/blogwright-schema-venv/bin/python /tmp/blogwright-schema63.py`
against this workspace, using jsonschema4.26.0. Draft2020-12 meta-validation and
all local `$ref` resolution passed. Each of eight entities accepts its positive
fixture and rejects an adjacent invalid one: uppercase manifest namespace;
blank PDS name; missing resolved secretName; dashboard port1023; incomplete
resolved analytics config; PageView with raw c-ip; state missing env; nested
object as a ResourceOutputs value. No schema validator is added to the product.

All supplied fields and required/optional sets from the three source fragments
match the canonical PluginManifest/PdsConfig/AnalyticsConfig/PageView definitions.
Built PAGE_VIEWS_COLUMNS independently matches all20schema properties and5required
columns. Every schema definition is described in the domain model, and every
internal page/schema is indexed. TypeScript private symbols and callable methods
remain prose/source contracts, not JSON entity claims.

Importing the built analytics node factories yields14nodes; the real CLI topoSort
accepts their dependency graph. TypeScript AST inspection finds one exported
cliPackageDir function in context.ts and no import.meta expression in plugins.ts;
production dispatch calls `discover(repoRoot, cliPackageDir(), ports)`. Ordinary
CLI/context/plugin tests include bundled dispatch, separate state surfaces,
config validation, state-key warnings, environment remedies and PDS staging
positionals. Source inspection confirms the site node graph has no PDS branch.

The two pending proposals now have Merged headers/dates and reside under
changes/merged/. Incoming/outgoing references outside plan-owned files were fixed;
root had repaired plan-owned references. Analytics and its owned-log-group
amendment retain their historical merge dates. The requirement and merge-step
tables above have no remaining required gap; the independent validator determines
the final task verdict separately.

### Evidence log identities

These temporary logs retain full command output; the passing results and essential
negative-type evidence above are durable even after workspace cleanup.

| /tmp log | SHA-256 |
| --- | --- |
| blogwright-task63-final-build.log | `ff0080b3f65d6c7b58855917ce6defd42417e884bcbf2d4fc6a049f6e74e472e` |
| blogwright-task63-final-typecheck.log | `e88fecb340b7242f4071e4122a3f893d9daa5104d3e4b506aef20cd6017edade` |
| blogwright-task63-final-test.log | `5f6ae8a824ef21b70e35f7c79501500aa25eae5f23f62185f45a0e5879072dfd` |
| blogwright-task63-final-lint.log | `62d69ddc7e4d20b7ef867875fa80a8bbad8b8eea4fa3355acb24d3d5554adc88` |
| blogwright-task63-final-format.log | `d980b51e9ffb9f7238fa0e58d38c472fd85336713468beef2a13e5453a8e1568` |
| blogwright-task63-final-knip.log | `daa78c62defd32cfe45e8193016880c25efa2229e923d0018ab14d0f327f4a65` |
| blogwright-task63-final-exported-types.log | `cb08c2f6bb159a578c2849b23da0108476390a156d4a96eadf76e88f1942eecc` |
| blogwright-task63-final-built-cli.log | `2f4cc7d142f94a4e814be8a6710b7f75b195ab41d7e9a2ec2cfd97edb335856b` |
| blogwright-task63-final-built-docs.log | `3eb50d4bc3e2510eea322d8147db40417610823196105b8f62e688eafa23eddb` |
| blogwright-task63-final-links.log | `5f9da11163fd45814ac5925ed0a95f48de63d086ce3a627be43bd9beee8cff8f` |
| blogwright-task63-final-schema.log | `3819f79b137c592a7d5fcd5088a78c2acddba73c6f2783ca193c5bba541ad34d` |
| blogwright-task63-final-conformance.log | `61e7d5d631090c805b6de2e7cbe9621353d83f1734f412561ebaed3df3ac49e6` |

## Open questions and boundaries

All open questions are carried in canonical closing blocks: supported SPI/version
compatibility, preview extraction/hooks, PDS core typing/aliases, scoped-name
discovery, table retention/shared Glue cleanup, configurable group retention,
complete destination drift comparison, build-role logging grants and status
prominence. Mapper seconds/fractional-number limits and backfill day-level,
single-operator assumptions are explicit. None is invented as a shipped API.
Required diagnostics/state validation were implemented by64/65 and integrated,
not downgraded into open questions.
