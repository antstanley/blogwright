# Done Certificate - Task 12: Add the textual JSONC config-block splice

**Task:** [12-cli_config_block_splice.md](12-cli_config_block_splice.md) · **Plan:** [plan.md](../plan.md)
**State:** Validated 2026-08-29

> This certificate is a verification protocol for Task 12. A validating agent discharges it:
> for each obligation, collect the named evidence, run the named checks, set the Status, then
> derive the Conclusion by the rubric below. Do not mark an obligation SATISFIED without its
> evidence; do not record DONE with any non-SATISFIED obligation.

This is a **re-gate**. The previous gate returned CONCERNS on D1 (an operator's trailing
comment displaced below the inserted block) and D2 (three scanner mutants that all 11 tests
survived). The task was re-verified from scratch by an agent that neither wrote nor previously
reviewed it; the earlier conclusions were treated as claims to re-derive, not as evidence.
The diff now stands at 611 insertions across two new files, and the fix included a **refactor
of `scanTopLevelObject`** (a `containers: Container[]` stack that tracks key-position generically
at every depth), which is re-derived below rather than accepted.

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
  - *Evidence collected:* module read end to end (304 lines). Exported signature `spliceConfigBlock(source: ConfigSource, block: ConfigBlock): string` (`packages/cli/src/config-block.ts:268`) over `ConfigSource = { readonly path, readonly text }` and `ConfigBlock = { readonly key, readonly rendered }`. `grep -n 'JSON\.\(parse\|stringify\)' packages/cli/src/config-block.ts` -> no matches (exit 1). `grep -n '^import\|require(' packages/cli/src/config-block.ts` -> no matches (exit 1): the module has **zero** imports, so the scan cannot be delegated to a parser.
  - *Checks:* the insertion point comes from `scanTopLevelObject` (`config-block.ts:117`), a single character loop local to this module. The only non-local calls are `slice`/`join`/`replaceAll`/`Set`/`Number.parseInt`/`String.fromCharCode`. The result is a pure function of its two arguments - no I/O, no mutation of the inputs.
  - *Status:* ☑ SATISFIED

