import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  AwsError,
  entryShim,
  mergeConfig,
  type ObjectMetadata,
  type S3Client,
  type SsrShimConfig,
} from 'blogwright-core';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentType,
  DEFAULT_CONTENT_TYPE,
  extensionOf,
  generateSitemap,
  changedPathsManifest,
  MAX_PACKAGE_BYTES,
  packageWebFunction,
  publishBuild,
  createSiteUploader,
  resolveWithin,
  shouldUpload,
} from './build.js';

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
    await writeFile(join(dist, 'llms.txt'), ''); // non-html - excluded
    await writeFile(join(dist, '404.html'), ''); // error page - excluded
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

  it('leaves .ts unmapped - in build output it is stray TypeScript, not an HLS segment', () => {
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
    const puts: Array<{
      key: string;
      tags: Record<string, string> | undefined;
      cacheControl?: string | undefined;
    }> = [];
    const s3 = {
      putObject: async (
        _b: string,
        key: string,
        _c: Uint8Array,
        _t: string,
        metadata: ObjectMetadata = {},
      ) => {
        if (failTagged && metadata.tags) throw denied();
        puts.push({
          key,
          tags: metadata.tags,
          ...(metadata.cacheControl !== undefined ? { cacheControl: metadata.cacheControl } : {}),
        });
      },
    } as unknown as S3Client;
    return { s3, puts };
  }

  const html = (tags: Record<string, string> | undefined) => ({ contentType: 'text/html', tags });

  it('tags normally when the role is allowed to', async () => {
    const { s3, puts } = fakeS3(false);
    const logs: string[] = [];
    const upload = createSiteUploader(s3, (l) => logs.push(l));

    await upload('b', 'site/a.html', CONTENT, html(TAGS));

    expect(puts).toEqual([{ key: 'site/a.html', tags: TAGS }]);
    expect(logs).toEqual([]);
  });

  it('falls back to an untagged upload - once - when tagging is denied', async () => {
    const { s3, puts } = fakeS3(true);
    const logs: string[] = [];
    const upload = createSiteUploader(s3, (l) => logs.push(l));

    await upload('b', 'site/a.html', CONTENT, html(TAGS));
    await upload('b', 'site/b.html', CONTENT, html(TAGS));

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

    await expect(upload('b', 'site/a.html', CONTENT, html(TAGS))).rejects.toThrow(/AccessDenied/);
  });

  it('does not attempt a tagged put when there are no tags', async () => {
    const { s3, puts } = fakeS3(true); // would throw on a tagged put
    const upload = createSiteUploader(s3, () => undefined);

    await upload('b', 'site/a.html', CONTENT, html(undefined));
    await upload('b', 'site/c.html', CONTENT, html({}));

    expect(puts.map((p) => p.key)).toEqual(['site/a.html', 'site/c.html']);
  });

  it('keeps Cache-Control on the untagged fallback', async () => {
    const { s3, puts } = fakeS3(true);
    const upload = createSiteUploader(s3, () => undefined);

    await upload('b', 'site/a.html', CONTENT, { ...html(TAGS), cacheControl: 'no-store' });

    expect(puts).toEqual([{ key: 'site/a.html', tags: undefined, cacheControl: 'no-store' }]);
  });
});

