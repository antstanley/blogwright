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
  64 tasks, ten milestones, plus a compiled type-claim gate
  ([type-claims/](plans/2026-07-26-plugin_system_and_analytics/type-claims/README.md))
  that pins the corpus's compiler claims against the repo's real types and retires at task 63.
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

Pending proposals live under [`changes/`](changes/); merged history under
[`changes/merged/`](changes/merged/).

Pending - two of the three linked 2026-07-26 proposals, and no standalone ones.
The third of the linked three, the analytics plugin, is merged below, as is the
standalone 2026-08-31 proposal that amends it. Each linked entry names the task
that flips it, so what is left is not read as an oversight.

The three linked 2026-07-26 proposals:

1. [An internal plugin system for the CLI](changes/2026-07-26-cli_plugin_system.md)
   (proposed 2026-07-26) - plugin SPI in `blogwright-core`, discovery by a
   `package.json` manifest field, generic `blogwright <plugin> <action>` dispatch,
   and `blogwright plugin add|list|remove`. Internal and unversioned until it has
   carried two features. **Flipped at task 63.** Its SPI, dispatch, `plugin`
   commands and transport seam have all landed, but §Plugin SPI -> *A plugin owns
   its own topography* requires that no config key of a plugin's is read by a site
   node, and the site's OIDC role policy still branches on `ctx.config.pds`
   (`packages/cli/src/nodes.ts`). Task 59 removes that branch and is held for a
   later release; task 60 ships with it, and task 63 closes the documentation and flips this header. Task 20
   deferred the flip to task 58 for the transport seam, which is in place; task 58
   deferred it again for this second obligation, which is not.
2. [Migrate blogwright-pds onto the plugin system](changes/2026-07-26-migrate_pds_to_plugin_system.md)
   (proposed 2026-07-26) - pds becomes a plugin architecturally while staying a
   default dependency; validates the SPI against a second consumer. No config
   file changes; five operator-visible ones, listed in its §Upgrading a deployed
   stack. **Flipped at task 63.** Two blocks are outstanding: §The site graph
   drops its pds branch (task 59, which must ship a release later than task 30's
   migration note) and §`bootstrap` warns while plugin state exists (task 60).
   The migration release is published; tasks 59–60 resume together, and task 63 owns canonical documentation and final closure.

Merged:

- [Analytics plugin - CloudFront logs to Iceberg, with a local dashboard](changes/merged/2026-07-26-analytics_plugin.md)
  (merged 2026-08-31, at task 61) - a second CloudFront log delivery into Firehose,
  a record-transform Lambda, an Iceberg table in S3 Tables, a local SvelteKit/DuckDB
  dashboard, and the optional one-shot `analytics backfill`. Installed with
  `blogwright plugin add analytics`. Merge-plan steps 3-4 (the DEVELOPMENT.md
  toolchain, ports and workspace-count edits) landed at task 58 and steps 5-6 here;
  steps 1-2 are recorded as not-applicable, there being no canonical spec pages or
  schema to fold into. Its two open questions - row expiry on an Iceberg table you
  create, and whether the shared Glue catalog integration should ever be deleted -
  are carried in the plan's own Assumptions and open questions.
- [The analytics plugin owns its two CloudWatch log groups](changes/merged/2026-08-31-analytics_owned_log_groups.md)
  (merged 2026-09-01, at task 05) - amends the analytics spec above in place
  rather than a canonical page, there being none for the resource nodes yet. The
  transform Lambda's log group and Firehose's become plugin-owned resource nodes,
  both pinned to `us-east-1` and retained for 365 days, and the delivery stream's
  `CloudWatchLoggingOptions` is enabled against the second of them. Twelve nodes
  become fourteen. It **supersedes
  [PR #27](https://github.com/antstanley/blogwright/pull/27)**, closed unmerged at
  task 01, whose `logs:CreateLogGroup` grant on the transform role is unnecessary
  once a node owns the group. Merge-plan steps 1-3, 6 and 7 are executed; steps 4
  and 5 are recorded as not-applicable in its own §Merge plan, there being no
  schema fragment to fold and no `DEVELOPMENT.md` change to make. Its four open
  questions - the stream node's field-allowlist guard, configurable retention,
  the site build role's own `logs:CreateLogGroup`, and whether `analytics status`
  should report the two groups specially - are carried in its own Assumptions and
  open questions.
- [Persist node outputs when create() fails partway](changes/merged/2026-07-22-persist_partial_bootstrap_state.md)
  (merged 2026-07-22) - state saves on the failure path; identity outputs are
  recorded before secondary mutations.
- [Adopt orphaned resources when re-bootstrapping a partial environment](changes/merged/2026-07-22-adopt_orphaned_resources_on_bootstrap.md)
  (merged 2026-07-22) - distribution adoption on `CNAMEAlreadyExists` (verified by
  CallerReference) and bucket config reconcile on every apply.
