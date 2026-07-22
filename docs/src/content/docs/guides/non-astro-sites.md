---
title: "Beyond Astro: SPAs & monorepos"
description: Deploy any static site that builds via pnpm build — SvelteKit or Vite SPAs, monorepo subdirectories, and sites with pre-built artifacts.
sidebar:
  order: 7
---

blogwright is not tied to Astro. The builder MicroVM runs `pnpm install && pnpm build` and publishes an output directory — any static site that builds that way works: an Astro blog at the repo root, a SvelteKit or Vite SPA in a monorepo subdirectory, or a site whose heavy artifacts are built before the deploy even starts. Three config options cover the differences: `paths.app`/`paths.dist`, `spa`, and `sourceInclude`.

## What the builder actually runs

Inside the MicroVM, the build agent extracts your source zip into a work directory, then runs:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm run build
```

Both commands run in `paths.app`. The install uses `--frozen-lockfile`, so a committed `pnpm-lock.yaml` is required, and `--prod=false` forces a full install — the builder image bakes `NODE_ENV=production` (right for the build itself), but under it pnpm would skip `devDependencies`, which is where static sites keep their build tooling (astro, vite, tailwind).

After the build, the agent syncs `paths.dist` to the bucket's `site/` prefix. See [Deploying](/guides/deploying/) for the full pipeline.

## Building in a subdirectory: `paths.app` and `paths.dist`

Two path options control where the build runs and what gets published:

- **`paths.app`** (default `"."`) — the directory the MicroVM builds in. `"."` for an app at the repo root; a subdirectory name for a monorepo.
- **`paths.dist`** (default `"dist"`) — the built output directory the MicroVM publishes, relative to the **repo root** (not to `paths.app`).

A SvelteKit SPA living in `web/` inside a monorepo:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "paths": { "app": "web", "dist": "web/build" },
  "spa": true,
}
```

Both values must be repo-relative without `..`, and both are resolved strictly inside the build's work directory — the config is rejected otherwise. The source zip always contains the whole repo (the VCS file listing, minus `sourceIgnore` prefixes), so a workspace app can still install shared packages from the monorepo root.

## SPA mode: `spa: true`

The site is served from the private S3 REST endpoint through CloudFront (via Origin Access Control), and a viewer-request function resolves directory URLs to their index document (`/projects/` → `/projects/index.html`). A client-side route like `/settings/profile` has no object in S3, so the origin answers 403/404.

What CloudFront does with that miss is decided by `spa` (default `false`):

- **`spa: false`** — origin 403/404 responses map to the site's `/404.html` with a 404 status.
- **`spa: true`** — they map to `/index.html` with a **200**, so deep links into client-side routes load the app and let its router take over.

:::caution
The error-response mapping is applied to the main CloudFront distribution **when it is created**. Set `spa: true` before running `bootstrap`.
:::

:::note
PR previews are unaffected by `spa` — the shared preview distribution's error responses cannot be host-routed per PR. See [PR previews](/guides/pr-previews/).
:::

## Shipping pre-built artifacts: `sourceInclude`

The source zip honors `.gitignore`, which is normally what you want — but some sites need gitignored artifacts in the build: a wasm bundle compiled by Rust, generated data files. Building those inside the MicroVM would mean baking heavy toolchains (Rust, wasm-pack) into the builder image. Instead, they stay out of the builder entirely: a pre-deploy step produces them — locally or in CI — and `sourceInclude` zips them into the deploy source anyway.

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  // Gitignored, but produced by a pre-deploy step and shipped in the source zip:
  "sourceInclude": ["src/generated/search-index", "public/wasm"],
}
```

Each entry is a repo-relative directory (all files under it, recursively) or a single file, without `..`. Run the producing step before `blogwright deploy`; each entry must exist and be non-empty at deploy time. A forgotten pre-build fails the deploy fast — `sourceInclude path "…" is missing or empty — run the pre-deploy build that produces it before deploying` — instead of shipping a broken site.

The inverse knob, `sourceIgnore`, excludes extra path prefixes from the zip on top of `.gitignore` (default: `.jj/`, `.git/`, `node_modules/`, `dist/`, `.astro/`). Entries match an exact path or a directory boundary — `"dist"` drops `dist` and everything under it, never `dist-notes.md`.

## The Astro-shaped path defaults

The remaining `paths` defaults match a stock Astro project and are read by the `pds` commands for [standard.site publishing](/guides/publishing-standard-site/) — if you don't use a `pds` config section, they are inert:

| Option | Default | What it is |
| --- | --- | --- |
| `paths.publicDir` | `public` | The static-asset directory served at the site root |
| `paths.content` | `src/content/blog` | Content directory the pds sync enumerates for posts |
| `paths.atprotoJson` | `src/data/atproto.json` | JSON file the site imports to render its document `<link>` tags |

Override them when your site keeps static assets or content elsewhere. The OAuth client documents and the standard.site well-known file live at protocol-fixed URL paths under `publicDir`, so only the directory roots vary. The full option list lives in the [configuration reference](/reference/configuration/).

## robots.txt and sitemap.xml: `seo`

Site shape also affects what the deploy writes into the published output. The `seo` option controls robots/sitemap policy, with environment-aware defaults:

- **`seo.robots`** (default `"auto"`) — `auto` makes production indexable and blocks crawlers in every other environment; `index` / `noindex` force either regardless of environment; `off` leaves whatever robots.txt the build produced. `seo.robotsContent` overrides the body verbatim.
- **`seo.sitemap`** (default `"auto"`) — `auto` generates `sitemap.xml` in production and skips it elsewhere; `on` / `off` force it. Generation requires a resolvable site origin — a custom domain, or the CloudFront domain.

Both files are written into the output directory before the upload walk, so they publish and invalidate like any other page. The sitemap is built from the HTML pages in the built output (directory index documents map to their clean URL, `404.html` pages are excluded) — so a SPA that emits a single `index.html` gets a single-entry sitemap, while a prerendered site gets one entry per page.
