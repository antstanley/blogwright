---
title: SvelteKit SSG
description: "SvelteKit with adapter-static, every page prerendered to HTML and served from S3 behind CloudFront."
sidebar:
  order: 4
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/sveltekit-ssg my-site
```

SvelteKit with `adapter-static`, every page prerendered to HTML at build time and served from S3.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| SvelteKit + `adapter-static` | Static site, prerendered | `paths.dist` | [`examples/sveltekit-ssg`](https://github.com/antstanley/blogwright/tree/main/examples/sveltekit-ssg) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/sveltekit-ssg my-site
   cd my-site && git init
   ```

2. Set `siteName` and `region` in `config/production.jsonc`.
3. Add Blogwright, then commit everything, including `pnpm-lock.yaml` - the builder installs with `--frozen-lockfile`:

   ```sh
   pnpm add -D blogwright
   git add -A && git commit -m "Start from the blogwright example"
   ```

4. Create the infrastructure: `pnpm exec blogwright bootstrap`
5. Build and publish: `pnpm exec blogwright deploy`

## What matters

- `src/routes/+layout.js` - `prerender = true` for every page, and `trailingSlash = 'always'` so `/about` is written as `build/about/index.html`. Without it SvelteKit writes `build/about.html`, and Blogwright's router - which resolves `/about` to `/about/index.html` - answers `404`.
- `vite.config.js` - SvelteKit 3 configuration lives in the `sveltekit()` Vite plugin. `adapter-static` with `fallback: '404.html'` writes the page the distribution answers misses with.
- `config/production.jsonc` - `paths.dist` is `build`.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "sveltekit-ssg",
  "paths": { "dist": "build" },
}
```

```js title="vite.config.js"
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      // Every page is prerendered to build/. The 404.html fallback is the page
      // Blogwright's distribution answers misses with (status 404).
      adapter: adapter({ fallback: '404.html' }),
    }),
  ],
});
```

```js title="src/routes/+layout.js"
// Prerender every page at build time.
export const prerender = true;
// Write /about as about/index.html: Blogwright's router resolves /about to
// /about/index.html, never to about.html.
export const trailingSlash = 'always';
```

```json title="package.json"
{
  "name": "blogwright-example-sveltekit-ssg",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^4.0.0",
    "@sveltejs/kit": "^3.0.1",
    "svelte": "^5.57.2",
    "vite": "^8.3.4"
  }
}
```

## Related pages

- [How URLs map to files](/guides/deploying/#how-urls-map-to-files) - why prerendered pages need `trailingSlash`
- [Examples overview](/examples/overview/) - every example, and the conventions they share
