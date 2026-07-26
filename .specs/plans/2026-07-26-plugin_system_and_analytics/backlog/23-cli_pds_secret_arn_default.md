# Task 23 — Derive the OIDC role's pds secret ARN from the shared default, not from config.pds.secretName

**Plan:** [plan.md](../plan.md) · **Certificate:** [23-cli_pds_secret_arn_default-certificate.md](23-cli_pds_secret_arn_default-certificate.md)

**Implements:** [2026-07-26-migrate_pds_to_plugin_system.md §`blogwright-core` → Config (Modify)](../../../changes/2026-07-26-migrate_pds_to_plugin_system.md) and §`blogwright-pds` → Config ownership (Add), and [2026-07-26-cli_plugin_system.md §CLI → Config ownership (Add)](../../../changes/2026-07-26-cli_plugin_system.md) (once core stops defaulting `secretName`, every reader must get the default from the package that owns the key)
**Depends on:** 22
**Produces:** the GitHub OIDC deploy role's Secrets Manager statement derives its ARN through `blogwright-pds`'s secret-name resolver, so the policy is identical for every input valid today and cannot degrade to `secret:undefined-*` once core stops defaulting
**Pointers:** `packages/cli/src/nodes.ts:913-927` (the `if (ctx.config.pds)` statement pushed onto the OIDC role policy), `packages/cli/src/nodes.ts:925` (`Resource: \`arn:aws:secretsmanager:${ctx.config.region}:${ctx.accountId}:secret:${ctx.config.pds.secretName}-*\``), `packages/cli/src/nodes.ts:863` (`oidcRolePolicyStatements`, the exported function under test), `packages/cli/src/nodes.test.ts:8-25` (the `ctx` helper, whose pds fixture at `:14` names `secretName: 'example/atproto'` explicitly), `packages/cli/src/nodes.test.ts:194-211` (the existing ARN assertion that must not move), `packages/pds/src/config.ts` (task 21's resolver, exported from `packages/pds/src/index.ts`)

## Steps

- [ ] Export task 21's secret-name resolver from `packages/pds/src/index.ts` if it is not already on the public surface, so the CLI can import it by name rather than reaching into a deep path.
- [ ] Change `packages/cli/src/nodes.ts:925` to interpolate the resolver's result — `resolvePdsSecretName(ctx.config.pds, ctx.config.siteName)` — instead of `ctx.config.pds.secretName`, leaving the region, account id, `secret:` prefix and `-*` suffix exactly as they are.
- [ ] Add a case to the `ctx` helper in `packages/cli/src/nodes.test.ts:8-25` (or a sibling helper) that configures `pds: { name: 'x' }` with no `secretName`, so the defaulted path is constructible from a test.
- [ ] Add the test asserting the emitted `Resource` for that defaulted case is `arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*`, beside the existing explicit-`secretName` assertion at `:194-211`.
- [ ] Confirm the CLI imports the resolver from `blogwright-pds` and re-implements no default of its own: `grep -rn "atproto" packages/cli/src` must show only assertions and fixtures.

## Definition of done

- [ ] A new test in `packages/cli/src/nodes.test.ts` configures a `pds` block with no `secretName` and asserts the emitted statement's `Resource` is `arn:aws:secretsmanager:us-east-1:123456789012:secret:example/atproto-*` — the string the current code produces via core's default.
- [ ] The existing assertion at `packages/cli/src/nodes.test.ts:194-211` (explicit `secretName: 'example/atproto'`) passes unchanged, proving the derived ARN is unchanged for existing inputs, and the preview case at `:168-173` still emits no secrets statement at all.
- [ ] The secret name reaching the IAM `Resource` comes from `blogwright-pds`'s resolver — the package that owns the key — and is typed `string`, not `string | undefined`, so the literal `undefined` can never appear in a policy; the CLI defines no default of its own.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- nodes` in `packages/cli`; confirm both ARN assertions pass and read `packages/cli/src/nodes.ts:925` to see the resolver call rather than a bare property read.
