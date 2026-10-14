---
title: Astro SSR
description: "Astro with @astrojs/node in standalone mode, running on a Lambda Web Function behind CloudFront."
sidebar:
  order: 3
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/astro-ssr my-site
```

Astro with `@astrojs/node` in standalone mode, running on a Lambda Web Function. Fingerprinted `/_astro/` assets still serve from S3.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| Astro + `@astrojs/node` | Server-rendered | `ssr` | [`examples/astro-ssr`](https://github.com/antstanley/blogwright/tree/main/examples/astro-ssr) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/astro-ssr my-site
   cd my-site && git init
   ```

2. Set `siteName` and `region` in `config/production.jsonc`. For SSR, `region` must be `us-east-1`, `us-east-2`, `us-west-2`, `ap-northeast-1` or `eu-west-1`.
3. Add Blogwright, then commit everything, including `pnpm-lock.yaml` - the builder installs with `--frozen-lockfile`:

   ```sh
   pnpm add -D blogwright
   git add -A && git commit -m "Start from the blogwright example"
   ```

4. Create the infrastructure: `pnpm exec blogwright bootstrap`
5. Build and publish: `pnpm exec blogwright deploy`

## What matters

- `config/production.jsonc` - packages all of `dist/`, not `dist/server/`. `@astrojs/node` finds its files by walking up to a directory named `server`, and fails to start when the entry sits at the package root, so `entryPoint` is `server/entry.mjs`.
- `astro.config.mjs` - `output: 'server'`, the Node adapter in `standalone` mode, and `vite.ssr.noExternal: true`, which bundles every dependency into `dist/server` so the package needs no `node_modules`.
- `site` in `astro.config.mjs` is the public origin. The app receives the endpoint's domain as `Host`, so build absolute URLs from `Astro.site`.
- `ssr.shim` in `config/production.jsonc` - Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`, and Astro's standalone server reads `HOST` and `PORT`. With `shim` naming them, Blogwright adds an entry shim beside `entry.mjs` that copies the address across, so the build needs no shim file or copy step. See [the entry shim](/guides/server-rendered-sites/#the-entry-shim).

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "astro-ssr",
  "ssr": {
    // The whole of dist/: @astrojs/node finds its files by walking up to a
    // directory named "server", so the package must keep dist/'s layout.
    "packageDir": "dist",
    "entryPoint": "server/entry.mjs",
    // Blogwright generates the entry shim: Astro's standalone server reads
    // HOST and PORT.
    "shim": { "host": "HOST", "port": "PORT" },
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg"],
  },
}
```

```js title="astro.config.mjs"
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // The app sees the Web Function endpoint's domain as Host, so absolute URLs
  // are built from `site` (Astro.site), not Astro.url.
  site: 'https://example.com',
  vite: {
    // Bundle every dependency into dist/server, so the package Blogwright
    // zips is self-contained: Lambda loads nothing outside it.
    ssr: { noExternal: true },
  },
});
```

```json title="package.json"
{
  "name": "blogwright-example-astro-ssr",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "devDependencies": {
    "@astrojs/node": "^11.1.7",
    "astro": "^7.3.8"
  }
}
```

## Check the package locally

Run it the way Lambda does - from a copy outside the project, so nothing resolves from its own `node_modules`. The generated shim is not in the build output, so set the variables it would:

```sh
pnpm build
cp -R dist /tmp/pkg && cd /tmp/pkg
HOST=127.0.0.1 PORT=8080 node server/entry.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find dist -type l` must print nothing: the build agent rejects a package that contains a symbolic link.

## Related pages

- [Server-rendered sites: Astro](/guides/server-rendered-sites/#astro-node-standalone) - the full recipe and its options
- [Examples overview](/examples/overview/) - every example, and the conventions they share
