---
title: Next.js SSR
description: "Next.js with output: standalone, running on a Lambda Web Function behind CloudFront."
sidebar:
  order: 9
---

Copy it into a new project:

```sh
pnpm dlx degit antstanley/blogwright/examples/nextjs-ssr my-site
```

Next.js with `output: 'standalone'`, running on a Lambda Web Function. Next serves its own assets, so nothing publishes to S3.

| Framework | Mode | Blogwright config | Source |
| --- | --- | --- | --- |
| Next.js standalone | Server-rendered | `ssr` | [`examples/nextjs-ssr`](https://github.com/antstanley/blogwright/tree/main/examples/nextjs-ssr) |

## Deploy it

1. Copy the example and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/nextjs-ssr my-site
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

- `pnpm-workspace.yaml` - `nodeLinker: hoisted`. Next copies traced `node_modules` entries into `.next/standalone` as it finds them, so pnpm's default symlink tree would come through as symbolic links, which the build agent rejects.
- `next.config.js` - `output: 'standalone'`, and `outputFileTracingRoot` pinned to this directory. Without it Next infers the root from the nearest lockfile above the project, and inside a larger repository nests the server at `.next/standalone/<path>/server.js`.
- `package.json` - the build copies `public/` and `.next/static/` into the standalone package (Next leaves them out), plus the shim. Next serves `/_next/static/` as `immutable`, so CloudFront caches it like any other cacheable response.
- `lambda.mjs` - the entry shim. It maps `AWS_LAMBDA_HTTP_ENDPOINT` onto `HOSTNAME` and `PORT`, then imports `server.js`.
  Blogwright can generate this shim instead: delete `lambda.mjs` and the build step that copies it, and set `"entryPoint": "server.js"` with `"shim": { "host": "HOSTNAME", "port": "PORT" }` in the `ssr` block. See [the entry shim](/guides/server-rendered-sites/#the-entry-shim).
- `config/production.jsonc` - packages `.next/standalone`, with no `staticDir`. If the app uses Server Actions, add your domain to `serverActions.allowedOrigins`: the app receives the endpoint's domain as `Host`.

## The files

```jsonc title="config/production.jsonc"
// Blogwright config for this example. Paths are relative to the repository
// root, so they assume this directory IS the repository - see README.md.
{
  "region": "us-east-1",
  "siteName": "nextjs-ssr",
  "ssr": {
    // Next serves public/ and /_next/static/ itself (the build copies them into
    // the package), so there is no staticDir.
    "packageDir": ".next/standalone",
    "entryPoint": "lambda.mjs",
  },
}
```

```js title="next.config.js"
/** @type {import('next').NextConfig} */
export default {
  // A self-contained server in .next/standalone, with the node_modules files it
  // traced copied in.
  output: 'standalone',
  // Trace from this directory, so server.js lands at .next/standalone/server.js
  // even when the project sits inside a larger repository.
  outputFileTracingRoot: import.meta.dirname,
};
```

```js title="lambda.mjs"
// Entry shim for Lambda Web Functions. Lambda passes the listen address in
// AWS_LAMBDA_HTTP_ENDPOINT; Next's standalone server reads HOSTNAME and PORT.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const colon = endpoint.lastIndexOf(':');
process.env.HOSTNAME = endpoint.slice(0, colon);
process.env.PORT = endpoint.slice(colon + 1);
await import('./server.js');
```

```yaml title="pnpm-workspace.yaml"
# A workspace of its own, so pnpm treats this directory as the project root
# even inside the blogwright repository.
packages:
  - .

# Real files instead of pnpm's symlink tree: Next copies node_modules into
# .next/standalone as it finds them, and Blogwright rejects a package that
# contains a symbolic link.
nodeLinker: hoisted
```

```json title="package.json"
{
  "name": "blogwright-example-nextjs-ssr",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build && cp -R public .next/standalone/ && cp -R .next/static .next/standalone/.next/ && cp lambda.mjs .next/standalone/"
  },
  "dependencies": {
    "next": "^16.4.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  }
}
```

## Check the package locally

Run it the way Lambda does - from a copy outside the project, so nothing resolves from its own `node_modules`:

```sh
pnpm build
cp -R .next/standalone /tmp/pkg && cd /tmp/pkg
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node lambda.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find .next/standalone -type l` must print nothing: the build agent rejects a package that contains a symbolic link.

## Related pages

- [Server-rendered sites: Next.js](/guides/server-rendered-sites/#nextjs-standalone-output) - the full recipe and its options
- [Examples overview](/examples/overview/) - every example, and the conventions they share
