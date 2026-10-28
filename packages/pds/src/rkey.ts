/**
 * The `blogwright-pds/rkey` subpath export, kept stable for existing
 * importers: the implementation lives in blogwright-core
 * (packages/core/src/rkey.ts), so the CLI's `blogwright/rkey` keeps working
 * on a site that never installs this plugin.
 */

export * from 'blogwright-core/rkey';
