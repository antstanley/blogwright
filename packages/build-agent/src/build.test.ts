import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contentType, generateSitemap, invalidationPaths, resolveWithin } from './build.js';

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
