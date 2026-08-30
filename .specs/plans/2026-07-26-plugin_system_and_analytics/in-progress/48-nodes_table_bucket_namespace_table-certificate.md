# Done Certificate - Task 48: The S3 Tables bucket, namespace and page_views table nodes

**Task:** [48-nodes_table_bucket_namespace_table.md](48-nodes_table_bucket_namespace_table.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 48. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 48) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** The first three nodes of the plugin's graph exist in `packages/analytics/src/nodes.ts` - table bucket, namespace and `page_views` table - chained by `dependsOn`, reconcilable in both directions against a mocked transport, and carrying no column literal of their own.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break the site's own graph (`packages/cli/src/nodes.ts:1053` `buildNodes` and its node set), the shared client bundle's region split (`packages/core/src/clients.ts:42-70`), or task 39's schema module, which this task reads and must not edit.

## Validation method

The diff is two new files (`packages/analytics/src/nodes.ts`, 340 lines; `packages/analytics/src/nodes.test.ts`, 498 lines) in workspace `/Users/ant/code/blogwright-task-48` at base `a858abf7` (build 34/62, task 41).

Evidence was produced by an **independent** mutation sweep written by this validator, not by re-checking the implementer's. Harness at
`<scratch>/task48-verify/mutate.py`: for each of **38** mutations it (1) verifies every source file byte-identical to the pristine backup, (2) runs an **unmutated control** which must report `19 passed (19)` with no vite/transform/reporter error, (3) applies the mutation only after asserting the target string occurs exactly once, (4) re-runs and records the *named* failing `it` blocks, (5) restores and re-verifies byte-identity. The reporter used is `--reporter=verbose`, which exists in vitest 4 (the run banner reads `RUN v4.1.10`); a run that died in vite would fail the control gate and be reported as `CONTROL_FAILED`. **No control run failed and no harness error was detected in any of the 38 runs.**

Every mutation was restored. Byte-identity of `nodes.ts`, `nodes.test.ts`, `schema.ts`, `aws/s3tables.ts`, `aws/clients.ts` and `config.ts` against the recorded revision was re-proved after the sweep (`jj file show -r @ <path> | diff - <path>` → no output for all six), and `jj st` shows exactly the two added files with no third path touched.

## Obligations

- **O1 - Three chained nodes, incremental recording, and the pinned client.**
  - *Claim:* `analytics-table-bucket`, `analytics-namespace` and `analytics-table` implement `read`/`create`/`delete`, chain bucket → namespace → table through `dependsOn`, record each identifier into the plugin's scoped state as its resource is created, and reach AWS only through the plugin's own `createAnalyticsClients(ctx)` bundle (task 38) - never through `ctx.clients`, which carries only core's services, which signs against `us-east-1` whatever `config.region` says.
  - *Evidence collected:*
    - `nodes.ts:247-268,271-299,302-340` - three factories, `dependsOn: []` / `['analytics-table-bucket']` / `['analytics-namespace']`, each with `read`/`create`/`delete`.
    - `nodes.ts:145-147` is the **only** route to a client: `createAnalyticsClients(ctx).s3tables`. `grep -nE "fetch\(|from 'node:|require\(|@aws-sdk" packages/analytics/src/nodes.ts` → no hits. `ctx.clients` appears nowhere in `nodes.ts` (`grep -n "ctx.clients"` → no hits).
    - `nodes.ts:322-334` records identity **before** the secondary `getTable`.
    - Region observability: no client is injected; `makeContext` builds core's real bundle in `eu-west-1` and the nodes construct their own us-east-1 bundle through `createAnalyticsClients`. The transport is the seam. The real recorded header, printed by temporarily replacing the scope assertion with a value probe (restored immediately), is
      `AWS4-HMAC-SHA256 Credential=AKIA/20260830/us-east-1/s3tables/aws4_request, SignedHeaders=…` - i.e. literally `/us-east-1/s3tables/` while `ctx.config.region === 'eu-west-1'` (asserted at `nodes.test.ts:448`).
  - *Falsifiability (independent mutations):*
    - `dependsOn: [TABLE_BUCKET_NODE] → []` and `dependsOn: [NAMESPACE_NODE] → []` each redden exactly `chains table bucket -> namespace -> table`.
    - `const TABLE_NODE = 'analytics-table' → 'analytics-tables'` reddens 6 tests, including the `ResourceNode[]` assignability test.
    - Dropping the `recordTableBucket`/`recordNamespace` call in `create` reddens exactly that node's create test (1 each).
    - Dropping `ctx.record(nodeId, outputs)` inside `output()` reddens 8 tests.
    - **The hazard, both forms:** `clients.ts` `signingUsEast1 → signing` reddens **13** tests including `signs every call against us-east-1 while config.region says otherwise`; and having the node build its own `new S3TablesClient(ctx.clients.signing)` instead of using the bundle reddens the same 13. The pin is observable, not asserted.
    - Control-only survivor of note: changing `ANALYTICS_REGION` to `eu-west-1` reddens 12 tests (all the URL assertions) but **not** the credential-scope test - confirming the constant is ARN *text* only and does not enforce the pin, exactly as `nodes.ts:75-85` documents. (Doc nit: that comment says the region test catches a divergence between the text and the signature; strictly, the *suite* catches it, not that one test.)
  - *Status:* ☑ SATISFIED

