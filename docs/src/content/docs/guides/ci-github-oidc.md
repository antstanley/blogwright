---
title: CI deploys with GitHub OIDC
description: Let GitHub Actions deploy your site with a short-lived OIDC role — no AWS keys stored anywhere.
sidebar:
  order: 4
---

blogwright deploys from CI without any stored AWS credentials. Set `githubRepo` in your config and `bootstrap` provisions an IAM role that GitHub Actions assumes via OIDC federation: the workflow exchanges its short-lived GitHub token for temporary AWS credentials, runs `blogwright deploy`, and nothing long-lived ever exists to leak or rotate.

## Enabling the deploy role

Add your repository slug to the environment's config:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "githubRepo": "owner/repo", // enables the GitHub OIDC deploy role at bootstrap
}
```

Then run (or re-run) bootstrap for each environment CI should deploy:

```sh
blogwright bootstrap             # creates production-example-gh
blogwright bootstrap staging     # creates staging-example-gh
```

Bootstrap creates two things:

- The account-wide **OIDC identity provider** for `token.actions.githubusercontent.com` (audience `sts.amazonaws.com`), created only if it doesn't already exist.
- A per-environment **deploy role** named `<env>-<siteName>-gh` — e.g. `production-example-gh` — trusted only for tokens from your repository.

Adding `githubRepo` to an already-bootstrapped environment works the same way: re-run `blogwright bootstrap <env>` and the reconcile creates the missing role. Re-running bootstrap also reapplies the trust policy and permissions, so changing `githubRepo` (a repo rename or transfer) is a config edit plus a bootstrap.

:::note
`destroy` removes only the repo-scoped role. The OIDC identity provider is account-global — other stacks and tools may share it — so it is deliberately left in place.
:::

## Trust conditions

The role's trust policy pins the token's audience to `sts.amazonaws.com` and matches the OIDC subject claim per environment, mirroring how each one is meant to deploy:

| Environment | Subject claim | Meaning |
| --- | --- | --- |
| `production` | `repo:owner/repo:environment:production` | Only jobs running in the **`production` GitHub environment** |
| Any other (e.g. `staging`) | `repo:owner/repo:ref:refs/heads/main` | Only workflow runs on the `main` branch |
| Preview stack | `repo:owner/repo:*` | Any ref — PRs deploy and destroy previews |

Scoping production to a GitHub environment rather than a branch lets you gate deploys behind environment protection rules — required reviewers, wait timers — in the repository settings. The workflow job must declare `environment: production`, or the token's subject won't match and `AssumeRoleWithWebIdentity` fails.

## What the role can do

The role is scoped to one environment's resources, not the account:

- Read, write, and delete objects in the environment's S3 bucket (source zips, the built site, state).
- Run and manage builder MicroVMs, and rebuild the builder image when the agent bundle changed — so build-agent updates ship through CI without a separate `bootstrap`.
- Read the MicroVM build logs, and pass the environment's build and exec roles.
- Create CloudFront invalidations on the environment's distribution (previews are never cached, so the preview role omits this).
- When [standard.site publishing](/guides/publishing-standard-site/) is configured, read and write the OAuth secret in Secrets Manager — the post-deploy sync rotates the session on every run.

## Finding the role ARN

The name is deterministic, so the ARN is too:

```txt
arn:aws:iam::<accountId>:role/<env>-<siteName>-gh
```

`blogwright status <env>` also prints each resource's recorded outputs, including the deploy role's ARN.

## Example: staging on push to main

The workflow needs `id-token: write` to mint an OIDC token, and `contents: read` to check out the repo. `aws-actions/configure-aws-credentials` assumes the role and exports the temporary credentials into the environment, where blogwright's ambient provider chain picks them up.

```yaml
# .github/workflows/staging.yml
name: Deploy staging

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/staging-example-gh
          aws-region: us-east-1
      - run: pnpm exec blogwright deploy staging
```

## Example: production on release

Identical shape, with two changes: the job runs in the `production` GitHub environment (the trust condition requires it), and the trigger is a release rather than a push. The trust policy only checks the environment claim — the trigger is yours to choose — but releasing production deliberately, gated by environment protection rules, is the intended flow.

```yaml
# .github/workflows/production.yml
name: Deploy production

on:
  release:
    types: [published]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/production-example-gh
          aws-region: us-east-1
      - run: pnpm exec blogwright deploy
```

:::tip
CI output is automatically plain and line-oriented — the plain formats are a compatibility contract for machines and agents, so log lines are safe to grep in workflow steps. See [deploying](/guides/deploying/).
:::

## The preview stack's role

`blogwright preview bootstrap` creates its own role, `preview-<siteName>-gh`, trusted for **any ref** in the repository so a PR workflow can deploy a preview on open/update and destroy it on close. Its access is scoped to the preview stack's own bucket, and it has no CloudFront invalidation permission — previews are served uncached. See [PR previews](/guides/pr-previews/) for the preview workflow.
