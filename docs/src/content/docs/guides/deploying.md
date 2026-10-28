---
title: Deploying
description: What happens between `blogwright deploy` and your changes going live, step by step.
sidebar:
  order: 1
---

`blogwright deploy` takes your repository from working tree to live site: it zips the source, builds it inside a Lambda MicroVM, syncs only the changed files to S3, and invalidates only the changed CloudFront paths. This page walks the whole lifecycle so you know exactly what each step does - and what it deliberately skips.

```sh
blogwright deploy            # deploy to production (the default environment)
blogwright deploy staging    # or any other environment
bw deploy                    # `bw` is an alias for `blogwright`
```

The environment defaults to `production`; see [Environments](/guides/environments/) for running several stacks side by side.

## The lifecycle at a glance

1. Find the repo root, resolve the current revision hash, and zip the deployable files. When [`headers`](/reference/configuration/#response-headers-headers) is configured, first bring the response headers policy's headers in step with the config (the policy only, never the distribution). If the policy still needs `bootstrap` - it is not created or attached yet, or `headers` was removed - the deploy warns instead.
2. Upload the zip to `build/<hash>.zip` in the environment's S3 bucket.
3. Reconcile the builder MicroVM image if the build-agent bundle changed (no-op otherwise).
4. Launch a builder MicroVM that pulls the zip, runs `pnpm install && pnpm build`, and syncs the output to `site/`, comparing each file's MD5 to the live object's ETag and writing each upload's `Cache-Control` from the `cacheControl` rules.
5. Record the build's [artifact manifest](/reference/artifact-manifest/) - every published path, byte count and SHA-256 - at `build/artifacts/<hash>/<buildId>.json`, and keep the first one recorded for the revision, write-once, at `build/artifacts/<hash>.json`.
6. Invalidate only the CloudFront paths that actually changed.
7. On a successful production deploy, sync standard.site records to your PDS (when configured).
8. Print a deploy summary card.

## Packaging the source

The CLI finds the repo root by walking up from wherever you invoke it to the nearest `.git` or `.jj`, so `blogwright deploy` works from any subdirectory.

The revision hash names the build. With jj, it is the working copy's commit id (jj auto-commits the working copy); without jj, it falls back to `git rev-parse --short HEAD`. The hash becomes the zip's name (`build/<hash>.zip`), the key for build logs and manifests, and the argument you later pass to `blogwright logs` or `blogwright rollback`.

### Which files ship

The file listing honors `.gitignore`: tracked files plus untracked files that are not ignored (`git ls-files --cached --others --exclude-standard`). Two config knobs adjust it:

- **`sourceIgnore`** - extra prefixes to drop. Defaults to `.jj/`, `.git/`, `node_modules/`, `dist/`, `.astro/`. An entry matches an exact path or a directory boundary: `"dist"` drops `dist` and everything under it, but never `dist-notes.md`.
- **`sourceInclude`** - gitignored paths to zip anyway, for artifacts a pre-deploy step builds outside the MicroVM (a wasm bundle, generated data). Run the producing step before deploying - a missing or empty `sourceInclude` entry fails the deploy with a pointer to it, because shipping without the artifacts would deploy a broken site.

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "sourceIgnore": ["fixtures/"],
  "sourceInclude": ["public/wasm"],
}
```

Tracked files that are deleted on disk are skipped rather than failing the zip. The zip itself is deterministic (fixed timestamps), and one extra file is injected in memory: `.commit-hash`, carrying the revision hash. The build runs from this zip with no `.git` present, so your site's build config can read the deployed revision from that file instead.

See [Configuration](/reference/configuration/) for the full key reference and [Monorepos](/guides/monorepos/#ship-pre-built-artifacts) for `sourceInclude` in practice.

## The builder image check

Before launching the build, the deploy reconciles the builder MicroVM image: if the build-agent bundle shipped with your installed CLI version differs from the one baked into the image (compared by hash), the image is updated first. This means build-agent fixes from a blogwright upgrade land on the very next deploy, and when nothing changed the check is a no-op.

Right after an image update, the MicroVM control plane can briefly answer 502 for launches. The CLI retries gateway errors (502/503/504) with a bounded backoff of about two minutes; the launch is idempotent, so retrying is safe.

## Building in the MicroVM

The CLI launches a builder MicroVM from the snapshotted image, then writes a pending-job file to S3 describing the build: the source key, the target site prefix, the build directories (`paths.app` / `paths.dist`), object tags, the `cacheControl` rules, and the SEO policy. The agent inside the VM (booting in roughly 30 seconds) polls for this job, then:

1. Downloads and extracts `build/<hash>.zip` into a work directory.
2. Runs `pnpm install --frozen-lockfile --prod=false` and `pnpm run build` in `paths.app` (the repo root by default). Dev dependencies are installed deliberately - static-site build tooling (astro, vite, tailwind) lives there.
3. Writes `robots.txt` and `sitemap.xml` into the output directory per the environment's SEO policy, so they publish and invalidate like any other page.
4. Syncs the output directory (`paths.dist`, default `dist/`) to the site prefix in S3.

Build output streams live to your terminal as it lands in CloudWatch. The CLI decides the outcome from hash-scoped markers in the log stream, so output from an unrelated build can never be mistaken for yours. The build is bounded by `microvm.maxDurationSeconds` (default 1800); the VM is terminated when the build finishes and self-terminates at that limit regardless.

Every build - success or failure - records a manifest at `build/manifests/<hash>.json` with the status, timestamps, duration, and MicroVM id. `blogwright history` reads these; see [Operations](/guides/operations/).

A successful static build also records an [artifact manifest](/reference/artifact-manifest/): every file it published, with its byte count and lowercase SHA-256, one aggregate release hash over all of them, and a release identity string (`<version>+<hash>.<releaseHash prefix>`, the version taken from your app's `package.json`). Each build records its own at `build/artifacts/<hash>/<buildId>.json`; the first one a deploy records for a revision is also kept, never to be replaced, as its original at `build/artifacts/<hash>.json`. Deploying the same hash again leaves the original as it was, and warns if the new build is not byte-identical to it. The deploy prints the release and the manifest's location so CI can archive it. A stack bootstrapped before artifact manifests existed cannot write it yet - the deploy warns until `blogwright bootstrap <env>` grants the builder `build/artifacts/*/*`.

## Syncing only what changed

The agent does not blindly upload the build output. For each built file it computes the MD5 and compares it to the live object's S3 ETag under `site/`; only files whose content actually changed are uploaded. Each upload carries the `Cache-Control` of the first `cacheControl` rule matching the file's URL path - see [Caching and Cache-Control](/guides/caching/). New files upload, unchanged files are skipped entirely, and stale objects (files no longer in the build) are deleted - but only after the new files are published, so the live site never has an empty or partial window.

The set of changed URL paths (each changed key mapped to the path a viewer would request) is written to `build/changed/<hash>.json`, which drives the next step.

## Cache invalidation

The CLI reads the changed-paths manifest and invalidates accordingly:

- **Nothing changed** - no invalidation at all. An identical redeploy uploads nothing and invalidates nothing.
- **Up to `invalidationMaxPaths` changed** (default 1000) - only those URL paths are invalidated, so unchanged pages stay cached at the edge. Directory index documents invalidate both forms a viewer might request: `site/posts/index.html` becomes `/posts/index.html` and `/posts/`.
- **Over the cap, or the manifest is missing** - a single `/*` invalidation.

Tune the threshold with the `invalidationMaxPaths` config key; see [Configuration](/reference/configuration/).

## How URLs map to files

A CloudFront function resolves every URL without a file extension to a directory index: `/about` and `/about/` both fetch `about/index.html`. It never tries `about.html`.

- **Astro** already writes `about/index.html` by default.
- **SvelteKit's `adapter-static`** writes `about.html` unless pages set `trailingSlash`. Without this, every prerendered page other than `/` answers `404`:

  ```js
  // src/routes/+layout.js
  export const prerender = true;
  export const trailingSlash = 'always'; // writes /about as about/index.html
  ```

A path with no file behind it gets your `/404.html` with status `404` - so make sure your build writes one. With SvelteKit, give `adapter-static` `fallback: '404.html'`. Single-page apps answer these paths with `index.html` instead; see [Single-page apps](/guides/single-page-apps/). Complete projects: [SvelteKit SSG](/examples/sveltekit-ssg/), [Astro static](/examples/astro-static/).

## robots.txt and sitemap.xml

The builder writes `robots.txt` and `sitemap.xml` into your output before uploading, so they publish and invalidate like any other page. The `seo` config decides what goes in them, with defaults that depend on the environment:

| Setting | Default | What it does |
| --- | --- | --- |
| `seo.robots` | `"auto"` | `auto` makes production indexable and blocks crawlers everywhere else. `index` or `noindex` force either. `off` keeps whatever `robots.txt` your build wrote. `seo.robotsContent` replaces the body verbatim. |
| `seo.sitemap` | `"auto"` | `auto` writes `sitemap.xml` in production only. `on` or `off` force it. It needs a site origin: your custom domain, or the CloudFront domain. |

The sitemap lists the HTML pages in your build output: directory index documents map to their clean URL, and `404.html` pages are left out. A prerendered site gets one entry per page; a single-page app that writes one `index.html` gets one entry.

## Metadata fixes: `--refresh`

S3 writes object metadata - the content type, object tags and `Cache-Control` - only on the PUT. Because the sync skips unchanged content, a metadata fix (an upgrade that corrects a content type, or newly added tags) never reaches an object whose bytes did not change. Pass `--refresh` once after such an upgrade to re-upload every file:

```sh
blogwright deploy --refresh
```

`--refresh` is also accepted by `rollback`, `preview deploy` and `stage`; on [`promote`](#release-gating-stage-verify-promote) it copies every staged file.

You do not need it for `Cache-Control`: each build records the `cacheControl` rules the builder confirms it applied, and a build whose rules differ from the target's record, or whose last rule change did not finish, refreshes on its own and says so (`an implicit --refresh`). That includes the first deploy after upgrading to a version with `cacheControl`, which retrofits the default headers once. See [Caching and Cache-Control](/guides/caching/#when-the-rules-change).

:::note
`--refresh` re-uploads every file, so every path counts as changed - the invalidation covers the whole site (falling back to `/*` past the cap) instead of the usual minimal set.
:::

## The deploy summary

On a TTY, a successful deploy ends with a summary card: the revision, environment, source size (file count and KiB), build duration, the release identity and hash from the artifact manifest (static environments), what was invalidated ("nothing changed - skipped", "12 changed paths", or "everything (/*)"), and the site URL. Piped output and CI get the same information as stable line-oriented text.

## Build logs

Everything the build printed - pnpm, the site build, the sync - lands in a CloudWatch log group (retention configurable via `retention.microvmDays`, default 365 days). Retrieve a build's logs by its hash:

```sh
blogwright logs <hash>
```

The command uses the hash's newest build record - its deployment manifest, or its staged build's record when that is newer - to window the log query to that build's time span (plus a minute either side). If the manifest is unreadable it falls back to the unfiltered window. See [Troubleshooting](/guides/troubleshooting/) for reading a failed build's output.

## standard.site sync after deploy

When the config has a `pds` section and publishing has been initialised, every successful **production** deploy also re-reconciles the site's standard.site records on your PDS. The sync is non-fatal by design: if it fails (an expired session, a network blip), the deploy still succeeds with a warning, and the next deploy heals the records. Non-production environments never sync.

Rollbacks are the exception - a rollback restores the deployed site but not your working tree, and the PDS mirrors repo content, so `blogwright rollback` only warns about the divergence instead of syncing. See [Publishing to standard.site](/plugins/standard-site/).

## Release gating: stage, verify, promote

`deploy` builds and publishes in one step. When a release has to be checked before it goes live - and what goes live has to be exactly what was checked - split it in two:

```sh
blogwright stage production            # build once; publish to releases/<hash>/, not to site/
blogwright verify <hash> production --staged   # check the staged bytes against the staged release record
blogwright promote <hash> production   # copy those bytes into site/ - no rebuild
```

**`stage`** runs the same build as `deploy` - the same source zip, builder MicroVM, `robots.txt` and `sitemap.xml` for the target environment - but the builder publishes the output to `releases/<hash>/` instead of `site/`, and records its own [artifact manifest](/reference/artifact-manifest/). Nothing serves `releases/`: the distribution's origin is `site/`, and the bucket is private, so a staged release is not reachable from the domain or the CloudFront hostname. Nothing is invalidated. `stage` then reads every staged object back, checks it against that manifest, and only then records the manifest as the staged release (`build/releases/<hash>.json`) - the record `promote` checks against. It prints the release identity, its release hash and the `promote` command to run. `stage --refresh` re-uploads every file into the staged prefix, for a metadata fix on a hash that was already staged.

A staged release is bound to the build that staged it, not to the revision's original manifest. If the revision has no original yet, the staged manifest becomes it, so `verify <hash>` after the promotion checks the same record. If the revision already has an original from another build with other bytes - it was deployed before, or staged before and the build is not reproducible - `stage` and `promote` say so: the promotion is still checked against the staged release, but `verify <hash>` checks the original and reports the differences. See [Staging and promotion](/reference/artifact-manifest/#staging-and-promotion).

**`promote <hash>`** points production at that already-built output:

1. It reads the staged release record and re-verifies the staged objects against it - every object read and its SHA-256 compared - and refuses, copying nothing, if any differs or the hash was never staged.
2. It converges the response headers policy from the [`headers` config](/reference/configuration/#response-headers-headers), as `deploy` does, so a header change reaches production with the release.
3. It copies each file whose live ETag differs from the staged one into `site/` with a server-side S3 copy - or every file, in the cases below. A copy moves the staged object's bytes, content type, `Cache-Control` and object tags exactly as they are; nothing is rebuilt, re-encoded or re-uploaded from your machine. A file whose content is unchanged is not copied, so it keeps the content type and tags it already had in `site/`: after an upgrade that fixes a content type, or once tags can be copied, run `promote --refresh` (and `stage --refresh` first, if the staged copy needs the fix too).
4. It deletes the objects in `site/` that the release does not contain, only after every copy has succeeded.
5. It invalidates the changed paths under the same rules as a deploy: the copied and deleted paths (each directory index also as its directory URL), or `/*` past `invalidationMaxPaths`. When it copied every file, every path counts as changed. Only when the live site already held the release and nothing had to be copied for its headers is nothing invalidated.
6. It verifies `site/` against the staged release record: every live object is read and hashed. The command succeeds only when the live release hash equals the staged one - the promoted bytes are the staged bytes.
7. It records the release as live (`build/live-release.json`) and prints the release it replaced beside the one it published.

The copies run eight at a time, in no particular order, so while they run a visitor whose request misses the cache can get a new page whose new assets are not copied yet, or an old page beside a new asset - the same window a deploy's upload has. Because stale objects are deleted only after every copy, no page that is still live loses an asset it references. If `promote` stops partway, `site/` holds part of each release: the live-release record says a promote of `<hash>` did not finish (naming the last release that did), and running `promote` again finishes the job.

`promote` copies every file, not only the changed ones, when you pass `--refresh`, or when the staged release's `Cache-Control` rules are not known to match the ones `site/` was written with (see below).

The post-deploy plugin steps (the standard.site sync, for one) run after a promote only when the working copy is the promoted revision, because they publish the working copy's content; otherwise the command warns and skips them.

**Cache-Control on promote.** A staged release's files carry the `Cache-Control` the [`cacheControl` rules](/reference/configuration/#cache-control-cachecontrol) gave them when it was staged, recorded at `build/cache-control/release-<hash>.json`. A server-side copy keeps that header, so the headers are promoted along with the bytes, as part of what was reviewed. A file whose content is unchanged would keep the header `site/` already had, so when the staged rules are not known to match the ones `site/` was written with - they differ, `site/`'s record is unconfirmed, the staged record is missing or unconfirmed, or `site/` has no record while the staged rules are not empty - `promote` copies every file instead, after marking `site/`'s record unconfirmed so an interrupted promotion is re-applied. Afterwards `site/`'s record (`build/cache-control/site.json`) holds the staged rules. If the configured rules changed after staging, `promote` warns and still publishes the staged headers - stage again to apply the current rules - and the next `deploy` re-uploads every file with the current rules, as it does after any rules change.

`stage` and `promote` hold the [environment lock](/guides/operations/#one-command-at-a-time-the-environment-lock) while they run, like `deploy`, `rollback` and `delete`, so none of them can interleave its writes with another.

### What it does not cover

- **Reviewing a staged release in a browser.** A staged release is deliberately not served. Review rendered pages through [PR previews](/guides/pr-previews/) or a separate environment; `stage` and `promote` guarantee that what goes live is byte-identical to the staged build, not that a person looked at it.
- **Promoting between environments.** A release is staged in the environment it will be promoted into, so its `robots.txt` and `sitemap.xml` are that environment's. Staging in `staging` and promoting to `production` is not supported: the two would differ in exactly those files.
- **SSR environments and the preview stack.** Both commands refuse there. An SSR deploy already pins the exact artifact version a revision serves, and `rollback` reproduces it without a rebuild.
- **Edge caches.** `verify` and `promote` read S3, not CloudFront. Until an invalidation completes, an edge location may still serve a copy cached from before it.

Staged releases stay under `releases/<hash>/` until you remove them, which is what lets an earlier hash be promoted again - and what lets [`rollback <hash>`](/guides/operations/#roll-back-rollback-hash) to a staged hash republish its verified bytes instead of rebuilding. If storage matters, add an S3 lifecycle rule expiring old `releases/` objects, or delete a prefix with `aws s3 rm --recursive s3://<bucket>/releases/<hash>/` (and its record, `build/releases/<hash>.json`).

`stage` needs builder roles that may write `releases/*`; on a stack bootstrapped before staging existed it refuses before building and asks you to run `blogwright bootstrap <env>` once. The same bootstrap grants the CI deploy role `s3:GetObjectTagging` on `releases/*` and `s3:PutObjectTagging` on `site/*`, which `promote` uses to copy object tags. Without them it promotes untagged and warns once; after bootstrapping, `promote <hash> --refresh` copies the tags onto every file.

## SSR environments

When the config carries an `ssr` block, the same pipeline publishes a Lambda Web Function revision instead of a static site. The differences:

1. **Preflight.** Before anything is zipped, the deploy sends a SigV4-signed `GET` to the endpoint root. Any answer passes, including the placeholder's `503`. A caller that is not authorized to invoke the endpoint (`lambda:InvokeWebFunctionEndpoint`) stops the deploy there, before anything is built or published.
2. **Build.** Still a MicroVM build. The agent packages `ssr.packageDir` (default `paths.dist`) into a deterministic `.zip` after checking the entry file exists, rejecting any symbolic link in the package, and enforcing Lambda's 512 MB unzipped bound. It uploads the artifact to `web/artifacts/<hash>.zip`, publishes only `ssr.staticDir` to `site/` when configured (upload-only - stale keys are listed, not deleted), and writes `web/results/<hash>.json`.
3. **Revision.** The CLI fingerprints the artifact digest, runtime, execution role, log group and revision-scoped settings. When that fingerprint already serves, no revision is created: only the static changes are invalidated. The exception is a revision whose own publish never finished (an earlier deploy stopped after the cutover): the deploy finishes it instead, probing the endpoint and invalidating `/*`. Otherwise it creates one revision from the artifact's object version and every setting (a revision copies nothing from the last one), polls `GetWebFunctionRevision` until `Active`, and fails with the revision's own errors if it settles `Failed` - the previous revision keeps serving.
4. **Readiness probe.** `Active` only means Lambda prepared the code, so the deploy then probes the endpoint root until it answers below `500`. Only a ready revision is followed by deleting stale `site/` keys and invalidating `/*`, because a new revision may change any cached page.
5. **Restore.** A `LatestRevision` endpoint has already cut over by the time the probe runs. If the probe never passes, the deploy re-creates the previous revision from its captured configuration, waits for it to become `Active`, probes it, and fails naming both revisions. It does not invalidate and does not delete stale keys, so pages still cached keep serving. If the restore does not serve either, the failure says the endpoint is not serving and gives the `blogwright rollback <hash>` command for the newest hash with a recorded revision.

The summary reports the revision id, whether it was created or found unchanged, and the invalidation that ran. `blogwright history` adds a `revision` column in SSR mode: a hash shows a revision id only once a revision built from it was verified to serve (its manifest's `webFunction` block), and a later failed deploy or rollback of the same hash keeps it, so the hash stays reproducible by `rollback`. A hash showing `-` has nothing to reproduce from.

### Rollback in SSR mode

`blogwright rollback <hash>` reproduces the revision that hash was deployed with, from the artifact version and `settings` recorded in its manifest - not from the current config, whose `entryPoint` or `env` may not fit the older artifact. It skips creation when that fingerprint is already serving, and runs the same preflight, probe, restore and invalidation steps as a deploy.

It falls back to re-running the MicroVM build when the manifest has no `webFunction` block (a static-era or failed deploy), the recorded artifact version no longer exists, or `ssr.staticDir` is configured - the last because an artifact carries only the server, and the fingerprinted assets its pages reference were removed from `site/` by the deploys that followed.

### Switching modes

To turn an existing static environment into an SSR one:

1. Add the `ssr` block to the environment's config, with `ssr.shim` for the entry shim, and the packaging steps to your build ([Server-rendered sites](/guides/server-rendered-sites/)).
2. `blogwright bootstrap <env> --switch-mode` - creates the Web Function, its role, log groups, origin access control and cache policy, and moves the distribution's default behavior to the endpoint, which answers `503` from a placeholder revision until step 3 finishes.
3. `blogwright deploy <env>` - publishes the first real revision.

A new environment needs no flag: `bootstrap` then `deploy`. Moving back to static is the same sequence with the block removed.

`blogwright bootstrap` refuses to change the mode of a bootstrapped stack without `--switch-mode`, because the distribution's default behavior moves before a deploy in the new mode exists: static → SSR answers `503` from the placeholder until the first SSR deploy completes, and SSR → static serves whatever `site/` holds until the next static deploy. With the flag, bootstrap converges the distribution in place and repeats the window as a warning. Until that bootstrap has run, `deploy` and `rollback` refuse, because the configured mode is not the one the distribution serves. Enabling versioning is part of the way in; it is never suspended, including when `ssr` is removed from the config. Every object overwritten or deleted from then on - each redeployed `site/` file, each state save - keeps its previous version, and Blogwright adds no lifecycle rule to expire them. If storage matters, add a noncurrent-version expiration rule yourself, scoped away from `web/artifacts/`: rollback reproduces revisions from the artifact versions their manifests record.

Removing `ssr` and re-bootstrapping does not delete the Web Function, its role, log groups, origin access control or cache policy: the graph is derived from the config, so once the block is gone those nodes are no longer part of it. An idle function costs nothing to run, but its log groups keep their retained logs, and `destroy` will not remove any of them either. To remove them, run `blogwright destroy <env> --yes` while the block is still present, or delete them by hand under the names in [Architecture](/reference/architecture/#tagging-and-naming). See [Server-rendered sites](/guides/server-rendered-sites/) for the full contract.

## Related pages

- [Operations](/guides/operations/) - `history`, `verify`, `rollback`, `status`, and day-two tasks
- [Artifact manifest](/reference/artifact-manifest/) - the record `verify` and `promote` check against
- [PR previews](/guides/pr-previews/) - the same build pipeline targeting `previews/<id>/site/`
- [CI deploys with GitHub OIDC](/guides/ci-github-oidc/) - running `blogwright deploy` from a workflow
- [Caching and Cache-Control](/guides/caching/) - the per-path headers, and browser versus edge lifetimes
- [Architecture](/reference/architecture/) - the bucket layout and the builder image in depth
- [CLI reference](/reference/cli/) - every command and flag
