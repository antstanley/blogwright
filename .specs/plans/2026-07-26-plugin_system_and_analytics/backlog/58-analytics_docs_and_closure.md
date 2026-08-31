# Task 58 - Document the analytics plugin, update the toolchain and ports tables, and close the change spec

**Plan:** [plan.md](../plan.md) · **Certificate:** [58-analytics_docs_and_closure-certificate.md](58-analytics_docs_and_closure-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Merge plan](../../../changes/2026-07-26-analytics_plugin.md) (steps 3–4 - the toolchain and ports rows and the two stale workspace counts in DEVELOPMENT.md - are actionable today; steps 1–2 are recorded as not-applicable rather than skipped, see this task's first step; the analytics spec's own `Status:` flip, move and README removal are deferred to task 61, which lands its §Backfill of historical logs block) and §Ports → `AnalyticsQuery` (the row the ports table gains) and §Analytics plugin → Namespace and commands (the actions the package README documents)
**Depends on:** 20, 30, 55, 57
**Produces:** the Vite/SvelteKit toolchain row and the `AnalyticsQuery` ports row in DEVELOPMENT.md, a `packages/analytics/README.md` documenting install, the five steady-state actions, the us-east-1 pinning and the privacy contract, a changeset stating the semver impact, the spec's two remaining open questions each resolved or owned, and the plugin-system spec merged - the flip task 20 deferred here - leaving the pds and analytics specs pending, named as tasks 60's and 61's
**Pointers:** `DEVELOPMENT.md:12-22` (the Toolchain table the Vite/SvelteKit row joins, below the `rolldown` row at `:21`; the pnpm row at `:16` says "workspace of four packages" and becomes five), `DEVELOPMENT.md:328-330` (the four-package-split Assumption, which gains `blogwright-analytics` as the second instance of its own feature-package exception), `DEVELOPMENT.md:72-81` (§Hexagonal architecture's ports table the `AnalyticsQuery` row joins, in the same four-column shape as the `Vcs` row at `:80`), `DEVELOPMENT.md:246-251` (§Documentation: doc comments on public exports, a module comment stating what each module owns, no bare `// TODO` without an owner), `packages/analytics/README.md` (new - `packages/pds/README.md:1-10` is the shape: what the package owns, what it depends on, and where the command surface is documented), `packages/analytics/src/ports.ts` (task 45 - where `AnalyticsQuery` is defined and where the fixture-backed fake named in the ports row lives), `packages/analytics/src/adapters/duckdb-query.ts` (task 46 - the real adapter named in the ports row), `packages/analytics/src/config.ts` (task 44 - the recorded table-bucket-per-environment decision the Glue-integration triage draws on), `packages/analytics/src/transform/visitor-key.ts` (task 41 - the recorded salt-stability and cadence decisions), `.changeset/config.json:5` (the `fixed` group `["blogwright", "blogwright-core", "blogwright-pds"]` - decide explicitly whether `blogwright-analytics` joins it), [the analytics change spec](../../../changes/2026-07-26-analytics_plugin.md) (its §Merge plan and its two §Open questions - its `Status:` flip is task 61's, not this task's), [the plugin-system change spec](../../../changes/2026-07-26-cli_plugin_system.md) (its `Status:` header line - task 20 deferred the flip here), `packages/core/src/aws/endpoint.ts` and `packages/core/src/clients.ts` (tasks 31 and 38 - the seam and `signingUsEast1`, the work that flip waits on), `.specs/README.md` §Change specs (the pending list, which this task reduces to two entries naming tasks 60 and 61, and the merged list the plugin-system spec joins - line anchors are deliberately not given for a file this plan's own tasks keep editing)

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

