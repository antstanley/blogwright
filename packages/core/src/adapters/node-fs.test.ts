import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileNotFoundError } from '../ports.js';
import { createNodeFileSystem } from './node-fs.js';

const fs = createNodeFileSystem();
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'node-fs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createNodeFileSystem', () => {
  it('round-trips text through writeText/readText, creating parent directories', async () => {
    const path = join(root, 'a/b/c.txt');
    await fs.writeText(path, 'hello');
    expect(await fs.readText(path)).toBe('hello');
  });

  it('throws FileNotFoundError with the path when reading a missing file', async () => {
    const path = join(root, 'missing.txt');
    const failure = await fs.readText(path).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(FileNotFoundError);
    expect((failure as FileNotFoundError).path).toBe(path);
  });

  it('round-trips binary content through readBytes without text decoding', async () => {
    const path = join(root, 'logo.bin');
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f]);
    await writeFile(path, bytes);
    expect(new Uint8Array(await fs.readBytes(path))).toEqual(bytes);
  });

  it('throws FileNotFoundError when readBytes hits a missing file', async () => {
    await expect(fs.readBytes(join(root, 'missing.bin'))).rejects.toThrow(FileNotFoundError);
  });

  it('reports existence of files and directories, and absence of neither', async () => {
    await mkdir(join(root, 'dir'));
    await writeFile(join(root, 'file.txt'), 'x');
    expect(await fs.exists(join(root, 'dir'))).toBe(true);
    expect(await fs.exists(join(root, 'file.txt'))).toBe(true);
    expect(await fs.exists(join(root, 'nope'))).toBe(false);
    // a path that descends through a file is absent, not an error
    expect(await fs.exists(join(root, 'file.txt', 'child'))).toBe(false);
  });

  it('lists files recursively as sorted relative paths', async () => {
    await fs.writeText(join(root, 'b/two.md'), '2');
    await fs.writeText(join(root, 'a/one.md'), '1');
    await fs.writeText(join(root, 'top.md'), '0');
    expect(await fs.listFiles(root)).toEqual([join('a', 'one.md'), join('b', 'two.md'), 'top.md']);
  });

  it('throws FileNotFoundError when listing a missing directory', async () => {
    await expect(fs.listFiles(join(root, 'absent'))).rejects.toThrow(FileNotFoundError);
  });

  it('raises write failures with the offending path in the message', async () => {
    await writeFile(join(root, 'blocker.txt'), 'x');
    // the parent "directory" is a file, so the write cannot succeed
    await expect(fs.writeText(join(root, 'blocker.txt/child.txt'), 'x')).rejects.toThrow(
      /blocker\.txt/,
    );
  });
});
