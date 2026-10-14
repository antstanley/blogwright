# Nuxt, server-rendered

Nuxt 4 with Nitro's `node-server` preset, running on Lambda Web Functions.

## What matters

- `nuxt.config.ts` - the `node-server` preset (Nuxt's default), which writes a standalone server to `.output/server` with the dependencies it needs copied in as real files.
- `lambda.mjs` - the entry shim: maps `AWS_LAMBDA_HTTP_ENDPOINT` onto `NITRO_HOST` and `NITRO_PORT` and imports `index.mjs`. The build copies it into `.output/server/`.
- `pnpm-workspace.yaml` - `allowBuilds` approves esbuild's install script. pnpm 11 fails an install that runs into an unapproved one, in the builder as much as locally.
- `config/production.jsonc` - packages `.output/server`; `staticDir`/`staticPaths` publish `/_nuxt/` from `.output/public` to S3.

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
cp -R .output/server /tmp/pkg && cd /tmp/pkg
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node lambda.mjs
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find .output/server -type l` must print nothing: the build agent rejects a package that contains a symbolic link.
