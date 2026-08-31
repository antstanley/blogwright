# Done Certificate - Task 49: The account-scoped Glue catalog integration node

**Task:** [49-nodes_catalog_integration.md](49-nodes_catalog_integration.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 49. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 49) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `analytics-catalog-integration` adopts an existing account-and-region-scoped Glue `s3tablescatalog` federation rather than creating one, and its `delete` is a no-op, so a second environment never re-creates it and a teardown never removes it.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 48's three nodes or their tests, and must not change `packages/cli/src/graph.ts:89-99` `destroyGraph`, which calls every node's `delete` unconditionally - the reason this node's inertness has to live in the node itself.

## Validation environment

Diff under review: workspace `/Users/ant/code/blogwright-task-49`, change `vttmwpvo 75baae4e`, parent
`spqwwnnw 8a052a5e` = `plugin-system-and-analytics` at build 39 (task 48). Two files changed:
`packages/analytics/src/nodes.ts` (+222/-10) and `packages/analytics/src/nodes.test.ts` (+297/-10).

Mutation harness: mutations applied to `packages/analytics/src/nodes.ts` in place, one at a time,
each followed by a restore from a pre-recorded copy. Baseline SHA-256 recorded before the sweep and
re-verified after it, identical both times:

```
818139030387ccfa761a3b07c19b7a8052ecab7a64e62abd770b332d3b5991ab  packages/analytics/src/nodes.ts
aaf7ddfd34965c9fe22381733d3d8a2c4594360bf4b2499657a922573f75c0bb  packages/analytics/src/nodes.test.ts
```

`jj diff --stat` after the sweep reports the same two files and the same line counts as before it.
**No code was edited by this gate; every mutation was restored and the restore proven by hash.**

## Obligations

- **O1 - The node and its dependency.**
  - *Claim:* `analytics-catalog-integration` declares `dependsOn: ['analytics-table']` and creates the Glue `s3tablescatalog` federation Firehose reads the table through, via the `glue` client from `createAnalyticsClients(ctx)` (task 38).
  - *Evidence collected:* `packages/analytics/src/nodes.ts:504-558` - `id: CATALOG_NODE` (`'analytics-catalog-integration'`, :79), `dependsOn: [TABLE_NODE]` (:507). The create call is `client.createCatalogFederation(CATALOG_NAME, source)` (:526), which is task 35's `GlueClient.createCatalogFederation` (`packages/analytics/src/aws/glue.ts:225`) issuing `AWSGlue.CreateCatalog`.
  - *Checks:* the client is resolved through `glue(ctx)` (`nodes.ts:184-186`), which is `createAnalyticsClients(ctx).glue` - the plugin's own bundle over `ctx.clients.signingUsEast1` (`aws/clients.ts:74-84`). No locally constructed client and no `ctx.clients.glue` (core's bundle enumerates no `glue` key at all, so that would not compile). Recorded request URLs in the suite are `https://glue.us-east-1.amazonaws.com/` while `config.region` is `eu-west-1`, so the pinned signer is what signed them.
  - *Mutation:* `dependsOn: [TABLE_NODE]` -> `[]` reddens `hangs off analytics-table and assigns to the SPI's own ResourceNode[]` (1 failure); control 34/34 before it.
  - *Status:* ☑ SATISFIED

