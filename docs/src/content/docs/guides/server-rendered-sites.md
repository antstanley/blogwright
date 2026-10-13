---
title: Server-rendered sites
description: Run an SSR framework on Lambda Web Functions behind your CloudFront distribution - config, packaging, caching, and per-framework recipes.
sidebar:
  order: 4
---

An `ssr` block turns the environment from a static site into a server-rendered one. The MicroVM build is unchanged; its output directory is packaged as a `.zip`, stored as a versioned object in the site bucket, and published as an immutable **Lambda Web Function revision**. The site's existing CloudFront distribution serves the endpoint as a private origin - IAM-authorized and signed by an origin access control - with a cache policy that caches exactly what the application marks cacheable. Static browser assets may still be published to `site/` and served from the existing S3 origin.

The application must be a standard port-listening Node HTTP server: it reads the host and port from `AWS_LAMBDA_HTTP_ENDPOINT` and starts listening. Blogwright does not rewrite, adapt or wrap it - frameworks that read their own listen variables need a small consumer-owned entry shim, documented below per framework.

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "ssr": {
    "entryPoint": "server/lambda.mjs",
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg"],
    // Add "cacheKeyHeaders": ["Authorization"] if viewers authenticate.
    "env": { "ORIGIN": "https://example.com" },
  },
}
```

## The config block

| Field | Default | What it does |
| --- | --- | --- |
| `packageDir` | `paths.dist` | Built output directory to package, repo-relative. |
| `entryPoint` | `index.js` | Entry file inside the package that starts the HTTP server. |
| `staticDir` | none | Repo-relative directory of static assets to keep publishing to `site/`. Supplied with `staticPaths`; with neither, `site/` is left untouched. |
| `staticPaths` | `[]` | CloudFront path patterns (each beginning `/`) served from S3, in the order configured. |
| `cacheKeyHeaders` | `[]` | Viewer headers included in the SSR cache key and forwarded to the app. `Authorization` is the usual entry. |
| `env` | `{}` | Literal environment variables baked into every revision. Never secrets; Lambda-reserved names are rejected at config load. |
| `timeoutSeconds` | `30` | Revision timeout, 3-900. See the timeout note below. |
| `maxConcurrencyPerEnvironment` | `64` | Concurrent requests each execution environment handles, 1-128. |

`ssr` and `spa: true` are mutually exclusive, and with `ssr` set `region` must be a Web Function launch region (`us-east-1`, `us-east-2`, `us-west-2`, `ap-northeast-1`, `eu-west-1`). Preview stacks do not support SSR - `preview bootstrap` and `preview deploy` refuse - and `blogwright delete` refuses too, because emptying `site/` cannot unpublish a revision.

## What must be true of the package

- The entry file exists at `ssr.entryPoint` inside the package and starts an HTTP server on the host and port in `AWS_LAMBDA_HTTP_ENDPOINT`. The build agent checks the first; only the readiness probe can check the second.
- The package is **self-contained**: Lambda loads nothing that is not in the archive. Framework-bundled output, or a directory your build has copied production dependencies into as real files. The build agent fails, naming the path, when the package contains a symbolic link - and pnpm's default `node_modules` is a symlink tree, so a package that merely sits beside the build's `node_modules` is not self-contained.
- The unzipped package is at most 512 MB.

The archive holds the package directory's contents at its root, with a fixed timestamp, so identical output produces identical bytes.

## The entry shim

Lambda tells the process where to listen through one variable. Frameworks that read their own variable need a shim, emitted into the package by your build:

```js
// server/lambda.mjs - Astro's standalone server reads HOST and PORT
const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');
process.env.HOST = host;
process.env.PORT = port;
await import('./entry.mjs');
```

Point `ssr.entryPoint` at the shim. Each recipe below shows where its framework's built entry lands and how its build keeps server dependencies inside the package.

## Recipes

### Astro (node standalone)

`output: 'server'` with `@astrojs/node` in `standalone` mode emits `dist/server/entry.mjs`, and `dist/client/` holds the browser assets.

```jsonc
{
  "ssr": {
    "packageDir": "dist/server",
    "entryPoint": "lambda.mjs",
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg", "/robots.txt"],
  },
}
```

`dist/server/` imports from Astro's `node_modules` packages, so a plain `astro build` is not self-contained under pnpm. Either keep the server bundled (a `vite` build with `ssr.noExternal` for the framework packages), or copy production dependencies into `dist/server/node_modules` with real files in a postbuild step before the agent packages it.

### SvelteKit (`adapter-node`)

`adapter-node` emits a self-contained `build/` directory - the adapter bundles the server and writes its own `package.json`:

```jsonc
{
  "ssr": {
    "packageDir": "build",
    "entryPoint": "lambda.mjs",
    "staticDir": "build/client",
    "staticPaths": ["/_app/*", "/favicon.png"],
  },
}
```

SvelteKit's `build/index.js` reads `HOST` and `PORT`, so the shim is the same mapping.

### Nuxt (Nitro node-server preset)

`nitro.preset: 'node-server'` emits `.output/server/index.mjs` with `.output/public` for the client. Nitro reads `NITRO_HOST`/`NITRO_PORT` (and `HOST`/`PORT`), so either map the endpoint onto those in the shim or set them through `ssr.env` - but the port is only known at runtime, so the shim is the reliable route.

```jsonc
{
  "ssr": {
    "packageDir": ".output/server",
    "entryPoint": "lambda.mjs",
    "staticDir": ".output/public",
    "staticPaths": ["/_nuxt/*", "/favicon.ico"],
  },
}
```

Nitro's output is bundled and self-contained; the client assets are fingerprinted under `/_nuxt/`.

### Next.js (standalone output)

`output: 'standalone'` emits `.next/standalone` (server plus a minimal `node_modules` as real files) and `.next/static` for the client. Next reads `PORT` and `HOSTNAME`:

```jsonc
{
  "ssr": {
    "packageDir": ".next/standalone",
    "entryPoint": "server.js",
    "env": { "HOSTNAME": "0.0.0.0" },
  },
}
```

`.next/standalone/server.js` already listens on `PORT`, so a shim that sets `process.env.PORT` before importing it is enough; copy `.next/static` into `.next/standalone/.next/static` in your build if you want Next to serve it, or publish it through `staticDir`/`staticPaths` to S3 instead.

## Caching

The SSR behavior uses a Blogwright-managed cache policy: minimum TTL 0, default TTL 0, maximum TTL 31,536,000 seconds, every query string in the key, exactly the headers named in `cacheKeyHeaders`, cookies forwarded to the application but excluded from the key, and gzip/Brotli compression. What that means in practice:

- **A response is cached only when the application sends `Cache-Control` or `Expires`.** Uncached HTML stays uncached; no day-long default TTL is applied to it.
- `no-store` and `private` are never cached; `max-age=31536000, immutable` is cached at the edge for a year.
- Query strings always produce distinct cache entries.
- Each header in `cacheKeyHeaders` produces distinct entries and is forwarded to the application.
- **`Authorization` on GET and HEAD is stripped by CloudFront unless it is in the cache key.** An application that authenticates viewers with bearer tokens must list `cacheKeyHeaders: ["Authorization"]`; doing so also splits the cache per token, which is the correct trade for authenticated traffic.
- A response whose first byte takes longer than 60 seconds is a CloudFront `504` whatever `timeoutSeconds` says. Values above 60 help only a response that keeps streaming.

The managed `CachingOptimized` policy is not applied to the SSR behavior: it ignores query strings, cannot forward the viewer `Authorization` header, and would apply an 86,400-second default TTL to responses the application did not mark cacheable. Static paths kept on S3 use `CachingOptimized` as usual.

Fingerprint your static asset names (Astro's `/_astro/`, SvelteKit's `/_app/`, Nuxt's `/_nuxt/`, Next's `/_next/` all do by default). A file that keeps its name across builds is overwritten at upload time, before the new revision serves, so only fingerprinted names switch together with the server.

## Inert settings in SSR mode

- `defaultRootObject` - the distribution root object is empty because the application answers `/`.
- `invalidationMaxPaths` - applies only to a deploy that publishes `staticDir` changes without a new revision; a new revision invalidates `/*`.
- `seo` - `robots.txt` and `sitemap.xml` are the application's routes. A `seo` key written in the config with a non-`off` value warns once per deploy.

## Revision-scoped settings

`entryPoint`, `env`, `timeoutSeconds` and `maxConcurrencyPerEnvironment` take effect at the next deploy, which creates a revision whenever any of them changed even if the built output did not. Changing them does not restart the running revision, and `bootstrap` never cuts one.

## Limits

| Limit | Value |
| --- | --- |
| Package size (unzipped) | 512 MB |
| Time to start listening | 10 seconds from process start |
| Memory per execution environment | 2 GB (1 GB default V8 heap) |
| Concurrent requests per environment | 1-128, default 64 |
| Revision timeout | 3-900 seconds (time to first byte bounded by the 60-second origin read timeout) |
| Runtime | Node.js 24 (`nodejs24.x`) on Arm64 |
| Revisions retained | Lambda removes the oldest revisions no endpoint routes to once a function exceeds 50, so a rolled-back revision is recreated from its retained artifact |

The builder MicroVM is Arm64 in every environment, static included, so the build toolchain and any native dependency it installs match the Web Function runtime.

## Related pages

- [Deploying](/guides/deploying/) - the full deploy and rollback lifecycle
- [Configuration](/reference/configuration/) - the `ssr` block in the key reference
- [Architecture](/reference/architecture/) - the nodes, bucket layout and distribution shape
- [Troubleshooting](/guides/troubleshooting/) - cold starts, `403`s, missing entry points, `Failed` revisions
