---
title: Caching and Cache-Control
description: How blogwright sets Cache-Control on every uploaded file, how browsers and CloudFront read it, and how to tune it.
sidebar:
  order: 1.5
---

A deployed page can be cached in two places: the visitor's browser and the CloudFront edge. blogwright controls both through the `Cache-Control` header that the builder writes on every file it uploads. The header comes from the `cacheControl` rules in your config. This page covers the defaults, how the two caches read the header, and how to write your own rules.

## The defaults

When `cacheControl` is not set, every deploy applies these rules:

| Files | `Cache-Control` | Why |
| --- | --- | --- |
| `/_astro/**`, `/_app/immutable/**` | `public, max-age=31536000, immutable` | Astro and SvelteKit put only content-hashed build output here. A changed file gets a new name, so a year is safe. |
| Everything else | `public, max-age=0, s-maxage=86400, must-revalidate` | Browsers revalidate on every use, and CloudFront keeps the file for a day. |

Without any header, a browser falls back to heuristic freshness, typically 10% of the time since the file's `Last-Modified` ([RFC 9111 §4.2.2](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.2)). A page left unchanged for 30 days can then be served from a visitor's cache for about three days without asking. A CloudFront invalidation never reaches that copy, so the visitor sees the old page after your deploy. The catch-all rule stops that: `max-age=0` makes the browser check with CloudFront each time. The check is cheap, because an unchanged page returns a `304 Not Modified` from the edge.

The catch-all also sets `s-maxage=86400`, which keeps the edge lifetime at the 24 hours that the `CachingOptimized` policy already gave files with no header. The default therefore changes how browsers cache your site, but not how long CloudFront keeps it.

To write no `Cache-Control` at all, set `"cacheControl": []`.

## Browser lifetime and edge lifetime

The header carries two lifetimes:

- **`max-age`** applies to browsers. CloudFront also uses it when `s-maxage` is absent.
- **`s-maxage`** applies only to shared caches such as CloudFront. Browsers ignore it.

Staging and production distributions use the AWS managed `CachingOptimized` cache policy: minimum TTL 1 second, default 86,400 seconds, maximum 31,536,000 seconds. CloudFront takes the edge TTL from `s-maxage` when it is present, otherwise from `max-age`, and clamps it to that range. It uses the 86,400-second default only when the file has neither ([Expiration](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)).

This is why a rule that only says `public, max-age=0, must-revalidate` is a trap. CloudFront clamps the edge TTL to 1 second, so almost every page view goes to S3. Always pair `max-age=0` with an `s-maxage`.

### How long can `s-maxage` be?

Every `deploy`, `rollback` and `--refresh` invalidates the paths it changed or deleted, so CloudFront drops an old copy as soon as a deploy replaces it. A long `s-maxage` is therefore safe while every deploy finishes. The risk is a deploy that stops after uploading but before invalidating, for example a CI job cancelled at that point. The next deploy sees the files as unchanged and does not invalidate them, so the edge serves the stale copy for up to `s-maxage`. Run `blogwright deploy --refresh` to invalidate everything if that happens.

| `s-maxage` | Edge copy lives up to | Trade-off |
| --- | --- | --- |
| `86400` (default) | 1 day | Same as having no header. Each edge refetches each page daily. |
| `604800` | 1 week | Fewer S3 requests. A missed invalidation lasts up to a week. |
| `31536000` | 1 year | The edge keeps every page until a deploy evicts it. Run `deploy --refresh` after any interrupted deploy. |

### Previews and server-rendered sites

The shared preview distribution uses `CachingDisabled`, so the edge never caches and ignores `s-maxage`. The browser directives still apply, which is why one rule set works for both previews and production.

In an [SSR environment](/guides/server-rendered-sites/), the rules apply to the `ssr.staticDir` files published to S3, which the `ssr.staticPaths` behaviors serve under `CachingOptimized`. Responses from the Web Function are not uploaded files, so the rules never touch them. The application sets its own headers.

## Writing your own rules

```jsonc
// config/production.jsonc
{
  "cacheControl": [
    // Content-addressed build output (Astro's hashed assets and fonts are both under /_astro/)
    { "match": ["/_app/immutable/**", "/_astro/**"], "value": "public, max-age=31536000, immutable" },
    // Everything else: HTML, 404.html, sitemaps, robots.txt, service worker, manifests, unhashed public/ files
    { "match": "**", "value": "public, max-age=0, s-maxage=604800, must-revalidate" },
  ],
}
```

