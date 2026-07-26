# Done Certificate — Task 37: Wire the four new clients into AwsClients, pinned to us-east-1

**Task:** [37-core_client_bundle_wiring.md](37-core_client_bundle_wiring.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 37. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 37) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `AwsClients` carries `s3tables`, `firehose`, `glue` and `lambda`, every one signing against `us-east-1` whatever `config.region` says, with a recording-transport test proving the split against the site's own clients.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the existing client bundle — every consumer of `createClients` (`packages/cli/src/context.ts:127`, `packages/cli/src/test-support.ts:70`, `packages/pds/src/test-support.ts:50`) and every `ctx.clients.*` call site in `packages/cli/src/nodes.ts`, `packages/cli/src/deploy.ts` and `packages/cli/src/microvms.ts` — nor the region split already encoded at `packages/core/src/clients.ts:52,54`.

## Obligations

- **O1 — The four clients join the bundle on the us-east-1 signer, each with a stated reason.**
  - *Claim:* `AwsClients` at `packages/core/src/clients.ts:21` declares `s3tables`, `firehose`, `glue` and `lambda`, `createClients` constructs all four with the `usEast1` `SigningClient` from `:54`, and each carries a doc comment naming the CloudFront-standard-logging constraint, in the shape of the `logsUsEast1` comment at `:28-32`.
  - *Evidence to collect:* read `packages/core/src/clients.ts:21-70`; confirm each of the four appears once in the interface with a doc comment and once in the returned object constructed from `usEast1`, not `signing`.
  - *Checks:* resolve the signer argument at each of the four construction sites — confirm it is the `usEast1` binding declared at `packages/core/src/clients.ts:54`, not the primary `signing` binding at `:52`, and not a freshly constructed `SigningClient` that would bypass `base` (and therefore the endpoint override and credential provider).
  - *Status:* ☐ unverified

- **O2 — A recording-transport test proves the region split both ways.**
  - *Claim:* `packages/core/src/clients.test.ts` builds the bundle with a non-`us-east-1` region and asserts, from captured `authorization` headers, that `s3tables`, `firehose`, `glue` and `lambda` scope to `us-east-1` while `logs`, `s3`, `microvms` and `secrets` scope to the configured region.
  - *Evidence to collect:* run `pnpm test -- clients` and confirm the case names cover both directions; read `packages/core/src/clients.test.ts` and confirm each assertion matches the credential scope substring `/<region>/<signing name>/aws4_request` (the `packages/core/src/aws/signer.test.ts:32` form), not merely the request URL.
  - *Checks:* resolve the `microvms` assertion specifically — confirm it expects `/eu-west-1/lambda/aws4_request`, distinguishing it from the new `lambda` client's `/us-east-1/lambda/aws4_request`; a test that asserts only the signing name would pass for both and prove nothing.
  - *Status:* ☐ unverified

- **O3 — No dead export, no unused dependency.**
  - *Claim:* `pnpm knip` from the repo root reports nothing for `packages/core` or `packages/cli` after the four clients join the bundle.
  - *Evidence to collect:* run `pnpm knip` from the repo root and record the full output; confirm no new entry appears in `knip.json` to suppress a finding introduced by this task.
  - *Status:* ☐ unverified

- **O4 — The changeset decision is recorded.**
  - *Claim:* either a `.changeset/*.md` exists marking a minor on `blogwright-core` covering the four clients and the `LogsClient` delivery-configuration parameters, or the change description states that the changeset is deferred to task 57.
  - *Evidence to collect:* list `.changeset/*.md` and read any file added by this task; if none exists, read the change description (`jj log -r @ -T description`) and confirm it names the deferral to task 57 explicitly.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- clients` and `pnpm knip`; confirm the recorded `authorization` headers show `us-east-1` for the four new clients and `eu-west-1` for `logs`/`s3`/`microvms`/`secrets`, and that `pnpm test -- nodes` still passes with no change to its client fakes (Reviewable).**
  - *Claim:* a reviewer can run those commands and observe the region split in the captured headers, a clean knip report, and a green CLI node suite with an unedited `nodes.test.ts`.
  - *Evidence to collect:* run `pnpm test -- clients`, `pnpm knip` and `pnpm test -- nodes` and record each result; run `jj diff packages/cli/src/nodes.test.ts` and expect an empty diff.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:127` calls `createClients({ region, endpointOverride, credentials })` → expect every pre-existing key on the returned `AwsClients` to keep the signer it had, `microvms` included : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/test-support.ts:69` calls `createClients` and re-wraps each client with `overrideClient` → expect the four new keys to be enumerated there too, so `ClientOverrides` substitutions are honoured rather than silently dropped : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/test-support.ts:50` calls `createClients` → expect `pnpm test` in `packages/pds` to remain green with no edit : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/deploy.ts:75` calls `ctx.clients.microvms.runMicrovm(input)` → expect a request signed for the configured region, not `us-east-1` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the `testClients` widening at `packages/cli/src/test-support.ts:69-88` is a step, not a DoD obligation — but omitting it makes every later node test's `clients.firehose` override a silent no-op, so treat a missing enumeration as a finding even though no obligation names it. The endpoint override (`AWS_ENDPOINT_URL`/floci) still routes all four to the override origin because they are constructed from the same `base` object at `packages/core/src/clients.ts:47-51`; a test for that belongs here only if the reviewer wants it, since `packages/core/src/aws/endpoint.test.ts` already covers the resolver. Whether Firehose and S3 Tables are actually offered in every account's `us-east-1` is an operational question the spec's assumptions cover, not a code obligation.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
