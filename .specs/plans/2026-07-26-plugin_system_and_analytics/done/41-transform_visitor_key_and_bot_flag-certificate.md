# Done Certificate - Task 41: visitor_key derivation and the is_bot flag

**Task:** [41-transform_visitor_key_and_bot_flag.md](41-transform_visitor_key_and_bot_flag.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-30

> This certificate is a verification protocol for Task 41. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 41) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `dailySalt(secret, day)`, `visitorKey(ip, userAgent, salt)` and the bot matcher are wired into `mapRecord` so the produced row carries a defined `visitor_key` and `is_bot`, no field of the row holds the raw viewer IP, and the settled salt decision (one stored secret, per-day salt derived) is recorded in the code.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break task 40's `mapRecord` contract: the drop path, the UTC `event_time`/`day` derivation and the numeric coercions stay as tested; and must not break task 39's `schema.ts` totality - `visitor_key` and `is_bot` remain listed in `DERIVED_COLUMNS`, and the viewer-IP field remains selected but unmapped to any column.

## Validation context

Reviewed workspace `/Users/ant/code/blogwright-task-41` (jj), working copy `zuqozouz` over
parent `tmqrkusp 97be077d build(31/62): land task 40`. Six files changed, 783 insertions /
26 deletions, no other path touched. All 21 targeted mutations plus an exhaustive 18-case
bot-pattern sweep were restored; every file is byte-identical to the pre-review state by
sha256 (`map-record.ts 766d1618…4246`, `map-record.test.ts c0331743…9eb1`,
`visitor-key.ts 3133c988…d315`, `visitor-key.test.ts 9f7a870e…0365`, `bots.ts 11b06491…cdcd`,
`bots.test.ts b2981ae1…62c2`, `schema.ts d176fc42…db18`), and `jj status` lists exactly the
six expected paths.

## Obligations

- **O1 - Pinned digests and daily turnover.**
  - *Claim:* `dailySalt` is `HMAC-SHA256(secret, day)` and `visitorKey` is a SHA-256 digest over IP, user agent and salt, each locked by a pinned-vector test with a literal expected digest, and turnover assertions show same-day stability and next-day difference.
  - *Evidence collected:* four literal hex digests, all **independently reproduced outside the implementation** before the code was executed. `visitor-key.test.ts:24` `PINNED_SALT` and `:25` `PINNED_NEXT_DAY_SALT` reproduce exactly under `printf '%s' '2026-08-30' | openssl dgst -sha256 -hmac 'K7mQ…J0lA'` (`df58b7a7…11b6`) and the same for `2026-08-31` (`cce2e983…c728`). `visitor-key.test.ts:26` `PINNED_VISITOR_KEY` (`ae823260…2c00`) and `map-record.test.ts:270` `NO_USER_AGENT_VISITOR_KEY` (`25f516de…d296`) reproduce under a stand-alone Python script written from the module doc comment's stated framing, not read from `visitor-key.ts`. `map-record.test.ts:83` pins the same `ae823260…2c00` as a literal inside `FULL_ROW`, so the fixture row and the unit vector are the same value from two files. Turnover: `turns the salt over at the day boundary`, `gives one visitor two keys on two days`, `gives the same visitor the same key within a day`, `gives one visitor one key across a day of requests` all pass.
  - *Checks run:* `createHash`/`createHmac` resolve to the single import `from 'node:crypto'` at `visitor-key.ts:41` - no local redeclaration, no re-implementation; `node:crypto` is **not** in the `no-restricted-imports` list (`.oxlintrc.json:53-69` restricts `fs`, `child_process`, `readline`, `module` only), and `packages/core/src/aws/s3.ts` is the standing precedent. Separator: the certificate's own example pair `("1.2.3","4")` / `("1.2","34")` concatenates to `1.2.34` / `1.234` and is **not** ambiguous under plain concatenation; the implementer's substitution `("1.2.3","45")` / `("1.2.34","5")` both concatenate to `1.2.345` and genuinely collides, so the replacement is correct and the disclosure honest. **M2** (`framed` returns `value`, i.e. plain concatenation) reddens both `keeps the boundary between … unambiguous` cases plus the pinned key. The framing is a netstring-style length prefix and is injective: the decimal length run terminates at the first `:`, so a fixed-arity concatenation decodes deterministically whatever bytes the attacker-supplied user agent carries. The count is `Buffer.byteLength`, matching the UTF-8 encoding `update` applies. **The salt is hashed last** (`visitor-key.ts:132`, `framed(ip) + framed(userAgent) + framed(salt)`), so no Merkle-Damgård length-extension property applies to a secret prefix; **M3** (salt moved first) reddens the pinned key, so the order is pinned, not incidental. **M14** (HMAC key/message swapped) reddens both pinned salts, so the direction - secret as key, public day as message - is pinned.
  - *Status:* ☑ **SATISFIED**

