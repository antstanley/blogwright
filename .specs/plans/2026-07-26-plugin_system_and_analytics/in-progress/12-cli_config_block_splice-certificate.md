# Done Certificate - Task 12: Add the textual JSONC config-block splice

**Task:** [12-cli_config_block_splice.md](12-cli_config_block_splice.md) · **Plan:** [plan.md](../plan.md)
**State:** Authored 2026-07-26 - unverified   <!-- validator sets: Validated YYYY-MM-DD -->

> This certificate is a verification protocol for Task 12. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

## Definition

DONE(Task 12) ≡ every obligation O1…O6 below holds, each backed by the evidence the obligation
names (a file location, a test result, or an execution trace) - not by assertion.

## Premises

- **P1 - Goal.** `packages/cli/src/config-block.ts` provides a pure `spliceConfigBlock(source, block)` that inserts a rendered block before a JSONC document's closing brace, preserving every comment and formatting choice, and raising rather than guessing on a duplicate key or a non-object document.
- **P2 - Obligations.** The task is done iff O1…O6 all hold. One Oi per definition-of-done item, in DoD order; O6 is the `Reviewable:` item.
- **P3 - Invariants.** Must not break `parseConfig`/`stripJsonComments` in `packages/core/src/config.ts` (this task reads their behaviour but changes neither) or `renderConfig` in `packages/cli/src/init.ts:42` (the style source, unchanged by this task).

## Obligations

- **O1 - No parse-and-restringify round-trip.**
  - *Claim:* `spliceConfigBlock` takes the file text, the key and the rendered block, returns new text, and never routes the document through `JSON.parse` or `JSON.stringify`.
  - *Evidence to collect:* read `packages/cli/src/config-block.ts` end to end and record the exported signature; run `grep -n 'JSON\.\(parse\|stringify\)' packages/cli/src/config-block.ts` - expect no matches.
  - *Checks:* confirm the insertion point is found by a character scan in this module and not delegated to a JSON parser imported from elsewhere; resolve every import in the module and confirm none of them parses the document.
  - *Status:* ☐ unverified

- **O2 - Comments, formatting and rendered style preserved.**
  - *Claim:* a realistic commented `config/production.jsonc` comes back byte-identical outside the inserted region, and the inserted block matches `renderConfig`'s commented style.
  - *Evidence to collect:* run `pnpm test -- config-block` and read the comment-preservation test in `packages/cli/src/config-block.test.ts`; confirm its input contains at least one line comment, one block comment and non-default indentation, and that the assertion compares exact strings (not `toContain`); diff the test's expected output against its input to confirm the only delta is the inserted block; compare the inserted block's indentation and `// comment` placement against `packages/cli/src/init.ts:62-68`.
  - *Status:* ☐ unverified

- **O3 - Comma handling at the validity boundary.**
  - *Claim:* insertion works for an object whose last entry has no trailing comma, one that has a trailing comma, and an empty `{}` - three tests, each result re-parsed with `parseConfig`.
  - *Evidence to collect:* run `pnpm test -- config-block` and locate the three named cases; for each, confirm the assertion chain ends in a `parseConfig(result)` call from `blogwright-core` and asserts on a field of the parsed object.
  - *Checks:* resolve `parseConfig` in the test file - confirm it is imported from `blogwright-core` and is the real function, not a local stub.
  - *Status:* ☐ unverified

- **O4 - Refusals name the key, the file and the required shape.**
  - *Claim:* an existing occurrence of the key raises naming the key and the file path; an array, two top-level objects, a bare value and an unterminated object each raise with a message stating the shape required - one test each, asserting on the message.
  - *Evidence to collect:* run `pnpm test -- config-block`; read the five refusal tests and record each expected message; confirm each assertion matches message text (`toThrow(/…/)` or an equivalent message assertion) rather than a bare `toThrow()`; confirm the duplicate-key message contains both the key and the `source.path` value passed in.
  - *Status:* ☐ unverified

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence to collect:* run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec oxfmt --check .`, and `pnpm knip` from the repo root - expect all clean; confirm a changeset exists (`.changeset/*.md`) if the change is user-facing.
  - *Status:* ☐ unverified

- **O6 - Reviewable: `pnpm test -- config-block` shows byte equality, message assertions and re-parses (Reviewable).**
  - *Claim:* a reviewer can run `pnpm test -- config-block` and observe that the comment-preservation test asserts byte equality outside the insert, that all five refusal tests assert on the error message, and that every successful case is re-parsed with `parseConfig`.
  - *Evidence to collect:* run `pnpm test -- config-block` and capture the passing test names; open `packages/cli/src/config-block.test.ts` and tick off the three properties against the test bodies.
  - *Status:* ☐ unverified

## Regression check

No existing callers in scope - `packages/cli/src/config-block.ts` is new and nothing imports it until task 13. The validator still confirms the two modules it reads from are untouched:

- `packages/core/src/config.ts:153` (`stripJsonComments`) and `:242` (`parseConfig`) are unmodified by this task's diff → expect no change : ☐ (PRESERVED / REGRESSION)
- `packages/cli/src/init.ts:42` (`renderConfig`) is unmodified by this task's diff → expect no change : ☐ (PRESERVED / REGRESSION)

## Residue

Not obligations, for the validator's awareness: the splice does not attempt to sort or dedupe keys inside the inserted block; a document whose top-level object is preceded by a byte-order mark or trailing content after the closing brace is worth a look even though the DoD names only four bad shapes; and the renderer's escaping of quotes inside a value is untested by the DoD.

## Conclusion

<!-- Validator derives this from the obligation statuses and the regression check, per the rubric. -->
VERDICT: ☐ (DONE | PARTIAL | NOT_DONE)
CONFIDENCE: ☐ (high | medium | low)
SUMMARY: ☐ <one sentence deriving the verdict from the statuses>
