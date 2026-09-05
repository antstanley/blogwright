---
title: Configuration reference
description: Every config key blogwright reads - types, defaults, validation rules, and what each one controls.
sidebar:
  order: 2
---

blogwright reads one JSONC config file per environment. Only `siteName` is required - everything else has a default or is optional. This page lists every key in the schema: its type, default, validation rules, and what it controls.

## Config files

Config is loaded from `config/<env>.jsonc` at the repo root of the consuming site, falling back to `ops.config.jsonc`. Pass `--config <path>` to use an explicit file instead - it then becomes the only candidate. The repo root is found by walking up from the invocation directory to the nearest `.git` or `.jj`, so the CLI works from any subdirectory.

The environment defaults to `production`; pass another as the positional `[env]` or `--env` (see [Environments](/guides/environments/)). If no candidate file exists for the environment, the CLI errors and lists the paths it looked for.

Files are JSONC: `//` line comments, `/* */` block comments, and trailing commas are all accepted.

The minimal config:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example", // required - the stable slug in every AWS resource name
}
```

`blogwright init` writes this file for you interactively. Without a TTY, write it by hand - the two lines above are enough to bootstrap and deploy.

### How overrides merge

Your file is merged over the defaults. The nested objects `microvm` (including `microvm.idle`), `retention`, `seo`, and `paths` merge key-by-key, so you can override a single nested field and keep the rest of the defaults. Scalars and arrays replace their default outright - setting `sourceIgnore` replaces the default list, it does not extend it.

## Core identity

### `siteName`

`string` · **required**

Stable slug used in every derived AWS resource name. Must be lowercase alphanumeric/dashes (`^[a-z0-9-]+$`). The per-environment S3 bucket is named `<env>-<siteName>-<accountId>` and must fit S3's 63-character limit - the CLI rejects the combination otherwise, with a pointer to shorten the environment or site name.

:::caution
Changing `siteName` renames every derived resource, which means a whole new stack. Pick it once and keep it.
:::

### `region`

`string` · optional · default: `"us-east-1"`

Primary AWS region for S3, the builder MicroVM, and CloudWatch logs. ACM certificates and CloudFront resources are always managed in `us-east-1` regardless of this setting (CloudFront requires it), including the CloudFront access-log group.

### `domain`

`string` · optional · no default

Custom domain for the site. May also be supplied per-invocation with `--domain`, which takes precedence over the config value. When set, bootstrap requests an ACM certificate and prints the validation CNAMEs - see [Custom domains](/guides/custom-domains/). When unset, the site is served from its CloudFront domain.

### `app`

`string` · optional · no default

Value of the `app` tag applied to every AWS resource blogwright creates (alongside an `environment` tag). When unset it falls back to the `domain`, then to the repo directory name - always something a human can trace back to the project from a billing or resource listing. Site files get the same tags as S3 object tags.

### `githubRepo`

`string` · optional · no default

GitHub `owner/repo`, used to scope the trust policy of the GitHub OIDC deploy roles that `bootstrap` (role `<env>-<siteName>-gh`) and `preview bootstrap` (role `preview-<siteName>-gh`) provision. When unset, `bootstrap` skips the OIDC role; `preview bootstrap` always creates one, so the preview stack requires this key. See [CI deploys with GitHub OIDC](/guides/ci-github-oidc/) and [PR previews](/guides/pr-previews/).

## MicroVM builder

Sizing and lifecycle of the Lambda MicroVM that runs `pnpm install && pnpm build` on every deploy.

```jsonc
{
  "microvm": {
    "memory": 4,
    "maxDurationSeconds": 1800,
    "idle": {
      "autoResumeEnabled": false,
      "maxIdleDurationSeconds": 300,
      "suspendedDurationSeconds": 120,
    },
  },
}
```

### `microvm.memory`

`number` · optional · default: `4`

Builder memory in GB. Must be one of `0.5`, `1`, `2`, `4`, `8`. Applied to the builder image (converted to a minimum-MiB resource setting), so changing it takes effect through the image, not per-deploy.

### `microvm.maxDurationSeconds`

`number` · optional · default: `1800`

Maximum run duration of a builder MicroVM, in seconds. Must be between `1` and `28800` (8 hours). Passed to each launch as its maximum duration; the CLI's own wait deadline for a build is this value plus a 60-second grace period, anchored at VM launch.

### `microvm.idle`

`object` · optional

Idle policy passed verbatim to each builder MicroVM launch:

- **`autoResumeEnabled`** - `boolean`, default `false`. Whether the service may automatically resume a suspended MicroVM.
- **`maxIdleDurationSeconds`** - `number`, default `300`. How long the MicroVM may sit idle.
- **`suspendedDurationSeconds`** - `number`, default `120`. How long it stays suspended.

## Log retention

CloudWatch log-group retention, in days. Both values must be positive.

### `retention.microvmDays`

`number` · optional · default: `365`

Retention for the builder MicroVM log group (`/aws/lambda/microvms/<env>-<siteName>-builder`), which holds the build logs that `blogwright logs <hash>` reads.

### `retention.cloudfrontDays`

`number` · optional · default: `90`

Retention for the CloudFront access-log group (`/<siteName>/<env>/cloudfront`). This log group always lives in `us-east-1`, because CloudFront's vended log delivery only exists there.

## Deploy source and invalidation

Each deploy zips the repo (honoring `.gitignore`), builds it in the MicroVM, syncs the output to S3, and invalidates only the CloudFront paths that actually changed.

### `sourceIgnore`

`string[]` · optional · default: `[".jj/", ".git/", "node_modules/", "dist/", ".astro/"]`

Extra path prefixes excluded from the source zip, on top of what `.gitignore` already excludes. Setting this replaces the default list - include the defaults you still want.

### `sourceInclude`

`string[]` · optional · default: `[]`

Paths zipped into the deploy source even when gitignored - for artifacts a pre-deploy step builds outside the MicroVM (a wasm bundle, generated assets). Each entry must exist and be non-empty at deploy time, so a forgotten pre-build fails fast instead of shipping a broken site. Entries must be repo-relative, with no leading `/` and no `..` segments.

```jsonc
{
  "sourceInclude": ["web/src/lib/pkg/"], // built by CI before `blogwright deploy`
}
```

See [Non-Astro sites](/guides/non-astro-sites/) for the pattern this supports.

### `invalidationMaxPaths`

`number` · optional · default: `1000`

If a deploy changes more CloudFront paths than this, the CLI invalidates `/*` instead of listing every path. Deploys that change fewer paths invalidate only the changed ones; an identical redeploy invalidates nothing.

## CloudFront serving

### `defaultRootObject`

`string` · optional · default: `"index.html"`

The CloudFront distribution's default root object - the object served for requests to the bare origin root.

### `spa`

`boolean` · optional · default: `false`

Single-page app mode: CloudFront serves `/index.html` with a `200` for unknown paths (client-side routing) instead of the 404 page. Applies to the main distribution at creation. Previews are unaffected - the shared preview distribution's error responses cannot be host-routed. See [Non-Astro sites](/guides/non-astro-sites/).

## SEO

robots.txt and sitemap.xml policy, with environment-aware defaults: production is indexable with a sitemap; every other environment - including previews - blocks crawlers and skips the sitemap.

### `seo.robots`

`"auto" | "index" | "noindex" | "off"` · optional · default: `"auto"`

How the deploy pipeline writes `robots.txt` into the published site:

- **`auto`** (default) - production gets an indexable `robots.txt` (`Allow: /`, plus a `Sitemap:` line when the sitemap is on); every other environment gets `Disallow: /`.
- **`index`** / **`noindex`** - force either policy regardless of environment.
- **`off`** - don't manage `robots.txt` at all; whatever the build produced is left alone.

Preview deploys always count as non-production for `auto`, even when the preview stack deploys from a production config.

### `seo.robotsContent`

`string` · optional · no default

Explicit `robots.txt` body, published verbatim in place of the generated one. Ignored when `seo.robots` is `"off"`.

### `seo.sitemap`

`"auto" | "on" | "off"` · optional · default: `"auto"`

`sitemap.xml` generation, built from the site's HTML pages with absolute URLs. `auto` turns it on in production and off everywhere else; `on`/`off` force it. Requires a resolvable site origin - the custom domain, or the CloudFront domain otherwise.

## Site layout (`paths`)

Repo-relative paths describing the consuming site's layout. The defaults match a stock Astro project; override them when yours differs.

```jsonc
// A SvelteKit SPA in a monorepo subdirectory:
{
  "spa": true,
  "paths": { "app": "web", "dist": "web/build" },
}
```

### `paths.app`

`string` · optional · default: `"."`

Directory the MicroVM builds in - `pnpm install && pnpm build` run here. `"."` for an app at the repo root; `"web"` for a monorepo subdirectory. Must be repo-relative with no `..` segments.

### `paths.dist`

`string` · optional · default: `"dist"`

Built output directory the MicroVM publishes, relative to the repo root (not to `paths.app`). Same repo-relative validation as `paths.app`.

### `paths.publicDir`

`string` · optional · default: `"public"`

The static-asset directory served at the site root (Astro's `public/`). The `pds` commands write the OAuth client documents and the standard.site well-known file at protocol-fixed locations under this directory - their URL paths are part of the OAuth client id and the standard.site spec, so only the directory root varies.

### `paths.content`

`string` · optional · default: `"src/content/blog"`

Content-collection directory `pds sync` enumerates for posts.

### `paths.atprotoJson`

`string` · optional · default: `"src/data/atproto.json"`

JSON file the site imports to render its document `<link>` tags, written by `pds init`.

## standard.site publishing (`pds`)

`object` · optional · no default

AT Protocol / standard.site publishing. When the section is absent, publishing is entirely inert. `{ "name": "My Blog" }` is enough to enable it - see [Publishing to standard.site](/guides/publishing-standard-site/).

```jsonc
{
  "pds": {
    "name": "My Blog",
    "description": "Notes on things", // optional
    "handleResolver": "https://public.api.bsky.app", // optional; the default
    "secretName": "example/atproto", // optional; defaults to <siteName>/atproto
  },
}
```

### `pds.name`

`string` · **required** (within `pds`)

Publication display name - the `name` on the `site.standard.publication` record. Must be non-blank.

### `pds.description`

`string` · optional · no default

Optional publication description.

### `pds.handleResolver`

`string` · optional · default: `"https://public.api.bsky.app"`

Resolver `pds login` uses to turn a handle into a DID. Must be an `https:` URL. Unused when logging in with a bare DID - the PDS endpoint itself is always discovered from the DID document during OAuth.

### `pds.secretName`

`string` · optional · default: `"<siteName>/atproto"`

Name of the Secrets Manager secret holding the OAuth client key and session. Limited to the characters `A-Z a-z 0-9 _ / + = . @ -`.

## Optional analytics plugin (`analytics`)

The block is inert when the plugin is not installed. After
`blogwright plugin add analytics`, an absent block or `{}` uses these defaults:

| Key | Default | Rule |
| --- | --- | --- |
| `tableBucket` | `<env>-<siteName>-analytics` | 3–63 lowercase letters, digits or dashes |
| `namespace` | `web` | lowercase letters, digits or underscores, nonempty |
| `table` | `page_views` | same identifier rule |
| `bots` | `flag` | `flag` includes bots in queries; `filter` excludes them by default; both retain rows |
| `saltSecretName` | `<siteName>/<env>/analytics-salt` | nonempty Secrets Manager name characters |
| `dashboard.port` | `4317` | integer 1024–65535; loopback server only |

Unknown analytics keys, including unknown dashboard keys, are rejected when that
plugin is dispatched. The wizard asks the four literal-default settings; write
bucket/salt overrides by hand. Their defaults carry the environment, and explicit
shared names can remove that separation. The pipeline's two diagnostic log groups
have fixed 365-day retention; `retention.cloudfrontDays` controls the site's
CloudWatch copy and bounds optional backfill, not Iceberg row expiry.

## Validation summary

The CLI validates site-owned settings at load time. PDS owns the last three checks
below and runs them on PDS dispatch; malformed PDS config no longer rejects
unrelated built-in commands. Post-deploy PDS sync failures remain warnings:

| Key | Rule |
| --- | --- |
| `siteName` | required; `^[a-z0-9-]+$`; derived bucket name ≤ 63 chars |
| `region` | must be non-empty |
| `microvm.memory` | one of `0.5`, `1`, `2`, `4`, `8` |
| `microvm.maxDurationSeconds` | `1`–`28800` |
| `retention.*Days` | positive |
| `seo.robots` | `auto`, `index`, `noindex`, or `off` |
| `seo.sitemap` | `auto`, `on`, or `off` |
| `sourceInclude[]` | repo-relative, no leading `/`, no `..` |
| `paths.app`, `paths.dist` | non-empty, repo-relative, no `..` |
| `pds.name` | non-blank when `pds` is present |
| `pds.handleResolver` | valid `https:` URL |
| `pds.secretName` | optional; characters `[\w/+=.@-]` only when supplied |

For the resource names derived from `siteName` and the environment, see the [architecture reference](/reference/architecture/). For the flags that interact with config (`--config`, `--env`, `--domain`), see the [CLI reference](/reference/cli/).
