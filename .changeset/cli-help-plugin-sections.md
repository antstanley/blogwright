---
"blogwright": minor
---

`blogwright --help` now appends one section per installed plugin, built from its `description` and its commands' `action`/`summary` fields, so help output reflects what is actually installed; a plugin that fails to load is listed by package name and reason (no stack trace) rather than breaking `--help`. The same enriched help now also appears wherever a USAGE-style error already printed it - an unrecognised `blogwright plugin` (bare), `blogwright pds <bogus-action>`, and `blogwright preview <bogus-action>`. With no plugins installed, `--help` output is unchanged. `--help` and a bare invocation still print full help and keep their existing exit codes even outside a repo or in a repo with no root `package.json` yet - discovery's own preconditions no longer prevent `--help` from answering at all.