describe('packageWebFunction', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ssr-package-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('zips the package with its contents at the archive root and a fixed timestamp', async () => {
    const dir = join(root, 'pkg-ok');
    await mkdir(join(dir, 'server'), { recursive: true });
    await writeFile(join(dir, 'index.js'), 'export {};');
    await writeFile(join(dir, 'server', 'entry.mjs'), 'export {};');

    const { zip } = await packageWebFunction(dir, 'index.js');
    const entries = Object.keys(unzipSync(zip)).sort();
    expect(entries).toEqual(['index.js', 'server/entry.mjs']);
    // Deterministic bytes: the same directory packages identically.
    const again = await packageWebFunction(dir, 'index.js');
    expect(Array.from(again.zip)).toEqual(Array.from(zip));
  });

  it('fails naming the entry point when the package does not emit it', async () => {
    const dir = join(root, 'pkg-no-entry');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'other.js'), '');
    await expect(packageWebFunction(dir, 'server/lambda.mjs')).rejects.toThrow(
      /entry point "server\/lambda\.mjs" does not exist/,
    );
  });

  it('adds a generated entry shim to the archive without writing it to the package', async () => {
    const dir = join(root, 'pkg-shim');
    await mkdir(join(dir, 'server'), { recursive: true });
    await writeFile(join(dir, 'server', 'entry.mjs'), 'export {};');
    const shim = { path: 'server/blogwright-entry.mjs', source: "await import('./entry.mjs');\n" };

    const { zip, size } = await packageWebFunction(dir, 'server/entry.mjs', shim);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['server/blogwright-entry.mjs', 'server/entry.mjs']);
    expect(new TextDecoder().decode(files['server/blogwright-entry.mjs'])).toBe(shim.source);
    expect(size).toBe('export {};'.length + shim.source.length);
    await expect(readdir(join(dir, 'server'))).resolves.toEqual(['entry.mjs']);
  });

  it('fails when the build already emits a file at the shim path', async () => {
    const dir = join(root, 'pkg-shim-clash');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.js'), '');
    await writeFile(join(dir, 'blogwright-entry.mjs'), '');
    await expect(
      packageWebFunction(dir, 'index.js', { path: 'blogwright-entry.mjs', source: '' }),
    ).rejects.toThrow(/already contains blogwright-entry\.mjs/);
  });

  it('fails naming the path when the package contains a symbolic link', async () => {
    const dir = join(root, 'pkg-link');
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'index.js'), '');
    await symlink('../outside', join(dir, 'node_modules', 'dep'));
    await expect(packageWebFunction(dir, 'index.js')).rejects.toThrow(
      /symbolic link at node_modules\/dep/,
    );
  });

  it('fails when the unzipped package exceeds the 512 MB bound', async () => {
    const dir = join(root, 'pkg-big');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.js'), '');
    // A sparse file of exactly the bound plus one byte: readdir/stat see the
    // size without 512 MB ever being written.
    await writeFile(join(dir, 'big.bin'), '');
    await truncate(join(dir, 'big.bin'), MAX_PACKAGE_BYTES + 1);
    await expect(packageWebFunction(dir, 'index.js')).rejects.toThrow(/over Lambda's 512 MB limit/);
  });
});

/*
 * The generated entry shim run the way Lambda runs it: the package is zipped,
 * unpacked into a clean directory, and Node starts the shim with
 * AWS_LAMBDA_HTTP_ENDPOINT set; the entry it imports reports what it was given.
 */
