/**
 * Integration tests for the jj/git process adapter: a real git repository in
 * a tmp dir (revisionHash exercises the git fallback there), plus the zip
 * pipeline end-to-end over the real-disk FileSystem adapter.
 */

import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeFileSystem } from 'blogwright-core';

import { buildRepoZip, COMMIT_FILE, listRepoFiles } from '../repo.js';
import { makeTempDir, removeTempDir } from '../test-support.js';
import { createProcessVcs } from './process-vcs.js';

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const identity = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test'];
  const { stdout } = await run('git', [...identity, '-c', 'commit.gpgsign=false', ...args], {
    cwd,
  });
  return stdout.trim();
}

const vcs = createProcessVcs();
let root: string;

beforeEach(async () => {
  root = await makeTempDir('process-vcs');
});

afterEach(async () => {
  await removeTempDir(root);
});

describe('createProcessVcs', () => {
  it('lists tracked and untracked files, honoring .gitignore', async () => {
    await git(root, 'init', '-q');
    await writeFile(join(root, '.gitignore'), '*.log\n');
    await writeFile(join(root, 'tracked.txt'), 'tracked');
    await writeFile(join(root, 'untracked.txt'), 'untracked');
    await writeFile(join(root, 'ignored.log'), 'ignored');
    await git(root, 'add', '.gitignore', 'tracked.txt');

    const files = await vcs.listFiles(root);
    expect(files.sort()).toEqual(['.gitignore', 'tracked.txt', 'untracked.txt']);
  });

  it('resolves the revision hash via the git fallback in a git-only repo', async () => {
    await git(root, 'init', '-q');
    await writeFile(join(root, 'file.txt'), 'content');
    await git(root, 'add', 'file.txt');
    await git(root, 'commit', '-q', '-m', 'initial');

    const expected = await git(root, 'rev-parse', '--short', 'HEAD');
    expect(await vcs.revisionHash(root)).toBe(expected);
  });

  it('translates listing failures with the command and directory', async () => {
    const failure = await vcs.listFiles(root).catch((err: unknown) => err as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('git ls-files');
    expect((failure as Error).message).toContain(root);
  });

  it('translates hash failures with the command and directory', async () => {
    const failure = await vcs.revisionHash(root).catch((err: unknown) => err as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('git rev-parse');
    expect((failure as Error).message).toContain(root);
  });
});

describe('zip pipeline over real git and disk', () => {
  it('zips the working copy deterministically, round-tripping binary bytes', async () => {
    const fs = createNodeFileSystem();
    const logo = new Uint8Array([0x00, 0xff, 0x80, 0x7f]);
    await git(root, 'init', '-q');
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'index.md'), '# site');
    await writeFile(join(root, 'logo.bin'), logo);
    await writeFile(join(root, 'dist/site.html'), '<p>built</p>');
    await writeFile(join(root, 'deleted.txt'), 'gone soon');
    await git(root, 'add', '.');
    await git(root, 'commit', '-q', '-m', 'initial');
    await rm(join(root, 'deleted.txt'));

    const hash = await vcs.revisionHash(root);
    const files = await listRepoFiles({ vcs, fs }, root, ['dist']);
    const zip = await buildRepoZip(fs, root, files, { [COMMIT_FILE]: hash });

    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([COMMIT_FILE, 'index.md', 'logo.bin']);
    expect(new TextDecoder().decode(entries[COMMIT_FILE])).toBe(hash);
    expect(entries['logo.bin']).toEqual(logo);
  });
});