- **O2 - The table is built from the schema module.**
  - *Claim:* `analytics-table` derives `page_views` from `packages/analytics/src/schema.ts`'s column set and `day` partition, with no column name, type or partition literal in `nodes.ts`.
  - *Evidence collected:*
    - `nodes.ts:187-224` - `pageViewsFields()` maps `PAGE_VIEWS_COLUMNS`; `pageViewsSchema()` finds the partition source by `PAGE_VIEWS_PARTITION_COLUMN` and raises with context if it is absent rather than falling through to `sourceId: 0`.
    - A grep of `nodes.ts` for every one of the twenty column names, `page_views`, `web`, and every Iceberg primitive type name as a string literal returns **no hits**. The only literals in the file are node ids, the region text, and the `identity` transform.
    - `createTable`'s contract (`aws/s3tables.ts:333-349`) expresses everything the mapping needs - `name`, `ICEBERG` format, `metadata.iceberg.schema.fields{name,type,id,required}` and `partitionSpec.fields{name,source-id,transform,field-id}`. Nothing the node needs is inexpressible through the client; no client change was required, confirming the implementer's report.
  - *Falsifiability:* twelve independent mutations, each reddening exactly `carries every schema.ts column, in order, with positional field ids`:
    - in `nodes.ts`: `id: index + FIRST_FIELD_ID → index`; `PARTITION_TRANSFORM 'identity' → 'day'`; `type: column.icebergType → 'string'`; `required: column.required → true`; `sourceId: partitionSource.id → 1`; dropping `partitionSpec` entirely.
    - in `schema.ts`: rename `visitor_key → visitor_id`; retype `bytes_sent long → int`; `PAGE_VIEWS_PARTITION_COLUMN 'day' → 'host'`; swap the `query`/`method` rows; append a column; flip `host` from required to optional.
    - The `visitor_key` rename produces the named diff the Reviewable line asks for: `- "name": "visitor_key" / + "name": "visitor_id"` at `nodes.test.ts:424`.
  - *Judgement on positional field ids:* the reasoning holds **at this tree**. Iceberg field ids are persisted in table metadata and in data files, so renumbering is only safe while no previously-sent id is ever compared to a later one. The client offers `createTable`/`getTable`/`deleteTable` and no schema-evolution operation, and `createTable` explicitly does not reconcile an existing table's schema (`aws/s3tables.ts:321-331`), so the ids only have to agree within one request - which the comment at `nodes.ts:171-185` states. The bound to watch: if a later task adds an Iceberg-REST or `UpdateTable` commit path, positional ids stop being safe under reorder/removal, because the evolved schema's ids must then match the ones already persisted. That is a future constraint, not a defect here.
  - *Judgement on `identity` vs `day`:* correct. `day` is a `date` column the transform Lambda computes from `timestamp(ms)` (`schema.ts:59-60,197-198`), so the partition value *is* the column value; Iceberg's `day` transform truncates a timestamp to a date and would be right only when partitioning on `event_time`. The spec requires "partitioned by `day`" (§Table schema), which `identity` on the `date` column delivers.
  - *Status:* ☑ SATISFIED

