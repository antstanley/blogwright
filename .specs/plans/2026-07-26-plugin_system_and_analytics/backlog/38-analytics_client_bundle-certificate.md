# Done Certificate - Task 38: Build the plugin's four clients over the shared signer, pinned to us-east-1

**Task:** [38-analytics_client_bundle.md](38-analytics_client_bundle.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 38. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 38) ≡ every obligation O1…O7 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/analytics/src/aws/clients.ts` exposes `createAnalyticsClients(ctx)` building `s3tables`, `firehose`, `glue`, `lambda` and a us-east-1 `S3Client` over `ctx.clients.signingUsEast1`, every one signing against `us-east-1` whatever `config.region` says - while core's `AwsClients` gains that one signer and no service key.
- **P2 - Obligations.** The task is done iff O1…O7 all hold. One Oi per definition-of-done item, in DoD order; O7 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the existing client bundle - every consumer of `createClients` (`packages/cli/src/context.ts:127`, `packages/cli/src/test-support.ts:70`, `packages/pds/src/test-support.ts:50`) and every `ctx.clients.*` call site in `packages/cli/src/nodes.ts`, `packages/cli/src/deploy.ts` and `packages/cli/src/microvms.ts` - nor the region split already encoded at `packages/core/src/clients.ts:52,54`.

## Obligations

- **O1 - Core's `AwsClients` gains exactly one member and no service key.**
  - *Claim:* `AwsClients` at `packages/core/src/clients.ts:21` gains `signingUsEast1` - the signer already constructed as a local `const` at `:54` - and nothing else; the rest of the returned object is byte-identical.
  - *Evidence to collect:* read `packages/core/src/clients.ts:21-70`; run `jj diff packages/core/src/clients.ts` and confirm the only additions are the interface member, its doc comment and the one returned key; run `grep -rn "s3tables\|firehose\|glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` and expect no output - test files are excluded because task 31's descriptor cases in `packages/core/src/aws/endpoint.test.ts` name all four services deliberately.
  - *Checks:* resolve the value assigned to `signingUsEast1` - confirm it is the existing `usEast1` binding at `:54` and not a freshly constructed `SigningClient`, which would bypass `base` and therefore the endpoint override and credential provider.
  - *Status:* ☐ unverified

- **O2 - The plugin's six clients are built in the plugin, over `signingUsEast1`.**
  - *Claim:* `createAnalyticsClients(ctx)` in `packages/analytics/src/aws/clients.ts` constructs `s3tables`, `firehose`, `glue` and `lambda` with the service descriptors task 31's seam accepts, plus a us-east-1 `S3Client` (for `analytics-error-bucket`) and a us-east-1 `SecretsManagerClient` (for `analytics-salt-secret`), all six over `ctx.clients.signingUsEast1`, under one doc comment naming the CloudFront-standard-logging constraint in the shape of core's `logsUsEast1` comment at `packages/core/src/clients.ts:28-32`.
  - *Evidence to collect:* read `packages/analytics/src/aws/clients.ts` in full; confirm every client is constructed from `ctx.clients.signingUsEast1` and none from `ctx.clients.signing`, which signs in `config.region` and is wrong for every analytics service; run `grep -rn "ctx.clients.s3\b\|ctx.clients.secrets" packages/analytics/src/` and expect no output - the pre-built `s3` and `secrets` clients on the context are primary-region (`packages/core/src/clients.ts:59,68`) and reusing either puts a plugin resource outside the region pin. The grep deliberately omits `ctx.clients.iam` and `ctx.clients.logsUsEast1`: tasks 50, 51 and 53 use both on purpose, and the analytics spec's §Region pinning names them as its two stated exceptions - IAM is a global service that signs us-east-1 whatever the region (`packages/core/src/aws/endpoint.ts:36,43,65-66`), and `logsUsEast1` is already pinned there in core. Widening the grep to catch them is a defect, not a tightening.
  - *Status:* ☐ unverified

