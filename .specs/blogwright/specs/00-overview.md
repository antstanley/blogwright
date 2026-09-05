# Blogwright implementation overview

**Status:** Implemented · **Date:** 2026-09-05 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [development guidelines](../../../DEVELOPMENT.md) and [spec index](../../README.md).

## Problem and goals

Blogwright builds static sites in a Lambda MicroVM and publishes them to S3 behind
CloudFront. The CLI reconciles infrastructure directly through signed AWS HTTP
clients. Feature packages extend commands and maintain separate resource graphs:
PDS publishes standard.site records; analytics reads CloudFront traffic through
Firehose, an Iceberg table and a local dashboard.

## Non-goals

There is no CloudFormation, Terraform or CDK state, public/versioned plugin API,
plugin hook system, dependency injection container, cross-plugin dependency graph,
cloud-hosted analytics dashboard or browser tracking script.

## System shape

```text
consumer repo + config/<env>.jsonc
                  |
                  v
CLI composition root --> core config, signing, state and ports
  | site graph + deploy engine --> MicroVM build --> S3 site/ --> CloudFront
  | generic plugin dispatch
  +--> bundled PDS --> Secrets Manager / AT Protocol publication
  +--> optional analytics --> Firehose transform --> S3 Tables Iceberg
                                                  ^
                                   local DuckDB dashboard/backfill
```

## Detail pages

| Page | Contract |
| --- | --- |
| [Domain model](01-domain-model.md) | JSON entities, config phases, state and identity |
| [Plugin architecture](02-plugin-architecture.md) | SPI, discovery, dispatch, ownership and ports |
| [PDS](03-pds.md) | Publishing commands, validation and IAM lifecycle |
| [Analytics](04-analytics.md) | Fourteen nodes, records, observability, queries and backfill |
| [Dashboard design](05-design.md) | Visual foundations, responsive reporting and design acceptance |
| [Canonical schema](canonical-types.schema.json) | Draft 2020-12 JSON entities; callable TypeScript contracts stay in prose/source |

## Package layout and dependency direction

| Package | Responsibility and distribution |
| --- | --- |
| `blogwright-core` | Shared config, names, state, graph/SPI vocabulary, transport, AWS clients, filesystem/terminal ports and adapters; published |
| `blogwright` (`packages/cli`) | Composition root, graph engine, site nodes, commands, plugin discovery and package management; published, bins `blogwright` and `bw` |
| `blogwright-pds` | AT Protocol publishing, OAuth and named IAM policy; published and a CLI default dependency |
| `blogwright-analytics` | Plugin-local AWS clients, transform, nodes, DuckDB adapters and static dashboard; published and installed separately |
| `blogwright-build-agent` | Private MicroVM HTTP build server, bundled into the CLI |
| `blogwright-docs` (`docs`) | Private Astro/Starlight documentation site |

Five packages live under `packages/`; docs is a sixth workspace member. Four
publishable packages share the changesets fixed-version group. Builds follow
workspace dependencies; the CLI copies the build-agent artifact and analytics
builds its rolldown Lambda bundle and Vite/SvelteKit static app. Root
[package scripts](../../../package.json), [workspace](../../../pnpm-workspace.yaml)
and [release group](../../../.changeset/config.json) are authoritative.

Core never imports the CLI or feature packages. Plugins depend on core; feature
AWS clients remain in their packages. The CLI imports PDS's `syncAfterDeploy`
directly for production deploys; this explicit exception uses the narrow PDS
context and adds no lifecycle hook.

## Scope summary

| Surface | Current behavior |
| --- | --- |
| Site lifecycle | Bootstrap, deployment, rollback, status, history, logs, live-prefix deletion and guarded destruction |
| Preview | Separate fixed `preview` environment; shared stack with per-PR prefixes |
| Plugins | Two manifest-declared consumers; separate state keys and resource graphs |
| PDS | Stable config/rkeys, production sync and plugin-owned deploy-role grant |
| Analytics | us-east-1 pipeline, fourteen nodes, daily visitor pseudonyms, fixed named queries, optional historical import |
| Verification | Six gates including explicit typecheck and tests under `TZ=America/New_York`; source/tests linked on detail pages |

The [closure report](../../reviews/2026-09-05-specification-closure.md) maps source
change-spec merge steps to these current artifacts and separates historical
review evidence from fresh checks. Runtime test evidence uses transport mocks;
it does not assert a new live AWS deployment or publication.

## Assumptions and open questions

**Assumptions**

- Installed packages are trusted code; AWS services and the ambient credential provider remain external dependencies.

**Decisions**

- *Scope.* **Internal implementation contracts.** These pages describe the integrated CLI and its bundled/on-demand features without promising a supported third-party SPI.
- *Rules of the road.* **Retain root DEVELOPMENT.md.** A second guidelines copy would drift.

**Open questions**

- When should the internal SPI become a supported, versioned public API? Carry this product decision separately from internal documentation.
