---
title: Examples overview
description: Complete, deployable starting points for Astro, SvelteKit, Nuxt, TanStack Start and Next.js - static, single-page and server-rendered.
sidebar:
  order: 1
---

Pick the row that matches your framework and mode, then copy it:

```sh
pnpm dlx degit antstanley/blogwright/examples/<example> my-site
```

| Example | Framework | Mode | Blogwright config |
| --- | --- | --- | --- |
| [Astro static](/examples/astro-static/) | Astro | Static site | defaults |
| [Astro SSR](/examples/astro-ssr/) | Astro + `@astrojs/node` | Server-rendered | `ssr` |
| [SvelteKit SSG](/examples/sveltekit-ssg/) | SvelteKit + `adapter-static` | Static site, prerendered | `paths.dist` |
| [SvelteKit SPA](/examples/sveltekit-spa/) | SvelteKit + `adapter-static` | Single-page app | `paths.dist`, `spa` |
| [SvelteKit SSR](/examples/sveltekit-ssr/) | SvelteKit + `adapter-node` | Server-rendered | `ssr` |
| [Nuxt SSR](/examples/nuxt-ssr/) | Nuxt 4 (Nitro `node-server`) | Server-rendered | `ssr` |
| [TanStack Start SSR](/examples/tanstack-start-ssr/) | TanStack Start + Nitro | Server-rendered | `ssr` |
| [Next.js SSR](/examples/nextjs-ssr/) | Next.js standalone | Server-rendered | `ssr` |

Each one is a complete project in the repository's [`examples/`](https://github.com/antstanley/blogwright/tree/main/examples) folder. Every example was deployed to AWS and checked over its CloudFront URL before it was published.

Static sites and SPAs publish their build output to S3 behind CloudFront. Server-rendered examples run as a [Lambda Web Function](/guides/server-rendered-sites/) behind the same distribution, with fingerprinted browser assets still on S3 wherever the framework writes them separately.

## Use one

1. Copy it and start a repository:

   ```sh
   pnpm dlx degit antstanley/blogwright/examples/sveltekit-ssr my-site
   cd my-site && git init
   ```

2. Set `siteName` and `region` in `config/production.jsonc`.
3. Add Blogwright and commit everything, including `pnpm-lock.yaml`:

   ```sh
   pnpm add -D blogwright
   git add -A && git commit -m "Start from the blogwright example"
   ```

4. Create the infrastructure: `pnpm exec blogwright bootstrap`
5. Build and publish: `pnpm exec blogwright deploy`

Each example's page lists the files that matter and why.

### Inside a larger repository

The configs assume the example directory **is** the repository root, because Blogwright resolves `paths` and `ssr` paths from the root. To deploy one from a subdirectory instead:

- Set `paths.app` to its directory.
- Prefix `paths.dist`, `ssr.packageDir` and `ssr.staticDir` with that directory.

See [Monorepos](/guides/monorepos/).

## What every example shares

| Convention | Why |
| --- | --- |
| Its own `pnpm-workspace.yaml` and `pnpm-lock.yaml` | pnpm treats the directory as a project root, even inside the Blogwright repository. The builder runs `pnpm install --frozen-lockfile --prod=false`, so the lockfile must be committed. |
| pnpm pinned with `packageManager` | The builder enables pnpm through corepack, which installs the version `packageManager` names. |
| Install scripts approved in `allowBuilds` | pnpm 11 fails an install that meets a dependency build script nobody approved. |
| An entry shim (`lambda.mjs`) in each SSR example | Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`. The shim maps it onto the variables the framework's server reads, and `pnpm build` copies it into the package. The examples write their own so the mapping is visible; set [`ssr.shim`](/guides/server-rendered-sites/#the-entry-shim) and Blogwright generates it instead, with no file or copy step. Each example page lists the values. |
| Self-contained SSR packages | Lambda loads nothing outside the package, and the build agent rejects symbolic links. Each SSR example either bundles its dependencies or has its framework copy them in as real files. |

## Check an SSR package before deploying

Run it the way Lambda does - build, copy the package outside the project, and start the entry with `AWS_LAMBDA_HTTP_ENDPOINT` set:

```sh
pnpm build
cp -R .output/server /tmp/pkg && cd /tmp/pkg      # the example's ssr.packageDir
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node lambda.mjs
curl -i http://127.0.0.1:8080/
```

If `curl` returns the page, the package starts the way Lambda starts it. Each SSR example's page has its exact paths.

## Related pages

- [Server-rendered sites](/guides/server-rendered-sites/) - the `ssr` block and a recipe per framework
- [Single-page apps](/guides/single-page-apps/) - `spa` mode
- [Monorepos](/guides/monorepos/) - `paths` and `sourceInclude`
- [Deploying](/guides/deploying/) - what happens during `blogwright deploy`
