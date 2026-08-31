/**
 * Public surface of blogwright-pds: the pds command entry points the CLI
 * dispatches to, plus the context types that name the dependency boundary.
 * The rkey implementation is the separate `blogwright-pds/rkey` subpath.
 *
 * The default export is the package's `Plugin` declaration (`plugin.ts`) -
 * the whole SPI surface in one object. It sits BESIDE the named exports, not
 * instead of them, though the split is now lopsided: since task 29 deleted
 * the CLI's `runPds` branch, the six command functions reach `blogwright pds
 * <action>` through the default export's declared commands, not by name, and
 * `syncAfterDeploy` is the one named export the CLI's shipped code still
 * imports at runtime - the post-deploy sync, which has no lifecycle hook in
 * the SPI to carry it (see the import comment in the CLI's `commands.ts`).
 * The type exports below are load-bearing too, not dead surface: the CLI's
 * `context.test.ts` imports `PdsContext` to assert `OpsContext` still
 * satisfies it by plain assignment. The command functions stay exported as
 * this package's own public API; `plugin.ts` builds its declarations from
 * them.
 */

export * from './commands.js';
export type { PdsContext, PdsLogger, PdsPorts } from './context.js';
export { default } from './plugin.js';
