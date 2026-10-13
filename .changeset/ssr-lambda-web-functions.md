---
"blogwright": minor
"blogwright-core": minor
---

Run a server-rendered Node framework on Lambda Web Functions. A new `ssr`
config block turns an environment from a static site into a Web Function
deployment: the MicroVM build's output directory is packaged as a deterministic
`.zip`, stored as a versioned object in the site bucket, and published as an
immutable revision that the site's existing CloudFront distribution serves as a
private origin - IAM-authorized and signed by a `lambda` origin access control,
with a Blogwright-managed cache policy that caches only responses the
application marks cacheable. `ssr.staticDir`/`staticPaths` keep publishing
browser assets to `site/` from S3 under `CachingOptimized`.

Deploys fingerprint the artifact digest and revision-scoped settings, so an
unchanged redeploy creates no revision; a deploy that cannot verify its
revision restores the previous one from its captured configuration and leaves
the cache and stale site keys alone. `blogwright rollback` reproduces a
recorded revision from its retained artifact and settings without a rebuild,
falling back to the build path when the artifact is gone, the manifest has no
`webFunction` block, or `ssr.staticDir` is configured. `bootstrap` refuses a
serving-mode switch without the new `--switch-mode`, and `deploy` and
`rollback` refuse until that bootstrap has run; `delete` and the preview verbs
refuse in SSR mode.

The builder MicroVM image now states `cpuConfigurations: [{ architecture:
"ARM_64" }]` on every create and update - the only architecture the MicroVM API
accepts, and the one Lambda Web Functions run on - so native dependencies
compiled during a build match the runtime that serves them. Existing images are
already Arm64 and are not rebuilt for this.
