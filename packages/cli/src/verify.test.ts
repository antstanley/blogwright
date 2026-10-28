import {
  artifactManifestKey,
  AwsError,
  stripColors,
  type ObjectReadOptions,
  type Terminal,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { deploy } from './commands.js';
import { attachFakeBuilder, createBuildContext, createMemoryS3 } from './test-support.js';
import { observeObjects, verify, VERIFY_READ_CHUNK_BYTES } from './verify.js';
import { readArtifactManifest } from './artifacts.js';

const HASH = 'abc123';
const SITE = { 'index.html': '<p>home</p>', 'posts/index.html': '<p>posts</p>' };

async function deployed(config?: Record<string, unknown>, site: Record<string, string> = SITE) {
  const s3 = createMemoryS3();
  attachFakeBuilder(s3, () => site);
  const logged: string[] = [];
  const ctx = await createBuildContext({ s3, hash: HASH, logged });
  await deploy(ctx, { afterDeploy: async () => undefined });
  if (config) Object.assign(ctx.config, config);
  logged.length = 0;
  return { s3, ctx, lines: () => logged.map(stripColors) };
}

describe('verify', () => {
  it('passes when site/ holds exactly the recorded release', async () => {
    const { ctx, lines } = await deployed();
    const manifest = await readArtifactManifest(ctx, HASH);

    await verify(ctx, HASH);

    expect(lines()).toContain(
      `s3://${ctx.names.bucket}/site/ matches release ${manifest!.release}: 2 files, ` +
        `sha256 ${manifest!.releaseHash}`,
    );
  });

  it('fails on a same-size edit, naming the file and both hashes', async () => {
    const { s3, ctx, lines } = await deployed();
    await s3.client.putObject('b', 'site/index.html', '<p>HOME</p>');

    await expect(verify(ctx, HASH)).rejects.toThrow(
      /does not match release .*: 0 missing, 1 changed, 0 unexpected/,
    );
    expect(
      lines().some((line) => line.startsWith('  changed     index.html: expected 11 bytes')),
    ).toBe(true);
  });

  it('fails on a missing object', async () => {
    const { s3, ctx, lines } = await deployed();
    await s3.client.deleteObject('b', 'site/posts/index.html');

    await expect(verify(ctx, HASH)).rejects.toThrow(/1 missing, 0 changed, 0 unexpected/);
    expect(lines()).toContain('  missing     posts/index.html');
  });

  it('fails on an object the release does not contain, since it would be served too', async () => {
    const { s3, ctx, lines } = await deployed();
    await s3.client.putObject('b', 'site/stale.html', 'old');

    await expect(verify(ctx, HASH)).rejects.toThrow(/0 missing, 0 changed, 1 unexpected/);
    expect(lines()).toContain('  unexpected  stale.html');
  });

  it('refuses a hash with no recorded artifact manifest', async () => {
    const { s3, ctx } = await deployed();
    s3.objects.delete(artifactManifestKey(HASH));

    await expect(verify(ctx, HASH)).rejects.toThrow(
      /no artifact manifest is recorded for abc123 at s3:\/\/.*\/build\/artifacts\/abc123\.json/,
    );
  });

  it('refuses the preview stack, whose previews record no artifact manifest', async () => {
    const { ctx } = await deployed();
    Object.assign(ctx, { env: 'preview' });
    await expect(verify(ctx, HASH)).rejects.toThrow(/PR previews record none/);
  });

  it('refuses an SSR environment, which records no artifact manifest', async () => {
    const { ctx } = await deployed({ ssr: { entryPoint: 'index.js' } });
    await expect(verify(ctx, HASH)).rejects.toThrow(/SSR environment/);
  });
});

describe('verify - reading objects', () => {
  it('hashes a large object in ranged reads no bigger than the chunk, all of one version', async () => {
    const big = 'x'.repeat(VERIFY_READ_CHUNK_BYTES * 2 + 5);
    const { ctx } = await deployed(undefined, { ...SITE, 'video.bin': big });
    const reads: ObjectReadOptions[] = [];
    let largest = 0;
    const getObject = ctx.clients.s3.getObject.bind(ctx.clients.s3);
    ctx.clients.s3.getObject = async (bucket, key, opts) => {
      if (key === 'site/video.bin') reads.push(opts ?? {});
      const body = await getObject(bucket, key, opts);
      largest = Math.max(largest, body.byteLength);
      return body;
    };

    await verify(ctx, HASH);

    expect(reads.map((read) => read.range)).toEqual([
      { start: 0, end: VERIFY_READ_CHUNK_BYTES - 1 },
      { start: VERIFY_READ_CHUNK_BYTES, end: VERIFY_READ_CHUNK_BYTES * 2 - 1 },
      { start: VERIFY_READ_CHUNK_BYTES * 2, end: VERIFY_READ_CHUNK_BYTES * 2 + 4 },
    ]);
    expect(new Set(reads.map((read) => read.ifMatch)).size).toBe(1);
    expect(reads[0]?.ifMatch).toMatch(/^[0-9a-f]{32}$/);
    expect(largest).toBe(VERIFY_READ_CHUNK_BYTES);
  });

  it('verifies an empty file with one unranged read', async () => {
    const { ctx, lines } = await deployed(undefined, { ...SITE, '.nojekyll': '' });
    const reads: (ObjectReadOptions | undefined)[] = [];
    const getObject = ctx.clients.s3.getObject.bind(ctx.clients.s3);
    ctx.clients.s3.getObject = async (bucket, key, opts) => {
      if (key === 'site/.nojekyll') reads.push(opts);
      return getObject(bucket, key, opts);
    };

    await verify(ctx, HASH);

    expect(reads).toHaveLength(1);
    expect(reads[0]?.range).toBeUndefined();
    expect(lines().some((line) => line.includes('matches release'))).toBe(true);
  });

  it('reports an object deleted after the listing as missing', async () => {
    const { s3, ctx, lines } = await deployed();
    const getObject = ctx.clients.s3.getObject.bind(ctx.clients.s3);
    ctx.clients.s3.getObject = async (bucket, key, opts) => {
      if (key === 'site/posts/index.html') s3.objects.delete(key);
      return getObject(bucket, key, opts);
    };

    await expect(verify(ctx, HASH)).rejects.toThrow(/1 missing, 0 changed, 0 unexpected/);
    expect(lines()).toContain('  missing     posts/index.html');
  });

  it('refuses, naming the object, when it changes during verification', async () => {
    const { s3, ctx } = await deployed();
    const getObject = ctx.clients.s3.getObject.bind(ctx.clients.s3);
    ctx.clients.s3.getObject = async (bucket, key, opts) => {
      if (key === 'site/index.html') await s3.client.putObject(bucket, key, '<p>HOME</p>');
      return getObject(bucket, key, opts);
    };

    await expect(verify(ctx, HASH)).rejects.toThrow(
      /s3:\/\/.*\/site\/index\.html changed while verifying release .* - run verify again/,
    );
  });

  it('wraps any other read failure with the object and the release', async () => {
    const { ctx } = await deployed();
    ctx.clients.s3.getObject = async () => {
      throw new AwsError({ service: 's3', code: 'AccessDenied', message: 'no', statusCode: 403 });
    };

    await expect(verify(ctx, HASH)).rejects.toThrow(
      /could not read s3:\/\/.*\/site\/(posts\/)?index\.html while verifying release .*: s3: AccessDenied/,
    );
  });

  it('ignores empty folder markers, saying so, and still reports a non-empty one', async () => {
    const { s3, ctx, lines } = await deployed();
    await s3.client.putObject('b', 'site/', '');
    await s3.client.putObject('b', 'site/posts/', '');

    await verify(ctx, HASH);
    expect(lines()).toContain('  ignored     site/: an empty folder marker, never served');
    expect(lines()).toContain('  ignored     site/posts/: an empty folder marker, never served');

    await s3.client.putObject('b', 'site/drafts/', 'not empty');
    await expect(verify(ctx, HASH)).rejects.toThrow(/0 missing, 0 changed, 1 unexpected/);
    expect(lines()).toContain('  unexpected  drafts/');
  });

  it('shows progress on the status line and clears it', async () => {
    const { ctx } = await deployed();
    const statuses: string[] = [];
    const terminal: Terminal = { ...ctx.ports.terminal, status: (line) => statuses.push(line) };
    Object.assign(ctx.ports, { terminal });

    await verify(ctx, HASH);

    expect(statuses).toEqual([
      'verifying 1/2 objects under site/',
      'verifying 2/2 objects under site/',
      '',
    ]);
  });
});

describe('observeObjects', () => {
  it('reads only the objects whose size matches the record', async () => {
    const { s3, ctx } = await deployed();
    await s3.client.putObject('b', 'site/index.html', 'a different length entirely');
    await s3.client.putObject('b', 'site/extra.css', 'x');
    const reads: string[] = [];
    const getObject = ctx.clients.s3.getObject.bind(ctx.clients.s3);
    ctx.clients.s3.getObject = async (bucket, key) => {
      reads.push(key);
      return getObject(bucket, key);
    };
    const manifest = await readArtifactManifest(ctx, HASH);

    const observed = await observeObjects(ctx, 'site/', manifest!);

    expect(reads).toEqual(['site/posts/index.html']);
    expect(observed.get('index.html')).toEqual({ bytes: 27 });
    expect(observed.get('extra.css')).toEqual({ bytes: 1 });
  });
});
