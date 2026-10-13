# Change: Node.js web servers and SSR on Lambda Web Functions

**Status:** Proposed · **Date:** 2026-10-13 · **Owner:** Ant Stanley · **Target:** site config, MicroVM build and packaging, CloudFront serving

Add an `ssr` mode to a site environment. When it is configured, a deploy builds
the app in the builder MicroVM as it does today, packages the configured output
directory as a `.zip`, uploads it to the (now versioned) site bucket, and
publishes an immutable Lambda Web Function revision pinned to that object
version. The site's existing CloudFront distribution gains the Web Function
endpoint as a private origin - IAM-authorized and signed by an origin access
control - with a cache policy that caches exactly what the application marks
cacheable. Static browser assets may optionally continue to be published to
`site/` and served from the existing S3 origin under `CachingOptimized`.
Everything else about the product - one CLI, reconcilable graph, MicroVM build,
custom domains, deployment history, rollback - stays the same.

The build side carries one repo-wide change, because Lambda Web Functions run
Node.js 24 on Arm64: every builder MicroVM image request states
`cpuConfigurations: [{ architecture: "ARM_64" }]`, so every native dependency
the build compiles matches the runtime it will serve from. That applies to
static environments too (their output is architecture-independent; the builder
is not). `ARM_64` is the only architecture the MicroVM API accepts, so images
that already exist are Arm64 today: the change states what was implicit and
forces no rebuild of an existing stack.

## Motivation

Blogwright only publishes static files. A Node framework that needs a server -
Astro SSR, SvelteKit, Nuxt, Next.js, an API backend - has no path through the
product today, and neither does the standard.site sync for such a site. Lambda
Web Functions, announced 2026-10-12, run a standard port-listening Node HTTP
server directly: the application keeps its framework, reads the host and port
from `AWS_LAMBDA_HTTP_ENDPOINT`, and Lambda handles scaling, concurrency and
billing. The packaging model is a `.zip` in a versioned S3 bucket, pinned by an
immutable revision; the serving model is an HTTPS endpoint that CloudFront can
front with origin access control.

This proposal uses exactly those primitives. It does not add a second deploy
pipeline: the existing MicroVM build produces the output, the existing S3 bucket
stores the artifact, the existing distribution serves it, and the existing
deployment manifests and rollback command learn about revisions. Preview stacks
and multi-region endpoints are explicitly out of scope (below); both are
separable follow-ups that do not change this contract.

## What this change does not do

- No application rewrite, adapter, or generated wrapper: the packaged entry
  file must already listen on `AWS_LAMBDA_HTTP_ENDPOINT`. Frameworks that read
  their own listen variables (Astro's Node adapter, SvelteKit `adapter-node`,
  Nitro and Next standalone all read `HOST`/`PORT`-style variables) need a
  consumer-owned entry shim that maps one onto the other. The shim is
  documented per framework as a recipe, not generated.
- No preview stack support. The shared preview distribution is host-routed to
  per-PR S3 prefixes and serves uncached; an SSR preview needs a per-PR endpoint
  or function, which is a separate design. `preview bootstrap` and
  `preview deploy` refuse when `ssr` is configured.
- No `MultiRegion`/`PerRegion` endpoints, no traffic-splitting API surface, and
  no container images. The endpoint is `HomeRegion`, `IamAuth`, and
  `LatestRevision`.
- No execution-role extension mechanism. The application's execution role grants
  logging only; an app that needs DynamoDB or another service is a follow-up
  (an operator-owned additional policy, or a plugin that attaches one).
- No SEO file management. `robots.txt`/`sitemap.xml` are the application's
  routes in SSR mode; `seo` is inert with a warning.
- No `microvm.architecture` config key. The builder is Arm64 in every
  environment, because it must match the Web Function runtime and `ARM_64` is
  the only value the MicroVM API currently accepts.
- No full-config ownership claim: the distribution reconcile patches the fields
  Blogwright owns (origins, behaviors, policies, error responses, default root
  object, aliases) and leaves anything else - a console-added WAF, for example -
  as it found it. It runs only in SSR mode and on a mode switch; a static stack
  that stays static keeps today's alias-only update, so `spa` and
  `defaultRootObject` still apply at distribution creation there.
- No silent mode switch. Moving a bootstrapped stack between static and SSR
  changes what the live distribution serves before a deploy has caught up, so
  `bootstrap` refuses it without `--switch-mode`.

## Affected spec pages

| Canonical page | Sections and change |
| --- | --- |
| [Product overview](../blogwright/specs/00-overview.md) | Problem and goals: Modify serving description; System shape: Modify diagram; Detail pages: Add the new page row; Scope summary: Modify Site lifecycle; Add an SSR row |
| [Domain model](../blogwright/specs/01-domain-model.md) | Relationships and lifecycle: Modify - add the SSR config phase, versioned bucket, node outputs and manifest additions |
| New `.specs/blogwright/specs/07-web-functions.md` | Add a Web Functions page: `SsrConfig`, package/revision/deploy contract, CloudFront shape and caching bounds, limits; page does not exist yet |
| [Development guidelines](../../DEVELOPMENT.md) | Testing: Modify - record that `lambda-web` is not emulated by floci and stays covered by transport mocks |

No canonical JSON Schema change: site-owned config (`microvm`, `retention`,
`seo`, `paths`) is not modelled in
[canonical-types.schema.json](../blogwright/specs/canonical-types.schema.json),
and `SsrConfig` is site-owned config of the same kind. The `07` page is its
contract, and `validateConfig` is its runtime enforcement.

## Proposed changes

The following blocks are merged-form prose. They become canonical only after the
corresponding implementation and evidence exist. Unmentioned content stays in
force.

### Product overview → Problem and goals (Modify)

Append after the existing description of MicroVM builds and feature packages:

> An environment may instead configure `ssr`, which turns the build output into
> a Lambda Web Function. The MicroVM build is unchanged; its output directory is
> packaged as a `.zip`, stored as a versioned object in the site bucket, and
> published as an immutable Web Function revision. The same CloudFront
> distribution serves the endpoint as a private origin: requests are signed by
> an origin access control, the endpoint accepts only the distribution, and the
> SSR cache policy caches only responses the application marks cacheable.
> Static browser assets may still be published to `site/` and served from S3
> under the managed caching policy. The builder image is created and kept as
> Arm64 in every environment, so native dependencies compiled during the build
> match the Web Function runtime.

### Product overview → System shape (Modify)

Replace the diagram with:

```text
consumer repo + config/<env>.jsonc
                  |
                  v
CLI composition root --> core config, signing, state and ports
  | site graph + deploy engine --> MicroVM build --+--> S3 site/ (static assets)
  |                                               |          |
  |                                               +--> web/artifacts/<hash>.zip
  |                                                          |
  |                                         Lambda Web Function revision + endpoint
  |                                                          |
  |                             CloudFront distribution (S3 + Web Function origins, OAC)
  | generic plugin dispatch
  +--> bundled PDS --> Secrets Manager / AT Protocol publication
  +--> optional analytics --> Firehose transform --> S3 Tables Iceberg
                                                 ^
                                  local DuckDB dashboard/backfill
```

