# Done Certificate — Task 41: visitor_key derivation and the is_bot flag

**Task:** [41-transform_visitor_key_and_bot_flag.md](41-transform_visitor_key_and_bot_flag.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 — unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 41. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 41) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) — not by assertion.

## Premises

- **P1 — Goal.** `visitorKey(ip, userAgent, salt)` and the bot matcher are wired into `mapRecord` so the produced row carries a defined `visitor_key` and `is_bot`, no field of the row holds the raw viewer IP, and the salt-stability open question is answered in the code.
- **P2 — Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 — Invariants.** Must not break task 40's `mapRecord` contract: the drop path, the UTC `event_time`/`day` derivation and the numeric coercions stay as tested; and must not break task 39's `schema.ts` totality — `visitor_key` and `is_bot` remain listed in `DERIVED_COLUMNS`, and the viewer-IP field remains selected but unmapped to any column.

## Obligations

- **O1 — Pinned digest and daily rotation.**
  - *Claim:* `visitorKey` is a SHA-256 digest over IP, user agent and salt, locked by a pinned-vector test with a literal expected digest, and rotation assertions show same-day stability and next-day difference.
  - *Evidence to collect:* read `packages/analytics/transform/visitor-key.test.ts` and confirm the expected digest is a literal hex string in the test file, not recomputed from the same function under test; run `pnpm test -- visitor-key` in `packages/analytics` and confirm the pinned test and both rotation assertions pass; confirm the digest input separator makes `("1.2.3", "4")` and `("1.2", "34")` distinct.
  - *Checks:* resolve `createHash` inside `visitor-key.ts` — confirm it is `node:crypto`'s (permitted; `node:crypto` is not in the restricted list at `.oxlintrc.json:53-69`) and not a re-implementation.
  - *Status:* ☐ unverified

- **O2 — The raw viewer IP reaches no column.**
  - *Claim:* a test searches every value of the produced row for the fixture IP and finds no match.
  - *Evidence to collect:* read the assertion in the transform tests and confirm it iterates `Object.values(row)` (or equivalent) and asserts the fixture IP is absent from all of them — an assertion naming only one column does not satisfy this obligation; run `pnpm test -- map-record` and confirm it passes; then temporarily map the viewer-IP field to a column in `packages/analytics/src/schema.ts` and confirm this test fails, and restore.
  - *Status:* ☐ unverified

- **O3 — The salt decision is settled and injected.**
  - *Claim:* the module records whether the daily salt is stored (Secrets Manager) or derived from the date, the code implements that answer, the salt is a parameter derived from an injected day, and a test passes two different days without stubbing time.
  - *Evidence to collect:* read the decision note in the doc comment of `packages/analytics/transform/visitor-key.ts` and confirm it states the answer and the consequence (changing it after rows exist breaks unique-visitor counts across the boundary); run `grep -rn "Date.now()\|new Date()\|vi.setSystemTime\|vi.useFakeTimers" packages/analytics/transform/` — expect no output; confirm the salt-derivation function's only input is a day value.
  - *Status:* ☐ unverified

- **O4 — Bots are flagged, never dropped, and absent user agents still produce a row.**
  - *Claim:* `is_bot` is set from a user-agent match, a bot record is still returned with every other column populated, and an absent or empty user agent produces a row with a defined `is_bot` and a defined `visitor_key` — no `null` for either.
  - *Evidence to collect:* run `pnpm test -- bots map-record` in `packages/analytics`; read the bot-record test and confirm it asserts the full row is returned (every required column present) with `is_bot === true`, not merely that a bot was detected; read the empty-user-agent and absent-user-agent cases and confirm both assert `typeof row.is_bot === 'boolean'` and a non-empty `visitor_key`.
  - *Status:* ☐ unverified

- **O5 — Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root — expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing; confirm the bot-pattern list is a named module constant, not literals at the call site.
  - *Status:* ☐ unverified

- **O6 — Reviewable: the pinned digest is literal and the IP search test is load-bearing (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- visitor-key bots map-record` inside `packages/analytics` and observe the pinned digest as a literal in the test file, and can make the whole-row IP search test fail by mapping the viewer-IP field back to a column.
  - *Evidence to collect:* run `pnpm test -- visitor-key bots map-record` from `packages/analytics` and capture the output; open `packages/analytics/transform/visitor-key.test.ts` and read the literal digest; add a viewer-IP entry to `FIELD_TO_COLUMN` in `packages/analytics/src/schema.ts`, re-run, capture the failure, then restore the file and re-run to confirm green.
  - *Status:* ☐ unverified

## Regression check

For each module the task touched, the validator traces one downstream caller:

- `packages/analytics/transform/map-record.ts` `mapRecord` is called by task 40's fixture tests with a complete record → expect the task 40 assertions (UTC `event_time`/`day`, numeric columns, drop path with named field) to still pass unchanged : ☐ (PRESERVED / REGRESSION)
- `packages/analytics/src/schema.ts` `DERIVED_COLUMNS` is read by task 39's totality test → expect `visitor_key` and `is_bot` still listed as derived and the totality test still green : ☐ (PRESERVED / REGRESSION)

## Residue

Notes for the validator: the bot heuristic's pattern list is not specified by the change spec — the DoD requires only that a match sets the flag and that no record is dropped for it, so the list's coverage is a judgement call, not an obligation. If the salt decision landed on Secrets Manager, the secret's provisioning node is not in this task's scope and must be traced to whichever later task creates it (nothing in tasks 38–46 does); flag that as a gap rather than a failure of this obligation. Retention/expiry of `visitor_key` values remains an open question in the change spec and is out of scope here.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
