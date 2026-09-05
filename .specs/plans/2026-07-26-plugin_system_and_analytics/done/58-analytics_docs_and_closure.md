> **Current scope reconciliation (2026-09-05):** Historical steps/evidence below describe the original execution. Any remaining canonical/spec/public-doc closure belongs to task 63 under the current [plan](../plan.md). Historical certificate verdicts are retained, not promoted to a current pass.

# Task 58 - Document the analytics plugin, update the toolchain and ports tables, and close the change spec

**Plan:** [plan.md](../plan.md) · **Certificate:** [58-analytics_docs_and_closure-certificate.md](58-analytics_docs_and_closure-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Merge plan](../../../changes/merged/2026-07-26-analytics_plugin.md) (steps 3–4 - the toolchain and ports rows and the two stale workspace counts in DEVELOPMENT.md - are actionable today; steps 1–2 are recorded as not-applicable rather than skipped, see this task's first step; the analytics spec's own `Status:` flip, move and README removal are deferred to task 61, which lands its §Backfill of historical logs block) and §Ports → `AnalyticsQuery` (the row the ports table gains) and §Analytics plugin → Namespace and commands (the actions the package README documents)
**Depends on:** 20, 30, 55, 57
**Produces:** the Vite/SvelteKit toolchain row and the `AnalyticsQuery` ports row in DEVELOPMENT.md, a `packages/analytics/README.md` documenting install, the five steady-state actions, the us-east-1 pinning and the privacy contract, a changeset stating the semver impact, the spec's two remaining open questions each resolved or owned, and the plugin-system spec merged - the flip task 20 deferred here - leaving the pds and analytics specs pending, named as tasks 60's and 61's
**Pointers:** `DEVELOPMENT.md:12-22` (the Toolchain table the Vite/SvelteKit row joins, below the `rolldown` row at `:21`; the pnpm row at `:16` says "workspace of four packages" and becomes five), `DEVELOPMENT.md:328-330` (the four-package-split Assumption, which gains `blogwright-analytics` as the second instance of its own feature-package exception), `DEVELOPMENT.md:72-81` (§Hexagonal architecture's ports table the `AnalyticsQuery` row joins, in the same four-column shape as the `Vcs` row at `:80`), `DEVELOPMENT.md:246-251` (§Documentation: doc comments on public exports, a module comment stating what each module owns, no bare `// TODO` without an owner), `packages/analytics/README.md` (new - `packages/pds/README.md:1-10` is the shape: what the package owns, what it depends on, and where the command surface is documented), `packages/analytics/src/ports.ts` (task 45 - where `AnalyticsQuery` is defined and where the fixture-backed fake named in the ports row lives), `packages/analytics/src/adapters/duckdb-query.ts` (task 46 - the real adapter named in the ports row), `packages/analytics/src/config.ts` (task 44 - the recorded table-bucket-per-environment decision the Glue-integration triage draws on), `packages/analytics/src/transform/visitor-key.ts` (task 41 - the recorded salt-stability and cadence decisions), `.changeset/config.json:5` (the `fixed` group `["blogwright", "blogwright-core", "blogwright-pds"]` - decide explicitly whether `blogwright-analytics` joins it), [the analytics change spec](../../../changes/merged/2026-07-26-analytics_plugin.md) (its §Merge plan and its two §Open questions - its `Status:` flip is task 61's, not this task's), [the plugin-system change spec](../../../changes/merged/2026-07-26-cli_plugin_system.md) (its `Status:` header line - task 20 deferred the flip here), `packages/core/src/aws/endpoint.ts` and `packages/core/src/clients.ts` (tasks 31 and 38 - the seam and `signingUsEast1`, the work that flip waits on), `.specs/README.md` §Change specs (the pending list, which this task reduces to two entries naming tasks 60 and 61, and the merged list the plugin-system spec joins - line anchors are deliberately not given for a file this plan's own tasks keep editing)

