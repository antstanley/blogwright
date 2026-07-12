import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentType,
  DEFAULT_CONTENT_TYPE,
  generateSitemap,
  invalidationPaths,
  resolveWithin,
  shouldUpload,
} from './build.js';

describe('invalidationPaths', () => {
  it('maps a plain asset to its URL path', () => {
    expect(invalidationPaths('site/_astro/app.css', 'site/')).toEqual(['/_astro/app.css']);
  });

  it('maps the root index to both /index.html and /', () => {
    expect(invalidationPaths('site/index.html', 'site/')).toEqual(['/index.html', '/']);
  });

  it('maps a nested index to the file and its directory URL', () => {
    expect(invalidationPaths('site/posts/index.html', 'site/')).toEqual([
      '/posts/index.html',
      '/posts/',
    ]);
  });
});

describe('contentType', () => {
  it('maps common static extensions', () => {
    expect(contentType('site/index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('a/b/style.css')).toBe('text/css; charset=utf-8');
    expect(contentType('app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentType('icon.svg')).toBe('image/svg+xml');
    expect(contentType('font.woff2')).toBe('font/woff2');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentType('mystery.zzz')).toBe('application/octet-stream');
    expect(contentType('noext')).toBe('application/octet-stream');
  });

  it('does not resolve inherited Object.prototype keys', () => {
    // A file named "x.constructor"/"x.toString" must not leak a prototype value.
    expect(contentType('x.constructor')).toBe('application/octet-stream');
    expect(contentType('x.toString')).toBe('application/octet-stream');
  });
});

describe('generateSitemap', () => {
  let dist: string;
  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'sitemap-'));
    await mkdir(join(dist, 'posts', 'hello'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '');
    await writeFile(join(dist, 'posts', 'index.html'), '');
    await writeFile(join(dist, 'posts', 'hello', 'index.html'), '');
    await writeFile(join(dist, 'llms.txt'), ''); // non-html — excluded
    await writeFile(join(dist, '404.html'), ''); // error page — excluded
    await writeFile(join(dist, '_astro', 'app.css'), '').catch(async () => {
      await mkdir(join(dist, '_astro'), { recursive: true });
      await writeFile(join(dist, '_astro', 'app.css'), '');
    });
  });
  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  it('lists HTML pages as clean directory URLs, sorted, excluding 404 and non-html', async () => {
    const xml = await generateSitemap(dist, 'https://example.com/');
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).toContain('<loc>https://example.com/posts/</loc>');
    expect(xml).toContain('<loc>https://example.com/posts/hello/</loc>');
    expect(xml).not.toContain('404');
    expect(xml).not.toContain('llms.txt');
    expect(xml).not.toContain('.css');
    // Trailing slash on base is normalised (no double slash).
    expect(xml).not.toContain('example.com//');
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});

describe('resolveWithin', () => {
  const WORK = '/tmp/build-x';

  it('resolves the root and nested app/dist dirs', () => {
    expect(resolveWithin(WORK, '.', 'appDir')).toBe(WORK);
    expect(resolveWithin(WORK, 'web', 'appDir')).toBe(`${WORK}/web`);
    expect(resolveWithin(WORK, 'web/build', 'distDir')).toBe(`${WORK}/web/build`);
  });

  it('rejects paths that escape the work dir', () => {
    expect(() => resolveWithin(WORK, '../elsewhere', 'appDir')).toThrow(/escapes/);
    expect(() => resolveWithin(WORK, 'web/../../up', 'distDir')).toThrow(/escapes/);
  });
});

describe('contentType coverage', () => {
  it('maps the PWA manifest and the other formerly-unmapped modern types', () => {
    expect(contentType('site.webmanifest')).toBe('application/manifest+json');
    expect(contentType('a/b/data.jsonld')).toBe('application/ld+json');
    expect(contentType('font.ttf')).toBe('font/ttf');
    expect(contentType('clip.mp4')).toBe('video/mp4');
    expect(contentType('stream.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(contentType('captions.vtt')).toBe('text/vtt; charset=utf-8');
    expect(contentType('paper.pdf')).toBe('application/pdf');
  });

  it('leaves .ts unmapped — in build output it is stray TypeScript, not an HLS segment', () => {
    expect(contentType('chunk.ts')).toBe(DEFAULT_CONTENT_TYPE);
  });

  it('falls back for a genuinely unknown extension', () => {
    expect(contentType('archive.tar.zst')).toBe(DEFAULT_CONTENT_TYPE);
    expect(contentType('no-extension')).toBe(DEFAULT_CONTENT_TYPE);
  });
});

describe('shouldUpload', () => {
  const MD5 = 'd41d8cd98f00b204e9800998ecf8427e';

  it('skips a content-identical file on a normal deploy', () => {
    expect(shouldUpload(MD5, MD5, false)).toBe(false);
    expect(shouldUpload(MD5, MD5, undefined)).toBe(false);
  });

  it('uploads changed and new files on a normal deploy', () => {
    expect(shouldUpload('other-etag', MD5, false)).toBe(true);
    expect(shouldUpload(undefined, MD5, false)).toBe(true);
  });

  it('uploads even an identical file under refresh, so metadata fixes land', () => {
    expect(shouldUpload(MD5, MD5, true)).toBe(true);
  });
});
