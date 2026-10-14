# SvelteKit, server-rendered

SvelteKit with `adapter-node`, running on Lambda Web Functions.

## What matters

- `vite.config.js` - `adapter-node`, and `paths.origin`, the public origin. The app receives the endpoint's domain as `Host`, so without it SvelteKit's CSRF check rejects form actions (`Cross-site POST form submissions are forbidden`). Replace `https://example.com` with your domain.
- `package.json` - every package is a `devDependency`, so `adapter-node` bundles it into `build/` and the package needs no `node_modules`. A package listed under `dependencies` stays an import and would have to be installed into `build/node_modules` as real files.
- `ssr.shim` in `config/production.jsonc` - Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`, and adapter-node's server reads `HOST` and `PORT`. With `shim` naming them, Blogwright adds an entry shim beside `index.js` that copies the address across, so the build needs no shim file or copy step. See [the entry shim](https://blogwright.iamstan.dev/guides/server-rendered-sites/#the-entry-shim).
- `config/production.jsonc` - packages `build/`; `staticDir`/`staticPaths` publish the fingerprinted `/_app/` assets to S3.

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
cp -R build /tmp/pkg && cd /tmp/pkg
HOST=127.0.0.1 PORT=8080 node index.js
curl -i http://127.0.0.1:8080/
```

The server must start listening within 10 seconds, and `find build -type l` must print nothing: the build agent rejects a package that contains a symbolic link.
