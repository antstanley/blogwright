/**
 * Public surface of blogwright-analytics: CloudFront access logs routed
 * through Firehose into an Iceberg table, with a local dashboard over it.
 * The plugin is installed on demand with `blogwright plugin add analytics`,
 * never shipped with the CLI - see DEVELOPMENT.md §Hexagonal architecture
 * ("Features live in their own packages"). This module carries the plugin's
 * namespace constant and its own AWS service clients (built over core's
 * shared SigV4 transport through the plugin-supplied `ServiceDescriptor`
 * seam) today; the `Plugin` default export and the package's
 * `blogwright.plugin` manifest field land together once the plugin has
 * commands and nodes to declare, so a package carrying the manifest without
 * a conforming export never becomes a discovery error naming this package
 * in the meantime.
 */

export * from './aws/s3tables.js';

/**
 * The CLI namespace this plugin will claim (`blogwright analytics <action>`),
 * consumed by `Plugin.name` once the default export lands. Its conformance
 * to core's `PLUGIN_NAME_PATTERN` is pinned by `index.test.ts`, not checked
 * here: this package declares no manifest field yet, so discovery never
 * imports this module, and a module-load check on two compile-time
 * constants catches nothing `pnpm test` does not already catch - while
 * contradicting `sideEffects: false` above.
 */
export const ANALYTICS_NAMESPACE = 'analytics';