> **ROUTED FINDING - added 2026-08-31 from task 30's gate. Two stale documentation claims that no task's definition of done currently names.**
> Both were found while building task 30, correctly left unfixed there (its
> certificate scopes it to one `DEVELOPMENT.md` paragraph), and routed here
> because this task already edits `DEVELOPMENT.md` in three places and is the
> plan's documentation-closure task. **Neither is in this task's DoD as written,
> so if you take them, add them to it; if you decline either, say so with an
> owner rather than leaving it recorded and unowned - the gate's whole point in
> raising them was that a recorded-but-unowned finding is one that gets lost.**
>
> 1. **`docs/src/content/docs/reference/cli.md` still documents pre-migration
>    dispatch, and nothing in `docs/` names the plugin verbs.** Verified by the
>    gate at task 30's tip: `grep -c plugin` on that page is **0** - no plugin
>    section, no `blogwright <plugin> <action>` row, no `plugin add|list|remove`.
>    Meanwhile §Invocation (`:28`) still lists `blogwright pds secret <action>
>    [env]` as its own positional layout, §Exit codes (`:249`) still says `1`
>    covers "unknown command, `preview` action, or `pds` action", and the
>    `## pds commands` section (`:167`) carries only the six declared actions.
>    Task 30 declined to add three `pds` rows, and its reasoning was upheld: doing
>    so would document *host SPI* verbs as if the plugin declared them, and would
>    leave two structural descriptions of dispatch wrong on the same page. The
>    real fix is a plugin section plus corrections to §Invocation and §Exit codes.
>    This is the **second** finding to land on this page from one cause - task 20's
>    D6 was the first.
> 2. **`DEVELOPMENT.md:132` (§Where validation lives) has a row falsified by
>    task 29.** It reads "explicit dispatch in `cli.ts`; unknown commands fail
>    with usage". Dispatch has been generic since task 29
>    (`packages/cli/src/plugin-commands.ts:653`), and an unknown action now
>    returns the plugin's own action listing. A comment naming the wrong
>    guarantee is a step toward deleting a guard that works, and this build has
>    found five of them.

> **ROUTED FINDING - added 2026-08-30 from task 43's repair.**
> One phrase to correct in a landed file. `packages/analytics/src/transform/handler.ts:60-62`
> says "the bundle task 43 produces carries no client, no signer and no
> transport". That was true when task 42 wrote it and is false now: task 43's
> `entry.ts` constructs core's `SigningClient` and `SecretsManagerClient`, and
> core's `fetchTransport` is inlined into the bundle. The surrounding paragraph
> is about the type-only `SaltSecretStore` import and IS true of `handler.ts`
> itself - only the noun is wrong. The fix is one phrase: **"the bundle task 43
> produces" -> "this module"**.
> Task 43 deliberately did not edit it: `handler.ts` is task 42's landed file,
> its gate had confirmed task 43 leaves it untouched, and re-opening a
> provably-clean boundary for a noun was the worse trade. Nothing downstream
> reads the sentence as a decision input, and the authoritative statement
> already exists correctly at `transform-hash.ts:40-42`.

> **ROUTED CONSTRAINT - added 2026-08-31 from task 20's verification gate.**
> **Do not flip `2026-07-26-cli_plugin_system.md` to `Merged` on the strength of
> the transport seam alone.** Your DoD conditions that flip on re-verifying the
> seam, which has been present since build 33 and will pass - but task 20
> deferred merge-plan steps 4 and 5 to you for a DIFFERENT and still-open
> reason: §Plugin SPI -> *A plugin owns its own topography* requires that no
> config key of a plugin's is read by a site node, and
> `packages/cli/src/nodes.ts:971` still reads `ctx.config.pds`, with `:983`
> interpolating its secret name.
> **Task 59 removes it, and you do not depend on task 59** (your deps are 20,
> 30, 55, 57). Task 59 is release-gated, so the expected order puts you first.
> Verify that obligation directly - grep `nodes.ts` for `config.pds` - and if it
> still stands, defer the flip again and record why, exactly as task 20 did.
> A `Merged` header claims the whole spec shipped; flipping it here would claim
> work that has not happened, which is the failure this plan's risk row exists
> to prevent.

## Steps