- [ ] Record why merge-plan steps 1 and 2 are not executed, rather than passing over them: step 1 applies the `Proposed changes` blocks to canonical pages for the resource nodes, the AWS clients and the CLI surface "once they exist", and none does; step 2 says to fold `AnalyticsConfig` and `PageView` into the canonical schema, and it is written unconditionally although this repo has no `canonical-types.schema.json` for them to fold into. Both are vacuous today, not done - write that, with an owner, into this task's change description and into plan.md's open questions, exactly as task 20 records the plugin-system spec's step-1 deferral and task 30 records the pds spec's. Task 61 executes steps 5–6 against a spec whose first two steps stay recorded as not-applicable.
- [ ] Triage the spec's two remaining open questions - table record expiration (corrected 2026-07-27: S3 Tables offers no row retention for tables you create, so aging out rows would be whole-`day`-partition deletes the plugin issues itself) and the Glue integration's adopt-and-never-delete contract - recording each as resolved or explicitly scoped out, with an owner. The questions this spec once carried beyond those are settled and need only pointers: the destroy refusal at task 16 (§Namespace and commands), backfill as the declared optional action at task 61 (§Backfill of historical logs, settled 2026-07-27), and the daily salt cadence as the Decision *Daily salt rotation stands* carried by task 45's query semantics.
- [ ] Add the Vite/SvelteKit row to the Toolchain table at `DEVELOPMENT.md:12-22`, stating the version channel and that it builds only the analytics dashboard (`packages/analytics/app` → `dist/app`), in the same column shape as the `rolldown` row at `:21`.
- [ ] Correct the two workspace counts `packages/analytics` invalidates and nothing else catches: the pnpm row's "workspace of four packages under `packages/`" (`DEVELOPMENT.md:16`) becomes five, and the Assumption that "the four-package split (core / cli / pds / build-agent) is stable" (`:328-330`) names `blogwright-analytics` beside `blogwright-pds` as the second worked instance of the exception that admits it. `pnpm-workspace.yaml`'s `packages/*` glob picks the package up with no edit, so nothing fails - the staleness is silent, which is why it needs a step.
- [ ] Add the `AnalyticsQuery` row to the ports table at `DEVELOPMENT.md:72-81` naming the defining module (`analytics/src/ports.ts`), the real adapter (`createDuckDbAnalyticsQuery`, `analytics/src/adapters/duckdb-query.ts`) and the fixture-backed test fake, matching the `Vcs` and `PingBuilder` rows.
- [ ] Write `packages/analytics/README.md` covering install (`blogwright plugin add analytics`), the five steady-state actions (`init`, `bootstrap`, `status`, `dashboard`, `destroy --yes`), the us-east-1 pinning and why CloudFront forces it, and the privacy contract: the raw viewer IP is never stored, and `cs(Cookie)` and `x-forwarded-for` are never selected so they never leave CloudFront. The optional `backfill` action's entry lands with its implementation at task 61 - do not document an action that still raises its not-yet-available error.
- [ ] Sweep the package for the documentation rules at `DEVELOPMENT.md:246-251` - a doc comment on every public export of `blogwright-analytics` and an opening comment on every module stating what it owns - and remove any bare `// TODO` left by tasks 32–57 or give it an owner and a reference.
- [ ] Record the triage in the change description: table record expiration as out of scope with an owner (in its corrected form), the Glue integration's adopt-and-never-delete contract as settled at task 49, and - as pointers to already-settled decisions - backfill at task 61 and the daily-salt cadence at tasks 41/45, each naming where the decision now lives in code.
- [ ] Write the changeset: a new package `blogwright-analytics` plus a minor on `blogwright-core` for the four service clients and the `LogsClient` delivery parameters, and confirm `blogwright-analytics` is in the fixed group at `.changeset/config.json:5` - settled 2026-07-26 and added by task 32, not an open question to re-decide here.
- [ ] Execute the merge plan for ONE spec - the plugin-system spec, whose flip was deferred here by task 20 because §Plugin SPI → Plugin-supplied AWS services - the transport seam and `signingUsEast1` - landed at tasks 31 and 38, after task 20. Verify both are in place (`packages/core/src/aws/endpoint.ts` accepts a service descriptor, `AwsClients` carries `signingUsEast1`), then flip its `Status:` to `Merged` with a `Merged:` date and move it to `.specs/changes/merged/`. Do NOT flip the analytics spec: its §Backfill of historical logs block lands at task 61, and a spec is not merged while one of its `Proposed changes` blocks is outstanding - record that deferral in the change description naming task 61, exactly as task 30 records the pds spec's to task 60. Rewrite `.specs/README.md`'s Change specs section so the merged list gains the plugin-system spec and the pending section holds exactly two entries - the pds spec, flipped at task 60 (its §The site graph drops its pds branch lands at task 59, a release later, and its §`bootstrap` warns while plugin state exists at task 60), and the analytics spec, flipped at task 61. Name both tasks in the pending entries so the remaining work is not mistaken for an oversight.

