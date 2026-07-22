---
title: Environments & configuration files
description: How blogwright selects an environment, resolves its JSONC config file, isolates AWS resources per environment, and tags everything it creates.
sidebar:
  order: 2
---

Every blogwright command runs against one **environment** — a name that selects the config file, is stamped into every AWS resource name, and keys the deployment state. Two environments in the same AWS account never share a bucket, a role, or a state file, so you can run `production` and `staging` side by side without them touching each other.

## Choosing an environment

The environment defaults to `production`. Pass another one as the positional `[env]` argument or with `--env`:

```sh
blogwright deploy                    # production
blogwright deploy staging            # positional
blogwright deploy --env staging      # flag — wins over the positional
blogwright status staging            # every environment-scoped command takes [env]
```

`rollback` and `logs` take a `<hash>` first, then the optional environment:

```sh
blogwright rollback 4f3a2b1c staging
blogwright logs 4f3a2b1c staging
```

Environment names must be lowercase alphanumeric with dashes (`^[a-z0-9-]+$`); anything else is rejected when the CLI derives resource names, before anything in your account is created or modified.

:::note
The `preview` environment is claimed by the shared PR-preview stack — every `blogwright preview` command runs in it implicitly. Don't create a regular environment named `preview`; see [PR previews](/guides/pr-previews/).
:::

## How the config file is resolved

Config lives in the **consuming site's repo**, not in blogwright. The CLI first finds the repo root by walking up from the invocation directory to the nearest `.git` (a directory, or a file in worktrees) or `.jj` directory — so every command works from any subdirectory of the site. If neither exists above the current directory, the command fails with an error naming the start directory.

From the repo root, the config is loaded from the first candidate that exists:

1. `config/<env>.jsonc` — the per-environment file (`blogwright init` writes `config/production.jsonc`)
2. `ops.config.jsonc` — a single shared fallback

When you pass `--config <path>`, that file is the **only** candidate — there is no fallback. If no candidate exists, the command fails with an error listing the paths it looked for.

Files are JSONC: `//` and `/* */` comments and trailing commas are allowed. A file that exists but fails to parse is a hard error, never skipped. Only `siteName` is strictly required (`region` defaults to `us-east-1`); everything else has defaults — see the [configuration reference](/reference/configuration/) for the full schema.

### One config for every environment

Because every environment falls back to `ops.config.jsonc`, a single shared file can serve them all — the environment name still shapes resource names, tags, and behavior. Per-environment files exist for the settings that genuinely differ, such as `domain`.

:::tip
The SEO defaults are environment-aware even with a shared config: with `seo.robots` and `seo.sitemap` at their `auto` defaults, production is indexable and gets a sitemap, while every other environment blocks crawlers and skips the sitemap. A staging site never leaks into search results by default.
:::

## What an environment owns

Each environment gets one S3 bucket named `<env>-<siteName>-<accountId>`, holding the build artifacts, the live site, and the state. Every other derived resource name carries the same environment and site name — the build and exec roles, the builder MicroVM image, the log groups — so environments are fully isolated stacks in one account. The layout is described in the [architecture reference](/reference/architecture/).

The topology state lives at `state/<env>.json` inside the environment's own bucket. Keeping it in S3 rather than on disk means every machine with credentials — your laptop, a colleague's, CI — sees the same single source of truth for what has been provisioned.

:::caution
S3 bucket names are capped at 63 characters. If `<env>-<siteName>-<accountId>` exceeds that, the CLI fails with an error telling you to shorten the environment name or `siteName`.
:::

## Setting up a staging environment

Reuse the same `siteName` — the environment prefix keeps every resource apart. A minimal staging config:

```jsonc
// config/staging.jsonc
{
  "region": "us-east-1",
  "siteName": "example", // same slug as production — the env prefix isolates resources
}
```

Then bootstrap and deploy it exactly like production, with the environment name appended:

```sh
blogwright bootstrap staging
blogwright deploy staging
blogwright status staging
```

Add a `domain` to the staging config to give it its own hostname — see [custom domains](/guides/custom-domains/). To let CI deploy staging on pushes to `main` via a GitHub OIDC role, set `githubRepo` and see [CI deploys with GitHub OIDC](/guides/ci-github-oidc/).

## Resource tagging

Every AWS resource blogwright creates is tagged with two keys:

- **`environment`** — the environment name.
- **`app`** — the explicit `app` config option, falling back to the site's domain (from `--domain` or `config.domain`), then to the repo directory name. The fallback chain guarantees the tag is always something a human can trace back to the project from a billing or resource listing.

Site files get the same two tags as S3 object tags on upload. Preview deploys stamp the PR id into the object tags (`environment: preview-pr-42`), so per-PR cost and cleanup queries work — see [PR previews](/guides/pr-previews/).

:::note
Object tags ride on the initial PUT, and a deploy only re-uploads files whose content changed — so tags added by an upgrade never reach unchanged objects on their own. Run `blogwright deploy --refresh` once to re-upload everything; see [deploying](/guides/deploying/).
:::
