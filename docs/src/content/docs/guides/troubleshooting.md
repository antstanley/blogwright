---
title: Troubleshooting
description: Symptom, cause, and fix for the errors and warnings blogwright actually raises.
sidebar:
  order: 11
---

blogwright errors try to name their own fix. This page collects the ones you are most likely to meet - what triggers each, why, and what to do - grouped by area. Command and flag details live in the [CLI reference](/reference/cli/); every config key is documented in the [configuration reference](/reference/configuration/).

## Configuration

### `no config found for environment "<env>" - looked for …`

The CLI loads `config/<env>.jsonc` from the repo root of your site, falling back to `ops.config.jsonc`. When you pass `--config <path>`, that file becomes the only candidate. The error lists exactly which paths were tried.

Create the missing file - `siteName` is the only key without a default (`region` falls back to `us-east-1`):

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example" // stable slug in every AWS resource name - never change it
}
```

The environment defaults to `production`, so a bare `blogwright deploy` looks for `config/production.jsonc`. If you meant a different environment, pass it positionally or with `--env`. See [Configuration files](/guides/configuration-files/#which-file-is-loaded).

### `could not find the repo root (no .git or .jj above <dir>)`

blogwright finds the repo root by walking up from the invocation directory to the nearest `.git` or `.jj`, so it works from any subdirectory - but only inside a version-controlled repo. Run it from within your site's repository (or initialize one).

### `config.siteName is required - a stable lowercase slug used in every derived AWS resource name`

Every AWS resource name is derived from `siteName`, so there is no default. Add it to your config and never change it afterwards - a changed `siteName` derives a whole new set of resources.

### Config validation errors

Config is parsed as JSONC (comments and trailing commas are fine), merged over defaults, then validated. Each check throws with the offending key in the message:

- `config.siteName must be lowercase alphanumeric/dashes` - same character rule as environment names.
- `config.region is required` - it defaults to `us-east-1`, so this only fires if you set it to an empty string.
- `config.microvm.memory must be one of 0.5, 1, 2, 4, 8 GB` and `config.microvm.maxDurationSeconds must be in 1..28800` - the builder MicroVM's valid sizing envelope.
- `config retention days must be positive` - both CloudWatch retention values (`retention.microvmDays`, `retention.cloudfrontDays`) must be at least 1.
- `config.seo.robots must be one of auto, index, noindex, off` and `config.seo.sitemap must be one of auto, on, off`.
- `config.sourceInclude entries must be repo-relative without ".."` and `config.paths.<app|dist> must be repo-relative without ".."` - everything zipped or built is addressed relative to the repo root; absolute or escaping paths are rejected.
- `config.pds.name is required`, `config.pds.handleResolver must be a URL` (and `https`), `config.pds.secretName has invalid characters` - only when a `pds` section is present.

Fix the named key; the [configuration reference](/reference/configuration/) documents each one with its default.

### `environment must be lowercase alphanumeric/dashes, got "<env>"`

Environment names feed directly into AWS resource names, so they share the same slug rule as `siteName`. Rename the environment (e.g. `staging`, not `Staging`).

### `derived bucket name "<bucket>" exceeds S3's 63-char limit; shorten env or siteName`

The per-environment bucket is named `<env>-<siteName>-<accountId>`. With a 12-digit account id, that leaves about 50 characters for the env and site name together. Shorten one of them.

### `init is an interactive wizard; in CI or plain mode create config/production.jsonc by hand instead`

`blogwright init` asks questions, so it needs a TTY - it refuses under `--plain`, in CI, or with piped output. Write the config by hand instead; `region` and `siteName` are all it needs:

```sh
echo '{ "region": "us-east-1", "siteName": "example" }' > config/production.jsonc
```

### `<path>/config/production.jsonc already exists - edit it directly, or pass --config elsewhere`

`init` never overwrites an existing config. Edit the file directly - or if you genuinely want a second config, write it by hand and select it with `--config`.

## Bootstrap and teardown

### `certificate not ISSUED (status=…); re-run bootstrap once DNS propagates`

Bootstrapping with a custom domain requests an ACM certificate that must be validated via DNS. blogwright prints the records to add at your registrar (`Add these DNS records at your registrar to validate the certificate:`) and waits up to 30 minutes for the certificate to reach `ISSUED`. If validation hasn't completed in that window, the command fails - add the records, wait for DNS to propagate, and re-run `blogwright bootstrap`. It picks up where it left off. See [Custom domains](/guides/custom-domains/).

For the preview stack the domain must be a Route53 hosted zone, so validation records are created for you and this error usually means DNS was still propagating - just re-run.

