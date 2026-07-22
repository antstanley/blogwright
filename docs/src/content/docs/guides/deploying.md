---
title: Deploying
description: What happens between `blogwright deploy` and your changes going live, step by step.
sidebar:
  order: 1
---

`blogwright deploy` takes your repository from working tree to live site: it zips the source, builds it inside a Lambda MicroVM, syncs only the changed files to S3, and invalidates only the changed CloudFront paths. This page walks the whole lifecycle so you know exactly what each step does — and what it deliberately skips.

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
4. Launch a builder MicroVM that pulls the zip, runs `pnpm install && pnpm build`, and syncs the output to `site/`, comparing each file's MD5 to the live object's ETag.
5. Invalidate only the CloudFront paths that actually changed.
6. On a successful production deploy, sync standard.site records to your PDS (when configured).
7. Print a deploy summary card.

## Packaging the source

The CLI finds the repo root by walking up from wherever you invoke it to the nearest `.git` or `.jj`, so `blogwright deploy` works from any subdirectory.

The revision hash names the build. With jj, it is the working copy's commit id (jj auto-commits the working copy); without jj, it falls back to `git rev-parse --short HEAD`. The hash becomes the zip's name (`build/<hash>.zip`), the key for build logs and manifests, and the argument you later pass to `blogwright logs` or `blogwright rollback`.

### Which files ship

The file listing honors `.gitignore`: tracked files plus untracked files that are not ignored (`git ls-files --cached --others --exclude-standard`). Two config knobs adjust it:

- **`sourceIgnore`** — extra prefixes to drop. Defaults to `.jj/`, `.git/`, `node_modules/`, `dist/`, `.astro/`. An entry matches an exact path or a directory boundary: `"dist"` drops `dist` and everything under it, but never `dist-notes.md`.
- **`sourceInclude`** — gitignored paths to zip anyway, for artifacts a pre-deploy step builds outside the MicroVM (a wasm bundle, generated data). Run the producing step before deploying — a missing or empty `sourceInclude` entry fails the deploy with a pointer to it, because shipping without the artifacts would deploy a broken site.

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

See [Configuration](/reference/configuration/) for the full key reference and [Non-Astro sites](/guides/non-astro-sites/) for `sourceInclude` in practice.

## The builder image check

Before launching the build, the deploy reconciles the builder MicroVM image: if the build-agent bundle shipped with your installed CLI version differs from the one baked into the image (compared by hash), the image is updated first. This means build-agent fixes from a blogwright upgrade land on the very next deploy, and when nothing changed the check is a no-op.

Right after an image update, the MicroVM control plane can briefly answer 502 for launches. The CLI retries gateway errors (502/503/504) with a bounded backoff of about two minutes; the launch is idempotent, so retrying is safe.

## Building in the MicroVM

The CLI launches a builder MicroVM from the snapshotted image, then writes a pending-job file to S3 describing the build: the source key, the target site prefix, the build directories (`paths.app` / `paths.dist`), object tags, and the SEO policy. The agent inside the VM (booting in roughly 30 seconds) polls for this job, then:

1. Downloads and extracts `build/<hash>.zip` into a work directory.
2. Runs `pnpm install --frozen-lockfile --prod=false` and `pnpm run build` in `paths.app` (the repo root by default). Dev dependencies are installed deliberately — static-site build tooling (astro, vite, tailwind) lives there.
3. Writes `robots.txt` and `sitemap.xml` into the output directory per the environment's SEO policy, so they publish and invalidate like any other page.
4. Syncs the output directory (`paths.dist`, default `dist/`) to the site prefix in S3.

Build output streams live to your terminal as it lands in CloudWatch. The CLI decides the outcome from hash-scoped markers in the log stream, so output from an unrelated build can never be mistaken for yours. The build is bounded by `microvm.maxDurationSeconds` (default 1800); the VM is terminated when the build finishes and self-terminates at that limit regardless.

Every build — success or failure — records a manifest at `build/manifests/<hash>.json` with the status, timestamps, duration, and MicroVM id. `blogwright history` reads these; see [Operations](/guides/operations/).

## Syncing only what changed

The agent does not blindly upload the build output. For each built file it computes the MD5 and compares it to the live object's S3 ETag under `site/`; only files whose content actually changed are uploaded. New files upload, unchanged files are skipped entirely, and stale objects (files no longer in the build) are deleted — but only after the new files are published, so the live site never has an empty or partial window.

The set of changed URL paths (each changed key mapped to the path a viewer would request) is written to `build/changed/<hash>.json`, which drives the next step.

## Cache invalidation

The CLI reads the changed-paths manifest and invalidates accordingly:

- **Nothing changed** — no invalidation at all. An identical redeploy uploads nothing and invalidates nothing.
- **Up to `invalidationMaxPaths` changed** (default 1000) — only those URL paths are invalidated, so unchanged pages stay cached at the edge. Directory index documents invalidate both forms a viewer might request: `site/posts/index.html` becomes `/posts/index.html` and `/posts/`.
- **Over the cap, or the manifest is missing** — a single `/*` invalidation.

Tune the threshold with the `invalidationMaxPaths` config key; see [Configuration](/reference/configuration/).

## Metadata fixes: `--refresh`

S3 writes object metadata — the content type and object tags — only on the PUT. Because the sync skips unchanged content, a metadata fix (an upgrade that corrects a content type, or newly added tags) never reaches an object whose bytes did not change. Pass `--refresh` once after such an upgrade to re-upload every file:

```sh
blogwright deploy --refresh
```

`--refresh` is also accepted by `rollback` and `preview deploy`.

:::note
`--refresh` re-uploads every file, so every path counts as changed — the invalidation covers the whole site (falling back to `/*` past the cap) instead of the usual minimal set.
:::

## The deploy summary

On a TTY, a successful deploy ends with a summary card: the revision, environment, source size (file count and KiB), build duration, what was invalidated ("nothing changed — skipped", "12 changed paths", or "everything (/*)"), and the site URL. Piped output and CI get the same information as stable line-oriented text.

## Build logs

Everything the build printed — pnpm, the site build, the sync — lands in a CloudWatch log group (retention configurable via `retention.microvmDays`, default 365 days). Retrieve a build's logs by its hash:

```sh
blogwright logs <hash>
```

The command uses the deployment manifest to window the log query to that build's time span (plus a minute either side). If the manifest is unreadable it falls back to the unfiltered window. See [Troubleshooting](/guides/troubleshooting/) for reading a failed build's output.

## standard.site sync after deploy

When the config has a `pds` section and publishing has been initialised, every successful **production** deploy also re-reconciles the site's standard.site records on your PDS. The sync is non-fatal by design: if it fails (an expired session, a network blip), the deploy still succeeds with a warning, and the next deploy heals the records. Non-production environments never sync.

Rollbacks are the exception — a rollback restores the deployed site but not your working tree, and the PDS mirrors repo content, so `blogwright rollback` only warns about the divergence instead of syncing. See [Publishing to standard.site](/guides/publishing-standard-site/).

## Related pages

- [Operations](/guides/operations/) — `history`, `rollback`, `status`, and day-two tasks
- [PR previews](/guides/pr-previews/) — the same build pipeline targeting `previews/<id>/site/`
- [CI deploys with GitHub OIDC](/guides/ci-github-oidc/) — running `blogwright deploy` from a workflow
- [Architecture](/reference/architecture/) — the bucket layout and the builder image in depth
- [CLI reference](/reference/cli/) — every command and flag
