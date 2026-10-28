/**
 * The `blogwright/rkey` subpath export, kept stable for consuming sites: the
 * implementation lives in blogwright-core (see packages/core/src/rkey.ts), and
 * this re-export preserves the CLI's published contract without installing the
 * pds plugin.
 */

export * from 'blogwright-core/rkey';
