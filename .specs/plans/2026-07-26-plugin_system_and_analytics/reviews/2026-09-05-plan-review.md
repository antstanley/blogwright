# Plan/spec coverage review — 2026-09-05

## Premises

P1: The three linked change specs require the plugin SPI/dispatch/state, PDS migration, analytics pipeline/dashboard/backfill and their documentation closure.
P2: Code is in packages/core, cli, pds and analytics; the reviewed original base was 3d47969, then the build baseline advanced to published beta.3 03e40d06, preserving the owned-log-groups amendment.
P3: Completion requires every required behavior and merge step, with a task and evidence; historical Done folders do not discharge later amendments.

## Requirement extraction and implementation resolution

Resolution started at the module named by each spec, then the package, then dependencies if needed. A matching implementation stopped the search. These groups cover Proposed changes, Type changes, Implementation notes and Merge plan sections; the sources remain the detailed field-level authority.

| Source requirements | Counterpart / evidence | Tasks | Review result before build |
|---|---|---|---|
| Plugin contract, manifest, context, readonly site state, plugin state/save/record | core/plugin.ts, core/state.ts, cli/plugin-commands.ts context adapter | 01–04,10,16 | Present |
| Config document preservation, plugin validation/init | core/config.ts, cli/plugins.ts resolvePluginConfig, config-block.ts/init.ts | 07,12–14,19,27 | Present |
| Discovery, namespaces, two-origin module resolution, longest action, help | cli/plugins.ts, cli.ts, node-module-loader.ts | 05,08–11,17 | Present; current grouped-proof checks assigned63 |
| Package management without AWS/config | cli/plugin-commands.ts and main PackageManagerFactory | 06,18,20 | Present; stale Ports.packages instruction corrected |
| Shared status/graph lifecycle and site/preview teardown guard | cli/graph.ts, commands.ts, plugin-commands.ts | 02,15–16 | Present |
| Plugin-supplied services and shared us-east-1 signer | core/aws/endpoint.ts, signer.ts, clients.ts | 31,38 | Present |
| PDS package/default export/six commands/context/rkey/default dependency | pds/package.json, index.ts, plugin.ts, context.ts; cli/rkey.ts | 21–26,29 | Present |
| PDS config ownership, optional secretName, resolved consumers | pds/config.ts, sync.ts, core/config.ts | 21–22,27–28 | Present; raw-only validator/default-resolver spec contradiction corrected |
| PDS named IAM policy, derived githubRole, preview exclusion | pds/nodes.ts, core/config.ts deriveNames | 23,25,27 | Present |
| Site graph removes PDS knowledge | cli/nodes.ts oidcRolePolicyStatements | 59 | Missing (parked implementation must be adapted and reverified) |
| Bootstrap warns from scoped keys after reconcile, no plugin discovery, same exit status | cli/commands.ts bootstrap | 60 | Missing; same-env remedy and listing-error behavior made explicit |
| PDS post-deploy sync, migration notice/validation timing/help | pds/commands.ts, cli/commands.ts, changelog, tests | 28–30 | Present; public CLI reference closure assigned63 |
| Analytics optional package, config, manifest, init and commands | analytics/package.json, config.ts, plugin.ts | 32,44,47 | Present |
| Four plugin AWS clients and pinned shared clients | analytics/aws/*, core/clients.ts | 33–38 | Present |
| Shared columns, required fields, day partition, exclusions, mapping, salted keys, bot flag, envelope | analytics/schema.ts, transform/* | 39–42 | Present; universal raw-IP claim contradicted required ProcessingFailed storage and is corrected to table-only |
| Transform bundle/source hash/deployment | analytics/transform/rolldown.config.ts, transform-hash.ts, nodes.ts | 43,50 | Present |
| Table/catalog/salt/roles/stream/error bucket/destination/delivery and shared-source guards | analytics/nodes.ts, cli/nodes.ts, core/aws/logs.ts | 48–54 | Present; fourteen-node beta.3 amendment preserved |
| Named queries, credentials, DuckDB query/ingest ports, read-only local server, prebuilt app/status | analytics/queries.ts, ports.ts, adapters/*, server.ts, commands.ts, app/ | 45–46,55–57 | Present |
| Backfill whole-day bounds, identical mapping, transactions, occupied-day idempotency | analytics/backfill.ts and nodes.ts createdDay | 53,61,62 | Partial: first CreateDelivery response crossing midnight sampled too late; fix62 |
| Canonical pages/schema, public docs, all spec merge steps, open questions | .specs/, README, DEVELOPMENT, CLI/analytics docs | 20,30,58,61,63 | Partial; final owner63, never inherit historical PARTIAL58 as DONE |
| Compile-time planning guarantees and gate retirement | type-claims and exported-type tests | 00,63 | Explicit final run/proof/retirement owned63 |

## Findings and remediation ownership

1. Added missing scheduler edge30→59 and independently verified publication. Removed advice that only an old O5 needs rechecking after adaptation.
2. Reauthored59/60 with exactly matching fresh certificates and all six gates. Warning/removal release order is coherent; final merge ownership moved to63.
3. Removed obsolete analytics-pending and task58-plugin-merge instructions from current plan; preserved old plan and certificates as history. Historical cardinality differences mapped in [reconciliation](2026-09-05-historical-coverage.md), with remaining proof explicitly in63.
4. Added62 for conservative initial delivery day, including negative control across midnight and backfill regressions.
5. Added63 for previously unassigned canonical docs/schema, CLI/reference/README corrections, privacy disclosure, complete merge-step accounting and type-claim retirement.
6. Corrected source contradictions without changing working behavior: raw-only PDS validator versus siteName-aware default resolver; PackageManagerFactory versus unused Ports member; internal canonical docs versus public SPI support; table privacy versus intentionally retained failure records.

## Release prerequisite evidence

Read-only network checks on 2026-09-05:

- [v0.4.0-beta.0 release](https://github.com/antstanley/blogwright/releases/tag/v0.4.0-beta.0), published 2026-08-31T14:25:20Z, contains `blogwright pds bootstrap` migration instruction (GitHub API body checked).
- Registry metadata confirms blogwright, blogwright-pds and blogwright-core 0.4.0-beta.2 are public; recorded below. In-memory tarball inspection confirms the PDS package's named blogwright-pds inline policy exists and the CLI still contains its additive-era PDS branch. Tarballs omit CHANGELOG; release-note evidence comes from the GitHub release, not an absent tarball file.
- Upstream main03e40d06 and published beta.3 add owned log groups; they do not remove the site PDS policy or implement tasks59/60. Fetch was read-only to remote; work is on local feature bookmark.

```json
[
  {
    "package": "blogwright",
    "dist-tags": {
      "latest": "0.3.3",
      "beta": "0.4.0-beta.3"
    },
    "version": "0.4.0-beta.2",
    "published": "2026-08-31T17:32:04.923Z",
    "tarball": "https://registry.npmjs.org/blogwright/-/blogwright-0.4.0-beta.2.tgz",
    "gitHead": null
  },
  {
    "package": "blogwright-pds",
    "dist-tags": {
      "latest": "0.3.3",
      "beta": "0.4.0-beta.3"
    },
    "version": "0.4.0-beta.2",
    "published": "2026-08-31T17:32:14.081Z",
    "tarball": "https://registry.npmjs.org/blogwright-pds/-/blogwright-pds-0.4.0-beta.2.tgz",
    "gitHead": null
  },
  {
    "package": "blogwright-core",
    "dist-tags": {
      "latest": "0.3.3",
      "beta": "0.4.0-beta.3"
    },
    "version": "0.4.0-beta.2",
    "published": "2026-08-31T17:32:21.720Z",
    "tarball": "https://registry.npmjs.org/blogwright-core/-/blogwright-core-0.4.0-beta.2.tgz",
    "gitHead": null
  }
]
```

## Review verdict

IMPLEMENTATION STATUS: PARTIAL before resumed build.
PLAN COVERAGE: Remediated; all identified required gaps have task contracts and matching verification protocols.
CONFIDENCE: Medium for broad static conformance, high for the named concrete gaps. The baseline tests are not live AWS proof.
NEXT STEPS: Independently verify the remediated plan, then build59/62,60,63 with separate correctness/completeness gates and a final integrated conformance check. Final results belong in execution.md.

## Independent plan recheck

A separate reviewer checked the remediated plan: 64 tasks/rows, 124 identical
Mermaid/table edges, matching task dependencies, and all 25 current DoD claims
matching certificate claims exactly and in order. No execution blockers.
The two suggested follow-ups are resolved: Draft2020-12 meta-validation is
explicit in task63, and nine archived DEVELOPMENT.md links were repaired.
