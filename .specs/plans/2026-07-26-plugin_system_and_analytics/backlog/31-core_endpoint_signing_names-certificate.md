# Done Certificate — Task 31: Add s3tables, firehose, glue and lambda to the AWS endpoint resolver

**Task:** [31-core_endpoint_signing_names.md](31-core_endpoint_signing_names.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 31. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 31) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `resolveEndpoint` accepts `s3tables`, `firehose`, `glue` and `lambda`, each resolving to its canonical regional host under its own signing name, with `microvms` provably unchanged.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the MicroVM control-plane path (`packages/core/src/aws/microvms.ts` through `SigningClient.send` at `packages/core/src/aws/signer.ts:96`), the global-service signing rule for `iam`/`cloudfront`/`route53` (`packages/core/src/aws/endpoint.ts:36`), or the floci endpoint-override route used by `packages/core/src/aws/s3.floci.test.ts`.

## Obligations

- **O1 — The four keys join `SIGNING_NAMES` without disturbing an existing entry.**
  - *Claim:* `SIGNING_NAMES` at `packages/core/src/aws/endpoint.ts:19` contains `s3tables: 's3tables'`, `firehose: 'firehose'`, `glue: 'glue'` and `lambda: 'lambda'`, and every pre-existing key/value pair — `s3`, `sts`, `iam`, `logs`, `acm`, `cloudfront`, `route53`, `microvms: 'lambda'`, `secretsmanager` — is unchanged.
  - *Evidence to collect:* read `packages/core/src/aws/endpoint.ts:19-33`; run `jj diff packages/core/src/aws/endpoint.ts` and confirm the hunk inside `SIGNING_NAMES` is additive only (four added lines, zero removed, zero modified).
  - *Status:* ☐ unverified

- **O2 — `canonicalHost` is unchanged and the four keys resolve through its default branch.**
  - *Claim:* `canonicalHost` at `packages/core/src/aws/endpoint.ts:63-78` has no new `case`, and `resolveEndpoint` returns `s3tables.us-east-1.amazonaws.com`, `firehose.us-east-1.amazonaws.com`, `glue.us-east-1.amazonaws.com` and `lambda.us-east-1.amazonaws.com` for the four new keys.
  - *Evidence to collect:* run `pnpm test -- endpoint` › `resolveEndpoint` › `uses canonical hosts without an override` — expect it to pass with an assertion for each of the four hosts; read `packages/core/src/aws/endpoint.ts:63-78` and confirm the `switch` still lists exactly `iam`, `cloudfront`, `route53`, `s3`, `microvms` before `default`.
  - *Status:* ☐ unverified

- **O3 — `microvms` still resolves and signs as before.**
  - *Claim:* `resolveEndpoint('microvms', region, undefined).host` is `lambda.<region>.amazonaws.com` and `SIGNING_NAMES.microvms` is `'lambda'`, unaffected by the new `lambda` key.
  - *Evidence to collect:* run `pnpm test -- endpoint` and confirm a named assertion covers `microvms` host and signing name; read `packages/core/src/aws/endpoint.test.ts:11-13` to confirm the pre-existing assertion survived rather than being replaced.
  - *Checks:* resolve `SIGNING_NAMES[opts.service]` at `packages/core/src/aws/signer.ts:124` for `opts.service === 'microvms'` — confirm it reads the `microvms` entry, not the new `lambda` entry, and that `MicrovmsClient.call` at `packages/core/src/aws/microvms.ts:130` still passes `service: 'microvms'`.
  - *Status:* ☐ unverified

- **O4 — Negative space: not global, and override still wins.**
  - *Claim:* for each of the four keys `resolveEndpoint(key, 'eu-west-1', undefined).signingRegion` is `eu-west-1` (they are absent from `GLOBAL_SERVICES`), and `resolveEndpoint(key, 'eu-west-1', 'http://localhost:4566')` returns `{ protocol: 'http:', host: 'localhost:4566', override: true }`.
  - *Evidence to collect:* run `pnpm test -- endpoint` and confirm both named tests exist and pass; read `packages/core/src/aws/endpoint.ts:36` and confirm `GLOBAL_SERVICES` still holds exactly `['iam', 'cloudfront', 'route53']`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- endpoint` and `jj diff packages/core/src/aws/endpoint.ts`; confirm the tests cover all four new keys plus `microvms`, and the diff adds only four lines inside `SIGNING_NAMES` (Reviewable).**
  - *Claim:* a reviewer can run those two commands and observe a green endpoint suite covering five keys and a four-line additive diff.
  - *Evidence to collect:* run `pnpm test -- endpoint` and record the pass count and test names; run `jj diff packages/core/src/aws/endpoint.ts` and record the added/removed line counts.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/core/src/aws/signer.ts:124` calls `SIGNING_NAMES[opts.service]` with `opts.service = 'microvms'` → expect `'lambda'` : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/nodes.ts:285` calls `ctx.clients.microvms.getImage(arn)` → expect a signed request to `lambda.<region>.amazonaws.com/2025-09-09/microvm-images/<id>` : ☐ (PRESERVED / REGRESSION)
- `packages/core/src/aws/signer.ts:96` calls `resolveEndpoint('iam', 'eu-west-1', undefined)` → expect `signingRegion: 'us-east-1'`, `host: 'iam.amazonaws.com'` : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the task deliberately adds no `canonicalHost` `case` and no `GLOBAL_SERVICES` entry — an added `case` for any of the four keys is a defect even if the host string is right, because it duplicates the default branch. The `lambda` key is unused until task 35 lands, so `pnpm knip` will not flag it (the map is a single exported constant) but a reviewer should expect no consumer yet. Firehose and S3 Tables are not offered in every region; region availability is task 37's concern, not this one.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
