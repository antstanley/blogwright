---
title: Nuxt SSR
description: "Nuxt 4 with Nitro's node-server preset, running on a Lambda Web Function behind CloudFront."
sidebar:
  order: 7
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/nuxt-ssr my-site
```

Nuxt 4 with Nitro's `node-server` preset, running on a Lambda Web Function. `/_nuxt/` assets still serve from S3.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| Nuxt 4 (Nitro `node-server`) | Server-rendered | `ssr` | [`examples/nuxt-ssr`](https://github.com/antstanley/blogwright/tree/main/examples/nuxt-ssr) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/nuxt-ssr my-site
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

- `nuxt.config.ts` - the `node-server` preset (Nuxt's default), which writes a standalone server to `.output/server` with the dependencies it needs copied in as real files.
- `ssr.shim` in `config/production.jsonc` - Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`, and Nitro's node-server reads `NITRO_HOST` and `NITRO_PORT`. With `shim` naming them, Blogwright adds an entry shim beside `index.mjs` that copies the address across, so the build needs no shim file or copy step. See [the entry shim](/guides/server-rendered-sites/#the-entry-shim).
- `pnpm-workspace.yaml` - `allowBuilds` approves esbuild's install script. pnpm 11 fails an install that meets an unapproved one, in the builder as much as locally.
- `config/production.jsonc` - packages `.output/server`. `staticDir` and `staticPaths` publish `/_nuxt/` from `.output/public` to S3.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "nuxt-ssr",
  "ssr": {
    "packageDir": ".output/server",
    "entryPoint": "index.mjs",
    // Blogwright generates the entry shim: Nitro's node-server reads
    // NITRO_HOST and NITRO_PORT.
    "shim": { "host": "NITRO_HOST", "port": "NITRO_PORT" },
    "staticDir": ".output/public",
    "staticPaths": ["/_nuxt/*", "/favicon.svg"],
  },
}
```

```ts title="nuxt.config.ts"
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  // The default preset: a standalone Node server in .output/server.
  nitro: { preset: 'node-server' },
  app: {
    head: { link: [{ rel: 'icon', href: '/favicon.svg' }] },
  },
});
```

```yaml title="pnpm-workspace.yaml"
# A workspace of its own, so pnpm treats this directory as the project root
# even inside the blogwright repository.
packages:
  - .

allowBuilds:
  # esbuild's postinstall installs its platform binary.
  esbuild: true
```

```json title="package.json"
{
  "name": "blogwright-example-nuxt-ssr",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "nuxt": "^4.6.1",
    "vue": "^3.5.0",
    "vue-router": "^4.5.0"
  }
}
```

## Check the package locally

Run it the way Lambda does - from a copy outside the project, so nothing resolves from its own `node_modules`. The generated shim is not in the build output, so set the variables it would:

```sh
pnpm build
cp -R .output/server /tmp/pkg && cd /tmp/pkg
NITRO_HOST=127.0.0.1 NITRO_PORT=8080 node index.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find .output/server -type l` must print nothing: the build agent rejects a package that contains a symbolic link.

## Related pages

- [Server-rendered sites: Nuxt](/guides/server-rendered-sites/#nuxt-nitro-node-server-preset) - the full recipe and its options
- [Examples overview](/examples/overview/) - every example, and the conventions they share
