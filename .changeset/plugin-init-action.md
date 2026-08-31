---
"blogwright": minor
---

Add the generic `blogwright <plugin> init` action: on a repo with an existing config, it runs an installed plugin's `init(io)` contributor - prompting through the same terminal port and prompt/validate/retry loop `blogwright init` itself uses - renders the answered block, and splices it into the environment's resolved config file (`config/<env>.jsonc`, `ops.config.jsonc`, or `--config`) without disturbing any other byte, comments included. A plugin that declares its own `init` command (like `blogwright-pds`, which creates the publication record) keeps it; declaring both an `init` command and an `init(io)` contributor is rejected at discovery, naming the plugin, because the contributor would never run. A plugin with neither reports the action unavailable and lists what it does have; a config already carrying the plugin's key is refused with the file left untouched; a contributor that gathers no answers writes nothing.
