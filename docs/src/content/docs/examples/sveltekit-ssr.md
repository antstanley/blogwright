---
title: SvelteKit SSR
description: "SvelteKit with adapter-node, running on a Lambda Web Function behind CloudFront."
sidebar:
  order: 6
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/sveltekit-ssr my-site
```

SvelteKit with `adapter-node`, running on a Lambda Web Function. Fingerprinted `/_app/` assets still serve from S3.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| SvelteKit + `adapter-node` | Server-rendered | `ssr` | [`examples/sveltekit-ssr`](https://github.com/antstanley/blogwright/tree/main/examples/sveltekit-ssr) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/sveltekit-ssr my-site
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

- `vite.config.js` - `adapter-node`, and `paths.origin` set to the public origin. The app receives the endpoint's domain as `Host`, so without it SvelteKit's CSRF check rejects form actions (`Cross-site POST form submissions are forbidden`). Replace `https://example.com` with your domain.
- `package.json` - every package is a `devDependency`, so `adapter-node` bundles it into `build/` and the package needs no `node_modules`. A package under `dependencies` stays an import and would have to be installed into `build/node_modules` as real files.
- `lambda.mjs` - the entry shim. It maps `AWS_LAMBDA_HTTP_ENDPOINT` onto `HOST` and `PORT`, then imports `index.js`. The build copies it into `build/`.
  Blogwright can generate this shim instead: delete `lambda.mjs` and the build step that copies it, and set `"entryPoint": "index.js"` with `"shim": { "host": "HOST", "port": "PORT" }` in the `ssr` block. See [the entry shim](/guides/server-rendered-sites/#the-entry-shim).
- `config/production.jsonc` - packages `build/`. `staticDir` and `staticPaths` publish the fingerprinted `/_app/` assets to S3.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "sveltekit-ssr",
  "ssr": {
    "packageDir": "build",
    "entryPoint": "lambda.mjs",
    "staticDir": "build/client",
    "staticPaths": ["/_app/*", "/favicon.svg"],
  },
}
```

```js title="vite.config.js"
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      paths: {
        // The app sees the Web Function endpoint's domain as Host, so form
        // actions need the public origin to pass SvelteKit's CSRF check.
        origin: 'https://example.com',
      },
    }),
  ],
});
```

```js title="lambda.mjs"
// Entry shim for Lambda Web Functions. Lambda passes the listen address in
// AWS_LAMBDA_HTTP_ENDPOINT; adapter-node's server reads HOST and PORT.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const colon = endpoint.lastIndexOf(':');
process.env.HOST = endpoint.slice(0, colon);
process.env.PORT = endpoint.slice(colon + 1);
await import('./index.js');
```

```json title="package.json"
{
  "name": "blogwright-example-sveltekit-ssr",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build && cp lambda.mjs build/",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^6.0.0",
    "@sveltejs/kit": "^3.0.1",
    "svelte": "^5.57.2",
    "vite": "^8.3.4"
  }
}
```

## Check the package locally

Run it the way Lambda does - from a copy outside the project, so nothing resolves from its own `node_modules`:

```sh
pnpm build
cp -R build /tmp/pkg && cd /tmp/pkg
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node lambda.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find build -type l` must print nothing: the build agent rejects a package that contains a symbolic link.

## Related pages

- [Server-rendered sites: SvelteKit](/guides/server-rendered-sites/#sveltekit-adapter-node) - the full recipe and its options
- [Examples overview](/examples/overview/) - every example, and the conventions they share
