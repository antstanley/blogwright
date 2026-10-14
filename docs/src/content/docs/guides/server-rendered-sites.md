---
title: Server-rendered sites
description: Run an SSR framework on Lambda Web Functions behind your CloudFront distribution - config, packaging, caching, and per-framework recipes.
sidebar:
  order: 8
---

An `ssr` block turns the environment from a static site into a server-rendered one. The MicroVM build is unchanged; its output directory is packaged as a `.zip`, stored as a versioned object in the site bucket, and published as an immutable **Lambda Web Function revision**. The site's existing CloudFront distribution serves the endpoint as a private origin - IAM-authorized and signed by an origin access control - with a cache policy that caches exactly what the application marks cacheable. Static browser assets may still be published to `site/` and served from the existing S3 origin.

The application must be a standard port-listening Node HTTP server: it reads the host and port from `AWS_LAMBDA_HTTP_ENDPOINT` and starts listening. Blogwright does not rewrite, adapt or wrap it - frameworks that read their own listen variables need a small consumer-owned entry shim, documented below per framework.

This is the [Astro recipe](#astro-node-standalone) below:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  "ssr": {
    "packageDir": "dist",
    "entryPoint": "server/lambda.mjs",
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg"],
    // Add "cacheKeyHeaders": ["Authorization"] if cacheable responses vary by token.
  },
}
```

Every recipe on this page has a complete, buildable project in [Examples](/examples/overview/), each checked by running its package the way Lambda does.

## Getting started

1. Add the `ssr` block, and make your `pnpm build` emit the entry shim and a self-contained package (the [recipes](#recipes) show both per framework). [Run the package locally](#running-the-package-locally) once to check it starts.
2. Bootstrap. A new environment needs `blogwright bootstrap <env>`; an existing static one needs `blogwright bootstrap <env> --switch-mode`, after which the site answers `503` from a placeholder revision until step 3 finishes. Bootstrap creates the Web Function, its role and log groups, the origin access control and cache policy, and enables versioning on the bucket.
3. `blogwright deploy <env>` publishes the first real revision.

`deploy` refuses until step 2 has run. [Switching modes](/guides/deploying/#switching-modes) covers the way back to static and what it leaves behind.

## The config block

| Field | Default | What it does |
| --- | --- | --- |
| `packageDir` | `paths.dist` | Built output directory to package, repo-relative. |
| `entryPoint` | `index.js` | Entry file inside the package that starts the HTTP server. |
| `staticDir` | none | Repo-relative directory of static assets to keep publishing to `site/`. Each file is published at its path relative to `staticDir`, so the directory must mirror the URL layout: `staticDir/_astro/a.js` serves `/_astro/a.js`. Supplied with `staticPaths`; with neither, `site/` is left untouched. |
| `staticPaths` | `[]` | CloudFront path patterns (each beginning `/`) served from S3, in the order configured. Required with `staticDir`. |
| `cacheKeyHeaders` | `[]` | Viewer headers added to the SSR cache key. Every viewer header except `Host` reaches the application whether listed or not. `Authorization` is the usual entry. |
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

Lambda tells the process where to listen through one variable. Frameworks that read their own variable need a shim, which your build copies into the package:

```js
// lambda.mjs - Astro's standalone server reads HOST and PORT
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const colon = endpoint.lastIndexOf(':');
process.env.HOST = endpoint.slice(0, colon);
process.env.PORT = endpoint.slice(colon + 1);
await import('./entry.mjs');
```

Point `ssr.entryPoint` at the shim. The deploy runs `pnpm build` in the MicroVM, so the copy belongs in that script:

```json
{ "scripts": { "build": "astro build && cp lambda.mjs dist/server/" } }
```

The shim sits beside the framework's own entry so its relative import resolves inside the package; `entryPoint` is its path within `packageDir`.

Each recipe below shows where its framework's built entry lands, which variables its shim sets, and how its build keeps server dependencies inside the package.

## Running the package locally

Lambda starts the entry file with `AWS_LAMBDA_HTTP_ENDPOINT` set and expects it to listen within 10 seconds. Doing the same locally catches a wrong shim before a deploy does:

```sh
pnpm build
cp -R dist /tmp/pkg && cd /tmp/pkg                  # ssr.packageDir
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node server/lambda.mjs   # ssr.entryPoint
curl -i http://127.0.0.1:8080/
```

Copy the package out of the repository first: run in place, Node still finds the project's `node_modules` in the parent directories, so a missing dependency does not show. `find dist -type l` must print nothing - the build agent rejects a package that contains a symbolic link.

## The public origin

The application receives the Web Function endpoint's domain (`<id>.lambda-web.<region>.on.aws`) as `Host`, not your site's domain. CloudFront forwards every viewer header except `Host`, which it sets to the origin's domain as the endpoint requires. A framework that derives its own URL from `Host` therefore builds absolute links and redirects on the endpoint domain, and a cross-site request check that compares the browser's `Origin` with `Host` rejects form posts. Tell the application its public origin:

- **SvelteKit** - set `paths.origin` in the Vite config (SvelteKit 3), or `"env": { "ORIGIN": "https://example.com" }` (SvelteKit 2). Without it, form actions fail with `Cross-site POST form submissions are forbidden`.
- **Next.js** - add your domain to `serverActions.allowedOrigins` in `next.config`; Server Actions otherwise reject the mismatch.
- **Astro** - set `site` in `astro.config` and build absolute URLs from `Astro.site`, not `Astro.url`, which carries the endpoint domain. The default `security.checkOrigin` relies on the browser's `Sec-Fetch-Site` header, so it accepts same-site form posts.
- **Nuxt** and anything else - pass the origin through `ssr.env` and use it wherever the application builds absolute URLs.

## What the application can reach

The Web Function's execution role can write to its two log groups and do nothing else. An application that calls DynamoDB, S3 or any other AWS service from the server gets `AccessDenied`; there is no setting that widens the role, and Blogwright rewrites its policy on every bootstrap.

There is no secrets mechanism either. `ssr.env` values are literal and readable by anyone who can read the function's revisions or the deployment manifests in the bucket, so API keys and database passwords must not go there. An application that needs secrets or AWS access is not yet a fit for SSR mode.

## Logs

The server's standard output and standard error go to the log group `/<siteName>/<env>/web`, with an in-Region companion `/<siteName>/<env>/web.local`; retention is `retention.webFunctionDays`. Blogwright has no command that reads them - `blogwright logs <hash>` shows the MicroVM build that produced a package, not the running server - so use the AWS CLI:

```sh
aws logs tail /<siteName>/<env>/web --follow
```

### Stream them in a local viewer

For more than a terminal tail, use [watch-tail](https://github.com/antstanley/watch-tail). It streams CloudWatch logs into a web app on your machine, using the same AWS credentials as Blogwright:

```sh
npx watch-tail --region <region>                    # the region in your config
npx watch-tail --region <region> --profile <name>   # with a named AWS profile
```

1. It opens a browser window at `http://127.0.0.1:4517`.
2. Select `/<siteName>/<env>/web` in the sidebar.
3. Choose live tail, or a historic window when you are investigating something that already happened.