- **O3 - Absence and idempotence in both directions.**
  - *Claim:* each `read` returns `false` without throwing when the resource is absent, and each `delete` is a no-op when it is already gone.
  - *Evidence collected:* six cases exist, one per node per direction (`nodes.test.ts:248,269,288,308,331,378`). Each absent-read asserts `resolves.toBe(false)` (a throw fails the assertion) **and** `ctx.state.resources` is `{}` - an empty entry would claim a resource that does not exist. Each delete asserts `resolves.toBeUndefined()` plus the recorded `DELETE` method and URL, so a node that skipped the call is not silently passing. The 404 fixture is built the way S3 Tables actually answers - `x-amzn-errortype` header plus a body of `{"message": …}` only - which is the shape that makes `AwsError.code === "Http404"` and forces the `statusCode === 404` limb, so the fixture is not a friendlier error than production sends.
  - *Present → adopted* is covered by the three "reads an existing …" cases, each asserting the recorded state.
  - *Non-404 failures reject:* not restated here, correctly - the nodes delegate with no `try`/`catch`, and the rethrow is pinned at the client (`aws/s3tables.test.ts:386,392,400` - `rethrows a 500` on get, create and delete). `destroyGraph` (`packages/cli/src/graph.ts:89-100`) calls `delete` unconditionally with no prior `read`, which is exactly what makes the already-gone no-op load-bearing.
  - *Falsifiability:* removing each absence guard reddens exactly that node's absent-read test (3 mutations, 1 test each); removing each `delete` call reddens exactly that node's delete test (3 mutations, 1 test each).
  - *Status:* ☑ SATISFIED

