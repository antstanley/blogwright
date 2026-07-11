/**
 * The `blogwright/rkey` subpath export, kept stable for consuming sites: the
 * implementation lives in blogwright-pds (see packages/pds/src/rkey.ts), and
 * this re-export preserves the CLI's published contract.
 */

export * from 'blogwright-pds/rkey';
