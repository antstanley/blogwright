import { artifactManifestKey, stripColors } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { deploy } from './commands.js';
import { attachFakeBuilder, createBuildContext, createMemoryS3 } from './test-support.js';
import { observeObjects, verify } from './verify.js';
import { readArtifactManifest } from './artifacts.js';

const HASH = 'abc123';
const SITE = { 'index.html': '<p>home</p>', 'posts/index.html': '<p>posts</p>' };

async function deployed(config?: Record<string, unknown>) {
  const s3 = createMemoryS3();
  attachFakeBuilder(s3, () => SITE);
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

  it('refuses an SSR environment, which records no artifact manifest', async () => {
    const { ctx } = await deployed({ ssr: { entryPoint: 'index.js' } });
    await expect(verify(ctx, HASH)).rejects.toThrow(/SSR environment/);
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