- **O4 - Names come from the resolved analytics config.**
  - *Claim:* the bucket, namespace and table names are read from task 44's resolved `analytics` config, not from `ctx.names`, and the two-environment collision test lives with the module owning the derivation.
  - *Evidence collected:*
    - `grep -n "ctx.names\|siteName" packages/analytics/src/nodes.ts` → **no hits** in code (two doc-comment mentions of `config.region` only). **No `siteName` is concatenated anywhere in `nodes.ts`** - the one path task 44's seal cannot block is not taken.
    - Every name flows through `resolveAnalyticsConfig(ctx)` (`nodes.ts:164,235,242,259,279,288,295,308,323,336`), the only route to `tableBucket`.
    - The bucket ARN is derived in the exact form `aws/s3tables.ts:236-255` tells the caller to compute - `arn:aws:s3tables:<region>:<accountId>:bucket/<name>` - matching `createTableBucket`'s documented "the caller already holds the ARN it needs". `arn:aws:` hard-coding matches repo precedent (`packages/cli/src/nodes.ts:20,28,34`).
    - **Seal re-proved from this module:** rewriting `tableBucketArn` as ``ctx.pluginConfig.tableBucket ?? `${ctx.config.siteName}-analytics` `` yields `src/nodes.ts(164,91): error TS2339: Property 'tableBucket' does not exist on type 'AnalyticsConfig'` under `tsc -p tsconfig.typecheck.json`. Restored.
    - The two-environment assertion is **not** restated here (`grep -n "staging\|production" nodes.test.ts` → no hits) and lives with the deriving module at `config.test.ts:239` - `derives a different table bucket and a different salt secret for each environment`.
  - *Falsifiability:* `bucket/${resolveAnalyticsConfig(ctx).tableBucket}` → `bucket/${ctx.names.bucket}` reddens 12 tests; hard-coding the namespace `'web'` or the table `'page_views'` in the create calls each reddens `takes all three names from the resolved analytics config, never from ctx.names`. That test overrides all three names, so it is not satisfiable by a defaults-only implementation.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected (all six gates, from the workspace root, in CI order):*
    - `pnpm build` - Done (all five packages).
    - `pnpm typecheck` - Done (all four packages; the analytics `tsconfig.typecheck.json` includes `*.test.ts`, so the `ResourceNode[]` assignability annotation is a real compile-time check).
    - `pnpm test` - build-agent, pds `100 passed`, analytics `12 files / 325 passed`, cli `22 files / 317 passed`; zero failures.
    - `pnpm lint` - exit 0. `pnpm --filter blogwright-analytics lint` - exit 0, no diagnostics on either new file. (The seven `no-shadow` warnings are pre-existing, in `packages/cli/src/nodes.test.ts`, untouched by this task.)
    - `pnpm exec oxfmt --check .` - "All matched files use the correct format", 166 files.
    - `pnpm knip` - exit 0, **no findings**.
    - Named constants: `FIRST_FIELD_ID`, `ANALYTICS_REGION`, `PARTITION_TRANSFORM`, and the three node-id constants. No magic number or bare literal.
    - No changeset: nothing operator-visible ships, because `buildAnalyticsNodes`/`Plugin.nodes` are task 54's and the module is unreachable from the CLI. Consistent with sibling tasks 33/39/44 in `.changeset/`.
  - *Knip honesty check:* `nodes.ts` is deliberately absent from the barrel, matching `config.ts`, `schema.ts` and `aws/clients.ts` (`index.ts:16-19` exports only the four AWS clients). It is clean because `nodes.test.ts` is a knip entry through the vitest plugin - and that consumer is **real, not manufactured**: 35 of 38 mutations to the production module redden a named test, so the test exercises the exports rather than mentioning them. Nothing was added to make a gate green.
  - *Status:* ☑ SATISFIED

- **O6 - Run the node tests, alter a column and confirm the payload test fails (Reviewable).**
  - *Claim:* a reviewer can run the package's node tests, break one column in `schema.ts`, and observe the table-node payload test fail naming that column, with the region test showing `/us-east-1/s3tables/`.
  - *Evidence collected:* the `Reviewable:` line as written -
    - `pnpm --filter blogwright-analytics exec vitest run nodes --reporter=verbose` inside `packages/analytics` → `Test Files 1 passed (1) / Tests 19 passed (19)`, all 19 named.
    - `visitor_key → visitor_id` in `schema.ts` → `Tests 1 failed | 18 passed (19)`, the single failure being `the page_views create payload > carries every schema.ts column, in order, with positional field ids` with the diff `- "name": "visitor_key" / + "name": "visitor_id"` at id 19. Restored; `jj st` shows `schema.ts` absent from the change and `jj file show -r @- … | diff` reports it byte-identical to the parent commit.
    - Recorded `authorization` header, read directly: `Credential=AKIA/20260830/us-east-1/s3tables/aws4_request` while `config.region = eu-west-1`.
  - *Status:* ☑ SATISFIED

## Falsifiability audit

Every one of the 19 `it` blocks is reddened by at least one independent mutation, with the failure landing on the block that names the behaviour:

| `it` | reddened by |
|---|---|
| chains table bucket -> namespace -> table | M01, M02, M03 |
| is assignable to the SPI's own `ResourceNode[]` | M03 (plus the `tsc` annotation) |
| bucket: reads an existing bucket, hydrates ARN | M09, M14 |
| bucket: reads false when absent, records nothing | M04 |
| bucket: creates and records its ARN | M07, M09 |
| bucket: deletes an already-absent bucket | M29 |
| namespace: reads an existing namespace | M10, M14 |
| namespace: reads false when absent | M05 |
| namespace: creates and records | M08, M10 |
| namespace: deletes an already-absent namespace | M30 |
| table: reads existing, hydrates the ARN only GetTable supplies | M11 |
| table: reads false when absent | M06 |
| table: creates then hydrates via a second lookup | M12 |
| table: records the name even when the ARN lookup finds nothing | M12 |
| table: records through `ctx.record`, not by assigning into state | M13 |
| table: deletes an already-absent table | M31 |
| payload carries every schema column, in order, positional ids | M17–M22, M32–M37 |
| signs every call against us-east-1 while config.region says otherwise | M24, M25 |
| takes all three names from the resolved config, never `ctx.names` | M26, M27, M28 |

