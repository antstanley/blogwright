---
title: Configuration files
description: Where blogwright's JSONC config lives, which file each environment loads, and how your settings merge with the defaults.
sidebar:
  order: 3
---

Run `pnpm exec blogwright init` to write your first config file, `config/production.jsonc`. No terminal prompt available, such as in CI? Write it by hand - two keys are enough:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example", // required - the stable slug in every AWS resource name
}
```

Only `siteName` is strictly required; `region` defaults to `us-east-1`. Everything else has a default - the [configuration reference](/reference/configuration/) lists every key.

## Where config lives

Config lives in **your site's repository**, not in blogwright. The CLI finds the repo root by walking up from where you run it to the nearest `.git` (a directory, or a file in worktrees) or `.jj` directory, so every command works from any subdirectory. If neither exists above the current directory, the command fails with an error naming where it started.

## Which file is loaded

From the repo root, blogwright loads the first of these that exists:

1. `config/<env>.jsonc` - the environment's own file, for example `config/staging.jsonc`
2. `ops.config.jsonc` - one shared fallback for every environment

`--config <path>` replaces that list: the file you name is the **only** candidate, with no fallback. If no candidate exists, the command fails and lists the paths it looked for.

The environment comes from the command line and defaults to `production` - see [Environments](/guides/environments/).

## Format

Files are JSONC: `//` and `/* */` comments and trailing commas are allowed. A file that exists but fails to parse is an error, never skipped.

## How your settings merge with the defaults

Your file is merged over the defaults:

- **Nested objects merge key by key.** `microvm` (including `microvm.idle`), `retention`, `seo` and `paths` keep their other defaults when you set one field.
- **Scalars and arrays replace the default outright.** Setting `sourceIgnore` replaces the default list rather than extending it - include the defaults you still want.

## One config for every environment

Every environment falls back to `ops.config.jsonc`, so one shared file can serve them all. The environment name still shapes resource names, tags and the search-engine defaults.

Add a `config/<env>.jsonc` only for an environment whose settings differ - most often `domain`. A per-environment file is used instead of the shared one, not merged with it, so repeat every setting that environment needs.

## Plugin config blocks

Each installed plugin owns one top-level key: `analytics` for the [analytics plugin](/plugins/analytics/) and `pds` for [standard.site](/plugins/standard-site/). `blogwright <plugin> init` writes that block into an existing file, keeping your comments and formatting. A block for a plugin that is not installed does nothing.

## Related pages

- [Configuration reference](/reference/configuration/) - every key, its default and its validation rules
- [Environments](/guides/environments/) - choosing an environment and what it owns
- [Plugins overview](/plugins/overview/) - how plugins add config blocks