### `CNAMEAlreadyExists` on a bootstrap re-run

A bootstrap that failed partway can leave a CloudFront distribution in your
account that state never recorded; re-running then trips CloudFront's duplicate-alias
check (`One or more of the CNAMEs you provided are already associated with a
different resource`) before its idempotency match applies. blogwright recovers from
this automatically: it looks for a distribution whose comment matches this
environment and whose immutable CallerReference proves it was created by an earlier
run of the same bootstrap, adopts it into state (`adopted existing distribution
<id>`), and continues.

If the error still surfaces, no adoptable match was found - the alias genuinely
belongs to another distribution (possibly in another AWS account). Find who owns it
and remove the alias there, or change `domain`. If the message is preceded by an
`adoption lookup failed` warning, the recovery itself couldn't run (usually missing
`cloudfront:ListDistributions` permission) - fix that and re-run.

More generally, an interrupted bootstrap is safe to re-run: state is persisted even
when a step fails, so completed resources are found and reconciled rather than
re-created.

### `refusing to destroy "<env>" without --yes`

Destructive operations require explicit confirmation via the `--yes` flag - there is no interactive prompt to fumble in CI. The same guard protects the other irreversible commands:

- `blogwright destroy <env> --yes` - tears down all infrastructure for an environment.
- `blogwright preview teardown --yes` - `refusing to tear down the preview stack without --yes`.
- `blogwright pds secret delete --yes` - `refusing to delete secret "<name>" without --yes` (immediate, no recovery window).

### `<n> MicroVM(s) did not terminate in time; re-run destroy once they clear`

A running builder MicroVM pins the builder image, and deleting a pinned image fails. `destroy` and `preview teardown` therefore list active builder VMs first (`<n> builder MicroVM(s) must be terminated before the image can be deleted:`), offer to terminate them (default yes; non-interactive runs terminate automatically), and wait up to three minutes for them to clear. If they don't clear in time, wait a moment and re-run the destroy - it is safe to repeat.

## Deploy and rollback

### `infrastructure not bootstrapped (missing MicroVM image or exec role); run bootstrap first`

`deploy` (and `rollback`) runs the builder MicroVM recorded in the environment's state. If the state has no builder image or execution role, the environment was never bootstrapped - or was destroyed. Run `blogwright bootstrap` for that environment first. See the [Quickstart](/getting-started/quickstart/).

### `sourceInclude path "<entry>" is missing or empty - run the pre-deploy build that produces it before deploying`

