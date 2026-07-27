# Task 12 — Add the textual JSONC config-block splice

**Plan:** [plan.md](../plan.md) · **Certificate:** [12-cli_config_block_splice-certificate.md](12-cli_config_block_splice-certificate.md)

**Implements:** [2026-07-26-cli_plugin_system.md §CLI → `blogwright <plugin> init` (Add)](../../../changes/2026-07-26-cli_plugin_system.md) ("the insertion is textual, not a parse-and-restringify … the command refuses rather than guesses"; and §Assumptions and open questions → Decisions, *Textual JSONC insertion, not parse-and-rewrite*)
**Depends on:** —
**Produces:** `packages/cli/src/config-block.ts` — a pure `spliceConfigBlock(source, block)` that inserts a rendered block before a JSONC document's closing brace, preserving every comment and every hand-made formatting choice, and raising rather than guessing on a duplicate key or a document that is not one top-level object
**Pointers:** `packages/cli/src/config-block.ts` (new — the splice and the block renderer live here), `packages/cli/src/init.ts:42` (`renderConfig` — the commented style, two-space indent and `// comment` suffixes the rendered block must match), `packages/cli/src/init.ts:62-68` (the comma-per-entry loop the renderer mirrors), `packages/core/src/config.ts:153` (`stripJsonComments` — the existing string- and comment-aware scanner whose discipline the position scan reuses), `packages/core/src/config.ts:242` (`parseConfig` — every spliced result must still survive it)

## Steps

- [ ] Add `packages/cli/src/config-block.ts` opening with a module comment stating what it owns and why it is textual: config files carry meaningful comments written by the wizard (`init.ts:42`), so the document is never restringified through `JSON.parse`/`JSON.stringify`.
- [ ] Implement `renderConfigBlock(key, entries)` producing the block body in `renderConfig`'s style (`init.ts:42-69`) — two-space indent, optional `// comment` suffix per entry, separating commas between entries but none after the last.
- [ ] Implement `spliceConfigBlock(source: { path, text }, block: { key, rendered })`: scan the text once with the same string-aware, comment-aware discipline as `stripJsonComments` (`packages/core/src/config.ts:153-176`) to locate the single top-level object's opening and closing brace and the last significant character before that brace, then splice the rendered block in with the comma that position requires and nothing else changed.
- [ ] Raise `Error`s carrying context per DEVELOPMENT.md §Error handling: a key already present names the key and `source.path` and says to edit the file directly; a document that is not one top-level object names the shape found (array, second top-level value, bare value, unterminated object) and the shape required.
- [ ] Write `packages/cli/src/config-block.test.ts` with the pinned comment-preserving vector, the three comma positions, and the five refusals, re-parsing every successful result through `parseConfig` from `blogwright-core`.

## Definition of done

- [ ] `spliceConfigBlock(source, block)` takes the file text, the key and the rendered block and returns new text, performing no `JSON.parse`/`JSON.stringify` round-trip of the document — `grep -n 'JSON\.\(parse\|stringify\)' packages/cli/src/config-block.ts` returns nothing.
- [ ] A realistic `config/production.jsonc` carrying line comments, a block comment and hand-made indentation comes back byte-identical outside the inserted region (pinned test asserting on the exact string), and the inserted block reads like a wizard-written one — same two-space indent and `// comment` style as `renderConfig` (`init.ts:42`).
- [ ] Comma handling is correct at the validity boundary — insertion into an object whose last entry has no trailing comma, one that has a trailing comma, and an empty `{}` — one test each, each result re-parsed with `parseConfig` to prove it is still valid JSONC.
- [ ] The function refuses rather than guesses: an existing occurrence of the key raises naming the key and the file path, and a document that is not a single top-level object (an array, two objects, a bare value, an unterminated object) raises with a message saying what shape is required — one test each, each asserting on the message text rather than only that it threw.
- [ ] Meets the repo definition of done (see plan.md baseline).
- [ ] Reviewable: run `pnpm test -- config-block`; confirm the comment-preservation test asserts byte equality outside the insert, that every one of the five refusal tests asserts on the error message, and that no successful case is accepted without a `parseConfig` re-parse.
