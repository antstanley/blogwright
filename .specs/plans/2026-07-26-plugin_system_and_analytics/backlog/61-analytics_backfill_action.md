# Task 61 - The `analytics backfill` action, and the analytics spec's merge

**Plan:** [plan.md](../plan.md) · **Certificate:** [61-analytics_backfill_action-certificate.md](61-analytics_backfill_action-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Backfill of historical logs (Add)](../../../changes/2026-07-26-analytics_plugin.md) (settled 2026-07-27: a declared, optional, one-shot action reading the site's CloudWatch log group through core's existing `LogsClient.filterEvents`, producing rows identical to the Firehose path's, idempotent by construction) and §Analytics plugin → Namespace and commands (the `analytics backfill` row) and the Decision *`analytics backfill` is a declared, optional action*, plus §Merge plan steps 5–6, deferred here by task 58 because this task lands the spec's last outstanding block
**Depends on:** 41, 46, 47, 53, 58
**Produces:** `blogwright analytics backfill` fills whole pre-Firehose days from `names.cloudfrontLogGroup` into the `page_views` table - each event through the same mapping, `visitor_key` derivation and drop rules as the transform Lambda, written through the new `AnalyticsIngest` port - inserting nothing the Firehose path wrote and nothing twice; the package README gains the action's entry; and the analytics change spec is merged
**Pointers:** `packages/analytics/src/backfill.ts` (new - the command body behind the stub task 47 declared in `packages/analytics/src/commands.ts`), `packages/analytics/src/ports.ts` (task 45 - `AnalyticsIngest` (`insertDay(day, rows)`) joins `AnalyticsQuery` there), `packages/analytics/src/adapters/duckdb-ingest.ts` (new - the write adapter beside task 46's `duckdb-query.ts`; the dashboard's attach stays read-only), `packages/core/src/aws/logs.ts:71` (`filterEvents` - the read path; no new client and no new core operation), `packages/analytics/src/transform/map-record.ts` and `transform/visitor-key.ts` (tasks 40/41 - the mapping and `dailySalt`/`visitorKey` this command reuses; a historical day's salt is `HMAC-SHA256(secret, day)`), `packages/analytics/src/nodes.ts` (task 53 - the `createdDay` the delivery node records, this command's idempotency bound), `packages/analytics/README.md` (task 58 - the five steady-state actions; the `backfill` entry lands here), [the analytics change spec](../../../changes/2026-07-26-analytics_plugin.md) (its `Status:` line and §Merge plan steps 5–6, which task 58 deferred here), `.specs/README.md` §Change specs (the pending list, whose last entry this task removes - line anchors are deliberately not given for a file this plan's own tasks keep editing), `.specs/changes/merged/` (the destination this task moves the file to)

> **ROUTED FINDING - added 2026-08-30 from task 46's implementation.**
> `packages/analytics/src/adapters/**` is **missing** from the root
> `.oxlintrc.json` `no-restricted-imports` override list, which covers
> `packages/core/src/adapters/**` and `packages/cli/src/adapters/**` but not
> analytics'. So a real adapter in this package - which is what
> `duckdb-ingest.ts` is - cannot import `node:fs` without failing `pnpm lint`,
> even though the architecture explicitly sanctions adapters doing exactly that.
> Task 46 hit this and worked around it rather than widening the list: its test
> checks file existence through `createNodeFileSystem()` from `blogwright-core`,
> which is what the rule's own message directs a non-adapter module at. That
> port has `exists` but no delete, so its temp files carry `randomUUID` tokens
> because nothing can clean them up.
> If this task needs real filesystem access, do not copy that workaround by
> default and do not silently widen the override either. Decide which is right
> and say so: the override list is a statement about where the architecture
> permits I/O, and analytics' absence from it looks like an oversight from when
> the package had no adapters rather than a deliberate exclusion.

> **ROUTED FINDING - added 2026-08-31 from task 53's verification gate.**
> **Implementing §Backfill literally will skip a refusal you need.** The spec
> says the refusal fires "when the plugin's scoped state carries **no delivery
> record**". Task 53 produces a state in which there IS a delivery record and
> the bound is missing: its `read` hydrates `source`, `destination`,
> `distribution` and `delivery: 'configured'` from AWS, but deliberately omits
> `createdDay`, because `createdDay` is written once in `create` and nowhere
> else - a lost state file must not be refilled with today's date, since a
> fabricated later bound would double-insert.
> So `read` returns true, `create` never runs, and the record exists without a
> bound. Under a literal reading of §Backfill your refusal does not fire, and
> the next step computes "days strictly before `undefined`".
> **Refuse on an absent `createdDay` as well as on an absent record**, and make
> the message actionable - the operator's real remedy is to supply the bound,
> not to re-bootstrap. Note also that task 53 keeps `CREATED_DAY_KEY`
> module-private, so you will restate the `'createdDay'` string; that was
> deliberate (exporting a constant with no consumer is what `pnpm knip`
> catches), but it means the two spellings must agree and nothing checks that.

## Steps

- [ ] Declare `AnalyticsIngest` in `packages/analytics/src/ports.ts` as `insertDay(day, rows)` beside `AnalyticsQuery`, with a doc comment stating it exists for the one-shot backfill and that the dashboard's read path never receives it; write the recording fake beside it.
- [ ] Write the DuckDB write adapter in `packages/analytics/src/adapters/duckdb-ingest.ts`, attaching with the same explicit credentials as task 46's read adapter but NOT read-only, committing each `insertDay` as one transaction, and mapping vendor errors into the repo's vocabulary at the boundary.
- [ ] Fill the `backfill` body behind task 47's stub in `packages/analytics/src/backfill.ts`: read `createdDay` from the plugin's scoped state (task 53) and fail before any AWS call with a message naming `blogwright analytics bootstrap` when it is absent; compute the candidate range as whole UTC days strictly before `createdDay`, bounded below by `retention.cloudfrontDays`.
- [ ] For each candidate day: skip it when the table already holds rows for that day (one `AnalyticsQuery` count through the existing port); otherwise read the day's events through `ctx.clients.logsUsEast1.filterEvents(names.cloudfrontLogGroup, { startTime, endTime })`, map each through task 40's `mapRecord` with task 41's `visitorKey(ip, ua, dailySalt(secret, day))` - the salt secret read once through the plugin's us-east-1 `SecretsManagerClient` - apply the same drop rules, and hand the surviving rows to `insertDay` in one transaction.
- [ ] Report what happened: the days inserted, the days skipped and why, and the boundary day deliberately left to Firehose - matching the spec's stated one-day precision limit at the seam.
- [ ] Write the tests: the identical-row property (one fixture event through task 42's Firehose envelope and through the backfill path yields deep-equal rows); the bound (no row with day ≥ `createdDay` is ever handed to `insertDay`, asserted on the recording fake); the skip (a day the fake reports occupied gets no insert); the re-run no-op (a second run against the fake's recorded state inserts nothing); and the missing-`createdDay` refusal naming `blogwright analytics bootstrap`. No test starts DuckDB - the adapter is substituted at the port.
- [ ] Add the `backfill` entry to `packages/analytics/README.md` (task 58 deliberately left it out): what it reads, the whole-days-before-`createdDay` bound, the idempotency contract, and that it is optional and one-shot. Add the `AnalyticsIngest` row to DEVELOPMENT.md's ports table beside task 58's `AnalyticsQuery` row, and write the changeset for the new user-facing action.
- [ ] Execute the analytics spec's §Merge plan steps 5–6, deferred here by task 58: flip its `Status:` to `Merged` with a `Merged:` date, move it to `.specs/changes/merged/`, re-point every relative link inside the moved file (`../../packages/…` and `../../DEVELOPMENT.md` gain a level; both companion specs are already in `merged/`, so their links become sibling-relative), carry its two open questions forward per task 58's triage, and remove its entry from `.specs/README.md`'s pending list, which this leaves empty.

## Definition of done

- [ ] The `backfill` command declared at task 47 has its body here, and the identical-row property is asserted: one fixture CloudFront event through the Firehose envelope path and through the backfill path yields deep-equal `page_views` rows, including `visitor_key` (derived for the historical day from the one stored secret) and `is_bot`.
- [ ] Idempotency is by construction and tested in both directions: only whole UTC days strictly before the recorded `createdDay` are ever handed to `insertDay` (negative test on the recording fake), an occupied day is skipped, a re-run inserts nothing, and each inserted day is one transaction - so the Firehose path's rows are never duplicated and neither are the backfill's own.
- [ ] The read path is core's existing `LogsClient.filterEvents` over `ctx.clients.logsUsEast1` and nothing else - no new client, no new core operation (`git diff` shows no change under `packages/core/`), and the write crosses `AnalyticsIngest`, whose DuckDB adapter is the only new module importing `@duckdb/node-api` - `grep -rn "@duckdb" packages/analytics/src/` still finds it only under `adapters/`, and task 46's read adapter stays read-only.
- [ ] A missing `createdDay` (analytics never bootstrapped, or bootstrapped before task 53's recording) fails before any AWS call with a message naming `blogwright analytics bootstrap`, and the command's report names inserted days, skipped days and the untouched boundary day (pinned output test).
- [ ] `packages/analytics/README.md` documents `backfill` (what it reads, the bound, the idempotency contract, optional and one-shot), DEVELOPMENT.md's ports table carries the `AnalyticsIngest` row beside `AnalyticsQuery`, and a changeset records the new user-facing action.
- [ ] The analytics change spec's `Status:` is `Merged` with a `Merged:` date, the file sits in `.specs/changes/merged/` with every relative link re-pointed and its two open questions carried, and `.specs/README.md`'s pending list is empty.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run backfill --reporter=verbose` inside `packages/analytics`; confirm the identical-row case compares full rows (deep equality, not a column sample), that the recording fake shows no `insertDay` at or after `createdDay`, and that no test starts DuckDB; then run `ls .specs/changes .specs/changes/merged` and confirm all three specs sit in `merged/` and every link in `.specs/README.md` resolves.
