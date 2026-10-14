---
title: Single-page apps
description: Serve a client-routed app from S3 and CloudFront - spa mode answers unknown paths with index.html so deep links load the app.
sidebar:
  order: 7
---

Add `"spa": true` to your config **before your first `bootstrap`**:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "spa": true,
}
```

A single-page app (SPA) is one `index.html` whose JavaScript router handles every path. With `spa: true`, a request for a path that has no file - `/settings/profile`, say - gets your `index.html` with a `200`, so a deep link or a page refresh loads the app and its router takes over.

:::caution
The not-found mapping is set on the CloudFront distribution **when it is created**. Changing `spa` on an existing static site and re-running `bootstrap` does not update it. Set `spa: true` before your first `bootstrap`.
:::

## Set up your framework

Your build must write an `index.html` at the root of its output directory.

| Framework | What to set | Output directory |
| --- | --- | --- |
| SvelteKit | `adapter-static` with `fallback: 'index.html'`, and `export const ssr = false` in the root `+layout.js` | `build` - set `"paths": { "dist": "build" }` |
| Vite (React, Vue, Solid, ...) | nothing - `vite build` writes `dist/index.html` | `dist`, the default |

The [SvelteKit SPA example](/examples/sveltekit-spa/) is a complete project you can copy.

App in a subdirectory of a larger repository? Set `paths.app` as well - see [Monorepos](/guides/monorepos/).

## How unknown paths are answered

Your files are served from a private S3 bucket through CloudFront. A request for a directory URL resolves to its index document (`/projects/` → `/projects/index.html`). A path with no file behind it makes S3 answer `403` or `404`, and `spa` decides what CloudFront does next:

| `spa` | Visitor gets |
| --- | --- |
| `false` (default) | Your site's `/404.html`, with status `404` |
| `true` | Your `/index.html`, with status `200` |

Real files still serve normally either way: `/assets/app.js` returns the file, not `index.html`.

## What else to know

- **PR previews ignore `spa`.** The shared preview distribution cannot route errors per pull request, so a deep link into a preview returns an error instead of the app. Start from the preview's root URL and navigate from there. See [PR previews](/guides/pr-previews/).
- **The sitemap has one entry.** Production sitemaps are built from the HTML files in your output, so an SPA's sitemap lists only `/`. See [robots.txt and sitemap.xml](/guides/deploying/#robotstxt-and-sitemapxml).
- **SPA and SSR do not mix.** `spa` and an `ssr` block are mutually exclusive. To render on the server, see [Server-rendered sites](/guides/server-rendered-sites/).

## Related pages

- [SvelteKit SPA example](/examples/sveltekit-spa/) - a complete project to copy
- [Monorepos](/guides/monorepos/) - building an app that lives in a subdirectory
- [Configuration reference: `spa`](/reference/configuration/#spa) - the key itself