- [x] Record why merge-plan steps 1 and 2 are not executed, rather than passing over them: step 1 applies the `Proposed changes` blocks to canonical pages for the resource nodes, the AWS clients and the CLI surface "once they exist", and none does; step 2 says to fold `AnalyticsConfig` and `PageView` into the canonical schema, and it is written unconditionally although this repo has no `canonical-types.schema.json` for them to fold into. Both are vacuous today, not done - write that, with an owner, into this task's change description and into plan.md's open questions, exactly as task 20 records the plugin-system spec's step-1 deferral and task 30 records the pds spec's. Task 61 executes steps 5–6 against a spec whose first two steps stay recorded as not-applicable.
- [x] Triage the spec's two remaining open questions - table record expiration (corrected 2026-07-27: S3 Tables offers no row retention for tables you create, so aging out rows would be whole-`day`-partition deletes the plugin issues itself) and the Glue integration's adopt-and-never-delete contract - recording each as resolved or explicitly scoped out, with an owner. The questions this spec once carried beyond those are settled and need only pointers: the destroy refusal at task 16 (§Namespace and commands), backfill as the declared optional action at task 61 (§Backfill of historical logs, settled 2026-07-27), and the daily salt cadence as the Decision *Daily salt rotation stands* carried by task 45's query semantics.
- [x] Add the Vite/SvelteKit row to the Toolchain table at `DEVELOPMENT.md:12-22`, stating the version channel and that it builds only the analytics dashboard (`packages/analytics/app` → `dist/app`), in the same column shape as the `rolldown` row at `:21`.
- [x] Correct the two workspace counts `packages/analytics` invalidates and nothing else catches: the pnpm row's "workspace of four packages under `packages/`" (`DEVELOPMENT.md:16`) becomes five, and the Assumption that "the four-package split (core / cli / pds / build-agent) is stable" (`:328-330`) names `blogwright-analytics` beside `blogwright-pds` as the second worked instance of the exception that admits it. `pnpm-workspace.yaml`'s `packages/*` glob picks the package up with no edit, so nothing fails - the staleness is silent, which is why it needs a step.
- [x] Add the `AnalyticsQuery` row to the ports table at `DEVELOPMENT.md:72-81` naming the defining module (`analytics/src/ports.ts`), the real adapter (`createDuckDbAnalyticsQuery`, `analytics/src/adapters/duckdb-query.ts`) and the fixture-backed test fake, matching the `Vcs` and `PingBuilder` rows.
- [x] Write `packages/analytics/README.md` covering install (`blogwright plugin add analytics`), the five steady-state actions (`init`, `bootstrap`, `status`, `dashboard`, `destroy --yes`), the us-east-1 pinning and why CloudFront forces it, and the privacy contract: the raw viewer IP is never stored, and `cs(Cookie)` and `x-forwarded-for` are never selected so they never leave CloudFront. The optional `backfill` action's entry lands with its implementation at task 61 - do not document an action that still raises its not-yet-available error.
- [x] Sweep the package for the documentation rules at `DEVELOPMENT.md:246-251` - a doc comment on every public export of `blogwright-analytics` and an opening comment on every module stating what it owns - and remove any bare `// TODO` left by tasks 32–57 or give it an owner and a reference.
- [x] Record the triage in the change description: table record expiration as out of scope with an owner (in its corrected form), the Glue integration's adopt-and-never-delete contract as settled at task 49, and - as pointers to already-settled decisions - backfill at task 61 and the daily-salt cadence at tasks 41/45, each naming where the decision now lives in code.
- [x] Write the changeset: a new package `blogwright-analytics` plus a minor on `blogwright-core` for the four service clients and the `LogsClient` delivery parameters, and confirm `blogwright-analytics` is in the fixed group at `.changeset/config.json:5` - settled 2026-07-26 and added by task 32, not an open question to re-decide here.
- [x] Execute the merge plan for ONE spec - the plugin-system spec, whose flip was deferred here by task 20 **(AMENDED 2026-08-31: the flip is conditional on the topography invariant as well as the seam, and is RECORDED AS UNMET here rather than executed - `packages/cli/src/nodes.ts:971` still reads `ctx.config.pds`, which the spec's own Decisions block names as work that must move first. Ownership transfers to task 60, whose DoD is amended to carry it. The `.specs/README.md` pending section therefore holds THREE entries, not two.)** because §Plugin SPI → Plugin-supplied AWS services - the transport seam and `signingUsEast1` - landed at tasks 31 and 38, after task 20. Verify both are in place (`packages/core/src/aws/endpoint.ts` accepts a service descriptor, `AwsClients` carries `signingUsEast1`), then flip its `Status:` to `Merged` with a `Merged:` date and move it to `.specs/changes/merged/`. Do NOT flip the analytics spec: its §Backfill of historical logs block lands at task 61, and a spec is not merged while one of its `Proposed changes` blocks is outstanding - record that deferral in the change description naming task 61, exactly as task 30 records the pds spec's to task 60. Rewrite `.specs/README.md`'s Change specs section so the merged list gains the plugin-system spec and the pending section holds exactly two entries - the pds spec, flipped at task 60 (its §The site graph drops its pds branch lands at task 59, a release later, and its §`bootstrap` warns while plugin state exists at task 60), and the analytics spec, flipped at task 61. Name both tasks in the pending entries so the remaining work is not mistaken for an oversight.
      - **PARTIALLY EXECUTED - the flip is REFUSED, see D5.** `.specs/README.md`'s Change
        specs section is rewritten and every entry now names the task that flips it. The
        plugin-system spec's `Status:` is **not** flipped and the file is **not** moved:
        this step's condition is the transport seam, which is in place, but the ROUTED
        CONSTRAINT above names a second obligation of the same spec that is not - a site
        node still reads `ctx.config.pds` (`packages/cli/src/nodes.ts:971`, secret name
        interpolated at `:995`). The pending list therefore holds three entries, not two.
        Owner of the flip: **task 60**, which ships with task 59's removal of that branch.

## Definition of done

- [x] `DEVELOPMENT.md`'s Toolchain table gains the Vite/SvelteKit row naming the dashboard build as its only use, §Hexagonal architecture's ports table gains `AnalyticsQuery` with its defining module, its real adapter (`packages/analytics/src/adapters/duckdb-query.ts`) and its fixture-backed test fake, in the same column shape as the existing rows, and neither the pnpm toolchain row nor the four-package-split Assumption still says four - `grep -n "four packages\|four-package" DEVELOPMENT.md` returns nothing.
- [x] `packages/analytics/README.md` documents install (`blogwright plugin add analytics`), the five steady-state actions, the us-east-1 pinning, and states that the raw viewer IP is never stored and that `cs(Cookie)` and `x-forwarded-for` are never selected - the optional `backfill` action's entry is deliberately absent until task 61 lands its body - and the same documentation obligation holds inside the code: every public export of `blogwright-analytics` carries a doc comment and every module opens with a comment stating what it owns.
- [x] Each of the spec's two remaining open questions - table record expiration (in its corrected 2026-07-27 form: no row retention for self-created S3 tables, so row expiry would be whole-`day`-partition deletes the plugin issues itself) and the Glue integration's adopt-and-never-delete contract - is either resolved in the change description (the Glue contract at task 49, recorded here with the module that holds the decision) or recorded as out of scope with an owner, with pointers for the already-settled backfill (task 61) and salt-cadence (tasks 41/45) decisions; and no bare `// TODO` exists in the new code - `grep -rn "TODO" packages/analytics/` returns nothing without an owner and a reference.
      - **CHECK CORRECTED, and the original recorded rather than silently replaced.** The
        check as written cannot pass, and its result depends on nothing this task controls.
        `packages/analytics/app/.svelte-kit/output/` is SvelteKit's own generated server
        bundle, carrying upstream Svelte TODOs written by neither this task nor this repo;
        it is gitignored (`.gitignore:5`) and exists only after a build has run. Measured at
        this task's tip: `grep -rn "TODO" packages/analytics/` returned **0** before
        `pnpm build` and **7** after, every one of the seven under that directory. The
        property the line is reaching for is *tracked files only*, so the check run and
        recorded is the tracked-file form: `git grep -n "TODO" -- packages/analytics/` in a
        colocated checkout, or - in a non-colocated jj workspace such as this one, where
        `git grep` exits 128 because `.git` lives in the main repo - the equivalent
        `jj file list packages/analytics | xargs grep -n "TODO"`. Observed: **no output,
        exit 1**. This is the third self-defeating check this plan has shipped; task 54's
        step 7 was replaced the same way and its box is ticked for the replacement.
- [x] Every one of the analytics spec's merge-plan steps is accounted for: steps 1–2 are recorded as not-applicable with their reason (no canonical pages, and no canonical schema for `AnalyticsConfig` and `PageView` to fold into) and an owner, steps 3–4 are executed here, and steps 5–6 are task 61's - so no step is left silently unexecuted when task 61 flips the header.
> **ORCHESTRATOR AMENDMENT - 2026-08-31, after this task's verification gate returned CORRECT / PARTIAL.**
> Clause (ii) of the DoD line below is mine, added at merge. The line as written conditioned the
> plugin-system flip on the seam alone, and the seam is in place - so read literally it demanded a flip
> that would have stamped `Merged` on a spec whose own §Plugin SPI topography invariant the code
> violates at `packages/cli/src/nodes.ts:971`. The implementer refused it and the gate independently
> upheld the refusal, finding more than either of us had: the spec's **own Decisions block** names that
> exact branch as work that must move before the spec completes. `plan.md`'s Open questions had already
> predicted this failure by task number and proposed this very fix, which was never applied.
>
> **This amendment adds an obligation rather than removing one, and it does not make the flip anyone's
> optional extra.** The flip moves to task 60 with a check it can be failed on, and task 60's own DoD is
> amended in the same breath, because as written it was arithmetically incompatible with owning the flip -
> it expected `.specs/README.md` to hold exactly one pending entry, which cannot be true while the
> plugin-system spec is still pending. Nothing is dropped; one unsatisfiable obligation is replaced by
> two checkable ones. The box below is ticked for the "recorded as unmet" branch that the line has
> always carried, never for a flip that did not happen.

- [x] A changeset describes the semver impact - a new package, plus a minor on `blogwright-core` for `signingUsEast1`, the transport seam and the `LogsClient` delivery parameters (the plugin's four service clients live in `blogwright-analytics`, not in core) - and the merge plan of ONE spec is executed: the plugin-system spec's, whose flip task 20 deferred to here because the transport seam and `signingUsEast1` land at tasks 31 and 38 - `Status:` flipped to `Merged` with a `Merged:` date, the file in `.specs/changes/merged/`, and `.specs/README.md` updated so the pending section holds exactly two entries and every link resolves. The plugin-system flip is conditional on TWO obligations, and is recorded as unmet rather than flipped if EITHER fails: (i) the seam actually being in place - `SendOptions.service` accepts a descriptor and `AwsClients` carries `signingUsEast1`; and (ii) the spec's own §Plugin SPI -> *A plugin owns its own topography* invariant holding in code - `grep -n "config\.pds" packages/cli/src/nodes.ts` returning nothing. The pds and analytics specs are deliberately NOT flipped here: `.specs/changes/` still holds both, and their pending entries name tasks 60 and 61 as their owners, with the analytics deferral (§Backfill of historical logs, task 61) recorded in the change description.
      - **HALF MET, and the unmet half is recorded as unmet rather than forced.** The
        changeset exists (`.changeset/analytics-plugin-package.md`), the analytics and pds
        specs are correctly not flipped, and their pending entries name tasks 61 and 60.
        The plugin-system flip is **refused**: this line conditions it on the seam alone,
        and the seam is in place (`packages/core/src/aws/endpoint.ts:35-42`
        `ServiceDescriptor`, `packages/core/src/clients.ts:33` `signingUsEast1`) - but the
        ROUTED CONSTRAINT above, and plan.md's own open question raised by task 20's
        re-gate, name a second obligation of the same spec that is not met. See **D5**.
        Consequence: `.specs/README.md`'s pending section holds **three** entries, not two.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`, then confirm `.specs/changes/` holds `merged/`, the pds spec and the analytics spec and nothing else, that `.specs/changes/merged/2026-07-26-cli_plugin_system.md` carries a `Merged:` date, and that every link in `.specs/README.md` resolves to an existing file.
      - **Observed 2026-08-31.** The gate chain exits **0**, and so does each of the six
        CI gates run separately in `.github/workflows/ci.yml` order (`build`, `typecheck`,
        `test`, `lint`, `oxfmt --check .`, `knip`). All eleven links in `.specs/README.md`
        resolve to an existing file - the check this build has broken once. Test counts are
        unchanged against the tip baselines, as a prose-and-comments change should leave
        them: `blogwright-analytics` 764, `blogwright` 376, `blogwright-core` 149 (+1
        skipped), `blogwright-pds` 150, `blogwright-build-agent` 27.
        **Two observations deviate, both consequences of D5 and neither worked around.**
        `ls .specs/changes/` lists `merged/` plus **three** spec files, not two - the
        plugin-system spec is still there. And
        `.specs/changes/merged/2026-07-26-cli_plugin_system.md` does not exist, so it
        carries no `Merged:` date; the file's header still reads `**Status:** Proposed`.

## Decision notes

Written 2026-08-31 while implementing this task. D1, D2, D5 and D6 are the
merge-plan and flip dispositions this task's definition of done exists to make
explicit; all four, plus D7's declined routing and D8's check defect, are also
appended to [plan.md](../plan.md)'s `**Open questions**` block, no other line of
which was touched. The precedent for their shape is task 20's D1/D2 and task
30's D1-D4, which recorded the plugin-system and pds spec deferrals the same way.

The analytics spec's merge plan has six steps. All six are accounted for:
**1 - not applicable (D1)** · **2 - not applicable (D2)** · **3 and 4 - done
(D6)** · **5 and 6 - task 61's (D6)**.

### D1 - Merge-plan step 1 is not applicable, not skipped. Owner: the spec's owner (Ant Stanley)

Step 1 reads: *"Apply the `Proposed changes` blocks to whichever canonical pages
document the resource nodes, the AWS clients, and the CLI surface, **once they
exist**."* None exists. `.specs/` holds `README.md`, `changes/`, `changes/merged/`
and `plans/` and nothing else; the spec's own §Affected spec pages says so twice
in its first two rows - *"(none - no canonical page for the resource nodes or CLI
surface yet)"* and *"(none - no canonical page for the site's resource nodes
yet)"* - and this plan's baseline opens with "The repo has no canonical spec
pages". The step is vacuous today: its precondition is unmet, so there is nothing
to apply the blocks to.

**Which of the two shapes this is.** Task 30 drew a distinction worth restating,
because conflating the two is easy. The plugin-system spec's step 1 carried an
unconditional fallback - *"if none exists, record the SPI as a new canonical page
and index it"* - which made that step **live**, and forced task 20 to *refuse* it
on a conflicting instruction from the same spec (the SPI stays internal and
undocumented until it has carried two features). The analytics spec's step 1
carries **no fallback clause at all**. It is conditional on its face and the
condition is false, which is the pds spec's shape, not the plugin-system spec's.
Nothing here is refused; the step simply has no target.

Owner: the spec's owner, because what unblocks it is the decision to create a
canonical spec set, which no task in this plan takes and none is scheduled to.
Explicitly NOT task 61: task 61 flips this spec's `Status:` and moves the file,
and it must do so against a merge plan whose first two steps stay recorded here
as not-applicable rather than quietly ticked.

### D2 - Merge-plan step 2 is not applicable, for a related but distinct reason. Owner: the spec's owner (Ant Stanley)

Step 2 reads: *"Fold `AnalyticsConfig` and `PageView` into the canonical
schema."* Unlike step 1 it is written **unconditionally** - no "once one exists" -
and that is what earns it a separate note rather than a clause of D1: read
literally it instructs, and the reason it is not done is not an unmet condition
but a missing object.

Verified rather than assumed: `find .specs -name '*.schema.json'` returns
nothing. There is no `canonical-types.schema.json` and no JSON Schema sidecar of
any kind under `.specs/`. The two `$def`s the step names have no destination.

Worth stating for whoever eventually creates that schema: the shape to fold in is
**not** the spec's §Type changes prose. `AnalyticsConfig` in
`packages/analytics/src/config.ts` splits into an operator-writable block and a
`ResolvedAnalyticsConfig`, and `tableBucket`/`saltSecretName` are sealed behind a
module-private symbol so that no path can produce an env-less bucket name - a
`$def` transcribed from the spec would encode a shape the code deliberately does
not have. Same owner as D1, for the same reason.

### D3 - Open question 1, table record expiration: OUT OF SCOPE. Owner: the spec's owner (Ant Stanley)

Recorded in its corrected 2026-07-27 form, which is the form that matters: S3
Tables offers **no row-retention knob for a table you create**.
`PutTableRecordExpirationConfiguration` applies only to AWS-managed tables, and
`PutTableMaintenanceConfiguration` - the per-table configuration that does apply -
governs snapshot expiry and file compaction, which is storage reclamation and not
row retention. So "age rows out" is not a setting this plugin could turn on; it
would be **whole-`day`-partition deletes the plugin issues on its own schedule**,
which means a new node or a new action, a cutoff config field, and a scheduler.

Scoped out of this plan, deliberately. Nothing in the pipeline needs it: the table
is append-only and partitioned by `day`, so the delete stays cheap to add later,
and no decision taken here forecloses it. The site's `retention.cloudfrontDays`
still governs the CloudWatch copy, which is the retention an operator has today.
`packages/analytics/README.md` §Shared state, and what teardown leaves behind
states plainly that rows are never aged out, so an operator is not left to infer
it. Owner is the spec's owner because the open question is a product decision
("should old rows age out at all"), not an implementation gap.

### D4 - Open question 2, the Glue adopt-and-never-delete contract: RESOLVED at task 49

Adopt-and-never-delete is the right contract, and the code already holds it. The
decision lives in `packages/analytics/src/nodes.ts`'s
`analytics-catalog-integration` node: `read()` adopts an existing federation after
verifying its source, `create()` re-checks and adopts rather than trusting the
`read()` before it, and `delete()` is a no-op whose comment gives the reason -
removing the federation while tearing down staging would leave production's
delivery stream with no catalog to write through, so production would go on
accepting CloudFront logs and route every record into its error bucket, with
nothing in either environment's output saying what had been taken away. The same
rule core already states for the account-global OIDC provider it likewise never
removes (`packages/core/src/aws/iam.ts`). The second half of the guard is
structural: `GlueClient` exposes no delete operation at all, so there is nothing
to call by accident.

The alternative the question raised - "should the last environment to be torn down
remove it?" - would need the plugin to know it is the last, which it cannot: the
federation is account-and-region scoped, its other consumers may be other tools
entirely, and the plugin's state is per-environment.

**Two already-settled decisions, as pointers rather than re-triage.**

- *`analytics backfill` is a declared, optional action* - settled 2026-07-27,
  §Backfill of historical logs, lands at **task 61**. Today
  `packages/analytics/src/commands.ts`'s `backfill` reports that it is not
  available yet, and the action is declared in `packages/analytics/src/plugin.ts`'s
  command table. It is deliberately absent from `packages/analytics/README.md`.
- *Daily salt rotation stands* - settled 2026-07-27, tasks 41 and 45. The decision
  lives in `packages/analytics/src/transform/visitor-key.ts` (the day-bounded
  correlation window, and why the salt is hashed last) and in the query semantics
  `packages/analytics/src/queries.ts`'s `unique-visitors` states: a monthly figure
  is the sum of daily uniques, not a distinct count. `README.md` §Privacy repeats
  that consequence rather than implying a count the table cannot answer.

### D5 - The plugin-system spec's flip is REFUSED, not deferred for convenience. Owner: task 60

The spec's `Status:` still reads `Proposed`, the file is still at
`.specs/changes/2026-07-26-cli_plugin_system.md`, and `.specs/README.md`'s pending
list holds **three** entries rather than the two this task's definition of done
asks for. This is the most important property of this task, and it is a
deliberate departure from the DoD line as written.

**The condition this task's DoD names is met.** Verified directly, not inherited:
`packages/core/src/aws/endpoint.ts:39` declares `ServiceDescriptor` under the
comment *"core does not enumerate it, so the plugin names its own SigV4 signing
name"*, and `packages/core/src/clients.ts:33` declares
`signingUsEast1: SigningClient`. The seam task 20 was waiting for is in place.

**A second obligation of the same spec is not.** §Plugin SPI -> *A plugin owns its
own topography* requires that *"no config key of a plugin's is read by a site
node"*, and the spec's own Decisions block names the exact violation it expects to
be removed. It is still there: `packages/cli/src/nodes.ts:971` branches on
`ctx.config.pds` inside `oidcRolePolicyStatements`'s `if (!ctx.preview)` limb (`:921`; there is no `githubOidcPolicy` symbol - the name came from the dispatch brief and was echoed here), and `:995`
interpolates `ctx.config.pds.secretName` into the `<env>-deploy` IAM document. The
code says so itself at `:986`: *"Task 59 deletes this statement together with the
`ctx.config.pds` branch around it; the duplication lives only until then."*

Task 59 is parked, not pending: its diff is proven CORRECT but its changeset must
ship a release **later** than task 30's migration note, no release can be cut from
inside a build, and `changeset version` consumes `.changeset/` whole - so the
changeset is held out of the directory and the task file sits in `blocked/`, with
the work preserved at jj bookmark `parked/task-59`. Task 60 inherits that gate.

So the honest disposition is refusal, and it was routed twice before this task
ran. The ROUTED CONSTRAINT above (task 20's verification gate, 2026-08-31) says in
terms: *"if it still stands, defer the flip again and record why, exactly as task
20 did."* plan.md's open questions carry the same finding independently -
*"Task 58 can flip the plugin-system spec to `Merged` while the obligation
blocking it is still open"* - and name the fix as one line in this task's DoD.
This task took the routed instruction over the DoD line it corrects. A `Merged`
header claims the whole spec shipped; flipping it here would claim work that has
not happened, which is the exact failure this plan's risk row exists to prevent.

**Owner: task 60.** Not task 59, which removes the branch but owns no spec flip;
task 60 already flips the pds spec, ships in the same release as 59, and is the
first point at which the topography obligation is true. `.specs/README.md`'s
pending entry 1 now says so, with the reason, so the third entry is not read as an
oversight. What a reviewer should check at task 60 is one grep:
`grep -n "config\.pds" packages/cli/src/nodes.ts` returning nothing.

### D6 - Merge-plan steps 3 and 4 are done; steps 5 and 6 are task 61's

Step 3 (Vite/SvelteKit in the toolchain table, `AnalyticsQuery` in the ports
table) and step 4 (the two workspace counts) are executed in `DEVELOPMENT.md`.
Both counts were silent failures - `pnpm-workspace.yaml`'s `packages/*` glob picks
`packages/analytics` up with no edit, so nothing in CI notices either statement
going stale, and the grep is the only gate. It now returns nothing.

Two things about the ports row worth recording. The spec's §Affected spec pages
says *"New `AnalyticsQuery` and `AnalyticsIngest` ports join the ports table"*;
only `AnalyticsQuery` is added, because `AnalyticsIngest` does not exist -
`grep -rn "AnalyticsIngest" packages/` returns nothing. It arrives with
§Backfill of historical logs at task 61, and a row naming a port and an adapter
that are not there would document a file that is not on disk. And the row's
`Real adapter` and `Test adapter` columns were resolved against the tree rather
than against the spec: `createDuckDbAnalyticsQuery`
(`packages/analytics/src/adapters/duckdb-query.ts:378`) and
`createFixtureAnalyticsQuery` (`packages/analytics/src/fixture-query.ts:71`).

Steps 5 and 6 - the `Status:` flip, the move to `merged/`, and the README removal -
are **task 61's**, because §Backfill of historical logs is outstanding: a spec is
not merged while one of its `Proposed changes` blocks is. That is the same reason
task 30 deferred the pds spec's flip to task 60, and the same reason D5 refuses the
plugin-system spec's here.

### D7 - The routed findings, each adopted or declined with an owner

**Adopted - `DEVELOPMENT.md:132` (§Where validation lives).** The row read
*"`parseArgs` plus explicit dispatch in `cli.ts`; unknown commands fail with
usage"*. Both halves are false since task 29. `packages/cli/src/cli.ts:409` tests
`KNOWN_COMMANDS` membership and hands **everything else** to `runPlugin`
(`packages/cli/src/plugin-commands.ts:638`), which refuses an unknown namespace by
naming `blogwright plugin list` (`:651-657`) and an unknown action by listing that
plugin's own actions (`renderActions`, `:266-278`); usage is printed only for a
bare invocation with no command. The row now says that. This is the shape the plan
warns about - a comment naming a guarantee the code does not give is a step toward
deleting a guard that works - and the file was already open for three other edits.

**Adopted - `packages/analytics/src/transform/handler.ts`.** One phrase: *"the
bundle task 43 produces carries no client, no signer and no transport"* -> *"this
module carries no client, no signer and no transport"*. True of `handler.ts`,
false of the bundle since task 43's `entry.ts` began constructing core's
`SigningClient` and `SecretsManagerClient` with `fetchTransport` inlined. Adopted
here rather than left because this task's step 7 sweeps this exact package for
documentation correctness, and the edit is a comment with no behavioural surface.

**Declined - `docs/src/content/docs/reference/cli.md`. Owner: task 60.** The
finding is confirmed at this tip: `grep -c plugin` on that page is **0**, §Invocation's
positional-layout table (`:22-29`) still lists `blogwright pds secret <action> [env]`
as a layout of its own, and §Exit codes (`:249`) still says `1` covers an "unknown
command, `preview` action, or `pds` action". Declined for two reasons, not one.
This task's own certificate scopes it out - its Residue reads *"The Starlight docs
site under `docs/` is not in this task's scope"* - and, more substantively, that
page documents the **released** CLI, and none of the plugin surface has shipped a
release: `blogwright plugin add`, generic dispatch and the analytics namespace all
land in the release tasks 59 and 60 gate. Documenting `blogwright plugin add
analytics` there now would describe a surface an installed CLI does not have,
which is the same class of false claim D5 refuses. Task 60 is the last task before
that release and already owns the pds spec's operator-visible changes. This is the
**third** finding to reach this page from one cause (task 20's D6 and task 30's
were the first two), so it is recorded in plan.md's open questions as well as here -
if task 60's definition of done is not amended to carry it, it needs a task of its
own rather than a fourth routing.

### D8 - Found while verifying, and one addition beyond the definition of done

**The DoD's TODO check cannot pass, and its result is a function of whether anyone
has built.** Recorded in full beside the DoD line it corrects. Measured both ways
at this tip: 0 matches before `pnpm build`, 7 after, all seven in
`packages/analytics/app/.svelte-kit/output/`, all upstream Svelte TODOs, all under
a gitignored path (`.gitignore:5`).

**`git grep` is not available in a non-colocated jj workspace.** The tracked-file
form the correction adopts exits 128 here, because `.git` lives in the main repo
rather than in the workspace. Recorded with its portable equivalent so the check
runs in either place. Worth knowing for any future task whose DoD names `git grep`.

**Two of this task's `DEVELOPMENT.md` pointers had drifted, and both resolved by
content.** `:246-251` (§Documentation) is at **`:259-265`**; `:328-330` (the
package-split Assumption) is at **`:342-346`** before the edit. `:12`, `:16`,
`:21`, `:72` and `:132` all still resolve. Two of seven, which continues the
measured trend - task 54 found seven of eight, task 55 two of five - and again the
survivors are in the parts of the file this build had not edited.

**One addition beyond the DoD, flagged rather than slipped in.** §Documentation's
first bullet listed the packages whose public exports must carry doc comments as
`blogwright-core`, `blogwright-pds` and `blogwright/rkey`. It now names
`blogwright-analytics` too. The DoD asserts that obligation holds for this package
inside the code; leaving the canonical rule naming three of five packages would
have made that assertion rest on nothing written down. Same class of silent
staleness as the two workspace counts, same file, same edit session.

**The documentation sweep found three real gaps and no others.**
`packages/analytics/src/aws/s3tables.ts`'s `TableBucket`, `Namespace` and `Table`
were exported through `index.ts`'s `export *` with no doc comment; each now
carries one. Everything else resolved: the four `aws/*.ts` modules place their
ownership comment after the import block, attached to the client they define,
which is core's own convention for the same kind of module
(`packages/core/src/aws/logs.ts`, `s3.ts`), not an omission - so no comment was
manufactured to satisfy a mechanical check. `plugin.ts`'s `export default
analyticsPlugin` re-exports a const documented immediately above it.
