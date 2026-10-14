---
title: Plugins overview
description: Add, run and remove blogwright plugins. Each plugin brings its own commands, config block and AWS resources.
sidebar:
  order: 1
---

Run `pnpm exec blogwright plugin list` to see which plugins this repo has.

Plugins add features beyond deploying. Each one claims a command namespace (`blogwright <plugin> <action>`), owns one top-level block in `config/<env>.jsonc`, and keeps its AWS resources in its own state file. Your site's own `bootstrap`, `deploy` and `destroy` never create or change a plugin's resources.

| Plugin | Namespace | How you get it | What it adds |
| --- | --- | --- | --- |
| [Analytics](/plugins/analytics/) | `analytics` | `blogwright plugin add analytics` | Page views from CloudFront access logs in an Iceberg table, with a local dashboard |
| [standard.site](/plugins/standard-site/) | `pds` | Bundled with the CLI | Mirrors blog posts to your AT Protocol PDS |

## Add a plugin

1. Install it: `pnpm exec blogwright plugin add analytics`
2. Write its config block: `pnpm exec blogwright analytics init`
3. Create its AWS resources: `pnpm exec blogwright analytics bootstrap`

Steps 2 and 3 take an environment (`[env]` or `--env`), defaulting to `production`. Repeat them for each environment that should have the plugin.

standard.site skips step 1 because it ships with the CLI. Its `init` creates the publication rather than writing config - follow the [standard.site setup](/plugins/standard-site/#one-time-setup).

### What `plugin add` installs

`plugin add analytics` installs the npm package `blogwright-analytics` at the running CLI's exact version and pins it. Every checkout then installs the same pair.

The pin is made once, at install time:

- Upgrading `blogwright` leaves the plugin at its old version.
- Re-running `plugin add` does not upgrade it either - a package already in `package.json` is left alone.
- To upgrade both, install matching versions together: `pnpm add -D --save-exact blogwright@<version> blogwright-analytics@<version>`.

`plugin add`, `plugin list` and `plugin remove` need no site config or AWS credentials, unless you choose to tear down resources during removal.

## Commands every plugin with resources gets

| Command | What it does |
| --- | --- |
| `blogwright <plugin> init [env]` | Asks the plugin's questions and writes its block into the environment's config file, keeping your comments and formatting. Refuses if the block already exists. |
| `blogwright <plugin> bootstrap [env]` | Creates or reconciles the plugin's resources. Safe to re-run. |
| `blogwright <plugin> status [env]` | Reports each resource as present or missing. A plugin can add more - analytics adds delivery health and a row count. |
| `blogwright <plugin> destroy [env] --yes` | Removes the plugin's resources for that environment. |

A plugin can declare its own commands on top, such as `analytics dashboard` or `pds sync`. `blogwright --help` lists every installed plugin's commands, and any plugin that failed to load and why.

`blogwright init`, the first-run wizard, also asks each installed plugin's questions. Plugins add questions only when they have a config block to write.

## Where plugin state lives

Each plugin records its resources in `state/<env>.<plugin>.json` in the site bucket, for example `state/production.analytics.json`.

That file protects you from orphaned resources:

- `blogwright bootstrap <env>` warns once per recorded plugin to re-run `blogwright <plugin> bootstrap <env>`.
- `blogwright destroy <env> --yes` refuses while any plugin state exists, and names the `<plugin> destroy` command to run first.
- `blogwright preview teardown --yes` refuses the same way for preview-scoped plugin state.

## Remove a plugin

1. Tear down each environment: `pnpm exec blogwright analytics destroy <env> --yes`
2. Uninstall: `pnpm exec blogwright plugin remove analytics --yes`

Run interactively without `--yes`, `plugin remove` asks whether to destroy the selected environment's resources first. The default is No.

**`plugin remove --yes` keeps resources.** It uninstalls without tearing anything down. A non-interactive run without `--yes` refuses, because it cannot ask.

The config block stays in your config files either way, ready for a reinstall. standard.site cannot be removed from a repo that never declared it, because it is bundled with the CLI.

## Writing your own plugin

Not supported yet. The plugin interface is internal and unversioned: it can change in any release without a major version bump. Discovery loads any `blogwright-*` package listed in the repo root's `package.json`, but no third-party contract is promised.

## Related pages

- [Analytics](/plugins/analytics/) - traffic analytics with a local dashboard
- [standard.site](/plugins/standard-site/) - publish posts to the AT Protocol
- [CLI reference: plugins](/reference/cli/#plugin-management-and-lifecycle) - every flag and exit code
