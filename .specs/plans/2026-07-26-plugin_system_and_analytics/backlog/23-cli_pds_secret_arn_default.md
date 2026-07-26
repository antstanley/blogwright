# Task 23 — pds attaches its own named inline policy to the site's deploy role

**Plan:** [plan.md](../plan.md) · **Certificate:** [23-cli_pds_secret_arn_default-certificate.md](23-cli_pds_secret_arn_default-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-pds` → Its own IAM policy node (Add)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) and [2026-07-26-cli_plugin_system.md §Plugin SPI → A plugin owns its own topography (Add)](../../../changes/2026-07-26-cli_plugin_system.md)
**Depends on:** 22
**Produces:** `blogwright-pds` contributes one `ResourceNode` that attaches a `blogwright-pds`-named inline policy to the site's GitHub-OIDC deploy role, granting Secrets Manager access to its own secret — additive, so the site's existing statement (removed at task 58) and this one coexist without a gap

**Pointers:** `packages/pds/src/nodes.ts` (new — the plugin's node module), `packages/pds/src/nodes.test.ts` (new), `packages/core/src/aws/iam.ts:84` (`putRolePolicy(roleName, policyName, policy)` — already exists, no client work), `:93` (`listRolePolicies`), `:108` (`deleteRolePolicy`), `packages/cli/src/nodes.ts:906-928` (the `if (ctx.config.pds)` statement this node replaces — read it, do NOT edit it here; task 58 removes it), `packages/cli/src/nodes.ts:925` (the exact ARN pattern to reproduce), `packages/core/src/config.ts:364` (`names.buildRole`/the OIDC role name derivation), `packages/pds/src/config.ts` (task 21's `resolvePdsSecretName`), `packages/core/src/plugin.ts` (task 01 — `ResourceNode`, `PluginContext`, `siteState`, `record()`)

## Steps

- [ ] Add `packages/pds/src/nodes.ts` exporting `buildPdsNodes(ctx)` and wire it to the plugin's `nodes(ctx)` (task 25's `Plugin` export). This is the first time pds contributes graph nodes; the module comment says why the grant lives here rather than in the site graph.
- [ ] The single node `pds-oidc-policy` calls `putRolePolicy(<site oidc role>, 'blogwright-pds', …)` with the same three actions the site grants today — `secretsmanager:GetSecretValue`, `PutSecretValue`, `CreateSecret` — on `arn:aws:secretsmanager:<region>:<account>:secret:<resolved secret name>-*`, resolving the name through task 21's `resolvePdsSecretName` rather than reading `config.pds.secretName` directly.
- [ ] `read()` returns whether the policy name is present via `listRolePolicies`; `delete()` calls `deleteRolePolicy`. Because the policy is separately named, creating and deleting it never touches the site's own inline policy document.
- [ ] Read the role name from `ctx.names` and confirm the role exists through `ctx.siteState` before any call, failing with a message naming `blogwright bootstrap` when the site is not bootstrapped — the same shape the analytics delivery node uses. Record the node's outputs through `ctx.record()`.
- [ ] Skip the node entirely when `config.pds` is absent or when the site has no `githubRepo` (no OIDC role exists to attach to), so `pds bootstrap` on a repo without CI deploys is a no-op rather than an error.
- [ ] Write `packages/pds/src/nodes.test.ts` over a recording IAM client: the policy name, the three actions and the ARN pattern are asserted byte-identical to the statement `oidcRolePolicyStatements` produces today (copy the expectation from `packages/cli/src/nodes.test.ts:194-211`), so the move is provably behaviour-preserving; plus the absent-config, absent-githubRepo and site-not-bootstrapped cases.

## Definition of done

- [ ] `blogwright-pds` exports one resource node attaching a `blogwright-pds`-named inline policy to the site's OIDC role, and a test asserts its policy document is byte-identical to the statement the site graph produces today — this is the evidence that task 58's removal is safe.
- [ ] The node is additive only: it does not read, modify or delete the site's own inline policy, proved by a recording IAM client asserting `putRolePolicy` is called with policy name `blogwright-pds` and no other policy name is touched.
- [ ] `packages/cli/src/nodes.ts` is UNCHANGED by this task — `git diff packages/cli/src/nodes.ts` is empty. The site's statement stays until task 58, so at no commit does a CI deploy lose access to the secret.
- [ ] The node is skipped, not failed, when `config.pds` is absent or the site has no `githubRepo`; a site that is not bootstrapped fails with a message naming `blogwright bootstrap` (negative-space tests for all three).
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-pds test -- nodes`; confirm the emitted policy document matches the site's current statement field for field, and that `git diff packages/cli/` shows nothing.
