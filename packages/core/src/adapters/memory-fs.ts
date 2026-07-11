/** In-memory adapter for the FileSystem port, for tests. */

import { posix } from 'node:path';

import { FileNotFoundError, type FileSystem } from '../ports.js';

function normalise(path: string): string {
  return posix.resolve('/', path);
}

function directoryPrefix(path: string): string {
  return path === '/' ? '/' : `${path}/`;
}

/**
 * Build a Map-backed FileSystem seeded with `initialFiles` (path → content).
 * Contents are text; `readBytes` returns the UTF-8 encoding. A directory
 * "exists" when any file lives under it; inspect writes back through
 * `readText`/`listFiles`.
 */
export function createMemoryFileSystem(initialFiles: Record<string, string> = {}): FileSystem {
  const files = new Map<string, string>(
    Object.entries(initialFiles).map(([path, content]) => [normalise(path), content]),
  );

  function isDirectory(path: string): boolean {
    const prefix = directoryPrefix(path);
    return [...files.keys()].some((key) => key.startsWith(prefix));
  }

  function contentOf(path: string): string {
    const content = files.get(normalise(path));
    if (content === undefined) throw new FileNotFoundError(path);
    return content;
  }

  return {
    async readText(path: string): Promise<string> {
      return contentOf(path);
    },

    async readBytes(path: string): Promise<Uint8Array> {
      return new TextEncoder().encode(contentOf(path));
    },

    async writeText(path: string, text: string): Promise<void> {
      files.set(normalise(path), text);
    },

    async exists(path: string): Promise<boolean> {
      const key = normalise(path);
      return files.has(key) || isDirectory(key);
    },

    async listFiles(dir: string): Promise<string[]> {
      const key = normalise(dir);
      if (!isDirectory(key)) throw new FileNotFoundError(dir);
      const prefix = directoryPrefix(key);
      return [...files.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length))
        .sort();
    },
  };
}