### Product overview → Detail pages (Add)

Add a row after Documentation design (`06`) and before Canonical schema, so the
table stays in page order (the link is relative to `00-overview.md`):

| Page | Contract |
| --- | --- |
| `07-web-functions.md` - Web Functions (SSR) | `SsrConfig`, package/revision/deploy contract, CloudFront origins, caching and limits |

### Product overview → Scope summary (Modify)

Replace the Site lifecycle row's contract:

> Bootstrap, deployment (static publish or Web Function revision), rollback,
> status, history, logs, live-prefix deletion and guarded destruction

Add a row:

| Surface | Current behavior |
| --- | --- |
| SSR | Optional `ssr` config mode: MicroVM-built output packaged and published as an immutable Lambda Web Function revision behind the site's CloudFront distribution; preview stacks and multi-region endpoints are not supported |

### Domain model → Relationships and lifecycle (Modify)

Append after the paragraph on plugin state and site teardown:

> An environment's config document may carry an `ssr` block. Core validates it
> as site-owned config (like `microvm`, `seo` and `paths`), and the site graph
> gains `web-log-group`, `web-local-log-group`, `iam-web-role`, `web-oac`,
> `web-cache-policy`, `web-code-bucket-policy`, `web-function` and
> `web-function-policy` nodes; the `bucket` node enables S3 versioning, and
> `cloudfront-distribution` grows a second origin and per-behavior policies and
> records the serving `mode` (`static` or `ssr`; absent means `static`). Web
> Function outputs are recorded in `OpsState` under those node ids; deployment
> manifests gain a `webFunction` object (`revisionId`, `revisionArn`,
> `fingerprint`, `artifactKey`, `artifactVersionId`, `artifactSha256`,
> `settings`, `endpointName`, `endpointDomainName`) so history and rollback can
> name the revision a hash is pinned to and reproduce it. `settings` holds the
> revision-scoped values the revision was created with (`entryPoint`, `env`,
> `timeoutSeconds`, `maxConcurrencyPerEnvironment`). The object is written only
> for a revision that is serving and verified, and an SSR manifest's `status`
> is the outcome of the whole deploy, not of the build alone. The Web Function
> placeholder revision created at bootstrap is registered in state like any
> other node output; no plugin state is involved.

### Development guidelines → Testing (Modify)

Replace “the `lambda-microvms` control plane is not emulated, so MicroVM orchestration stays
mock-covered” with:

> the `lambda-microvms` and `lambda-web` control planes are not emulated, so
> MicroVM orchestration and Web Function revision publishing stay mock-covered.

### New page `.specs/blogwright/specs/07-web-functions.md` (Add)

Create the page with the standard header (`Status: Proposed`, owner, `Scope:
blogwright product`) and Read-first links to the development guidelines and spec
index. Its body contains these local contracts:

