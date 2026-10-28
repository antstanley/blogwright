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

Your file is merged over the defaults. The nested objects `microvm` (including `microvm.idle`), `retention`, `seo`, and `paths` merge key-by-key, so you can override a single nested field and keep the rest of the defaults. Scalars and arrays replace their default outright - setting `sourceIgnore` (or `cacheControl`) replaces the default list, it does not extend it. Blocks with no default - `ssr`, `aws` and `headers` - are taken from each environment's file as written: an environment without the block gets none of it.

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

### `aws`

`object` · optional · no default

Which AWS credentials this environment uses, and which account it accepts. Both keys are optional, and the block is left out entirely when neither is set. Unknown keys are refused.

```jsonc
"aws": {
  "profile": "mysite-prod",
  "accountId": "123456789012" // deploys refuse credentials for any other account
}
```

#### `aws.profile`

`string` · optional · no default

A named profile from your shared AWS files (`~/.aws/config` and `~/.aws/credentials`, or `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE`). Every command resolves credentials in this order, and the first match wins:

1. `--profile <name>`
2. `AWS_PROFILE`
3. Credentials exported into the environment - `AWS_ACCESS_KEY_ID` with `AWS_SECRET_ACCESS_KEY`, `AWS_WEB_IDENTITY_TOKEN_FILE`, or a container credentials URI - as CI exports them
4. `aws.profile`
5. The default AWS provider chain

