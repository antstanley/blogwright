---
"blogwright": minor
"blogwright-pds": minor
---

`blogwright-pds` now declares `"blogwright": { "plugin": "pds" }` in its own `package.json`, so the copy the CLI already bundles is discovered as the `pds` plugin with no install step: a repo that depends only on `blogwright` gets it. `blogwright plugin list` reports it - namespace `pds`, package `blogwright-pds`, the version that repo pins, and the `pds` config key it owns.

`blogwright --help` therefore lists the six pds actions in its `Plugins:` section, built from the plugin's own description and per-command summaries, and the static `pds …` block has been removed from the command list above so nothing is listed twice. The rendered guidance is shorter: the one-line summaries drop the "commit + release `public/oauth/*` before `pds login`" note, the description of the paste-back OAuth callback flow, the reminder that `pds sync` also runs after every successful production deploy, the note that `pds login`'s session is refreshed automatically on every sync, and `pds init`'s reminder to commit the files it writes. All five remain in the docs, and the commands themselves are unchanged.

The six `pds` actions themselves are unaffected - `keygen`, `login`, `init`, `sync`, `secret status` and `secret delete` behave exactly as before - and `blogwright/rkey` still re-exports `blogwright-pds/rkey` unchanged. What changed beneath them is described in the accompanying entry: `blogwright pds <action>` is no longer answered by a built-in branch in `cli.ts`, but by this plugin's own declared commands. Because that branch was removed in this same release, the transient gap this change would otherwise have opened never reaches a user: help lists the generic `bootstrap`, `status` and `destroy` verbs under `pds` because the plugin contributes resource nodes, and all three of those verbs now run.
