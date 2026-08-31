# Done Certificate - Task 39: The page_views column set, partitioning and CloudFront field selection in one module

**Task:** [39-analytics_table_schema_and_field_selection.md](39-analytics_table_schema_and_field_selection.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 39. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.
>
> **Third pass.** Pass 1 returned CONCERNS on two unfalsifiable assertions. Pass 2 proved the
> fix over-corrected: it deleted a *falsifiable* assertion alongside the unfalsifiable one, and
> replaced it with a comment claiming a guarantee that does not exist. This pass verifies only
> the delta that answers pass 2, having first confirmed the rest of the task is untouched.

## Scope of this pass, and why it is narrow

`packages/analytics/src/schema.ts` is **byte-identical** to the file pass 2 verified exhaustively.
Established from jj's operation log, not from assertion: hashing the file at every working-copy
snapshot shows `sha256 = 90f22db2c2c35784…` unbroken from op `a3d7aa810754` (13:00:29) through
the current working copy, and pass 2's certificate was written at 13:10, inside that window.
`schema.test.ts` changed in the same interval (`8c8b91f378ae7597` → `852a7d279b2b4d6a`).

Accordingly, pass 2's findings on `schema.ts` are **inherited, not re-derived**: the twenty column
names and their order against the spec's §Table schema prose and the `PageView` `$defs`, the
eighteen CloudFront field spellings against AWS standard-logging v2, the three ambiguity
resolutions (`x-host-header`, `x-edge-result-type`, `sc-bytes`), the five-column `required` set,
and the module's import-free purity. Everything below about `schema.test.ts`, and every gate
result, was run fresh here.

## Definition

DONE(Task 39) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/analytics/src/schema.ts` is the single home for the `page_views` column set, its `day` partition, the CloudFront record-field selection and the field-to-column mapping, read by the transform, the table node and the delivery node rather than restated in each.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break anything - this task adds a new module in a package that has no consumers yet. The invariant to protect is the spec's own contract: the twenty column names and the five-column `required` set in the spec's §Type changes `PageView` fragment are the authority, and a divergence here silently corrupts every later task.
- **P4 - Baseline in force.** `plan.md:93-101` ("`pnpm knip` is a signal, not an obstacle") is inherited by this task and names task 39 by name: an assertion which cannot fail is a **defect**, not a style note, and manufacturing a consumer for a knip-flagged export is not an acceptable answer.

## The delta under review

`schema.test.ts` only, three changes, diffed against the exact file pass 2 read:

1. **`schema.test.ts:97-105`** - restores the assertion pass 2 found had been wrongly deleted, written against the string literal `'timestamp(ms)'` rather than the unexported `TIMESTAMP_MS_FIELD` constant, with a six-line comment explaining why the literal and not the constant.
2. **`schema.test.ts:113-120`** - rewrites the `FIELD_TO_COLUMN totality` comment. The claim pass 2 falsified ("earns its keep against `DERIVATION_ONLY_FIELDS` drifting") is gone; the replacement claims only the construction guarantee and "a future edit that stops deriving the list this way".
3. **`schema.test.ts:17-35`** - replaces `it('accepts a row built from the derived PageView type')`, whose runtime `expect(row.status).toBe(200)` could not fail, with a module-scope `const _MINIMAL_PAGE_VIEW = {…} satisfies PageView;` carrying a comment that states the check is discharged by `pnpm typecheck`.

## Obligations

- **O1 - Column table, types, partition, required split, lowercase names.**
  - *Claim:* `PAGE_VIEWS_COLUMNS` lists exactly the twenty columns the spec names, in order, with Iceberg types matching the `PageView` `$defs` JSON types, `required: true` exactly for `event_time`, `day`, `host`, `uri`, `status`, the `day` partition declared as a named constant, and a test iterating the table asserts `^[a-z0-9_]+$` on every name.
  - *Evidence collected:* the data (`schema.ts:58-79`, `:85`) is byte-identical to the table pass 2 checked name-by-name against the spec, so the correspondence is inherited. The **tests** over it were re-proven falsifiable here by mutation: renaming `uri`→`Uri` fails four tests including the generated `column "'Uri'" is a lowercase catalog-safe identifier` case (the `it.each(PAGE_VIEWS_COLUMNS)` at `:63` is generated from the table, not a hardcoded sample); duplicating the `is_bot` entry fails `has no duplicate column names`; flipping `query` to `required: true` fails the required-set test; retargeting `PAGE_VIEWS_PARTITION_COLUMN` to `'event_time'` fails the partition test. 32 tests, all passing on the restored copy.
  - *Status:* ☑ SATISFIED

- **O2 - Field selection excludes personal-data fields and keeps the viewer IP.**
  - *Claim:* `CLOUDFRONT_RECORD_FIELDS` lives in the same module, contains neither `cs(Cookie)` nor `x-forwarded-for`, and contains the viewer-IP field.
  - *Evidence collected:* `CLOUDFRONT_RECORD_FIELDS` (`schema.ts:180-183`) is built from exactly two sources, `Object.keys(FIELD_TO_COLUMN)` and `DERIVATION_ONLY_FIELDS`; neither excluded string appears in either. Both tests re-proven falsifiable here: splicing a literal `'cs(Cookie)'` into `CLOUDFRONT_RECORD_FIELDS` fails the negative-space test at `:87`; changing `VIEWER_IP_FIELD` to `'c-ipx'` fails the viewer-IP test at `:92`. Field spellings against AWS v2 inherited from pass 2.
  - *Status:* ☑ SATISFIED

- **O3 - Mapping totality in both directions.**
  - *Claim:* every entry in `CLOUDFRONT_RECORD_FIELDS` maps to exactly one column, and every column is either a mapping target or listed in `DERIVED_COLUMNS`.
  - *Evidence collected:* all four totality tests pass, and **all four are now falsifiable** - including the field direction, which pass 2 recorded as unfalsifiable-by-construction. The rewritten comment's positive claim was tested directly: adding a hand-written `'cs(Cookie)'` entry to `CLOUDFRONT_RECORD_FIELDS` (an edit that stops the list being purely derived) fails `:121` with `field "cs(Cookie)" is selected but has no mapped column and is not listed in DERIVATION_ONLY_FIELDS`. The column direction fails under three separate mutations (renamed column, dropped `DERIVED_COLUMNS` entry, deleted `FIELD_TO_COLUMN` entry); the exact-coverage test at `:145` additionally fails when two fields are pointed at the same column (`'cs-protocol-version': 'protocol'` added).
  - *Status:* ☑ SATISFIED

- **O4 - The module is pure.**
  - *Claim:* `schema.ts` imports no Node builtin, no vendor SDK and no `fetch`.
  - *Evidence collected:* inherited - the file is byte-identical to the one pass 2 verified has no import statement at all, its only module-scope call being `Object.keys`. Re-confirmed indirectly: `pnpm build` and `pnpm typecheck` pass with no dependency resolution.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, behaviour is covered in positive **and negative** space, and no assertion in the diff is one that cannot fail.
  - *Evidence collected:* **the hole pass 2 measured is closed, and closed by the restored assertion specifically.** Deleting the `TIMESTAMP_MS_FIELD` block from `schema.ts` together with its `DERIVATION_ONLY_FIELDS` entry - the exact edit that was previously invisible - now yields `1 failed | 33 passed` across the whole analytics suite, the single failure being `schema.test.ts:97` with `expected [ 'x-host-header', …(16) ] to include 'timestamp(ms)'`. It is the **only** failure: `pnpm typecheck`, `pnpm --filter blogwright-analytics lint` and `pnpm knip` all stay green under that mutation, confirming the implementer's justification for restoring it. Restored and hash-verified.
    **The corrected comment is true in both directions.** Negative control: dropping `TIMESTAMP_MS_FIELD` from `DERIVATION_ONLY_FIELDS` leaves the totality test at `:121` green; adding a bogus entry to `DERIVATION_ONLY_FIELDS` also leaves it green. The comment no longer claims to guard that drift, and does not overclaim in any other respect. Positive control above under O3.
    **The `satisfies PageView` replacement has real teeth**, proven by four distinct typecheck mutations: dropping the required `status` gives `TS1360 … does not satisfy the expected type 'PageView'`; misspelling `is_bot`→`is_bott` gives `TS2561 … Did you mean to write 'is_bot'?`; adding `not_a_column` gives `TS2353`; `status: '200'` gives `TS2322`. All four are reported against `src/schema.test.ts`, which also demonstrates `tsconfig.typecheck.json`'s `"exclude": []` really does pull the test file into the typecheck gate. It still keeps `PageView` off knip: deleting the block and its import makes knip report `Unused exported types (1) PageView packages/analytics/src/schema.ts:105:13`. This is not a manufactured consumer under P4 - it is a check with four proven failure modes that happens also to satisfy knip.
    **The `_` prefix is required, not cargo-culted:** renaming to `MINIMAL_PAGE_VIEW` fails the lint gate with `src/schema.test.ts:28:7: error eslint(no-unused-vars): Variable 'MINIMAL_PAGE_VIEW' is declared but never used. Unused variables should start with a '_'.`
    **Every `it` in the file can fail** - all thirteen blocks walked and each driven to failure by a concrete mutation; see the walk below. No assertion in the file is unfalsifiable-by-construction.
    All six gates re-run from the repo root on the restored copy and green in order: `pnpm build` clean; `pnpm typecheck` clean; `pnpm test` green (core 140, analytics 34, build-agent 27, pds 96, cli 259); `pnpm lint` clean for `packages/analytics`, the only warnings being twenty pre-existing `no-shadow` hits in `packages/cli/src/nodes.test.ts`, a file `jj st` confirms is not in this diff; `pnpm exec oxfmt --check .` all 144 files correct; `pnpm knip` exits 0 with no output, with `knip.json` unchanged.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: the totality test catches a deleted mapping entry (Reviewable).**
  - *Claim:* a reviewer can run the named command inside `packages/analytics`, delete one entry from `FIELD_TO_COLUMN`, and observe the totality test fail naming the orphaned column.
  - *Evidence collected:* the `Reviewable:` line was run **as written** (`pnpm --filter blogwright-analytics exec vitest run schema --reporter=verbose`) from inside `packages/analytics`; the `--filter` correctly resolves `blogwright-analytics` regardless of cwd. Baseline 32/32. Deleted a **third** distinct entry, `'c-country': 'country'` (`schema.ts:164`), independent of the entries pass 1 and pass 2 used: `2 failed | 30 passed`, the first being `AssertionError: column "country" has neither a mapped CloudFront field nor a DERIVED_COLUMNS entry: expected false to be true`, naming the orphaned column as the task requires; `:145` failed alongside it with the set diff. Restored, 32/32 green.
  - *Status:* ☑ SATISFIED

## Falsifiability walk - every `it` in `schema.test.ts`

The standing bar for this task. Thirteen `it`/`it.each` blocks yielding 32 cases; each driven to
red by a real mutation on this working copy.

| # | Location | Mutation that makes it fail |
|---|---|---|
| 1 | `:38` names the twenty columns in order | rename `uri`→`Uri`; duplicate the `is_bot` entry; delete the `day` column |
| 2 | `:63` `it.each` lowercase name (20 cases) | rename `uri`→`Uri` (case `column "'Uri'"` goes red) |
| 3 | `:70` no duplicate column names | duplicate the `is_bot` entry |
| 4 | `:75` required set | flip `query` to `required: true`; rename `uri`→`Uri` |
| 5 | `:80` partitions on `day` | retarget `PAGE_VIEWS_PARTITION_COLUMN` to `'event_time'` (assertion 1); delete the `day` column (assertion 2 - see note) |
| 6 | `:87` never selects `cs(Cookie)`/`x-forwarded-for` | splice `'cs(Cookie)'` into `CLOUDFRONT_RECORD_FIELDS` |
| 7 | `:92` selects the viewer-IP field | `VIEWER_IP_FIELD = 'c-ipx'` |
| 8 | `:97` selects `timestamp(ms)` **(the restored one)** | delete the `TIMESTAMP_MS_FIELD` block and its `DERIVATION_ONLY_FIELDS` entry |
| 9 | `:107` no duplicate field names | list `VIEWER_IP_FIELD` twice in `DERIVATION_ONLY_FIELDS` |
| 10 | `:121` every selected field accounted for | hand-write a `'cs(Cookie)'` entry into `CLOUDFRONT_RECORD_FIELDS` |
| 11 | `:133` every column accounted for | delete `'c-country': 'country'`; drop `is_bot` from `DERIVED_COLUMNS`; rename `uri`→`Uri` |
| 12 | `:145` exact coverage, no duplicate targets | add `'cs-protocol-version': 'protocol'`; delete `'c-country'`; drop `is_bot` from `DERIVED_COLUMNS` |
| 13 | `:154` derived columns are exactly the four | drop `is_bot` from `DERIVED_COLUMNS` |

Plus `_MINIMAL_PAGE_VIEW` (`:28-35`), which is not an `it` and is discharged by `pnpm typecheck`
rather than the runner - four proven failure modes, recorded under O5.

## Regression check

No existing callers in scope - `schema.ts` is new and, at this task, imported only by its own
test. The consumers it is written for (task 40's transform, task 48's table node, task 53's
delivery node, task 61's backfill) do not exist yet. `jj st` shows exactly two added files and
`jj diff --stat` 358 insertions, 0 deletions; `knip.json` is untouched. The full suite and every
gate pass. Every mutation made during this validation was reverted and the revert proven:
`sha256(schema.ts) = 90f22db2c2c35784c16ab954ecf05ccdd5dee23053dbf43b5bb90b540cd56ce3` and
`sha256(schema.test.ts) = 852a7d279b2b4d6a7ecaa607c28105abd141bd0eb2de53312e2edc00e65e9382`,
both byte-identical to the pre-validation copies.

## Residue

Notes only. Neither is a defect and neither defeats an obligation.

1. **`schema.test.ts:82` is redundant, not unfalsifiable.** `expect(PAGE_VIEWS_COLUMNS.some((c) => c.name === PAGE_VIEWS_PARTITION_COLUMN)).toBe(true)` looks construction-guaranteed, because `PAGE_VIEWS_PARTITION_COLUMN` is typed `PageViewColumnName` and so cannot hold a name outside the table while typecheck is green. It was tested rather than reasoned about: deleting the `day` column makes it go red at runtime (vitest does not typecheck), so it *can* fail. The same edit is also caught by `:38` and by three typecheck errors, so the assertion adds no coverage - but redundancy is not the defect class this task was returned for, and it documents the invariant at the point of use. Left as written.

2. **`CLOUDFRONT_RECORD_FIELDS` loses its literal types**, as recorded by both prior passes: spreading `Object.keys(FIELD_TO_COLUMN)` (typed `string[]`) makes the sixteen mapped names `string` rather than literals under `as const`. Harmless for task 53, whose `createDelivery` takes string-typed `recordFields`. A `keyof typeof FIELD_TO_COLUMN` assertion on the spread would restore it.

The `day` partition transform (identity on a date column versus a `day()` transform over
`event_time`) remains task 48's to settle.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: The delta answers pass 2 on all three counts, each established by control rather than by reading: the restored `timestamp(ms)` assertion is now the sole gate that catches deleting the field `event_time` and the `day` partition are derived from (1 failed of 34, with typecheck, lint and knip all still green under that mutation); the rewritten totality comment no longer claims the `DERIVATION_ONLY_FIELDS` guard that negative control shows does not exist, while its remaining positive claim was confirmed by making a hand-written selection entry fail the test; and the `satisfies PageView` replacement for the vacuous runtime `expect` fails typecheck under four distinct mutations, keeps `PageView` off knip, and genuinely needs its `_` prefix to pass oxlint. All thirteen `it` blocks were individually driven to failure, so the unfalsifiable-assertion defect class that returned this task twice is absent; O1-O6 all hold and all six gates are green on a working copy proven byte-identical to the one submitted.
