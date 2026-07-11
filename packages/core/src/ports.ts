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
  /** Read a file's raw bytes. Throws {@link FileNotFoundError} when absent. */
  readBytes(path: string): Promise<Uint8Array>;
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

/**
 * The operator's terminal in domain vocabulary: leveled line output plus one
 * question/answer primitive. `isInteractive` reflects TTY attachment, captured
 * once when the adapter is constructed; callers key formatting (color) and
 * prompting decisions off it.
 */
export interface Terminal {
  /** True when the session has an interactive TTY on both input and output. */
  readonly isInteractive: boolean;
  /** Write one line to standard output. */
  write(line: string): void;
  /** Write one line to standard error. */
  error(line: string): void;
  /**
   * Show a transient single-line status (elapsed time, progress). Each call
   * replaces the previous status; the empty string clears it. Adapters that
   * cannot rewrite a line (piped output, CI, plain mode) make this a no-op,
   * so callers must still emit durable lines for those sessions.
   */
  status(line: string): void;
  /** Show `prompt` and resolve with the operator's answer (newline excluded). */
  question(prompt: string): Promise<string>;
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
