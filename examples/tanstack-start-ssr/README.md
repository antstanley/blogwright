# TanStack Start, server-rendered

TanStack Start (React) built through Nitro's `node-server` preset, running on Lambda Web Functions.

## What matters

- `vite.config.ts` - the `tanstackStart()` plugin, then `nitro({ preset: 'node-server' })`, which writes a standalone server to `.output/server` and the browser assets to `.output/public`, then React's plugin.
- `src/routes/index.tsx` - a server function supplies the render timestamp, so the page proves it ran on the server.
- `ssr.shim` in `config/production.jsonc` - Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`, and Nitro's node-server reads `NITRO_HOST` and `NITRO_PORT`. With `shim` naming them, Blogwright adds an entry shim beside `index.mjs` that copies the address across, so the build needs no shim file or copy step. See [the entry shim](https://blogwright.iamstan.dev/guides/server-rendered-sites/#the-entry-shim).
- `pnpm-workspace.yaml` - `allowBuilds` approves esbuild's install script, which pnpm 11 otherwise fails the install on.
- `config/production.jsonc` - packages `.output/server`; `staticDir`/`staticPaths` publish the fingerprinted `/assets/` to S3.

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
cp -R .output/server /tmp/pkg && cd /tmp/pkg
NITRO_HOST=127.0.0.1 NITRO_PORT=8080 node index.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find .output/server -type l` must print nothing: the build agent rejects a package that contains a symbolic link.
