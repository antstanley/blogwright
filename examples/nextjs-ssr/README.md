# Next.js, server-rendered

Next.js with `output: 'standalone'`, running on Lambda Web Functions.

## What matters

- `next.config.js` - `output: 'standalone'`, and `outputFileTracingRoot` pinned to this directory. Without it Next infers the root from the nearest lockfile above the project, and inside a larger repository nests the server at `.next/standalone/<path>/server.js`.
- `pnpm-workspace.yaml` - `nodeLinker: hoisted`. Next copies traced `node_modules` entries into `.next/standalone` as it finds them, so pnpm's default symlink tree comes through as symbolic links, which the build agent rejects.
- `package.json` - the build copies `public/` and `.next/static/` into the standalone package (Next leaves them out) and Next serves them itself, `/_next/static/` as `immutable`, so CloudFront caches them like any other cacheable response. It also copies the shim in.
- `lambda.mjs` - the entry shim: maps `AWS_LAMBDA_HTTP_ENDPOINT` onto `HOSTNAME` and `PORT` and imports `server.js`.
  Blogwright can generate this shim instead: delete `lambda.mjs` and the build step that copies it, and set `"entryPoint": "server.js"` with `"shim": { "host": "HOSTNAME", "port": "PORT" }` in the `ssr` block. See [the entry shim](https://blogwright.iamstan.dev/guides/server-rendered-sites/#the-entry-shim).
- `config/production.jsonc` - packages `.next/standalone`; no `staticDir`, since Next serves its own assets. If the app uses Server Actions, add your domain to `serverActions.allowedOrigins`: the app receives the endpoint's domain as `Host`.

## Deploy it

Copy this directory into a repository of its own, then:

```sh
pnpm add -D blogwright
pnpm exec blogwright bootstrap
pnpm exec blogwright deploy
```

Edit `siteName` and `region` in `config/production.jsonc` first (`region` must be a Web Function launch region). Commit `pnpm-lock.yaml`: the builder installs with `--frozen-lockfile`. SSR needs a Blogwright release with the `ssr` config block; see [Server-rendered sites](https://blogwright.iamstan.dev/guides/server-rendered-sites/).

## Check the package locally

Run it the way Lambda does - from a copy outside the repository, so nothing resolves from the project's own `node_modules`:

```sh
pnpm build
cp -R .next/standalone /tmp/pkg && cd /tmp/pkg
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node lambda.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find .next/standalone -type l` must print nothing: the build agent rejects a package that contains a symbolic link.