- **O2 - The raw viewer IP reaches no column.**
  - *Claim:* a test searches every value of the produced row for the fixture IP and finds no match.
  - *Evidence collected:* `map-record.test.ts:338` `writes no value holding the viewer IP for $label` runs over three records (fully populated, bot, no user agent), iterates `Object.entries(row)` asserting `String(value)` does not **contain** the address, and adds a `JSON.stringify(row)` sweep. Its non-vacuity guards are intact and load-bearing: `expect(record[VIEWER_IP_FIELD]).toBe(VIEWER_IP)` proves the fixture really carries the address, and `expect(row.visitor_key).toMatch(/^[0-9a-f]{64}$/)` proves the row really was keyed from it. Task 40's `writes the viewer IP into no column` (`map-record.test.ts:179`) survives unchanged, with its own guard `expect(FULL_RECORD[VIEWER_IP_FIELD]).toBe(VIEWER_IP)`.
  - *Checks run:* **MR9** - adding `'c-ip': 'country'` to `FIELD_TO_COLUMN` in `schema.ts` reddens 12 tests including task 40's `writes the viewer IP into no column` and all three new whole-row cases; restored. The adversarial variant `'c-ip': 'visitor_key'` was also run: it does **not** put the address in the row (the derivation at `map-record.ts:341` overwrites it) and is caught instead by the three column-set assertions, so both spellings of the regression fail loudly. Code path traced: the viewer IP is read once, at `map-record.ts:336`, and flows only into `visitorKey` at `:341`; `VIEWER_IP_FIELD` has no `FIELD_TO_COLUMN` entry so the rename loop cannot reach it. The drop reason for an unusable `c-ip` provably cannot carry the address either - `stringFrom`'s only two `invalid()` details interpolate `String(raw)` for a non-finite **number** (`map-record.ts:198`) and bare `typeof raw` otherwise (`:201`).
  - *Status:* ☑ **SATISFIED**

- **O3 - The salt is derived from a stored secret, and injected.**
  - *Claim:* the module records the settled decision and the code implements it: both functions pure, secret/day/inputs as arguments, no secret and no clock read, and a test passes two different days without stubbing time.
  - *Evidence collected:* the decision note at `visitor-key.ts:8-30` states all three required elements - the 2^32 IPv4 brute-force reason a date-only salt is rejected, the "rotation Lambda, a schedule and a second execution role, more moving parts than the thing they protect" reason managed rotation is rejected, and the consequence that replacing the stored secret after rows exist makes `visitor_key` incomparable across the boundary with no reprocessing able to repair it, which is why the node never rewrites it. `grep -n "Date.now()\|new Date()\|vi.setSystemTime\|vi.useFakeTimers\|SecretsManager\|process.env" visitor-key.ts` returns nothing (exit 1). `dailySalt(secret: string, day: string)` takes exactly a secret and a day; `bots.ts` imports nothing at all. `turns the salt over at the day boundary` and `gives one visitor two keys on two days` pass two literal days with no fake timers anywhere in the package.
  - *Checks run:* **the `mapRecord(record, saltSecret)` premise verified, not accepted.** The second parameter is the *secret*, not a salt, because the day the salt must match comes from the record's own `timestamp(ms)` (`map-record.ts:305-308`, then `dailySalt(saltSecret, day)` at `:344`). The premise that a batch straddles days is real: task 42's own package fixes the working assumption at a 60-second Firehose buffer ("roughly 43,000 `GetSecretValue` calls a month at a 60-second Firehose buffer"), so on a continuously trafficked site one buffer window per day contains midnight, and the backfill path (task 61) maps whole historical days through the same function. **M4** (`dailySalt(saltSecret, '2026-08-30')`, a fixed day) reddens **exactly one** test, `salts each record with the day the record itself falls on` (`map-record.test.ts:283`), which also asserts `tomorrow.day === '2026-08-31'` and `tomorrow.visitor_key !== FULL_ROW.visitor_key`. The inverse task 45 depends on holds: the same `(ip, ua)` under two salts gives two keys (`gives two different salts two different keys`, plus the two-day case above), so a cross-day `COUNT(DISTINCT visitor_key)` is uncomputable by construction rather than merely discouraged, and no mutation was found that makes a key stable across days without reddening a pinned vector. **Throw rather than degrade** confirmed on all four inputs, each guard load-bearing: **M10** (empty-secret guard removed) reddens 2, **M11** (empty-day) 2, **M12** (empty IP) 2, **M13** (empty salt) 2. The provisioning node for the stored secret is **task 50** (`analytics-salt-secret`, created when absent, never rewritten, no Secrets Manager rotation, `GetSecretValue` on that ARN alone), so the certificate's residue concern about an unowned secret is answered rather than open.
  - *Status:* ☑ **SATISFIED**