describe('generated entry shim at runtime', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ssr-shim-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function startPackage(
    shimBlock: SsrShimConfig,
    endpoint: string | undefined,
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const ssr = mergeConfig({
      siteName: 'example',
      region: 'us-east-1',
      ssr: { entryPoint: 'server/index.mjs', shim: shimBlock },
    }).ssr;
    const shim = ssr && entryShim(ssr);
    if (!ssr || !shim) throw new Error('fixture has no shim');
    const built = await mkdtemp(join(root, 'built-'));
    await mkdir(join(built, 'server'), { recursive: true });
    await writeFile(
      join(built, 'server', 'index.mjs'),
      'console.log(JSON.stringify({ host: process.env.NITRO_HOST, port: process.env.NITRO_PORT }));\n',
    );
    const { zip } = await packageWebFunction(built, ssr.entryPoint, shim);

    const unpacked = await mkdtemp(join(root, 'unpacked-'));
    for (const [path, bytes] of Object.entries(unzipSync(zip))) {
      await mkdir(dirname(join(unpacked, path)), { recursive: true });
      await writeFile(join(unpacked, path), bytes);
    }
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
    if (endpoint !== undefined) env.AWS_LAMBDA_HTTP_ENDPOINT = endpoint;
    return spawnSync(process.execPath, [shim.path], { cwd: unpacked, env, encoding: 'utf8' });
  }

  it('maps the endpoint host and port onto the configured variables, then starts the entry', async () => {
    const result = await startPackage({ host: 'NITRO_HOST', port: 'NITRO_PORT' }, '127.0.0.1:8080');
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ host: '127.0.0.1', port: '8080' });
  });

  it('splits an IPv6 endpoint at its last colon and unbrackets the host', async () => {
    const result = await startPackage({ host: 'NITRO_HOST', port: 'NITRO_PORT' }, '[::1]:9000');
    expect(JSON.parse(result.stdout)).toEqual({ host: '::1', port: '9000' });
  });

  it('leaves the host variable alone when only a port is configured', async () => {
    const result = await startPackage({ port: 'NITRO_PORT' }, '127.0.0.1:8080');
    expect(JSON.parse(result.stdout)).toEqual({ port: '8080' });
  });

  it('fails naming the variable when Lambda did not set it', async () => {
    const result = await startPackage({ port: 'NITRO_PORT' }, undefined);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AWS_LAMBDA_HTTP_ENDPOINT is not set');
  });
});

/*
 * The SSR publish branch: only `staticDir` reaches `site/`, stale keys are
 * listed rather than deleted, the artifact is uploaded and the result sidecar
 * is written. Exercised directly (not through `runBuild`, which spawns pnpm)
 * over a fake S3 client.
 */
describe('publishBuild (SSR)', () => {
  interface Recording {
    calls: string[];
    objects: Map<string, string>;
  }

  function fakeS3(recording: Recording, existing: string[]): S3Client {
    return {
      listObjects: async (_bucket: string, prefix: string) => {
        recording.calls.push(`list ${prefix}`);
        return existing.map((key) => ({ key, size: 1, lastModified: undefined, etag: 'other' }));
      },
      putObject: async (_bucket: string, key: string, body: unknown) => {
        recording.calls.push(`put ${key}`);
        recording.objects.set(key, typeof body === 'string' ? body : '<bytes>');
        return `version-${key}`;
      },
      deleteObject: async (_bucket: string, key: string) => {
        recording.calls.push(`delete ${key}`);
      },
    } as unknown as S3Client;
  }

  const log = () => undefined;

  it('packages the server, publishes only staticDir, and leaves stale keys for the CLI', async () => {
    const recording: Recording = { calls: [], objects: new Map() };
    const root = join(await mkdtemp(join(tmpdir(), 'ssr-publish-')), 'work');
    await mkdir(join(root, 'out'), { recursive: true });
    await writeFile(join(root, 'out', 'index.js'), 'export {};');
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(join(root, 'client', 'app.css'), 'body{}');

    await publishBuild(
      fakeS3(recording, ['site/app.css', 'site/old.html']),
      {
        hash: 'h1',
        sourceKey: 'build/h1.zip',
        bucket: 'b',
        region: 'us-east-1',
        sitePrefix: 'site/',
        webFunction: {
          packageDir: 'out',
          entryPoint: 'index.js',
          staticDir: 'client',
          artifactKey: 'web/artifacts/h1.zip',
          resultKey: 'web/results/h1.json',
        },
      },
      root,
      join(root, 'out'),
      log,
    );

    expect(recording.calls).toContain('put web/artifacts/h1.zip');
    expect(recording.calls).toContain('put site/app.css');
    // The server output is never published as S3 objects...
    expect(recording.calls.some((call) => call.includes('site/index.js'))).toBe(false);
    // ...and a stale key is listed, not deleted: the revision still serving
    // references it.
    expect(recording.calls).not.toContain('delete site/old.html');
    const result = JSON.parse(recording.objects.get('web/results/h1.json') ?? '{}') as {
      artifactKey: string;
      artifactVersionId: string;
      artifactSha256: string;
      staleStaticKeys: string[];
    };
    expect(result.artifactKey).toBe('web/artifacts/h1.zip');
    expect(result.artifactVersionId).toBe('version-web/artifacts/h1.zip');
    expect(result.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.staleStaticKeys).toEqual(['site/old.html']);
  });

  it('leaves site/ completely untouched when no staticDir is configured', async () => {
    const recording: Recording = { calls: [], objects: new Map() };
    const root = join(await mkdtemp(join(tmpdir(), 'ssr-publish-none-')), 'work');
    await mkdir(join(root, 'out'), { recursive: true });
    await writeFile(join(root, 'out', 'index.js'), 'export {};');

    await publishBuild(
      fakeS3(recording, ['site/index.html']),
      {
        hash: 'h2',
        sourceKey: 'build/h2.zip',
        bucket: 'b',
        region: 'us-east-1',
        sitePrefix: 'site/',
        webFunction: {
          packageDir: 'out',
          entryPoint: 'index.js',
          artifactKey: 'web/artifacts/h2.zip',
          resultKey: 'web/results/h2.json',
        },
      },
      root,
      join(root, 'out'),
      log,
    );

    expect(recording.calls.filter((call) => call.includes('site/'))).toEqual([]);
    expect(recording.calls).toContain('put web/artifacts/h2.zip');
  });
});

