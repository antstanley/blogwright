# Astro, static

A stock Astro site with static output - the shape Blogwright's defaults are built for.

## What matters

- `astro.config.mjs` - static output (the default). Astro writes `/about` as `dist/about/index.html`, which is what Blogwright's router resolves `/about` to.
- `src/pages/404.astro` - becomes `dist/404.html`, the page the distribution answers misses with.
- `config/production.jsonc` - only `region` and `siteName`; the default `paths.dist` (`dist`) already matches.

## Deploy it

Copy this directory into a repository of its own, then:

```sh
pnpm add -D blogwright
pnpm exec blogwright bootstrap
pnpm exec blogwright deploy
```

Edit `siteName` and `region` in `config/production.jsonc` first. Commit `pnpm-lock.yaml`: the builder installs with `--frozen-lockfile`.