So a committed `aws.profile` does not break CI that exports credentials: exported credentials win over it - only the exported credentials are used, never a `[default]` profile from your AWS files - and the command says so (`ignoring aws.profile "...": environment credentials are set`). A runner that uses an EC2 instance role exports nothing, so there the profile still applies and is refused if the runner's AWS files do not define it; export the instance credentials first with `eval "$(aws configure export-credentials --format env)"`. A named profile that your AWS files do not define stops the command before any AWS call, listing the profiles that do exist. Only the profile's credentials are used - never its `region`; the deploy region is always [`region`](#region).

#### `aws.accountId`

`string` · optional · no default

The only AWS account this environment's commands accept: exactly 12 digits, **quoted** (a JSON number would drop leading zeros, so a number is refused). Every command calls `sts:GetCallerIdentity` before it loads any state and refuses credentials for any other account:

```text
config/production.jsonc pins AWS account 123456789012, but the credentials in use
belong to 210987654321 (AdminRole, profile "personal" from AWS_PROFILE).
Switch credentials with --profile, or change aws.accountId.
```

Because the check comes before the state bucket (`<env>-<siteName>-<accountId>`) is read, the wrong credentials can never make `status` report an empty stack or `bootstrap` build a second one in the wrong account. There is no flag to bypass the pin. Under an endpoint override (`--endpoint` or `AWS_ENDPOINT_URL`) the check is skipped, because an emulator answers with its own account. `blogwright init` can detect and write this for you; `blogwright whoami` shows whether the current credentials match.

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

### `retention.webFunctionDays`

`number` · optional · default: `90`

Retention for the two log groups an SSR environment's Web Function writes to (`/<siteName>/<env>/web` and its in-Region companion `/<siteName>/<env>/web.local`). Inert when `ssr` is absent.

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

See [Monorepos](/guides/monorepos/#ship-pre-built-artifacts) for the pattern this supports.

### `invalidationMaxPaths`

`number` · optional · default: `1000`

If a deploy changes more CloudFront paths than this, the CLI invalidates `/*` instead of listing every path. Deploys that change fewer paths invalidate only the changed ones; an identical redeploy invalidates nothing.

## CloudFront serving

### `defaultRootObject`

`string` · optional · default: `"index.html"`

The CloudFront distribution's default root object - the object served for requests to the bare origin root.

### `spa`

`boolean` · optional · default: `false`

Single-page app mode: CloudFront serves `/index.html` with a `200` for unknown paths (client-side routing) instead of the 404 page. Applies to the main distribution at creation. Previews are unaffected - the shared preview distribution's error responses cannot be host-routed. See [Single-page apps](/guides/single-page-apps/).

## Cache-Control (`cacheControl`)

`{ "match": string | string[], "value": string }[]` · optional · default: the two rules below

The `Cache-Control` header the builder writes on each file it uploads, chosen by the file's site-relative URL path (`/index.html`, `/_astro/app.1a2b.js`), never its S3 key - so one list serves production and previews. Rules are checked in order and **the first match wins**; a file no rule matches is uploaded without `Cache-Control`. Setting the key replaces the defaults outright, so end your list with a `**` catch-all; `[]` writes no header at all.

```jsonc
{
  "cacheControl": [
    // The default rules
    { "match": ["/_astro/**", "/_app/immutable/**"], "value": "public, max-age=31536000, immutable" },
    { "match": "**", "value": "public, max-age=0, s-maxage=86400, must-revalidate" },
  ],
}
```

- **`match`** - one pattern or a non-empty list. A pattern starts with `/` (or `**`) and matches a whole path: `*` and `?` stay within one path segment, and `**` - which must be a whole segment - spans any number of them (`**/*.html` matches `/index.html` too). Match a directory URL through its `index.html`.
- **`value`** - the header value, verbatim: comma-separated directives such as `public, max-age=0, s-maxage=604800, must-revalidate`.

Validation rejects, at load, a malformed rule or value and any pattern that can never match: one that cannot match a built file's path (no leading `/` or `**`, a trailing `/`, an empty segment, a `.` or `..` segment, a percent-encoded character such as `%20`, `**` inside a segment, or the unsupported `[…]`, `{…}` and `\`), and one an earlier rule always matches first - a repeated pattern, anything after `**` or `**/*`, anything under an earlier literal `/<dir>/**` or `/<dir>/**/*`, or a literal path an earlier pattern matches. A pattern that an earlier pattern of the same rule already covers, by the same shapes, is rejected as redundant. Patterns match the decoded path, so write non-ASCII names as themselves (`/blog/café/*.html`).

When the rules change, the next build to each target re-uploads every file (an implicit `--refresh`) so unchanged files carry the new header too. Browser (`max-age`) versus edge (`s-maxage`) lifetimes, the trade-offs of a long `s-maxage`, and how error responses are cached are covered in [Caching and Cache-Control](/guides/caching/).

## Response headers (`headers`)

`object` · optional · no default

HTTP response headers CloudFront adds to every response: security headers such as `Content-Security-Policy` and `Strict-Transport-Security`, plus any other header you name. These cannot come from the site itself - `frame-ancestors` is ignored in a `<meta http-equiv>` Content-Security-Policy, and HSTS is only honoured as a real header - so blogwright manages a CloudFront response headers policy named `<env>-<siteName>-headers` and attaches it to every cache behavior of the environment's distribution. Every response carries the headers: pages, directory routes, the 404 page, and hashed assets.

```jsonc
{
  "headers": {
    "security": {
      "hsts": true, // or { "maxAgeSeconds": 63072000, "includeSubdomains": true, "preload": true }
      "contentTypeOptions": true, // X-Content-Type-Options: nosniff
      "frameOptions": "deny",
      "referrerPolicy": "no-referrer",
      "contentSecurityPolicy": "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
    },
    "custom": [
      { "name": "Cross-Origin-Opener-Policy", "value": "same-origin" },
      { "name": "Cross-Origin-Resource-Policy", "value": "same-origin" },
      { "name": "Permissions-Policy", "value": "accelerometer=(), camera=(), geolocation=()" },
    ],
  },
}
```

| Field | Header | Validation | Default |
| --- | --- | --- | --- |
| `security.hsts` | `Strict-Transport-Security` | `true`, `false`, or an object of `maxAgeSeconds` (integer `0`-`2147483647`), `includeSubdomains` and `preload` (booleans) | absent; `true` means `max-age=31536000`, no `includeSubDomains`, no `preload` |
| `security.contentTypeOptions` | `X-Content-Type-Options: nosniff` | boolean | `false` |
| `security.frameOptions` | `X-Frame-Options` | `deny` or `sameorigin` | absent |
| `security.referrerPolicy` | `Referrer-Policy` | `no-referrer`, `no-referrer-when-downgrade`, `origin`, `origin-when-cross-origin`, `same-origin`, `strict-origin`, `strict-origin-when-cross-origin`, or `unsafe-url` | absent |
| `security.contentSecurityPolicy` | `Content-Security-Policy` | non-empty string, at most 1,783 characters, no control characters | absent |
| `custom` | any other header | array of `{ "name", "value" }`: names are HTTP header names (RFC 7230 tokens) of at most 256 characters, with no case-insensitive duplicates and none of the five security headers above; values are non-empty, at most 1,783 characters, no control characters; at most 10 entries, names and values together at most 10,240 characters | `[]` |

Unknown keys are refused at every level. The limits are CloudFront's: the custom-header count and the Content-Security-Policy length are its default quotas.

Every header **overrides** a header of the same name from the origin, so the configured value is the one viewers receive - including over a header an SSR application sets itself.

**How changes apply.** `bootstrap` reconciles the whole policy: it creates the policy and attaches it to the distribution's cache behaviors, updates it in place when the config changes, and - when the `headers` key is removed, or the block adds no header at all - detaches it and deletes it. None of this needs a new distribution, and no invalidation: CloudFront adds the headers as each response leaves the edge, cached responses included. `deploy` keeps an existing policy's headers in step with the config before it builds, so adding, changing or removing a single header takes effect on the next `deploy` or `bootstrap`; it updates the policy only, never the distribution. Attaching the policy the first time and detaching it after the key is removed change the distribution, so those stay with `bootstrap`: a `deploy` that finds either pending warns and names the command to run. Updating the policy needs `cloudfront:GetResponseHeadersPolicy` and `cloudfront:UpdateResponseHeadersPolicy`, which the [GitHub OIDC deploy role](/guides/ci-github-oidc/#what-the-role-can-do) carries for this policy only.

On a static site, a policy you attached by hand is left alone while `headers` is unset. In SSR mode blogwright reconciles every cache behavior on each `bootstrap`, so a hand-attached policy is replaced by the configured one, or removed when `headers` is unset - configure the headers here instead.

Headers apply to the [preview stack](/guides/pr-previews/) too, from the preview config, at `preview bootstrap`; `preview deploy` never changes them, because one distribution serves every pull request.

## Server rendering (`ssr`)

`object` · optional · no default

`ssr` turns the environment from a static site into a Lambda Web Function deployment: the MicroVM build's output directory is packaged as a `.zip`, stored as a versioned object in the site bucket, and published as an immutable Web Function revision that the site's CloudFront distribution serves as a private origin. The whole contract - packaging, revisions, caching, limits - is in [Server-rendered sites](/guides/server-rendered-sites/).

```jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "ssr": {
    "packageDir": "dist",
    "entryPoint": "server/entry.mjs",
    // Blogwright generates the entry shim: Astro's server reads HOST and PORT.
    "shim": { "host": "HOST", "port": "PORT" },
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg"],
    // Only if cacheable responses vary by token:
    // "cacheKeyHeaders": ["Authorization"],
    // Literal, non-secret values the server reads at runtime:
    "env": { "SITE_URL": "https://example.com" },
  },
}
```

Presence of the key enables the mode. `ssr` and `spa: true` are mutually exclusive, and with `ssr` set, `region` must be one of the Web Function launch regions: `us-east-1`, `us-east-2`, `us-west-2`, `ap-northeast-1`, `eu-west-1`. Preview stacks do not support SSR - `preview bootstrap` and `preview deploy` refuse.

| Field | Validation | Default |
| --- | --- | --- |
| `packageDir` | Repo-relative, non-empty, no `..` segments | `paths.dist` |
| `entryPoint` | Non-empty relative path inside the package, `/` separators, no `..`, no leading `/` | `index.js` |
| `shim` | Object with `port` (required) and `host` (optional): the environment variable names the server reads its listen address from. Each matches `[A-Za-z][A-Za-z0-9_]*`, is not Lambda-reserved, is not also set in `env`, and the two differ. With `shim` set, `entryPoint` cannot be named `blogwright-entry.mjs` | none |
| `staticDir` | Repo-relative, no `..`; must be supplied together with `staticPaths`. Files publish at their path relative to it, so it must mirror the URL layout | none |
| `staticPaths` | Array of CloudFront path patterns, each beginning `/`; must be non-empty when `staticDir` is set, and empty without it | `[]` |
| `cacheKeyHeaders` | HTTP header names (RFC 7230 tokens), no case-insensitive duplicates, at most 10, at most 128 characters each, joined list under 1,024 characters, none CloudFront owns or strips | `[]` |
| `env` | Map of `[A-Za-z][A-Za-z0-9_]*` keys to non-empty strings; literal values only, never secrets; Lambda-reserved names rejected | `{}` |
| `timeoutSeconds` | Integer 3-900 | `30` |
| `maxConcurrencyPerEnvironment` | Integer 1-128 | `64` |

`env` keys Lambda reserves are rejected at config load, naming the key: the `AWS_*` credential, region, session and Lambda-runtime names, plus `AWS_LAMBDA_NODEJS_ENTRYPOINT` (which points at `entryPoint` instead, so the two can never disagree). `cacheKeyHeaders` rejects `Host`, `Accept-Encoding`, the connection-scoped headers CloudFront removes, and any name beginning `lambda-web-`. CloudFront's limits are enforced at load: 10 headers, 128 characters per header name, and a comma-joined name list strictly under 1,024 characters.

With `shim` set, Blogwright generates the entry shim: the package gains `blogwright-entry.mjs` beside `entryPoint`, which copies the host and port from `AWS_LAMBDA_HTTP_ENDPOINT` into the named variables and then imports `entryPoint`, and the revision starts the shim. `entryPoint` is then the framework's own server entry, not a hand-written shim. See [The entry shim](/guides/server-rendered-sites/#the-entry-shim).

Revision-scoped settings (`entryPoint`, `shim`, `env`, `timeoutSeconds`, `maxConcurrencyPerEnvironment`) take effect at the next deploy, which creates a revision whenever any of them changed even if the built output did not. `bootstrap` never cuts one.

### How SSR changes the other settings

- `defaultRootObject` is inert - the distribution's root object is empty, because the application answers `/`.
- `invalidationMaxPaths` applies only to a deploy that publishes `staticDir` changes without a new revision; a new revision invalidates `/*`.
- `seo` is inert - Blogwright writes no `robots.txt` or `sitemap.xml`; the application serves them, or the build puts them in `staticDir` and lists them in `staticPaths`. A `seo` key written in the config document with a non-`off` value warns once per deploy.
- `region` is restricted to the launch regions above.

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

AT Protocol / standard.site publishing. When the section is absent, publishing is entirely inert. `{ "name": "My Blog" }` is enough to enable it - see [Publishing to standard.site](/plugins/standard-site/).

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

Settings for the [analytics plugin](/plugins/analytics/). The block is inert when
the plugin is not installed. After `blogwright plugin add analytics`, an absent
block or `{}` uses these defaults:

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
| `ssr` block | object; unknown keys rejected; field rules in the table above |
| `ssr` + `spa` | mutually exclusive |
| `ssr` + `region` | `region` must be a Web Function launch region |
| `ssr.env` keys | reserved Lambda names rejected |
| `ssr.shim` | `port` required, `host` optional; variable names, not reserved, not in `ssr.env`, distinct |
| `cacheControl` | array of `{ match, value }`; unknown keys rejected; `match` non-empty; `value` a valid `Cache-Control` value |
| `cacheControl[].match` | starts with `/` or `**`; no trailing `/`, empty segment, `.` or `..` segment, percent-encoded character, partial-segment `**`, `[`, `]`, `{`, `}` or `\`; not already matched by an earlier rule, or by an earlier pattern of the same rule |
| `headers` block | object; unknown keys rejected at every level; field rules in the [`headers` table](#response-headers-headers) |
| `headers.security.hsts` | `true`, `false`, or `{ maxAgeSeconds, includeSubdomains, preload }`; `maxAgeSeconds` an integer `0`-`2147483647` |
| `headers.security.frameOptions` | `deny` or `sameorigin` |
| `headers.security.referrerPolicy` | one of CloudFront's eight `Referrer-Policy` values |
| `headers.security.contentSecurityPolicy` | non-empty, ≤ 1,783 characters, no control characters |
| `headers.custom[]` | ≤ 10 entries; RFC 7230 names ≤ 256 characters, no case-insensitive duplicates, not a `headers.security` header; values non-empty, ≤ 1,783 characters, no control characters; names and values together ≤ 10,240 characters |
| `seo.robots` | `auto`, `index`, `noindex`, or `off` |
| `seo.sitemap` | `auto`, `on`, or `off` |
| `sourceInclude[]` | repo-relative, no leading `/`, no `..` |
| `paths.app`, `paths.dist` | non-empty, repo-relative, no `..` |
| `pds.name` | non-blank when `pds` is present |
| `pds.handleResolver` | valid `https:` URL |
| `pds.secretName` | optional; characters `[\w/+=.@-]` only when supplied |

For the resource names derived from `siteName` and the environment, see the [architecture reference](/reference/architecture/). For the flags that interact with config (`--config`, `--env`, `--domain`), see the [CLI reference](/reference/cli/).