describe('publishBuild (static) Cache-Control', () => {
  const RULES = [
    { match: ['/_astro/**'], value: 'public, max-age=31536000, immutable' },
    { match: ['**'], value: 'public, max-age=0, must-revalidate' },
  ];

  interface Put {
    key: string;
    cacheControl: string | undefined;
  }

  /** An S3 double whose listing reports every existing key with `etag`. */
  function fakeS3(puts: Put[], existing: Array<{ key: string; etag: string }>): S3Client {
    return {
      listObjects: async () =>
        existing.map(({ key, etag }) => ({ key, size: 1, lastModified: undefined, etag })),
      putObject: async (
        _bucket: string,
        key: string,
        _body: unknown,
        _type: string,
        metadata: ObjectMetadata = {},
      ) => {
        puts.push({ key, cacheControl: metadata.cacheControl });
        return undefined;
      },
      deleteObject: async () => undefined,
    } as unknown as S3Client;
  }

  async function builtSite(): Promise<string> {
    const dist = join(await mkdtemp(join(tmpdir(), 'cache-control-')), 'dist');
    await mkdir(join(dist, '_astro'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<h1>hi</h1>');
    await writeFile(join(dist, '_astro', 'app.1a2b.js'), 'export {};');
    return dist;
  }

  const md5 = (text: string) => createHash('md5').update(text).digest('hex');

  async function publish(
    dist: string,
    opts: {
      sitePrefix: string;
      cacheControl?: typeof RULES;
      refresh?: boolean;
      existing?: Array<{ key: string; etag: string }>;
    },
  ): Promise<Put[]> {
    const puts: Put[] = [];
    await publishBuild(
      fakeS3(puts, opts.existing ?? []),
      {
        hash: 'h1',
        sourceKey: 'build/h1.zip',
        bucket: 'b',
        region: 'us-east-1',
        sitePrefix: opts.sitePrefix,
        ...(opts.cacheControl ? { cacheControl: opts.cacheControl } : {}),
        ...(opts.refresh ? { refresh: true } : {}),
      },
      dirname(dist),
      dist,
      () => undefined,
    );
    return puts.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  it('writes the first matching rule on each upload, by URL path', async () => {
    const puts = await publish(await builtSite(), { sitePrefix: 'site/', cacheControl: RULES });
    expect(puts).toEqual([
      { key: 'site/_astro/app.1a2b.js', cacheControl: 'public, max-age=31536000, immutable' },
      { key: 'site/index.html', cacheControl: 'public, max-age=0, must-revalidate' },
    ]);
  });

  it('matches a preview the same way, ignoring the previews/<id>/site/ key prefix', async () => {
    const puts = await publish(await builtSite(), {
      sitePrefix: 'previews/pr-7/site/',
      cacheControl: RULES,
    });
    expect(puts).toEqual([
      {
        key: 'previews/pr-7/site/_astro/app.1a2b.js',
        cacheControl: 'public, max-age=31536000, immutable',
      },
      { key: 'previews/pr-7/site/index.html', cacheControl: 'public, max-age=0, must-revalidate' },
    ]);
  });

  it('writes no Cache-Control when the job carries no rules', async () => {
    const puts = await publish(await builtSite(), { sitePrefix: 'site/' });
    expect(puts.map((p) => p.cacheControl)).toEqual([undefined, undefined]);
  });

  it('skips unchanged files normally, and retrofits the header onto them under refresh', async () => {
    const dist = await builtSite();
    const existing = [
      { key: 'site/index.html', etag: md5('<h1>hi</h1>') },
      { key: 'site/_astro/app.1a2b.js', etag: md5('export {};') },
    ];
    expect(await publish(dist, { sitePrefix: 'site/', cacheControl: RULES, existing })).toEqual([]);
    const refreshed = await publish(dist, {
      sitePrefix: 'site/',
      cacheControl: RULES,
      existing,
      refresh: true,
    });
    expect(refreshed.map((p) => p.cacheControl)).toEqual([
      'public, max-age=31536000, immutable',
      'public, max-age=0, must-revalidate',
    ]);
  });

  it('returns the rules it applied, normalised, so the manifest can report them', async () => {
    const dist = await builtSite();
    const payload = {
      hash: 'h1',
      sourceKey: 'build/h1.zip',
      bucket: 'b',
      region: 'us-east-1',
      sitePrefix: 'site/',
    };
    const applied = await publishBuild(
      fakeS3([], []),
      { ...payload, cacheControl: [{ match: ['**'], value: ' no-cache ' }] },
      dirname(dist),
      dist,
      () => undefined,
    );
    expect(applied.cacheControl).toEqual([{ match: ['**'], value: 'no-cache' }]);
    const none = await publishBuild(fakeS3([], []), payload, dirname(dist), dist, () => undefined);
    expect(none.cacheControl).toEqual([]);
  });

  it('fails the build on rules that do not validate, before uploading anything', async () => {
    const puts: Put[] = [];
    const dist = await builtSite();
    await expect(
      publishBuild(
        fakeS3(puts, []),
        {
          hash: 'h1',
          sourceKey: 'build/h1.zip',
          bucket: 'b',
          region: 'us-east-1',
          sitePrefix: 'site/',
          cacheControl: [{ match: ['*.html'], value: 'no-store' }],
        },
        dirname(dist),
        dist,
        () => undefined,
      ),
    ).rejects.toThrow(/can never match/);
    expect(puts).toEqual([]);
  });
});

describe('changedPathsManifest', () => {
  it('lists the invalidation paths and reports the cacheControl rules the agent applied', () => {
    const rules = [{ match: ['**'], value: 'no-cache' }];
    expect(
      changedPathsManifest(
        { changedKeys: new Set(['site/index.html', 'site/a.css']), count: 2, cacheControl: rules },
        'site/',
      ),
    ).toEqual({ paths: ['/index.html', '/', '/a.css'], cacheControl: rules });
  });

  it('reports empty rules as an empty list, not an absent field - absence means an older agent', () => {
    const manifest = changedPathsManifest(
      { changedKeys: new Set(), count: 0, cacheControl: [] },
      'site/',
    );
    expect(JSON.parse(JSON.stringify(manifest))).toEqual({ paths: [], cacheControl: [] });
  });
});