- **O4 - Bots are flagged, never dropped, and absent user agents still produce a row.**
  - *Claim:* `is_bot` is set from a user-agent match, a bot record is still returned with every other column populated, and an absent or empty user agent produces a row with a defined `is_bot` and a defined `visitor_key`.
  - *Evidence collected:* `flags a bot record and still returns every column of it` (`map-record.test.ts:352`) asserts the **whole row** by `toStrictEqual` against `FULL_ROW` with only `user_agent`, `is_bot` and `visitor_key` substituted, then re-asserts `Object.keys(row).sort()` equals the full column set - not merely that a bot was detected. `still fills is_bot and visitor_key when the user agent is $label` covers missing / `-` / empty and asserts `typeof row.is_bot === 'boolean'`, `row.is_bot === false`, `typeof row.visitor_key === 'string'` and the pinned `NO_USER_AGENT_VISITOR_KEY`. No `null` is written for either column on any path. The absent-IP and unusable-IP cases are distinguishable and each independently falsifiable: `leaves visitor_key unwritten when the viewer IP is $label` (`:312`, three cases, which also assert every required column is still present) and `drops a record whose viewer IP is present but unusable` (`:321`, asserting `drop.column === 'visitor_key'` and `drop.field === 'c-ip'`).
  - *Checks run:* **M6** (return a drop when the matcher says bot) reddens `flags a bot record …` and the bot whole-row IP case. **M21** (`is_bot` hard-coded `false`) reddens `flags a bot record …`. **M7** (absent IP keyed on a placeholder anyway) reddens all three `leaves visitor_key unwritten` cases. **M8** (unusable IP no longer drops) reddens `drops a record whose viewer IP is present but unusable` alone, so the two IP outcomes are separately pinned. **M9** (`is_bot`/`visitor_key` read the user agent off the *record* instead of the row) reddens 2, so the "hashed text = matched text = stored text" property at `map-record.ts:266-269, 327` is load-bearing, not just documented. Bot patterns: an exhaustive **18-of-18 removal sweep** shows a perfect bijection - every pattern is matched by exactly one sample and every sample by exactly one pattern, so each `flags $label` case fails on removal of its own pattern and none rides on `/bot\b/i`. **M19/M5** (`/bot\b/i` → `/bot/i`) reddens **only** `does not flag 'a CUBOT phone…'`, confirming the near-miss claim exactly. **M20** (adding the `g` flag) reddens `holds no stateful pattern` and two behavioural cases. **M18** (a pattern with no sample) reddens `has a sample user agent for every pattern`. **M15** (`undefined` guard flipped) reddens 4. **M16** (empty-string guard removed) reddens **nothing**, exactly as the implementer disclosed: that guard is documentary today because no pattern matches an empty string. The judgement on absent/empty answering `false` is sound against the spec, which asks only that a match set the flag and that nothing be dropped for it: the column records that an agent named itself, and a request that named nothing has named nothing.
  - *Status:* ☑ **SATISFIED**

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* all six CI gates run from the workspace root in CI order, all green. `pnpm build` Done (5 packages). `pnpm typecheck` Done. `pnpm test`: core 143 passed / 1 skipped, build-agent 27, pds 100, **analytics 297 (10 files)**, cli 304. `pnpm lint` Done; `pnpm exec oxlint src` in `packages/analytics` produces **zero output** (the 19 `no-shadow` warnings in the root run are pre-existing in `packages/cli/src/nodes.test.ts`, untouched here). `pnpm exec oxfmt --check .`: "All matched files use the correct format", 160 files. `pnpm knip` exits 0 with no output - notably it does not flag `BOT_USER_AGENT_PATTERNS`, whose only consumer besides `isBotUserAgent` is `bots.test.ts`. Limits and vocabulary are named module constants: `DIGEST_ALGORITHM`, `DIGEST_ENCODING` (`visitor-key.ts:44,47`), `BOT_USER_AGENT_PATTERNS` (`bots.ts:42`, a named module constant, not literals at the call site), `VISITOR_KEY_COLUMN`, `IS_BOT_COLUMN`, `USER_AGENT_COLUMN` (`map-record.ts:164-168`, each `satisfies PageViewColumnName`). Errors are raised with context: all four guards throw a message naming the function, the missing input and the consequence. No `null` is used for a domain value.
  - *Checks run:* **changeset: not required, and correctly omitted.** `packages/analytics/src/index.ts` re-exports only `./aws/*` and `ANALYTICS_NAMESPACE`; `visitorKey`, `dailySalt`, `isBotUserAgent`, `BOT_USER_AGENT_PATTERNS` and `mapRecord` reach no published `exports` surface, so nothing user-facing moved. This is the same call tasks 36 and 40 made for this package, and the plan schedules the analytics changeset coverage at task 58.
  - *Status:* ☑ **SATISFIED**