**The `output()` read-back is load-bearing.** Replacing `return ctx.state.resources[nodeId] ?? outputs` with `return outputs` reddens exactly `records through ctx.record, not by assigning into ctx.state directly` - the test substitutes a host whose `record` stores a copy, and both writes only land because the handle is read back out of `state`. `output()` writes through `ctx.record`, the SPI's only sanctioned route (`packages/core/src/plugin.ts:143-152`), and is never called on a `read` that found nothing.

**Three mutations survived**, all accounted for and none of them making a shipped assertion vacuous:

- **M38** (dropping `(us-east-1)` from a node title) - by design. The titles do carry the pin (`nodes.ts:251,275,306`), and asserting it is task 54's own obligation: `54-…-certificate.md:31` requires `us-east-1` to appear in the captured bootstrap output "carried by the node titles", and `54-….md:13` makes writing them the step. Correctly deferred, not untested-by-omission.
- **M15** (`output()` starting from `{}` instead of the existing entry) - the doc's "re-recorded rather than replaced" property is currently inert: no node calls `output()` twice. It is defensive for tasks 49–51/53, which append nodes to this module. Correct behaviour, unexercised claim.
- **M16** (moving the `output()`/`out.name` pair *after* the `getTable` lookup) - see D1 below.

## Regression check

- `packages/cli/src/nodes.ts:1053` `buildNodes(ctx)` → PRESERVED. The change touches no CLI file; `pnpm test` in `packages/cli` is `22 files / 317 passed`, including `nodes.test.ts`. No analytics node can reach the site's graph: `nodes.ts` is not in the barrel and `Plugin.nodes` is unwired until task 54.
- `packages/core/src/clients.ts:42` `createClients({ region: 'eu-west-1' })` → PRESERVED. `nodes.test.ts` builds exactly that bundle and the S3 Tables calls still sign `us-east-1` (`aws/clients.test.ts` and the region test both green); core is unmodified by this change.
- Task 39's `schema.ts` and task 33's `aws/s3tables.ts` → PRESERVED, byte-identical to the parent commit after the sweep.

## Integration check

