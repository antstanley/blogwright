# Done Certificate — Task 31: Open the transport so a plugin can supply its own AWS services

**Task:** [31-core_transport_seam.md](31-core_transport_seam.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 31. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 31) ≡ every obligation O1…O8 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `resolveEndpoint` and `SendOptions.service` accept a plugin-supplied service descriptor as well as a core `ServiceKey`, so a plugin signs against any AWS service without an edit to core — with `SIGNING_NAMES` unchanged and every existing core request byte-identical.
- **P2 — Obligations.** The task is done iff O1…O8 all hold. One Oi per definition-of-done item, in DoD order; O8 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the MicroVM control-plane path (`packages/core/src/aws/microvms.ts` through `SigningClient.send` at `packages/core/src/aws/signer.ts:96`), the global-service signing rule for `iam`/`cloudfront`/`route53` (`packages/core/src/aws/endpoint.ts:36`), the `AwsError` contract (`packages/core/src/aws/signer.ts:171-193` — `service` is a name, never an object), or the floci endpoint-override route used by `packages/core/src/aws/s3.floci.test.ts`.

## Obligations

- **O1 — `SIGNING_NAMES` stays closed while the seam opens.**
  - *Claim:* `SIGNING_NAMES` at `packages/core/src/aws/endpoint.ts:19-31` is byte-identical to today — it gains NO keys — and `resolveEndpoint`/`SendOptions.service` additionally accept a `{ service, signingName, global? }` descriptor.
  - *Evidence to collect:* read `packages/core/src/aws/endpoint.ts:19-33`; run `jj diff packages/core/src/aws/endpoint.ts` and confirm the `SIGNING_NAMES` literal is untouched; run `grep -rn "s3tables\|firehose\|glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` and expect no output. The exclusion is deliberate and the validator must keep it: O2 requires descriptor cases for those three services in `packages/core/src/aws/endpoint.test.ts`, so an unscoped grep contradicts the obligation below it. `lambda` is not part of this check at all — `SIGNING_NAMES.microvms` is `'lambda'` by design.
  - *Status:* ☐ unverified

- **O2 — `canonicalHost`'s branches are unchanged and a descriptor resolves through its default branch.**
  - *Claim:* `canonicalHost` at `packages/core/src/aws/endpoint.ts:63-78` has no new `case` and no changed output; its parameter widens from `ServiceKey` to `string` because `resolveEndpoint` now passes a resolved name. `resolveEndpoint` returns `s3tables.us-east-1.amazonaws.com`, `firehose.us-east-1.amazonaws.com`, `glue.us-east-1.amazonaws.com` and `lambda.us-east-1.amazonaws.com` for the four descriptors the analytics plugin supplies.
  - *Evidence to collect:* run `pnpm test -- endpoint` › `resolveEndpoint` › `uses canonical hosts without an override` — expect it to pass with an assertion for each of the four hosts; read `packages/core/src/aws/endpoint.ts:63-78` and confirm the `switch` still lists exactly `iam`, `cloudfront`, `route53`, `s3`, `microvms` before `default` and that the only edit on that line is the parameter type.
  - *Status:* ☐ unverified

- **O3 — `microvms` still resolves and signs as before.**
  - *Claim:* `resolveEndpoint('microvms', region, undefined).host` is `lambda.<region>.amazonaws.com` and `SIGNING_NAMES.microvms` is `'lambda'`, unaffected by the plugin's `lambda` descriptor.
  - *Evidence to collect:* run `pnpm test -- endpoint` and confirm a named assertion covers `microvms` host and signing name; read `packages/core/src/aws/endpoint.test.ts:11-13` to confirm the pre-existing assertion survived rather than being replaced.
  - *Checks:* resolve the signing-name lookup at `packages/core/src/aws/signer.ts:124` for `opts.service === 'microvms'` — confirm it reads the `microvms` entry and that `MicrovmsClient.call` at `packages/core/src/aws/microvms.ts:130` still passes `service: 'microvms'`.
  - *Status:* ☐ unverified

- **O4 — Negative space: a descriptor is not global unless it says so, and override still wins.**
  - *Claim:* a descriptor with no `global` flag resolves `signingRegion` to the region passed, a descriptor with `global: true` resolves it to `us-east-1`, and any descriptor under `'http://localhost:4566'` returns `{ protocol: 'http:', host: 'localhost:4566', override: true }`.
  - *Evidence to collect:* run `pnpm test -- endpoint` and confirm all three named tests exist and pass; read `packages/core/src/aws/endpoint.ts:36` and confirm `GLOBAL_SERVICES` still holds exactly `['iam', 'cloudfront', 'route53']` and is still typed `Set<ServiceKey>` over core's keys alone.
  - *Status:* ☐ unverified

