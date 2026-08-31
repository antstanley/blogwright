---
"blogwright": minor
---

Validate a plugin's own config block through that plugin, on dispatch. `loadConfig` now returns the raw config document beside the parsed `OpsConfig`, `createContext` keeps it on the CLI's own context as `configDocument`, and `blogwright <plugin> <action>` reads the block the dispatched plugin's `configKey` names off it and hands it to that plugin's own `validateConfig`. Whatever the validator returns is what the plugin's command reads on `ctx.pluginConfig`, so a plugin's defaults are applied by the plugin rather than guessed at by the CLI. A block that fails validation stops the command with the plugin's own message, prefixed with the plugin and the key it refused, before the command does any work or the dispatch makes an AWS call; the CLI exits non-zero.

The validator is also called when the config file carries no block for that plugin at all, with nothing - so a plugin that defaults every setting works on a repo that has never written its block, which is the documented way to install one. Only a plugin that owns no config key at all gets an empty block, because there is no validator to ask.

Only the plugin being dispatched is validated. A block belonging to a plugin that is not installed - or to one that is installed but is not the one being run - stays valid and inert, and still survives onto the config object, the same contract the `pds` block has today. Built-in commands (`deploy`, `bootstrap`, `status`, and the rest) still load no plugin module.

Two installed plugins declaring the same `configKey` are now both rejected at discovery, naming both packages and the shared key, the same way two plugins claiming one namespace already are: a plugin owns exactly one top-level config key end to end, and whichever of the pair won would silently be handed the other's block. `blogwright plugin list` reports the rejection.