- The bookmark `plugin-system-and-analytics` advanced to **db8db370, build 36/62** during this review (task 23 and task 45 landed after this task's base `a858abf7`).
- Both new paths are **absent at the tip** (`jj file list -r plugin-system-and-analytics packages/analytics/src` lists neither), and the change touches nothing else, so the merge is a **clean pure-add**. Verified by construction: a temporary workspace at the tip plus the two files reproduces exactly `A packages/analytics/src/nodes.ts` / `A packages/analytics/src/nodes.test.ts`.
- Symbols resolve against the current tree: at the merged tip, `tsc -p tsconfig.typecheck.json` in `packages/analytics` is clean, `vitest run` is `13 files / 401 passed`, `vitest run nodes` is `19 passed`, and `knip` exits 0 with no findings. The only relevant tip delta is additive (`Names` gained `githubRole`; `ports.ts`/`queries.ts` are new), and `nodes.ts` reads neither.
- **The contract's `ports.ts`/`queries.ts` mention:** the implementer was right to read the tree as it was. Those files did not exist at `a858abf7`; they arrived with task 45 at build 36. Nothing in `nodes.ts` or `nodes.test.ts` depends on them, and their arrival changes nothing here (proved by the merged-tip run above).

## Residue

- The `output(ctx, id)` duplication of `packages/cli/src/nodes.ts:20-22` is unavoidable (a plugin may not import the CLI) and **is** stated in a comment (`nodes.ts:108-133`), which also records the one behavioural difference: it writes through `ctx.record` rather than assigning into `ctx.state.resources`.
- The spec's open question on record expiration for the table is not covered by the DoD and stays open.
- The adapter question is settled: task 33 returns `undefined` for absence rather than throwing (`aws/s3tables.ts:272,306,365`), so each node's absence path is real rather than a swallowed error - and its 404-only narrowing is pinned by `aws/s3tables.test.ts:386-403`, which proves a 500 still rejects.
- Tagging: `CreateTableBucket` carries no tags in this client and the spec's node table asks for none. The `create` still records identity before any secondary call, so adding a `TagResource` follow-up later needs no reordering.

## Defects

Neither of the two below blocks the merge; both are recorded so the next reader does not have to rediscover them.

- **D1 (low) - `packages/analytics/src/nodes.ts:330-333`: the incremental-recording *ordering* is unpinned.** The named test (`records the table name even when the ARN lookup after CreateTable finds nothing`) scripts `getTable` → 404, which the client turns into `undefined` rather than a throw - so moving `const out = output(…); out.name = …` to *after* the lookup leaves the whole suite green (mutation M16 survived). The ordering is genuinely load-bearing: `applyGraph`'s `catch` calls `ctx.save()` before rethrowing (`packages/cli/src/graph.ts:76-84`), so a `getTable` that *rejects* (a 500, a throttle) is exactly the case where recording-first saves the table from being orphaned. Failure scenario: a future refactor moves the recording below the lookup; `CreateTable` succeeds, `GetTable` 500s, `create` rejects, `applyGraph` saves a state file with **no** `analytics-table` entry, and the next `analytics destroy --yes` leaves a real table behind. The missing case is one `it`: script `ok({})` then a 500, assert `create` rejects and `ctx.state.resources` still holds `{ 'analytics-table': { name: 'page_views' } }`.
- **D2 (low) - `packages/analytics/src/nodes.ts:318,333`: an empty-string ARN can reach state on a malformed 200.** `normalizeTable` (`aws/s3tables.ts:101-107`) falls back to `arn: res.tableARN ?? ''`, and the node's only guard is `created !== undefined`. The 404 miss is handled correctly and is tested; a 200 whose body omits `tableARN` would record `arn: ''` from either `read` or `create` - a domain-empty value in `state/<env>.analytics.json`, which DEVELOPMENT.md §Error handling bans in spirit. Unreachable while the service honours its own response model (`tableARN` is a required member of `GetTableResponse`), which is why this is a hardening note rather than a bug: `if (created?.arn)` closes it. The bucket and namespace nodes have no exposure - both re-derive their identifiers and ignore the response body.
- **Doc nit** - `nodes.ts:80-84` claims the recording-transport test catches a divergence between `ANALYTICS_REGION` and what the clients sign. Measured: changing `ANALYTICS_REGION` reddens 12 tests but *not* the credential-scope one, because the scope comes from the signer and the constant only reaches the ARN. The suite catches it; that sentence names the wrong test.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: **high**
SUMMARY: All six obligations are SATISFIED against collected evidence - three chained nodes reaching AWS only through the pinned plugin bundle with a directly-read `/us-east-1/s3tables/` credential scope under `config.region = eu-west-1`, a `page_views` payload carrying no literal of its own and reddening under twelve independent schema and mapping mutations, six absence/idempotence cases, all names sealed behind `resolveAnalyticsConfig` with `siteName` concatenated nowhere and the `TS2339` seal re-proved from this module, all six repo gates green at both the base and the current tip, and every one of the 19 `it` blocks shown falsifiable by a 38-mutation sweep whose every control run reported `19 passed`; the two residual defects (an unpinned recording *order* and an empty-ARN path unreachable under the service's response model) are recorded rather than blocking.
