# Web Functions (SSR)

**Status:** Proposed · **Date:** 2026-10-13 · **Owner:** Ant Stanley · **Scope:** blogwright product

Read first: [development guidelines](../../../DEVELOPMENT.md) and the [spec index](../README.md).

`ssr` is the site's server-rendering mode. Its presence enables the mode; absent,
the environment stays a static site and every existing contract applies unchanged.
`ssr` and `spa: true` are mutually exclusive, and when `ssr` is present `region`
must be one of the Web Function launch regions. The mode is rejected for preview
stacks by both `blogwright preview bootstrap` and `blogwright preview deploy`. The
builder MicroVM is Arm64 in every environment (static included), so the SSR
package is not the only thing aligned with the runtime; the build toolchain and
any native dependency it installs are too.

Changing the mode of a stack that is already bootstrapped is a serving cutover,
not a quiet convergence. Once the distribution's default behavior moves, a
static → SSR switch answers 503 from the placeholder until the first SSR deploy
completes, and an SSR → static switch serves whatever `site/` holds until the
next static deploy. `blogwright bootstrap` therefore refuses to change the mode
recorded on the distribution unless `--switch-mode` is passed, names that window
in the refusal, and repeats it as a warning when it proceeds. A distribution
recorded without a mode was created before SSR existed and is read as static,
so the guard covers the stacks that adopt `ssr` first. `deploy` and `rollback`
refuse while the configured mode differs from the recorded one, before anything
is probed, built or published: in that gap an SSR deploy publishes behind a
distribution that does not route to it, and a static deploy deletes the `site/`
assets the live revision still references.

## Configuration

The `ssr` block is validated at config load like every other site-owned setting;
unknown keys inside the block, null, arrays and malformed values are rejected
(`normalizeSsrConfig` in `packages/core/src/config.ts`). Fields:

| Field | Validation | Default |
| --- | --- | --- |
| `packageDir` | Repo-relative, non-empty, no `..` segments | `paths.dist` |
| `entryPoint` | Non-empty relative path inside the package, `/` separators, no `..`, no leading `/` | `index.js` |
| `staticDir` | Repo-relative, no `..`; must be supplied together with `staticPaths` | none |
| `staticPaths` | Non-empty array of CloudFront path patterns, each beginning `/`; required with `staticDir` | `[]` |
| `cacheKeyHeaders` | HTTP header names (RFC 7230 tokens), no case-insensitive duplicates, at most 10, at most 128 characters each, joined list strictly under 1,024 characters, none on the denylist | `[]` |
| `env` | Map of `[A-Za-z][A-Za-z0-9_]*` keys to non-empty strings; literal values only, never secrets; reserved keys rejected | `{}` |
| `timeoutSeconds` | Integer 3–900 | 30 |
| `maxConcurrencyPerEnvironment` | Integer 1–128 | 64 |

An Astro node-standalone site with its client assets split back to S3, for
example:

```jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "ssr": {
    "entryPoint": "server/lambda.mjs",
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg"],
    // Add "cacheKeyHeaders": ["Authorization"] if cacheable responses vary by token.
    "env": { "ORIGIN": "https://example.com" },
  },
}
```

`server/lambda.mjs` is the consumer's entry shim, emitted into the package by
the site's own build script. Astro's standalone server reads `HOST` and `PORT`,
so the shim maps the address Lambda provides onto them before loading the built
entry:

```js
const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');
process.env.HOST = host;
process.env.PORT = port;
await import('./entry.mjs');
```

The example also assumes the site's build leaves its server dependencies inside
`dist/`; the build and package contract below says what self-contained requires.

