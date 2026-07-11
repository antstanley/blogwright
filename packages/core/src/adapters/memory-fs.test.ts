import { describe, expect, it } from 'vitest';

import { FileNotFoundError } from '../ports.js';
import { createMemoryFileSystem } from './memory-fs.js';

describe('createMemoryFileSystem', () => {
  it('serves seeded files and round-trips writes', async () => {
    const fs = createMemoryFileSystem({ '/repo/readme.md': 'seeded' });
    expect(await fs.readText('/repo/readme.md')).toBe('seeded');
    await fs.writeText('/repo/new.txt', 'written');
    expect(await fs.readText('/repo/new.txt')).toBe('written');
  });

  it('throws FileNotFoundError with the path when reading a missing file', async () => {
    const fs = createMemoryFileSystem();
    const failure = await fs.readText('/repo/missing.txt').catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(FileNotFoundError);
    expect((failure as FileNotFoundError).path).toBe('/repo/missing.txt');
  });

  it('serves a file as its UTF-8 bytes through readBytes', async () => {
    const fs = createMemoryFileSystem({ '/repo/logo.txt': 'héllo' });
    expect(await fs.readBytes('/repo/logo.txt')).toEqual(new TextEncoder().encode('héllo'));
  });

  it('throws FileNotFoundError when readBytes hits a missing file', async () => {
    const fs = createMemoryFileSystem();
    await expect(fs.readBytes('/repo/missing.bin')).rejects.toThrow(FileNotFoundError);
  });

  it('treats any ancestor of a stored file as an existing directory', async () => {
    const fs = createMemoryFileSystem({ '/repo/.git/HEAD': 'ref' });
    expect(await fs.exists('/repo/.git/HEAD')).toBe(true);
    expect(await fs.exists('/repo/.git')).toBe(true);
    expect(await fs.exists('/repo')).toBe(true);
    expect(await fs.exists('/repo/.jj')).toBe(false);
  });

  it('normalises paths, so lookups and writes agree on one key', async () => {
    const fs = createMemoryFileSystem();
    await fs.writeText('/repo/a/../config.jsonc', '{}');
    expect(await fs.readText('/repo/config.jsonc')).toBe('{}');
    expect(await fs.exists('/repo/./config.jsonc')).toBe(true);
  });

  it('lists files recursively as sorted relative paths', async () => {
    const fs = createMemoryFileSystem({
      '/repo/src/b.ts': '',
      '/repo/src/nested/a.ts': '',
      '/repo/other.txt': '',
    });
    expect(await fs.listFiles('/repo/src')).toEqual(['b.ts', 'nested/a.ts']);
  });

  it('throws FileNotFoundError when listing a missing directory', async () => {
    const fs = createMemoryFileSystem({ '/repo/file.txt': '' });
    await expect(fs.listFiles('/elsewhere')).rejects.toThrow(FileNotFoundError);
  });
});
