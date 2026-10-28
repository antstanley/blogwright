/**
 * Public surface of blogwright-pds: the pds command entry points, plus the
 * context types that name the dependency boundary. The `blogwright-pds/rkey`
 * subpath re-exports core's rkey implementation.
 *
 * The default export is the package's `Plugin` declaration (`plugin.ts`) -
 * the whole SPI surface in one object, and the only thing the CLI reaches:
 * the six command functions through its declared commands and
 * `syncAfterDeploy` through its `afterDeploy` hook. The CLI does not install
 * this package; a site that publishes to standard.site adds it with
 * `blogwright plugin add pds`. The named exports stay this package's own
 * public API, and the type exports are load-bearing too, not dead surface:
 * the CLI's `context.test.ts` imports `PdsContext` to assert `OpsContext`
 * still satisfies it by plain assignment.
 */

export * from './commands.js';
export type { PdsContext, PdsLogger, PdsPorts } from './context.js';
export { default } from './plugin.js';
