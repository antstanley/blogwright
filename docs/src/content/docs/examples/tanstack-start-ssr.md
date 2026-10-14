---
title: TanStack Start SSR
description: "TanStack Start built through Nitro's node-server preset, running on a Lambda Web Function behind CloudFront."
sidebar:
  order: 8
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/tanstack-start-ssr my-site
```

TanStack Start (React) built through Nitro's `node-server` preset, running on a Lambda Web Function. Fingerprinted `/assets/` still serve from S3.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| TanStack Start (React) + Nitro | Server-rendered | `ssr` | [`examples/tanstack-start-ssr`](https://github.com/antstanley/blogwright/tree/main/examples/tanstack-start-ssr) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/tanstack-start-ssr my-site
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

- `vite.config.ts` - the `tanstackStart()` plugin, then `nitro({ preset: 'node-server' })`, which writes a standalone server to `.output/server` and the browser assets to `.output/public`, then React's plugin.
- `src/routes/index.tsx` - a server function supplies the render timestamp, so the page proves it ran on the server.
- `ssr.shim` in `config/production.jsonc` - Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`, and Nitro's node-server reads `NITRO_HOST` and `NITRO_PORT`. With `shim` naming them, Blogwright adds an entry shim beside `index.mjs` that copies the address across, so the build needs no shim file or copy step. See [the entry shim](/guides/server-rendered-sites/#the-entry-shim).
- `pnpm-workspace.yaml` - `allowBuilds` approves esbuild's install script, which pnpm 11 otherwise fails the install on.
- `config/production.jsonc` - packages `.output/server`. `staticDir` and `staticPaths` publish the fingerprinted `/assets/` to S3.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "tanstack-start-ssr",
  "ssr": {
    "packageDir": ".output/server",
    "entryPoint": "index.mjs",
    // Blogwright generates the entry shim: Nitro's node-server reads
    // NITRO_HOST and NITRO_PORT.
    "shim": { "host": "NITRO_HOST", "port": "NITRO_PORT" },
    "staticDir": ".output/public",
    "staticPaths": ["/assets/*", "/favicon.svg"],
  },
}
```

```ts title="vite.config.ts"
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackStart(),
    // Nitro's node-server preset writes a standalone Node server to
    // .output/server and the browser assets to .output/public.
    nitro({ preset: 'node-server' }),
    // React's plugin must come after Start's.
    viteReact(),
  ],
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
  "name": "blogwright-example-tanstack-start-ssr",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build"
  },
  "dependencies": {
    "@tanstack/react-router": "^1.170.44",
    "@tanstack/react-start": "^1.169.1",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "nitro": "3.0.260903-beta",
    "vite": "^8.3.4"
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

- [Server-rendered sites: TanStack Start](/guides/server-rendered-sites/#tanstack-start-nitro) - the full recipe and its options
- [Examples overview](/examples/overview/) - every example, and the conventions they share
