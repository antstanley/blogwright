---
title: Astro static
description: "A stock Astro site with static output, deployed to S3 behind CloudFront with Blogwright's defaults."
sidebar:
  order: 2
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/astro-static my-site
```

A stock Astro site with static output - the shape Blogwright's defaults are built for. Nothing to configure beyond `region` and `siteName`.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| Astro | Static site | defaults | [`examples/astro-static`](https://github.com/antstanley/blogwright/tree/main/examples/astro-static) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/astro-static my-site
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

- `astro.config.mjs` - static output, the default. Astro writes `/about` as `dist/about/index.html`, which is what Blogwright's router resolves `/about` to.
- `src/pages/404.astro` - becomes `dist/404.html`, the page the distribution answers misses with.
- `config/production.jsonc` - only `region` and `siteName`. The default `paths.dist` (`dist`) already matches.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
// The defaults (paths.dist "dist") already match a stock Astro project.
{
  "region": "us-east-1",
  "siteName": "astro-static",
}
```

```js title="astro.config.mjs"
import { defineConfig } from 'astro/config';

// Static output (the default) writes /about as dist/about/index.html, which is
// what Blogwright's router resolves /about to.
export default defineConfig({
  site: 'https://example.com',
});
```

```json title="package.json"
{
  "name": "blogwright-example-astro-static",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "devDependencies": {
    "astro": "^7.3.8"
  }
}
```

## Related pages

- [Deploying](/guides/deploying/) - the full recipe and its options
- [Examples overview](/examples/overview/) - every example, and the conventions they share
