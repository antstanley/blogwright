# SvelteKit, single-page app

SvelteKit with `adapter-static` and SSR off: one shell page, routed in the browser.

## What matters

- `vite.config.js` - `adapter-static` with `fallback: 'index.html'`. Blogwright's `spa: true` answers every path with no object in S3 with `/index.html` (status `200`), so the fallback must be `index.html`.
- `src/routes/+layout.js` - `ssr = false`: pages render in the browser only.
- `config/production.jsonc` - `paths.dist` is `build` and `spa` is `true`. Set `spa` before the first `bootstrap`: the error-page mapping is applied when the distribution is created.

## Deploy it

Copy this directory into a repository of its own, then:

```sh
pnpm add -D blogwright
pnpm exec blogwright bootstrap
pnpm exec blogwright deploy
```

Edit `siteName` and `region` in `config/production.jsonc` first. Commit `pnpm-lock.yaml`: the builder installs with `--frozen-lockfile`.
