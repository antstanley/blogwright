# Task 59 — Remove the pds branch from the site's OIDC policy

**Plan:** [plan.md](../plan.md) · **Certificate:** [59-cli_drop_pds_from_site_graph-certificate.md](59-cli_drop_pds_from_site_graph-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-cli` → The site graph drops its pds branch (Remove)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) and [2026-07-26-cli_plugin_system.md §Plugin SPI → A plugin owns its own topography (Add)](../../../changes/2026-07-26-cli_plugin_system.md)
**Depends on:** 23, 29
**Produces:** the CLI's resource graph carries no pds knowledge — no `config.pds` branch, no `blogwright-pds` import in `nodes.ts` — with the grant now owned entirely by the plugin's own node

**Pointers:** `packages/cli/src/nodes.ts:913-927` (the `if (ctx.config.pds)` block to delete, with the secret ARN at `:925`), `packages/cli/src/nodes.ts:863` (`oidcRolePolicyStatements`, the exported function under test), `packages/cli/src/nodes.ts:823` (the doc comment mentioning "read access to the PDS credentials secret", which must lose that clause), `packages/cli/src/nodes.test.ts:194-211` (the ARN assertion that moves to the pds package at task 23), `packages/pds/src/nodes.ts` (task 23 — where the grant now lives)

## Steps

- [ ] Delete the `if (ctx.config.pds)` statement block at `packages/cli/src/nodes.ts:913-927` and correct the doc comment at `:823` so it no longer claims the role grants access to the PDS secret.
- [ ] Remove the now-unused `blogwright-pds` import from `packages/cli/src/nodes.ts` and run `pnpm knip` to clear anything it orphans.
- [ ] Move the ARN assertion out of `packages/cli/src/nodes.test.ts:194-211` — task 23 already reproduces it against the plugin's node, so delete it here rather than duplicating coverage, and add its negative: a context WITH `config.pds` set produces an OIDC policy containing no `secretsmanager` statement at all.
- [ ] Write the changeset. This is the visible half of the topography move: the grant is unchanged for anyone who runs `blogwright pds bootstrap`, but an operator who upgrades and never runs it keeps the old inline policy until they do. State that in the changeset and in the upgrade note.

## Definition of done

- [ ] `oidcRolePolicyStatements` contains no reference to `config.pds` and produces no `secretsmanager` statement for any input, asserted by a test using a context that HAS a `pds` block — the positive-looking case that would otherwise hide the residue.
- [ ] `grep -n "pds" packages/cli/src/nodes.ts` returns zero hits, closing the gap task 29's `cli.ts`-only gate left open.
- [ ] The grant is provably preserved end to end: with the pds plugin bootstrapped, the site role carries a `blogwright-pds` inline policy whose document matches what the site used to emit (task 23's assertion), so a CI deploy's access is unchanged.
- [ ] `pnpm knip` passes with the `blogwright-pds` import gone from `nodes.ts`; a changeset records the upgrade note.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- nodes` and `pnpm knip`; confirm the with-pds context yields no secretsmanager statement and that `grep pds packages/cli/src/nodes.ts` is empty.
