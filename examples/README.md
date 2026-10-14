# Examples

Minimal projects for each framework the [Blogwright docs](https://blogwright.iamstan.dev) cover, one per serving mode. Each is a complete project you can copy into a repository of its own and deploy.

| Example | Framework | Mode | Blogwright config |
| --- | --- | --- | --- |
| [`astro-static`](astro-static/) | Astro | Static | defaults |
| [`astro-ssr`](astro-ssr/) | Astro + `@astrojs/node` | SSR | `ssr` |
| [`sveltekit-ssg`](sveltekit-ssg/) | SvelteKit + `adapter-static` | Static, prerendered | `paths.dist` |
| [`sveltekit-spa`](sveltekit-spa/) | SvelteKit + `adapter-static` | Single-page app | `paths.dist`, `spa` |
| [`sveltekit-ssr`](sveltekit-ssr/) | SvelteKit + `adapter-node` | SSR | `ssr` |
| [`nuxt-ssr`](nuxt-ssr/) | Nuxt (Nitro `node-server`) | SSR | `ssr` |
| [`tanstack-start-ssr`](tanstack-start-ssr/) | TanStack Start + Nitro | SSR | `ssr` |
| [`nextjs-ssr`](nextjs-ssr/) | Next.js standalone | SSR | `ssr` |

Static and single-page examples publish their build output to S3 behind CloudFront. SSR examples run as a [Lambda Web Function](https://blogwright.iamstan.dev/guides/server-rendered-sites/) behind the same distribution, with fingerprinted browser assets still served from S3 where the framework emits them separately.

## Using one

```sh
pnpm dlx degit antstanley/blogwright/examples/sveltekit-ssr my-site
cd my-site
git init
pnpm add -D blogwright
```

Then set `siteName` and `region` in `config/production.jsonc`, commit everything including `pnpm-lock.yaml`, and run `pnpm exec blogwright bootstrap` and `pnpm exec blogwright deploy`. Each example's README names the files that matter and why.

The configs assume the example directory is the repository root, because Blogwright resolves `paths` and `ssr` paths from the repository root. To deploy one from inside a larger repository instead, set `paths.app` to its directory and prefix `paths.dist`, `ssr.packageDir` and `ssr.staticDir` with it - see [Monorepos](https://blogwright.iamstan.dev/guides/monorepos/).

## Conventions

- **Its own pnpm workspace.** Each example has a `pnpm-workspace.yaml`, so pnpm treats the directory as a project root even inside this repository, and its own `pnpm-lock.yaml`. The builder runs `pnpm install --frozen-lockfile --prod=false` and then `pnpm run build`, so the lockfile must be committed.
- **pnpm pinned through `packageManager`.** The builder enables pnpm through corepack, which installs the version `packageManager` names.
- **Install scripts approved explicitly.** pnpm 11 fails an install that meets a dependency build script nobody approved; `allowBuilds` in `pnpm-workspace.yaml` lists the ones an example needs.
- **An entry shim per SSR example.** Lambda passes the listen address in `AWS_LAMBDA_HTTP_ENDPOINT`; `lambda.mjs` maps it onto the variables the framework's server reads, and `pnpm build` copies it into the package. The examples write their own so the mapping is visible; set `ssr.shim` and Blogwright generates it instead, with no file or copy step. Each example's README lists the values.
- **Self-contained SSR packages.** Lambda loads nothing outside the package, and the build agent rejects symbolic links, so each SSR example either bundles its dependencies or has its framework copy them in as real files.

## Checking an SSR package

Every SSR example was checked the way Lambda runs it: build, copy the package outside the repository, start the entry with `AWS_LAMBDA_HTTP_ENDPOINT` set, and request `/`:

```sh
pnpm build
cp -R .output/server /tmp/pkg && cd /tmp/pkg      # the example's ssr.packageDir
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node lambda.mjs
curl -i http://127.0.0.1:8080/
```
