/**
 * The plugin's composition root for *paths*: the one module in
 * `packages/analytics/src/` permitted to touch `import.meta.url`.
 *
 * `analytics-transform-function` (`nodes.ts`) deploys an artifact this package
 * ships inside itself - the rolldown bundle and the manifest stamped beside it
 * under `transform-hash.ts`'s `TRANSFORM_BUNDLE_DIR` - so something has to know where the
 * installed package is on disk. The CLI answers the identical question for the
 * build-agent at `packages/cli/src/context.ts` (`cliPackageDir()`, joined to
 * `agent` and put on the context as `agentDir`), and the rule that keeps that
 * honest is DEVELOPMENT.md §Hexagonal architecture: a location is resolved at
 * a composition root and handed to domain code as *data*.
 *
 * `nodes.ts` has no wiring step of its own to resolve it in - the SPI reaches
 * it through `plugin.nodes(ctx)` with nothing in between - so this module is
 * that step. Resolving it inline in `nodes.ts` would satisfy the package's ban
 * on Node's own filesystem module (`import.meta.url` is not a restricted
 * import) while breaking the composition-root rule anyway, and it would put a
 * second `import.meta.url` in the package the day a second artifact needs
 * locating.
 *
 * This module resolves a directory and nothing else. The *bytes* under it are
 * still read through `ctx.ports.fs`, never here: this package imports Node's
 * filesystem module nowhere at all, and no `packages/analytics/src/` path joins
 * the `no-restricted-imports` override list in `.oxlintrc.json`. (Named in
 * prose rather than spelled as the specifier, so the definition of done's grep
 * for it over this tree does not trip over a comment - the same care
 * `ports.ts` takes with its own vendor name.)
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `blogwright-analytics` package root, resolved from this module's own
 * location - `<package>/dist/paths.js` once compiled, `<package>/src/paths.ts`
 * under vitest, and one level up from either.
 *
 * `resolve` is here for the reason `cliPackageDir()` states: `new URL('..', …)`
 * yields a trailing separator, unlike every other directory value in the repo,
 * so a caller writing `${ANALYTICS_PACKAGE_DIR}/x` would get a doubled one - in
 * the path and in any error message built from it.
 *
 * The relative location of the transform artifacts under this directory is not
 * restated here: `transform-hash.ts` owns `TRANSFORM_BUNDLE_DIR` as "where
 * the build puts the Lambda artifacts, relative to the package root", and
 * `nodes.ts` joins the two.
 */
export const ANALYTICS_PACKAGE_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
