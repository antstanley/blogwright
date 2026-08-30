/**
 * Public surface of blogwright-analytics: CloudFront access logs routed
 * through Firehose into an Iceberg table, with a local dashboard over it.
 * The plugin is installed on demand with `blogwright plugin add analytics`,
 * never shipped with the CLI - see DEVELOPMENT.md §Hexagonal architecture
 * ("Features live in their own packages"). This module carries the package's
 * own AWS service clients (built over core's shared SigV4 transport through
 * the plugin-supplied `ServiceDescriptor` seam) and, since task 47, the
 * `Plugin` default export the CLI's discovery loads.
 *
 * The default export and the package's `blogwright.plugin` manifest field
 * landed together, deliberately: a package carrying the manifest without a
 * conforming default export is a discovery error naming this package, so
 * neither half may ship ahead of the other.
 */

export * from './aws/firehose.js';
export * from './aws/glue.js';
export * from './aws/lambda.js';
export * from './aws/s3tables.js';

/**
 * The `Plugin` object the CLI discovers, and the namespace constant its
 * `name` is built from. Both live in `plugin.ts`; `ANALYTICS_NAMESPACE`
 * moved there from this module when the default export arrived to consume
 * it, so the namespace has one home rather than a constant here and a
 * literal there. Its conformance to core's `PLUGIN_NAME_PATTERN` is pinned
 * by `index.test.ts` and again, through `validatePlugin`, by `plugin.test.ts`.
 */
export { default, ANALYTICS_NAMESPACE } from './plugin.js';
