/**
 * How the one route is emitted.
 *
 * `prerender` is what `@sveltejs/adapter-static` needs: it writes the route to
 * a file at build time instead of expecting a server to render it. `ssr` is
 * off because every figure on this page comes from the local server's
 * named-query routes, which do not exist at build time - rendering the page on
 * the build machine would only produce a shell with empty charts in it, and
 * charts that measure their own container need a layout to measure.
 */

export const prerender = true;
export const ssr = false;
