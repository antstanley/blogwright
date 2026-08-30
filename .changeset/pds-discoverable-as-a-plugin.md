---
"blogwright": minor
"blogwright-pds": minor
---

`blogwright-pds` now declares `"blogwright": { "plugin": "pds" }` in its own `package.json`, so the copy the CLI already bundles is discovered as the `pds` plugin with no install step: a repo that depends only on `blogwright` gets it. `blogwright plugin list` reports it - namespace `pds`, package `blogwright-pds`, the version that repo pins, and the `pds` config key it owns.

`blogwright --help` therefore lists the six pds actions in its `Plugins:` section, built from the plugin's own description and per-command summaries, and the static `pds …` block has been removed from the command list above so nothing is listed twice. The rendered guidance is shorter: the one-line summaries drop the "commit + release `public/oauth/*` before `pds login`" note, the description of the paste-back OAuth callback flow, the reminder that `pds sync` also runs after every successful production deploy, the note that `pds login`'s session is refreshed automatically on every sync, and `pds init`'s reminder to commit the files it writes. All five remain in the docs, and the commands themselves are unchanged.

`blogwright pds <action>` is unaffected - every one of the six actions still runs through the CLI's own built-in branch, which is checked ahead of plugin dispatch, and `blogwright/rkey` still re-exports `blogwright-pds/rkey` unchanged. One transient consequence, until that branch is removed: because the pds plugin contributes resource nodes, help now also lists the generic `bootstrap`, `status` and `destroy` verbs under `pds`, and those three are still refused with `unknown pds action: …` for as long as the built-in branch answers the namespace.