- **O2 - Comments, formatting and rendered style preserved.**
  - *Claim:* a realistic commented `config/production.jsonc` comes back byte-identical outside the inserted region, and the inserted block matches `renderConfig`'s commented style.
  - *Evidence collected:* the pinned test (`config-block.test.ts:29-65`) asserts with `toBe` on an exact joined string; its input carries a leading line comment, a trailing line comment (`// primary region`), a block comment and non-default four-space indentation.
  - *Independent check - rigorous byte identity.* The splice is genuinely **two** insertions (a comma at the value's end, the block after any same-line trailing comment), so a naive single-span diff cannot express it. Correctness was instead proved by *reconstruction*: for each document, the block text and its leading newline were deleted from the output, then a single `,` at any position - and the result compared to the input with `===`. It held on all eight probes, including a **tab-indented, commented document with trailing whitespace on the last entry's line and a whitespace-only final line**: input `…\t"tags": [ "a", "b" ]   \n}\n   \n` -> output `…\t"tags": [ "a", "b" ],   \n  "analytics": {…}\n}\n   \n`. Tabs, the `\t`-aligned comment, the trailing three spaces *on the original line* and the final newline all survive byte-for-byte. Nothing was ever removed from any input.
  - *Style:* `renderConfigBlock` (`config-block.ts:39-47`) mirrors `init.ts:61-68` line for line - `comma = i < entries.length - 1 ? ',' : ''`, the ` // ${comment}` suffix *after* the comma, two-space indent per nesting level, and `{}` for an empty entry list. Direct comparison of outputs confirms it.
  - *Status:* ☑ SATISFIED

- **O3 - Comma handling at the validity boundary.**
  - *Claim:* insertion works for an object whose last entry has no trailing comma, one that has a trailing comma, and an empty `{}` - three tests, each result re-parsed with `parseConfig`.
  - *Evidence collected:* the three cases are `config-block.test.ts:121`, `:143`, `:165`; each ends `const parsed = parseConfig(result); expect(parsed.siteName).toBe('myblog')`. The empty-object case asserts the exact result `{\n  "siteName": "myblog"\n}` - no leading comma emitted.
  - *`parseConfig` is the real one:* imported from `blogwright-core` (`config-block.test.ts:1`); `packages/cli/vitest.config.ts` aliases `blogwright-core` -> `../core/src/index.ts`, which `export * from './config.js'` - the real `parseConfig` at `packages/core/src/config.ts:242`. No local stub, no `vi.mock` anywhere in the test file (grep, exit 1).
  - *Independent check:* `hasEntries = lastSignificantIndex > openIndex` and `hasTrailingComma = text[lastSignificantIndex] === ','` were re-derived against `{}`, `{ /* nothing yet */ }`, `{\n\n}`, `{"siteName": "x"}` with no final newline, and `{"siteName": "x",}` - all splice to a document `parseConfig` accepts.
  - *Status:* ☑ SATISFIED

- **O4 - Refusals name the key, the file and the required shape.**
  - *Claim:* an existing occurrence of the key raises naming the key and the file path; an array, two top-level objects, a bare value and an unterminated object each raise with a message stating the shape required - one test each, asserting on the message.
  - *Evidence collected:* five tests at `config-block.test.ts:180-227`. Duplicate key asserts `toThrow(/analytics/)` **and** `toThrow(new RegExp(escaped PATH))`; the message is `` `${path} already declares a "${key}" key - edit the file directly instead of writing a new block for it` `` (`config-block.ts:273`). The four shape refusals assert `/an array/`, `/second top-level value/`, `/a bare value/`, `/unterminated object/` against `` `${path}: expected a single top-level JSON object, found ${found} - insert the block by hand instead` `` (`config-block.ts:94`). No bare `toThrow()` anywhere in the file.
  - *Independent check:* every refusal message carries the path. Two further shapes not in the DoD are also refused cleanly: an empty/comment-only document (`an empty document`) and an unterminated string (`an unterminated string inside the object` - the previous gate's D4 "approximate shape name" is now exact). Trailing content after the closing brace is refused as `a second top-level value`; a trailing *comment* after the closing brace is correctly allowed.
  - *Status:* ☑ SATISFIED

- **O5 - Meets the repo definition of done.**
  - *Claim:* tests written with the change pass, the six CI gates are green, errors carry context.
  - *Evidence collected:* run from `/Users/ant/code/blogwright-task-12` in `.github/workflows/ci.yml:21-29` order, exit codes captured individually - `pnpm build` **0**, `pnpm typecheck` **0**, `pnpm test` **0** (core 104 + 1 skipped, build-agent 27, pds 85, cli 159 = 375 passing), `pnpm lint` **0** (only pre-existing `no-shadow` warnings in `src/nodes.test.ts`; zero diagnostics naming `config-block`), `pnpm exec oxfmt --check .` **0** ("All matched files use the correct format", 128 files), `pnpm knip` **0** (no output).
  - *Changeset:* none present and none required - the module is not yet reachable from any command (task 13 wires it), so the change is not user-facing.
  - *Error handling:* both `Error`s carry the operation, the offending value and the fix, per DEVELOPMENT.md:123. No `null` for a domain value; `comment?: string | undefined` respects `exactOptionalPropertyTypes` (typecheck clean).
  - *Status:* ☑ SATISFIED

- **O6 - Reviewable.**
  - *Claim:* running `pnpm --filter blogwright exec vitest run config-block --reporter=verbose`, a reviewer can confirm byte equality outside the insert, message assertions on all five refusals, and a `parseConfig` re-parse of every successful case.
  - *Evidence collected:* the command lists and passes **16** tests (2 renderer, 1 pinned, 2 comment-attachment incl. CRLF, 3 comma, 5 refusal, 3 scanner-discipline) - up from 11 at the previous gate. Byte equality: the pinned test uses `toBe` on an exact string (O2). Message assertions: all five refusals assert on message text, none is a bare `toThrow()` (O4). Re-parse: all **nine** successful splice results are re-parsed through the real `parseConfig`; the only two tests without one are the pure `renderConfigBlock` style tests, which produce no document. The 11 -> 16 delta is genuine: `jj diff --stat` shows the two files as wholly new (611 insertions, 0 deletions), and the CLI suite moved 154 -> 159.
  - *Status:* ☑ SATISFIED

## Correctness re-derivation of the refactored scanner

The `containers` stack refactor was re-derived from scratch, not accepted on the implementer's
report. Findings:

- **The `depth === 1` gate is now genuinely load-bearing.** After the refactor `expectKey` is
  true for a *nested* object's key too, so the top-level scoping is decided solely at
  `config-block.ts:155`. The implementer's diagnosis of the old redundant guard is confirmed:
  mutating `depth === 1` -> `depth >= 1` now fails a test (it did not before).
- **Container tracking at every depth is correct.** Verified against an array of objects, an
  object of arrays, arrays nested in arrays, an empty `{}` and an empty `[]` inside another
  container, and a key nested four levels down: none is recorded as a top-level key, and a
  genuine top-level duplicate that *follows* a nested empty object, a nested array or an
  array-of-objects is still detected.
- **`expectKey` transitions are correct at every point.** Set on any `{` (line 195); set by a
  comma only when the enclosing container is an object (line 210), so a comma inside an array
  does not; cleared when a key string closes (line 156). It is deliberately *not* cleared on
  `:` or on a close, which leaves a stale `true` after a nested container closes - harmless,
  because at depth 1 the only tokens valid JSON permits after a value are `,` (which re-derives
  `expectKey` correctly) and `}`.
- **A string value can never be read as a key** - the failure the old redundant guard was
  masking. Proved by case analysis (a depth-1 value string is always preceded by a key string
  that cleared `expectKey`) and by probe: `{"siteName": "analytics"}`, an `"analytics"` array
  element, and `"analytics"` named only in a comment all splice cleanly rather than being
  refused as duplicates; a `analytics`-escaped *key* is still correctly refused.
- **No previously-correct behaviour regressed.** Braces inside strings, line comments and block
  comments, and escaped quotes immediately before a brace, were each re-probed: the object
  boundary and the splice point are unaffected, and every result re-parses.

## Mutation testing (independent)

Ten mutants applied directly to `packages/cli/src/config-block.ts`, each run against the full
`config-block` suite, the file restored from a pristine copy afterwards and confirmed by
`shasum -a 256` (`feab7d69…c27c`).

| # | Mutant | Result | Killed by |
| --- | --- | --- | --- |
| M1 | `depth === 1` -> `depth >= 1` (D2-a) | ☑ KILLED | *scanner discipline > only a top-level occurrence of the key counts as a duplicate, not a nested one* |
| M2 | delete block-comment skipping (D2-b) | ☑ KILLED | *scanner discipline > does not let a brace inside a block comment shift the object boundary or the splice point* |
| M3 | delete the string-escape branch (D2-c) | ☑ KILLED | *scanner discipline > does not let an escaped quote before a brace end a string early* |
| M6 | `skipTrailingComment` returns `from` (the D1 regression) | ☑ KILLED | *an operator comment stays attached to its entry > keeps a trailing // comment on the last entry* (+1 more) |
| M7 | always insert `\n` (the CRLF regression) | ☑ KILLED | *an operator comment stays attached to its entry > matches the document's CRLF line endings* |
| M9 | delete line-comment skipping | ☑ KILLED | *pinned > comes back byte-identical outside the inserted region* (+1 more) |
| M4 | drop `expectKey = false` after recording a key | ☐ SURVIVED - observable | see R1 |
| M8 | drop `containers.pop()` on a close | ☐ SURVIVED - observable | see R2 |
| M5 | a comma always expects a key | ☐ SURVIVED - equivalent | see R3 |
| M10 | an opening `[` also expects a key | ☐ SURVIVED - equivalent | see R3 |

All three D2 mutants are now killed by a named test. M4 and M8 were separated from equivalent
mutants by re-running a 60-case behavioural probe under each: M4 changes 77 probe outcomes and
M8 changes one, while M5 and M10 change none.

## Regression check

The diff is exactly two added files (`jj diff --stat`: 611 insertions, 0 deletions); nothing
imports `config-block.ts` until task 13.

- `packages/core/src/config.ts:153` (`stripJsonComments`) and `:242` (`parseConfig`) unmodified → expect no change : ☑ PRESERVED (absent from the diff; core suite 104/104 green)
- `packages/cli/src/init.ts:42` (`renderConfig`) unmodified → expect no change : ☑ PRESERVED (absent from the diff; cli suite 159/159 green)
- Workspace left as found : ☑ CONFIRMED (`jj status` shows only the two added files; both checksums match their pre-mutation values)

## Residue

Findings outside the obligation set. **D1 and D2 from the previous gate are both discharged**
(see the mutation table and the four-variant check below); the following are new and none is
blocking.

- **D1 (previous gate) - RESOLVED.** The comma now goes at `lastSignificantIndex + 1` and the
  block after `skipTrailingComment` (`config-block.ts:283-287`). Checked against all four real
  `renderConfig` outputs (`init.ts:42-69`) - the three whose last entry carries a trailing
  comment (no-domain/no-repo, repo-only, domain+repo) and the one whose last entry is bare
  `"domain"`. In every variant the comment stays on its own entry's line
  (`"siteName": "myblog", // stable slug…` then the block on the next line), nothing is removed,
  and the result re-parses. M6 pins it.
- **D2 (previous gate) - RESOLVED.** All three named mutants are killed by named tests.
- **D3 (previous gate) - RESOLVED.** CRLF: `newline` is derived from the document
  (`config-block.ts:292`) and the rendered block is re-lined to match. Asserted exactly - a CRLF
  document produces no lone `\n` anywhere, no `\r\n\r\n` blank line, and an exact expected
  string. M7 pins it.
- **R1 (new, test strength - not a defect).** Mutant M4 survives all 16 tests. Deleting
  `expectKey = false` (`config-block.ts:156`) makes every top-level string *value* be recorded
  as a key, so splicing `analytics` into `{"siteName": "analytics"}` would be refused as a
  duplicate. The shipped implementation handles this correctly (verified by probe), but no test
  pins it. Suggested vector: splice key `analytics` into a document whose top-level string
  value is `"analytics"` and assert it succeeds.
- **R2 (new, test strength - not a defect).** Mutant M8 survives all 16 tests. Deleting
  `containers.pop()` (`config-block.ts:200`) leaves `containers` topped by `'array'` after a
  nested array closes, so a comma at depth 1 stops expecting a key and a *genuine* top-level
  duplicate that follows an array-valued entry is missed - the splice would then silently
  produce a document with the key twice. The shipped implementation handles this correctly
  (verified by probe), but no test pins it. Suggested vector: refuse a duplicate key that
  follows a top-level entry whose value is an array.
- **R3 (new, recorded so it is not re-opened).** Mutants M5 and M10 are **equivalent**: because
  `depth === 1` already restricts recording to the top-level object, and depth 1 is always
  inside that object, the object-vs-array distinction the `containers` stack draws is
  unobservable for any valid JSONC document. The stack's load-bearing part is the *pop* (R2),
  not the kind it stores. This is defensive over-precision, not a bug.
- **R4 (new, minor, by design).** A **standalone** comment on its own line before the closing
  brace ends up *below* the inserted block (`{ "a": 1\n  // note\n}` -> the note follows the new
  block). `skipTrailingComment` deliberately stops at the first line break, so only *same-line*
  trailing comments are stepped over. Ownership of a free-floating comment is genuinely
  ambiguous; every byte survives and the result re-parses.
- **R5 (new, minor).** Mismatched brackets (`{"a": [1} ]`) are not refused - depth counting
  treats the `]` as the top-level close and the splice produces invalid output. Such a document
  is already unparseable by `parseConfig`, and this is inherent to the *Textual JSONC insertion*
  decision the change spec mandates; the four refusals the DoD names are all correct.
- **D4 (previous gate, partly resolved).** The unterminated-*string* case now reports its own
  shape name. A leading BOM is still skipped as whitespace by `/\s/`, so the splice succeeds on
  a file `parseConfig` could never have loaded - pre-existing, not introduced here.
- **D5 (previous gate, by design).** `renderConfigBlock` hard-codes a two-space indent, so a
  block spliced into a tab- or four-space-indented file will not match its surroundings. This is
  what the DoD asks for ("same two-space indent … as `renderConfig`").

## Conclusion

VERDICT: ☑ DONE
CONFIDENCE: ☑ high
SUMMARY: All six obligations are discharged against collected evidence - the six CI gates are
green with individually captured exit codes, the suite has grown 11 -> 16 tests, byte identity
outside the two insertions was proved by reconstruction on a tab-indented commented document
including its final newline, and the refactored scanner's correctness was re-derived from
scratch and confirmed by ten mutants of which every semantically-observable one bar two is
killed by a named test. The previous gate's D1 (comment displacement), D2 (three vacuous
scanner properties) and D3 (CRLF) are all resolved and pinned; the two surviving observable
mutants (R1, R2) are test-strength gaps on properties the implementation demonstrably handles
correctly, recorded for task 13 rather than blocking the merge.
