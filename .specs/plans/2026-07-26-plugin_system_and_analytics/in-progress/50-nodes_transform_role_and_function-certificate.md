# Done Certificate - Task 50: The transform Lambda's execution role and function nodes

**Task:** [50-nodes_transform_role_and_function.md](50-nodes_transform_role_and_function.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 50. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 50) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `analytics-salt-secret`, `analytics-transform-role` and `analytics-transform-function` exist in `packages/analytics/src/nodes.ts` - a long-lived salt secret, a least-privilege execution role declaring a dependency on it because its policy names its ARN, and a function whose code is keyed by task 43's source hash, so identical source never redeploys the function.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's IAM nodes (`packages/cli/src/nodes.ts:151` `buildRoleNode` and `:219` `execRoleNode`), the `.oxlintrc.json` restricted-import overrides, or task 43's hash and derived zip key, which this task consumes and must not restate.

## Obligations

- **O1 - Role trust, least-privilege policy, and the dependency that policy implies.**
  - *Claim:* the role is created with the Lambda trust shape at `packages/cli/src/nodes.ts:106-115`, restated with a comment saying why it is not imported; its inline policy is scoped to the function's own log group with no wildcard `Resource`; and it declares `dependsOn: ['analytics-salt-secret']`, the node whose recorded ARN that policy interpolates.
  - *Evidence to collect:* read the trust document, the policy helper and the role's `dependsOn` array in `packages/analytics/src/nodes.ts`; run `pnpm test -- nodes` in `packages/analytics` and confirm the policy test parses the captured document and asserts every statement's `Resource` is a concrete ARN, failing if any is `*`, and that one case asserts the declared dependency id.
  - *Checks:* resolve the role calls - confirm `ensureRole` (`packages/core/src/aws/iam.ts:45`) and `putRolePolicy` (`:84`) are reached through `ctx.clients.iam`, and that no CLI module is imported for the trust constant. Cross-check the declared set against every ARN the policy interpolates: `topoSort` drains zero-indegree nodes alphabetically (`packages/cli/src/graph.ts:35-38`), so an undeclared dependency reconciles the role first and grants on `undefined` - a wrong permission, not an error.
  - *Status:* ☐ unverified

- **O2 - Function code keyed by the source hash, with named limits.**
  - *Claim:* the function node depends on the role, uploads the bundled transform as a zip keyed by task 43's source hash, and declares runtime, handler, timeout and memory as named constants; an unchanged hash performs no update call and a changed hash performs one.
  - *Evidence to collect:* read the function node's payload construction and the module constants in `packages/analytics/src/nodes.ts`; run `pnpm test -- nodes` in `packages/analytics` and read the two hash cases - confirm the unchanged case asserts an empty update-call log rather than only asserting no throw.
  - *Checks:* resolve the zip key and hash - confirm both come from `packages/analytics/src/transform-hash.ts` (task 43) rather than being re-derived in `nodes.ts`.
  - *Status:* ☐ unverified

- **O3 - Absence, recorded ARN, and re-runnable teardown.**
  - *Claim:* `read` reports absence without throwing, `create` records the function ARN into the plugin's scoped state, and `delete` removes the function then the role and is re-runnable when either is already gone.
  - *Evidence to collect:* run `pnpm test -- nodes` in `packages/analytics`; confirm cases exist for an absent function read, a create recording the ARN, a delete with the function already gone, and a delete with the role already gone - the last two asserting no throw and the remaining call still issued.
  - *Status:* ☐ unverified

- **O4 - The salt secret is created inside the us-east-1 pin.**
  - *Claim:* `analytics-salt-secret` goes through the `SecretsManagerClient` task 38's bundle builds over `ctx.clients.signingUsEast1`, never through `ctx.clients.secrets`, so the secret and the transform Lambda that reads it are in the same region as the ARN the role grants on.
  - *Evidence to collect:* run `grep -rn "ctx.clients.secrets" packages/analytics/src/` and expect no output; run `pnpm test -- nodes` in `packages/analytics` and read the case that sets `config.region` to something other than `us-east-1`, confirming the recorded request's credential scope contains `/us-east-1/secretsmanager/` and that the `secretsmanager:GetSecretValue` Resource ARN in the role's policy carries `us-east-1`.
  - *Checks:* resolve where the node's secrets client comes from - `createAnalyticsClients(ctx)` (task 38), not `ctx.clients`. A green suite with the primary-region client is possible whenever the fixture's region already *is* `us-east-1`, so read the fixture's region before trusting the assertion.
  - *Status:* ☐ unverified

- **O5 - Zip bytes cross the FileSystem port.**
  - *Claim:* the bundle is read through `ctx.ports.fs`, no domain module in the package imports `node:fs`, and no analytics path joined the lint override list.
  - *Evidence to collect:* run `grep -rn "node:fs\|from 'fs'" packages/analytics/src/` and expect no output; run `pnpm lint` and expect it clean; read `.oxlintrc.json`'s `no-restricted-imports` override list and confirm no `packages/analytics/src/` entry was added.
  - *Checks:* resolve the byte read in the function node - confirm it is `ctx.ports.fs.readBytes` from the `PluginContext`, the same seam `packages/cli/src/agent-package.ts:35-36` uses, not a direct Node call.
  - *Status:* ☐ unverified

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O7 - Run `pnpm test -- nodes` and `pnpm lint`, and confirm the policy assertion, the empty update log and the untouched lint config (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests and the linter and observe a policy test asserting on parsed `Resource` values, an unchanged-hash case asserting an empty update-call log, and no analytics entry in `.oxlintrc.json`.
  - *Evidence to collect:* run `pnpm test -- nodes` inside `packages/analytics` and `pnpm lint` from the repo root; read the policy test's assertion and the unchanged-hash case; `git diff .oxlintrc.json` (or `jj diff .oxlintrc.json`) and expect no change.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/src/nodes.ts` tasks 48–49 nodes reconciled through the same test harness → expect their call sequences and recorded state unchanged by the two appended nodes : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:219` `execRoleNode.create` against a test context → expect the site's exec role trust and policy unchanged, since the plugin restates rather than edits `LAMBDA_TRUST` : ☐ (PRESERVED / REGRESSION)

## Residue

The inline-zip decision rests on Lambda requiring a same-region code bucket while the site's bucket lives in `config.region`; the validator should confirm the comment states that reason and that the size guard is a named constant with a message naming the measured size. Whether the transform's log group is created by the node or left to Lambda's implicit creation is outside the DoD - if the policy scopes to a log group the node does not create, note it. The salt question is settled, not open: one long-lived secret, per-day salt derived in the transform. This task owns the `analytics-salt-secret` node and the grant; the derivation is tasks 41–42. The validator should confirm the node creates the secret only when absent and never rewrites an existing value (regeneration silently breaks `visitor_key` comparison across the boundary), that NO Secrets Manager rotation is configured on it, that the role's `secretsmanager:GetSecretValue` names that secret's ARN alone with no `*`, and that the secret's name reaches the function as an environment variable.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
