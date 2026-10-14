---
title: Introduction
description: What blogwright deploys, what you get with every deploy, and how a deploy works.
sidebar:
  order: 1
---

blogwright deploys web apps to AWS from one CLI. Start with the [quickstart](/getting-started/quickstart/): three commands take an empty AWS account to a live site.

It handles three kinds of app:

| App type | What you add to the config | Served by |
| --- | --- | --- |
| Static site | nothing | S3 through CloudFront |
| Single-page app | `"spa": true` | S3 through CloudFront, with `index.html` for unknown paths |
| Server-rendered app | an `ssr` block | a Lambda Web Function behind the same CloudFront distribution, with static assets still on S3 |

You do not need to learn AWS. blogwright creates the bucket, the distribution, the certificate, the build environment and the deploy roles, and keeps them reconciled. It uses no CloudFormation, Terraform or CDK. The CLI is `blogwright`; `bw` is an alias.

## Requirements

1. Node ≥ 22.
2. AWS credentials in the ambient provider chain. If `aws sts get-caller-identity` works in your shell, blogwright works.
3. A git or jj repository whose app builds with `pnpm build`.

blogwright is v0.x software, published to npm as `blogwright`.

## Which guide to read

- **Astro site at the repo root** - nothing extra. The defaults fit.
- **A single-page app** - [Single-page apps](/guides/single-page-apps/) covers `spa`.
- **An app in a subdirectory, or a monorepo** - [Monorepos](/guides/monorepos/) covers `paths.app`, `paths.dist` and `sourceInclude`.
- **Astro SSR, SvelteKit, Nuxt, TanStack Start or Next** - [Server-rendered sites](/guides/server-rendered-sites/) has a recipe per framework.

Deployable [examples](/examples/overview/) cover each framework and mode - copy one and deploy it.

## What every deploy gets

- **Builds in a Lambda MicroVM.** Every deploy runs `pnpm install && pnpm build` in an isolated MicroVM. Your laptop or CI runner never needs the app's toolchain.
- **Incremental uploads, minimal invalidation.** Only files whose content changed upload, and only their CloudFront paths are invalidated. An identical redeploy touches nothing.
- **PR previews.** One shared preview stack serves every pull request at `https://<id>.<preview-domain>` (static sites and SPAs). See [PR previews](/guides/pr-previews/).
- **Keyless CI.** Set `githubRepo` and `bootstrap` creates a GitHub OIDC deploy role. See [CI with GitHub OIDC](/guides/ci-github-oidc/).
- **Rollback, history, logs and drift.** `rollback <hash>`, `history`, `logs <hash>` and `status`. See [Operations](/guides/operations/).

Output is readable on a terminal and stable line-oriented text in CI or with `--plain`. The plain formats are a compatibility contract.

## Plugins

Plugins add features beyond deploying. Each one has its own commands, config block and AWS resources.

| Plugin | What it does | How you get it |
| --- | --- | --- |
| [Analytics](/plugins/analytics/) | Page views from CloudFront access logs in an Iceberg table, with a local dashboard | `blogwright plugin add analytics` |
| [standard.site](/plugins/standard-site/) | Mirrors blog posts to your AT Protocol PDS | Bundled; add a `pds` config block |

See [Plugins overview](/plugins/overview/) for how plugins install, store state and tear down.

## How a deploy works

When you run `blogwright deploy`:

1. The CLI zips the repo (honouring `.gitignore`), names it by the jj/git revision hash, and uploads it to the environment's bucket.
2. A MicroVM starts from the builder image made at `bootstrap`, pulls the zip, and runs `pnpm install && pnpm build`. Build logs stream to your terminal and CloudWatch.
3. The build output syncs to `site/`. Each file's MD5 is compared with the live object's ETag, so only changed files upload and only their paths are invalidated.
4. For an SSR app, the server package becomes a new Web Function revision. The CLI waits for it to go active and probes it before removing stale files and invalidating the cache.
5. On a successful **production** deploy with a `pds` block, standard.site records re-sync. A failure here warns but never fails the deploy.

One S3 bucket per environment (`<env>-<siteName>-<accountId>`) holds everything: `build/` for source zips and manifests, `site/` for the live files (private to CloudFront), and `state/<env>.json` for the infrastructure state. The [architecture reference](/reference/architecture/) has the full picture.

:::note
Infrastructure commands take an optional environment (`[env]` or `--env`) that defaults to `production`. `init` takes none, and `preview` commands always use the shared preview environment. See [Environments](/guides/environments/).
:::

## The package family

| Package | What it is |
| --- | --- |
| `blogwright` | The CLI (`blogwright` / `bw`): graph engine, resource nodes, commands, plugin dispatch. Also exports `blogwright/rkey`. |
| `blogwright-core` | SigV4 transport, per-service AWS clients, config, S3 state store, shared ports |
| `blogwright-pds` | The standard.site plugin. Ships with the CLI. |
| `blogwright-analytics` | The analytics plugin. Installed on demand. |
| `blogwright-build-agent` | The build server inside the builder MicroVM. Not published; its bundle ships inside the CLI. |

You install `blogwright`. `blogwright-analytics` is added only if you run `blogwright plugin add analytics`; the rest come with the CLI.

## Next step

Run through the [quickstart](/getting-started/quickstart/). It takes three commands, and most of the wait is AWS creating the distribution.
