# Task 59 — Remove the pds branch from the site OIDC policy

**Plan:** [plan.md](../plan.md) · **Certificate:** [59-cli_drop_pds_from_site_graph-certificate.md](59-cli_drop_pds_from_site_graph-certificate.md)

**Implements:** [PDS migration](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) §The site graph drops its pds branch; [plugin SPI](../../../changes/2026-07-26-cli_plugin_system.md) §A plugin owns its own topography.
**Depends on:** 23, 29, 30
**Produces:** The site graph has no PDS-specific permission statement; the plugin retains its separately named grant.
**Pointers:** `packages/cli/src/nodes.ts` oidcRolePolicyStatements; `packages/cli/src/nodes.test.ts`; `packages/pds/src/nodes.ts`; `parked/task-59` (read-only source patch).

**External prerequisite:** satisfied by the published migration beta; see [release evidence](../reviews/2026-09-05-plan-review.md). Historical task-59 evidence is retained in reviews/, but every current obligation requires a new discharge.

## Steps

- [x] Adapt the seven-file patch at parked/task-59 to the current beta.3 base without changing or rebasing the parked bookmark. Remove the site branch and its temporary default; preserve all other policies and the PDS preview exclusion.
- [x] Update upgrade guidance and changeset: run `blogwright pds bootstrap <env>` before the next site bootstrap. State the independently published migration prerequisite and same-release coupling to task 60.
- [x] Leave both pending specs pending; final documentation and merges belong to task 63. Re-run all obligations against the adapted diff.

## Definition of done

- [x] The site nodes module contains no pds/atproto reference or plugin import; a configured PDS site produces exactly the same site-policy statements as one without PDS.
- [x] PDS still owns the blogwright-pds inline policy with the same three secret actions and ARN; its no-config/no-githubRepo/preview skips remain intact, and unrelated site policies and names are unchanged.
- [x] The published migration release is evidenced by registry metadata, the published PDS node and the release notice. The removal ships later, with task 60; the changeset explains the wholesale site-policy rewrite and environment-specific repair command.
- [x] The two pending change specs remain at their current paths with their pending status and closure explicitly assigned to task 63.
- [x] Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- [x] Reviewable: run `pnpm --filter blogwright exec vitest run nodes --reporter=verbose` and the PDS node tests; inspect the complete policy comparison, current release evidence, and `rg -n "pds|atproto" packages/cli/src/nodes.ts` returning no matches.
