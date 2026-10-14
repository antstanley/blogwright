# Astro, server-rendered

Astro with `@astrojs/node` in standalone mode, running on Lambda Web Functions.

## What matters

- `astro.config.mjs` - `output: 'server'`, the Node adapter in `standalone` mode, and `vite.ssr.noExternal: true`, which bundles every dependency into `dist/server` so the package needs no `node_modules`. `site` is the public origin: the app receives the endpoint's domain as `Host`, so build absolute URLs from `Astro.site`.
- `ssr.shim` in `config/production.jsonc` - Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`, and Astro's standalone server reads `HOST` and `PORT`. With `shim` naming them, Blogwright adds an entry shim beside `entry.mjs` that copies the address across, so the build needs no shim file or copy step. See [the entry shim](https://blogwright.iamstan.dev/guides/server-rendered-sites/#the-entry-shim).
- `config/production.jsonc` - packages all of `dist/`, not `dist/server/`: `@astrojs/node` locates its files by walking up to a directory named `server`, and fails to start when the entry sits at the package root. `entryPoint` is therefore `server/entry.mjs`. `staticDir`/`staticPaths` publish the fingerprinted `/_astro/` assets to S3.

## Deploy it

Copy this directory into a repository of its own, then:

```sh
pnpm add -D blogwright
pnpm exec blogwright bootstrap
pnpm exec blogwright deploy
```

Edit `siteName` and `region` in `config/production.jsonc` first (`region` must be a Web Function launch region). Commit `pnpm-lock.yaml`: the builder installs with `--frozen-lockfile`. SSR needs a Blogwright release with the `ssr` config block and `ssr.shim`; see [Server-rendered sites](https://blogwright.iamstan.dev/guides/server-rendered-sites/).

## Check the package locally

Run it the way Lambda does - from a copy outside the repository, so nothing resolves from the project's own `node_modules`. The generated shim is not in the build output, so set the variables it would:

```sh
pnpm build
cp -R dist /tmp/pkg && cd /tmp/pkg
HOST=127.0.0.1 PORT=8080 node server/entry.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find dist -type l` must print nothing: the build agent rejects a package that contains a symbolic link.
