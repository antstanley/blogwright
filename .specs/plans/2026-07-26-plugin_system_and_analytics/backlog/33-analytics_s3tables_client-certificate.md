# Done Certificate — Task 34: S3TablesClient in blogwright-core

**Task:** [33-analytics_s3tables_client.md](33-analytics_s3tables_client.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 33. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 34) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** An `S3TablesClient` over the shared SigV4 transport exposing create/get/delete for table buckets, namespaces and tables, with absence returned as `undefined`, creates idempotent on already-exists, and every request shape pinned by a transport-mocked test.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break the shared signing seam (`SigningClient.send` at `packages/core/src/aws/signer.ts:95`), the barrel export surface consumed by `packages/cli/src/context.ts:5` and `packages/pds/src/test-support.ts:13`, or the `s3` service key's path-style/`uriEscapePath` handling at `packages/core/src/aws/signer.ts:135`.

## Obligations

- **O1 — The surface is exactly the nine operations the nodes need.**
  - *Claim:* `S3TablesClient` in `packages/analytics/src/aws/s3tables.ts` declares `createTableBucket`, `getTableBucket`, `deleteTableBucket`, `createNamespace`, `getNamespace`, `deleteNamespace`, `createTable`, `getTable`, `deleteTable` and no other public method, each named and typed in domain vocabulary rather than mirroring the raw API response.
  - *Evidence to collect:* read the class body of `packages/analytics/src/aws/s3tables.ts` and enumerate every public method; cross-check each against a call site planned in the change spec §Analytics pipeline → Resource nodes (`analytics-table-bucket`, `analytics-namespace`, `analytics-table`) — any method with no node behind it is speculative.
  - *Status:* ☐ unverified

- **O2 — Absence, idempotency and contextual failure.**
  - *Claim:* each `get*` returns `undefined` on `AwsError.isNotFound`, each `create*` returns normally on `AwsError.isAlreadyExists`, and every other failure is rethrown as an `AwsError` whose message names the operation and the offending bucket/namespace/table name.
  - *Evidence to collect:* run `pnpm test -- s3tables` and confirm named cases exist for (a) a `NotFoundException` body producing `undefined` from a `get*`, (b) an already-exists body producing no throw from a `create*`, and (c) a `500` body producing a rejection whose message contains both the operation name and the resource name; read the `catch` blocks in `packages/analytics/src/aws/s3tables.ts` and confirm none returns without re-raising outside those two predicates.
  - *Checks:* resolve the rethrow construction in `packages/analytics/src/aws/s3tables.ts` — confirm it preserves `code`, `statusCode` and `requestId` from the original `AwsError` (`packages/core/src/aws/errors.ts:8-21`) so `isNotFound`/`isAlreadyExists` still narrow for callers, rather than throwing a bare `Error`.
  - *Status:* ☐ unverified

- **O3 — Every request shape is pinned by a transport-mocked test.**
  - *Claim:* `packages/analytics/src/aws/s3tables.test.ts` constructs the client through `new SigningClient({ region, credentials, transport })` with a stub `Transport` and asserts the HTTP method, path and parsed request body for all nine operations; no test performs network I/O.
  - *Evidence to collect:* run `pnpm test -- s3tables` and record the case names; read `packages/analytics/src/aws/s3tables.test.ts` and confirm every operation has a recorded `{ method, url, body }` assertion.
  - *Checks:* grep `packages/analytics/src/aws/s3tables.test.ts` for `fetchTransport`, `fetch(` and `AWS_ENDPOINT_URL` — expect no match, confirming the suite substitutes at the `Transport` port rather than patching a global.
  - *Status:* ☐ unverified

- **O4 — Exported and not dead.**
  - *Claim:* `packages/core/src/index.ts` re-exports `./aws/s3tables.js`, and `pnpm knip` reports no unused export for the new module.
  - *Evidence to collect:* read `packages/core/src/index.ts` and confirm the export line sits between `./aws/s3.js` and `./aws/secretsmanager.js`; run `pnpm knip` from the repo root — expect a clean report.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 — Run `pnpm test -- s3tables`; confirm all nine operations pin a method, a path and a request body against a stub `Transport`, and that no test constructs `fetchTransport` or calls `fetch` (Reviewable).**
  - *Claim:* a reviewer can run the filtered suite and observe nine pinned request shapes with no network access.
  - *Evidence to collect:* run `pnpm test -- s3tables` and record the pass count and case names; run `grep -n "fetch" packages/analytics/src/aws/s3tables.test.ts` and expect no match.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/cli/src/context.ts:5` imports `createClients` from `blogwright-core` → expect the widened barrel at `packages/core/src/index.ts` to still resolve every existing named export : ☐ (PRESERVED / REGRESSION)
- `packages/pds/src/test-support.ts:13` imports `createClients` from `blogwright-core` → expect `pnpm test` in `packages/pds` to remain green : ☐ (PRESERVED / REGRESSION)

Otherwise: new code with no existing callers — `S3TablesClient` is first consumed by task 48.

## Residue

Notes for the validator: the risk this task carries is that the S3 Tables request shapes are unverifiable without real AWS — a wrong body passes every transport-mocked assertion and fails only against the service. The pinned method/path/body assertions are the only net, so a reviewer should treat a path that does not match the published API reference as a defect even though the suite is green. Table-bucket name length and character rules are validated in the analytics config block (task 44), not here. `pnpm knip` will not flag an unused export because `index.ts` re-exports the module wholesale; the real consumer arrives with task 48.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
