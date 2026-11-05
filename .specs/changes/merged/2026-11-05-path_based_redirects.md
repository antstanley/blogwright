# Change: Path-based redirects

**Status:** Merged · **Merged:** 2026-11-05 · **Date:** 2026-11-05 · **Owner:** Ant Stanley · **Target:** site config, CloudFront viewer-request router function, deploy · **Issue:** [#60](https://github.com/antstanley/blogwright/issues/60)

Let a site redirect one path to another with a real HTTP redirect. A new
`redirects` list in `config/<env>.jsonc` names each `from` path, its `to`
target and an optional `status`. The list is compiled into the existing
viewer-request router function, ahead of the directory-index rewrite, so a
request for `/about.php` answers `301` with `location: /about/` instead of
failing to find an S3 key. Exact paths and trailing-wildcard prefixes with a
`:splat` carry-over are supported. The redirect map is validated at config
load and context creation, including the 10 KB CloudFront Function size limit,
so a bad or oversized map fails before any AWS call. `bootstrap` and `deploy`
republish the function when the compiled source changes, and a run with an
unchanged set changes nothing. With `redirectToPrimary`, a request for an alias
host whose path also has a redirect reaches the final URL in one hop. Preview
stacks reject `redirects`.

---

## Motivation

blogwright cannot redirect one path to another. `aliases` with
`redirectToPrimary` redirects by host only, so a site taking over from another
platform cannot send its old URLs to the new ones. The usual workaround is the
static generator's redirect pages, which are `meta refresh` HTML files at
`<old-path>/index.html`. They are unreachable behind the router for any old path
whose last segment contains a dot, such as `/about.php`: the router adds
`/index.html` only to dotless segments, so the S3 key is never found and
production answers `404` (a preview answers `403`). Where they are reachable they
answer `200`, not a redirect, which search engines and link unfurlers handle
poorly.

The router function already owns the one place where a request can be answered
before it reaches S3, and `redirectBlock` already shows the pattern (answer from
the viewer-request function, preserve the query string). The gap is config, a
matcher, size control, and the point at which a changed redirect set goes live,
since today the function is republished only by `bootstrap` while redirects
change alongside content.

---

## Affected spec pages

| Canonical page | Nature of change |
|---|---|
| [`.specs/blogwright/specs/01-domain-model.md`](../blogwright/specs/01-domain-model.md) | New "Path redirects" section; `cloudfront-function` output documents `codeHash`; deploy republishes the router function |
| [`.specs/blogwright/specs/07-web-functions.md`](../blogwright/specs/07-web-functions.md) | CloudFront shape: router function association in SSR mode also follows `redirects` |
| [`canonical-types.schema.json`](../blogwright/specs/canonical-types.schema.json) | Documents the `PathRedirect` shape (see Type changes) |

No new canonical page is added.

**Depends on** [`2026-11-05-multiple_domains_per_site.md`](2026-11-05-multiple_domains_per_site.md).
That change defines the "Site domains", "Alias redirect" and router-function
composition this change extends. Merge it first; the "Path redirects" section
below then lands next to them. Its code (`aliasRedirect`, `staticRouterCode`,
`ssrRouterCode`) is already on the branch. The "Alias redirect" section and the
SSR router-association text that the two Modify blocks below change do not exist
in the canonical pages yet; they are written by that change, so those blocks are
drafted against its merged text, not today's pages. Its SSR block is headed
"Distribution reconcile", which is the paragraph of the "CloudFront shape"
section that describes the reconcile; this change's block targets the same
paragraph.

---

## Proposed changes

### `.specs/blogwright/specs/01-domain-model.md` → Path redirects (Add)

> `redirects` is an optional list of path redirects in the environment's config
> file. Each entry has `from` and `to`, and an optional `status`:
>
> ```jsonc
> "redirects": [
>   { "from": "/about.php", "to": "/about/" },
>   { "from": "/old-blog/*", "to": "/news/:splat", "status": 301 }
> ]
> ```
>
> `status` is `301` by default and may be `301`, `302`, `307` or `308`. `to` is
> either a path on the same host, beginning with a single `/`, or an absolute
> `https://` URL. Both `from` and `to` are printable ASCII with no whitespace;
> any other character is written percent-encoded. A site with no `redirects`, or an empty list, runs a router
> function byte-for-byte identical to one without the setting.
>
> **Matching.** A redirect matches against the URI the viewer requested, before
> the directory-index rewrite, case-sensitively and without decoding, so `from`
> is written as the viewer sends it. A trailing slash is not significant: `from`
> is stored without one (the root `/` excepted) and a request for `/a` or `/a/`
> matches `/a`. A `from` ending in `/*` is a prefix match. It matches the prefix
> with or without a trailing slash and any path beneath it, and the rest of the
> path (empty when none) replaces `:splat` in `to`. An exact `from` wins over a
> prefix `from`, and among prefixes the longest wins. `:splat` is valid only in
> the `to` of a prefix redirect, and at most once.
>
> **Query string.** The request's query string is carried over unchanged, using
> the same handling as the alias redirect. If `to` already contains a query, the
> request's query is appended to it with `&`. `to` and `from` may not contain a
> fragment, and `from` may not contain a query.
>
> **Validation.** `redirects` is validated before any AWS call: the shape rules
> at config load, and the rules that need the effective primary domain, the
> serving mode or the stack kind at context creation. `from` begins with `/` and has no scheme, host, query or fragment, and at most
> one `*`, which must be the final segment. After the trailing slash is
> removed, no two entries share a `from`. `to` is a path or an `https://` URL
> with a host. A redirect whose `to` is its own `from` is rejected, and so is a
> two-entry loop in which each entry's `to` is the other's `from`. A prefix
> redirect whose `to` falls beneath its own prefix (`/docs/*` to
> `/docs/v2/:splat`) is rejected too, since its own output matches it again.
> Longer cycles are not detected. `status` is one of the four allowed codes. The list holds at
> most 500 entries, and the compiled router function source must fit the
> CloudFront Function limit of 10,240 bytes; a map that does not fit fails with
> the compiled size, the limit and a count of entries, and says to shorten the
> map or move redirects to the application.
>
> **Hosts.** A path redirect applies to every hostname the environment serves.
> A relative `to` answers a relative `location` on the host that was requested.
> When `redirectToPrimary` is set and the request is for an alias host, the
> path redirect is evaluated first and answers a single redirect to the final
> URL on the primary host: `https://<domain><to>` for a relative `to`, or `to`
> itself when it is absolute. An alias request whose path has no redirect
> answers the alias host redirect as before.
>
> **Previews.** `redirects` is rejected at context creation in a preview
> environment, with a message that the preview host router does not apply
> redirects. A preview answers `403` for a path that production redirects.

### `.specs/blogwright/specs/01-domain-model.md` → Alias redirect (Modify)

> The router function holds the path-redirect check, then the alias host check,
> then the directory-index rewrite, in that order. A distribution allows one
> function per event type, so these stay one function. When `redirects` is
> empty and `redirectToPrimary` is `false`, the source is the directory-index
> rewrite alone.

### `.specs/blogwright/specs/01-domain-model.md` → Router function publication (Add)

> The router function's source is generated from config: it varies with the
> alias redirect and the path redirects. The `cloudfront-function` output
> records `codeHash`, the SHA-256 of the source last published. A reconcile
> compares the hash of the source the config now produces with `codeHash` and
> republishes only on a difference, so a run with an unchanged config changes
> nothing.
>
> `bootstrap` reconciles the function as part of the resource graph. A
> `deploy`, static or SSR, reconciles it too, holding the environment lock and
> after the new site content is live, so a redirect to a new page never answers
> before the page exists; it records the new `codeHash` in state. The reconcile
> does not invalidate the cache: the function runs on the viewer request, ahead
> of the cache. A stack with no `cloudfront-function` output is not
> bootstrapped: `deploy` says so and does not create the function. If the
> publish fails, the deploy fails after the content is live, naming
> `blogwright bootstrap <env>` as the way to retry. `rollback`, `stage` and
> `promote` do not touch the function, because redirects belong to the
> environment's config and not to a release. The deploy summary reports whether
> the redirect function was republished or unchanged, and the count of
> redirects in it. `preview deploy` and the preview router are unchanged.
>
> A deploy publishes code only; it never edits the distribution. A static
> distribution always has the function associated, so a deploy is enough there.
> An SSR distribution associates it only when the config needs it, and that
> association is made by `bootstrap`. The distribution's recorded output notes
> whether the router is associated; when the config now needs it and the
> record says it is not, `deploy` warns that redirects are not live until
> `blogwright bootstrap <env>` runs, as it does for an unattached response
> headers policy.

### `.specs/blogwright/specs/07-web-functions.md` → CloudFront shape, distribution reconcile paragraph (Modify)

> The viewer-request router function is associated in SSR mode when either
> `redirectToPrimary` is set with at least one alias, or `redirects` is
> non-empty. It is the redirect-only form: path redirects first, then the alias
> host check, and no directory-index rewrite, since the application owns
> routing. It is associated with the default behavior and every static-path
> behavior, so redirects apply on all paths. With neither setting, SSR keeps its
> current shape with no viewer-request association. An SSR `deploy` republishes
> the function's code as a static one does, but attaching it to the behaviors
> is the `bootstrap` reconcile's work.

---

## Type changes

`OpsConfig` is TypeScript and is not part of the canonical schema. The schema
gains the shape of a redirect entry, so the validation rules have a
machine-readable form that the config table test and the docs can share.

```json
{
  "$comment": "Fragment for 2026-11-05-path_based_redirects. Folds into .specs/blogwright/specs/canonical-types.schema.json on merge.",
  "$defs": {
    "PathRedirect": {
      "type": "object",
      "required": ["from", "to"],
      "additionalProperties": false,
      "properties": {
        "from": { "type": "string", "pattern": "^/[\\x21-\\x22\\x24-\\x3e\\x40-\\x7e]*$" },
        "to": { "type": "string", "pattern": "^(/(?!/)[\\x21-\\x22\\x24-\\x7e]*|https://[\\x21-\\x22\\x24-\\x2e\\x30-\\x3e\\x40-\\x7e]+[\\x21-\\x22\\x24-\\x7e]*)$" },
        "status": { "enum": [301, 302, 307, 308], "default": 301 }
      }
    },
    "PathRedirects": {
      "type": "array",
      "items": { "$ref": "#/$defs/PathRedirect" },
      "maxItems": 500
    }
  }
}
```

The patterns cannot express uniqueness after trailing-slash normalisation, the
single final `*`, `:splat` placement, self-redirects, loops or the compiled-size
limit; those are enforced in code and stated in the prose above.

TypeScript additions (informative, in `packages/core/src/config.ts`):

```ts
export interface PathRedirect {
  from: string;
  to: string;
  status?: 301 | 302 | 307 | 308; // default 301
}
// OpsConfig
redirects: PathRedirect[]; // default []
```

---

## Implementation notes

```
1. config.ts: add PathRedirect and `redirects` to OpsConfig and DEFAULT_CONFIG
   (aliases is at :266 and :344). mergeConfig spreads scalars (:531 copies the
   aliases array defensively); copy this array and its entries the same way.
   Add validateRedirects beside validateAliases (:859): shape, normalise the
   trailing slash, duplicates, `*` placement, `:splat` rules, self-redirect,
   two-entry loop, a prefix `to` beneath its own prefix, ASCII-only, the 500
   cap. Reject in a preview environment in assertDomainSettings
   (context.ts:107, called at :319), widening its `Pick` to include `redirects`;
   config load does not know the stack kind.
2. router-function.ts: extend staticRouterCode and ssrRouterCode to take the
   redirects alongside the AliasRedirect. Add a redirectsBlock emitted ahead of
   redirectBlock. Emit exact matches as an object literal keyed by normalised
   path (one lookup) and prefix matches as an array sorted longest-first, so
   cost stays small as the map grows. Factor the query-string rebuild out of
   redirectBlock so both blocks share it. With no redirects the output must
   equal today's, byte for byte: add a snapshot test against the current
   string. For an alias request, resolve the path redirect first and build the
   absolute primary location, so the alias-plus-path case is one hop.
3. Size check: export a routerCodeFits(code) (UTF-8 byte length <= 10240) and
   assert it in createContext (context.ts) right after assertDomainSettings
   (:319) and before resolveAwsSession, because the compiled source depends on
   the effective domain (`--domain` can override the config's) and on `ssr`.
   Cover the SSR redirect-only form and the static form, both with the
   alias block included.
4. nodes.ts: aliasRedirect (:1524) becomes one options object feeding
   desiredCode (:1542). routerFunctionNode.update (:1568) already compares
   codeHash; its "static router, no hash recorded" skip (:1578) compares
   against staticRouterCode(), so a config with redirects already falls
   through to the republish; keep that and add a test. Extract the update body
   into an exported reconcileRouterFunction(ctx) helper so deploy can call it
   without running the graph. Outside the graph nothing saves state, so the
   helper calls ctx.save() after recording codeHash (nodes.ts does this at
   :482 and elsewhere). The cloudfront-distribution node records a
   `routerAttached` output in its SSR reconcile (:1848), which the deploy
   warning reads.
5. commands.ts: call reconcileRouterFunction in deployLocked after the publish
   step and before afterDeploy (:394-408), static and SSR. Add the function
   line to the deploy summary rows. Skip when the stack was never bootstrapped
   (no cloudfront-function output): say so, do not create it. deployLocked
   already runs under withEnvLock, so no extra locking is needed; follow
   reconcileResponseHeadersOnDeploy (nodes.ts:1178), which also warns "run
   bootstrap" instead of touching the distribution. In SSR, warn when
   `routerAttached` disagrees with what the config needs.
6. SSR association: the condition that attaches the viewer-request function is
   `!preview && aliasRedirect(ctx)` in distributionShape (nodes.ts:1649-1650).
   Widen it to include redirects. distributionShapeMatches
   (packages/core/src/aws/cloudfront.ts:1098) already compares the behaviors'
   function ARNs, so it needs no change.
7. IAM: ensureFunction (packages/core/src/aws/cloudfront.ts:724) calls
   DescribeFunction, UpdateFunction and PublishFunction. The CI deploy role is
   built by oidcRolePolicyStatements (nodes.ts:2224), which grants only
   CreateInvalidation and the response headers policy actions on production
   (:2277-2292); 08-aws-identity.md covers local profiles, not this role. Add
   a production statement for those three actions on
   `arn:aws:cloudfront::<account>:function/<prefix>-router`. An existing role
   gains them on the next bootstrap, so a deploy under the old role fails
   with AccessDenied; catch that and name `blogwright bootstrap <env>`.
8. Tests: config validation table (every rejection above plus accepted
   edge cases); trailing slash in request and in `from`; exact beats prefix,
   longest prefix beats shorter; splat with empty remainder; query string
   preserved, merged with a `to` query, and multi-value; alias host with and
   without a path redirect (one hop); absolute https `to`; byte-identical
   output with no redirects; oversize map error before any client call;
   re-bootstrap and re-deploy with an unchanged set make no CloudFront calls;
   deploy republishes on a changed set and saves the new codeHash; deploy
   skips an unbootstrapped stack; prefix `to` inside its own prefix and
   non-ASCII rejected; CI role policy includes the function actions; preview
   rejection message; SSR deploy warns when the router is not attached; SSR
   redirect-only function and association.
9. Docs: docs/src/content/docs/reference/configuration.md (new `redirects`
   section) and guides/custom-domains.md (alias plus path composition). State
   that previews do not apply redirects, that `bootstrap` and `deploy` apply
   changes, and that `rollback` does not.
10. init wizard (init.ts): no prompt; redirects are config-file only.
```

Prior art: the alias host redirect in `redirectBlock`
(`packages/cli/src/router-function.ts:30`), and the hash-compare republish in
`routerFunctionNode.update` (`packages/cli/src/nodes.ts:1568`).

---

## Merge plan

1. Merge `2026-11-05-multiple_domains_per_site.md` first.
2. Apply each `Proposed changes` block to its canonical page; bump that page's
   `**Date:**` to the merge date.
3. Fold the `Type changes` `$defs` into
   `.specs/blogwright/specs/canonical-types.schema.json`.
4. Update `.specs/README.md`: move this file from the pending list to the
   merged list pointing at `changes/merged/`.
5. Flip this file's `**Status:**` to `Merged`, add `**Merged:** YYYY-MM-DD`,
   and move it to `.specs/changes/merged/`.

---

## Assumptions and open questions

**Assumptions**

- A CloudFront Function's code is limited to 10,240 bytes, and a viewer-request
  function runs before the cache lookup, so republishing needs no invalidation.
- `request.uri` in a CloudFront Function is the path as the viewer sent it,
  percent-encoded and not decoded.
- Publishing a CloudFront Function propagates to the edge within seconds, which
  is acceptable for a deploy-time reconcile.
- The acceptance criteria in issue 60 are the acceptance criteria for this
  change: `/about.php` to `/about/` answers `301` with `location: /about/` and
  the query string preserved; a site with no redirects runs an unchanged
  router function; an invalid or oversized map fails at config load before any
  AWS call; re-running `bootstrap` or `deploy` with an unchanged set changes
  nothing.

**Decisions**

- *Inline map, not a KeyValueStore.* **Redirects are compiled into the router
  function and the size is validated at config load.** The issue allows either.
  Inlining adds no new resource, no new IAM surface and no new state, and
  matches how the alias redirect already works. A KeyValueStore lifts the size
  limit but adds a resource to the graph, a function-to-store association and
  a second publish path.
- *Fail early on size.* **The compiled source is measured against 10,240 bytes
  at context creation**, because it depends on the effective domain. An oversized map is a config error the
  operator can fix, and discovering it as a publish failure mid-deploy is worse.
- *Exact and trailing-wildcard only.* **`*` is allowed only as the final
  segment, with `:splat` in `to`.** This covers the migration cases in the issue
  (a retired path, a retired section) without a pattern language to specify,
  test and keep inside the size limit.
- *Trailing slash is not significant.* **`/a` and `/a/` match the same
  redirect.** Legacy links appear in both forms (the issue notes `/about.php/`
  reaches the generated page), and one entry per page is what an operator
  expects.
- *Deploy publishes code, bootstrap attaches it.* **`deploy` never edits the
  distribution.** This matches how a deploy treats the response headers policy:
  it converges what exists and warns when the attachment is missing. Only the
  SSR case with no prior association needs `bootstrap`.
- *Path redirects win over the alias host redirect.* **Path first, then host,
  then the rewrite, in one function.** It gives one hop for an alias request
  with a path redirect, and a request that has no path redirect is untouched.
- *Relative `to` stays relative off the primary.* **A relative `to` answers a
  relative `location` on a non-alias host.** It matches the acceptance
  criterion and keeps the redirect correct for any hostname the environment
  serves.
- *`deploy` applies redirects.* **A static or SSR deploy reconciles the router
  function after the content is live.** Redirects change alongside content, and
  an operator who must remember a separate `bootstrap` will ship stale
  redirects. After the content, so a redirect never points at a page that does
  not exist yet.
- *Rollback leaves redirects alone.* **`rollback` does not touch the
  function.** Redirects are config, not a release artifact, and restoring an
  old release should not silently change which URLs redirect.
- *Previews reject `redirects`.* **A preview environment fails context
  creation when `redirects` is set.** One preview router serves every PR, so a single
  PR's map cannot be applied without affecting the others. A clear error
  matches how `aliases` and `redirectToPrimary` are treated.
- *Status defaults to 301.* **Allowed codes are 301, 302, 307, 308.** The issue
  names these; `301` is what a migration wants.
- *SSR gets the same setting.* **`redirects` attach the redirect-only function
  in SSR mode.** The same setting behaves the same in both modes, following the
  alias redirect decision.
- *Cap of 500 entries.* **A fixed upper bound on entries, alongside the byte
  limit.** It bounds validation and test cost; the byte limit is the real
  constraint.

**Open questions**

- Should a later change add a KeyValueStore for maps that outgrow the inline
  limit, so redirect changes can apply without republishing code?
- Should previews apply redirects, for example from the config the preview
  stack was last deployed with, accepting that the map is then shared by every
  PR on the stack?
- Should longer redirect cycles (three or more entries) be detected at config
  load, at the cost of a graph walk over the map?
- Should blogwright read the static generator's own redirect config (Astro's
  `redirects`, Hugo's `aliases`) to avoid duplicating it? The issue marks this
  as a possible later step.
