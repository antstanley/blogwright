import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AwsError, parseArtifactManifest, sha256Hex, type S3Client } from 'blogwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildArtifactManifest,
  describeFiles,
  readSiteVersion,
  writeArtifactManifest,
} from './artifact.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bw-artifact-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTree(root: string, files: Record<string, string>): Promise<string[]> {
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
    paths.push(full);
  }
  return paths;
}

describe('describeFiles', () => {
  it('records each file by its slash-separated path, size and sha256', async () => {
    const dist = join(dir, 'dist');
    const files = await writeTree(dist, { 'index.html': 'home', 'posts/a/index.html': 'post' });
    expect(await describeFiles(dist, files)).toEqual([
      { path: 'index.html', bytes: 4, sha256: sha256Hex('home') },
      { path: 'posts/a/index.html', bytes: 4, sha256: sha256Hex('post') },
    ]);
  });
});

describe('readSiteVersion', () => {
  it('reads the app package version', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    expect(await readSiteVersion(dir)).toBe('1.2.3');
  });

  it('is undefined when the package declares no version', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'site' }));
    expect(await readSiteVersion(dir)).toBeUndefined();
  });

  it('is undefined for a non-string version', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: 3 }));
    expect(await readSiteVersion(dir)).toBeUndefined();
  });
});

describe('buildArtifactManifest', () => {
  it('builds a manifest whose release identity carries the site version', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '0.9.0' }));
    const dist = join(dir, 'dist');
    const files = await writeTree(dist, { 'b.css': 'b', 'a.html': 'a' });
    const manifest = await buildArtifactManifest({
      hash: 'abc123',
      appDir: dir,
      rootDir: dist,
      files,
    });
    expect(manifest.files.map((f) => f.path)).toEqual(['a.html', 'b.css']);
    expect(manifest.release).toBe(`0.9.0+abc123.${manifest.releaseHash.slice(0, 12)}`);
  });
});

describe('writeArtifactManifest', () => {
  const manifestFor = async () => {
    await writeFile(join(dir, 'package.json'), '{}');
    const files = await writeTree(join(dir, 'dist'), { 'index.html': 'x' });
    return buildArtifactManifest({ hash: 'h1', appDir: dir, rootDir: join(dir, 'dist'), files });
  };

  it('writes the serialized manifest as JSON and logs the release', async () => {
    const puts: { key: string; body: string; type: string }[] = [];
    const s3 = {
      putObject: async (_bucket: string, key: string, body: string, type: string) => {
        puts.push({ key, body, type });
        return undefined;
      },
    } as unknown as S3Client;
    const log: string[] = [];
    const manifest = await manifestFor();
    await writeArtifactManifest(
      s3,
      (line) => log.push(line),
      { bucket: 'b', key: 'build/artifacts/h1.json' },
      manifest,
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toBe('build/artifacts/h1.json');
    expect(puts[0]!.type).toBe('application/json');
    expect(parseArtifactManifest(puts[0]!.body, 'put')).toEqual(manifest);
    expect(log[0]).toContain(`release ${manifest.release}`);
  });

  it('logs a warning naming bootstrap instead of failing when the write is denied', async () => {
    const s3 = {
      putObject: async () => {
        throw new AwsError({ service: 's3', code: 'AccessDenied', message: 'no', statusCode: 403 });
      },
    } as unknown as S3Client;
    const log: string[] = [];
    await writeArtifactManifest(
      s3,
      (line) => log.push(line),
      { bucket: 'b', key: 'build/artifacts/h1.json' },
      await manifestFor(),
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^warning: could not write artifact manifest .*blogwright bootstrap/);
  });
});
