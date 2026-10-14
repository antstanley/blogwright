---
title: Monorepos
description: Deploy an app that lives in a subdirectory of a larger repository, with workspace packages and pre-built artifacts.
sidebar:
  order: 9
---

Set `paths.app` to your app's directory and `paths.dist` to its build output, measured from the repository root:

```jsonc
// config/production.jsonc - a SvelteKit SPA in web/
{
  "region": "us-east-1",
  "siteName": "example",
  "paths": { "app": "web", "dist": "web/build" },
  "spa": true,
}
```

Config stays at the repository root (`config/<env>.jsonc`), whichever directory the app is in.

## The two path settings

| Setting | Default | What it is |
| --- | --- | --- |
| `paths.app` | `"."` | The directory the builder runs `pnpm install` and `pnpm build` in. |
| `paths.dist` | `"dist"` | The build output the builder publishes, relative to the **repository root**, not to `paths.app`. |

Both must be repo-relative, with no `..`. The config is rejected if either resolves outside the build's work directory.

## What the builder runs

The builder MicroVM extracts your source zip, then runs these in `paths.app`:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm run build
```

- **Commit your lockfile.** `--frozen-lockfile` fails the install without an up-to-date `pnpm-lock.yaml`.
- **Dev dependencies are installed.** The builder sets `NODE_ENV=production`, which would make pnpm skip `devDependencies`, so `--prod=false` forces a full install. Build tools like astro, vite and tailwind usually live there.
- **pnpm's version comes from `packageManager`.** The builder enables pnpm through corepack, which installs the version your `package.json` names.
- **Approve install scripts.** pnpm 11 fails an install that meets a dependency build script nobody approved (`ERR_PNPM_IGNORED_BUILDS`). List the ones you need under `allowBuilds` in `pnpm-workspace.yaml` - esbuild's is the common one.

After the build, the output in `paths.dist` syncs to the site. See [Deploying](/guides/deploying/#building-in-the-microvm).

## Workspace packages

The source zip always contains the whole repository - every file git lists, minus `sourceIgnore` - not just `paths.app`. An app can install the shared packages it depends on from elsewhere in the monorepo with pnpm's `workspace:` protocol.

## Server-rendered apps in a subdirectory

Prefix the `ssr` paths with the app's directory, just like `paths.dist`. For a SvelteKit app in `web/`:

```jsonc
{
  "paths": { "app": "web" },
  "ssr": {
    "packageDir": "web/build",
    "entryPoint": "lambda.mjs",
    "staticDir": "web/build/client",
    "staticPaths": ["/_app/*", "/favicon.svg"],
  },
}
```

`entryPoint` stays relative to `packageDir`. See [Server-rendered sites](/guides/server-rendered-sites/).

## Ship pre-built artifacts

Some builds need files that git ignores: a wasm bundle compiled from Rust, generated data. Building them inside the MicroVM would mean baking heavy toolchains into the builder image. Instead, build them before deploying - locally or in CI - and list them in `sourceInclude`:

```jsonc
// config/production.jsonc
{
  "region": "us-east-1",
  "siteName": "example",
  // Gitignored, but produced by a pre-deploy step and shipped in the source zip:
  "sourceInclude": ["src/generated/search-index", "public/wasm"],
}
```

1. Run the step that produces the artifacts.
2. Run `blogwright deploy`.

Each entry is a repo-relative directory (everything under it) or a single file, with no `..`. Each must exist and be non-empty at deploy time. A forgotten pre-build stops the deploy with `sourceInclude path "…" is missing or empty - run the pre-deploy build that produces it before deploying`, instead of shipping a broken site.

### Leave files out: `sourceIgnore`

`sourceIgnore` drops extra path prefixes from the zip, on top of `.gitignore`. The default is `.jj/`, `.git/`, `node_modules/`, `dist/`, `.astro/`. An entry matches an exact path or a directory boundary: `"dist"` drops `dist` and everything under it, but never `dist-notes.md`. Setting it replaces the default list, so include the defaults you still want.

## Related pages

- [Single-page apps](/guides/single-page-apps/) - `spa` mode for client-routed apps
- [Examples](/examples/overview/#inside-a-larger-repository) - adapting an example to a subdirectory
- [Configuration reference](/reference/configuration/) - `paths`, `sourceInclude` and `sourceIgnore`
