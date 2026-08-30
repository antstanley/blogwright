---
"blogwright": minor
---

Add `blogwright plugin list`: one row per installed plugin - the namespace it claims, the package it came from, that package's own version, and the single top-level config key it owns - plus one line per plugin that failed to load, under a `failed to load:` heading, carrying discovery's own reason and no stack trace. Rows are sorted by namespace rather than by the order the `dependencies`/`devDependencies` maps happen to list them, so the listing is stable across manifests. On a TTY the columns are aligned under a bold header; with `--plain` (or any non-TTY) the same columns are single-space separated, the stable form for CI logs and agents.

Each version is read from that plugin's own `package.json` on this machine - never a table in the CLI and never a registry lookup, so the listing works offline and reports what is actually installed. A plugin whose manifest declares no `version` is marked `(unknown)` and one that owns no config key `(none)`; neither cell is ever left blank, since a blank would shift every column after it for whatever is parsing the line. A repo with no plugins installed prints a single empty-state line naming `blogwright plugin add <name>`, rather than an empty table.

The command exits 0 whenever the listing was produced, including when a plugin in it failed to load: this is a report, not a health check - the same contract `blogwright --help` already has. It also builds no `OpsContext`, so it answers on a repo that has no `config/<env>.jsonc` yet and with no AWS credentials configured, which is exactly when an operator needs it.

`blogwright --help` now lists `plugin list` among its commands. A bare `blogwright plugin`, or an unrecognised `plugin` action, now prints that namespace's own actions and exits 1, in place of the full help text it previously echoed.