- **O6 - Reviewable: the pinned digest is literal and the IP search test is load-bearing (Reviewable).**
  - *Claim:* a reviewer can run `pnpm --filter blogwright-analytics exec vitest run visitor-key bots map-record --reporter=verbose` inside `packages/analytics` and observe the pinned digest as a literal, and can make the whole-row IP search test fail by mapping the viewer-IP field back to a column.
  - *Evidence collected:* the command as written runs from `packages/analytics` and reports **Test Files 3 passed, Tests 121 passed** (bots 33, visitor-key 25, map-record 63). The pinned digests are literal string constants at `visitor-key.test.ts:24-26` and `map-record.test.ts:83,270-271`, and were reproduced independently under O1 rather than read back from the implementation. Mapping the viewer-IP field back into `FIELD_TO_COLUMN` (MR9, O2) reddens the search test; `schema.ts` restored and the suite re-run green.
  - *Status:* ☑ **SATISFIED**

## Regression check

- `packages/analytics/src/transform/map-record.ts` `mapRecord` is called by task 40's fixture tests with a complete record → all of task 40's assertions survive **verbatim**. The only edits to `map-record.test.ts` inside task 40's own blocks are the mechanical call-site updates `mapRecord(record)` → `mapRecord(record, SALT_SECRET)` (`:122,:129,:136`) and the two additions the hand-off *designed*: `FULL_ROW` gains `visitor_key` and `is_bot` (`:83-84`) and `COLUMNS_FILLED_HERE` gains the two names (`:88-96`). No assertion was loosened, no expectation deleted, no `toStrictEqual` downgraded, no case removed; the `writes only page_views columns` length check and the `has a drop case for every column the table requires` totality check both got *stronger* by the constant growing. Baseline measured directly: restoring `map-record.{ts,test.ts}` to the parent revision and removing the two new files gives **222 tests in 8 files, all passing**; the current tree is 297 in 10, a delta of exactly 75 = 33 (bots) + 25 (visitor-key) + 17 (new `mapRecord` cases). The UTC `event_time`/`day` derivation, the numeric coercions and the drop path with its named field all still pass unchanged. : ☑ **PRESERVED**
- `packages/analytics/src/schema.ts` `DERIVED_COLUMNS` is read by task 39's totality test → `schema.ts` is **not in the diff at all**; `visitor_key` and `is_bot` remain listed in `DERIVED_COLUMNS`, `VIEWER_IP_FIELD` remains selected via `DERIVATION_ONLY_FIELDS` and unmapped in `FIELD_TO_COLUMN`, and `schema.test.ts` is green inside the 297. : ☑ **PRESERVED**

## Integration