- **O3 - A recording-transport test proves the region split both ways, on both sides.**
  - *Claim:* `packages/analytics/src/aws/clients.test.ts` builds the plugin bundle from a context whose `config.region` is not `us-east-1` and asserts, from captured `authorization` headers, that all six clients scope to `us-east-1` - including `/us-east-1/secretsmanager/`, the assertion that catches a bundle reusing `ctx.clients.secrets`; `packages/core/src/clients.test.ts` asserts `logs`, `s3`, `microvms` and `secrets` still scope to the configured region while `signingUsEast1` scopes to `us-east-1`.
  - *Evidence to collect:* run `pnpm test -- clients` in `packages/analytics` and in `packages/core` and confirm the case names cover both directions; read both test files and confirm each assertion matches the credential scope substring `/<region>/<signing name>/aws4_request` (the `packages/core/src/aws/signer.test.ts:32` form), not merely the request URL.
  - *Checks:* resolve the `microvms` assertion specifically - confirm it expects `/eu-west-1/lambda/aws4_request`, distinguishing it from the plugin's `lambda` client's `/us-east-1/lambda/aws4_request`; a test that asserts only the signing name would pass for both and prove nothing.
  - *Status:* ☐ unverified

- **O4 - No dead export, no unused dependency.**
  - *Claim:* `pnpm knip` from the repo root reports nothing for `packages/core`, `packages/cli` or `packages/analytics`. This is the check that keeps the topography rule honest: four clients exported from core and consumed by nothing in core or the CLI is exactly what knip reports.
  - *Evidence to collect:* run `pnpm knip` from the repo root and record the full output; confirm no new entry appears in `knip.json` to suppress a finding introduced by this task.
  - *Status:* ☐ unverified

- **O5 - The changeset decision is recorded.**
  - *Claim:* either a `.changeset/*.md` exists marking a minor on `blogwright-core` covering `signingUsEast1`, task 31's transport seam and the `LogsClient` delivery-configuration parameters, or the change description states that the changeset is deferred to task 58.
  - *Evidence to collect:* list `.changeset/*.md` and read any file added by this task; if none exists, read the change description (`jj log -r @ -T description`) and confirm it names the deferral to task 58 explicitly.
  - *Status:* ☐ unverified

- **O6 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O7 - Run `pnpm test -- clients` in both packages, then `pnpm knip`; confirm the plugin's recorded `authorization` headers show `us-east-1` for all six clients and core's show `eu-west-1` for `logs`/`s3`/`microvms`/`secrets`, and that `pnpm test -- nodes` still passes with no change to its client fakes (Reviewable).**
  - *Claim:* a reviewer can run those commands and observe the region split in the captured headers, a clean knip report, and a green CLI node suite with an unedited `nodes.test.ts`.
  - *Evidence to collect:* run `pnpm test -- clients` in `packages/analytics` and `packages/core`, then `pnpm knip` and `pnpm test -- nodes`, recording each result; run `jj diff packages/cli/src/nodes.test.ts` and expect an empty diff.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:127` calls `createClients({ region, endpointOverride, credentials })` → expect every pre-existing key on the returned `AwsClients` to keep the signer it had, `microvms` included : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/test-support.ts:69` calls `createClients` and re-wraps each client with `overrideClient` → expect `signingUsEast1` to be enumerated there too, so a `ClientOverrides` substitution of it is honoured rather than silently dropped : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/test-support.ts:50` calls `createClients` → expect `pnpm test` in `packages/pds` to remain green with no edit : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/deploy.ts:75` calls `ctx.clients.microvms.runMicrovm(input)` → expect a request signed for the configured region, not `us-east-1` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the `testClients` widening at `packages/cli/src/test-support.ts:69-88` is a step, not a DoD obligation - but omitting `signingUsEast1` there makes a substitution of it a silent no-op, so treat a missing enumeration as a finding even though no obligation names it. Later node tests substitute the *plugin's* bundle, by injecting a fake `createAnalyticsClients` result, not through `ctx.clients` - a node reaching AWS through `ctx.clients.firehose` is a defect, because that key does not exist. The endpoint override (`AWS_ENDPOINT_URL`/floci) still reaches the plugin's clients because `signingUsEast1` is the same object built from `base` at `packages/core/src/clients.ts:47-51`. Whether Firehose and S3 Tables are actually offered in every account's `us-east-1` is an operational question the spec's assumptions cover, not a code obligation.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
