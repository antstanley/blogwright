import { artifactManifestKey, stripColors } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { readArtifactManifest, readRecordedBeforeRebuild } from './artifacts.js';
import { deploy, rollback } from './commands.js';
import { attachFakeBuilder, createBuildContext, createMemoryS3 } from './test-support.js';

const HASH = 'abc123';
const NO_HOOKS = { afterDeploy: async () => undefined };

async function setup(
  site: Record<string, string>,
  builder: { siteVersion?: string; artifactWriteDenied?: boolean } = {},
) {
  const s3 = createMemoryS3();
  let files = site;
  attachFakeBuilder(s3, () => files, builder);
  const logged: string[] = [];
  const ctx = await createBuildContext({ s3, hash: HASH, logged });
  return {
    s3,
    ctx,
    lines: () => logged.map(stripColors),
    rebuildWith(next: Record<string, string>) {
      files = next;
    },
  };
}

describe('deploy records the artifact manifest', () => {
  it('asks the builder for build/artifacts/<hash>.json and reports the release', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'home' }, { siteVersion: '1.2.0' });
    const pending: string[] = [];
    s3.onPut((key, body) => {
      if (key.startsWith('build/pending/')) pending.push(new TextDecoder().decode(body));
    });

    await deploy(ctx, NO_HOOKS);

    expect(JSON.parse(pending[0]!)).toMatchObject({
      artifactManifestKey: artifactManifestKey(HASH),
    });
    const manifest = await readArtifactManifest(ctx, HASH);
    expect(manifest?.release).toMatch(/^1\.2\.0\+abc123\.[0-9a-f]{12}$/);
    expect(lines()).toContain(
      `release ${manifest!.release} (1 files, 0 KiB, sha256 ${manifest!.releaseHash})`,
    );
    expect(lines()).toContain(
      `  release: ${manifest!.release} (1 files, 0 KiB, sha256 ${manifest!.releaseHash})`,
    );
  });

  it('warns, naming bootstrap, when the builder could not record it', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'home' }, { artifactWriteDenied: true });

    await deploy(ctx, NO_HOOKS);

    expect(lines()).toContain(
      `no artifact manifest was recorded at build/artifacts/${HASH}.json - run ` +
        '`blogwright bootstrap production` to grant the builder write access to build/artifacts/',
    );
  });
});

describe('a rebuild rollback is checked against the recorded manifest', () => {
  it('prints both release hashes and confirms a byte-identical rebuild', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    const recorded = await readArtifactManifest(ctx, HASH);

    await rollback(ctx, HASH);

    expect(lines()).toContain(
      `  recorded release sha256 ${recorded!.releaseHash} (${recorded!.release})`,
    );
    expect(lines()).toContain(
      `  rebuilt  release sha256 ${recorded!.releaseHash} (${recorded!.release})`,
    );
    expect(lines()).toContain('the rebuild is byte-identical to the recorded artifact');
  });

  it('warns when the rebuilt bytes differ from the recorded ones', async () => {
    const { ctx, lines, rebuildWith } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    const recorded = await readArtifactManifest(ctx, HASH);
    rebuildWith({ 'index.html': 'home, rebuilt with a newer toolchain' });

    await rollback(ctx, HASH);

    const rebuilt = await readArtifactManifest(ctx, HASH);
    expect(rebuilt!.releaseHash).not.toBe(recorded!.releaseHash);
    expect(lines()).toContain(
      `  recorded release sha256 ${recorded!.releaseHash} (${recorded!.release})`,
    );
    expect(lines()).toContain(
      `  rebuilt  release sha256 ${rebuilt!.releaseHash} (${rebuilt!.release})`,
    );
    expect(lines().some((line) => line.startsWith('the rebuild is NOT byte-identical'))).toBe(true);
  });

  it('says so when nothing was recorded before the rebuild', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    s3.objects.delete(artifactManifestKey(HASH));

    await rollback(ctx, HASH);

    expect(lines()).toContain('  no artifact manifest was recorded before this rebuild');
  });
});

describe('readArtifactManifest', () => {
  it('is undefined when no manifest was recorded', async () => {
    const { ctx } = await setup({});
    expect(await readArtifactManifest(ctx, HASH)).toBeUndefined();
  });

  it('refuses a corrupt manifest, naming its location', async () => {
    const { s3, ctx } = await setup({});
    await s3.client.putObject('b', artifactManifestKey(HASH), '{"manifestVersion":1}');
    await expect(readArtifactManifest(ctx, HASH)).rejects.toThrow(
      /s3:\/\/.*\/build\/artifacts\/abc123\.json has no revision hash/,
    );
  });

  it('a rollback reads a corrupt record as absent, with a warning', async () => {
    const { s3, ctx, lines } = await setup({});
    await s3.client.putObject('b', artifactManifestKey(HASH), 'not json');
    expect(await readRecordedBeforeRebuild(ctx, HASH)).toBeUndefined();
    expect(lines().some((line) => line.startsWith('ignoring the recorded artifact manifest'))).toBe(
      true,
    );
  });
});
