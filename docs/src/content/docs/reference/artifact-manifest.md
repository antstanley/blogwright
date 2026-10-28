---
title: Artifact manifest
description: The versioned record of exactly what a static build published - every path, byte count and SHA-256, one aggregate release hash and a release identity.
sidebar:
  order: 5
---

Every static build records an **artifact manifest** at `build/artifacts/<hash>.json` in the environment's bucket, beside the [deployment manifest](/guides/operations/#audit-deployments-history) at `build/manifests/<hash>.json`. Where the deployment manifest records how a build ran (status, timing, MicroVM), the artifact manifest records what it produced: every file the build published, its size, and its SHA-256, plus one hash over all of them. It is the record that lets you assert that what is live is what was reviewed.

The builder MicroVM writes it after it publishes the site and before it signals completion; `deploy` and `rollback` then read it back and print the release:

```text
✓ release 1.4.0+4f3a2b1c9d0e.9f86d081884c (212 files, 3480 KiB, sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08)
  artifact manifest s3://production-example-123456789012/build/artifacts/4f3a2b1c9d0e.json
```

SSR environments and PR previews record no artifact manifest: an SSR deploy already pins the exact artifact object version a revision serves (see [SSR environments](/guides/deploying/#ssr-environments)).

## Format, version 1

```json
{
  "manifestVersion": 1,
  "hash": "4f3a2b1c9d0e",
  "release": "1.4.0+4f3a2b1c9d0e.9f86d081884c",
  "releaseHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "siteVersion": "1.4.0",
  "fileCount": 2,
  "totalBytes": 18342,
  "files": [
    {
      "path": "index.html",
      "bytes": 9120,
      "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae"
    },
    {
      "path": "posts/hello/index.html",
      "bytes": 9222,
      "sha256": "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `manifestVersion` | The format version, `1`. A change to any field's meaning, or to how `releaseHash` is computed, gets a new version; blogwright refuses to read a version it does not know rather than guessing. |
| `hash` | The revision hash the build was made from - the same hash as the source zip, the deployment manifest and `history`. |
| `files` | Every file the build published, sorted by path in byte order (what `LC_ALL=C sort` produces). `path` is relative to the site root and `/`-separated - the object key minus `site/`. `bytes` is the size; `sha256` is the lowercase hex SHA-256 of the file's bytes. `robots.txt` and `sitemap.xml` are included when the builder wrote them. |
| `fileCount`, `totalBytes` | The number of files and the sum of their sizes. |
| `releaseHash` | The aggregate hash over the whole file list - see below. |
| `siteVersion` | The `version` field of the built app's `package.json` (in `paths.app`), when it declares one. Omitted otherwise. |
| `release` | The release identity: `<siteVersion>+<hash>.<releaseHash prefix>`, or `<hash>.<releaseHash prefix>` without a site version. The prefix is the first 12 hex characters. |

The manifest records content only. Object metadata - the content type, object tags and the `Cache-Control` written from the [`cacheControl` rules](/reference/configuration/#cache-control-cachecontrol) - is not part of it, so two builds with the same bytes have the same release hash even if their rules differ.

`fileCount`, `totalBytes`, `releaseHash` and `release` are derived from `files`. When blogwright reads a manifest it recomputes them and refuses one whose recorded values disagree - a truncated or hand-edited manifest is an error, never trusted.

## The release hash

`releaseHash` is the SHA-256 of a `sha256sum`-style listing of the files: one `<sha256>  <path>` line per file (two spaces, a trailing newline), sorted by path in byte order. Any change to any byte of any file, or any file added, removed or renamed, changes it. Because it is defined over the listing, you can recompute it from a build directory without blogwright:

```sh
cd dist
find . -type f | sed 's|^\./||' | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum
```

On macOS, use GNU `xargs` and `sha256sum` (from coreutils), or `shasum -a 256`, which prints the same listing format.

Two builds of the same source are not guaranteed to produce the same release hash: the builder image, dependency resolution and toolchain can all change bytes. That is what the release hash is for - comparing two builds says whether they are byte-identical.

## Archiving it in CI

The manifest is an ordinary S3 object, so a CI job that deploys can archive it with the build:

```sh
blogwright deploy production --plain
aws s3 cp "s3://$BUCKET/build/artifacts/$HASH.json" artifact-manifest.json
```

`$HASH` is the revision hash the deploy prints (`Deploying <hash> to "production"`), and `$BUCKET` is the environment's bucket (`<env>-<siteName>-<accountId>`).

## Permissions

The builder writes the manifest with its own roles, which need `s3:PutObject` on `build/artifacts/*`. Stacks bootstrapped before artifact manifests existed lack that grant: the build still publishes, and the deploy warns that no manifest was recorded. Run `blogwright bootstrap <env>` once to add it.

## Staging and promotion

[`stage`](/reference/cli/#stage) builds a release into `releases/<hash>/` and records its manifest; [`promote`](/reference/cli/#promote) checks the staged objects against the manifest, copies them into `site/`, and checks the live objects against it again. Because both checks compare every file's SHA-256 with the same manifest, a successful promote means the live release hash equals the staged one. See [Release gating](/guides/deploying/#release-gating-stage-verify-promote).

## Verifying live objects against it

`blogwright verify <hash>` reads every object under `site/`, hashes it, and compares the result with the manifest recorded for `<hash>`. It reports each missing, changed or unexpected object and exits 1 on any difference - see [`verify`](/reference/cli/#verify).

## Rollback

`rollback <hash>` re-runs the build from the archived source, so it is a rebuild. It reads the manifest recorded for that hash before the rebuild overwrites it, then prints both release hashes - the recorded one and the rebuilt one - and warns when they differ, because the live site then serves bytes no review covered. See [Roll back](/guides/operations/#roll-back-rollback-hash).
