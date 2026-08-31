/**
 * Ambient declarations for this application.
 *
 * A stylesheet imported for its side effect carries no types, and TypeScript
 * has no built-in knowledge of one. SvelteKit's generated `ambient.d.ts` says
 * this too, but `tsconfig.json` here is deliberately standalone - see its own
 * note - so the declaration lives where the typecheck can see it without a
 * build having run first.
 */

declare module '*.css';
