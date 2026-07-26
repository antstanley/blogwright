# Done Certificate — Task 35: LambdaClient in blogwright-core, distinct from MicrovmsClient

**Task:** [35-core_lambda_client.md](35-core_lambda_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 35. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 35) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** A `LambdaClient` for the standard Lambda function API sharing the host and signing name with `MicrovmsClient` but none of its paths, with the relationship stated in a module doc comment and proved by a test asserting no request carries the `/2025-09-09/` prefix.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the MicroVM builder path — `packages/core/src/aws/microvms.ts` (`API` at `:13`, `PATHS` at `:15-21`) and its callers in `packages/cli/src/nodes.ts:285,335,351,360,377,387`, `packages/cli/src/deploy.ts:75,252,263,273` and `packages/cli/src/microvms.ts:22,60` — nor the barrel export surface consumed by `packages/cli/src/context.ts:5`.

## Obligations

- **O1 — The surface is exactly what the transform-function node needs.**
  - *Claim:* `LambdaClient` in `packages/core/src/aws/lambda.ts` declares `createFunction`, `getFunction`, `updateFunctionCode`, `updateFunctionConfiguration` and `deleteFunction` and no other public method, each with a typed input rather than an untyped object.
  - *Evidence to collect:* read the class body and exported interfaces of `packages/core/src/aws/lambda.ts`; cross-check each method against the `analytics-transform-function` node in the change spec §Analytics pipeline → Resource nodes — any method with no node behind it is speculative.
  - *Status:* ☐ unverified

- **O2 — The two clients are documented and provably disjoint.**
  - *Claim:* `packages/core/src/aws/lambda.ts` opens with a doc comment naming the shared host and signing name and the `/2025-09-09/` split, and `packages/core/src/aws/lambda.test.ts` asserts that every recorded request URL starts with `/2015-03-31/functions` and that none contains `/2025-09-09/`.
  - *Evidence to collect:* read the module doc comment at the head of `packages/core/src/aws/lambda.ts`; run `pnpm test -- lambda` and confirm a named case asserts the absence of the `/2025-09-09/` prefix across every recorded URL; run `grep -n "2025-09-09" packages/core/src/aws/lambda.ts` and expect matches only inside the doc comment.
  - *Checks:* resolve the `service` field passed to `SigningClient.send` in `packages/core/src/aws/lambda.ts` — confirm it is the `lambda` key added at `packages/core/src/aws/endpoint.ts:19`, not `microvms`, and that `SIGNING_NAMES.lambda` and `SIGNING_NAMES.microvms` both yield the signing name `lambda` so the two clients reach the same host by design rather than by accident.
  - *Status:* ☐ unverified

- **O3 — Absence is `undefined`, delete is re-runnable, other failures keep context.**
  - *Claim:* `getFunction` returns `undefined` on `AwsError.isNotFound`, `deleteFunction` resolves on `isNotFound`, and any other failure rejects with the operation and function name in the message.
  - *Evidence to collect:* run `pnpm test -- lambda` and confirm three named cases — a `ResourceNotFoundException` get expecting `undefined`, a `ResourceNotFoundException` delete expecting `resolves.toBeUndefined()`, and a `500` expecting `rejects.toThrow` with a message containing the function name.
  - *Checks:* resolve the rethrow construction in `packages/core/src/aws/lambda.ts` — confirm it preserves `code`, `statusCode` and `requestId` from `packages/core/src/aws/errors.ts:8-21` rather than throwing a bare `Error`.
  - *Status:* ☐ unverified

- **O4 — Exported and not dead.**
  - *Claim:* `packages/core/src/index.ts` re-exports `./aws/lambda.js`, and `pnpm knip` reports no unused export for the new module.
  - *Evidence to collect:* read `packages/core/src/index.ts` and confirm the export line sits between `./aws/iam.js` and `./aws/logs.js`; run `pnpm knip` from the repo root — expect a clean report.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- lambda` and `grep -rn "2025-09-09" packages/core/src/aws/lambda.ts packages/core/src/aws/lambda.test.ts`; confirm the suite is green, the grep matches only the test's negative assertion, and `packages/core/src/aws/microvms.ts` still owns every `/2025-09-09/` path (Reviewable).**
  - *Claim:* a reviewer can run those two commands and observe a green Lambda suite with no MicroVM path anywhere in the new client's request construction.
  - *Evidence to collect:* run `pnpm test -- lambda` and record the pass count and case names; run the grep and record every match with its surrounding line; run `jj diff packages/core/src/aws/microvms.ts` and confirm the only change is the added doc-comment pointer.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/nodes.ts:285` calls `ctx.clients.microvms.getImage(arn)` → expect `GET /2025-09-09/microvm-images/<id>` on `lambda.<region>.amazonaws.com`, unchanged : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/deploy.ts:75` calls `ctx.clients.microvms.runMicrovm(input)` → expect `POST /2025-09-09/microvms`, unchanged : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/context.ts:5` imports from `blogwright-core` → expect the widened barrel at `packages/core/src/index.ts` to still resolve every existing named export : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: `LambdaClient` is first consumed by task 50 (the transform-role and transform-function nodes), and its region pinning is task 37's obligation. The zip upload path — whether the function code is passed inline or by S3 reference — is a node decision (task 50); this task only has to type the code-location input. Adding a `MicrovmsClient` method or a `/2025-09-09/` path to `LambdaClient` is a defect regardless of test outcome, since it re-merges the two surfaces the doc comment separates.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
