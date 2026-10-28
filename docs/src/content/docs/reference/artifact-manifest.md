---
title: Artifact manifest
description: The versioned record of exactly what a static build published - every path, byte count and SHA-256, one aggregate release hash and a release identity.
sidebar:
  order: 5
---

Every static build records an **artifact manifest**: every file the build published, its size and its SHA-256, plus one hash over all of them. Where the [deployment manifest](/guides/operations/#audit-deployments-history) at `build/manifests/<hash>.json` records how a build ran (status, timing, MicroVM), the artifact manifest records what it produced. It is the record that lets you assert that what is live is what was reviewed.

## Where manifests live

A revision can be built more than once - a redeploy of the same hash, or a `rollback` that rebuilds it - and two builds of the same source are not guaranteed to be byte-identical. So no build ever overwrites another's record:

| Key | Written by | What it is |
| --- | --- | --- |
| `build/artifacts/<hash>/<buildId>.json` | the builder MicroVM, once per build | That build's own manifest. `<buildId>` is the build's start time and a random suffix (`20261028T182312Z-1a2b3c4d`), so every build has a fresh key and the CLI knows which object only this build can have written. |
| `build/artifacts/<hash>.json` | `deploy`, once per revision | The revision's **original** manifest: a copy of the first per-build manifest a deploy recorded for that hash. It is written with an S3 conditional write (`If-None-Match: *`), so it is never replaced - not by a redeploy, not by a rollback's rebuild. |

After a deploy's build, the CLI reads the build's own manifest back from its fresh key, prints the release, and keeps it as the original if the revision has none yet. If it already has one, the deploy says whether this build reproduced it and warns when it did not; the original stays as it was. A `rollback` never writes the original: it only compares against it. The builder's own role may write the per-build keys and nothing else under `build/artifacts/`, so the original is out of its reach.

```text
✓ release 1.4.0+4f3a2b1c9d0e.9f86d081884c (212 files, 3480 KiB, sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08)
  artifact manifest s3://production-example-123456789012/build/artifacts/4f3a2b1c9d0e/20261028T182312Z-1a2b3c4d.json
  recorded as the original release of 4f3a2b1c9d0e at s3://production-example-123456789012/build/artifacts/4f3a2b1c9d0e.json
```

SSR environments and PR previews record no artifact manifest: an SSR deploy already pins the exact artifact object version a revision serves (see [SSR environments](/guides/deploying/#ssr-environments)).

## Format, version 1

The example is illustrative: its hashes are placeholders, so it would not pass the checks below.

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
| `files` | Every file the build published, sorted by path in byte order (what `LC_ALL=C sort` produces). `path` is relative to the site root and `/`-separated - exactly the object key minus `site/` (a backslash in a file name is published, and recorded, as `/`). `bytes` is the size; `sha256` is the lowercase hex SHA-256 of the file's bytes. A symbolic link to a file is published, and recorded, with its target's bytes. `robots.txt` and `sitemap.xml` are included when the builder wrote them. |
| `fileCount`, `totalBytes` | The number of files and the sum of their sizes. |
| `releaseHash` | The aggregate hash over the whole file list - see below. |
| `siteVersion` | The `version` field of the built app's `package.json` (in `paths.app`), when it declares one. Omitted otherwise - including for an app whose pnpm manifest is `package.yaml` or `package.json5`, or whose `package.json` does not parse. A leading byte-order mark is ignored. |
| `release` | The release identity: `<siteVersion>+<hash>.<releaseHash prefix>`, or `<hash>.<releaseHash prefix>` without a site version. The prefix is the first 12 hex characters. A version that already carries semver build metadata keeps a single `+`: `1.4.0+exp.1` gives `1.4.0+exp.1.<hash>.<prefix>`. |

The manifest records content only. Object metadata - the content type, object tags and the `Cache-Control` written from the [`cacheControl` rules](/reference/configuration/#cache-control-cachecontrol) - is not part of it, so two builds with the same bytes have the same release hash even if their rules differ.

`fileCount`, `totalBytes`, `releaseHash` and `release` are derived from `files`. When blogwright reads a manifest it recomputes them and refuses one whose recorded values disagree, or whose `hash` is not the revision it was read for - a truncated, hand-edited or misplaced manifest is an error, never trusted. Once the site is live, `deploy` and `rollback` report such a manifest as a warning and carry on.

## The release hash

`releaseHash` is the SHA-256 of a `sha256sum`-style listing of the files: one `<sha256>  <path>` line per file (two spaces, a trailing newline), sorted by path in byte order. Any change to any byte of any file, or any file added, removed or renamed, changes it. Because it is defined over the listing, you can recompute it from a build directory without blogwright:

```sh
cd dist
find -L . -type f | sed 's|^\./||' | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum
```

`find -L` follows symbolic links, as the builder does. On macOS, use GNU `find`, `xargs` and `sha256sum` (from coreutils), or `shasum -a 256`, which prints the same listing format.

The recipe matches only while no path contains a backslash or a newline. GNU `sha256sum` escapes such a name (it prefixes the line with `\`), the newline splits the `xargs` input, and the builder publishes and records a backslash as `/`. Recompute those builds from the manifest's own `files` list instead.

Two builds of the same source are not guaranteed to produce the same release hash: the builder image, dependency resolution and toolchain can all change bytes. That is what the release hash is for - comparing two builds says whether they are byte-identical.

## Archiving it in CI

The manifest is an ordinary S3 object, so a CI job that deploys can archive it with the build:

```sh
blogwright deploy production --plain
aws s3 cp "s3://$BUCKET/build/artifacts/$HASH.json" artifact-manifest.json
```

`$HASH` is the revision hash the deploy prints (`Deploying <hash> to "production"`), and `$BUCKET` is the environment's bucket (`<env>-<siteName>-<accountId>`). That copies the revision's original manifest. To archive this build's own manifest instead - they differ only when the same hash was deployed before with other bytes, which the deploy warns about - copy the `artifact manifest` location the deploy prints.

## Permissions

The builder writes its per-build manifest with its own roles, which need `s3:PutObject` on `build/artifacts/*/*` - the per-build keys, not the originals beside them. The original is written by whoever runs `deploy`, with the `s3:PutObject` it already holds on the bucket. Stacks bootstrapped before artifact manifests existed lack the builder's grant: the build still publishes, and the deploy warns that no manifest was recorded. Run `blogwright bootstrap <env>` once to add it. SSR environments and the preview stack get no grant, since they record no manifest.

A failure to build or write the manifest never fails a build whose site is already published: the builder logs a warning, and the CLI reports that no manifest was recorded.

## Staging and promotion

A staged release is bound to the manifest of the build that staged it, not to the revision's original. [`stage`](/reference/cli/#stage) has the builder record its manifest under its own per-build key, checks the bytes under `releases/<hash>/` against it, and only then copies it to `build/releases/<hash>.json` - the staged release record. That key is outside every builder grant, so no later build can rewrite what a promotion is checked against. [`promote`](/reference/cli/#promote) reads that record once, checks the staged objects against it, copies them into `site/`, and checks the live objects against the same record. Because both checks compare every file's SHA-256 with one manifest, a successful promote means the live release hash equals the staged one.

`stage` also keeps the staged manifest as the revision's original when the revision has none, so in the usual sequence - stage, promote, `verify <hash>` - every step checks the same record. When the revision already has an original from an earlier build with other bytes (it was deployed before, or staged before and the build is not reproducible), the original is kept as it is, as for any build. `promote` still publishes and checks the staged release, but `verify <hash>` checks `site/` against the original and so reports the differences; `stage` warns about this when it happens. `verify <hash> --staged` checks the staged copy against the staged release record.

Re-staging a hash first deletes its staged release record, so a re-stage that stops partway leaves nothing `promote` would accept. See [Release gating](/guides/deploying/#release-gating-stage-verify-promote).

## Verifying live objects against it

`blogwright verify <hash>` compares the objects under `site/` with the original manifest recorded for `<hash>`: it reads and hashes each object the manifest lists with its recorded size, and reports an object whose size differs, or that the manifest does not list, without reading it. It reports each missing, changed or unexpected object and exits 1 on any difference - see [`verify`](/reference/cli/#verify).

## Rollback

`rollback <hash>` re-runs the build from the archived source, so it is a rebuild. It records the rebuild's manifest under its own per-build key, then prints both release hashes - the original's and the rebuild's - and warns when they differ, because the live site then serves bytes no review covered. The original is left as it was, so a later rollback is still checked against the reviewed bytes, not against an earlier rebuild. A rebuild that recorded no manifest (a builder denied the write, or a builder image older than artifact manifests) cannot be checked, and the rollback says so rather than reporting a match. See [Roll back](/guides/operations/#roll-back-rollback-hash).