What it adds over `aws logs tail`:

- **Requests, not just lines.** Lines that share a request ID group into one expandable row.
- **A duration chart.** Historic windows plot request duration over time, coloured by severity. Drag across a spike to zoom in.
- **Readable JSON.** Structured log lines are syntax-coloured and expandable.
- **A local archive.** Streamed events are kept in a DuckDB file, so you can reopen them later, even offline.

It needs Node.js 22 or later, which Blogwright already requires. Press Ctrl+C to stop it.

## Recipes

### Astro (node standalone)

`output: 'server'` with `@astrojs/node` in `standalone` mode emits `dist/server/entry.mjs`, and `dist/client/` holds the browser assets. The shim and build script are the ones [above](#the-entry-shim). Example: [`examples/astro-ssr`](/examples/astro-ssr/).

```jsonc
{
  "ssr": {
    "packageDir": "dist",
    "entryPoint": "server/lambda.mjs",
    "staticDir": "dist/client",
    "staticPaths": ["/_astro/*", "/favicon.svg", "/robots.txt"],
  },
}
```

Package all of `dist/`, not `dist/server/`: the adapter finds its files by walking up from `entry.mjs` to a directory named `server`, and with `dist/server` as the package the entry sits at the archive root, so the server exits on start with `Could not find the server directory "server"`.

`dist/server/` imports Astro and your server dependencies from `node_modules` instead of bundling them, so a plain `astro build` is not self-contained. Either bundle them into the server output with `vite: { ssr: { noExternal: true } }` in `astro.config` - the example does, and its package needs no `node_modules` - or, for packages that cannot be bundled such as native addons, install production dependencies into `dist/server/node_modules` as real files in the build script before the agent packages it.

### SvelteKit (`adapter-node`)

`adapter-node` emits `build/`: `build/index.js` starts the server, `build/client/` holds the browser assets. The shim sets `HOST` and `PORT` as for Astro and imports `./index.js`. Example: [`examples/sveltekit-ssr`](/examples/sveltekit-ssr/); the prerendered and single-page modes are [`sveltekit-ssg`](/examples/sveltekit-ssg/) and [`sveltekit-spa`](/examples/sveltekit-spa/).

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

```json
{ "scripts": { "build": "vite build && cp lambda.mjs build/" } }
```

`build/` is self-contained only for what the adapter bundles: it bundles `devDependencies` and leaves `dependencies` as imports. Either list every runtime package under `devDependencies`, as the example does, or install `dependencies` into `build/node_modules` as real files in the build script. Set the [public origin](#the-public-origin) too, or form actions fail.

### Nuxt (Nitro node-server preset)

`nitro.preset: 'node-server'` emits `.output/server/index.mjs` with `.output/public` for the client. Nitro reads `NITRO_HOST`/`NITRO_PORT` (and `HOST`/`PORT`); the port is only known at runtime, so map the endpoint onto those in the shim rather than `ssr.env`, and import `./index.mjs`. Example: [`examples/nuxt-ssr`](/examples/nuxt-ssr/).

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

### TanStack Start (Nitro)

TanStack Start builds through Nitro's Vite plugin. With `nitro({ preset: 'node-server' })` after `tanstackStart()` in `vite.config.ts`, `vite build` emits `.output/server/index.mjs` and `.output/public` - the same layout and the same `NITRO_HOST`/`NITRO_PORT` shim as Nuxt. Example: [`examples/tanstack-start-ssr`](/examples/tanstack-start-ssr/).

```jsonc
{
  "ssr": {
    "packageDir": ".output/server",
    "entryPoint": "lambda.mjs",
    "staticDir": ".output/public",
    "staticPaths": ["/assets/*", "/favicon.svg"],
  },
}
```

The server output is bundled and self-contained; the client assets are fingerprinted under `/assets/`.

### Next.js (standalone output)

`output: 'standalone'` emits `.next/standalone/server.js`, a server plus the `node_modules` files it traced. Next reads `PORT` and `HOSTNAME`, so the shim maps the endpoint onto those and imports `./server.js`. Example: [`examples/nextjs-ssr`](/examples/nextjs-ssr/).

```js
// lambda.mjs
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const colon = endpoint.lastIndexOf(':');
process.env.HOSTNAME = endpoint.slice(0, colon);
process.env.PORT = endpoint.slice(colon + 1);
await import('./server.js');
```

The standalone output leaves out `public/` and `.next/static/`. The simplest route copies them into the package so Next serves them; Next marks `/_next/static/` responses immutable, so CloudFront caches them like any other cacheable response:

```json
{
  "scripts": {
    "build": "next build && cp -R public .next/standalone/ && cp -R .next/static .next/standalone/.next/ && cp lambda.mjs .next/standalone/"
  }
}
```

```jsonc
{
  "ssr": {
    "packageDir": ".next/standalone",
    "entryPoint": "lambda.mjs",
  },
}
```

To serve them from S3 instead, `staticDir` must mirror the URL layout: have the build copy `.next/static` to `.next/s3/_next/static` (and `public/` into `.next/s3/`), then set `"staticDir": ".next/s3"` and `"staticPaths": ["/_next/static/*"]`. Pointing `staticDir` at `.next/static` itself publishes `/chunks/…` instead of `/_next/static/chunks/…`.

Under pnpm's default linker, Next copies the symlinks of pnpm's `node_modules` tree into `.next/standalone`, and the build agent rejects them. Set `nodeLinker: hoisted` in `pnpm-workspace.yaml` so the build installs, and Next copies, real files.

Next traces from the root it infers from the nearest lockfile, so in a monorepo - or any project with a lockfile in a parent directory - it nests the app under its path (`.next/standalone/apps/web/server.js`). Set `outputFileTracingRoot: import.meta.dirname` in `next.config` to keep `server.js` at the package root, or put the shim beside the nested `server.js` and point `entryPoint` at it. Set the [public origin](#the-public-origin) if the app uses Server Actions.

## Caching

The SSR behavior uses a Blogwright-managed cache policy: minimum TTL 0, default TTL 0, maximum TTL 31,536,000 seconds, every query string in the key, exactly the headers named in `cacheKeyHeaders`, cookies forwarded to the application but excluded from the key, and gzip/Brotli compression. What that means in practice:

- **A response is cached only when the application sends `Cache-Control` or `Expires`.** Uncached HTML stays uncached; no day-long default TTL is applied to it.
- `no-store` and `private` are never cached; `max-age=31536000, immutable` is cached at the edge for a year.
- Query strings always produce distinct cache entries.
- Each header in `cacheKeyHeaders` produces a distinct entry per value.
- **`Authorization` always reaches the application, but only varies the cache when listed.** CloudFront does not strip it: the origin-request policy forwards it on every method. With `cacheKeyHeaders` empty, a request carrying a token shares the anonymous cache entry, so an application whose cacheable responses depend on the token must either list `cacheKeyHeaders: ["Authorization"]`, which gives each token its own entry, or mark those responses `private` or `no-store`.
- A response whose first byte takes longer than 60 seconds is a CloudFront `504` whatever `timeoutSeconds` says. Values above 60 help only a response that keeps streaming.

The managed `CachingOptimized` policy is not applied to the SSR behavior: it ignores query strings, cannot key on the viewer `Authorization` header, and would apply an 86,400-second default TTL to responses the application did not mark cacheable. Static paths kept on S3 use `CachingOptimized` as usual.

Fingerprint your static asset names (Astro's `/_astro/`, SvelteKit's `/_app/`, Nuxt's `/_nuxt/`, Next's `/_next/` all do by default). A file that keeps its name across builds is overwritten at upload time, before the new revision serves, so only fingerprinted names switch together with the server.

## Inert settings in SSR mode

- `defaultRootObject` - the distribution root object is empty because the application answers `/`.
- `invalidationMaxPaths` - applies only to a deploy that publishes `staticDir` changes without a new revision; a new revision invalidates `/*`.
- `seo` - Blogwright writes no `robots.txt` or `sitemap.xml`. The application serves them, or the build puts them in `staticDir` and lists them in `staticPaths` (as the Astro recipe does for `robots.txt`). A `seo` key written in the config with a non-`off` value warns once per deploy.

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
| Execution role | Writes to its own log groups only - see [What the application can reach](#what-the-application-can-reach) |
| Revisions retained | Lambda removes the oldest revisions no endpoint routes to once a function exceeds 50, so a rolled-back revision is recreated from its retained artifact |

The builder MicroVM is Arm64 in every environment, static included, so the build toolchain and any native dependency it installs match the Web Function runtime.

## Related pages

- [Deploying](/guides/deploying/) - the full deploy and rollback lifecycle, and switching modes
- [Configuration](/reference/configuration/) - the `ssr` block in the key reference
- [Architecture](/reference/architecture/) - the nodes, bucket layout and distribution shape
- [CI deploys with GitHub OIDC](/guides/ci-github-oidc/) - what the deploy role may do in SSR mode
- [Troubleshooting](/guides/troubleshooting/) - cold starts, `403`s, missing entry points, `Failed` revisions