`cacheKeyHeaders` names CloudFront always owns or strips before the app sees
the request are rejected with a message naming the header: `Host` (always the
origin's domain, so it cannot distinguish viewers), `Accept-Encoding`
(normalised by the policy's compression flags), and the connection-scoped
headers the service removes (`Connection`, `Keep-Alive`, `Upgrade`, `Expect`,
`TE`, `Trailer`, `Transfer-Encoding`, `Proxy-Authenticate`,
`Proxy-Authorization`, `Proxy-Connection`, `X-Real-IP`, the method overrides
`X-HTTP-Method`, `X-HTTP-Method-Override` and `X-Method-Override`, and any
name beginning `lambda-web-`). Any other name CloudFront itself refuses fails
the bootstrap with the API's error, naming the header. The combined length of
the listed names must also stay within CloudFront's 1,024-character
cache-policy quota, which validation checks rather than leaving to the API
(`WEB_FUNCTION_CACHE_KEY_MAX_LENGTH`). Both limits were confirmed against the
live API: 10 headers and 128 characters per name are accepted, 11 headers and
129 characters are rejected (`TooManyHeadersInCachePolicy`, `InvalidArgument`),
and the joined-list boundary is 1,023 accepted / 1,024 rejected - so validation
rejects at the quota rather than above it
(`WEB_FUNCTION_CACHE_KEY_NAME_MAX_LENGTH`).

`env` keys that Lambda reserves are rejected at config load, naming the key,
rather than by the API at deploy time: `AWS_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_SECURITY_TOKEN`,
`AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION`, `AWS_REGION`,
`AWS_LAMBDA_HTTP_ENDPOINT`, `AWS_LAMBDA_RUNTIME_API`,
`AWS_LAMBDA_INITIALIZATION_TYPE`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`,
`AWS_LAMBDA_METADATA_API` and `AWS_LAMBDA_METADATA_TOKEN`
(`WEB_FUNCTION_RESERVED_ENV`). `AWS_LAMBDA_NODEJS_ENTRYPOINT` is rejected too,
with a message pointing at `entryPoint`, so the two can never disagree.

Revision-scoped fields (`entryPoint`, `env`, `timeoutSeconds`,
`maxConcurrencyPerEnvironment`) take effect at the next deploy, which creates
a revision whenever any of them changed even if the built output did not.
Changing them does not restart the running revision, and `bootstrap` never
cuts one. Site-wide settings that concern static serving change meaning in
SSR mode. `defaultRootObject` is inert: the distribution root object is empty
because the app answers `/`. `invalidationMaxPaths` applies only to a deploy
that publishes `staticDir` changes without a new revision, because a new
revision invalidates `/*`. `seo` is inert: the app owns `robots.txt` and
`sitemap.xml`. A `seo` key written in the config document with a non-`off`
value warns once per deploy that blogwright does not manage them; the check
reads the raw document, because the merged defaults are `auto` and would
otherwise warn on every SSR deploy.

## Build and package contract

The MicroVM build is unchanged apart from the builder's CPU architecture being
stated: every builder image create and update request carries
`cpuConfigurations: [{ architecture: 'ARM_64' }]` (the service's only valid
architecture, `MICROVM_CPU_ARCHITECTURE`), in every environment, so the tools
and native modules the build installs are Arm64 like the Web Function runtime.
Images created before this change are already Arm64 and are not rebuilt for it.
The build agent's container base image must remain Arm64-compatible
(`node:24-slim` is multi-arch today), and that is a constraint on the
Dockerfile, not a config key.

The package is `ssr.packageDir`, zipped with the package directory's contents at
the archive root and a fixed timestamp (`REPRODUCIBLE_ZIP_MTIME`) so identical
output produces identical bytes; the entry file must exist at `ssr.entryPoint`
inside the package and must start an HTTP server on the host and port in
`AWS_LAMBDA_HTTP_ENDPOINT`. The agent can check the first; only the deploy's
readiness probe can check the second. The package must be self-contained,
because Lambda loads nothing that is not in the archive: the framework's bundled
output, or a directory into which the site's build has copied its production
dependencies as real files. The builder installs with pnpm, whose default
`node_modules` is a symlink tree, so a package that merely sits beside the
build's `node_modules` is not self-contained. The agent fails the build, naming
the path, when the package contains a symbolic link, rather than archiving a
tree that cannot load. It also fails when the unzipped package exceeds 512 MB.

The artifact is uploaded to `web/artifacts/<hash>.zip`; its version id, sha256
digest, size and stale site keys are written to `web/results/<hash>.json`
before the changed-paths manifest that signals build completion. When
`ssr.staticDir` is set, only that directory is published to `site/`; the server
output is never published as S3 objects, and without `staticDir` the agent
leaves `site/` untouched. Static publishing in SSR mode is upload-only. The
agent does not delete keys that left `staticDir`, because the revision still
serving references them; it lists them as `staleStaticKeys` in the result file,
and the CLI deletes them once the deploy has a verified revision.

A file that keeps its name across builds is overwritten at upload time, before
the new revision serves, so fingerprinted asset names are the only ones that
switch together with the server. Every revision carries `NODE_ENV=production`
unless `ssr.env` supplies its own value, and
`AWS_LAMBDA_NODEJS_ENTRYPOINT` whenever `entryPoint` is not `index.js` (the
runtime's default).

## Infrastructure

Derived names are `<prefix>-web` (function), `<prefix>-web-role` (execution
role), `<prefix>-web-oac` (OAC), `<prefix>-ssr` (cache policy) and
`/<siteName>/<env>/web` (log group) with its companion
`/<siteName>/<env>/web.local`, with endpoint name `site`; `<prefix>` is
`<env>-<siteName>`. Bootstrap enables S3 versioning on the site bucket and
creates both log groups, each with retention `retention.webFunctionDays`
(default 90). Lambda writes in-Region logs to the `.local` companion before
centralising them, and would otherwise create it itself with no retention and
outside the graph.

Bootstrap then creates the execution role, which may create streams and put
events in those two groups and nothing else, the OAC (origin type `lambda`,
signing behavior `always-amz-auth`), the cache policy, and the
`AllowLambdaWebFunctionCodeAccess` bucket-policy statement. That statement
grants `lambda.amazonaws.com` `s3:GetObject` and `s3:GetObjectVersion` on
`web/artifacts/*`, conditioned with `ArnLike` on `AWS:SourceArn` matching this
function's `…:web-function/<prefix>-web/revision/*`, so no other account's
function can have Lambda read the bucket on its behalf. The merged writer
preserves `AllowCloudFrontRead` and vice versa: they are separate Sids, each
re-applied by its own node.

When `githubRepo` is set, the CI deploy role is granted
`lambda:CreateWebFunctionRevision`, `lambda:GetWebFunction*` and
`lambda:ListWebFunction*` on this function's ARN and the revisions and
endpoints under it, `lambda:InvokeWebFunctionEndpoint` on the endpoint ARN (the
resource the function's own policy admits CloudFront on), and `iam:PassRole`
on the execution role - never on every Web Function in the account. The role
node therefore follows the function in the graph, so it reads the ARNs the
service answered with.

Bootstrap then creates the Web Function with a placeholder revision and the
`site` endpoint (`HomeRegion`, `IamAuth`, `autoDeploymentMode:
LatestRevision`), and finally attaches the resource policy that lets
`cloudfront.amazonaws.com` invoke the endpoint only from this distribution.
The service's shapes, confirmed from its published model: `CreateWebFunction`
is `PUT /2025-03-07/web-functions` carrying `revisionConfig` (description,
`buildConfig`/`serviceConfig`) and `endpointConfig`, and it returns the initial
revision and endpoint - so a bootstrap learns the endpoint domain from the
create response. A revision's code is `buildConfig.codeConfig.s3Object`
(bucket, key, version id), its runtime is `buildConfig.runtimeConfig.runtime`,
and its settings live in `serviceConfig` (`executionRoleArn`, `timeoutSeconds`,
`maxConcurrencyPerEnvironment`, `environmentVariables`, `telemetryConfig`);
there is no entry-point member, so `ssr.entryPoint` reaches the runtime as
`AWS_LAMBDA_NODEJS_ENTRYPOINT` inside `environmentVariables`. Endpoints use
`authType` (not an access-type field), revisions and endpoints are listed with
POSTs on `list-revisions`/`list-endpoints` (newest first, as the service orders
them), and the resource policy is read and written at
`/2025-03-07/resource-policy/{functionArn}` - the FUNCTION's ARN, whose
validator enforces that pattern - with the body and response members spelled
`Policy`/`RevisionId`. The statement inside the policy names the endpoint ARN
and conditions on the distribution's ARN. The API itself requires S3 versioning
on the artifact bucket and the Lambda-read bucket statement, and rejects a
create that lacks either with an actionable message. The
placeholder is a tiny CLI-owned `index.js` that listens on
`AWS_LAMBDA_HTTP_ENDPOINT` and answers 503 until the first deploy. It is stored
at `web/artifacts/placeholder.zip`, inside the prefix the statement covers,
because Lambda checks its read access when the revision is created and rejects
the request otherwise. Creating the function directly after the role and the
bucket policy retries, within a named bound, the errors that mean IAM or the
bucket policy has not propagated yet. A function that exists under the
deterministic name but is absent from state (a crashed first bootstrap) is
adopted rather than re-created. Re-applying bootstrap converges every one of
these idempotently and does not create duplicate revisions. The cache policy
node reads existence only and updates in place: a changed `cacheKeyHeaders`
reaches the live policy through `UpdateCachePolicy`, never through a second
create, which CloudFront refuses for a name already taken.

## CloudFront shape

The distribution always keeps the S3 origin. In SSR mode the default behavior
targets the Web Function origin with the `<prefix>-ssr` cache policy and the
`AllViewerExceptHostHeader` managed origin-request policy; its allowed methods
are GET, HEAD, OPTIONS, PUT, POST, PATCH and DELETE, with GET/HEAD cached.
Ordered behaviors for `ssr.staticPaths`, when present, target the S3 origin
with `CachingOptimized` and GET/HEAD, in the order the patterns are configured.
The Web Function origin is HTTPS-only, carries the `lambda` type OAC with
`always-amz-auth` signing, has no origin path, and uses a 60-second origin read
timeout so streamed responses are not cut at the 30-second default. A response
whose first byte takes longer than that is a CloudFront 504 whatever
`timeoutSeconds` says, so values above 60 help only a response that keeps
streaming.

`DefaultRootObject` is empty and no custom error responses are attached,
because the application owns 404s. Error responses are distribution-wide, so
the `staticPaths` behaviors have none either: a path that matches a static
pattern but has no object in `site/` returns S3's 403, not the application's
404 page. The router function node is still reconciled - so teardown and
static-mode switches stay complete - but it is not associated with any behavior
in SSR mode; static mode keeps attaching it to the S3 behavior for
directory-index resolution. Aliases and the ACM certificate behave exactly as
they do today.

The reconcile that produces this shape runs on every SSR bootstrap and on a
mode switch, compares the desired shape semantically, PUTs only when something
blogwright owns changed, patches only the fields blogwright owns (so a
console-managed WAF or comment survives), and records the `mode` it left the
distribution in. The comparison reads a behavior's allowed methods without the
`CachedMethods` list nested inside them, so the document a reconcile pushed
matches the shape that produced it and a re-run pushes nothing. A static stack
that stays static is not reconciled beyond its aliases, exactly as today;
dropping `--domain` never detaches a live hostname.

## Caching contract

The cache policy has minimum TTL 0, default TTL 0 and maximum TTL 31,536,000
seconds, includes every query string and exactly the headers named in
`ssr.cacheKeyHeaders` (default none) in the cache key, excludes cookies from
the key while the origin-request policy still forwards them, and enables gzip
and Brotli compression. A response is cached only when the application sends
`Cache-Control`/`Expires`; `no-store` and `private` are never cached; hashed
immutable assets with `max-age=31536000, immutable` are cached at the edge for
a year. Headers in the cache key are automatically forwarded; every other
viewer header still reaches the application because
`AllViewerExceptHostHeader` forwards it, and the `Host` header is the endpoint
domain as the service requires. That includes `Authorization`, on every
method: CloudFront does not strip it under `AllViewerExceptHostHeader`, so it
reaches the application whether or not it is listed (observed live: a GET
carrying a bearer token arrived with the header intact while `cacheKeyHeaders`
was empty). Listing a header changes the cache key, not delivery. With the
default empty set an `Authorization`-bearing request shares the anonymous cache
entry, so an application whose cacheable responses depend on the viewer's token
must either list `cacheKeyHeaders: ["Authorization"]`, which gives each token
its own entry, or mark those responses `private` or `no-store`. This is what
"caching optimized" means here: the AWS managed `CachingOptimized` policy is
not applied to the SSR behavior because it ignores query strings, cannot key on
the viewer `Authorization` header, and applies an 86,400-second default TTL to
responses that the application did not mark cacheable.

## Deploy contract

`blogwright deploy` in SSR mode creates one revision per revision fingerprint
(`revisionFingerprint`): a sha256 over the artifact digest, the runtime, the
execution role, the log group and the revision-scoped settings as they will be
sent (`entryPoint`, the resolved `env`, `timeoutSeconds`,
`maxConcurrencyPerEnvironment`). The fingerprint is stored as the revision's
`description` (`blogwright:<fingerprint>`). That is how a later deploy
recognises what is serving, because a revision exposes its S3 object and
settings but no code digest. The serving revision is the newest `Active` one
in `ListWebFunctionRevisions`, which is what a `LatestRevision` endpoint
routes to.

Before the build, the deploy sends a SigV4-signed GET to the endpoint root as
a preflight (`preflightWebFunction`). Any answer from the application passes,
including the placeholder's 503. A caller that is not authorized to invoke the
endpoint stops the deploy there, naming `lambda:InvokeWebFunctionEndpoint`,
before anything is built or published. The signal is pinned: a denied caller
gets HTTP 403 with no `lambda-web-error-type` header, while an authorized
answer either carries that header or has a status below 400. The probe is not optional. An `Active`
revision says only that Lambda prepared the code: Lambda does not verify that
the server starts listening, so the probe is the only evidence that a deploy
serves.

After the build the deploy reads `web/results/<hash>.json` and compares the
fingerprint with the serving revision's. When they match, no revision is
created: the deploy deletes `staleStaticKeys`, invalidates the changed `site/`
paths from the changed-paths manifest (`/*` above `invalidationMaxPaths`,
nothing when none changed) and reports the revision as unchanged. A matching
fingerprint alone does not say that the publish which created the revision
finished, so every publish is noted in flight at
`web/publishing/<fingerprint>.json` before its revision is created, and the
note is removed once the cache is invalidated and the manifest recorded (or
when the revision is `Failed`, or was replaced by a restore). A deploy that
finds the fingerprint serving with its note still present finishes that
publish instead: it probes the endpoint, invalidates `/*`, deletes
`staleStaticKeys` and records the manifest, or fails without touching the
cache when the revision does not serve. Otherwise it
reads the serving revision's `description`, `buildConfig` and `serviceConfig`
(the revision list yields summaries, so the serving revision id is read back
with `GetWebFunctionRevision`), then calls `CreateWebFunctionRevision` with the artifact's bucket/key/version
id, runtime `nodejs24.x`, the execution role, every revision-scoped setting (a
new revision copies nothing from the last one), and
`telemetryConfig.loggingConfig.logGroup` set to the site's log group. It polls
`GetWebFunctionRevision` until `Active` or `Failed`. A `Failed` revision never
receives traffic, so the deploy fails with the revision's errors while the
previous revision keeps serving with its static assets intact. A revision settles `Pending` and then `Active` or `Failed`. Once the
revision is `Active` the endpoint has already cut over, so the deploy probes
the endpoint root before it touches the cache: a response below 500 is ready,
and anything else - a 5xx, or a probe that cannot reach the endpoint at all -
retries until a named bound. Only a ready revision is
followed by deleting `staleStaticKeys` and invalidating `/*`, because a new
revision may change any cached page.

When the probe does not pass, the deploy restores service instead of leaving a
dead revision behind the endpoint. It creates one more revision from the
`description`, `buildConfig` and `serviceConfig` it read before the cutover,
waits for it to become `Active`, and probes it. It does not invalidate and does
not delete `staleStaticKeys`, so pages still cached keep serving and the
restored revision's assets are still in `site/`. The deploy then fails, naming
the rejected revision, the restoring revision and the log group. If the restore
does not pass either, the failure says that the endpoint is not serving and
gives the `blogwright rollback <hash>` command for the newest manifest that
carries a `webFunction` block.

The manifest is written when the outcome is known: `succeeded` with the
`webFunction` block above for a verified or unchanged revision, `failed` with
the reason otherwise, including when the build itself succeeded. A `failed`
outcome keeps the `webFunction` block the hash's manifest already carried
(`writeManifest`): that block is the only record of the artifact version and
settings a verified revision was created with, so a failed redeploy or rollback
of a hash does not erase what `rollback` reproduces it from. The summary
reports the revision id, whether it was created or unchanged, and the
invalidation that ran.

## Rollback

`blogwright rollback <hash>` in SSR mode reproduces the revision that hash was
deployed with. Revisions are immutable and the endpoint serves the newest, so
it creates a new revision from the artifact version and the `settings`
recorded in that hash's manifest - not from the current config, whose
`entryPoint` or `env` may not fit the older artifact - and skips creation when
that fingerprint is already what serves, recording the revision that serves
rather than the one first recorded. It runs the same preflight, probe, restore
and invalidation steps as a deploy. It falls back to re-running the
MicroVM build, with the current config as a static-mode rollback uses today, in
three cases: the manifest has no `webFunction` block (a static-era or failed
deploy), the recorded artifact version no longer exists, or `ssr.staticDir` is
configured. The last is because an artifact carries only the server; the
fingerprinted assets its pages reference were deleted from `site/` by the
deploys that followed, and only a rebuild republishes them.

## Teardown and lifecycle

Destroy walks the graph in reverse: distribution first, then the Web Function
(which deletes its revisions and endpoints), the execution role, both log
groups, the cache policy and the OAC; the bucket node removes every object
version and delete marker before deleting the bucket, through a version-aware
deletion (`deleteAllVersions`) that only that node uses, and that fails naming
the first entry `DeleteObjects` reports as refused. `deletePrefix` itself
is unchanged. It still issues plain deletes, which is all `blogwright delete`
and `preview destroy` need and all the CI deploy role is allowed, so on a
versioned bucket it unpublishes by leaving delete markers. `blogwright status`
reports the function, endpoint and log-group nodes like any other.
`blogwright delete` refuses in SSR mode, because emptying `site/` cannot
unpublish a revision.

Removing `ssr` from the config and re-bootstrapping with `--switch-mode`
returns serving to static but cannot de-provision the Web Function resources,
because the graph is derived from config and destroy only visits nodes the
current config contributes; resolving that leak is a recorded open question.
Once versioning is enabled it is never suspended, including when `ssr` is
removed from the config.

## Limits

Package 512 MB unzipped; the server must listen within 10 seconds of process
start; each execution environment has 2 GB of memory (1 GB default V8 heap) and
handles 1-128 concurrent requests (default 64); revision timeout 3-900 seconds,
with time to first byte bounded by the 60-second origin read timeout; the
runtime is Node.js 24 (`nodejs24.x`) on Arm64; Lambda automatically removes the
oldest revisions that no endpoint routes to once a function exceeds 50
revisions, so rolled-back revisions must be recreated from their retained
artifact; Web Functions are available in us-east-1, us-east-2, us-west-2,
ap-northeast-1 and eu-west-1 at launch (`WEB_FUNCTION_REGIONS`), and `region`
outside that set fails config validation with the supported list.

## Verification

The client's paths, verbs and members are taken from the service model, and the
full lifecycle has been exercised against real AWS (an account with the
`lambda-web` service enabled): bootstrap, deploy, a no-op redeploy, a
settings-only revision, rollback from a recorded artifact, both mode switches
and destroy all behaved as this page specifies. CloudFront served the SSR route
from the `LatestRevision` endpoint (a `max-age=60` response was a cache hit,
`no-store` was never cached), the `staticPaths` behavior served S3, a static
pattern with no object returned S3's 403, the application's own 404 passed
through, an authorization failure was a 403 without `lambda-web-error-type`
(as the preflight assumes), revision settings and the pinned artifact version
were read back from the service, and `destroy` left no resource behind.

`floci` does not emulate `lambda-web`, so the client, the nodes and the deploy
contract stay covered by transport-level mocks in the suite: config boundaries, the
cache-header denylist and reserved `env` keys, each node's read/create/update/
delete, the placeholder package, the bucket-policy statement's actions/resource/
condition, the builder roles' `web/` grants, the distribution XML for both
modes, reconcile convergence against a pushed document, the `--switch-mode`
refusal (including a distribution recorded without a mode) and the deploy-time
mode check, the cache policy's in-place update, the fingerprint (a settings-only change
creates a revision; an unchanged one skips), the `Failed`, preflight, probe,
restore, unreachable-probe, unfinished-publish and stale-key paths, the CI
role's function-scoped grants, the verified block a failed
outcome keeps, rollback from recorded settings and each of its
rebuild conditions, `deleteAllVersions`, the builder image payload, and the
agent's entry/symlink/size failures.

## Open questions

- How should Web Function resources be de-provisioned when `ssr` is removed
  from the config? Today the graph is config-derived, so neither bootstrap nor
  destroy visits the function, role, log groups, OAC, cache policy or `web/`
  policies once the block is gone, and a later `destroy` then deletes the state
  that records them. Options: make destroy state-driven, refuse the removal
  until the stack is torn down, or keep recording state-limited cleanup.
- Should the distribution reconcile patch owned elements into the live config
  (the current contract, preserving console-managed fields such as a WAF) or
  declare the whole distribution blogwright-owned and regenerate it?
- Bucket versioning multiplies storage for every overwritten object (`site/`,
  `build/` and `state/` writes all retain a version). Should a lifecycle rule
  expire noncurrent versions under those prefixes while retaining
  `web/artifacts/` and the versions active revisions pin?
- Cookies stay out of the cache key while `cacheKeyHeaders` makes headers
  operator-declared. Should cookies later become configurable the same way?
- Should a later change stage production dependencies (for example
  `pnpm deploy` or a hoisted install) so frameworks without a self-contained
  output are supported without recipes?
- Which identity should own canary and blue-green rollouts - a
  `blogwright deploy --canary` flag, config revision weights, or the AWS API
  directly?
- Should SSR previews create a per-PR endpoint on one shared Web Function
  (revisions pinned per PR) or a per-PR function?
- Should the execution-role surface grow an operator-supplied policy
  attachment, or should that live in a plugin that attaches its own named
  inline policy as PDS and analytics already do?
- Should `blogwright logs` learn to read the Web Function log group, or does a
  separate command serve request-log diagnostics better?
