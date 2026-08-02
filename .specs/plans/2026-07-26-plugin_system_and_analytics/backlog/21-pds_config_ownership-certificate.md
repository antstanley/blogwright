# Done Certificate - Task 21: Add the pds config validator and secretName default to blogwright-pds

**Task:** [21-pds_config_ownership.md](21-pds_config_ownership.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 21. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 21) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/pds/src/config.ts` owns the `pds` config block end to end - the three checks lifted verbatim from core plus the `<siteName>/atproto` secret-name derivation - with negative-space tests, and is purely additive because core still validates at this point.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `mergeConfig`/`validateConfig` in `packages/core/src/config.ts`, the pds cases in `packages/core/src/config.test.ts:86-120`, or any consumer of `PdsConfig` (`packages/pds/src/sync.ts:50`, `packages/pds/src/client-metadata.ts:41`, `packages/cli/src/nodes.ts:925`).

## Obligations

- **O1 - The module exports a validator and a secret-name resolver, and imports only core types.**
  - *Claim:* `packages/pds/src/config.ts` exports a validator for the `pds` block plus a function returning `<siteName>/atproto` when `secretName` is absent and the explicit value otherwise, with no `node:fs`, `node:child_process`, or vendor-SDK import.
  - *Evidence to collect:* read `packages/pds/src/config.ts` in full - record the exported symbol names and their signatures; run `grep -nE "^import|require\(" packages/pds/src/config.ts` and confirm every specifier is `blogwright-core` or a relative `./` path.
  - *Checks:* resolve the resolver's return type - confirm it is `string`, not `string | undefined`, so task 22 and task 23 can consume it without a cast.
  - *Status:* ☐ unverified

- **O2 - The four error messages are byte-identical to core's.**
  - *Claim:* the strings raised are exactly `config.pds.name is required`, `config.pds.handleResolver must be a URL, got "…"`, `config.pds.handleResolver must be https, got "…"`, and `config.pds.secretName has invalid characters: "…"`.
  - *Evidence to collect:* run `diff <(sed -n '314,330p' packages/core/src/config.ts) <(grep -n "throw new Error" packages/pds/src/config.ts)` by eye, or extract both message-template sets and compare them character for character; confirm the `new URL(...)` try/catch ordering matches so `nope` yields "must be a URL" and `http://resolver` yields "must be https".
  - *Status:* ☐ unverified

- **O3 - Negative-space and positive tests cover every branch.**
  - *Claim:* `packages/pds/src/config.test.ts` rejects a blank/whitespace `name`, an `http://` resolver, a non-URL resolver, and a `secretName` containing a character outside `^[\w/+=.@-]+$`, and accepts the derived default and an explicit override.
  - *Evidence to collect:* run `pnpm test -- config` in `packages/pds` and record each test name and result; confirm six distinct cases exist and that each rejection asserts on the message, not merely that something threw.
  - *Status:* ☐ unverified

- **O4 - Core is untouched and no changeset is written.**
  - *Claim:* `packages/core/src/config.ts` and `packages/core/src/config.test.ts` are byte-identical to their pre-task state, the existing core pds tests pass unmodified, and `.changeset/` gains no file.
  - *Evidence to collect:* run `git diff --stat packages/core` (expect no output) and `git status --porcelain .changeset` (expect no new `*.md`); run `pnpm test -- config` in `packages/core` and confirm the four pds cases at `config.test.ts:90-120` pass.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm `packages/pds/src/rkey.test.ts`'s pinned rkey vectors still pass; confirm no changeset is required (nothing user-facing changed).
  - *Status:* ☐ unverified

- **O6 - Reviewable: `pnpm test -- config` plus an empty core diff (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- config` from the repo root and observe the new pds cases passing alongside the untouched core cases, with `git diff packages/core` empty.
  - *Evidence to collect:* run `pnpm test -- config` from the repo root and capture the pass list for both packages; run `git diff packages/core` and capture the (empty) output.
  - *Status:* ☐ unverified

## Regression check

No existing callers in scope - the task only adds `packages/pds/src/config.ts` and its test. The
validator's future callers (`packages/pds/src/sync.ts:50` at task 22, `packages/cli/src/nodes.ts:925`
at task 23) do not exist yet.

## Residue

The `<siteName>/atproto` template deliberately has two homes after this task - the new one here and
core's at `packages/core/src/config.ts:269` - because core still validates. Task 27 removes core's.
The validator is unreachable from any command until task 25 wires it into the plugin export.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