- **O2 - Adopt, not create; and an inert delete.**
  - *Claim:* `read()` returns true for an already-existing integration and `delete()` performs no call, with a destroy over the node set issuing no Glue call at all.
  - *Evidence collected:* `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` in `packages/analytics` - 34/34 passing, 22 of them task 48's unmodified.
    - Adopt: `adopts an existing federation and issues no CreateCatalog` - `read` resolves `true` and `targets(requests)` is asserted as the whole list `['AWSGlue.GetCatalog']`, not as an absent error.
    - Inert delete: `nodes.ts:542-556` is a body of comment and nothing else; `GlueClient` exposes no delete operation, so there is no call to make by accident.
    - Destroy sweep: `issues no Glue call at all when the whole node set is torn down` asserts `requests.filter((r) => r.url.startsWith(GLUE_HOST))` is `[]` **on a recording transport**, and pins the three S3 Tables `DELETE`s (`DELETE .../tables/...`, `.../namespaces/...`, `.../buckets/...`) as the proof the loop ran and the transport was recording. Both halves verified: the negative assertion is over a recorded request log, and the positive assertion makes it non-vacuous.
  - *Checks:* `destroyGraph` (`packages/cli/src/graph.ts:99-113`) calls `node.delete(ctx)` then `delete ctx.state.resources[node.id]` then `ctx.save()`. Reaching this node's `delete` produces no request and no throw, so the loop continues to `analytics-table`; the environment's own state entry is dropped while the shared federation survives, which is the intended outcome. The engine is not imported by `packages/analytics` (its only dependency is `blogwright-core`, `package.json:21-23`), so the test's hand-rolled reverse walk is necessary and, for a linear chain, identical to `topoSort(...).reverse()`.
  - *Mutation:* `delete()` -> `delete(ctx) { await glue(ctx).getCatalogFederation(CATALOG_NAME); … }` reddens exactly `issues no Glue call at all when the whole node set is torn down` (1 failure). The empty-Glue-log assertion is therefore live, not vacuous.
  - *Status:* ☑ SATISFIED

- **O3 - Second-environment convergence.**
  - *Claim:* with the integration already present, `create` is never invoked for a second environment's context.
  - *Evidence collected:* `lets a second environment in the same account adopt the same federation, creating nothing`. It builds a second context and overrides `env` to `'production'`, asserts the two environments really differ (`resolveAnalyticsConfig(production).tableBucket` is not `resolveAnalyticsConfig(staging.ctx).tableBucket` - so a per-bucket federation would be unadoptable), then asserts both `read`s resolve `true` and that each context's whole call log is `['AWSGlue.GetCatalog']`. `AWSGlue.CreateCatalog` is absent from both.
  - *Checks:* convergence rests on `federationSource` (`nodes.ts:298-314`) returning the account-and-region wildcard `arn:aws:s3tables:us-east-1:<account>:bucket/*` rather than this environment's bucket. Both environments derive the identical string, so both adopt the one catalog.
  - *Mutation (M5):* `federationSource` -> `tableBucketArn(ctx)` reddens 6 tests including this one; control 34/34 before it. The convergence property is genuinely pinned by this test.
  - *Mutation (M12):* per-environment catalog name reddens 2 tests (`reads false … recording nothing`, which asserts the request body `{ CatalogId: 's3tablescatalog' }` against a constant spelled independently in the test file, and `creates the federation …`, which asserts `Name`). It does **not** redden the second-environment test - see Residue.
  - *Status:* ☑ SATISFIED

