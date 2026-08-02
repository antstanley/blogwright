# Done Certificate - Task 35: GlueClient in blogwright-analytics

**Task:** [35-analytics_glue_client.md](35-analytics_glue_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 35. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 35) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** A `GlueClient` exposing exactly two operations - create the `s3tablescatalog` federation and look one up - with the lookup returning `undefined` when absent so the node can adopt an existing federation, and create idempotent on already-exists.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the shared signing seam (`SigningClient.send` at `packages/core/src/aws/signer.ts:95`) or the barrel export surface consumed by `packages/cli/src/context.ts:5` and `packages/pds/src/test-support.ts:13`.

## Obligations

- **O1 - The surface is exactly two operations.**
  - *Claim:* `GlueClient` in `packages/analytics/src/aws/glue.ts` declares `createCatalogFederation` and `getCatalogFederation` and no other public method.
  - *Evidence to collect:* read the class body of `packages/analytics/src/aws/glue.ts` and enumerate every public method; confirm each maps to a call the catalog-integration node makes per the change spec §Analytics pipeline → Resource nodes (`analytics-catalog-integration`).
  - *Status:* ☐ unverified

- **O2 - Absent lookup yields `undefined`; create is idempotent on already-exists.**
  - *Claim:* `getCatalogFederation` returns `undefined` when the federation does not exist and the mapped domain value when it does; `createCatalogFederation` returns normally when the service reports an already-exists error.
  - *Evidence to collect:* run `pnpm test -- glue` and confirm three named cases exist - a populated `GetCatalog`-style response expecting the mapped value, an `EntityNotFoundException` body expecting `undefined`, and an `AlreadyExistsException` body on create expecting `resolves.toBeUndefined()`.
  - *Checks:* resolve `err.isNotFound` and `err.isAlreadyExists` at the catch sites in `packages/analytics/src/aws/glue.ts` against the regexes at `packages/core/src/aws/errors.ts:27,33` - confirm `EntityNotFoundException` matches `NotFound` and `AlreadyExistsException` matches `AlreadyExists`, so neither branch relies on a code the predicates do not actually cover.
  - *Status:* ☐ unverified

- **O3 - Request shapes are pinned and non-not-found errors are rethrown with context.**
  - *Claim:* `packages/analytics/src/aws/glue.test.ts` asserts the `x-amz-target` header and the parsed request body for both operations, and a `ValidationException` fed back to either operation produces a rejection whose message names the operation and the catalog.
  - *Evidence to collect:* read `packages/analytics/src/aws/glue.test.ts` and confirm both operations have header and body assertions plus a `ValidationException` rejection case; run `pnpm test -- glue` and record the case names.
  - *Checks:* grep the test file for `fetchTransport`, `fetch(` and `AWS_ENDPOINT_URL` - expect no match, confirming substitution at the `Transport` port.
  - *Status:* ☐ unverified

- **O4 - Exported and not dead.**
  - *Claim:* `packages/analytics/src/index.ts` re-exports `./aws/glue.js`, `packages/core` is untouched, and `pnpm knip` reports no unused export for the new module.
  - *Evidence to collect:* read `packages/analytics/src/index.ts` and confirm the export line keeps the barrel alphabetical; run `grep -rn "glue" packages/core/src --include='*.ts' --exclude='*.test.ts'` and expect no output; run `pnpm knip` from the repo root - expect a clean report.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Run `pnpm test -- glue`; confirm the suite covers present, absent, already-exists and non-not-found, and that the class body declares no third public method (Reviewable).**
  - *Claim:* a reviewer can run the filtered suite, observe four named behavioural cases, and read a two-method class.
  - *Evidence to collect:* run `pnpm test -- glue` and record the pass count and case names; read `packages/analytics/src/aws/glue.ts` and count the public methods.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:5` imports from `blogwright-core` → expect `packages/core/src/index.ts` to be unchanged and every existing named export to still resolve : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/test-support.ts:13` imports `createClients` from `blogwright-core` → expect `pnpm test` in `packages/pds` to remain green : ☐ (PRESERVED / REGRESSION)

Otherwise: new code with no existing callers - `GlueClient` is first consumed by task 49.

## Residue

Notes for the validator: the adopt-rather-than-create policy and the no-op delete live in the node (task 49); this task only has to make adoption expressible by returning `undefined`. A `deleteCatalog` method appearing here is a defect - the account-scoped integration is never deleted by the plugin. Glue request shapes cannot be validated without real AWS, so a body that diverges from the published API reference is a defect even with a green suite.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
