# Done Certificate - Task 12: Add the textual JSONC config-block splice

**Task:** [12-cli_config_block_splice.md](12-cli_config_block_splice.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29   <!-- validator sets: Validated YYYY-MM-DD -->

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
  - *Evidence collected:* module read end to end (233 lines). Exported signature `spliceConfigBlock(source: ConfigSource, block: ConfigBlock): string` with `ConfigSource = { readonly path, readonly text }` and `ConfigBlock = { readonly key, readonly rendered }` (`packages/cli/src/config-block.ts:216`). `grep -n 'JSON\.\(parse\|stringify\)' packages/cli/src/config-block.ts` -> no matches (exit 1).
  - *Checks:* the insertion point comes from `scanTopLevelObject` (`config-block.ts:107`), a single character loop local to this module; the module has **zero** imports, so nothing can delegate the scan to a parser. The only string work is `slice`/`join`/`Set`/`Number.parseInt`/`String.fromCharCode`, all builtins.
  - *Status:* ☑ SATISFIED

- **O2 - Comments, formatting and rendered style preserved.**
  - *Claim:* a realistic commented `config/production.jsonc` comes back byte-identical outside the inserted region, and the inserted block matches `renderConfig`'s commented style.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run config-block --reporter=verbose` -> 11/11 pass. The pinned test (`config-block.test.ts:30-64`) asserts with `toBe` on an exact joined string, not `toContain`; its input carries a leading line comment, a trailing line comment (`// primary region`), a block comment (`/* stable slug - never change it */`) and non-default four-space indentation. Diffing the test's expected output against its input: the only delta is `,` + newline + the rendered block.
  - *Independent check:* spliced a tab-indented document carrying two leading line comments, a multi-line block comment, a trailing-whitespace line, a nested object, an array and a whitespace-only line after the closing brace. Common-prefix/common-suffix diff of input vs output: bytes removed from the original = `""`; bytes added = exactly `",\n  \"analytics\": {\n    \"bucket\": \"logs\"\n  }"`. Tabs, double-space alignment, trailing spaces and the final newline all survive byte-for-byte.
  - *Style:* `renderConfigBlock` (`config-block.ts:39`) mirrors `init.ts:62-68` line for line - `comma = i < entries.length - 1 ? ',' : ''`, `` ` // ${comment}` `` suffix after the comma, two-space indent per level.
  - *Reservation (see the correctness defect below):* the pinned vector places its trailing line comment on the **first** entry. When the trailing comment sits on the **last** entry - which is what `renderConfig` itself emits by default - the block is inserted between the value and its comment, leaving the comment orphaned on its own line. Bytes are still preserved, so the obligation as written holds, but the vector does not cover the modal real input.
  - *Status:* ☑ SATISFIED (as written; see Residue/defect D1)

- **O3 - Comma handling at the validity boundary.**
  - *Claim:* insertion works for an object whose last entry has no trailing comma, one that has a trailing comma, and an empty `{}` - three tests, each result re-parsed with `parseConfig`.
  - *Evidence collected:* the three cases are `config-block.test.ts:68`, `:90`, `:112`; each ends `const parsed = parseConfig(result); expect(parsed.siteName).toBe('myblog')` (the pinned test also re-parses, `:63`). The empty-object case asserts the exact result `{\n  "siteName": "myblog"\n}` - no leading comma emitted.
  - *Checks:* `parseConfig` is imported from `blogwright-core` (`config-block.test.ts:1`); `packages/cli/vitest.config.ts` aliases `blogwright-core` to `../core/src/index.ts`, which re-exports `./config.js` - the real `parseConfig` at `packages/core/src/config.ts:242`, no local stub and no `vi.mock` in the file.
  - *Mutation check:* forcing `commaPrefix` to `','` fails 2 tests; forcing it to `''` fails 2 tests; forcing `needsTrailingNewline` to `false` fails 1. None of the three passes vacuously.
  - *Status:* ☑ SATISFIED

- **O4 - Refusals name the key, the file and the required shape.**
  - *Claim:* an existing occurrence of the key raises naming the key and the file path; an array, two top-level objects, a bare value and an unterminated object each raise with a message stating the shape required - one test each, asserting on the message.
  - *Evidence collected:* five tests at `config-block.test.ts:127-173`. Duplicate key asserts `toThrow(/analytics/)` **and** `toThrow(new RegExp(escaped PATH))`; the thrown message is `` `${path} already declares a "${key}" key - edit the file directly instead of writing a new block for it` `` (`config-block.ts:220`). The four shape refusals assert `/an array/`, `/second top-level value/`, `/a bare value/`, `/unterminated object/` against `` `${path}: expected a single top-level JSON object, found ${found} - insert the block by hand instead` `` (`config-block.ts:94`). No bare `toThrow()` anywhere.
  - *Independent check (top-level vs nested key scoping):* `pds` nested inside another block, `pds` inside an array of objects, `pds` appearing only as a string **value**, and `pds` appearing only inside a comment are all correctly **not** treated as duplicates and splice cleanly; a genuine top-level `pds` (declared first or last) and a unicode-escaped top-level `"pds"` are correctly refused. The `expectKey && depth === 1` guard plus `decodeStringLiteral` are doing real work.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the lint/format/dead-code gates are clean, and limits are named constants or validated config fields.
  - *Evidence collected:* run from `/Users/ant/code/blogwright-task-12` in CI order - `pnpm build` clean (5 projects); `pnpm typecheck` clean (4 projects); `pnpm test` clean (core 104, build-agent 27, pds 85, cli 154; 370 passing, 1 skipped); `pnpm lint` exit 0 (only pre-existing `no-shadow` warnings in `src/nodes.test.ts`, zero diagnostics naming `config-block`); `pnpm exec oxfmt --check .` "All matched files use the correct format" over 128 files; `pnpm knip` exit 0, no output.
  - *Changeset:* none present and none required - the module is not yet reachable from any command (task 13 wires it), so the change is not user-facing.
  - *Error handling:* both `Error`s carry the operation, the offending value and the fix, per DEVELOPMENT.md:123. No `null` for a domain value; `comment?: string | undefined` respects `exactOptionalPropertyTypes`.
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable: `pnpm test -- config-block` shows byte equality, message assertions and re-parses (Reviewable).**
  - *Claim:* a reviewer can run the reviewable command and observe byte equality outside the insert, message assertions on all five refusals, and a `parseConfig` re-parse of every successful case.
  - *Evidence collected:* `pnpm --filter blogwright exec vitest run config-block --reporter=verbose` lists and passes all 11 tests (2 renderer, 1 pinned, 3 comma, 5 refusal). All three properties tick off against the test bodies (O2, O3, O4 above). The 11 are genuinely new: `jj file list -r @-` shows no `config-block*` at the parent revision, and `vitest list` reports 154 total in the CLI package of which 11 are `src/config-block` - so the pre-change baseline was 143, not 154. The implementer's reported count was confused; the tests are real and running.
  - *Status:* ☑ SATISFIED

## Regression check

No existing callers in scope - `packages/cli/src/config-block.ts` is new and nothing imports it until task 13. The diff is exactly two added files (`jj diff --stat`: 407 insertions, 0 deletions).

- `packages/core/src/config.ts:153` (`stripJsonComments`) and `:242` (`parseConfig`) are unmodified by this task's diff → expect no change : ☑ PRESERVED (absent from the diff; core suite 104/104 green)
- `packages/cli/src/init.ts:42` (`renderConfig`) is unmodified by this task's diff → expect no change : ☑ PRESERVED (absent from the diff; cli suite 154/154 green)

## Residue

Findings outside the obligation set, recorded for the reviewer and for task 13:

- **D1 (the one real defect).** `spliceConfigBlock` inserts at `lastSignificantIndex + 1` (`config-block.ts:225`), which is *before* any trailing `// comment` on the last entry's line. `renderConfig` emits exactly that shape by default: with no `domain` and no `githubRepo`, the last entry is `"siteName": "myblog" // stable slug in every AWS resource name - never change it`. Splicing into the wizard's own default output yields the comment orphaned on its own line, single-space indented, after the new block - reading as if it documents the new block. Same for the `githubRepo` variant and for a trailing block comment. Every byte survives and the result re-parses, so this is not comment loss; it is comment *displacement*, on the modal input. The fix is local: emit the comma at `lastSignificantIndex + 1` but place the block after the end of that line.
- **D2 (test vacuity).** Mutation testing shows three properties the module implements correctly but no test pins: widening the key scope from `expectKey && depth === 1` to `depth >= 1` (nested keys counted as top-level) keeps 11/11 green; deleting block-comment skipping keeps 11/11 green (the pinned vector's block comment contains no brace, quote or slash); deleting the string-escape branch keeps 11/11 green. Killed mutants, for contrast: line-comment skipping (1 fail), string tracking (1 fail), both comma mutants (2 fails each), the newline mutant (1 fail). Adding vectors for `{"note": "}"}`, `"a\"}"`, a brace inside a block comment, and a nested `pds` that must not count as a top-level duplicate would make the scanner's discipline load-bearing.
- **D3 (minor).** A CRLF document gets an LF-only block spliced in, producing `…}\n\r\n}` - a spurious blank line and mixed endings. Still valid; still parses.
- **D4 (minor).** A leading BOM is skipped as whitespace by `/\s/` so the splice succeeds, but such a file was already unloadable by `parseConfig` (`JSON.parse` rejects the BOM) - pre-existing, not introduced here. Trailing content after the closing brace is correctly refused as "a second top-level value". An unterminated *string* is reported as "an unterminated object"; refusal is still correct, the shape name is approximate.
- **D5 (by design).** `renderConfigBlock` hard-codes a two-space indent, so a block spliced into a tab- or four-space-indented file will not match the surrounding indentation. This is what the DoD asks for ("same two-space indent … as `renderConfig`") and is recorded only so it is not mistaken for a bug later.

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are discharged against collected evidence - the six CI gates are green, the 11 tests are genuinely new and running, byte identity outside the inserted span was reproduced independently, and the scanner's string/comment awareness and top-level-only key scoping were verified by direct probing - with the correctness gate separately raising D1 (a trailing comment on the last entry is displaced below the inserted block) as a defect the DoD as written does not catch.

Note for the orchestrator: DONE is the completeness verdict - every obligation this certificate names is discharged. It is not a merge clearance on its own: the separate correctness gate returned CONCERNS on D1, and the fix will change the pinned vector, so re-run O2 and O6 after it lands.
