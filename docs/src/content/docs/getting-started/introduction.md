---
title: Introduction
description: What blogwright is, who it's for, and how a deploy actually works.
sidebar:
  order: 1
---

blogwright is full operations for a blog or static site on AWS: S3 + CloudFront hosting with the origin kept private via Origin Access Control, and the site built inside a **Lambda MicroVM**. One CLI — `blogwright`, alias `bw` — creates the infrastructure, runs deploys, serves PR previews, and can mirror your posts to the AT Protocol as [standard.site](https://standard.site) records.

There is no CloudFormation, no Terraform, no CDK. The CLI talks to AWS directly by SigV4-signing raw HTTP requests (via `@smithy/signature-v4`) and models the infrastructure as a **reconcilable dependency graph**: `bootstrap` walks the graph and creates or reconciles each resource, `status` shows the planned graph against live state, and `destroy` tears it all down.

## Who it's for

blogwright works with any static site that builds via `pnpm build`:

- **An Astro blog at the repo root** — the default shape; everything works out of the box.
- **Any other static site or monorepo SPA** — a SvelteKit or Vite app in a subdirectory, configured with `paths.app`, `paths.dist`, and `spa`. See [Non-Astro sites](/guides/non-astro-sites/).

It requires Node ≥ 22 and AWS credentials in the ambient provider chain. It is v0.x software, published to npm as `blogwright`.

## Headline features

- **Incremental deploys with minimal invalidation.** The deploy sync compares each built file's MD5 to the live object's S3 ETag, so only genuinely changed files are re-uploaded — and **only the changed CloudFront paths are invalidated**. Unchanged pages stay cached; an identical redeploy invalidates nothing. If more than `invalidationMaxPaths` paths change, it falls back to `/*`.
- **Builds in a Lambda MicroVM.** A stable builder image is snapshotted once at `bootstrap`; every deploy runs `pnpm install && pnpm build` inside a MicroVM, with build logs in CloudWatch. Your CI machine never needs the site's toolchain.
- **PR previews.** One shared preview stack serves every PR at `https://<id>.<preview-domain>` — no per-PR CloudFront distributions or roles; a preview deploy is just a build plus an S3 sync. See [PR previews](/guides/pr-previews/).
- **CI deploys via GitHub OIDC.** Set `githubRepo` in the config and `bootstrap` provisions a GitHub OIDC deploy role — no stored keys. See [CI with GitHub OIDC](/guides/ci-github-oidc/).
- **standard.site (AT Protocol) publishing.** With a `pds` section in the config, the site is mirrored to your PDS as standard.site records, with rkeys derived deterministically from each post's URL path. See [Publishing to standard.site](/guides/publishing-standard-site/).
- **Rollback, history, logs, drift.** `rollback <hash>` re-deploys any earlier build, `history` lists deployments, `logs <hash>` shows the CloudWatch build logs, and `status` shows drift between planned and live state. See [Operations](/guides/operations/).
- **Output for humans and machines.** Pretty on a TTY — live build progress, a deploy summary card, a status drift tree. Piped output, CI, and `--plain` get stable line-oriented text; the plain formats are a compatibility contract.

## The package family

| Package                  | What it is                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `blogwright`             | The CLI (`blogwright` / `bw` bins): graph engine, resource nodes, commands, dispatch — plus the `blogwright/rkey` subpath export (a re-export of `blogwright-pds/rkey`) |
| `blogwright-core`        | SigV4 transport + per-service HTTP clients, config, S3 state store, shared ports (filesystem, terminal)          |
| `blogwright-pds`         | standard.site (AT Protocol) publishing: OAuth client, secret store, PDS record sync, URL-derived rkeys           |
| `blogwright-build-agent` | HTTP build server baked into the builder MicroVM image (not published — its bundle ships inside the CLI package) |

You only ever install `blogwright`; the others come with it. The `blogwright/rkey` subpath exists so your site can build its `<link rel="site.standard.document">` tags from the same rkey implementation the sync uses — see the [rkey reference](/reference/rkey/).

## How a deploy works

One S3 bucket per environment (`<env>-<siteName>-<accountId>`) holds everything: `build/` for source zips, the builder image artifact, and deployment manifests; `site/` for the live website (the CloudFront origin, private via OAC); and `state/<env>.json` as the topology's source of truth.

When you run `blogwright deploy`:

1. The CLI zips the repo — honoring `.gitignore`, named by the jj/git hash — and uploads it to `build/`.
2. A MicroVM starts from the builder image snapshotted at `bootstrap`, pulls the zip, and runs `pnpm install && pnpm build`. Build logs stream to CloudWatch.
3. The build output is synced to `site/`: each file's MD5 is compared to the live object's S3 ETag, so only changed files are uploaded and only their CloudFront paths are invalidated.
4. On a successful **production** deploy with a `pds` section configured, the standard.site records are re-reconciled (non-fatal on failure — the next deploy heals).

Because unchanged objects are skipped entirely, a deploy is proportional to what actually changed — and an identical redeploy touches nothing. The full picture, including the graph engine and state model, is in the [architecture reference](/reference/architecture/).

:::note
The infrastructure and `pds` commands take an optional environment (`[env]` positionally or `--env`), defaulting to `production` — `init` takes none, and the `preview` commands always run in the shared preview environment. Environments are covered in [Environments](/guides/environments/).
:::

## Next steps

Getting live takes three commands:

```sh
pnpm exec blogwright init          # first-run wizard — writes config/production.jsonc
pnpm exec blogwright bootstrap     # create the infrastructure graph
pnpm exec blogwright deploy        # zip + build in a MicroVM + publish
```

- [Installation](/getting-started/installation/) — add `blogwright` to your project and set up AWS credentials.
- [Quickstart](/getting-started/quickstart/) — from an empty AWS account to a live site.
- [Deploying](/guides/deploying/) — the deploy lifecycle in depth.
- [CLI reference](/reference/cli/) — every command and flag.
