# Specs

Internal current implementation contracts live in [blogwright/](blogwright/README.md).
[DEVELOPMENT.md](../DEVELOPMENT.md) remains the canonical rules-of-road source.
Internal documentation does not offer a supported third-party plugin API.

## Canonical product specifications

- [Design guidelines](design-guidelines.md)
- [Analytics dashboard design](blogwright/specs/05-design.md)

- [Overview](blogwright/specs/00-overview.md)
- [Domain model](blogwright/specs/01-domain-model.md)
- [Plugin architecture and contracts](blogwright/specs/02-plugin-architecture.md)
- [PDS publishing](blogwright/specs/03-pds.md)
- [Analytics pipeline](blogwright/specs/04-analytics.md)
- [Canonical JSON schema](blogwright/specs/canonical-types.schema.json)

## Plans

- [Hexagonal ports adoption](plans/merged/2026-07-11-hexagonal_ports_adoption/plan.md) -
  move the remaining direct side effects (fs, child_process, fetch, terminal) behind
  ports per DEVELOPMENT.md §Hexagonal architecture, then extract the standard.site
  integration into a `blogwright-pds` feature package; eight tasks, four milestones.
- [Plugin system and analytics](plans/2026-07-26-plugin_system_and_analytics/plan.md) -
  land the three linked 2026-07-26 change specs as one graph: a plugin SPI in
  `blogwright-core` with discovery and generic dispatch in the CLI, the migration of
  `blogwright-pds` onto it with no config-file change, and a `blogwright-analytics`
  plugin delivering CloudFront logs to an Iceberg table with a local dashboard;
  66 tasks, ten milestones, with the retired planning type-claim gate
  ([type-claims/](plans/2026-07-26-plugin_system_and_analytics/type-claims/README.md))
  whose retained evidence records 29 compiler claims before retirement. Ordinary typecheck and tests remain the enduring gates.
  The [current review](plans/2026-07-26-plugin_system_and_analytics/reviews/2026-09-05-plan-review.md) records coverage and remediation.
- [Analytics-owned log groups](plans/2026-08-31-analytics_owned_log_groups/plan.md) -
  land the 2026-08-31 change spec: the transform Lambda's log group and Firehose's
  become plugin-owned resource nodes with 365-day retention, and the delivery
  stream's `CloudWatchLoggingOptions` is enabled against the second of them.
  Five tasks, three milestones. It opens by resetting PR #27's superseded diff out
  of the working tree, and its load-bearing task is not the two new nodes but the
  Firehose stream node's update guard, which reconciles on `AppendOnly` alone today
  and would otherwise leave every already-deployed stream unlogged.

## Change specs

- [Analytics dashboard design](changes/merged/2026-09-05-analytics_dashboard_design.md)
  — merged 2026-09-05: responsive reporting layout, accessible chart data, and design guidelines.

No pending change specs remain. All three linked July proposals are folded into
current internal pages/schema; their dated history remains in [changes/merged/](changes/merged/).
The [closure report](reviews/2026-09-05-specification-closure.md) maps every merge step,
records current tests, and preserves the historical PARTIAL58/delta20 verdicts.

- [Internal CLI plugin system](changes/merged/2026-07-26-cli_plugin_system.md)
  — merged2026-09-05 at task63: SPI, scoped state, two-origin discovery, dispatch,
  management/init/lifecycle and plugin service transport.
- [PDS migration](changes/merged/2026-07-26-migrate_pds_to_plugin_system.md)
  — merged2026-09-05 at task63: typed compatibility seam, plugin-owned IAM policy,
  site-graph removal, scoped-key bootstrap warnings and consumer upgrade guidance.
- [Analytics plugin](changes/merged/2026-07-26-analytics_plugin.md)
  — historically merged2026-08-31 at task61; canonical pages/schema folded at task63,
  replacing the historical no-target disposition for merge steps1–2.
- [Analytics-owned log groups](changes/merged/2026-08-31-analytics_owned_log_groups.md)
  — merged2026-09-01; two owned groups,365-day retention and live stream logging
  reconciliation take the original twelve-node graph to fourteen. Both analytics
  source documents fold together into the current canonical page.
- [Persist partial bootstrap state](changes/merged/2026-07-22-persist_partial_bootstrap_state.md)
  — merged2026-07-22: record identity outputs before secondary mutations and save
  create/update failure progress.
- [Adopt orphaned resources](changes/merged/2026-07-22-adopt_orphaned_resources_on_bootstrap.md)
  — merged2026-07-22: distribution adoption with CallerReference verification and
  bucket configuration reconciliation on every apply.
