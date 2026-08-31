/**
 * The dashboard application's SvelteKit configuration.
 *
 * **Static, and deliberately nothing else.** `@sveltejs/adapter-static` emits
 * a directory of files and no Node server, because the thing that serves them
 * already exists: `src/server.ts` hands out `dist/app` through the
 * `FileSystem` port and answers the named queries beside it. A SvelteKit
 * server adapter would ship a second HTTP server inside a package whose whole
 * security argument is that exactly one module opens a socket.
 *
 * **`../dist/app`** puts the output beside the TypeScript build's own `dist`,
 * which is what the package's `files` array ships and what
 * `commands.ts`' `dashboardAppDir()` resolves. The paths are relative to this
 * directory (`packages/analytics/app`), so they land in
 * `packages/analytics/dist/app`.
 *
 * **`trailingSlash` is left at SvelteKit's default, `'never'`, and that is a
 * decision rather than an omission.** The server resolves a request path
 * against an allow-list of the exact files `dist/app` holds, appending
 * `index.html` only to a path that is empty or ends in `/`. Under
 * `'never'` a route `/nested` would be emitted as `nested.html`, which that
 * lookup would miss - so a second page would need either `trailingSlash:
 * 'always'` here (emitting `nested/index.html`, which the server already
 * serves, plus a redirect from `/nested`) or an `.html` suffix rule there.
 * This application has one route, `/`, whose output is `index.html` at the
 * root of `dist/app`; every other emitted file is an asset requested by its
 * exact path. So nothing directory-shaped and nothing extensionless is
 * emitted, and neither the redirect nor the suffix rule has anything to act
 * on today. Read this comment before adding a second route.
 */

import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: '../dist/app',
      assets: '../dist/app',
      precompress: false,
      // Fail the build rather than emit a partial application: with one
      // prerendered route there is nothing this can be relaxed for.
      strict: true,
    }),
  },
};
