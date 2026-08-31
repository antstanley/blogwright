# Specs

The spec home for blogwright. Development guidelines currently live at the repo root
in [DEVELOPMENT.md](../DEVELOPMENT.md) (see its Decisions block for why); if a full
spec set is created here later, that page moves to `development-guidelines.md`.

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
  62 tasks, eight milestones, plus a compiled type-claim gate
  ([type-claims/](plans/2026-07-26-plugin_system_and_analytics/type-claims/README.md))
  that pins the corpus's compiler claims against the repo's real types.

## Change specs

Pending proposals live under [`changes/`](changes/); merged history under
[`changes/merged/`](changes/merged/).

Pending - three linked proposals, landing in this order. Each entry names the task
that flips it, so what is left is not read as an oversight:

1. [An internal plugin system for the CLI](changes/2026-07-26-cli_plugin_system.md)
   (proposed 2026-07-26) - plugin SPI in `blogwright-core`, discovery by a
   `package.json` manifest field, generic `blogwright <plugin> <action>` dispatch,
   and `blogwright plugin add|list|remove`. Internal and unversioned until it has
   carried two features. **Flipped at task 60.** Its SPI, dispatch, `plugin`
   commands and transport seam have all landed, but §Plugin SPI -> *A plugin owns
   its own topography* requires that no config key of a plugin's is read by a site
   node, and the site's OIDC role policy still branches on `ctx.config.pds`
   (`packages/cli/src/nodes.ts`). Task 59 removes that branch and is held for a
   later release; task 60 ships with it and flips this header then. Task 20
   deferred the flip to task 58 for the transport seam, which is in place; task 58
   deferred it again for this second obligation, which is not.
2. [Migrate blogwright-pds onto the plugin system](changes/2026-07-26-migrate_pds_to_plugin_system.md)
   (proposed 2026-07-26) - pds becomes a plugin architecturally while staying a
   default dependency; validates the SPI against a second consumer. No config
   file changes; five operator-visible ones, listed in its §Upgrading a deployed
   stack. **Flipped at task 60.** Two blocks are outstanding: §The site graph
   drops its pds branch (task 59, which must ship a release later than task 30's
   migration note) and §`bootstrap` warns while plugin state exists (task 60).
   Task 60 is blocked behind that release rather than unstarted.
3. [Analytics plugin - CloudFront logs to Iceberg, with a local dashboard](changes/2026-07-26-analytics_plugin.md)
   (proposed 2026-07-26) - a second CloudFront log delivery into Firehose, a
   record-transform Lambda, an Iceberg table in S3 Tables, and a local
   SvelteKit/DuckDB dashboard. Installed with `blogwright plugin add analytics`.
   **Flipped at task 61.** Its §Backfill of historical logs block is outstanding:
   `blogwright analytics backfill` is declared and reports that it is not
   available yet. Merge-plan steps 3-4 (the DEVELOPMENT.md toolchain, ports and
   workspace-count edits) are done; steps 1-2 are recorded as not-applicable,
   there being no canonical spec pages or schema to fold into.

Merged:

- [Persist node outputs when create() fails partway](changes/merged/2026-07-22-persist_partial_bootstrap_state.md)
  (merged 2026-07-22) - state saves on the failure path; identity outputs are
  recorded before secondary mutations.
- [Adopt orphaned resources when re-bootstrapping a partial environment](changes/merged/2026-07-22-adopt_orphaned_resources_on_bootstrap.md)
  (merged 2026-07-22) - distribution adoption on `CNAMEAlreadyExists` (verified by
  CallerReference) and bucket config reconcile on every apply.
