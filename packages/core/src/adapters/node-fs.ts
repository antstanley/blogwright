/** Node adapter for the FileSystem port (real disk I/O via node:fs). */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { FileNotFoundError, type FileSystem } from '../ports.js';

function isAbsence(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function contextualise(operation: string, path: string, err: unknown): Error {
  return new Error(`${operation} ${path} failed: ${(err as Error).message}`, { cause: err });
}

/** Build the real-disk FileSystem adapter. */
export function createNodeFileSystem(): FileSystem {
  return {
    async readText(path: string): Promise<string> {
      try {
        return await readFile(path, 'utf8');
      } catch (err) {
        throw isAbsence(err) ? new FileNotFoundError(path) : contextualise('reading', path, err);
      }
    },

    async readBytes(path: string): Promise<Uint8Array> {
      try {
        return await readFile(path);
      } catch (err) {
        throw isAbsence(err) ? new FileNotFoundError(path) : contextualise('reading', path, err);
      }
    },

    async writeText(path: string, text: string): Promise<void> {
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
      } catch (err) {
        throw contextualise('writing', path, err);
      }
    },

    async exists(path: string): Promise<boolean> {
      try {
        await stat(path);
        return true;
      } catch (err) {
        if (isAbsence(err)) return false;
        throw contextualise('checking', path, err);
      }
    },

    async listFiles(dir: string): Promise<string[]> {
      try {
        const entries = await readdir(dir, { recursive: true, withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
          .sort();
      } catch (err) {
        throw isAbsence(err) ? new FileNotFoundError(dir) : contextualise('listing', dir, err);
      }
    },
  };
}
