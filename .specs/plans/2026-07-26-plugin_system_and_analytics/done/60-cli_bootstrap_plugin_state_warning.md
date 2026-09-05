# Task 60 — Warn after site bootstrap while scoped plugin state exists

**Plan:** [plan.md](../plan.md) · **Certificate:** [60-cli_bootstrap_plugin_state_warning-certificate.md](60-cli_bootstrap_plugin_state_warning-certificate.md)

**Implements:** [PDS migration](../../../changes/merged/2026-07-26-migrate_pds_to_plugin_system.md) §bootstrap warns while plugin state exists; [plugin SPI](../../../changes/merged/2026-07-26-cli_plugin_system.md) §Scoped state stores.
**Depends on:** 16, 59
**Produces:** Successful site bootstrap warns once per discovered scoped state key with a command for the same environment, without loading plugins.
**Pointers:** `packages/cli/src/commands.ts`: bootstrap, scopedStateScopes, assertNoScopedState; commands.test.ts and cli.test.ts laziness fixtures.

## Steps

- [x] Share the existing key parser/listing with destroy without weakening its fail-closed error handling. After successful applyGraph only, list state/ once through the S3 client and warn per unique matching scope.
- [x] Include the current environment in each suggested plugin bootstrap command. Preserve no-key output; unknown or uninstalled plugin scopes must still warn. Do not read objects, discover plugins, inspect plugin config or prompt.
- [x] A listing error is diagnostic only for bootstrap: log contextual failure and keep successful reconcile exit status. A reconcile failure must not list or warn. Keep destroy errors fatal except its existing NoSuchBucket case.
- [x] Add recording-client/logger tests for no key, multiple keys, another environment, uninstalled scopes, failed reconcile and failed listing; preserve discovery-free built-ins. Write a changeset coupled to task59. Final public/canonical docs and spec merges belong to task63.

## Definition of done

- [x] After successful reconcile, exactly one listObjects call on state/ yields one warning per unique scope of the current environment; no-key output is unchanged. Each remedy names that environment.
- [x] The single existing matcher serves both bootstrap and destroy, with no object-content reads, plugin imports/discovery/config knowledge or prompts, including plain sessions and uninstalled plugins.
- [x] A failed reconcile makes no added listing/warning. A failed post-reconcile listing warns with error context without failing bootstrap; destroy retains its existing error propagation and NoSuchBucket handling.
- [x] Code and changeset state that a never-bootstrapped plugin has no scoped key and produces no per-plugin warning. The warning ships in the same release as task59 (never later); pending specs remain pending until task63.
- [x] Meets the repo definition of done: `pnpm build`, `pnpm typecheck`, `TZ=America/New_York pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip`; user-facing behavior has a changeset, and new assertions are demonstrated failing before the fix or under a reverted mutation.
- [x] Reviewable: run `pnpm --filter blogwright exec vitest run commands cli plugin-commands --reporter=verbose`; observe current-environment warnings, unchanged empty-state output and unchanged destroy refusal/laziness behavior.
