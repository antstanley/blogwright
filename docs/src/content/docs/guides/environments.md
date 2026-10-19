---
title: Environments
description: Run production, staging and other environments side by side in one AWS account, each with its own bucket, roles and state.
sidebar:
  order: 2
---

Add an environment name to any command to target it: `blogwright deploy staging`. Without one, every command uses `production`.

An **environment** is a name that selects the config file, is stamped into every AWS resource name, and keys the deployment state. Two environments in the same account never share a bucket, a role or a state file, so `production` and `staging` run side by side without touching each other.

## Choose an environment

Pass it as the positional `[env]` argument or with `--env`:

```sh
blogwright deploy                    # production
blogwright deploy staging            # positional
blogwright deploy --env staging      # flag - wins over the positional
blogwright status staging            # every environment-scoped command takes [env]
```

`rollback` and `logs` take a `<hash>` first, then the optional environment:

```sh
blogwright rollback 4f3a2b1c staging
blogwright logs 4f3a2b1c staging
```

Names must be lowercase letters, digits and dashes (`^[a-z0-9-]+$`). Anything else is rejected before anything in your account is created or changed.

:::note
`preview` is reserved for the shared PR-preview stack - every `blogwright preview` command runs in it. Don't create a regular environment named `preview`; see [PR previews](/guides/pr-previews/).
:::

## Set up a staging environment

1. Create `config/staging.jsonc` with the same `siteName` as production. The environment prefix keeps the resources apart:

   ```jsonc
   // config/staging.jsonc
   {
     "region": "us-east-1",
     "siteName": "example", // same slug as production
   }
   ```

2. Create its infrastructure: `blogwright bootstrap staging`
3. Deploy to it: `blogwright deploy staging`

To give staging its own hostname, add a `domain` - see [Custom domains](/guides/custom-domains/). To let CI deploy it, set `githubRepo` - see [CI deploys with GitHub OIDC](/guides/ci-github-oidc/).

Want one file for every environment instead? See [Configuration files](/guides/configuration-files/#one-config-for-every-environment).

## One AWS profile and account per environment

Each environment file can name the profile its commands use and pin the account they must run against, so staging and production can live in different AWS accounts without anyone exporting `AWS_PROFILE` by hand:

```jsonc
// config/staging.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "aws": { "profile": "example-staging", "accountId": "210987654321" },
}
```

With a pin in place, credentials for the wrong account fail before any state is read - so `status` can never report an empty stack, and `bootstrap` can never build a second one, in an account you did not mean. Run `blogwright whoami staging` to check which account and profile a command would use. See [`aws`](/reference/configuration/#aws) for the precedence rules.

## What an environment owns

Each environment gets one S3 bucket, `<env>-<siteName>-<accountId>`, holding the build artifacts, the live site and the state. Every other resource name carries the same environment and site name - the build and exec roles, the builder MicroVM image, the log groups - so each environment is a fully isolated stack. The layout is in the [architecture reference](/reference/architecture/).

The state lives at `state/<env>.json` in the environment's own bucket. Because it is in S3 rather than on disk, your laptop, a colleague's and CI all see the same record of what has been provisioned.

:::caution
S3 bucket names are capped at 63 characters. If `<env>-<siteName>-<accountId>` is longer, the CLI stops and tells you to shorten the environment name or `siteName`.
:::

## What changes between environments

Most behaviour is identical. Search-engine settings are the exception: with `seo.robots` and `seo.sitemap` at their `auto` defaults, production is indexable and gets a sitemap, and every other environment blocks crawlers and skips the sitemap. A staging site never leaks into search results by default. See [robots.txt and sitemap.xml](/guides/deploying/#robotstxt-and-sitemapxml).

## Resource tagging

Every AWS resource blogwright creates carries two tags:

- **`environment`** - the environment name.
- **`app`** - the `app` config option, falling back to the site's domain (`--domain` or `domain`), then to the repo directory name. The tag is always something a person can trace back to the project in a billing or resource listing.

Site files get the same two tags as S3 object tags on upload. Preview deploys stamp the PR id into the object tag (`environment: preview-pr-42`), so per-PR cost and cleanup queries work - see [PR previews](/guides/pr-previews/).

:::note
Object tags are written on upload, and a deploy only re-uploads files whose content changed - so tags added by an upgrade never reach unchanged files on their own. Run `blogwright deploy --refresh` once to re-upload everything; see [Deploying](/guides/deploying/#metadata-fixes---refresh).
:::

## Related pages

- [Configuration files](/guides/configuration-files/) - which file each environment loads
- [PR previews](/guides/pr-previews/) - the shared `preview` environment
- [Architecture](/reference/architecture/) - every resource an environment owns