`sourceInclude` entries are gitignored paths zipped into the deploy source anyway - artifacts a pre-deploy step builds outside the MicroVM (a wasm bundle, generated assets). Each entry must exist and be non-empty at deploy time; a forgotten pre-build fails fast here instead of shipping a broken site. Run the step that produces the artifact, then deploy again. See [Monorepos](/guides/monorepos/#ship-pre-built-artifacts).

### `build failed for <hash>: <message>`

The build inside the MicroVM failed - typically a `pnpm install` or `pnpm build` error in your site. The deploy streams the build log as it runs; to see it again afterwards:

```sh
blogwright logs <hash>
```

`blogwright history` lists past deployments with their hashes and statuses. A `build timed out` message means the build exceeded `microvm.maxDurationSeconds` (default 1800) - raise it in config if your build legitimately needs longer.

### `MicroVM launch returned HTTP <code> - retrying in <n>s (a just-updated builder image can lag)`

A warning, not a failure. Right after the builder image is updated (for instance on the first deploy after a blogwright upgrade), the MicroVM control plane can answer 502/503/504 for a short window. The launch retries with backoff over roughly two minutes and is idempotent, so no action is needed unless the retries are exhausted.

### `no build artifact at build/<hash>.zip; cannot roll back to <hash>`

`rollback` re-runs the builder against the source zip a previous deploy uploaded to `build/<hash>.zip`. If no deploy ever uploaded that hash - a typo, or a hash from a different environment - there is nothing to roll back to. Find a valid hash first:

```sh
blogwright history
blogwright rollback <hash>
```

:::note
On production with a `pds` section configured, rollback warns: `rollback does not sync the PDS (records mirror the current repo content)`. The PDS mirrors your working tree, which a rollback does not restore - check out the rolled-back revision and run `blogwright pds sync` if the records should match.
:::

### A metadata fix never reached the live site

A deploy only re-uploads files whose content changed (built file MD5 vs. live object ETag). S3 writes object metadata - content type, object tags - on the PUT, so a metadata-only fix (an upgrade that corrects a content type, or newly added tags) never reaches an unchanged object. Pass `--refresh` once to re-upload every file:

```sh
blogwright deploy --refresh
```

`rollback` and `preview deploy` accept `--refresh` too.

### The whole cache was invalidated (`/*`)

Two log lines explain a full invalidation instead of the usual per-path one:

- `<n> paths changed (> cap) - invalidating everything (/*)` - more paths changed than `invalidationMaxPaths` (default 1000). One `/*` invalidation is cheaper than thousands of path invalidations; raise the cap in config if you'd rather keep per-path behavior.
- `no changed-paths manifest - invalidating everything (/*)` - a warning: the build's changed-paths manifest could not be read, so the deploy invalidates everything to stay correct. Harmless for the site; if it recurs, check the build logs.

An identical redeploy logs `no content changed - skipping CloudFront invalidation` and invalidates nothing.

## Server-rendered sites (SSR)

### `this caller may not invoke the Web Function endpoint: it answered HTTP 403 without an application error …`

The mandatory preflight runs before anything is built or published. Lambda omits the `lambda-web-error-type` header when the caller is not authorized to invoke the endpoint at all, so a `403` without it means `lambda:InvokeWebFunctionEndpoint` is missing on your principal - not that the application answered `403`. The GitHub OIDC deploy role carries the action; a local operator's credentials need it too. Nothing was built or published.

### `Web Function revision <id> failed (<errors>)`

The revision settled `Failed`, so Lambda never routed traffic to it - the previous revision keeps serving. The errors come from `GetWebFunctionRevision` and usually name the cause directly: a missing or unreadable entry point, a package Lambda could not load, a role it could not assume. The application's own output, if it got as far as starting, is in the Web Function log group; `blogwright logs <hash>` shows the MicroVM build that produced the package, which is where a missing entry file or an incomplete package shows up. Rebuild after fixing:

```sh
aws logs tail /<siteName>/<env>/web --since 1h   # the server's stdout and stderr
blogwright logs <hash>                            # the build that packaged it
blogwright deploy
```

### `the endpoint is NOT serving`

A revision became `Active` but never answered below `500`, and nothing that would serve was put back in front of it. The endpoint has already cut over, so this is the one case where the site is genuinely down. It happens two ways:

- **A new revision did not serve, and neither did the restore** of the previous one.
- **A deploy finished an interrupted publish.** An earlier deploy created the revision now serving and stopped before verifying it (the CLI was killed, the network dropped). The next deploy of the same build finds that revision serving with its publish never finished, probes it rather than calling it unchanged - and it does not answer. The revision it replaced was never captured, so there is nothing to restore.

```sh
blogwright history <env>
blogwright rollback <hash> <env>
```

Use the newest hash with a revision id in `history`'s `revision` column - `rollback` recreates that revision from its retained artifact and settings without a rebuild. The failure message names that hash when one exists. Read `/<siteName>/<env>/web` for why the failing revision did not answer.

### `SSR package contains a symbolic link at <path>`

Lambda loads nothing that is not in the archive, and pnpm's default `node_modules` is a symlink tree - so the package is not self-contained. Make your build copy production dependencies into the package as real files (or bundle the server), rather than shipping a package that merely sits beside the build's `node_modules`. For Next.js standalone output, set `nodeLinker: hoisted` in `pnpm-workspace.yaml`: Next copies pnpm's symlinks into the package as it finds them. See [Server-rendered sites](/guides/server-rendered-sites/).

### `SSR package entry point "<entry>" does not exist under <dir>`

The build did not emit `ssr.entryPoint` inside `ssr.packageDir`. Check both: the framework's output directory (`dist` for Astro, `build`, `.output/server`, `.next/standalone`) and the shim your build writes inside it. If the shim is emitted by a postbuild step, make sure that step runs before the agent packages the output.

### `SSR package is <n> MB unzipped, over Lambda's 512 MB limit`

The packaged server output exceeds the deployment-package limit. Keep build output and caches out of `packageDir`, or split static assets into `staticDir` so only the server is packaged.

### `Could not find the server directory "server"` (Astro)

`@astrojs/node` finds its own files by walking up from `entry.mjs` to a directory named `server`. With `ssr.packageDir` set to `dist/server` the entry sits at the archive root and the walk finds nothing, so the server exits before it listens. Package all of `dist` with `"entryPoint": "server/lambda.mjs"` - see the [Astro recipe](/guides/server-rendered-sites/#astro-node-standalone).

### The SSR server never starts listening

`GET` on the endpoint returns `502`/`504`, or the readiness probe times out, when the server does not begin listening within 10 seconds of process start on the host and port in `AWS_LAMBDA_HTTP_ENDPOINT`. Check the entry shim: frameworks that read `HOST`/`PORT`, `NITRO_HOST`/`NITRO_PORT` or `HOSTNAME`/`PORT` need the mapping before the built entry is imported. Run the package locally the way Lambda does to see it fail fast (see [Running the package locally](/guides/server-rendered-sites/#running-the-package-locally)). The Web Function's logs are in `/<siteName>/<env>/web` (with the in-Region companion `/<siteName>/<env>/web.local`), retention from `retention.webFunctionDays`:

```sh
aws logs tail /<siteName>/<env>/web --follow
```

### One viewer's cached response is served to another

The viewer's `Authorization` header always reaches the application - CloudFront does not strip it, because the origin-request policy forwards it - but it is not part of the cache key unless you list it. A response the application marks cacheable for an authenticated request is then served to the next viewer of the same URL, whatever their token. Either mark authenticated responses `private` or `no-store`, or key the cache on the header:

```jsonc
{ "ssr": { "cacheKeyHeaders": ["Authorization"] } }
```

That gives each token its own cache entry. Cookies reach the application without being listed too, and never vary the cache (they are forwarded but excluded from the key), so cookie-authenticated responses must be `private` or `no-store`.

### Form posts fail with `403`, or links point at `*.on.aws`

The application receives the Web Function endpoint's domain (`<id>.lambda-web.<region>.on.aws`) as `Host`, not your site's domain: CloudFront forwards every viewer header except `Host`, which it sets to the origin's domain as the endpoint requires. A framework that derives its URL from `Host` then builds absolute links and redirects on the endpoint domain, and its cross-site request check rejects the browser's form posts, whose `Origin` is your site. Tell the application its public origin - see [The public origin](/guides/server-rendered-sites/#the-public-origin).

### `504` on a slow route

CloudFront gives the Web Function origin 60 seconds to first byte. A response whose first byte takes longer than that is a `504` whatever `ssr.timeoutSeconds` says; values above 60 help only a response that keeps streaming.

### A static path returns `403` instead of the application's `404`

Requests matching `ssr.staticPaths` are served from S3, not the application, and error responses are distribution-wide - so the SSR behavior has no custom error responses and a static pattern with no object in `site/` returns S3's `403`. Keep `staticPaths` to prefixes your build always publishes, or let the application serve the path.

### `refusing to delete site/ for "<env>"`

`blogwright delete` refuses in SSR mode: the application renders every page the revision serves, and emptying `site/` cannot unpublish a revision. Deploy a new revision, roll back, or switch the stack back to static serving with `blogwright bootstrap <env> --switch-mode` and deploy before deleting.

### `refusing to switch "<env>" from <mode> to <mode> serving`

`bootstrap` refuses a mode change on a bootstrapped stack because the distribution's default behavior moves before a deploy in the new mode exists: static → SSR answers `503` from the placeholder until the first SSR deploy completes, and SSR → static serves whatever `site/` holds until the next static deploy. Re-run with `--switch-mode` when that window is acceptable; nothing was applied. Removing `ssr` from the config and re-bootstrapping leaves the Web Function's resources in place, because the graph is derived from config - see [Switching modes](/guides/deploying/#switching-modes).

### `"<env>" is configured for <mode> serving but its distribution serves <mode>`

`deploy` and `rollback` refuse while the config and the stack disagree about the serving mode - the state between adding or removing the `ssr` block and re-bootstrapping. An SSR deploy in that gap publishes a revision the distribution does not route to, and a static deploy deletes the `site/` assets the live revision still references. Run `blogwright bootstrap <env> --switch-mode` first; nothing was built or published.

### `the preview stack does not support SSR`

The shared preview stack is a host-routed distribution over per-PR S3 prefixes; an SSR preview needs its own endpoint, which is a separate design. `preview bootstrap` and `preview deploy` refuse when the config sets `ssr`. Preview a static branch, or drop the block from the preview config.

## Previews

### `preview bootstrap requires a domain (e.g. preview.example.com)`

The shared preview stack serves every PR at `https://<id>.<preview-domain>`, so it cannot exist without a domain. Pass one with `--domain` (or set `domain` in config). The preview domain must be a Route53 hosted zone - the wildcard certificate and DNS records are created automatically. See [PR previews](/guides/pr-previews/).

### `preview id must be lowercase alphanumeric/dashes (e.g. pr-42), got "<id>"`

The preview id becomes a DNS label (`<id>.<preview-domain>`) and an S3 prefix, so it must be lowercase letters, digits, and dashes. `preview deploy` and `preview destroy` also fail when the id is missing entirely (`preview deploy requires an <id> (e.g. pr-42)`, `preview destroy requires an <id>`) - pass it positionally or with `--id`.

### `no Route53 hosted zone found for <domain>`

The preview stack creates its wildcard-certificate validation records and the `*.<domain>` alias in Route53 automatically, which requires the preview domain to be a hosted zone in the same AWS account. Create the hosted zone (and delegate the domain to it) before running `preview bootstrap`.

## standard.site publishing (pds)

The `pds` commands have a strict setup order - keygen, release, login, init, sync - and each error points at the step that was skipped. The full walkthrough is in [Publishing to standard.site](/plugins/standard-site/).

### `config has no "pds" section - add it to config/production.jsonc`

Every `pds` command requires a `pds` section in config; publishing is inert without one. The minimum is a display name:

```jsonc
{
  "pds": { "name": "My Blog" }
}
```

The Secrets Manager secret name defaults to `<siteName>/atproto`.

### `pds keygen requires a configured domain`

`keygen`, `login`, `init`, and `sync` all require a domain (`pds OAuth requires a configured domain`, `pds sync requires a configured domain`, and so on) - the site itself is the OAuth client, and its client id is a URL on your domain. Set `domain` in config or pass `--domain`.

### `no secret at "<name>" - create it with 'blogwright pds keygen'`

No Secrets Manager secret exists yet (or it exists but `secret "<name>" has no OAuth client key`). Run `blogwright pds keygen` - it stores the private key in the secret and writes the two public client documents under `public/oauth/`.

### `https://<domain>/oauth/client-metadata.json is not deployed (HTTP <status>) - commit public/oauth/* and release first`

`login` and `init` first verify that the deployed `/oauth/` documents match what the CLI would send the authorization server - a stale or missing deployment would otherwise fail deep inside the OAuth flow. After `pds keygen`, you must commit `public/oauth/*` and deploy before logging in. The sibling error, `… does not match the local client configuration`, means the deployed documents are stale: re-run `blogwright pds keygen`, commit, and release before logging in.

### `secret "<name>" has no OAuth session - run 'blogwright pds login'`

The key exists but no one has logged in yet (keygen also clears any previous session, since client auth is bound to the key). Run the interactive bootstrap:

```sh
blogwright pds login --identifier <handle-or-did>
```

It prints an authorize URL; approve in a browser, then paste the full `/oauth/callback` URL back - query string and all (`that was not a URL - paste the full callback address, query string and all` means the pasted text didn't parse as one).

### `the stored OAuth session is no longer valid (refresh tokens expire after 180 idle days, and rotation races invalidate them) - re-run 'blogwright pds login'`

Refresh tokens are single-use and rotated on every sync; a session lapses if nothing syncs for 180 days, or if a rotation race invalidated the stored token. Re-run `blogwright pds login` to establish a fresh session - nothing else is lost.

:::note
When this happens during the automatic post-deploy sync, the deploy itself is unaffected: you see `pds sync failed (deploy unaffected): …` as a warning, and the next deploy after you log in re-reconciles everything.
:::

### `pds sync publishes canonical production URLs and refuses to run for "<env>"`

`pds sync` writes records containing your production URLs, so it only runs for the `production` environment - it also runs automatically after every successful production deploy. Don't pass a non-production env to it.

### `src/data/atproto.json is not initialised - run 'blogwright pds init' first`

Sync needs the committed site files that `pds init` writes: `src/data/atproto.json` (by default) and `public/.well-known/site.standard.publication`. A related error - `… does not match … - re-run 'blogwright pds init'` - means the two files disagree about the publication URI; re-running `pds init` rewrites them consistently. If instead the message is `session DID <did> does not match <atprotoJson> DID <did>`, you are logged in with a different account than the one that owns the publication.

### `secret "<name>" holds app-password credentials - app passwords are no longer supported; run 'blogwright pds keygen' then 'blogwright pds login'`

The secret still holds the pre-OAuth `{ identifier, password }` shape. `pds keygen` is the migration entry point: it replaces the legacy value with the OAuth client key, and `pds login` establishes the session.

### `<n> PDS record(s) have no local post (rkeys: …) - not deleted; remove them manually if intended`

A warning after sync: records exist on the PDS with no matching local post - usually posts you deleted or whose slugs changed. Sync never deletes records; remove the orphans manually (with a PDS client) if that is what you intended. Post slugs must not change after publication - the rkey is derived from the URL (see the [rkey reference](/reference/rkey/)).
