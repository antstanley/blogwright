import {
  artifactBuildManifestPrefix,
  artifactManifestKey,
  AwsError,
  createArtifactManifest,
  serializeArtifactManifest,
  sha256Hex,
  stripColors,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import {
  newArtifactBuildManifestKey,
  readArtifactManifest,
  readRecordedBeforeRebuild,
} from './artifacts.js';
import { deploy, rollback } from './commands.js';
import { attachFakeBuilder, createBuildContext, createMemoryS3 } from './test-support.js';

const HASH = 'abc123';
const NO_HOOKS = { afterDeploy: async () => undefined };

interface BuilderOptions {
  siteVersion?: string;
  artifactWriteDenied?: boolean;
  ignoresArtifactManifestKey?: boolean;
}

async function setup(site: Record<string, string>, builder: BuilderOptions = {}) {
  const s3 = createMemoryS3();
  let files = site;
  attachFakeBuilder(s3, () => files, builder);
  const logged: string[] = [];
  const ctx = await createBuildContext({ s3, hash: HASH, logged });
  const pendingJobs: Array<{ artifactManifestKey?: string }> = [];
  s3.onPut((key, body) => {
    if (key.startsWith('build/pending/'))
      pendingJobs.push(JSON.parse(new TextDecoder().decode(body)));
  });
  return {
    s3,
    ctx,
    builder,
    lines: () => logged.map(stripColors),
    clearLog() {
      logged.length = 0;
    },
    /** The artifact manifest key the latest build was asked to record at. */
    lastBuildKey: () => pendingJobs.at(-1)?.artifactManifestKey,
    rebuildWith(next: Record<string, string>) {
      files = next;
    },
  };
}

describe('newArtifactBuildManifestKey', () => {
  it('names a fresh object under the revision, sortable by start time', () => {
    const at = new Date('2026-10-28T18:23:12.345Z');
    const first = newArtifactBuildManifestKey(HASH, at);
    expect(first).toMatch(/^build\/artifacts\/abc123\/20261028T182312Z-[0-9a-f]{8}\.json$/);
    expect(newArtifactBuildManifestKey(HASH, at)).not.toBe(first);
  });
});

describe('deploy records the artifact manifest', () => {
  it('asks the builder for a per-build key, reports the release and keeps it as the original', async () => {
    const { ctx, lines, lastBuildKey } = await setup(
      { 'index.html': 'home' },
      { siteVersion: '1.2.0' },
    );

    await deploy(ctx, NO_HOOKS);

    const buildKey = lastBuildKey();
    expect(buildKey?.startsWith(artifactBuildManifestPrefix(HASH))).toBe(true);
    const manifest = await readArtifactManifest(ctx, HASH);
    expect(manifest?.release).toMatch(/^1\.2\.0\+abc123\.[0-9a-f]{12}$/);
    const release = `${manifest!.release} (1 files, 0 KiB, sha256 ${manifest!.releaseHash})`;
    expect(lines()).toContain(`release ${release}`);
    expect(lines()).toContain(`  artifact manifest s3://${ctx.names.bucket}/${buildKey}`);
    expect(lines()).toContain(
      `  recorded as the original release of ${HASH} at s3://${ctx.names.bucket}/` +
        artifactManifestKey(HASH),
    );
    expect(lines()).toContain(`  release: ${release}`);
  });

  it('warns, naming bootstrap, when the builder could not record it', async () => {
    const { s3, ctx, lines, lastBuildKey } = await setup(
      { 'index.html': 'home' },
      { artifactWriteDenied: true },
    );

    await deploy(ctx, NO_HOOKS);

    expect(
      lines().some((line) =>
        line.startsWith(
          `the builder recorded no artifact manifest at ${lastBuildKey()} - a stack bootstrapped ` +
            'before artifact manifests needs `blogwright bootstrap production`',
        ),
      ),
    ).toBe(true);
    expect(s3.objects.has(artifactManifestKey(HASH))).toBe(false);
  });

  it('never replaces the original when the same hash is deployed again with other bytes', async () => {
    const { s3, ctx, lines, rebuildWith, clearLog } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    const original = s3.text(artifactManifestKey(HASH));
    rebuildWith({ 'index.html': 'home, edited in a dirty git tree' });
    clearLog();

    await deploy(ctx, NO_HOOKS);

    expect(s3.text(artifactManifestKey(HASH))).toBe(original);
    const kept = await readArtifactManifest(ctx, HASH);
    expect(
      lines().some((line) =>
        line.startsWith(
          `this build of ${HASH} is not byte-identical to its original release ${kept!.release}`,
        ),
      ),
    ).toBe(true);
    // Both builds' own manifests are kept beside it.
    const builds = [...s3.objects.keys()].filter((key) =>
      key.startsWith(artifactBuildManifestPrefix(HASH)),
    );
    expect(builds).toHaveLength(2);
  });

  it('says a redeploy matches the original when its bytes are the same', async () => {
    const { ctx, lines, clearLog } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    clearLog();

    await deploy(ctx, NO_HOOKS);

    expect(
      lines().some((line) => line.startsWith(`  matches the original release of ${HASH}`)),
    ).toBe(true);
  });

  it('warns and still runs afterDeploy when the manifest cannot be read back', async () => {
    const s3 = createMemoryS3();
    const getObjectText = s3.client.getObjectText;
    s3.client.getObjectText = async (bucket: string, key: string) => {
      if (key.startsWith('build/artifacts/')) {
        throw new AwsError({ service: 's3', code: 'InternalError', message: 'x', statusCode: 500 });
      }
      return getObjectText(bucket, key);
    };
    attachFakeBuilder(s3, () => ({ 'index.html': 'home' }));
    const logged: string[] = [];
    const ctx = await createBuildContext({ s3, hash: HASH, logged });
    let afterDeployRan = false;

    await deploy(ctx, {
      afterDeploy: async () => {
        afterDeployRan = true;
      },
    });

    expect(afterDeployRan).toBe(true);
    expect(
      logged
        .map(stripColors)
        .some((line) => line.startsWith("ignoring the build's artifact manifest: s3:")),
    ).toBe(true);
  });

  it('warns and still runs afterDeploy when the build recorded a corrupt manifest', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'home' });
    s3.onPut((key) => {
      if (key.startsWith('build/pending/')) {
        const job = [...s3.objects.keys()].find((k) =>
          k.startsWith(artifactBuildManifestPrefix(HASH)),
        );
        if (job) s3.objects.set(job, { body: new TextEncoder().encode('{'), contentType: 'x' });
      }
    });
    let afterDeployRan = false;

    await deploy(ctx, {
      afterDeploy: async () => {
        afterDeployRan = true;
      },
    });

    expect(afterDeployRan).toBe(true);
    expect(lines().some((line) => line.includes('is not valid JSON'))).toBe(true);
    expect(s3.objects.has(artifactManifestKey(HASH))).toBe(false);
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

  it('warns when the rebuilt bytes differ, and keeps the original record', async () => {
    const { s3, ctx, lines, rebuildWith, lastBuildKey } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    const original = s3.text(artifactManifestKey(HASH));
    const recorded = await readArtifactManifest(ctx, HASH);
    rebuildWith({ 'index.html': 'home, rebuilt with a newer toolchain' });

    await rollback(ctx, HASH);

    const rebuildKey = lastBuildKey()!;
    const rebuilt = JSON.parse(s3.text(rebuildKey)!) as { releaseHash: string; release: string };
    expect(rebuilt.releaseHash).not.toBe(recorded!.releaseHash);
    expect(lines()).toContain(
      `  recorded release sha256 ${recorded!.releaseHash} (${recorded!.release})`,
    );
    expect(lines()).toContain(
      `  rebuilt  release sha256 ${rebuilt.releaseHash} (${rebuilt.release})`,
    );
    expect(lines().some((line) => line.startsWith('the rebuild is NOT byte-identical'))).toBe(true);
    // The reviewed record survives the rebuild.
    expect(s3.text(artifactManifestKey(HASH))).toBe(original);
  });

  it('compares a second rollback with the reviewed original, not the first rebuild', async () => {
    const { ctx, lines, rebuildWith, clearLog } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    rebuildWith({ 'index.html': 'home, rebuilt with a newer toolchain' });
    await rollback(ctx, HASH);
    clearLog();

    await rollback(ctx, HASH);

    expect(lines().some((line) => line.startsWith('the rebuild is NOT byte-identical'))).toBe(true);
  });

  // The review's finding 1: a rebuild that recorded nothing used to be compared
  // with the old record read back from the same key, and reported identical.
  it('never calls a rebuild byte-identical when the rebuild recorded no manifest', async () => {
    const { s3, ctx, lines, builder, rebuildWith, clearLog } = await setup({
      'index.html': 'home',
    });
    await deploy(ctx, NO_HOOKS);
    // The builder image is now an agent from before artifact manifests (a
    // static rollback does not rebuild the image), and the bytes differ.
    builder.ignoresArtifactManifestKey = true;
    rebuildWith({ 'index.html': 'DIFFERENT bytes' });
    clearLog();

    await rollback(ctx, HASH);

    expect(s3.text('site/index.html')).toBe('DIFFERENT bytes');
    expect(lines()).not.toContain('the rebuild is byte-identical to the recorded artifact');
    expect(lines()).toContain(
      'the rebuild recorded no artifact manifest, so it cannot be checked against the recorded ' +
        'release - treat the live site as unverified',
    );
  });

  it('finishes, with a warning, when the rebuild recorded a corrupt manifest', async () => {
    const { s3, ctx, lines, clearLog } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    const original = s3.text(artifactManifestKey(HASH));
    s3.onPut((key) => {
      if (!key.startsWith('build/pending/')) return;
      for (const built of s3.objects.keys()) {
        if (built.startsWith(artifactBuildManifestPrefix(HASH))) {
          s3.objects.set(built, { body: new TextEncoder().encode('{'), contentType: 'x' });
        }
      }
    });
    clearLog();

    await rollback(ctx, HASH);

    expect(lines().some((line) => line.includes('is not valid JSON'))).toBe(true);
    expect(
      lines().some((line) => line.startsWith('the rebuild recorded no artifact manifest')),
    ).toBe(true);
    expect(lines().some((line) => line.startsWith(`rolled back to ${HASH}`))).toBe(true);
    expect(s3.text(artifactManifestKey(HASH))).toBe(original);
  });

  it('says so when nothing was recorded before the rebuild, and records no original', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    s3.objects.delete(artifactManifestKey(HASH));

    await rollback(ctx, HASH);

    expect(lines()).toContain('  no artifact manifest was recorded before this rebuild');
    expect(s3.objects.has(artifactManifestKey(HASH))).toBe(false);
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

  it('refuses a manifest that records another revision', async () => {
    const { s3, ctx } = await setup({});
    const other = createArtifactManifest({
      hash: 'def456',
      files: [{ path: 'index.html', bytes: 1, sha256: sha256Hex('x') }],
    });
    await s3.client.putObject('b', artifactManifestKey(HASH), serializeArtifactManifest(other));
    await expect(readArtifactManifest(ctx, HASH)).rejects.toThrow(
      /build\/artifacts\/abc123\.json records revision def456, not abc123/,
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
