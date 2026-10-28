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

1. Find the repo root, resolve the current revision hash, and zip the deployable files.
2. Upload the zip to `build/<hash>.zip` in the environment's S3 bucket.
3. Reconcile the builder MicroVM image if the build-agent bundle changed (no-op otherwise).
4. Launch a builder MicroVM that pulls the zip, runs `pnpm install && pnpm build`, and syncs the output to `site/`, comparing each file's MD5 to the live object's ETag and writing each upload's `Cache-Control` from the `cacheControl` rules.
5. Invalidate only the CloudFront paths that actually changed.
6. On a successful production deploy, sync standard.site records to your PDS (when configured).
7. Print a deploy summary card.

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

`--refresh` is also accepted by `rollback` and `preview deploy`.

You do not need it for `Cache-Control`: each build records the `cacheControl` rules it applied, and a build whose rules differ from the target's last one refreshes on its own and says so (`an implicit --refresh`). That includes the first deploy after upgrading to a version with `cacheControl`, which retrofits the default headers once. See [Caching and Cache-Control](/guides/caching/#when-the-rules-change).

:::note
`--refresh` re-uploads every file, so every path counts as changed - the invalidation covers the whole site (falling back to `/*` past the cap) instead of the usual minimal set.
:::

## The deploy summary

On a TTY, a successful deploy ends with a summary card: the revision, environment, source size (file count and KiB), build duration, what was invalidated ("nothing changed - skipped", "12 changed paths", or "everything (/*)"), and the site URL. Piped output and CI get the same information as stable line-oriented text.

## Build logs

Everything the build printed - pnpm, the site build, the sync - lands in a CloudWatch log group (retention configurable via `retention.microvmDays`, default 365 days). Retrieve a build's logs by its hash:

```sh
blogwright logs <hash>
```

The command uses the deployment manifest to window the log query to that build's time span (plus a minute either side). If the manifest is unreadable it falls back to the unfiltered window. See [Troubleshooting](/guides/troubleshooting/) for reading a failed build's output.

## standard.site sync after deploy

When the config has a `pds` section and publishing has been initialised, every successful **production** deploy also re-reconciles the site's standard.site records on your PDS. The sync is non-fatal by design: if it fails (an expired session, a network blip), the deploy still succeeds with a warning, and the next deploy heals the records. Non-production environments never sync.

Rollbacks are the exception - a rollback restores the deployed site but not your working tree, and the PDS mirrors repo content, so `blogwright rollback` only warns about the divergence instead of syncing. See [Publishing to standard.site](/plugins/standard-site/).

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

- [Operations](/guides/operations/) - `history`, `rollback`, `status`, and day-two tasks
- [PR previews](/guides/pr-previews/) - the same build pipeline targeting `previews/<id>/site/`
- [CI deploys with GitHub OIDC](/guides/ci-github-oidc/) - running `blogwright deploy` from a workflow
- [Caching and Cache-Control](/guides/caching/) - the per-path headers, and browser versus edge lifetimes
- [Architecture](/reference/architecture/) - the bucket layout and the builder image in depth
- [CLI reference](/reference/cli/) - every command and flag