`mapRecord` gains a **required** second parameter, a contract change for tasks 42 and 61.
`grep -rn "mapRecord"` over both the workspace and the main tree at build 32 finds no
non-test caller anywhere: the only call sites are `map-record.test.ts:122,129,136`, all
updated. Tasks 42 and 61 exist only as backlog documents and both already specify the
two-argument shape. Merge: build 32 (`zxzwmomx`, task 17) touches only `packages/cli/**`,
`.changeset/**` and `.specs/**`; the file sets are disjoint from this task's six paths, so a
plain merge onto the bookmark is clean by construction.

## Residue

- The bot list's breadth is a judgement call the DoD does not constrain, and the set is
  defensible as scoped ("self-declaring agents only"). Worth a later pass, not a blocker:
  `node-fetch`, `axios`, `Guzzle`, `Dalvik` (Android's default stack) and WhatsApp link
  previews all name themselves and are unmatched today.
- `/bot\b/i`, `/crawler\b/i` and `/spider\b/i` are anchored on the right only, deliberately,
  so `MJ12Crawler` matches. The cost is that `CUBOT_X30` survives only because `_` is a word
  character; a model rendered `CUBOT X30` would be flagged. Bounded by flag-don't-drop and
  stated in the module comment.
- Retention/expiry of `visitor_key` values remains an open question in the change spec and is
  out of scope here.

## Defects (all non-blocking; none changes behaviour)

- **D1 - `visitor-key.ts:57`, wrong arithmetic in the one comment that teaches the
  construction.** The doc says the pair frames to `5:1.2.32:45` and `7:1.2.341:5`;
  `Buffer.byteLength('1.2.34')` is 6, so the code produces `6:1.2.341:5`. The implementation
  is correct and pinned by the vector - only the worked example is off by one. A reader
  checking the doc's own arithmetic against `framed` finds a mismatch in the security-critical
  module and has to prove the code right before trusting it. One character.
- **D2 - `map-record.test.ts:179`, task 40's IP assertion is the weaker of the two.** It uses
  `expect(Object.values(row)).not.toContain(VIEWER_IP)`, exact array membership, so an address
  *embedded* in a larger string escapes it. Demonstrated: mutation M17, which writes the
  address into the `query` column as `src=<address>`, leaves that test **green** while the three
  new `writes no value holding the viewer IP` cases redden. Inherited, not introduced - but the
  load-bearing privacy check is the new one, and the old title is the one a future reader will
  trust.
- **D3 - unpinned invariant: the drop reason must not carry the address.** For an unusable
  `c-ip`, `dropped(VISITOR_KEY_COLUMN, VIEWER_IP_FIELD, detail)` (`map-record.ts:338`) is
  handed to task 42's `ProcessingFailed`, which Firehose routes to the error bucket. Today it
  provably cannot leak: `stringFrom`'s two `invalid()` details interpolate only
  `String(raw)` for a non-finite number (`:198`) and `typeof raw` (`:201`). But `numberFrom`
  at `:231` already interpolates the raw value verbatim (`holds "${raw}"`), so the pattern
  exists in the same file, and no test would catch the day someone made `stringFrom` match it.
  One line closes it: `expect(drop.reason).not.toContain(VIEWER_IP)` inside
  `drops a record whose viewer IP is present but unusable` (`map-record.test.ts:321`). The
  whole-row search cannot cover this, because a dropped record has no row.
- **D4 - `map-record.test.ts:139`, stale title.** Reads "plus the two it derives" while the
  constant it asserts against now covers four. `map-record.ts:161` was updated to "four"; the
  test title was not.

## Conclusion

VERDICT: ☑ **DONE**
CONFIDENCE: ☑ **high**
SUMMARY: All six obligations are satisfied on collected evidence - four pinned digests
reproduced independently with `openssl` and a from-the-doc-comment script, 21 targeted
mutations plus an exhaustive 18-of-18 bot-pattern sweep each reddening precisely the tests
claimed (the sole mutation that reddens nothing being the empty-user-agent guard the
implementer disclosed as documentary), all six CI gates green from the workspace root, task
40's assertions preserved verbatim with the two designed fixture additions and nothing
loosened, and a clean two-argument contract with no existing caller; the four recorded defects
are a doc-comment arithmetic slip, an inherited weaker assertion superseded by a stronger one,
an unpinned drop-reason invariant that holds today, and a stale test title.
