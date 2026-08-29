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

/** Package managers `PackageManager.detect` can identify, from the lockfile each writes. */
export type PackageManagerName = 'pnpm' | 'npm' | 'yarn' | 'bun';

/**
 * How to install a package, in the repo's own vocabulary - never a package
 * manager's flag spelling (`--save-dev`, `-D`, ...).
 */
export interface AddPackageOptions {
  /** Install into devDependencies rather than dependencies. */
  dev?: boolean;
  /** Pin the exact resolved version rather than a semver range. */
  exact?: boolean;
}

/**
 * Installing and removing packages in the consuming repo. The real adapter
 * detects which manager governs the repo from its lockfile and shells out to
 * it; `add`/`remove` resolve that repo and manager themselves, so callers
 * never pass a directory.
 */
export interface PackageManager {
  /** Identify which manager governs `repoRoot`, from the lockfile it wrote there. */
  detect(repoRoot: string): Promise<PackageManagerName>;
  /** Install `spec` (a package name, optionally `name@version`) into the repo. */
  add(spec: string, opts?: AddPackageOptions): Promise<void>;
  /** Uninstall the named package from the repo. */
  remove(name: string): Promise<void>;
}

/**
 * Best-effort wake-up ping to a builder MicroVM's proxy endpoint. Implementations
 * never throw - the connection attempt, not the response, is the point.
 */
export type PingBuilder = (endpoint: string, token: string) => Promise<void>;

/**
 * The outcome of resolving a module specifier or a package.json path: never
 * `string | null` for "not found" - absence is a variant of the type, not a
 * sentinel value a caller could forget to check.
 */
export type ModuleResolution = { found: true; path: string } | { found: false };

/**
 * Resolves and imports plugin packages - the only route from plugin discovery
 * and dispatch to Node's module system. `fromDir` is a per-call argument
 * rather than state fixed at construction, because discovery resolves the
 * consumer's plugins from the repo root and the CLI's own bundled plugins
 * from the CLI's package directory in the same run.
 */
export interface ModuleLoader {
  /** Resolve the bare specifier `specifier` to its entry-point file, as seen from `fromDir`. */
  resolve(specifier: string, fromDir: string): Promise<ModuleResolution>;
  /**
   * Resolve `specifier`'s nearest `package.json` by resolving the bare
   * specifier and walking up from the resolved entry file - **never** by
   * resolving `<specifier>/package.json` directly. `require.resolve` of that
   * subpath throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for every published
   * package in this repo, because their `exports` maps do not list
   * `./package.json` (verified 2026-07-26 against `blogwright-pds`, whose
   * `exports` map lists only `.` and `./rkey`). See
   * `adapters/node-module-loader.ts` for the walk-up implementation and a
   * side-by-side of both resolution strategies.
   *
   * Limit: `blogwright` itself cannot be reached this way either - its own
   * `exports` map has no `.` entry (only `./rkey`; the CLI is consumed
   * through its `bin`, not imported), so resolving the bare specifier
   * `blogwright` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` too. That is why the
   * CLI locates its own package directory from `import.meta.url` rather than
   * through this port.
   */
  packageJsonPathFor(specifier: string, fromDir: string): Promise<ModuleResolution>;
  /** Import the module at `path`. The caller validates the result's shape at the boundary. */
  load(path: string): Promise<unknown>;
}

/** The ports domain code reaches side effects through; adapters are wired in createContext. */
export interface Ports {
  fs: FileSystem;
  vcs: Vcs;
  terminal: Terminal;
  ping: PingBuilder;
  loader: ModuleLoader;
  packages: PackageManager;
}
