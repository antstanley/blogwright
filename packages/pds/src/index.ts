/**
 * Public surface of blogwright-pds: the pds command entry points the CLI
 * dispatches to, plus the context types that name the dependency boundary.
 * The rkey implementation is the separate `blogwright-pds/rkey` subpath.
 *
 * The default export is the package's `Plugin` declaration (`plugin.ts`) -
 * the whole SPI surface in one object. It sits BESIDE the named exports, not
 * instead of them: `deploy` reaches `syncAfterDeploy` by name through this
 * module, and the CLI's own `runPds` branch still reaches all six command
 * functions the same way.
 */

export * from './commands.js';
export type { PdsContext, PdsLogger, PdsPorts } from './context.js';
export { default } from './plugin.js';
