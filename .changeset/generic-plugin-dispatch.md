---
"blogwright": minor
"blogwright-core": minor
"blogwright-pds": minor
---

Add generic plugin dispatch: `blogwright <plugin> <action> [env] [args]` now routes to any installed plugin's command, matching multi-word actions (e.g. `secret status`) by declaration rather than positional shifting, resolving the environment the same way every built-in command does (a trailing positional, overridden by `--env`, defaulting to `production`), and forwarding flag values through to the command. An unknown first positional now reports that no built-in command or installed plugin claims it and suggests `blogwright plugin list`, instead of the previous generic "unknown command" message; an unknown action inside a known plugin lists that plugin's declared actions. Built-in commands (`deploy`, `bootstrap`, `status`, etc.) are unaffected and still load no plugin module. No plugin ships with the CLI yet beyond the existing `pds` branch, so this has no effect until a plugin is installed.
