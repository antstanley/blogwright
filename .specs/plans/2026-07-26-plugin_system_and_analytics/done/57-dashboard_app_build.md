# Task 57 - The SvelteKit dashboard app, built to dist/app and shipped prebuilt

**Plan:** [plan.md](../plan.md) · **Certificate:** [57-dashboard_app_build-certificate.md](57-dashboard_app_build-certificate.md)

**Implements:** [2026-07-26-analytics_plugin.md §Analytics dashboard → Local server](../../../changes/merged/2026-07-26-analytics_plugin.md) (the server serves a prebuilt SvelteKit application; the dashboard ships prebuilt as `dist/app` in the package's `files`, because requiring consumers to run Vite to see a chart would make the install heavier than the feature) and [DEVELOPMENT.md §Toolchain](../../../../DEVELOPMENT.md) (deliberate exceptions to the gates carry a written reason)
**Depends on:** 56
**Produces:** the SvelteKit + LayerChart application under `packages/analytics/app/`, built to `dist/app` by the package's own `build` script and shipped in its `files`, calling only the named-query routes, with every gate exclusion the new toolchain needs recorded with its reason and CI unchanged
**Pointers:** `packages/analytics/app/` (new - the SvelteKit application: `svelte.config.js`, `vite.config.ts`, `src/routes/`), `packages/analytics/package.json` (task 32 - the `build` script and the `files` array this task extends), `packages/cli/package.json:20` (`tsc -p tsconfig.json && node scripts/copy-agent.mjs` - the in-repo precedent for a `build` script with a second, non-tsc step), `packages/cli/package.json:9-12` (`files: ["dist", "agent"]` - the precedent for shipping a second built directory in the tarball), `docs/package.json:8` (`astro build` - the workspace's existing Vite-based build behind the same script name), `knip.json:3` (`ignoreWorkspaces: [".", "docs"]` - where the Astro tree is scoped out of the dead-code gate), `knip.json:4-12` (the workspaces map task 32 added `packages/analytics` to), `.oxlintrc.json:85` (`ignorePatterns: ["dist", "node_modules"]` - where a Svelte exclusion is recorded), `.oxfmtrc.json:8-11` (the note scoping oxfmt to TypeScript and JavaScript, and the `ignorePatterns` array whose every entry carries a written reason), `.github/workflows/ci.yml:20-29` (the seven-step gate list that must need no new step), `packages/analytics/src/server.ts` (task 56 - the `appDir` the built app is served from and the named-query routes it may call), `DEVELOPMENT.md:261-263` (§Repository hygiene: build artifacts are gitignored, never committed, and ship only in the npm tarball)

> **ROUTED FINDING - added 2026-08-31 from task 56's verification gate.**
> The dashboard server task 56 landed has **no `Host` header validation and
> sends no CORS or `nosniff` headers**, so the loopback DNS-rebinding shape is
> open: a page the operator visits can resolve a hostname it controls to
> 127.0.0.1 and read the dashboard's API responses, because the browser treats
> them as same-origin by hostname. Binding to loopback stops other machines, not
> other origins in the operator's own browser.
> It is bounded - the exposure is the site's own traffic figures, not
> credentials, and nothing there is writable (the port exposes `run` alone, and
> no route accepts SQL). It is outside every obligation task 56 carried, the
> spec does not mention it, and its gate correctly did not hold the task on it.
> It routes here because this task owns the app that will be served, so it is
> the first task with a reason to care what an origin is. The cheap fix is a
> `Host` allow-list (`127.0.0.1:<port>` and `localhost:<port>`) rejecting
> anything else with a 403, plus `X-Content-Type-Options: nosniff` on every
> response. Decide deliberately, and if you decline, record why rather than
> leaving it unstated - it is the kind of gap that is obvious in hindsight and
> invisible in a diff.
>
> **Second, smaller item folded in from the same review.** `GET /nested` (no
> trailing slash) 404s rather than redirecting, and task 56 deliberately did
> not open a follow-up because the right answer depends on a layout that does
> not exist yet: SvelteKit's default `trailingSlash: 'never'` emits
> `nested.html`, not `nested/index.html`, in which case `/nested` resolves on
> its own and there is nothing to fix. Falling back to `${key}/index.html` on a
> miss would be worse than the 404 - it serves one page under two URLs with no
> redirect, breaking relative links. The correct behaviour, a 301 to
> `/nested/`, is only worth adding if this task emits directory-shaped output.
> So: confirm the layout you emit is the one the server serves, and add the
> redirect only if it is.

## Steps

- [x] Scaffold the SvelteKit application in `packages/analytics/app/` on Svelte 5 with `@sveltejs/adapter-static`, output configured to `../dist/app`, so the build produces a directory of static files task 56's server hands out and no Node server ships with the package.
- [x] Add LayerChart 2.0.2 and the SvelteKit/Vite toolchain as devDependencies of `blogwright-analytics` only, so nothing a consumer installs pulls Vite, and confirm no other package's manifest gains them.
- [x] Build the app's data layer against task 56's named-query routes alone - one relative base path derived from the page's own origin, one fetch helper carrying the query name, the date range and the bot-inclusion flag as parameters, and no code path that sends SQL or names another origin.
- [x] Extend the package's `build` script to run the TypeScript build and the app build in sequence, mirroring `packages/cli/package.json:20`, and add `dist/app` to the package's `files` beside `dist` so the prebuilt app ships in the tarball.
- [x] Scope the five gates to the new tree with the reason written where the exclusion lives: the `packages/analytics/app` entry in `knip.json` (following the `docs` treatment at `knip.json:3`), the Svelte sources in `.oxlintrc.json:85`'s `ignorePatterns`, and the same in `.oxfmtrc.json`'s `ignorePatterns` beside the existing commented entries - or, where a gate does cover the tree, say so instead of excluding it.
- [x] Verify CI needs no new step by deleting `packages/analytics/dist` and running `pnpm -r build` plus the five gates from a clean checkout; if `.github/workflows/ci.yml:20-29` must change after all, make the change and state the reason in the change description rather than leaving it implicit.

## Definition of done

- [x] The SvelteKit + LayerChart 2.0.2 (Svelte 5) app in `packages/analytics/app/` builds to `dist/app`, `dist/app` is listed in the package's `files` beside `dist`, and the package's `build` script runs both the TypeScript build and the app build - deleting `packages/analytics/dist` and running `pnpm -r build` from a clean checkout produces `dist/app/index.html` with no separate Vite invocation, so installing the plugin never runs Vite.
- [x] The app calls only the named-query routes task 56's server exposes: a reviewer can list its network calls (`grep -rn "fetch(\|http" packages/analytics/app/src/`) and find no absolute origin, no second host, and no SQL payload - every call names a query, a date range and a bot-inclusion flag.
- [x] `pnpm lint`, `pnpm exec oxfmt --check .` and `pnpm knip` all pass with the app tree present, and each exclusion the new toolchain needs is recorded with its written reason in `knip.json` / `.oxlintrc.json` / `.oxfmtrc.json` beside the existing commented entries, per DEVELOPMENT.md's rule that deliberate exceptions carry a reason - no gate is silently narrowed and no exclusion is wider than the Svelte tree.
- [x] CI needs no new step: the app build runs inside `pnpm build` and `.github/workflows/ci.yml:20-29` is unchanged, or the change to it is made deliberately and its reason stated in the change description.
- [x] Meets the repo definition of done (see plan.md baseline).
- [x] Reviewable: run `rm -rf packages/analytics/dist && pnpm -r build && ls packages/analytics/dist/app/index.html`, then `pnpm lint && pnpm exec oxfmt --check . && pnpm knip`; confirm the file exists, all three gates pass, and `jj diff --stat .github/workflows/ci.yml` prints nothing.