- **O4 - Operator-visible scoping and the why comment.**
  - *Claim:* the node's `title` and create log line state that the integration is account-and-region scoped, and a comment on `delete` explains why it is a no-op rather than restating the code.
  - *Evidence collected:* `title` (`nodes.ts:508`) is ``Glue s3tablescatalog federation (shared - account-and-region scoped, us-east-1)``; `applyGraph` prints it on both branches (`create …` and `… (exists)`), so an adopting run shows the scoping too. The create line (`nodes.ts:523-525`) reads "enabling the s3tablescatalog Glue federation over `<source>` - account-and-region scoped, shared with every other environment in this account and never removed by a teardown". The `delete` comment (`nodes.ts:543-555`) names the consequence concretely - production's delivery stream left with no catalog, records routed to its error bucket, with nothing in either environment's output saying what was taken away - and cites the `ensureOidcProvider` precedent (`packages/core/src/aws/iam.ts:112`, "Account-global; never deleted here") it follows. It explains why, not what.
  - *Mutations:* dropping "shared" from the title, and dropping "account-and-region scoped" from the log line, each redden `names the integration as shared, account-and-region scoped state where an operator sees it` (1 failure each). The test also pins `expect(steps).toHaveLength(1)`.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected*, all run from the workspace root `/Users/ant/code/blogwright-task-49`:
    - `pnpm build` - exit 0 (all five packages plus docs).
    - `pnpm test` - exit 0: core 149 passed/1 skipped, build-agent 27, pds 117, analytics 440, cli 327.
    - `pnpm lint` - exit 0. The 29 warnings are pre-existing `no-shadow` warnings in `packages/cli/src/nodes.test.ts`; nothing in `packages/analytics`.
    - `pnpm exec oxfmt --check .` - "All matched files use the correct format", 174 files.
    - `pnpm knip` - exit 0, no output.
    - Changeset: none added, matching task 48, which added none either (`jj diff -r @- --stat` lists only the two source files and the plan-file moves). The node is not yet reachable from any command - no `buildAnalyticsNodes` assembles it - so the change is not user-facing.
    - Named constants: `CATALOG_NAME`, `ALL_TABLE_BUCKETS`, `CATALOG_NODE`, `ANALYTICS_REGION`. No magic literals introduced.
  - *Status:* ☑ SATISFIED

