---
title: PR previews
description: Serve every pull request at its own URL from one shared CloudFront distribution — deploy on open, destroy on close.
sidebar:
  order: 5
---

blogwright serves every pull request at `https://<id>.<preview-domain>` from a single **shared preview stack**. Deploying a preview is just a MicroVM build plus an S3 sync under a per-PR prefix; removing one is a prefix delete. There are no per-PR CloudFront distributions, builder images, or IAM roles — the stack is provisioned once, and PRs come and go as S3 prefixes.

## How the shared stack works

The preview stack is a full blogwright environment named `preview` — its own bucket (`preview-<siteName>-<accountId>`), builder MicroVM image, IAM roles, and log groups, fully isolated from production. Every `blogwright preview` command runs in it implicitly; see [environments](/guides/environments/) for why you shouldn't create a regular environment with that name.

What makes it shared is the serving path:

- **One CloudFront distribution** fronts the whole stack, with its cache policy set to *CachingDisabled* — every request goes to S3.
- **A CloudFront Function** (viewer-request) reads the `Host` header, takes the first DNS label as the preview id, and rewrites the URI to that PR's prefix: `pr-42.preview.example.com/posts/` becomes `/previews/pr-42/site/posts/index.html` in the bucket. It also resolves directory URLs to `index.html`, because the private S3 REST origin does no index-document resolution. Since nothing is cached, the function runs on every request and new content is live immediately.
- **A wildcard ACM certificate** (`*.<preview-domain>`) and **wildcard Route53 alias records** (`*.<preview-domain>` as A/AAAA aliases pointing at the distribution) make every subdomain resolve and terminate TLS without per-PR DNS work.

Each preview deploy publishes to `previews/<id>/site/`; the bucket policy grants CloudFront read on `previews/*`. Destroying a preview deletes its prefix — and because previews are never cached, no CloudFront invalidation is needed and the URL stops serving at once.

## Requirements

- **The preview domain must be a Route53 hosted zone** in the same account — a zone whose name exactly matches the preview domain (a zone for `example.com` does not count for `preview.example.com`). This is what lets bootstrap create the ACM validation records and the wildcard alias records automatically; without a matching zone it fails with `no Route53 hosted zone found`.
- **`githubRepo` must be set** in the preview config. `preview bootstrap` always provisions the preview GitHub OIDC deploy role, and the role's trust policy is scoped to that repository.

## Setting up the stack

The preview environment resolves its config like any other: `config/preview.jsonc` at the site's repo root, falling back to `ops.config.jsonc`. Reuse the same `siteName` as production — the `preview-` prefix keeps every resource apart:

```jsonc
// config/preview.jsonc
{
  "region": "us-east-1",
  "siteName": "example", // same slug as production — the preview- prefix isolates resources
  "domain": "preview.example.com", // must be a Route53 hosted zone
  "githubRepo": "owner/repo", // the preview OIDC role is scoped to this repo
}
```

Then bootstrap once:

```sh
blogwright preview bootstrap
```

This creates the bucket, builder image, roles, log groups, the wildcard certificate, the shared distribution with the host-routing function, the wildcard DNS records, and the OIDC role. `preview bootstrap` requires a domain — from the config as above, or passed as `--domain preview.example.com`. Because the domain is a hosted zone, the ACM validation records are created for you and the command simply waits for the certificate to be issued.

## Deploying a preview

```sh
blogwright preview deploy pr-42
```

The id must be lowercase alphanumeric with dashes (`^[a-z0-9-]+$`) — `pr-42` is the intended shape, matching a PR number. It can also be passed as `--id pr-42`. The deploy runs the same pipeline as a [production deploy](/guides/deploying/): zip the current checkout (honoring `.gitignore`, named by the jj/git revision hash), upload it, build in the shared builder MicroVM, and sync the output — here to `previews/pr-42/site/` instead of `site/`. When it finishes, the CLI prints the preview URL:

```sh
blogwright preview deploy pr-42
# ...
# ✓ preview ready in 1m12s: https://pr-42.preview.example.com
```

Re-deploying the same id overwrites that PR's prefix — push, deploy, refresh the same URL. `--refresh` works here too, re-uploading unchanged files so metadata fixes reach live objects.

Every object a preview deploy uploads is tagged `environment: preview-<id>` (e.g. `environment: preview-pr-42`) alongside the usual `app` tag, so per-PR cost and cleanup queries work against the object tags. See [environments](/guides/environments/) for the tagging scheme.

:::note
Previews build with `https://<id>.<preview-domain>` as the site's base URL, and the default SEO policy blocks crawlers for every non-production environment — a preview never leaks into search results.
:::

## Listing and removing previews

```sh
blogwright preview list
#   pr-42  https://pr-42.preview.example.com
#   pr-57  https://pr-57.preview.example.com

blogwright preview destroy pr-42
# ✓ removed preview pr-42 (214 object(s))
```

`preview list` derives the active ids from the `previews/` prefix in the bucket. `preview destroy` deletes one preview's prefix — no invalidation is needed because previews are never cached, so the URL stops serving immediately.

## The preview OIDC role

`preview bootstrap` creates a GitHub OIDC deploy role named `preview-<siteName>-gh`, trusted for **any ref** of `githubRepo` (subject claim `repo:owner/repo:*`) — PR branches deploy from wherever they live, unlike the production role, which is gated to a branch or GitHub environment. Its policy covers exactly what a preview deploy or destroy needs: read/write on the preview bucket, running the builder MicroVM (including rebuilding the builder image when the agent changes), and reading build logs. It has no CloudFront invalidation permission, because previews never need one.

How the OIDC provider and role assumption work is covered in [CI deploys with GitHub OIDC](/guides/ci-github-oidc/).

## A PR preview workflow

Use the PR number as the preview id: deploy on open and every push, destroy on close. Both jobs assume `preview-<siteName>-gh` (its ARN is `arn:aws:iam::<account-id>:role/preview-<siteName>-gh`):

```yaml
# .github/workflows/pr-preview.yml
name: pr-preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  id-token: write # OIDC token for the preview role
  contents: read

concurrency: preview-pr-${{ github.event.number }}

jobs:
  deploy:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/preview-example-gh
          aws-region: us-east-1
      - run: pnpm exec blogwright preview deploy pr-${{ github.event.number }}

  destroy:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # the CLI reads config/preview.jsonc from the repo
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/preview-example-gh
          aws-region: us-east-1
      - run: pnpm exec blogwright preview destroy pr-${{ github.event.number }}
```

CI output is automatically plain and line-oriented (no TTY), and the deploy step's log ends with the preview URL.

:::caution
GitHub does not issue OIDC tokens to `pull_request` runs from forked repositories, so this workflow deploys previews for same-repo branches only. That is also the safe default — a preview deploy builds and runs the PR's code in your AWS account.
:::

## Tearing down the stack

```sh
blogwright preview teardown --yes
```

This removes the entire shared preview stack — the distribution, routing function, wildcard certificate and DNS records, roles, builder image, log groups, and the bucket with every preview in it. It refuses to run without `--yes`, and terminates any running builder MicroVMs first (or lets you cancel and wait for in-flight builds). Individual PRs never need this; `preview destroy <id>` is the per-PR cleanup.
