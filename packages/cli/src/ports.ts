/**
 * CLI-owned ports. Shared ports (FileSystem) come from blogwright-core; the
 * ports here serve only this package. Adapters live in `adapters/` and are
 * constructed only at the composition root (context.ts).
 */

import type { FileSystem, Terminal } from 'blogwright-core';

/** Version-control queries the deploy pipeline needs, in domain vocabulary. */
export interface Vcs {
  /** Resolve a stable short revision hash for the working copy at `cwd`. */
  revisionHash(cwd: string): Promise<string>;
  /** List repository files as `cwd`-relative paths, honoring the VCS ignore rules. */
  listFiles(cwd: string): Promise<string[]>;
}

/**
 * Best-effort wake-up ping to a builder MicroVM's proxy endpoint. Implementations
 * never throw — the connection attempt, not the response, is the point.
 */
export type PingBuilder = (endpoint: string, token: string) => Promise<void>;

/** The ports domain code reaches side effects through; adapters are wired in createContext. */
export interface Ports {
  fs: FileSystem;
  vcs: Vcs;
  terminal: Terminal;
  ping: PingBuilder;
}
