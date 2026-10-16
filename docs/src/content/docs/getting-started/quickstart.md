---
title: Quickstart
description: From an empty AWS account to a live site in three commands.
sidebar:
  order: 3
---

Three commands take you from an empty AWS account to a live site: `init` writes the config, `bootstrap` creates the infrastructure, `deploy` builds and publishes. This page walks the whole flow, then shows how to check on the result with `status` and `history`.

Before you start you need blogwright [installed](/getting-started/installation/) in a git (or jj) repository whose app - static site, SPA or server-rendered - builds with `pnpm build`, Node ≥ 22, and AWS credentials in the ambient provider chain. The CLI finds the repo root by walking up to the nearest `.git` or `.jj`, so every command works from any subdirectory. The binary is `blogwright`; `bw` is an alias.

## 1. `blogwright init` - write the config

The first-run wizard asks a few questions and writes a commented `config/production.jsonc` at the repo root:

```sh
pnpm exec blogwright init
```

The questions, in order:

1. **Site name** (required) - a lowercase slug of letters, digits, and dashes. It becomes the stable part of every AWS resource name, so never change it after bootstrap.
2. **AWS region** (required, default `us-east-1`).
3. **Custom domain** (optional) - leave blank to serve from the CloudFront domain instead.
4. **GitHub repo** for CI deploys, as `owner/repo` (optional) - leave blank to skip; setting it makes `bootstrap` provision a GitHub OIDC deploy role.
5. **Server-rendered app?** (default no) - answer `y` and the wizard asks for the framework: `astro`, `sveltekit`, `nuxt`, `tanstack-start`, `nextjs`, or `other`. For a known framework it writes the [recipe's](/guides/server-rendered-sites/#recipes) `ssr` block, including the [entry shim](/guides/server-rendered-sites/#the-entry-shim) settings, and links the recipe for the build settings it needs. For `other` it writes the defaults to fill in. If the region has no Lambda Web Functions, it asks for one that does.
6. **AWS profile** - asked only when your `~/.aws` files define profiles. Leave blank to use your default credentials. If `--profile` or `AWS_PROFILE` names a defined profile it is offered as the default; then answer `none` for default credentials.
7. **Detect the AWS account and pin it?** (default yes) - looks up the account your credentials belong to and writes it as `aws.accountId`, so every later command refuses credentials for any other account. If your sign-in has expired it offers `aws sso login` or `aws login` first; if detection still fails, `init` warns and carries on without a pin. It is skipped while `AWS_ENDPOINT_URL` is exported, because detection must reach real AWS.

The result looks like this:

```jsonc
// config/production.jsonc - created by `blogwright init`
{
  "region": "us-east-1",
  "siteName": "example", // stable slug in every AWS resource name - never change it
  "domain": "example.com",
  "aws": {
    "profile": "example-prod",
    "accountId": "123456789012" // deploys refuse credentials for any other account
  }
}
```

If `config/production.jsonc` already exists, `init` refuses and tells you to edit it directly. Everything beyond these keys has defaults - see the [configuration reference](/reference/configuration/) for the full set.

Then add the one key your app type needs, before you bootstrap:

| App type | Add to the config | Guide |
| --- | --- | --- |
| Static site | nothing | - |
| Single-page app | `"spa": true` | [Single-page apps](/guides/single-page-apps/) |
| Server-rendered app | an `ssr` block (`init` writes it when you answer `y`) | [Server-rendered sites](/guides/server-rendered-sites/) |

An app outside the repo root also needs `paths.app` - see [Monorepos](/guides/monorepos/).

:::note[No TTY?]
`init` is interactive and exits with an error in CI or plain mode. Write the minimal config by hand instead - only `region` and `siteName` are required:

```sh
echo '{ "region": "us-east-1", "siteName": "example" }' > config/production.jsonc
```
:::

## 2. `blogwright bootstrap` - create the infrastructure

```sh
pnpm exec blogwright bootstrap
```

Bootstrap creates and reconciles the whole infrastructure graph for the environment (default `production`): the S3 bucket (`production-<siteName>-<accountId>`), the CloudFront distribution with a private origin, the builder MicroVM image, and the rest. It is safe to re-run - existing resources are left alone or reconciled.

**Without a domain**, the site serves straight from the distribution's CloudFront domain, printed at the end:

```sh
Site will be served at https://d1234abcdefgh.cloudfront.net
```

**With a domain** - either `"domain"` in the config or the `--domain` flag, which overrides the config:

```sh
pnpm exec blogwright bootstrap --domain example.com
```

blogwright requests an ACM certificate and prints the DNS records to create at your registrar:

```sh
Add these DNS records at your registrar to validate the certificate:
  CNAME  _3f2a…example.com.  ->  _9d1c….acm-validations.aws.
waiting for certificate to be ISSUED (Ctrl-C to background)…
```

It then polls until the certificate is issued (Ctrl-C is safe - re-run `bootstrap` once DNS propagates and it picks up where it left off). Finally it prints the CloudFront domain to point your own domain at:

```sh
  CloudFront domain: d1234abcdefgh.cloudfront.net
  point example.com (CNAME/ALIAS) at d1234abcdefgh.cloudfront.net
```

:::tip
You can start without a domain and add one later: set it in the config (or pass `--domain`) and re-run `bootstrap`. The reconcile validates the certificate and attaches the alias to the existing distribution. See [custom domains](/guides/custom-domains/) for the details.
:::

## 3. `blogwright deploy` - build and publish

```sh
pnpm exec blogwright deploy
```

Deploy zips the repo (honoring `.gitignore`, named by the jj/git revision hash), uploads it, and runs a builder MicroVM that executes `pnpm install && pnpm build` and syncs the output to the live `site/` prefix. Only files whose content actually changed are re-uploaded, and only those CloudFront paths are invalidated - an identical redeploy invalidates nothing. The run ends with a summary card:

```sh
deploy summary
  revision      1a2b3c4d5e6f
  environment   production
  source        142 files, 812 KiB
  build         1m04s
  invalidated   12 changed paths
  site          https://example.com
```

Open the site URL - you are live. [Deploying](/guides/deploying/) covers the build lifecycle, `--refresh`, rollbacks, and build logs.

## 4. Check the result

```sh
pnpm exec blogwright status     # planned graph vs. live state
pnpm exec blogwright history    # deployment history
```

`status` walks every resource in the planned graph and reports whether it exists live - a drift view of the environment. `history` lists past deployments from their build manifests: hash, status, finish time, and duration. Both default to `production`; pass another environment positionally or with `--env`.

## Next steps

- [Deploying](/guides/deploying/) - the deploy lifecycle in depth: builds, invalidation, rollback, logs.
- [Custom domains](/guides/custom-domains/) - certificates, DNS, and adding a domain after the fact.
- [Environments](/guides/environments/) - staging and other environments beyond `production`.
- [Configuration files](/guides/configuration-files/) - where config lives and which file each environment loads.
- [Configuration reference](/reference/configuration/) - every config key and its default.
- [Plugins](/plugins/overview/) - add traffic analytics or standard.site publishing.
