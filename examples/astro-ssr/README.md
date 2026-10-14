# Astro, server-rendered

Astro with `@astrojs/node` in standalone mode, running on Lambda Web Functions.

## What matters

- `astro.config.mjs` - `output: 'server'`, the Node adapter in `standalone` mode, and `vite.ssr.noExternal: true`, which bundles every dependency into `dist/server` so the package needs no `node_modules`. `site` is the public origin: the app receives the endpoint's domain as `Host`, so build absolute URLs from `Astro.site`.
- `lambda.mjs` - the entry shim: maps `AWS_LAMBDA_HTTP_ENDPOINT` onto `HOST` and `PORT` and imports `entry.mjs`. The build copies it into `dist/server/`.
- `config/production.jsonc` - packages all of `dist/`, not `dist/server/`: `@astrojs/node` locates its files by walking up to a directory named `server`, and fails to start when the entry sits at the package root. `entryPoint` is therefore `server/lambda.mjs`. `staticDir`/`staticPaths` publish the fingerprinted `/_astro/` assets to S3.

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
cp -R dist /tmp/pkg && cd /tmp/pkg
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node server/lambda.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find dist -type l` must print nothing: the build agent rejects a package that contains a symbolic link.
