/**
 * Repo-owned ports shared across packages. Domain code depends on these
 * interfaces; adapters (see `adapters/`) implement them against real
 * infrastructure and are constructed only at a composition root.
 */

/**
 * File access in domain vocabulary. Paths are platform paths (absolute in
 * practice); implementations raise {@link FileNotFoundError} for absent files
 * so callers can branch on absence without knowing adapter error codes.
 */
export interface FileSystem {
  /** Read a UTF-8 text file. Throws {@link FileNotFoundError} when absent. */
  readText(path: string): Promise<string>;
  /** Write a UTF-8 text file, creating parent directories as needed. */
  writeText(path: string, text: string): Promise<void>;
  /** True when a file or directory exists at the path. */
  exists(path: string): Promise<boolean>;
  /**
   * List every file under `dir` recursively as sorted, `dir`-relative paths.
   * Throws {@link FileNotFoundError} when `dir` does not exist.
   */
  listFiles(dir: string): Promise<string[]>;
}

/** Raised by {@link FileSystem} implementations when a path has no file. */
export class FileNotFoundError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`file not found: ${path}`);
    this.name = 'FileNotFoundError';
    this.path = path;
  }
}
