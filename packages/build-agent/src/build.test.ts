import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AwsError, type S3Client } from 'blogwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentType,
  DEFAULT_CONTENT_TYPE,
  extensionOf,
  generateSitemap,
  createSiteUploader,
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

describe('extensionOf', () => {
  it('reads the extension from the basename only', () => {
    expect(extensionOf('site/assets/app.CSS')).toBe('css');
    expect(extensionOf('site/a.b/index.html')).toBe('html');
  });

  it('reports no extension for extensionless files, dotfiles, and trailing dots', () => {
    // Splitting the whole path would call these "site/license" and "site/_headers".
    expect(extensionOf('site/LICENSE')).toBeUndefined();
    expect(extensionOf('site/_headers')).toBeUndefined();
    expect(extensionOf('site/.nojekyll')).toBeUndefined();
    expect(extensionOf('site/weird.')).toBeUndefined();
  });

  it('keeps extensionless files out of the content-type map', () => {
    // A file named exactly like an extension must not inherit that type.
    expect(contentType('site/json')).toBe(DEFAULT_CONTENT_TYPE);
    expect(contentType('site/LICENSE')).toBe(DEFAULT_CONTENT_TYPE);
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

describe('createSiteUploader (issue #7 fail-soft tagging)', () => {
  const CONTENT = new TextEncoder().encode('body');
  const TAGS = { environment: 'production', app: 'blog' };

  function denied(): AwsError {
    return new AwsError({
      service: 's3',
      code: 'AccessDenied',
      message: 'not authorized to perform: s3:PutObjectTagging',
      statusCode: 403,
    });
  }

  function fakeS3(failTagged: boolean) {
    const puts: Array<{ key: string; tags: Record<string, string> | undefined }> = [];
    const s3 = {
      putObject: async (
        _b: string,
        key: string,
        _c: Uint8Array,
        _t: string,
        tags?: Record<string, string>,
      ) => {
        if (failTagged && tags) throw denied();
        puts.push({ key, tags });
      },
    } as unknown as S3Client;
    return { s3, puts };
  }

  it('tags normally when the role is allowed to', async () => {
    const { s3, puts } = fakeS3(false);
    const logs: string[] = [];
    const upload = createSiteUploader(s3, (l) => logs.push(l));

    await upload('b', 'site/a.html', CONTENT, 'text/html', TAGS);

    expect(puts).toEqual([{ key: 'site/a.html', tags: TAGS }]);
    expect(logs).toEqual([]);
  });

  it('falls back to an untagged upload — once — when tagging is denied', async () => {
    const { s3, puts } = fakeS3(true);
    const logs: string[] = [];
    const upload = createSiteUploader(s3, (l) => logs.push(l));

    await upload('b', 'site/a.html', CONTENT, 'text/html', TAGS);
    await upload('b', 'site/b.html', CONTENT, 'text/html', TAGS);

    // Both files land, untagged; the deploy is not failed by a metadata denial.
    expect(puts).toEqual([
      { key: 'site/a.html', tags: undefined },
      { key: 'site/b.html', tags: undefined },
    ]);
    // Warned once, not per file, and it names the remedy.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('s3:PutObjectTagging');
    expect(logs[0]).toContain('bootstrap');
  });

  it('rethrows a denial that is not about tagging (untagged retry also fails)', async () => {
    const s3 = {
      putObject: async () => {
        throw denied();
      },
    } as unknown as S3Client;
    const upload = createSiteUploader(s3, () => undefined);

    await expect(upload('b', 'site/a.html', CONTENT, 'text/html', TAGS)).rejects.toThrow(
      /AccessDenied/,
    );
  });

  it('does not attempt a tagged put when there are no tags', async () => {
    const { s3, puts } = fakeS3(true); // would throw on a tagged put
    const upload = createSiteUploader(s3, () => undefined);

    await upload('b', 'site/a.html', CONTENT, 'text/html', undefined);
    await upload('b', 'site/c.html', CONTENT, 'text/html', {});

    expect(puts.map((p) => p.key)).toEqual(['site/a.html', 'site/c.html']);
  });
});
