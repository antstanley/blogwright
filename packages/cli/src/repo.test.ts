/**
 * Unit tests for the zip pipeline over a fake Vcs and the in-memory
 * FileSystem — no git binary and no disk. The process adapter has its own
 * integration tests in adapters/process-vcs.test.ts.
 */

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createMemoryFileSystem, FileNotFoundError } from 'blogwright-core';

import type { Ports, Vcs } from './ports.js';
import { buildRepoZip, COMMIT_FILE, listRepoFiles } from './repo.js';

function fakeVcs(files: string[], hash = 'abc1234'): Vcs {
  return {
    revisionHash: async () => hash,
    listFiles: async () => files,
  };
}

function decode(bytes: Uint8Array | undefined): string {
  return new TextDecoder().decode(bytes);
}

describe('listRepoFiles', () => {
  it('drops files under the extra ignore prefixes', async () => {
    const listed = ['src/index.ts', 'node_modules/pkg/index.js', '.astro/types.d.ts', 'README.md'];
    const ports: Ports = {
      vcs: fakeVcs(listed),
      fs: createMemoryFileSystem(Object.fromEntries(listed.map((f) => [`/repo/${f}`, 'x']))),
    };
    const files = await listRepoFiles(ports, '/repo', ['node_modules', '.astro']);
    expect(files).toEqual(['src/index.ts', 'README.md']);
  });

  it('drops tracked files that no longer exist on disk', async () => {
    const ports: Ports = {
      vcs: fakeVcs(['present.txt', 'deleted.txt']),
      fs: createMemoryFileSystem({ '/repo/present.txt': 'here' }),
    };
    expect(await listRepoFiles(ports, '/repo', [])).toEqual(['present.txt']);
  });
});

describe('buildRepoZip', () => {
  it('zips the given files preserving relative paths', async () => {
    const fs = createMemoryFileSystem({
      '/repo/package.json': '{"name":"x"}',
      '/repo/src/index.ts': 'export const a = 1;',
    });
    const zip = await buildRepoZip(fs, '/repo', ['package.json', 'src/index.ts']);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual(['package.json', 'src/index.ts']);
    expect(decode(entries['package.json'])).toBe('{"name":"x"}');
  });

  it('injects extra entries (e.g. the commit hash) into the zip', async () => {
    const fs = createMemoryFileSystem({ '/repo/package.json': '{"name":"x"}' });
    const zip = await buildRepoZip(fs, '/repo', ['package.json'], { [COMMIT_FILE]: 'abc1234' });
    expect(decode(unzipSync(zip)[COMMIT_FILE])).toBe('abc1234');
  });

  it('is deterministic: the same inputs produce byte-identical zips', async () => {
    const fs = createMemoryFileSystem({ '/repo/a.txt': 'aaa', '/repo/b.txt': 'bbb' });
    const first = await buildRepoZip(fs, '/repo', ['a.txt', 'b.txt'], { [COMMIT_FILE]: 'abc' });
    const second = await buildRepoZip(fs, '/repo', ['a.txt', 'b.txt'], { [COMMIT_FILE]: 'abc' });
    expect(second).toEqual(first);
  });

  it('fails with the missing path when a listed file is absent', async () => {
    const fs = createMemoryFileSystem();
    await expect(buildRepoZip(fs, '/repo', ['gone.txt'])).rejects.toThrow(FileNotFoundError);
  });
});

describe('zip pipeline through the ports', () => {
  it('stamps the fake revision into a deterministic file set', async () => {
    const ports: Ports = {
      vcs: fakeVcs(['index.md', 'dist/site.html'], 'feedbee'),
      fs: createMemoryFileSystem({ '/repo/index.md': '# hi', '/repo/dist/site.html': '<p>' }),
    };
    const hash = await ports.vcs.revisionHash('/repo');
    const files = await listRepoFiles(ports, '/repo', ['dist']);
    const zip = await buildRepoZip(ports.fs, '/repo', files, { [COMMIT_FILE]: hash });
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([COMMIT_FILE, 'index.md']);
    expect(decode(entries[COMMIT_FILE])).toBe('feedbee');
  });
});