> **Context.** `ssr` is the site's server-rendering mode. Its presence enables
> the mode; absent, the environment stays a static site and every existing
> contract applies unchanged. `ssr` and `spa: true` are mutually exclusive, and
> when `ssr` is present `region` must be one of the Web Function launch regions.
> The mode is rejected for preview stacks by both `blogwright preview bootstrap`
> and `blogwright preview deploy`. The builder MicroVM is Arm64 in every
> environment (static included), so the SSR package is not the only thing
> aligned with the runtime; the build toolchain and any native dependency it
> installs are too.
>
> Changing the mode of a stack that is already bootstrapped is a serving
> cutover, not a quiet convergence. Once the distribution's default behavior
> moves, a static → SSR switch answers 503 from the placeholder until the first
> SSR deploy completes, and an SSR → static switch serves whatever `site/`
> holds until the next static deploy. `blogwright bootstrap` therefore refuses
> to change the mode recorded on the distribution unless `--switch-mode` is
> passed, names that window in the refusal, and repeats it as a warning when it
> proceeds.
>
> **Configuration.** The `ssr` block is validated at config load like every
> other site-owned setting; unknown keys inside the block, null, arrays and
> malformed values are rejected. Fields:
>
> | Field | Validation | Default |
> | --- | --- | --- |
> | `packageDir` | Repo-relative, non-empty, no `..` segments | `paths.dist` |
> | `entryPoint` | Non-empty relative path inside the package, `/` separators, no `..`, no leading `/` | `index.js` |
> | `staticDir` | Repo-relative, no `..`; must be supplied together with `staticPaths` | none |
> | `staticPaths` | Non-empty array of CloudFront path patterns, each beginning `/`; required with `staticDir` | `[]` |
> | `cacheKeyHeaders` | Array of HTTP header names included in the SSR cache key and forwarded to the app: token-valid, case-insensitive duplicates rejected, at most 10 (CloudFront's default quota), and the denylist below rejected | `[]` |
> | `env` | Map of `[A-Za-z][A-Za-z0-9_]*` keys to non-empty strings; literal values only, never secrets; the reserved keys below rejected | `{}` |
> | `timeoutSeconds` | Integer 3–900; above 60 only a response that keeps streaming benefits (see CloudFront shape) | 30 |
> | `maxConcurrencyPerEnvironment` | Integer 1–128 | 64 |
>
> An Astro node-standalone site with its client assets split back to S3, for
> example:
>
> ```jsonc
> {
>   "region": "us-east-1",
>   "siteName": "example",
>   "ssr": {
>     "entryPoint": "server/lambda.mjs",
>     "staticDir": "dist/client",
>     "staticPaths": ["/_astro/*", "/favicon.svg"],
>     // Add "cacheKeyHeaders": ["Authorization"] if viewers authenticate.
>     "env": { "ORIGIN": "https://example.com" },
>   },
> }
> ```
>
> `server/lambda.mjs` is the consumer's entry shim, emitted into the package by
> the site's own build script. Astro's standalone server reads `HOST` and
> `PORT`, so the shim maps the address Lambda provides onto them before loading
> the built entry:
>
> ```js
> const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');
> process.env.HOST = host;
> process.env.PORT = port;
> await import('./entry.mjs');
> ```
>
> The example also assumes the site's build leaves its server dependencies
> inside `dist/`; the build and package contract says what self-contained
> requires.
>
> `cacheKeyHeaders` names CloudFront always owns or strips before the app sees
> the request are rejected with a message naming the header: `Host` (always the
> origin's domain, so it cannot distinguish viewers), `Accept-Encoding`
> (normalised by the policy's compression flags), and the connection-scoped
> headers the service removes (`Connection`, `Keep-Alive`, `Upgrade`, `Expect`,
> `TE`, `Trailer`, `Transfer-Encoding`, `Proxy-Authenticate`,
> `Proxy-Authorization`, `Proxy-Connection`, `X-Real-IP`, the method overrides
> `X-HTTP-Method`, `X-HTTP-Method-Override` and `X-Method-Override`, and any
> name beginning `lambda-web-`). Any other name CloudFront itself refuses
> fails the bootstrap with the API's error, naming the header. The combined
> length of the listed names must also stay within CloudFront's
> 1,024-character cache-policy quota, which validation checks rather than
> leaving to the API.
>
> `env` keys that Lambda reserves are rejected at config load, naming the key,
> rather than by the API at deploy time: `AWS_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`,
> `AWS_SECRET_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_SECURITY_TOKEN`,
> `AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION`, `AWS_REGION`,
> `AWS_LAMBDA_HTTP_ENDPOINT`, `AWS_LAMBDA_RUNTIME_API`,
> `AWS_LAMBDA_INITIALIZATION_TYPE`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`,
> `AWS_LAMBDA_METADATA_API` and `AWS_LAMBDA_METADATA_TOKEN`.
> `AWS_LAMBDA_NODEJS_ENTRYPOINT` is rejected too, with a message pointing at
> `entryPoint`, so the two can never disagree.
>
> Revision-scoped fields (`entryPoint`, `env`, `timeoutSeconds`,
> `maxConcurrencyPerEnvironment`) take effect at the next deploy, which creates
> a revision whenever any of them changed even if the built output did not.
> Changing them does not restart the running revision, and `bootstrap` never
> cuts one. Site-wide settings that concern static serving change meaning in
> SSR mode. `defaultRootObject` is inert: the distribution root object is empty
> because the app answers `/`. `invalidationMaxPaths` applies only to a deploy
> that publishes `staticDir` changes without a new revision, because a new
> revision invalidates `/*`. `seo` is inert: the app owns `robots.txt` and
> `sitemap.xml`. A `seo` key written in the config document with a non-`off`
> value warns once per deploy that blogwright does not manage them; the check
> reads the raw document, because the merged defaults are `auto` and would
> otherwise warn on every SSR deploy.
>
> **Build and package contract.** The MicroVM build is unchanged apart from the
> builder's CPU architecture being stated: every builder image create and
> update request carries `cpuConfigurations: [{ architecture: 'ARM_64' }]` (the
> service's only valid architecture), in every environment, so the tools and
> native modules the build installs are Arm64 like the Web Function runtime.
> Images created before this change are already Arm64 and are not rebuilt for
> it. The build agent's
> container base image must remain Arm64-compatible - `node:24-slim` is
> multi-arch today, and that is a constraint on the Dockerfile, not a config
> key. The package is
> `ssr.packageDir`, zipped with the package directory's contents at the archive
> root and a fixed timestamp so identical output produces identical bytes; the
> entry file must exist at `ssr.entryPoint` inside the package and must start
> an HTTP server on the host and port in `AWS_LAMBDA_HTTP_ENDPOINT`. The agent
> can check the first; only the deploy's readiness probe can check the second.
> The package must be self-contained, because Lambda loads nothing that is not
> in the archive: the framework's bundled output, or a directory into which the
> site's build has copied its production dependencies as real files. The
> builder installs with pnpm, whose default `node_modules` is a symlink tree, so
> a package that merely sits beside the build's `node_modules` is not
> self-contained. The agent fails the build, naming the path, when the package
> contains a symbolic link, rather than archiving a tree that cannot load. It
> also fails when the unzipped package exceeds 512 MB.
> The artifact is uploaded to `web/artifacts/<hash>.zip`; its version id, sha256
> digest and size are written to `web/results/<hash>.json` before the
> changed-paths manifest that signals build completion. When `ssr.staticDir` is
> set, only that directory is published to `site/`; the server output is never
> published as S3 objects, and without `staticDir` the agent leaves `site/`
> untouched. Static publishing in SSR mode is upload-only. The agent does not
> delete keys that left `staticDir`, because the revision still serving
> references them; it lists them as `staleStaticKeys` in the result file, and
> the CLI deletes them once the deploy has a verified revision (see the deploy
> contract). A file that keeps its name across builds is overwritten at upload
> time, before the new revision serves, so fingerprinted asset names are the
> only ones that switch together with the server. Every revision carries
> `NODE_ENV=production` unless `ssr.env` supplies its own value, and
> `AWS_LAMBDA_NODEJS_ENTRYPOINT` whenever `entryPoint` is not `index.js` (the
> runtime's default).
>
> **Infrastructure.** Derived names are `<prefix>-web` (function),
> `<prefix>-web-role` (execution role), `<prefix>-web-oac` (OAC),
> `<prefix>-ssr` (cache policy) and `/<siteName>/<env>/web` (log group) with
> its companion `/<siteName>/<env>/web.local`, with endpoint name `site`;
> `<prefix>` is `<env>-<siteName>`. Bootstrap enables S3 versioning on the site
> bucket and creates both log groups, each with retention
> `retention.webFunctionDays` (default 90). Lambda writes in-Region logs to the
> `.local` companion before centralising them, and would otherwise create it
> itself with no retention and outside the graph. Bootstrap then creates the
> execution role, which may create streams and put events in those two groups
> and nothing else, the OAC, the cache policy, and the
> `AllowLambdaWebFunctionCodeAccess` bucket-policy statement. That statement
> grants `lambda.amazonaws.com` `s3:GetObject` and `s3:GetObjectVersion` on
> `web/artifacts/*`, conditioned with `ArnLike` on `aws:SourceArn` matching
> this function's `…:web-function/<prefix>-web/revision/*`, so no other
> account's function can have Lambda read the bucket on its behalf. Bootstrap
> then creates the Web Function with a placeholder revision and the `site`
> endpoint (`HomeRegion`, `IamAuth`, `autoDeploymentMode: LatestRevision`), and
> finally attaches the resource policy that lets `cloudfront.amazonaws.com`
> invoke the endpoint only from this distribution. The placeholder is a tiny
> CLI-owned `index.js` that listens on `AWS_LAMBDA_HTTP_ENDPOINT` and answers
> 503 until the first deploy. It is stored at `web/artifacts/placeholder.zip`,
> inside the prefix the statement covers, because Lambda checks its read access
> when the revision is created and rejects the request otherwise. Creating the
> function directly after the role and the bucket policy retries, within a
> named bound, the errors that mean IAM or the bucket policy has not propagated
> yet. A function that exists under the deterministic name but is absent from
> state (a crashed first bootstrap) is adopted rather than re-created.
> Re-applying bootstrap
> converges every one of these idempotently and does not create duplicate
> revisions.
>
> **CloudFront shape.** The distribution always keeps the S3 origin. In SSR
> mode the default behavior targets the Web Function origin with the
> `<prefix>-ssr` cache policy and the `AllViewerExceptHostHeader` managed
> origin-request policy; its allowed methods are GET, HEAD, OPTIONS, PUT, POST,
> PATCH and DELETE, with GET/HEAD cached. Ordered behaviors for
> `ssr.staticPaths`, when present, target the S3 origin with `CachingOptimized`
> and GET/HEAD, in the order the patterns are configured. The Web Function
> origin is HTTPS-only, carries the `lambda` type OAC with `always-amz-auth`
> signing, has no origin path, and uses a 60-second origin read timeout so
> streamed responses are not cut at the 30-second default. A response whose
> first byte takes longer than that is a CloudFront 504 whatever
> `timeoutSeconds` says, so values above 60 help only a response that keeps
> streaming.
> `DefaultRootObject` is empty and no custom error responses are attached,
> because the application owns 404s. Error responses are distribution-wide, so
> the `staticPaths` behaviors have none either: a path that matches a static
> pattern but has no object in `site/` returns S3's 403, not the application's
> 404 page. The router function node is still
> reconciled - so teardown and static-mode switches stay complete - but it is
> not associated with any behavior in SSR mode; static mode keeps attaching it
> to the S3 behavior for directory-index resolution. Aliases and the ACM
> certificate behave exactly as they do today. The reconcile that produces
> this shape runs on every SSR bootstrap and on a mode switch, and records the
> `mode` it left the distribution in. A static stack that stays static is not
> reconciled beyond its aliases, exactly as today.
>
> **Caching contract.** The cache policy has minimum TTL 0, default TTL 0 and
> maximum TTL 31,536,000 seconds, includes every query string and exactly the
> headers named in `ssr.cacheKeyHeaders` (default none) in the cache key,
> excludes cookies from the key while the origin-request policy still forwards
> them, and enables gzip and Brotli compression. A response is cached only when
> the application sends `Cache-Control`/`Expires`; `no-store` and `private` are
> never cached; hashed immutable assets with `max-age=31536000, immutable` are
> cached at the edge for a year. Headers in the cache key are automatically
> forwarded; every other viewer header still reaches the application because
> `AllViewerExceptHostHeader` forwards it, and the `Host` header is the endpoint
> domain as the service requires. The one exception is `Authorization` on GET
> and HEAD: CloudFront strips it unless it is in the cache key, so an
> application that authenticates viewers with bearer tokens must list
> `cacheKeyHeaders: ["Authorization"]`; doing so also splits the cache per
> token, which is the correct trade for authenticated traffic. This is what
> "caching optimized" means here: the AWS managed `CachingOptimized` policy is
> not applied to the SSR behavior because it ignores query strings, cannot
> forward the viewer `Authorization` header, and applies an 86,400-second
> default TTL to responses that the application did not mark cacheable.
>
> **Deploy contract.** `blogwright deploy` in SSR mode creates one revision per
> revision fingerprint: a sha256 over the artifact digest, the runtime, the
> execution role, the log group and the revision-scoped settings as they will
> be sent (`entryPoint`, the resolved `env`, `timeoutSeconds`,
> `maxConcurrencyPerEnvironment`). The fingerprint is stored as the revision's
> `description` (`blogwright:<fingerprint>`). That is how a later deploy
> recognises what is serving, because a revision exposes its S3 object and
> settings but no code digest. The serving revision is the newest `Active` one
> in `ListWebFunctionRevisions`, which is what a `LatestRevision` endpoint
> routes to.
>
> Before the build, the deploy sends a SigV4-signed GET to the endpoint root as
> a preflight. Any answer from the application passes, including the
> placeholder's 503. A caller that is not authorized to invoke the endpoint
> stops the deploy there, naming `lambda:InvokeWebFunctionEndpoint`, before
> anything is built or published. The probe is not optional. An `Active`
> revision says only that Lambda prepared the code: Lambda does not verify that
> the server starts listening, so the probe is the only evidence that a deploy
> serves.
>
> After the build the deploy reads `web/results/<hash>.json` and compares the
> fingerprint with the serving revision's. When they match, no revision is
> created: the deploy deletes `staleStaticKeys`, invalidates the changed
> `site/` paths from the changed-paths manifest (`/*` above
> `invalidationMaxPaths`, nothing when none changed) and reports the revision
> as unchanged. Otherwise it reads the serving revision's `description`,
> `buildConfig` and `serviceConfig`, then calls `CreateWebFunctionRevision`
> with the artifact's bucket/key/version id, runtime `nodejs24.x`, the
> execution role, every revision-scoped setting (a new revision copies nothing
> from the last one), and `telemetryConfig.loggingConfig.logGroup` set to the
> site's log group. It polls `GetWebFunctionRevision` until `Active` or
> `Failed`. A `Failed` revision never receives traffic, so the deploy fails
> with the revision's errors while the previous revision keeps serving with its
> static assets intact. Once the revision is `Active` the endpoint has already
> cut over, so the deploy probes the endpoint root before it touches the cache:
> a response below 500 is ready, and anything else retries until a named bound.
> Only a ready revision is followed by deleting `staleStaticKeys` and
> invalidating `/*`, because a new revision may change any cached page.
>
> When the probe does not pass, the deploy restores service instead of leaving
> a dead revision behind the endpoint. It creates one more revision from the
> `description`, `buildConfig` and `serviceConfig` it read before the cutover,
> waits for it to become `Active`, and probes it. It does not invalidate and
> does not delete `staleStaticKeys`, so pages still cached keep serving and the
> restored revision's assets are still in `site/`. The deploy then fails,
> naming the rejected revision, the restoring revision and the log group. If
> the restore does not pass either, the failure says that the endpoint is not
> serving and gives the `blogwright rollback <hash>` command for the newest
> manifest that carries a `webFunction` block.
>
> The manifest is written when the outcome is known: `succeeded` with the
> `webFunction` block above for a verified or unchanged revision, `failed` with
> the reason otherwise, including when the build itself succeeded. The summary
> reports the revision id, whether it was created or unchanged, and the
> invalidation that ran.
>
> **Rollback.** `blogwright rollback <hash>` in SSR mode reproduces the
> revision that hash was deployed with. Revisions are immutable and the
> endpoint serves the newest, so it creates a new revision from the artifact
> version and the `settings` recorded in that hash's manifest - not from the
> current config, whose `entryPoint` or `env` may not fit the older artifact -
> and skips creation when that fingerprint is already what serves. It runs the
> same preflight, probe, restore and invalidation steps as a deploy. It falls
> back to re-running the MicroVM build, with the current config as a
> static-mode rollback uses today, in three cases: the manifest has no
> `webFunction` block (a static-era or failed deploy), the recorded artifact
> version no longer exists, or `ssr.staticDir` is configured. The last is
> because an artifact carries only the server. The fingerprinted assets its
> pages reference were deleted from `site/` by the deploys that followed, and
> only a rebuild republishes them.
>
> **Teardown and lifecycle.** Destroy walks the graph in reverse: distribution
> first, then the Web Function (which deletes its revisions and endpoints), the
> execution role, both log groups, the cache policy and the OAC; the bucket
> node removes every object version and delete marker before deleting the
> bucket, through a version-aware deletion that only that node uses.
> `deletePrefix` itself is unchanged. It still issues plain deletes, which is
> all `blogwright delete` and `preview destroy` need and all the CI deploy role
> is allowed, so on a versioned bucket it unpublishes by leaving delete markers.
> `blogwright status` reports the function, endpoint and log-group nodes like
> any other. `blogwright delete` refuses in SSR mode, because emptying `site/`
> cannot unpublish a revision. Removing `ssr` from the config and
> re-bootstrapping with `--switch-mode` returns serving
> to static but cannot de-provision the Web Function resources, because
> the graph is derived from config and destroy only visits nodes the current
> config contributes; resolving that leak is a recorded open question. Once
> versioning is enabled it is never suspended, including when `ssr` is removed
> from the config.
>
> **Limits.** Package 512 MB unzipped; the server must listen within 10 seconds
> of process start; each execution environment has 2 GB of memory (1 GB default
> V8 heap) and handles 1–128 concurrent requests (default 64); revision timeout
> 3–900 seconds, with time to first byte bounded by the 60-second origin read
> timeout; the runtime is Node.js 24 (`nodejs24.x`) on Arm64; Lambda
> automatically removes the oldest revisions that no endpoint routes to once a
> function exceeds 50 revisions, so rolled-back revisions must be recreated
> from their retained artifact; Web Functions are available in us-east-1,
> us-east-2, us-west-2, ap-northeast-1 and eu-west-1 at launch, and `region`
> outside that set fails config validation with the supported list.

## Implementation notes

1. **Config and names (`blogwright-core`).** Add `SsrConfig` and
   `OpsConfig.ssr`; `DEFAULT_CONFIG` gains nothing for the absent block, and
   the block's own defaults are named constants beside it;
   `validateConfig` implements the field rules, the `cacheKeyHeaders` token/
   duplicate/count/denylist checks, the reserved `env` keys
   (`WEB_FUNCTION_RESERVED_ENV`), the `spa` conflict, and the region
   allowlist (`WEB_FUNCTION_REGIONS`); `WEB_FUNCTION_RUNTIME`
   holds `nodejs24.x` (Node.js 24 on Arm64). `deriveNames` gains `webFunction`, `webRole`,
   `webLogGroup`, `webLocalLogGroup`, `webOac` and `ssrCachePolicy`. The
   `retention` merge gains `webFunctionDays` (default 90). The SSR `seo`
   warning reads the `raw` half `parseConfigDocument` returns, not the merged
   config.
2. **S3 client (`core/src/aws/s3.ts`).** `putBucketVersioning(status)`; return
   the `x-amz-version-id` from `putObject`; `listObjectVersions(prefix)` and a
   new `deleteAllVersions(bucket, prefix)` that removes every version and
   delete marker with batched `DeleteObjects` requests rather than one DELETE
   per version. Only the bucket node's teardown calls it. `deletePrefix` keeps
   its plain-delete behavior, so `deleteSite`, `previewDestroy` and the
   analytics bucket teardown need no new permission: the CI deploy role that
   runs `preview destroy` holds `s3:ListBucket` and `s3:DeleteObject`, not
   `s3:ListBucketVersions` or `s3:DeleteObjectVersion`.
   `getBucketPolicy` is added for the merge below.
3. **Lambda Web client (`core/src/aws/lambda-web.ts`).** REST-JSON over the
   standard Lambda endpoint (`lambda.<region>.amazonaws.com`, SigV4 service
   `lambda`, `/2025-03-07` paths), following `microvms.ts`: create/get/list/
   delete web functions, revisions and endpoints, `putResourcePolicy`/
   `getResourcePolicy`, and tags. Revision create and get carry the
   `description` that holds the fingerprint, and the revision list is returned
   newest first as the service orders it. Revision state polling belongs to the CLI
   (`pollUntil`), not the client. Errors keep `AwsError` codes; revision
   errors are surfaced from `GetWebFunctionRevision`.
4. **CloudFront client (`core/src/aws/cloudfront.ts`).** Generalize
   `createOriginAccessControl` to take origin type (`s3` or `lambda`), signing
   protocol (`sigv4`; `sigv4a` is out of scope without multi-region) and
   signing behavior (`always` or `always-amz-auth`). Add cache-policy
   create/get/delete for the `<prefix>-ssr` policy, whose header whitelist is
   `ssr.cacheKeyHeaders` (none by default), and the managed-policy id
   constants (`ALL_VIEWER_EXCEPT_HOST_HEADER`). Extend the distribution
   builder to multiple origins and behaviors with per-behavior cache policy,
   origin-request policy, method set and function association, and add a
   reconcile that compares the desired shape semantically and PUTs only when
   something changed. The reconcile runs when the configured mode is SSR, and
   when the configured mode differs from the `mode` recorded on the
   `cloudfront-distribution` output. That is what adds the Web Function origin
   and behaviors on a static → SSR switch and removes them on the way back,
   where it restores the shape `create` builds from the current config. A
   static stack that stays static does not run it and keeps the alias-only
   `update` it has today, so `spa` and `defaultRootObject` remain
   creation-time settings there. The reconcile preserves the existing rule that
   dropping `--domain` never detaches a live hostname, and patches only the
   fields Blogwright owns so a console-managed field (a WAF, for example)
   survives. `bootstrap` gains `--switch-mode`; without it a mode difference is
   refused before any node is applied.
5. **Graph nodes (`cli/src/nodes.ts`).** Add the Web Function nodes
   (`web-log-group`, `web-local-log-group`, `iam-web-role`, `web-oac`,
   `web-cache-policy`, `web-code-bucket-policy`, `web-function`,
   `web-function-policy`) and the
   placeholder package builder (fflate, reproducible timestamp, stored at
   `web/artifacts/placeholder.zip`); `web-function` retries
   `CreateWebFunction` within a named bound while the role or the bucket
   policy is still propagating, as the analytics nodes'
   `whileRoleIsPropagating` does, records the function
   ARN immediately after it and adopts a same-named function
   found in AWS but absent from state; `web-function-policy` reads the current
   policy, replaces only its `AllowCloudFrontOACAccess` statement with the
   current distribution ARN, and passes the returned revision id. Extend
   `bucketNode` with conditional versioning and add the merged bucket-policy
   writer used by both
   `bucket-policy` and `web-code-bucket-policy`
   (`AllowLambdaWebFunctionCodeAccess` and `AllowCloudFrontRead` are separate
   Sids, each re-applied by its own node, preserving the other; the first
   grants `s3:GetObject` and `s3:GetObjectVersion` on `web/artifacts/*` under
   an `ArnLike` `aws:SourceArn` condition on the function's revision ARN
   pattern, which is derivable from the name before the function exists). The
   execution role's log statement grants `logs:CreateLogStream` and
   `logs:PutLogEvents` on `/<siteName>/<env>/web` and its `.local` companion;
   both groups are nodes, so the role needs no `logs:CreateLogGroup`. In SSR
   mode `applyBuildRolePolicy` and `applyExecRolePolicy` gain `s3:PutObject` on
   `web/artifacts/*` and `web/results/*`: today they can write only `site/*`
   and their `build/` prefixes, so the agent's artifact upload would be
   denied. Extend
   `oidcRolePolicyStatements` with `lambda:CreateWebFunctionRevision`,
   `lambda:GetWebFunction*`, `lambda:ListWebFunction*`,
   `lambda:InvokeWebFunctionEndpoint` and `iam:PassRole` on the web role, and
   `s3:GetObjectVersion`. `buildNodes` inserts the new nodes for a non-preview
   environment with `ssr`, and orders `web-code-bucket-policy` before
   `web-function`, `web-function` before the distribution, and
   `web-function-policy` after both. In SSR mode `gh-oidc-role` also depends
   on `iam-web-role`, because its policy names that role's ARN.
6. **Build agent (`packages/build-agent`).** The pending-job payload gains a
   `webFunction` object (`packageDir`, `entryPoint`, `staticDir`,
   `artifactKey`, `resultKey`); after `pnpm run build` the agent validates the
   entry file, rejects any symbolic link inside the package and enforces the
   512 MB unzipped bound, zips the package deterministically, uploads
   `web/artifacts/<hash>.zip`, and publishes `site/` only from `staticDir` when
   configured, uploading changed files but skipping the stale-key deletion
   loop that static mode runs. It then writes `web/results/<hash>.json` (key,
   version, sha256, size, `staleStaticKeys`) and the changed-paths manifest
   last. Publish must skip `robots.txt`/`sitemap.xml` generation in SSR mode.
7. **Deploy orchestration (`cli/src/deploy.ts`, `commands.ts`).** `runBuild`
   carries the payload and reads the build result, and in SSR mode leaves the
   manifest to the publish step instead of writing `succeeded` when the build
   ends. A new `publishWebRevision(ctx, result)` implements, in this order,
   the fingerprint comparison, the capture of the serving revision's config,
   revision creation, activation polling, the readiness probe, the restore
   path, stale-key deletion, invalidation and manifest recording. The
   preflight runs before `runBuild`. Both probes need a signer capability for
   an explicit HTTPS origin that signs with service `lambda` and includes
   `X-Amz-Content-SHA256` (the endpoint rejects a signed request without it);
   it is used nowhere else. `rollback` uses the recorded artifact and
   `settings` unless one of its three rebuild conditions applies;
   `deploy` writes the SSR summary rows. `deleteSite` and the preview verbs
   refuse as specified.
8. **Builder image architecture.** `core/src/aws/microvms.ts` gains
   `cpuConfigurations?: { architecture: string }[]` on `CreateImageInput`, emits
   it from `imageBody()` (so both create and update carry it), and exports
   `MICROVM_CPU_ARCHITECTURE = 'ARM_64'`. `nodes.ts`'s `imageInput()` sets
   `cpuConfigurations: [{ architecture: MICROVM_CPU_ARCHITECTURE }]`, and
   `reconcileBuilderImage` records `out.cpuArchitecture` after a create or
   update that happens for one of its existing reasons. `builderImageAction`
   is unchanged. A state record without the architecture is not a reason to
   rebuild: `cpuConfigurations` is optional and `ARM_64` is the only value the
   API accepts, so every existing image is already Arm64. The create
   `clientToken` gains
   the architecture (`img-<imageName>-arm64-<agentHash>`) because reusing a
   client token with different parameters is a 400; `updateImage` already
   strips the token. There is no delete-and-recreate path. It would need
   `lambda:DeleteMicrovmImage`, which the CI deploy role does not hold, and
   clearing running builders non-interactively would terminate other pull
   requests' builds on the shared preview image. A second architecture value,
   if the service adds one, is a separate change with its own migration.
9. **Tests.** Transport-level mocks, no cloud: config boundaries (one below/at/
   above for timeout and concurrency; `cacheKeyHeaders` token, duplicate, count
   and denylist cases; reserved `env` keys), the `spa` conflict, the region
   list, the raw-document `seo` warning and its silence on defaults,
   each node's read/create/update/delete over recording clients, placeholder
   and package zip contents, the bucket-policy statement's actions, resource
   and condition, the builder roles' `web/` grants, distribution XML for both
   modes (origins, behaviors, OAC type, empty default root, no error responses,
   header whitelist), the unreconciled static-stays-static path and the
   `--switch-mode` refusal, the fingerprint (a settings-only change creates a
   revision; an unchanged one skips), revision
   create/skip/`Failed` paths, the preflight stopping before the build, probe
   retry, the restore path leaving cache and stale keys untouched, stale-key
   deletion only after a ready revision, rollback from recorded settings and
   each of its three rebuild conditions, `deleteAllVersions` alongside an
   unchanged `deletePrefix`, the builder image payload and the unchanged skip
   for a legacy state record, and the agent's entry/symlink/size failures. `floci` does
   not emulate `lambda-web` - like `lambda-microvms`, that client stays
   mock-covered and the note in [DEVELOPMENT.md](../../DEVELOPMENT.md) gains
   `lambda-web` alongside `lambda-microvms`.
10. **Docs and product surface.** Update
   [configuration](../../docs/src/content/docs/reference/configuration.md)
   (new `ssr` section, `retention.webFunctionDays`, validation summary, the
   `seo`/`spa` interactions), the
   [CLI reference](../../docs/src/content/docs/reference/cli.md)
   (`bootstrap --switch-mode`), [architecture](../../docs/src/content/docs/reference/architecture.md)
   (node table, bucket layout, distribution origins and behaviors, naming, and
   the builder image's Arm64 `cpuConfigurations`),
   [deploying](../../docs/src/content/docs/guides/deploying.md) (the SSR
   lifecycle, the preflight, probe and restore behavior, rollback and when it
   rebuilds, and the serving window when switching modes), a new
   `docs/src/content/docs/guides/server-rendered-sites.md` (Astro node
   standalone, SvelteKit `adapter-node`, Nuxt and Next standalone recipes,
   each with its `AWS_LAMBDA_HTTP_ENDPOINT` entry shim and how its build keeps
   server dependencies inside the package without symlinks,
   cache-control expectations, the static-path split and why its assets should
   be fingerprinted),
   [troubleshooting](../../docs/src/content/docs/guides/troubleshooting.md)
   (cold starts, 403 from OAC, 404 from a wrong Host header, a viewer
   `Authorization` stripped on GET/HEAD unless `cacheKeyHeaders` lists it,
   S3's 403 for a static path with no object, a 504 past the 60-second origin
   timeout, a refused preflight, a server that never listens,
   missing entry point, a symlinked package, package size, `Failed` revisions) and the README
   feature list. Ship a changeset (minor: new feature).

## Acceptance criteria

| Obligation | Required evidence |
| --- | --- |
| Config contract | `ssr` parses through defaults when absent; every field's validation boundary, the reserved `env` keys, the `spa` conflict and the region allowlist have positive and negative tests; unknown keys inside the block are rejected; the `seo` warning fires for a written non-`off` value and stays silent on defaults |
| Bootstrap | An SSR bootstrap creates versioning, both log groups with retention, execution role, OAC, cache policy, placeholder revision and endpoint, resource policy and the Lambda-read bucket-policy statement (both S3 actions, the `aws:SourceArn` condition, and a resource that contains the placeholder key); an immediate re-run pushes no changes and creates no extra revision |
| Build architecture | Every builder image create and update carries `cpuConfigurations: [{ architecture: "ARM_64" }]`; a state record without the architecture still skips when the agent hash and log group match; the builder and the Web Function runtime are both Arm64 |
| Static safety | With `ssr`, server output is never written under `site/` (only `staticDir`, when configured) and stale `site/` keys are deleted only after a verified revision; static-mode deploy, distribution-update and `deletePrefix` behavior is unchanged, and static-mode tests change only where they assert the builder image request body |
| Builder permissions | The build and exec roles can write `web/artifacts/*` and `web/results/*` in SSR mode and nothing new otherwise; `preview destroy` still succeeds with the CI deploy role's existing S3 actions |
| Deploy | A deploy preflights the endpoint and stops before building when it may not invoke it; builds in the MicroVM, uploads a digest-stable artifact, creates one `Active` revision, creates another when only a revision-scoped setting changed, skips a redeploy whose fingerprint is unchanged, fails with the revision's errors on `Failed`, probes before invalidating `/*`, and records the `webFunction` manifest block only for a verified revision |
| Failed readiness | When the probe does not pass, the deploy creates a revision from the previous revision's captured config, leaves the cache and `staleStaticKeys` untouched, records a `failed` manifest and exits non-zero naming both revisions; when the restore also fails it says the endpoint is not serving |
| Caching | Uncached HTML is not cached; `private`/`no-store` responses are not cached; a hashed asset with an immutable max-age is served from cache on the second request; query strings and each configured `cacheKeyHeaders` entry produce distinct cache entries; with the default empty set an `Authorization`-bearing GET shares the anonymous entry and the app does not receive the header; cookies reach the application |
| Private origin | The endpoint rejects unsigned requests; only the distribution's ARN is allowed to invoke it; no wildcard-principal resource policy is ever written |
| Edge shape | The default behavior targets the Web Function with the `<prefix>-ssr` cache policy and `AllViewerExceptHostHeader`; `staticPaths` behaviors target S3 with `CachingOptimized`; `DefaultRootObject` is empty; no custom error responses are attached and the router function is not associated with any behavior in SSR mode |
| Mode switch | `bootstrap` refuses a static stack that gained `ssr`, and an SSR stack that lost it, unless `--switch-mode` is passed, and the refusal names the serving window; with the flag the stack converges in place, enables versioning on the way in and never suspends it on the way out, and serves the placeholder (or the current `site/`) until the next deploy; neither path tears down the stack |
| Rollback | Rolling back to a hash with a retained artifact and no `staticDir` creates a revision from that artifact and the manifest's recorded settings without rebuilding; a missing artifact version, a manifest without a `webFunction` block, or a configured `staticDir` takes the build path; every path probes and invalidates |
| Teardown | Destroy removes the distribution, function (with revisions/endpoints), role, both log groups, cache policy and OAC, and empties every version and delete marker before the bucket |
| Boundaries | `preview bootstrap`/`preview deploy` and `delete` refuse with actionable messages when `ssr` is set; unsupported regions fail validation naming the supported set; a package containing a symbolic link fails the build naming the path |
| Existing behavior | The six code gates pass; static mode's distribution, bucket and deploy contracts are unchanged; `TZ=America/New_York pnpm test` output is reported |
| Live AWS (playroom account) | A full bootstrap, deploy, no-op redeploy, settings-only revision, recorded-artifact rollback, both mode switches and destroy ran against real AWS: CloudFront served the SSR route from the `LatestRevision` endpoint (cache hit for `max-age=60`, `no-store` never cached), the `staticPaths` behavior served S3, a static path with no object returned S3's 403, the app's 404 passed through, revision settings (timeout 30/45/60, concurrency 16/32) and the pinned artifact version were read back from the service, and `destroy` left no resource behind |
| Documentation | The config reference, architecture reference, deploy guide, new SSR guide and troubleshooting page describe only shipped behavior and the exact cache-control contract |

## Standards and testing references

The normative service contract is the [AWS Lambda Web Functions Developer
Guide](https://docs.aws.amazon.com/lambda/latest/dg/lambda-web-functions.html),
especially [deployment
packages](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-deployment-package.html),
[deploying code from Amazon
S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html),
[HTTP request
handling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html),
[runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html),
[revision
management](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.html),
[deployment
patterns](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-deployment.html)
(auto-deployment modes),
[environment
variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)
(reserved names and the entry-shim guidance),
[logging](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)
(the `.local` companion log group),
[permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)
and [endpoint access
control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html).
The private-origin rules are in [Restrict access to an AWS Lambda Web Function
origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html):
IAM-auth endpoint, `lambda` OAC type, `always-amz-auth`, the
`lambda:InvokeWebFunctionEndpoint` resource policy with an `aws:SourceArn`
condition, and `AllViewerExceptHostHeader`. Caching uses the managed-policy
reference for [`CachingOptimized` and the origin-cache-control
family](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html).
The API shapes follow the [AWS SDK for JavaScript v3 `client-lambda-web`
package](https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-lambda-web)
and the [Lambda API
reference](https://docs.aws.amazon.com/lambda/latest/api/API_CreateWebFunction.html);
the launch announcement is the [AWS News Blog
post](https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/).
The builder architecture comes from the MicroVM API's
[`CpuConfiguration`](https://docs.aws.amazon.com/lambda/latest/microvm-api/API_CpuConfiguration.html)
(`architecture` = `ARM_64`), accepted by `CreateMicrovmImage` and
`UpdateMicrovmImage`.

## Merge plan

1. Require implementation, acceptance evidence and spec/code review before
   merging.
2. Apply each Modify/Add block above to its named page and exact section;
   preserve unrelated text. Create `.specs/blogwright/specs/07-web-functions.md`,
   index it in `.specs/README.md` and `.specs/blogwright/README.md`, and add it
   to the overview's detail-pages table.
3. Fold the shipped config, node, naming, caching and limit facts into `07`
   and the domain model; correct any block above that implementation proved
   different rather than publishing an aspirational contract.
4. Update the user-facing docs listed in implementation note 10, ship the
   changeset, and record that no canonical JSON Schema type changed.
5. Mark this change Merged, add the merge date, move it to
   `changes/merged/`, adjust its relative links for the extra directory level,
   and update the pending/history index.
6. Leave preview-stack SSR, multi-region endpoints, traffic splitting,
   execution-role extensions and `blogwright logs` for Web Functions as
   separate proposals referenced from `07`'s open questions.

## Assumptions and open questions

**Assumptions**

- The consuming project's framework can emit a self-contained server package
  (bundled output, or a package directory its build has copied production
  dependencies into as real files) whose entry file listens on
  `AWS_LAMBDA_HTTP_ENDPOINT`, natively or through a consumer-owned shim.
  Recipes are documentation; Blogwright does not stage or hoist dependencies,
  or generate the shim, in this change.
- **Confirmed live.** An IAM authorization failure at the endpoint can be told
  apart from an answer the application gave: a caller without
  `lambda:InvokeWebFunctionEndpoint` gets HTTP 403 with no
  `lambda-web-error-type` header, and every authorized answer (including the
  placeholder's 503 and the application's own responses) either carries that
  header or a status below 400. The preflight keys on exactly that pair.
- **Confirmed during implementation, against the published service model
  (`botocore/data/lambda-web/2025-03-07/service-2.json`) and live calls.** The
  `lambda-web` paths are `/2025-03-07/*`, but the verbs and members differ from
  this draft's guess: `CreateWebFunction` is `PUT /web-functions` taking
  `revisionConfig`/`endpointConfig`, revisions carry `buildConfig` (code, as
  `codeConfig.s3Object`, plus `runtimeConfig`) and `serviceConfig` (role,
  limits, `environmentVariables`, `telemetryConfig`), `ListWebFunctionRevisions`
  and `ListWebFunctionEndpoints` are POSTs on `list-revisions`/`list-endpoints`,
  the endpoint's access field is `authType`, and the resource policy lives at
  `/resource-policy/{functionArn}` with the body/response members spelled
  `Policy`/`RevisionId`. There is no entry-point field: the entry file reaches
  the runtime only as `AWS_LAMBDA_NODEJS_ENTRYPOINT`, exactly as the reserved
  env key implied. CloudFront's cache-policy quota is 10 headers, 128
  characters per header name, and a joined name list strictly under 1,024
  characters (1,023 accepted, 1,024 rejected). `AWS_LAMBDA_HTTP_ENDPOINT`
  exists on the revision, and S3 versioning of the artifact bucket is required
  by the API itself ("You must enable S3 versioning ... when
  S3ObjectStorageMode is set to REFERENCE"), as is the Lambda-read bucket
  statement the bootstrap writes.
- The site's `region` is one of the launch regions and the operator's
  credentials may create Web Functions there; `lambda-web` is not emulated by
  floci, so integration coverage stays at transport level.
- CloudFront remains the only supported front door. An endpoint is public at
  its own domain regardless of `IamAuth`, so the resource policy - not network
  placement - is what restricts invocation.

**Decisions**

- *Config surface.* **A single `ssr` block enables the mode**, mirroring how
  `pds` and `analytics` blocks enable their features; `ssr` vs `spa` is a hard
  conflict rather than a precedence rule.
- *Packaging.* **Zip the built output directory, not the source**, and pin
  revisions to S3 object versions. The MicroVM still runs the build, so no
  local toolchain, and immutable revisions plus retained artifacts give
  rollback without a rebuild.
- *Build architecture.* **Builder MicroVMs are always Arm64**, repo-wide and
  not an SSR-only setting, so whatever the build compiles or installs matches
  the Web Function runtime. The request now says so, and nothing is rebuilt
  for it: `ARM_64` is the API's only architecture, so images created before
  the change already run on it.
- *Front door.* **IAM-auth endpoint plus `lambda` OAC and a distribution-scoped
  resource policy**, because an `ApplicationManaged` endpoint would stay
  publicly reachable even behind CloudFront.
- *Caching.* **A Blogwright-managed cache policy honouring origin cache
  headers**, because the managed `CachingOptimized` policy ignores query
  strings and the viewer `Authorization` header and would apply a day-long
  default TTL to uncacheable HTML.
- *Cache key.* **Query strings plus an operator-declared header set, empty by
  default.** Only headers the operator names can vary the cached response;
  `Authorization` is opt-in because needing it means viewer credentials reach
  the application and every token gets its own cache entry.
- *No-op deploys.* **Skip revision creation when the revision fingerprint
  matches what the endpoint currently serves**, so a redeploy of unchanged
  output and unchanged settings - a workflow re-run, a `--refresh` metadata
  pass - does not churn revisions. The fingerprint covers the settings as well
  as the artifact, because a digest alone would skip a deploy that changed
  only `env` or a timeout and leave that change unapplied for good.
- *Revision drift.* **Revision-scoped settings apply at the next deploy,
  whether or not the code changed.** `bootstrap` reconciles infrastructure; it
  does not cut a revision to apply a changed timeout, env or entry point, and
  the contract says so.
- *Readiness.* **The probe is mandatory, and the permission for it is checked
  before anything changes.** An `Active` revision does not mean the server
  listens, so the signed probe is the only evidence a deploy serves and cannot
  be downgraded to a warning. `lambda:InvokeWebFunctionEndpoint` is in the CI
  deploy role; a local operator who lacks it is stopped by the preflight,
  before the build, with the action named.
- *Failed readiness.* **Restore, then fail.** A `LatestRevision` endpoint has
  already cut over by the time a probe can run, so a deploy that cannot verify
  its revision re-creates the previous one from its captured config and keeps
  the cache, rather than exiting with production on a server that never
  started.
- *Static assets.* **Delete stale `site/` keys only after the revision is
  verified.** The agent publishes before the CLI cuts over, so deleting during
  the build would pull assets out from under the revision still serving - for
  good, if the new revision then failed.
- *Mode switch.* **Refuse without `--switch-mode`.** Bootstrap moves the live
  default behavior before a deploy in the new mode exists; that window is the
  operator's to schedule, not something a routine re-bootstrap should open.
- *Reconcile scope.* **SSR mode and mode switches only.** Reconciling every
  static stack would turn `spa` and `defaultRootObject` from creation-time
  settings into live ones and rewrite distributions this change has no reason
  to touch.
- *Deletion.* **`deletePrefix` stays a plain delete.** Version-aware removal is
  a separate call used by bucket teardown alone, so no role that deletes a
  prefix today needs version permissions.
- *Versions.* **Enable bucket versioning only when `ssr` is present, and never
  suspend it.** Disabling is not reversible in a way that removes the versions
  already retained, and silently changing it later would break pinning.
- *Preview.* **Refuse rather than approximate.** The preview stack is a shared
  host-routed distribution over per-PR S3 prefixes; SSR previews need their own
  endpoint design.
- *Rollback.* **A new revision from the retained artifact and the settings it
  was deployed with**, so the `LatestRevision` endpoint model stays the only
  routing model and no weights API is exposed. With `staticDir` configured a
  rollback rebuilds instead, because the artifact does not carry the assets
  its pages reference.

**Open questions**

- How should Web Function resources be de-provisioned when `ssr` is removed
  from the config? Today the graph is config-derived, so neither bootstrap nor
  destroy visits the function, role, log groups, OAC, cache policy or
  `web/` policies once the block is gone, and a later `destroy` then deletes
  the state that records them. Options: make destroy state-driven (visit every
  node id recorded in `OpsState`, not just the current config's), refuse the
  removal until the stack is torn down, or keep recording state-limited
  cleanup. This needs resolving before merge because the leak is silent.
- Should the distribution reconcile patch owned elements into the live config
  (the current contract, preserving console-managed fields such as a WAF) or
  declare the whole distribution Blogwright-owned and regenerate it? The patch
  path is safer but more code; the regenerate path is simpler but resets
  anything outside the builder's field list.
- Bucket versioning multiplies storage for every overwritten object
  (`site/`, `build/` and `state/` writes all retain a version). Should a
  lifecycle rule expire noncurrent versions under those prefixes while
  retaining `web/artifacts/` and the versions active revisions pin?
- Cookies stay out of the cache key while `cacheKeyHeaders` makes headers
  operator-declared. Should cookies later become configurable the same way, or
  does the "cache only what the app marks public" contract remain the whole
  answer for personalised content? It is correct but demands framework
  cache-control hygiene.
- Should a later change stage production dependencies (for example
  `pnpm deploy` or a hoisted install) so frameworks without a self-contained
  output are supported without recipes?
- Which identity should own canary and blue-green rollouts - a
  `blogwright deploy --canary` flag, config revision weights, or the AWS API
  directly? It is deliberately not in this change.
- Should SSR previews create a per-PR endpoint on one shared Web Function
  (revisions pinned per PR) or a per-PR function? The former is cheaper but
  makes the 50-revision cleanup target and endpoint quota part of the preview
  contract.
- Should the execution-role surface grow an operator-supplied policy
  attachment, or should that live in a plugin that attaches its own named
  inline policy as PDS and analytics already do?
- Should `blogwright logs` learn to read the Web Function log group, or does a
  separate command serve request-log diagnostics better?