## Definition of done

- [ ] `DEVELOPMENT.md`'s Toolchain table gains the Vite/SvelteKit row naming the dashboard build as its only use, §Hexagonal architecture's ports table gains `AnalyticsQuery` with its defining module, its real adapter (`packages/analytics/src/adapters/duckdb-query.ts`) and its fixture-backed test fake, in the same column shape as the existing rows, and neither the pnpm toolchain row nor the four-package-split Assumption still says four - `grep -n "four packages\|four-package" DEVELOPMENT.md` returns nothing.
- [ ] `packages/analytics/README.md` documents install (`blogwright plugin add analytics`), the five steady-state actions, the us-east-1 pinning, and states that the raw viewer IP is never stored and that `cs(Cookie)` and `x-forwarded-for` are never selected - the optional `backfill` action's entry is deliberately absent until task 61 lands its body - and the same documentation obligation holds inside the code: every public export of `blogwright-analytics` carries a doc comment and every module opens with a comment stating what it owns.
- [ ] Each of the spec's two remaining open questions - table record expiration (in its corrected 2026-07-27 form: no row retention for self-created S3 tables, so row expiry would be whole-`day`-partition deletes the plugin issues itself) and the Glue integration's adopt-and-never-delete contract - is either resolved in the change description (the Glue contract at task 49, recorded here with the module that holds the decision) or recorded as out of scope with an owner, with pointers for the already-settled backfill (task 61) and salt-cadence (tasks 41/45) decisions; and no bare `// TODO` exists in the new code - `grep -rn "TODO" packages/analytics/` returns nothing without an owner and a reference.
- [ ] Every one of the analytics spec's merge-plan steps is accounted for: steps 1–2 are recorded as not-applicable with their reason (no canonical pages, and no canonical schema for `AnalyticsConfig` and `PageView` to fold into) and an owner, steps 3–4 are executed here, and steps 5–6 are task 61's - so no step is left silently unexecuted when task 61 flips the header.
- [ ] A changeset describes the semver impact - a new package, plus a minor on `blogwright-core` for `signingUsEast1`, the transport seam and the `LogsClient` delivery parameters (the plugin's four service clients live in `blogwright-analytics`, not in core) - and the merge plan of ONE spec is executed: the plugin-system spec's, whose flip task 20 deferred to here because the transport seam and `signingUsEast1` land at tasks 31 and 38 - `Status:` flipped to `Merged` with a `Merged:` date, the file in `.specs/changes/merged/`, and `.specs/README.md` updated so the pending section holds exactly two entries and every link resolves. The plugin-system flip is conditional on the seam actually being in place - `SendOptions.service` accepts a descriptor and `AwsClients` carries `signingUsEast1` - and is recorded as unmet rather than flipped if it is not. The pds and analytics specs are deliberately NOT flipped here: `.specs/changes/` still holds both, and their pending entries name tasks 60 and 61 as their owners, with the analytics deferral (§Backfill of historical logs, task 61) recorded in the change description.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm build && pnpm test && pnpm lint && pnpm exec oxfmt --check . && pnpm knip`, then confirm `.specs/changes/` holds `merged/`, the pds spec and the analytics spec and nothing else, that `.specs/changes/merged/2026-07-26-cli_plugin_system.md` carries a `Merged:` date, and that every link in `.specs/README.md` resolves to an existing file.
