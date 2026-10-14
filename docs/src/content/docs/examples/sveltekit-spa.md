---
title: SvelteKit SPA
description: "SvelteKit as a single-page app: one shell page from S3, routed in the browser, with spa mode answering unknown paths."
sidebar:
  order: 5
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/sveltekit-spa my-site
```

SvelteKit with `adapter-static` and SSR off: one shell page, routed in the browser.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| SvelteKit + `adapter-static` | Single-page app | `paths.dist`, `spa` | [`examples/sveltekit-spa`](https://github.com/antstanley/blogwright/tree/main/examples/sveltekit-spa) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/sveltekit-spa my-site
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

- `config/production.jsonc` - `paths.dist` is `build` and `spa` is `true`. Set `spa` before the first `bootstrap`: the error-page mapping is applied when the distribution is created.
- `vite.config.js` - `adapter-static` with `fallback: 'index.html'`. `spa: true` answers every path with no object in S3 with `/index.html` (status `200`), so the fallback must be `index.html`.
- `src/routes/+layout.js` - `ssr = false`: pages render in the browser only.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "sveltekit-spa",
  "paths": { "dist": "build" },
  // Set before the first bootstrap: misses answer /index.html with a 200.
  "spa": true,
}
```

```js title="vite.config.js"
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      // One shell page for every route. Blogwright's `spa: true` answers any
      // path with no object in S3 with /index.html, so the fallback must be
      // index.html.
      adapter: adapter({ fallback: 'index.html' }),
    }),
  ],
});
```

```js title="src/routes/+layout.js"
// Render in the browser only; the router takes over from index.html.
export const ssr = false;
```

```json title="package.json"
{
  "name": "blogwright-example-sveltekit-spa",
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

- [Single-page apps](/guides/single-page-apps/) - how `spa` mode answers unknown paths
- [Examples overview](/examples/overview/) - every example, and the conventions they share
