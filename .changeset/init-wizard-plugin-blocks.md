---
"blogwright": minor
---

`blogwright init` now asks each installed plugin's questions too: after the four core questions, it runs every discovered plugin's `init(io)` contributor - in deterministic, name-sorted order - and writes every answered block into the same new `config/production.jsonc`, alongside the core entries, in one write. A plugin that declines (or carries no `init(io)` contributor) contributes nothing. A repo with no plugins installed is unaffected: the wizard writes exactly the file it always has. Discovery runs unconditionally when `init` is invoked, matching every other discovery-running path (`blogwright --help`, a bare invocation, `blogwright plugin list`); on a genuinely first run, with no repo root or package.json yet, discovery's failure is warned and treated as "no plugins installed" so the plain wizard still completes.
