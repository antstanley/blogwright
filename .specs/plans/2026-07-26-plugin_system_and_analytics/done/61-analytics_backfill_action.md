# Task 61 - The `analytics backfill` action, and the analytics spec's merge

**Plan:** [plan.md](../plan.md) · **Certificate:** [61-analytics_backfill_action-certificate.md](61-analytics_backfill_action-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics pipeline → Backfill of historical logs (Add)](../../../changes/merged/2026-07-26-analytics_plugin.md) (settled 2026-07-27: a declared, optional, one-shot action reading the site's CloudWatch log group through core's existing `LogsClient.filterEvents`, producing rows identical to the Firehose path's, idempotent by construction) and §Analytics plugin → Namespace and commands (the `analytics backfill` row) and the Decision *`analytics backfill` is a declared, optional action*, plus §Merge plan steps 5–6, deferred here by task 58 because this task lands the spec's last outstanding block
**Depends on:** 41, 46, 47, 53, 58
**Produces:** `blogwright analytics backfill` fills whole pre-Firehose days from `names.cloudfrontLogGroup` into the `page_views` table - each event through the same mapping, `visitor_key` derivation and drop rules as the transform Lambda, written through the new `AnalyticsIngest` port - inserting nothing the Firehose path wrote and nothing twice; the package README gains the action's entry; and the analytics change spec is merged
**Pointers:** `packages/analytics/src/backfill.ts` (new - the command body behind the stub task 47 declared in `packages/analytics/src/commands.ts`), `packages/analytics/src/ports.ts` (task 45 - `AnalyticsIngest` (`insertDay(day, rows)`) joins `AnalyticsQuery` there), `packages/analytics/src/adapters/duckdb-ingest.ts` (new - the write adapter beside task 46's `duckdb-query.ts`; the dashboard's attach stays read-only), `packages/core/src/aws/logs.ts:71` (`filterEvents` - the read path; no new client and no new core operation), `packages/analytics/src/transform/map-record.ts` and `transform/visitor-key.ts` (tasks 40/41 - the mapping and `dailySalt`/`visitorKey` this command reuses; a historical day's salt is `HMAC-SHA256(secret, day)`), `packages/analytics/src/nodes.ts` (task 53 - the `createdDay` the delivery node records, this command's idempotency bound), `packages/analytics/README.md` (task 58 - the five steady-state actions; the `backfill` entry lands here), [the analytics change spec](../../../changes/merged/2026-07-26-analytics_plugin.md) (its `Status:` line and §Merge plan steps 5–6, which task 58 deferred here), `.specs/README.md` §Change specs (the pending list, whose last entry this task removes - line anchors are deliberately not given for a file this plan's own tasks keep editing), `.specs/changes/merged/` (the destination this task moves the file to)

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

- [x] Declare `AnalyticsIngest` in `packages/analytics/src/ports.ts` as `insertDay(day, rows)` beside `AnalyticsQuery`, with a doc comment stating it exists for the one-shot backfill and that the dashboard's read path never receives it; write the recording fake beside it.
      - `AnalyticsIngest` sits under `AnalyticsQuery` in `ports.ts`; the fake is
        `createRecordingAnalyticsIngest` in `packages/analytics/src/fixture-ingest.ts`,
        following `fixture-query.ts`'s precedent of a real implementation shipped beside
        the interface. The doc comment also records why there is **no `close()`**: task
        55 measured the read side, and the write side adds nothing that outlives a call
        because each `insertDay` commits or rolls back before it returns.
- [x] Write the DuckDB write adapter in `packages/analytics/src/adapters/duckdb-ingest.ts`, attaching with the same explicit credentials as task 46's read adapter but NOT read-only, committing each `insertDay` as one transaction, and mapping vendor errors into the repo's vocabulary at the boundary.
      - **The session is shared rather than copied.** "The same explicit credentials" as
        task 46's adapter was implemented by extracting the whole session -
        `CREATE SECRET`, the attach, the quoting, the redaction, the step-failure
        translation and `connectDuckDb` - into `adapters/duckdb-session.ts`, which both
        adapters build on with `readOnly: true`/`false` as the only difference. The
        alternative was a second copy of ~120 lines in the one module where a divergence
        would be a security difference; the repo definition of done bans it and the
        change spec's own §Backfill says the ingest port is "implemented by the same
        DuckDB adapter". Consequence for this task's DoD 3, stated rather than glossed:
        the *new* module importing the vendor package is `duckdb-session.ts`, and
        `duckdb-ingest.ts` names no vendor at all. The statements task 46's suite
        asserts are byte-identical - all 764 of its tests passed unchanged after the
        extraction, before a line of this task's own code was written.
- [x] Fill the `backfill` body behind task 47's stub in `packages/analytics/src/backfill.ts`: read `createdDay` from the plugin's scoped state (task 53) and fail before any AWS call with a message naming `blogwright analytics bootstrap` when it is absent; compute the candidate range as whole UTC days strictly before `createdDay`, bounded below by `retention.cloudfrontDays`.
      - `runBackfill` in `backfill.ts`; `commands.ts`'s `backfill` is the composition
        root that constructs the two adapters and delegates. **Task 53's routed finding
        is discharged**: `requireCreatedDay` refuses on an absent record *and* on a
        record with no `createdDay` *and* on a malformed one, and the second message
        says the operator's real remedy is to supply the bound, because bootstrapping
        again will not write a key the node writes only when it creates the delivery.
        The second half of that finding - two spellings of `'createdDay'` that nothing
        checks - is closed rather than repeated: `CREATED_DAY_KEY` and
        `LOG_DELIVERY_NODE` are now exported from `nodes.ts` and imported here, so there
        is one spelling, and a test drives the real node's `create()` and then the real
        command over the state it left.
      - The range is anchored on `createdDay`, not on a clock: the
        `retention.cloudfrontDays` whole UTC days immediately before it. A day CloudWatch
        has already expired reads back with no events and is reported as skipped, so
        nothing is lost by not knowing today's date.
- [x] For each candidate day: skip it when the table already holds rows for that day (one `AnalyticsQuery` count through the existing port); otherwise read the day's events through `ctx.clients.logsUsEast1.filterEvents(names.cloudfrontLogGroup, { startTime, endTime })`, map each through task 40's `mapRecord` with task 41's `visitorKey(ip, ua, dailySalt(secret, day))` - the salt secret read once through the plugin's us-east-1 `SecretsManagerClient` - apply the same drop rules, and hand the surviving rows to `insertDay` in one transaction.
      - One correction to the step as written: `visitorKey`/`dailySalt` are **not** called
        here. `mapRecord(record, saltSecret)` takes the long-lived stored secret and
        derives the day's salt itself, from the record's own day - task 40 documents that
        as the reason a batch straddling midnight is safe. Calling `visitorKey` here
        would be the forked mapper the identical-row property exists to prevent, so the
        backfill calls neither.
      - A guard the step did not ask for and the property needs: a mapped row whose own
        `day` is not the day being written is **not** inserted. CloudWatch's `endTime` is
        not documented as exclusive, so a record on the far side of midnight is
        reachable, and without this it could reach the day Firehose already covers.
- [x] Report what happened: the days inserted, the days skipped and why, and the boundary day deliberately left to Firehose - matching the spec's stated one-day precision limit at the seam.
      - One line per candidate day naming the day and the outcome, then a summary and the
        boundary-day line. It also reports **dropped records**: a day's unmappable events
        are counted and the first drop reason - which names the column and the CloudFront
        field behind it - is warned. That is deliberate and answers this plan's standing
        *Nothing reports a dropped record* open question for this path; see the new open
        question about the site's CloudWatch delivery selecting AWS's default field list
        rather than the one `schema.ts` chooses.
- [x] Write the tests: the identical-row property (one fixture event through task 42's Firehose envelope and through the backfill path yields deep-equal rows); the bound (no row with day ≥ `createdDay` is ever handed to `insertDay`, asserted on the recording fake); the skip (a day the fake reports occupied gets no insert); the re-run no-op (a second run against the fake's recorded state inserts nothing); and the missing-`createdDay` refusal naming `blogwright analytics bootstrap`. No test starts DuckDB - the adapter is substituted at the port.
      - `packages/analytics/src/backfill.test.ts`, 17 tests, plus 12 in
        `adapters/duckdb-ingest.test.ts`. Neither starts DuckDB: the ingest suite
        substitutes at the connection seam, and the backfill suite never reaches an
        adapter. The AWS side is deliberately **not** substituted - the real `LogsClient`
        and `SecretsManagerClient` run over a recording transport that throws on an
        unaccounted-for request, which is what gives "the refusal happens before any AWS
        call" its teeth, and the test site's region is `eu-west-2` so
        `ctx.clients.logsUsEast1` is distinguishable from `ctx.clients.logs`.
      - The re-run test's occupancy counts are computed from what the recording fake has
        been handed, so the second run reads back exactly what the first run wrote.
- [x] Add the `backfill` entry to `packages/analytics/README.md` (task 58 deliberately left it out): what it reads, the whole-days-before-`createdDay` bound, the idempotency contract, and that it is optional and one-shot. Add the `AnalyticsIngest` row to DEVELOPMENT.md's ports table beside task 58's `AnalyticsQuery` row, and write the changeset for the new user-facing action.
      - README: a `### blogwright analytics backfill [env] - optional, one-shot` section
        after the five-action table, deliberately outside it, because it is not part of
        the steady state. DEVELOPMENT.md line 86 carries the `AnalyticsIngest` row.
        Changeset: `.changeset/analytics-backfill-action.md`.
- [x] Execute the analytics spec's §Merge plan steps 5–6, deferred here by task 58: flip its `Status:` to `Merged` with a `Merged:` date, move it to `.specs/changes/merged/`, re-point every relative link inside the moved file (`../../packages/…` and `../../DEVELOPMENT.md` gain a level; both companion specs are already in `merged/`, so their links become sibling-relative), carry its two open questions forward per task 58's triage, and remove its entry from `.specs/README.md`'s pending list, which this leaves empty.
      - Done, with **two corrections to the step as written**, both verified rather than
        assumed. (i) The companion specs are **not** in `merged/` - task 58 refused the
        plugin-system flip and task 60 is parked - so their links gain `../`, not a
        sibling path. (ii) Removing the analytics entry leaves the pending list at
        **two**, not empty; see the amendment on the definition of done below.
      - Beyond the step: the move broke every relative link *to* the spec - 10 doc
        comments under `packages/analytics/src/`, 2 in `plan.md`, 1 in the plugin-system
        spec and 37 across the plan's own task files. All 45 files were re-pointed by one
        mechanical path substitution and a resolver then found no dead link anywhere
        under `.specs/` or `packages/`. Recorded as an open question, because two specs
        are still pending and this happens twice more.
      - One content correction made **as part of** the merge rather than around it: the
        spec's §Its own service clients scoped `FirehoseClient` to four operations, and
        `updateDestination` shipped at task 51. `plan.md`'s own open question predicted
        exactly this and assigned the correction to task 58's closure pass, which did not
        make it. A `Merged` header on a spec that describes a narrower client than the
        one that shipped is a false claim about the code, so the block now names the
        fifth operation and says why.

## Definition of done

- [x] The `backfill` command declared at task 47 has its body here, and the identical-row property is asserted: one fixture CloudFront event through the Firehose envelope path and through the backfill path yields deep-equal `page_views` rows, including `visitor_key` (derived for the historical day from the one stored secret) and `is_bot`.
      - **MET.** `backfill.test.ts` "produces, for one CloudFront record, the row the
        Firehose envelope produces": the fixture record goes through
        `createTransformHandler`'s base64/JSON envelope and through `runBackfill`, and
        both are compared with `toStrictEqual` against `EXPECTED_ROW` - a **frozen
        literal**, read off one run and written out, so neither side of the comparison is
        allocated by the code under test. Then the two are compared to each other.
        Mutations M1a (`is_bot` forced true), M1b (backfill maps under a different
        secret) and M14 (the *Firehose* side maps under a different secret) all kill it;
        M14 is the one that proves the comparison genuinely spans both paths.
- [x] Idempotency is by construction and tested in both directions: only whole UTC days strictly before the recorded `createdDay` are ever handed to `insertDay` (negative test on the recording fake), an occupied day is skipped, a re-run inserts nothing, and each inserted day is one transaction - so the Firehose path's rows are never duplicated and neither are the backfill's own.
      - **MET, in four tests.** The bound's negative is asserted on
        `RecordingAnalyticsIngest.days` against a world that *does* hold events on the
        boundary day and the day after, with a positive non-vacuity assertion first
        (`['2026-08-18', '2026-08-19']`) so the negative is about a bound that held
        rather than a run that did nothing. Mutation M2 (`back >= 1` → `back >= 0`) puts
        `2026-08-20` in the received list. The skip and the re-run die to M4
        (`occupied > 0` → `occupied > 1000`); the transaction dies to M5 (`BEGIN
        TRANSACTION` → `SELECT 1`), which leaves `['INSERT', 'COMMIT']`.
      - A third bound the DoD does not name and the property needs: no row whose own
        `day` differs from the day being written is inserted. M3 disables it and M13
        disables it together with the fake's own contract guard - still killed, by an
        `expect` rather than by the fake, so the property is owned by an assertion.
- [x] The read path is core's existing `LogsClient.filterEvents` over `ctx.clients.logsUsEast1` and nothing else - no new client, no new core operation (`git diff` shows no change under `packages/core/`), and the write crosses `AnalyticsIngest`, whose DuckDB adapter is the only new module importing `@duckdb/node-api` - `grep -rn "@duckdb" packages/analytics/src/` still finds it only under `adapters/`, and task 46's read adapter stays read-only.
      - **MET, with the vendor import in a shared module rather than in the ingest
        adapter - stated, not narrowed.** `jj diff --stat` shows **no path under
        `packages/core/`** (`git diff` is unavailable in a jj workspace). The grep finds
        `@duckdb` on exactly one line, `adapters/duckdb-session.ts:57` - one file, under
        `adapters/`, and *fewer* modules naming the vendor than before this task, since
        `duckdb-query.ts` no longer names it either. The DoD's phrase "whose DuckDB
        adapter is the only new module importing" is therefore satisfied in the stronger
        direction: neither adapter imports it. See the step-2 note for why the session
        was shared rather than copied.
      - The read is `ctx.clients.logsUsEast1.filterEvents`, asserted by host on a site
        whose own region is `eu-west-2`; mutation M6 (`logsUsEast1` → `logs`) is caught
        with `logs.eu-west-2.amazonaws.com` in the received value.
      - Task 46's attach stays read-only: mutation M7 (`readOnly: true` → `false` in
        `duckdb-query.ts`) **SURVIVED the `Reviewable:` slice** and was killed by the full
        analytics suite in four places, including task 46's own attach assertions. Both
        were run precisely because a narrowed slice has made a real property look unowned
        three times in this build.
- [x] A missing `createdDay` (analytics never bootstrapped, or bootstrapped before task 53's recording) fails before any AWS call with a message naming `blogwright analytics bootstrap`, and the command's report names inserted days, skipped days and the untouched boundary day (pinned output test).
      - **MET.** Three refusal tests, each asserting the message *and* that the recording
        transport saw nothing. Mutation M8a (drop the bootstrap remedy from the message)
        and M8b (read the salt secret before checking the bound) both kill: M8b's
        received value carries the Secrets Manager call the mutation introduced, which is
        the executed-line proof for "before any AWS call".
      - The report is pinned as a nine-line array covering an empty day, an occupied day,
        an inserted day, an unmappable record and the boundary line. Mutation M9 (the
        boundary line stops naming the day) kills it in two places.
- [x] `packages/analytics/README.md` documents `backfill` (what it reads, the bound, the idempotency contract, optional and one-shot), DEVELOPMENT.md's ports table carries the `AnalyticsIngest` row beside `AnalyticsQuery`, and a changeset records the new user-facing action.
      - **MET**, and it describes the implemented behaviour rather than the stub - the
        check task 58's own entry was left owing. No mutation is offered: nothing asserts
        prose, and inventing a test that greps the README for a sentence would be an
        assertion that cannot fail for the reason it exists, which this plan's baseline
        names as a defect rather than coverage. The evidence is reading the three files.
> **IMPLEMENTER AMENDMENT - 2026-08-31, before this task's verification gate.**
> The last clause of the line below - "`.specs/README.md`'s pending list is empty" - is
> **unsatisfiable by this task, and the reason is not this task's work.** It assumes this
> task removes the last pending entry. It removes the third of three. The plugin-system
> spec's flip was task 58's; task 58 **refused** it, correctly, because
> `packages/cli/src/nodes.ts` still reads `ctx.config.pds`, which that spec's own §Plugin
> SPI topography invariant forbids - and both remaining flips were transferred to task
> 60, which is **PARKED** in `blocked/` behind task 59, which is behind a release that
> cannot be cut from inside a build. I verified this rather than taking it on trust:
> `grep -n "config\.pds" packages/cli/src/nodes.ts` still matches, both companion specs
> are still at `Status: Proposed` under `.specs/changes/`, and `.specs/README.md` named
> task 60 as the owner of both before I touched it.
>
> **The line is split, not narrowed.** The half this task owns - the analytics spec
> flipped, moved, re-linked, its open questions carried, its entry removed - is met and
> ticked. The half it does not own is recorded as **UNMET with task 60 named**, exactly
> as task 58's DoD 5 recorded its refused flip. Nothing is dropped and nothing is forced
> green: after this task `.specs/changes/` holds **two** spec files, and it should.

- [x] The analytics change spec's `Status:` is `Merged` with a `Merged:` date, the file sits in `.specs/changes/merged/` with every relative link re-pointed and its two open questions carried, and `.specs/README.md`'s pending list is empty.
      - **HALF MET, and the unmet half is recorded as unmet rather than forced.**
        `.specs/changes/merged/2026-07-26-analytics_plugin.md` reads
        `**Status:** Merged · **Date:** 2026-07-26 · **Merged:** 2026-08-31`. Every one of
        its relative links resolves at the new depth, checked by resolving each against
        the filesystem rather than by eye - including the two companion-spec links, which
        gained `../` rather than becoming siblings, because neither companion is in
        `merged/`. Both open questions are carried into `plan.md`; the Glue
        adopt-and-never-delete one had no bullet there before and now has its own.
      - **The flip genuinely qualified, and I checked the thing task 58's DoD omitted.**
        Every `Proposed changes` block has landed, this task's being the last; the spec's
        invariants hold in code (the vendor confined to `adapters/`, the region pin, the
        plugin never creating a delivery source, `blogwright destroy` refusing while
        scoped state exists, the prebuilt `dist/app`, `blogwright-analytics` in
        `.changeset/config.json`'s fixed group); and its **Decisions block names no work
        still undone** - its one forward-looking decision, *`analytics backfill` is a
        declared, optional action*, is what this task lands. The single divergence found
        ran the other way, the spec being narrower than the code, and was corrected in
        the merge rather than merged stale (see step 7).
      - **UNMET half: `.specs/README.md`'s pending list holds two entries, not zero** -
        the plugin-system and pds specs, both owned by **task 60**, which is parked in
        `blocked/`. `ls .specs/changes` lists `merged/` plus those two files.
- [x] Meets the repo definition of done (see plan.md baseline).
      - All six CI gates exit **0** from the workspace root, run separately in
        `.github/workflows/ci.yml` order: `build`, `typecheck`, `test`, `lint`,
        `oxfmt --check .`, `knip`. Test counts against the tip baselines:
        `blogwright-analytics` **793** (764 + 17 backfill + 12 ingest), `blogwright`
        **376** unchanged, `blogwright-core` 149 (+1 skipped), `blogwright-pds` 150,
        `blogwright-build-agent` 27. Limits are named constants (`INSERT_BATCH_ROWS`,
        `MS_PER_DAY`) or validated config fields (`retention.cloudfrontDays`).
      - `pnpm knip` reported one unused exported type on the first run
        (`RecordedInsert`); it was un-exported rather than given a manufactured consumer,
        following `ports.ts`' `QueryValue` precedent.
- [x] Reviewable: run `pnpm --filter blogwright-analytics exec vitest run backfill --reporter=verbose` inside `packages/analytics`; confirm the identical-row case compares full rows (deep equality, not a column sample), that the recording fake shows no `insertDay` at or after `createdDay`, and that no test starts DuckDB; then run `ls .specs/changes .specs/changes/merged` and confirm all three specs sit in `merged/` and every link in `.specs/README.md` resolves.
      - **Observed 2026-08-31: exit 0, 17 tests passed.** The identical-row case compares
        whole rows with `toStrictEqual`, twice against a frozen literal and once against
        the envelope's own output - no column sample anywhere. The recording fake's
        `days` is `['2026-08-18', '2026-08-19']` against a `createdDay` of `2026-08-20`,
        with a world that held events on `2026-08-20` and `2026-08-21` for it to have
        taken. No test in the slice starts DuckDB, and none names the vendor package.
      - **Two observations deviate, and neither is worked around.** First, "no test starts
        DuckDB" is met for the tests this task wrote but is stated too broadly to be true
        of the package: `adapters/duckdb-query.test.ts` starts a real in-memory instance
        at five sites, deliberately and pre-existing since task 46, and this task did not
        change that. Second, `ls .specs/changes .specs/changes/merged` shows **one** of
        the three specs in `merged/`, not three - the other two are task 60's, per the
        amendment on the definition-of-done line above. Every link in `.specs/README.md`
        does resolve, checked by resolving each path against the filesystem.