- **O5 — All four `service` sites read one resolution helper, each taking the right field.**
  - *Claim:* one exported helper turns `ServiceKey | ServiceDescriptor` into `{ name, signingName, global }`, and `SIGNING_NAMES[opts.service]` (`signer.ts:124`) takes the signing name while `uriEscapePath` (`:135`) and `parseError` (`:163`) take the service name; a descriptor whose service is `s3` gets `uriEscapePath: false` and every other descriptor gets `true`.
  - *Evidence to collect:* read `packages/core/src/aws/signer.ts:120-165` and confirm all four reads go through the one helper rather than re-deriving the value; run `pnpm test -- signer` and confirm one named `uriEscapePath` test per direction. A descriptor is never `'s3'` by identity, so the un-widened comparison silently produces a wrong signature rather than an error — treat an absent test as a defect, not a gap.
  - *Checks:* confirm no site reads the raw `opts.service` union directly after the widening — `grep -n "opts.service" packages/core/src/aws/signer.ts` should show it only where the helper is called.
  - *Status:* ☐ unverified

- **O6 — A plugin-service failure raises an `AwsError` naming the service, not `[object Object]`.**
  - *Claim:* `parseError` is called with the resolved service *name*, its parameter is still `string` (`signer.ts:171`), and the `AwsError` it constructs (`:193`) carries that name for a descriptor-built request.
  - *Evidence to collect:* read `packages/core/src/aws/signer.ts:163,171,193`; run `pnpm test -- signer` and read the test that drives a 400 through a descriptor-built request, confirming it asserts the raised error's `service` field equals the descriptor's `service` string. Widening `parseError`'s parameter to `ServiceKey | ServiceDescriptor` is a defect even though it typechecks — it is the shortcut that silences `TS2345` at `:163` and puts the descriptor object into the error message.
  - *Status:* ☐ unverified

- **O7 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O8 — Run `pnpm test -- endpoint` and `jj diff packages/core/src/aws/endpoint.ts`; confirm the descriptor tests cover the regional, global and override paths plus `microvms`, and that the diff touches `SIGNING_NAMES` not at all (Reviewable).**
  - *Claim:* a reviewer can run those two commands and observe a green endpoint suite and a diff whose `SIGNING_NAMES` literal is unchanged.
  - *Evidence to collect:* run `pnpm test -- endpoint` and record the pass count and test names; run `jj diff packages/core/src/aws/endpoint.ts` and record the added/removed line counts inside and outside the `SIGNING_NAMES` literal.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/core/src/aws/signer.ts:124` resolves the signing name for `opts.service = 'microvms'` → expect `'lambda'` : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/aws/signer.ts:135` computes `uriEscapePath` for `opts.service = 's3'` → expect `false`, and for every other core key → expect `true` : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/aws/signer.ts:163` raises for a 5xx from a core `ServiceKey` request → expect the `AwsError`'s `service` to be that key's own string, unchanged from today : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:285` calls `ctx.clients.microvms.getImage(arn)` → expect a signed request to `lambda.<region>.amazonaws.com/2025-09-09/microvm-images/<id>` : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/aws/signer.ts:96` calls `resolveEndpoint('iam', 'eu-west-1', undefined)` → expect `signingRegion: 'us-east-1'`, `host: 'iam.amazonaws.com'` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the task deliberately adds no `canonicalHost` `case`, no `SIGNING_NAMES` key and no `GLOBAL_SERVICES` entry — any of the three is a defect even if the resulting host string is right, because the service belongs to the analytics plugin and putting it in core is the design this plan explicitly reversed. The widening surfaces exactly one compile error, at `signer.ts:163`, and there are two ways to make it go away: pass the resolved service name (correct) or widen `parseError`'s parameter (wrong, and invisible in green CI — no core test drives a descriptor through a failing response). Check which one was taken before anything else in O6. `grep -rn "s3tables\|firehose\|glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` returning anything is the fastest way to see it. The seam has no consumer in core until task 33 lands, which is expected. Firehose and S3 Tables are not offered in every region; region availability is task 38's concern, not this one.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