- **O6 - Run the node tests inside `packages/analytics` and confirm the empty Glue call log and the delete comment (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests and observe a destroy case asserting an empty Glue call log, and read a `delete` comment naming the consequence for other environments.
  - *Evidence collected:* the `Reviewable:` line as written - `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` inside `packages/analytics` - exits 0 with **34 passed (34)**, every one named in the verbose output. The destroy case asserts `expect(requests.filter((request) => request.url.startsWith(GLUE_HOST))).toStrictEqual([])` - an empty recorded call list, not an absent error - alongside the three pinned S3 Tables `DELETE`s. The `delete` body (`nodes.ts:542-556`) states the consequence for the other environment as required.
  - *Status:* ☑ SATISFIED

## Independent verification of the mechanism

The gate re-derived the implementer's central argument against task 35's landed client rather than
accepting it.

1. **`createCatalogFederation`'s resolution carries no information.** `aws/glue.ts:225-241`: the
   `catch` is `if (err instanceof AwsError && err.isAlreadyExists) return;`, and
   `AwsError.isAlreadyExists` is `/AlreadyExists|…/i` over `code`
   (`packages/core/src/aws/errors.ts:32`), which `FederatedResourceAlreadyExistsException` matches.
   The method returns `Promise<void>` on both the created and the swallowed path. Confirmed.
2. **`FromFederationSource` is unreachable from the node.** `parseError`
   (`packages/core/src/aws/signer.ts:177-200`) reads only `__type`/`code`/`Code` and
   `message`/`Message` out of the body and constructs `AwsError` from `{service, code, message,
   statusCode, requestId}` (`errors.ts:1-21`). Any sibling body field is discarded. So the flag is
   not observable without editing core or task 35's landed client, neither of which this contract
   opened. Confirmed.
3. **Therefore the read-back is the only available discriminator**, and a `getCatalogFederation`
   returning `undefined` immediately after a `createCatalogFederation` that resolved is a genuine
   contradiction under the modelled behaviours. Confirmed.
4. **The fusion holds.** `recordCatalogIntegration` (`nodes.ts:367-376`) calls
   `verifiedSource(ctx, federation)` on its first line and only then `output(ctx, CATALOG_NODE)`.
   Both of the node's recording paths - `read`'s adopt (:517) and `create`'s post-read-back (:540) -
   go through it, so recording without verification is unreachable. Swapping those two lines
   (record before verify) reddens both `refuses …` tests, which assert `ctx.state.resources` is
   `{}`; the ordering is pinned, not merely written.
5. **No green-on-broken path exists.** Exhaustively: `read` -> absent -> `create` -> either a real
   create (read-back verifies) or a swallowed already-exists (read-back either verifies the source
   or is `undefined` and throws). `read` -> present -> verified or thrown. A catalog of the right
   name that is unfederated or wrongly federated **fails loudly inside `read`** and never falls
   through to a create that `isAlreadyExists` would swallow. Verified by the two `refuses …` tests
   and by mutation M7.

## Convergence design - judgement

The wildcard source is **right**. Three independent reasons:

- It is what AWS's own S3 Tables integration registers, which task 35's client documents
  (`aws/glue.ts:195-202`) and which the response shape echoes back.
- A per-bucket source is not adoptable: staging would find a catalog federating production's
  bucket and either adopt a federation not covering its own table or try to register a second one
  under an account-scoped name. M5 demonstrates exactly this - 6 tests redden, the
  second-environment test among them.
- It grants nothing extra. Breadth of *access* is set by
  `CreateDatabaseDefaultPermissions`/`CreateTableDefaultPermissions` = `IAM_ALLOWED_PRINCIPALS`/`ALL`,
  which task 35 owns and documents; the identifier only decides which buckets the one catalog
  *mounts*. And the node creates only when no catalog exists at all, so it can never widen an
  account that already had one.

Note for the record: the routed finding's literal instruction - "verify the federation's
`sourceIdentifier` matches **the configured table bucket ARN**" - would have been a bug. A correctly
federated catalog carries the wildcard, so that check would throw on every healthy account and the
node would never converge. The implementer deviated from the finding's letter, kept its intent, and
documented the deviation at `nodes.ts:298-314`. The gate endorses the deviation.

**`connectionName` unchecked - second opinion.** The argument (`nodes.ts:342-346`) is that a catalog
federating exactly this account's buckets over a connection other than `aws:s3tables` is not a
producible state. The gate finds this defensible but not airtight: `CreateCatalog` accepts an
arbitrary `ConnectionName`, so a third party could in principle leave such a catalog behind, and
adopting it would reproduce precisely the silent-misconfiguration class the routed finding was
about. Against that: `CatalogFederation.connectionName` is already carried, so the check is one
`&&`; but the realistic failure (a wrong or unresolvable source) is fully covered by the source
check plus the read-back, and a second condition adds a second way to fail on a state nobody has
observed. Disposition: acceptable as shipped, recorded as residue rather than a defect.

## Divergence from task 48 - judgement

`analytics-table.create` records identity **before** its follow-up `getTable`
(`nodes.ts:464-468`); `analytics-catalog-integration.create` records **after** its follow-up
`getCatalogFederation` (`nodes.ts:534-540`). The divergence is **justified and consistency should
not win**:

- Task 48's early record exists to protect `destroy` - a crash between create and lookup must still
  leave the table in state for `delete` to remove. Here `delete` removes nothing, so an early
  record protects nothing.
- Worse, an early record would defeat the fix: an entry under this node's id is the claim that the
  pipeline has a verified catalog to read through, and later nodes (`analytics-firehose-stream`
  depends on this one per the spec's ordering) will interpolate it. Recording before verification
  would put an unverified - potentially absent - catalog identity into
  `state/<env>.analytics.json`.
- Pinned by M10: inserting `output(ctx, CATALOG_NODE).name = CATALOG_NAME;` immediately after
  `createCatalogFederation` reddens `records nothing when the read-back after CreateCatalog throws`
  **and** `fails loudly when the federation is still unreadable after CreateCatalog reported
  success` (2 failures). The comment at the test explains the divergence where a reader meets it.

## Falsifiability sweep - independently re-run

The implementer's table was **not accepted**. The gate designed and ran its own 13-mutation sweep
against `nodes.ts`, with a control run immediately before each batch (34/34 every time) and a
restore after each mutation.

| # | Mutation | Failures | Tests killed |
|---|---|---|---|
| control | none | 0 | 34/34 pass |
| M5 | `federationSource` -> `tableBucketArn(ctx)` | 6 | log line, create, adopt, no-ARN adopt, read-back throw, **second environment** |
| M6 | skip the read-back in `create`, record a synthesised federation | 3 | create, read-back-absent, read-back-throws |
| M7 | `verifiedSource` accepts anything | 2 | both `refuses …` tests |
| M10 | record before the read-back | 2 | read-back-absent, read-back-throws |
| M12 | per-environment catalog name | 2 | reads-false (body `CatalogId`), create (body `Name`) |
| - | `delete` issues a Glue call | 1 | destroy sweep |
| - | unconditional `out.arn = federation.resourceArn` | 1 | no-ARN adopt |
| - | `dependsOn: []` | 1 | node identity |
| - | create log line drops "account-and-region scoped" | 1 | operator-visibility |
| - | `title` drops "shared" | 1 | operator-visibility |
| - | `verifiedSource` called after `output` | 2 | both `refuses …` tests |
| - | `read` returns `true` when the federation is absent | 1 | reads-false |
| - | `ANALYTICS_REGION` -> `eu-west-1` | **19** | 12 of task 48's + 7 of this task's; the credential-scope test **passes**, as its comment claims |

Every one of the 12 new `it`s appears in at least one kill set of the gate's *own* mutations - not
the implementer's - so every new test can fail. Request counts are pinned where it matters: the
403 read-back case asserts `expect(requests).toHaveLength(2)`, and core's signer retries a
non-idempotent `POST` only on a network-level `TypeError`
(`packages/core/src/aws/signer.ts:155-156`), so the scripted 400/403 replies cannot inflate the
count. The comment in that test states this correctly.

## Prose re-measurements - independently verified

Two measured claims in task 48's comments were edited because this change falsified them. Both
re-measured by this gate:

1. `nodes.ts:6-11` "the first three … remaining nine" -> "the first four … remaining eight". The
   spec's node table (`2026-07-26-analytics_plugin.md:293-306`) has exactly twelve rows; four are
   now implemented. Correct.
2. `nodes.ts:110-114` "`eu-west-1` … reddens twelve of them" -> "reddens nineteen tests". Measured
   directly: setting `ANALYTICS_REGION = 'eu-west-1'` produces **19 failed / 15 passed of 34**, and
   `signs every call against us-east-1 while config.region says otherwise` is **not** among the
   failures. The failure list decomposes as 12 pre-existing (11 bucket/namespace/table cases plus
   `takes all three names from the resolved analytics config`) + 7 new, which independently confirms
   the *old* "twelve of 22" was also accurate. This is a genuine re-measurement, not a guess.

## Regression check

- `packages/analytics/src/nodes.ts` task 48 chain (`analytics-table-bucket` -> `analytics-namespace`
  -> `analytics-table`) reconciled through the same test harness -> the three earlier nodes'
  create/delete call sequences are unchanged by the appended node : ☑ **PRESERVED**. `jj diff` on
  `nodes.test.ts` has exactly four hunks and the only deleted lines are the two `import` statements
  (verified by `grep '^-'` over the patch): **all 22 of task 48's tests pass unmodified, with no
  expected value edited**. Test count 22 -> 34 (`grep -c '^  it('` at `@-` and at `@`). The only
  edits to landed code in `nodes.ts` are the two prose counts above and the extraction of
  `tableBucketArn`'s body into `s3TablesBucketArn(ctx, bucket)`, which is behaviour-preserving -
  the three task-48 nodes' recorded ARNs and request URLs are unchanged and are asserted verbatim.
- `packages/cli/src/graph.ts:99` `destroyGraph` over a node set containing an inert-delete node ->
  the loop continues to the next node and still writes state, as it does for `bucketPolicyNode`
  (`packages/cli/src/nodes.ts:867-869`), which has the same `async delete() { // reason }` shape : ☑
  **PRESERVED**. `graph.ts` is untouched by this diff; cli's 327 tests pass.
- Merge cleanliness: the workspace's parent *is* the `plugin-system-and-analytics` bookmark head, so
  a plain merge is trivially clean today. Tasks 43, 46 and 18 are still in flight; their diffs touch
  `packages/analytics/src/transform*`, `src/adapters/duckdb-query*`, `knip.json`,
  `packages/analytics/package.json`, `tsconfig.json`, `pnpm-lock.yaml` and `packages/cli/src/*` -
  **no overlap with `nodes.ts` or `nodes.test.ts`**, so a plain merge stays clean in any landing
  order : ☑ **PRESERVED**.

## Residue

This is the one node in the graph whose lifecycle deliberately differs from every other; a
conventional create/delete node here breaks the other environment's pipeline, so a reviewer who
"fixes" the empty `delete` reintroduces the fault. **A future reader is protected by both the
comment and a test**: the destroy sweep reddens when `delete` is made to issue a Glue call, verified
by mutation. Carried forward:

- **The disclosed gap, judged sufficient.** The read-back is verified only against a mocked
  transport; whether AWS makes a just-created catalog immediately readable is not establishable in
  this repo (the floci emulator does not implement Glue). The gate accepts the implementer's trade:
  if AWS is eventually consistent here, the symptom is a loud, actionable error on first bootstrap
  that **self-heals on re-run** - the next `read` finds the catalog and adopts it - rather than a
  silent green over a federation wired to nothing, which is exactly the exchange the routed finding
  asked for. The obligation is discharged. **Record for a later real-AWS pass:** confirm a
  `GetCatalog` immediately after `CreateCatalog` returns the catalog.
- **Second item for that same real-AWS pass.** `verifiedSource` compares `sourceIdentifier` by
  exact string equality against a locally built ARN. The documented response shape echoes the
  identifier as sent, so this is right on paper, but it is the same mock boundary as the read-back
  and its failure mode is harsher: a normalization difference would block every bootstrap in an
  account whose catalog is *correct*, rather than failing once and self-healing. Worth confirming
  against a real account at the same time.
- **`connectionName` is not checked** (see the second opinion above). Cheap to add if a real account
  ever shows a same-source, wrong-connection catalog.
- **Test-design nuance on M12.** The second-environment test alone is insensitive to a
  per-environment catalog name, because the scripted transport answers any `GetCatalog` with the
  same body; it does not assert that the two environments look the *same* catalog id up. The
  property is still covered by the suite - M12 reddens two other tests whose body assertions spell
  `CatalogId`/`Name` against a constant declared independently in the test file - so this is a note,
  not a gap.
- **Operator-visibility advisory, low severity.** `destroyGraph` logs `deleted ${node.title}` for
  every node, so `analytics destroy` will print "deleted Glue s3tablescatalog federation (shared -
  account-and-region scoped, us-east-1)" although nothing was removed. This is engine behaviour that
  `bucket-policy` already exhibits, not something this task introduced, but on a node whose whole
  purpose is to protect shared account state it is the one place the output says the opposite of
  what happened.
- **Message advisory, low severity.** `verifiedSource`'s error tells the operator to "Remove or
  rename that catalog". For the true positive (an unrelated catalog squatting on the name) that is
  correct advice; for a false positive it directs the operator to delete account-shared state that
  this same node insists must never be removed. A clause noting that `s3tablescatalog` is shared
  account-wide and that other consumers should be checked first would close the gap.
- The spec's open question on whether one table bucket per environment duplicates this integration's
  reasoning (`2026-07-26-analytics_plugin.md:772-775`) stays open.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All six obligations are SATISFIED on collected evidence - 34/34 node tests including
task 48's 22 unmodified, an empty-Glue-call destroy sweep proven non-vacuous by a recording
transport plus three pinned S3 Tables deletes, a second-environment convergence case, and six clean
repo gates - with the adopt-or-create mechanism, the record-after-verify fusion, the wildcard
convergence design and both re-measured prose counts independently re-derived by this gate and
pinned by its own 13-mutation sweep, leaving only three low-severity advisories and two items
recorded for a later real-AWS pass.
