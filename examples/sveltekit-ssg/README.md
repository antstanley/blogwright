# SvelteKit, prerendered (SSG)

SvelteKit with `adapter-static`, every page prerendered to HTML at build time.

## What matters

- `vite.config.js` - SvelteKit 3 configuration lives in the `sveltekit()` Vite plugin. `adapter-static` with `fallback: '404.html'` writes the page the distribution answers misses with.
- `src/routes/+layout.js` - `prerender = true` for every page, and `trailingSlash = 'always'`, so `/about` is written as `build/about/index.html`. Without it SvelteKit writes `build/about.html`, and Blogwright's router - which resolves `/about` to `/about/index.html` - answers `404`.
- `config/production.jsonc` - `paths.dist` is `build`.

## Deploy it

Copy this directory into a repository of its own, then:

```sh
pnpm add -D blogwright
pnpm exec blogwright bootstrap
pnpm exec blogwright deploy
```

Edit `siteName` and `region` in `config/production.jsonc` first. Commit `pnpm-lock.yaml`: the builder installs with `--frozen-lockfile`.