- **Rules are checked in order, and the first match wins.** Put specific rules before general ones.
- **A file that no rule matches gets no `Cache-Control`.** Your list replaces the defaults entirely, so end it with a `**` catch-all unless you want unmatched files left to heuristic freshness.
- **Patterns match the file's URL path in the build output,** such as `/index.html` or `/posts/hello/index.html`. They never match the S3 key. A directory URL like `/posts/hello/` is served from its `index.html`, so match that file. Production (`site/…`) and previews (`previews/<id>/site/…`) therefore share one set of rules.
- **If your framework renames its hashed directory, update the rule.** Astro's `build.assets` and Vite's `build.assetsDir` both do this. A hashed rule only helps if it names the directory the build actually writes.

### Pattern syntax

| Syntax | Matches | Example |
| --- | --- | --- |
| `/` | path separator; every pattern starts with `/` or `**` | `/robots.txt` |
| `*` | any characters within one path segment | `/*.html` matches `/about.html`, not `/blog/a.html` |
| `?` | one character within one path segment | `/img/logo-?.png` |
| `**` | any number of whole segments; must be a whole segment | `/_astro/**`, `**/*.html`, `/posts/**/index.html` |

A leading `**/` also matches top-level files, so `**/*.html` matches `/index.html`. Character classes (`[ab]`), braces (`{a,b}`) and backslashes are rejected. List alternatives as separate patterns instead.

Patterns match the decoded path, exactly as the file is named in the build output. Write non-ASCII names as themselves (`/blog/café/*.html`), never percent-encoded: a pattern containing an escape such as `%20` or `%C3%A9` is rejected. A `?` matches one character, including one outside the Basic Multilingual Plane such as an emoji.

### Validation

The config fails to load, naming the rule and pattern, when:

- `cacheControl` is not an array, a rule is not an object, a rule has a key other than `match` and `value`, or `match` is empty.
- `value` is not a valid `Cache-Control` value: comma-separated directives such as `max-age=3600` or `private="set-cookie"`.
- A pattern can never match. That covers a pattern that does not start with `/` or `**`, one that ends in `/` or has an empty segment, a `.` or `..` segment, a percent-encoded character, a `**` inside a segment, and a pattern an earlier rule already covers. A pattern counts as covered when it repeats an earlier one, follows a match-everything pattern (`**` or `**/*`), sits under an earlier `/<dir>/**` (or `/<dir>/**/*`), or is a literal path an earlier pattern matches. Overlaps between two wildcard patterns outside these shapes, such as `**/*.html` followed by `/blog/*.html`, are not detected.
- A pattern is redundant within its own rule: it repeats, or is covered by, an earlier pattern in the same `match` list, by the same shapes as above.

## Error responses and the 404 page

On staging and production, S3 answers a request for a missing key with `403`, because CloudFront may read objects but not list the bucket. CloudFront maps that `403`, and any `404`, to your `/404.html` with status `404`, or to `/index.html` with `200` in [`spa` mode](/guides/single-page-apps/). Two caches are involved:

- **The error response for that path.** CloudFront caches it for the error caching minimum TTL, which blogwright sets to 10 seconds (CloudFront's default). S3's error carries no `Cache-Control`, so your rules cannot lengthen it. When a deploy later publishes a page at that path, the path counts as changed and is invalidated anyway.
- **The `/404.html` file itself.** CloudFront fetches it like any other file, so it gets the `Cache-Control` of the rule that matches `/404.html`. CloudFront serves this page for every missing path. Keep it, and `/index.html` in `spa` mode, at `max-age=0` so a browser never holds on to a "not found" for a page you are about to publish. The default catch-all already does this.

The cache policy (`CachingOptimized`) and the 10-second error TTL are not configurable today.

## When the rules change

S3 writes `Cache-Control` only when a file is uploaded, and a deploy skips unchanged files. To keep live files current, each successful build records the rules it applied at `build/cache-control/<target>.json` (`site.json`, or `preview-<id>.json` for a preview). When the next `deploy`, `rollback` or `preview deploy` to that target finds different rules, it re-uploads every file, as `--refresh` would, and logs:

```
cacheControl rules differ from the ones this target's files were written with - re-uploading every file so unchanged ones get the new Cache-Control too (an implicit --refresh)
```

Every path then counts as changed, so the invalidation covers the whole site (or `/*` past `invalidationMaxPaths`). This happens once, on the first deploy after upgrading to a blogwright version with `cacheControl`, so that existing files get the defaults. A failed build does not update the record, so the next build tries again.
