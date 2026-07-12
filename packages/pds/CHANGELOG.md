# blogwright-pds

## 0.3.0

### Minor Changes

- [`10dacc3`](https://github.com/antstanley/blogwright/commit/10dacc3d5a0a79c02b77f48c8cedcd49399690df) Thanks [@antstanley](https://github.com/antstanley)! - Serve `.webmanifest` as `application/manifest+json`, and add the other content
  types a modern static site ships: `jsonld`, `ttf`, `otf`, `mp4`, `webm`, `m3u8`,
  `mp3`, `vtt`, `pdf`, `csv`. (`.ts` is deliberately left unmapped — in build
  output it is far more likely stray TypeScript than an HLS segment.) Unmapped
  extensions still fall back to `application/octet-stream`, but the build log now
  warns which ones did, so a wrong header cannot stay silent. ([#6](https://github.com/antstanley/blogwright/issues/6))

  New `deploy --refresh` re-uploads every built file even when its content is
  unchanged. A deploy normally skips content-identical files, but S3 writes object
  metadata (content type, tags) only on a PUT — so a fix like the one above, or
  the object tags added in this release, would never reach objects already live.
  Run `blogwright deploy --refresh` once after upgrading to push the corrected
  metadata (it also invalidates the CDN, which caches the old headers).

- [`5249df4`](https://github.com/antstanley/blogwright/commit/5249df4413e9080cfafba04d66e3070d5f44915d) Thanks [@antstanley](https://github.com/antstanley)! - Tag every created AWS resource with `environment` and `app`. The bucket, IAM
  roles (reconciled on re-bootstrap too), ACM certificate, log groups, CloudFront
  distribution, log-delivery source, and the pds Secrets Manager secret all carry
  both tags; synced site files get them as S3 object tags, with preview deploys
  stamping the PR into the value (`environment: preview-pr-42`). The `app` value
  comes from the new `app` config option, falling back to the domain, then the
  repo directory name. CloudFront Functions, OACs, and Route53 records do not
  support tags.

### Patch Changes

- Updated dependencies [[`10dacc3`](https://github.com/antstanley/blogwright/commit/10dacc3d5a0a79c02b77f48c8cedcd49399690df), [`5249df4`](https://github.com/antstanley/blogwright/commit/5249df4413e9080cfafba04d66e3070d5f44915d)]:
  - blogwright-core@0.3.0

## 0.2.1

### Patch Changes

- [`6635054`](https://github.com/antstanley/blogwright/commit/6635054d39a7c61979dc5efb08982eec57383d17) Thanks [@antstanley](https://github.com/antstanley)! - Retry MicroVM launch on gateway errors after a builder-image update. The
  lambda-microvms control plane can answer 502 for a short window right after
  the builder image changes (fresh agent hash), which failed every consumer's
  first deploy after a blogwright upgrade. The launch call now retries 502/503/504
  with bounded backoff (~90s window); it is idempotent via the launch client
  token, so a retry can never start a second builder.

- [`1601303`](https://github.com/antstanley/blogwright/commit/16013031529679ca01a1281f1bae3d1625f0ce04) Thanks [@antstanley](https://github.com/antstanley)! - Fix two bootstrap failures reported from non-us-east-1 stacks:

  - CloudFront access-log delivery (and its log group) now lives in us-east-1,
    where the CloudFront LogType is supported — bootstrap in eu-west-1 previously
    failed its final node with `PutDeliverySource … ValidationException` and left
    the stack without access logs. ([#3](https://github.com/antstanley/blogwright/issues/3))
  - `preview bootstrap` now actually creates the wildcard DNS record: A and AAAA
    **alias** records pointing at the distribution (Z2FDTNDATAQYW2), replacing
    the printed manual instruction. A pre-existing CNAME — from an older
    bootstrap or a manual workaround — is cleared first, since Route53 refuses
    aliases alongside it; re-running bootstrap migrates existing stacks. ([#4](https://github.com/antstanley/blogwright/issues/4))

- Updated dependencies [[`6635054`](https://github.com/antstanley/blogwright/commit/6635054d39a7c61979dc5efb08982eec57383d17), [`1601303`](https://github.com/antstanley/blogwright/commit/16013031529679ca01a1281f1bae3d1625f0ce04)]:
  - blogwright-core@0.2.1

## 0.2.0

### Minor Changes

- [`aefd6c8`](https://github.com/antstanley/blogwright/commit/aefd6c8f1edd612f0fdc99eab70e0edc7c65cfab) Thanks [@antstanley](https://github.com/antstanley)! - First changesets-managed release, recapping the 0.1.x line and shipping a real
  package README.

  New in this release:

  - A full getting-started README on the `blogwright` npm package (the npmjs page
    previously showed a three-line stub): requirements, the
    `init` → `bootstrap` → `deploy` path, a command reference, configuration
    with the non-Astro knobs, a copy-paste OIDC CI workflow, and output modes.

  Recap of what 0.1.0 shipped, for the changelog record:

  - **Deploy any static site**: `paths.app`/`paths.dist` for monorepo apps,
    `spa: true` for client-side-routing fallback, and `sourceInclude` for
    pre-built gitignored artifacts (wasm bundles built in CI) — alongside the
    original Astro-shaped defaults.
  - **A CLI that helps**: `blogwright init` first-run wizard, live MicroVM build
    progress, a deploy summary card, `status` as a drift tree, `history` with a
    `← live` marker — pretty on a TTY, stable plain text for CI and agents
    (`--plain`, `NO_COLOR`).
  - **Hexagonal internals**: every side effect behind a port (filesystem,
    terminal, VCS, network), enforced by lint; the standard.site integration
    extracted into `blogwright-pds` with the `blogwright/rkey` contract intact.
  - **A full-project review's worth of hardening**: devDependencies install
    correctly in MicroVM builds, domains added after bootstrap attach to the
    existing distribution, OIDC trust policies reconcile on `githubRepo` change,
    concurrent deploys can no longer destroy the standard.site OAuth session,
    wrong-region S3 responses fail loudly, and JSONC configs accept trailing
    commas.

### Patch Changes

- Updated dependencies [[`aefd6c8`](https://github.com/antstanley/blogwright/commit/aefd6c8f1edd612f0fdc99eab70e0edc7c65cfab)]:
  - blogwright-core@0.2.0
