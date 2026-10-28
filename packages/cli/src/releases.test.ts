import {
  AwsError,
  artifactManifestKey,
  sha256Hex,
  stagedReleaseManifestKey,
  stripColors,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { readArtifactManifest } from './artifacts.js';
import { cacheControlRecordKey } from './cache-control.js';
import { deleteSite, deploy, history, rollback } from './commands.js';
import { readManifest, writeManifest } from './deploy.js';
import {
  LIVE_RELEASE_KEY,
  PUBLISHED_RELEASES_KEPT,
  publishedReleasesKey,
  readLiveRelease,
  readPublications,
  recordPublication,
} from './live-release.js';
import { historyTime, renderHistoryTable } from './render.js';
import { RELEASE_STAGING_OUTPUT } from './nodes.js';
import { promote, stage } from './releases.js';
import {
  attachFakeBuilder,
  createBuildContext,
  createMemoryS3,
  type FakeBuildJob,
} from './test-support.js';
import { resolveSeo } from './seo.js';
import { siteBaseUrl } from './serving.js';
import { verify } from './verify.js';

const HASH = 'abc123';
const NO_HOOKS = { afterDeploy: async () => undefined };

/** A production context whose builder publishes `site()` and whose exec role grants staging. */
async function setup(initial: Record<string, string>, hash = HASH) {
  const s3 = createMemoryS3();
  let files = initial;
  const failedJobs: FakeBuildJob[] = [];
  const builder: { fails?: boolean; failedJobs: FakeBuildJob[] } = { failedJobs };
  attachFakeBuilder(s3, () => files, builder);
  const logged: string[] = [];
  const invalidations: string[][] = [];
  const ctx = await createBuildContext({ s3, hash, logged, invalidations, failedJobs });
  ctx.state.resources['iam-exec-role']![RELEASE_STAGING_OUTPUT] = true;
  return {
    s3,
    ctx,
    builder,
    invalidations,
    lines: () => logged.map(stripColors),
    build(next: Record<string, string>, nextHash: string) {
      files = next;
      ctx.ports.vcs = { revisionHash: async () => nextHash, listFiles: async () => ['README.md'] };
    },
  };
}

/** Every object under a prefix as path → sha256, for byte-identity assertions. */
function snapshot(s3: ReturnType<typeof createMemoryS3>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, object] of s3.objects) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = sha256Hex(object.body);
  }
  return out;
}

describe('stage', () => {
  it('builds into releases/<hash>/, leaves site/ alone, and verifies the staged copy', async () => {
    const { s3, ctx, lines, invalidations } = await setup({ 'index.html': 'v1' });
    await s3.client.putObject('b', 'site/index.html', 'live');
    const pending: { key: string; job: Record<string, unknown> }[] = [];
    s3.onPut((key, body) => {
      if (key.startsWith('build/pending/')) {
        pending.push({ key, job: JSON.parse(new TextDecoder().decode(body)) });
      }
    });

    await stage(ctx);

    expect(pending).toHaveLength(1);
    expect(pending[0]!.key).toBe(`build/pending/release-${HASH}.json`);
    expect(pending[0]!.job).toMatchObject({ sitePrefix: `releases/${HASH}/` });
    // The build records its own manifest; the builder may not write the original.
    expect(String(pending[0]!.job.artifactManifestKey)).toMatch(
      new RegExp(`^build/artifacts/${HASH}/\\d{8}T\\d{6}Z-[0-9a-f]{8}\\.json$`),
    );
    expect(s3.text(stagedReleaseManifestKey(HASH))).toBeDefined();
    expect(snapshot(s3, `releases/${HASH}/`)).toEqual({ 'index.html': sha256Hex('v1') });
    expect(s3.text('site/index.html')).toBe('live');
    expect(s3.objects.has(`build/changed/release-${HASH}/${HASH}.json`)).toBe(false);
    expect(invalidations).toEqual([]);
    expect((await readManifest(ctx, HASH, 'staged'))?.kind).toBe('staged');
    // The hash's deployment manifest is a deploy's alone.
    expect(await readManifest(ctx, HASH)).toBeUndefined();
    expect(lines().some((line) => line.includes(`releases/${HASH}/ matches release`))).toBe(true);
    expect(lines()).toContain(`  promote it with: blogwright promote ${HASH} production`);
  });

  it('refuses, before building, on a stack bootstrapped before staging existed', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    delete ctx.state.resources['iam-exec-role']![RELEASE_STAGING_OUTPUT];

    await expect(stage(ctx)).rejects.toThrow(
      /bootstrapped before release staging existed: run `blogwright bootstrap production`.*Nothing was built/,
    );
    expect(s3.objects.size).toBe(0);
  });

  it('refuses an SSR environment', async () => {
    const { ctx } = await setup({});
    Object.assign(ctx.config, { ssr: { entryPoint: 'index.js' } });
    await expect(stage(ctx)).rejects.toThrow(/stage publishes static releases.*SSR environment/);
  });

  it('refuses the shared preview stack', async () => {
    const { ctx } = await setup({});
    Object.assign(ctx, { preview: true });
    await expect(stage(ctx)).rejects.toThrow(/does not apply to the shared preview stack/);
  });
});

describe('promote', () => {
  it('publishes exactly the staged bytes, metadata and tags, without a build', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'v1', 'posts/index.html': 'post' });
    await stage(ctx);
    const launches = lines().filter((line) => line.startsWith('running builder MicroVM')).length;

    await promote(ctx, HASH, NO_HOOKS);

    expect(lines().filter((line) => line.startsWith('running builder MicroVM'))).toHaveLength(
      launches,
    );
    expect(snapshot(s3, 'site/')).toEqual(snapshot(s3, `releases/${HASH}/`));
    const live = s3.objects.get('site/index.html')!;
    const staged = s3.objects.get(`releases/${HASH}/index.html`)!;
    expect(live.contentType).toBe(staged.contentType);
    expect(live.tags).toEqual(staged.tags);
    const manifest = await readArtifactManifest(ctx, HASH);
    expect(lines()).toContain(
      `s3://${ctx.names.bucket}/site/ matches release ${manifest!.release}: 2 files, ` +
        `sha256 ${manifest!.releaseHash}`,
    );
  });

  it('copies only what differs (same Cache-Control rules), deletes stale objects, and invalidates just those paths', async () => {
    const { s3, ctx, invalidations, build } = await setup({
      'index.html': 'home',
      'old.html': 'gone soon',
    });
    await deploy(ctx, NO_HOOKS);
    invalidations.length = 0;
    build({ 'index.html': 'home', 'posts/index.html': 'new post' }, 'def456');
    await stage(ctx);
    const copies: string[] = [];
    const copyObject = ctx.clients.s3.copyObject.bind(ctx.clients.s3);
    ctx.clients.s3.copyObject = async (bucket, source, destination, options) => {
      copies.push(destination);
      return copyObject(bucket, source, destination, options);
    };

    await promote(ctx, 'def456', NO_HOOKS);

    expect(copies).toEqual(['site/posts/index.html']);
    expect(Object.keys(snapshot(s3, 'site/')).sort()).toEqual(['index.html', 'posts/index.html']);
    expect(invalidations).toEqual([['/posts/index.html', '/posts/', '/old.html']]);
  });

  it('prints the release it replaced beside the one it published', async () => {
    const { ctx, lines, build } = await setup({ 'index.html': 'one' });
    await deploy(ctx, NO_HOOKS);
    const before = await readArtifactManifest(ctx, HASH);
    build({ 'index.html': 'two' }, 'def456');
    await stage(ctx);

    await promote(ctx, 'def456', NO_HOOKS);

    const after = await readArtifactManifest(ctx, 'def456');
    expect(lines()).toContain(`  previous: ${before!.release} (sha256 ${before!.releaseHash})`);
    expect(lines().some((line) => line.startsWith(`  release: ${after!.release} (`))).toBe(true);
    expect(await readLiveRelease(ctx)).toMatchObject({
      hash: 'def456',
      releaseHash: after!.releaseHash,
      via: 'promote',
    });
  });

  it('records the staged manifest as the original when the revision has none', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    expect(s3.text(artifactManifestKey(HASH))).toBe(s3.text(stagedReleaseManifestKey(HASH)));
    await promote(ctx, HASH, NO_HOOKS);
    await verify(ctx, HASH);
  });

  it('promotes a staged build whose bytes differ from the revision original, against its own manifest', async () => {
    const { s3, ctx, lines, build } = await setup({ 'index.html': 'first build' });
    await deploy(ctx, NO_HOOKS);
    const original = s3.text(artifactManifestKey(HASH));
    build({ 'index.html': 'second build' }, HASH);

    await stage(ctx);
    expect(s3.text(artifactManifestKey(HASH))).toBe(original);
    expect(
      lines().some((line) => line.startsWith('promote publishes and checks this staged release')),
    ).toBe(true);

    await promote(ctx, HASH, NO_HOOKS);
    expect(s3.text('site/index.html')).toBe('second build');
    await verify(ctx, HASH, 'staged');
    await expect(verify(ctx, HASH)).rejects.toThrow(/does not match release/);
  });

  it('leaves nothing promotable when a re-stage stops partway', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    s3.onPut((key) => {
      if (key.startsWith('build/pending/')) throw new Error('builder unavailable');
    });
    await expect(stage(ctx)).rejects.toThrow(/builder unavailable/);
    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(/is not staged/);
  });

  it('refuses a hash that was never staged', async () => {
    const { ctx } = await setup({ 'index.html': 'v1' });
    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      new RegExp(
        `${HASH} is not staged: there is no staged release record at s3://.*/build/releases/${HASH}\\.json`,
      ),
    );
  });

  it('refuses a staged release whose bytes no longer match, copying nothing', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    await s3.client.putObject('b', `releases/${HASH}/index.html`, 'v2');

    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      /cannot promote abc123: .*releases\/abc123\/ does not match release .*0 missing, 1 changed, 0 unexpected.*Stage it again with `blogwright stage production` from a checkout of abc123, then promote it\./,
    );
    expect(snapshot(s3, 'site/')).toEqual({});
  });

  it('promotes untagged, with one warning, when the role may not copy tags', async () => {
    const { s3, ctx, lines } = await setup({ 'a.html': 'a', 'b.html': 'b' });
    await stage(ctx);
    const copyObject = ctx.clients.s3.copyObject.bind(ctx.clients.s3);
    ctx.clients.s3.copyObject = async (bucket, source, destination, options = {}) => {
      if ((options.tags ?? 'copy') === 'copy') {
        throw new AwsError({ service: 's3', code: 'AccessDenied', message: 'no', statusCode: 403 });
      }
      return copyObject(bucket, source, destination, options);
    };

    await promote(ctx, HASH, NO_HOOKS);

    expect(snapshot(s3, 'site/')).toEqual(snapshot(s3, `releases/${HASH}/`));
    expect(s3.objects.get('site/a.html')?.tags).toBeUndefined();
    expect(
      lines().filter((line) => line.startsWith('this role cannot copy object tags')),
    ).toHaveLength(1);
  });

  it('runs the post-deploy plugin steps when the working copy is the promoted revision', async () => {
    const { ctx } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    let ran = 0;
    await promote(ctx, HASH, { afterDeploy: async () => void (ran += 1) });
    expect(ran).toBe(1);
  });

  it('skips them, with a warning, when the working copy is another revision', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    ctx.ports.vcs = { revisionHash: async () => 'zzz999', listFiles: async () => [] };
    let ran = 0;
    await promote(ctx, HASH, { afterDeploy: async () => void (ran += 1) });
    expect(ran).toBe(0);
    expect(
      lines().some((line) =>
        line.startsWith('skipping the post-deploy plugin steps: they publish the working copy'),
      ),
    ).toBe(true);
  });
});

describe('verify --staged', () => {
  it('checks the staged copy rather than site/', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    await verify(ctx, HASH, 'staged');
    expect(lines().some((line) => line.includes(`releases/${HASH}/ matches release`))).toBe(true);
    await expect(verify(ctx, HASH, 'live')).rejects.toThrow(/1 missing/);
  });
});

describe('the live-release record', () => {
  it('follows a deploy, and is dropped when the site is emptied', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    await deploy(ctx, NO_HOOKS);
    expect(await readLiveRelease(ctx)).toMatchObject({ hash: HASH, via: 'deploy' });

    await deleteSite(ctx);
    expect(s3.objects.has(LIVE_RELEASE_KEY)).toBe(false);
  });

  it('is ignored with a warning when unreadable', async () => {
    const { s3, ctx, lines } = await setup({});
    await s3.client.putObject('b', LIVE_RELEASE_KEY, '{"hash":1}');
    expect(await readLiveRelease(ctx)).toBeUndefined();
    expect(lines().some((line) => line.startsWith('ignoring unreadable live-release record'))).toBe(
      true,
    );
  });
});

describe('history of staged releases', () => {
  it('shows a staged build as staged until it is promoted, then as live', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    const plainRows = async () => {
      const start = lines().length;
      await history(ctx);
      return lines()
        .slice(start)
        .filter((line) => line.startsWith(HASH));
    };

    expect((await plainRows())[0]).toMatch(/^abc123\s+staged\s/);
    await promote(ctx, HASH, NO_HOOKS);
    const promotedAt = (await readManifest(ctx, HASH, 'staged'))?.promotedAt;
    expect((await plainRows())[0]).toMatch(new RegExp(`^abc123\\s+promoted\\s+${promotedAt}`));
  });
});

describe('rollback to a staged release', () => {
  /** Stage and promote two releases, leaving the second live and checked out. */
  async function twoReleases() {
    const env = await setup({ 'index.html': 'first', 'about/index.html': 'about' });
    await stage(env.ctx);
    await promote(env.ctx, HASH, NO_HOOKS);
    env.build({ 'index.html': 'second', 'new.html': 'new' }, 'def456');
    await stage(env.ctx);
    await promote(env.ctx, 'def456', NO_HOOKS);
    env.invalidations.length = 0;
    return env;
  }

  const launches = (lines: string[]) =>
    lines.filter((line) => line.startsWith('running builder MicroVM')).length;

  it('republishes the stored bytes without a build and prints both release hashes', async () => {
    const { s3, ctx, lines, invalidations } = await twoReleases();
    const restored = await readArtifactManifest(ctx, HASH);
    const replaced = await readArtifactManifest(ctx, 'def456');
    const builds = launches(lines());

    await rollback(ctx, HASH, NO_HOOKS);

    expect(launches(lines())).toBe(builds);
    expect(snapshot(s3, 'site/')).toEqual(snapshot(s3, `releases/${HASH}/`));
    expect(lines()).toContain(
      `  previous release ${replaced!.release} (sha256 ${replaced!.releaseHash})`,
    );
    expect(lines()).toContain(
      `  restored release ${restored!.release} (sha256 ${restored!.releaseHash})`,
    );
    expect(
      lines().some((line) =>
        line.includes(
          `site/ matches release ${restored!.release}: 2 files, sha256 ${restored!.releaseHash}`,
        ),
      ),
    ).toBe(true);
    expect(invalidations).toEqual([
      ['/about/index.html', '/about/', '/index.html', '/', '/new.html'],
    ]);
    expect(await readLiveRelease(ctx)).toMatchObject({ hash: HASH, via: 'rollback' });
    expect(await readPublications(ctx, HASH)).toMatchObject([
      { releaseHash: restored!.releaseHash, via: 'promote' },
      { releaseHash: restored!.releaseHash, via: 'rollback' },
    ]);
    expect(lines().some((line) => line.includes('staged again'))).toBe(false);
    expect(lines().some((line) => line.includes('another origin'))).toBe(false);
  });

  it('reads the staged release record once and lists the staged prefix only to verify and copy', async () => {
    const { ctx } = await twoReleases();
    const reads: string[] = [];
    const getObjectText = ctx.clients.s3.getObjectText.bind(ctx.clients.s3);
    ctx.clients.s3.getObjectText = async (bucket, key) => {
      reads.push(key);
      return getObjectText(bucket, key);
    };
    const lists: string[] = [];
    const listObjects = ctx.clients.s3.listObjects.bind(ctx.clients.s3);
    ctx.clients.s3.listObjects = async (bucket, prefix) => {
      lists.push(prefix);
      return listObjects(bucket, prefix);
    };

    await rollback(ctx, HASH, NO_HOOKS);

    expect(reads.filter((key) => key === stagedReleaseManifestKey(HASH))).toHaveLength(1);
    expect(lists.filter((prefix) => prefix === `releases/${HASH}/`)).toHaveLength(2);
  });

  it('restores the Cache-Control the release was staged with, and its record', async () => {
    const noStore = [{ match: ['**'], value: 'no-store' }];
    const { s3, ctx, build, lines } = await setup({ 'index.html': 'first' });
    Object.assign(ctx.config, { cacheControl: noStore });
    await stage(ctx);
    await promote(ctx, HASH, NO_HOOKS);
    Object.assign(ctx.config, { cacheControl: [{ match: ['**'], value: 'max-age=60' }] });
    build({ 'index.html': 'second' }, 'def456');
    await stage(ctx);
    await promote(ctx, 'def456', NO_HOOKS);
    expect(s3.objects.get('site/index.html')?.cacheControl).toBe('max-age=60');

    await rollback(ctx, HASH, NO_HOOKS);

    expect(s3.objects.get('site/index.html')?.cacheControl).toBe('no-store');
    expect(JSON.parse(s3.text(cacheControlRecordKey('site'))!)).toEqual({
      status: 'applied',
      rules: noStore,
    });
    // The shared messages name the command that is running.
    expect(lines()).toContainEqual(
      expect.stringContaining('republishing the Cache-Control it was staged with'),
    );
  });

  it('names the rollback, not a promotion, when it republishes untagged', async () => {
    const { ctx, lines } = await twoReleases();
    const copyObject = ctx.clients.s3.copyObject.bind(ctx.clients.s3);
    ctx.clients.s3.copyObject = async (bucket, source, destination, options = {}) => {
      if ((options.tags ?? 'copy') === 'copy') {
        throw new AwsError({ service: 's3', code: 'AccessDenied', message: 'no', statusCode: 403 });
      }
      return copyObject(bucket, source, destination, options);
    };

    await rollback(ctx, HASH, NO_HOOKS);

    expect(lines()).toContainEqual(expect.stringContaining('republishing untagged'));
    expect(lines()).toContainEqual(
      expect.stringContaining(`then \`blogwright rollback ${HASH} production --refresh\``),
    );
  });

  it('refuses a staged copy that was changed, naming the counts and the way out', async () => {
    const { s3, ctx } = await twoReleases();
    const live = snapshot(s3, 'site/');
    const record = s3.text(LIVE_RELEASE_KEY);
    await s3.client.putObject('b', `releases/${HASH}/index.html`, 'tampered');

    const refused = rollback(ctx, HASH, NO_HOOKS);

    await expect(refused).rejects.toThrow(
      /cannot republish abc123: .*releases\/abc123\/ does not match release .*: 0 missing, 1 changed, 0 unexpected \(the staged copy was modified after it was staged and checked\)\. Nothing was published\./,
    );
    await expect(refused).rejects.toThrow(
      /`blogwright stage production` from a checkout of abc123.*`blogwright rollback abc123 production --rebuild`/,
    );
    expect(snapshot(s3, 'site/')).toEqual(live);
    expect(s3.text(LIVE_RELEASE_KEY)).toBe(record);
  });

  it('refuses a staged copy a lifecycle rule partly expired, then --rebuild rolls back from source', async () => {
    const { s3, ctx, lines, build } = await twoReleases();
    const live = snapshot(s3, 'site/');
    s3.objects.delete(`releases/${HASH}/about/index.html`);
    const builds = launches(lines());

    await expect(rollback(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      /does not match release .*: 1 missing, 0 changed, 0 unexpected \(objects are missing from the staged copy - an S3 lifecycle rule expiring releases\/ objects, or a delete, removes them\)/,
    );
    expect(snapshot(s3, 'site/')).toEqual(live);
    expect(launches(lines())).toBe(builds);

    // The escape hatch: rebuild the archived source, compared with the original.
    build({ 'index.html': 'first', 'about/index.html': 'about' }, 'def456');
    await rollback(ctx, HASH, { ...NO_HOOKS, rebuild: true });

    expect(launches(lines())).toBe(builds + 1);
    expect(lines()).toContain(
      `rebuilding ${HASH} from build/${HASH}.zip, as --rebuild asks - any staged release of it is not used`,
    );
    expect(lines()).toContain('the rebuild is byte-identical to the recorded artifact');
    expect(s3.text('site/index.html')).toBe('first');
    expect(await readLiveRelease(ctx)).toMatchObject({ hash: HASH, via: 'rollback' });
  });

  it('refuses a staged copy that expired entirely, rather than rebuilding unreviewed bytes', async () => {
    const { s3, ctx, lines } = await twoReleases();
    for (const key of s3.objects.keys()) {
      if (key.startsWith(`releases/${HASH}/`)) s3.objects.delete(key);
    }
    const builds = launches(lines());

    await expect(rollback(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      /2 missing, 0 changed, 0 unexpected \(objects are missing from the staged copy/,
    );
    expect(launches(lines())).toBe(builds);
  });

  it('republishes again once the hash is staged again', async () => {
    const { s3, ctx, build } = await twoReleases();
    await s3.client.putObject('b', `releases/${HASH}/index.html`, 'tampered');
    await expect(rollback(ctx, HASH, NO_HOOKS)).rejects.toThrow(/cannot republish/);

    build({ 'index.html': 'first', 'about/index.html': 'about' }, HASH);
    await stage(ctx);
    await rollback(ctx, HASH, NO_HOOKS);

    expect(s3.text('site/index.html')).toBe('first');
  });

  it('refuses, rather than rebuilding, when the staged release record is unreadable', async () => {
    const { s3, ctx, lines } = await twoReleases();
    const live = snapshot(s3, 'site/');
    await s3.client.putObject('b', stagedReleaseManifestKey(HASH), 'not json');
    const builds = launches(lines());

    await expect(rollback(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      /cannot republish abc123: its staged release record at s3:\/\/.*\/build\/releases\/abc123\.json is unreadable \(.*\), so its staged bytes cannot be checked\. Nothing was published\. To recover, stage it again .*--rebuild/,
    );
    expect(launches(lines())).toBe(builds);
    expect(snapshot(s3, 'site/')).toEqual(live);
  });

  it('rebuilds from the source zip when the hash has no staged release, saying why', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'v1' });
    await deploy(ctx, NO_HOOKS);
    const builds = launches(lines());

    await rollback(ctx, HASH, NO_HOOKS);

    expect(launches(lines())).toBe(builds + 1);
    expect(lines()).toContain(
      `${HASH} has no staged release (no record at build/releases/${HASH}.json) - ` +
        `rebuilding from build/${HASH}.zip`,
    );
    expect(lines().some((line) => line.includes('republishing'))).toBe(false);
  });

  it('warns once, and never claims no record, when the original manifest is unreadable', async () => {
    const { s3, ctx, lines, build } = await setup({ 'index.html': 'v1' });
    await deploy(ctx, NO_HOOKS);
    await s3.client.putObject('b', artifactManifestKey(HASH), 'not json');
    build({ 'index.html': 'v2' }, 'def456');
    await deploy(ctx, NO_HOOKS);
    const from = lines().length;

    await rollback(ctx, HASH, NO_HOOKS);

    const rolled = lines().slice(from);
    expect(
      rolled.filter((line) => line.startsWith('ignoring the recorded artifact manifest')),
    ).toHaveLength(1);
    expect(rolled).not.toContain('  no artifact manifest was recorded before this rebuild');
    expect(rolled).toContainEqual(
      expect.stringContaining('the original artifact manifest could not be read'),
    );
  });

  it('says so, and changes nothing, when the hash is already live', async () => {
    const { s3, ctx, lines, invalidations } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    await promote(ctx, HASH, NO_HOOKS);
    invalidations.length = 0;
    const live = snapshot(s3, 'site/');
    const release = (await readArtifactManifest(ctx, HASH))!.release;

    await rollback(ctx, HASH, NO_HOOKS);

    expect(lines()).toContain(
      `${release} is already the live release - this rollback only checks site/ against it ` +
        'and repairs any difference',
    );
    expect(lines()).toContain(
      `site/ already held ${release}: nothing was copied, deleted or invalidated`,
    );
    expect(invalidations).toEqual([]);
    expect(snapshot(s3, 'site/')).toEqual(live);
  });

  it('warns when the hash was staged again since it was last published', async () => {
    const { ctx, lines, build } = await setup({ 'index.html': 'reviewed' });
    await stage(ctx);
    await promote(ctx, HASH, NO_HOOKS);
    const promoted = (await readPublications(ctx, HASH))[0]!;
    build({ 'index.html': 'restaged' }, HASH);
    await stage(ctx);
    build({ 'index.html': 'other' }, 'def456');
    await stage(ctx);
    await promote(ctx, 'def456', NO_HOOKS);

    await rollback(ctx, HASH, NO_HOOKS);

    expect(lines()).toContainEqual(
      expect.stringContaining(
        `${HASH} was staged again since its last promote on ${promoted.publishedAt}, which ` +
          `published ${promoted.release} (sha256 ${promoted.releaseHash})`,
      ),
    );
    expect((await readPublications(ctx, HASH)).map((p) => p.via)).toEqual(['promote', 'rollback']);
  });

  it("warns when the release's robots.txt and sitemap were staged for another origin", async () => {
    const env = await setup({});
    Object.assign(env.ctx, { domain: 'example.com' });
    const current = resolveSeo(env.ctx, siteBaseUrl(env.ctx));
    const sitemap = (origin: string) =>
      `<?xml version="1.0"?><urlset><url><loc>${origin}/</loc></url></urlset>`;
    env.build(
      {
        'index.html': 'v1',
        'robots.txt': current.robots!,
        'sitemap.xml': sitemap(current.sitemapBaseUrl!),
      },
      HASH,
    );
    await stage(env.ctx);
    env.build(
      {
        'index.html': 'v2',
        'robots.txt': 'User-agent: *\nAllow: /\n\nSitemap: https://old.example.com/sitemap.xml\n',
        'sitemap.xml': sitemap('https://old.example.com'),
      },
      'def456',
    );
    await stage(env.ctx);
    await promote(env.ctx, HASH, NO_HOOKS);
    expect(env.lines().some((line) => line.includes('another origin'))).toBe(false);

    await rollback(env.ctx, 'def456', NO_HOOKS);

    expect(env.lines()).toContainEqual(
      expect.stringContaining(
        'def456 was staged for another origin or seo config than "production" has now - ' +
          'robots.txt and sitemap.xml (its URLs are on https://old.example.com) differ from ' +
          'what a build for https://example.com would publish today. The staged bytes are ' +
          'restored as they are',
      ),
    );
  });

  it('runs the post-deploy plugin steps only when the working copy is the rolled-back revision', async () => {
    const { ctx, lines, build } = await twoReleases();
    let ran = 0;
    const hooks = { afterDeploy: async () => void (ran += 1) };

    await rollback(ctx, HASH, hooks);
    expect(ran).toBe(0);
    expect(lines()).toContainEqual(
      expect.stringContaining('skipping the post-deploy plugin steps'),
    );

    build({ 'index.html': 'second', 'new.html': 'new' }, 'def456');
    await rollback(ctx, 'def456', hooks);
    expect(ran).toBe(1);
  });

  it('names what is unknown when no live-release record exists', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'v1' });
    await stage(ctx);

    await rollback(ctx, HASH, NO_HOOKS);

    expect(lines()).toContainEqual(
      expect.stringMatching(/^ {2}previous release unknown - no live-release record: site\/ was/),
    );
  });
});

describe('the publication record', () => {
  it('keeps the newest publications of a revision, and reads an unreadable record as empty', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    const manifest = (await readArtifactManifest(ctx, HASH))!;
    for (let i = 0; i <= PUBLISHED_RELEASES_KEPT; i += 1) {
      await recordPublication(ctx, manifest, i % 2 === 0 ? 'promote' : 'rollback');
    }
    const kept = await readPublications(ctx, HASH);
    expect(kept).toHaveLength(PUBLISHED_RELEASES_KEPT);
    expect(kept.at(-1)?.via).toBe('promote');

    await s3.client.putObject('b', publishedReleasesKey(HASH), 'not json');
    expect(await readPublications(ctx, HASH)).toEqual([]);
    expect(lines()).toContainEqual(
      expect.stringContaining('ignoring unreadable publication record'),
    );
  });
});

describe('promote keeps Cache-Control coherent', () => {
  const NO_STORE = [{ match: ['**'], value: 'no-store' }];

  /** site/ deployed under the default rules, then `def456` staged with `rules`. */
  async function stagedWith(rules: typeof NO_STORE) {
    const env = await setup({ 'index.html': 'home', 'about.html': 'about' });
    await deploy(env.ctx, NO_HOOKS);
    Object.assign(env.ctx.config, { cacheControl: rules });
    env.build({ 'index.html': 'home', 'about.html': 'about, edited' }, 'def456');
    await stage(env.ctx);
    return env;
  }

  it('copies every file when the staged rules differ, so unchanged files get the staged header', async () => {
    const { s3, ctx, lines } = await stagedWith(NO_STORE);
    const copies: string[] = [];
    const copyObject = ctx.clients.s3.copyObject.bind(ctx.clients.s3);
    ctx.clients.s3.copyObject = async (bucket, source, destination, options) => {
      copies.push(destination);
      return copyObject(bucket, source, destination, options);
    };

    await promote(ctx, 'def456', NO_HOOKS);

    expect(copies.sort()).toEqual(['site/about.html', 'site/index.html']);
    expect(s3.objects.get('site/index.html')?.cacheControl).toBe('no-store');
    expect(s3.objects.get('site/about.html')?.cacheControl).toBe('no-store');
    expect(JSON.parse(s3.text(cacheControlRecordKey('site'))!)).toEqual({
      status: 'applied',
      rules: NO_STORE,
    });
    expect(
      lines().some((line) => line.startsWith("the staged release's Cache-Control may differ")),
    ).toBe(true);
  });

  it('records the rules the release was staged with, warning when the config has moved on', async () => {
    const { s3, ctx, lines } = await stagedWith(NO_STORE);
    Object.assign(ctx.config, { cacheControl: [{ match: ['**'], value: 'max-age=60' }] });

    await promote(ctx, 'def456', NO_HOOKS);

    expect(s3.objects.get('site/index.html')?.cacheControl).toBe('no-store');
    expect(JSON.parse(s3.text(cacheControlRecordKey('site'))!)).toEqual({
      status: 'applied',
      rules: NO_STORE,
    });
    expect(
      lines().some((line) =>
        line.startsWith(
          'def456 was staged with cacheControl rules that differ from the current config',
        ),
      ),
    ).toBe(true);
  });

  it('leaves the record unconfirmed when a promotion stops partway', async () => {
    const { s3, ctx } = await stagedWith(NO_STORE);
    ctx.clients.s3.copyObject = async () => {
      throw new AwsError({
        service: 's3',
        code: 'InternalError',
        message: 'boom',
        statusCode: 500,
      });
    };

    await expect(promote(ctx, 'def456', NO_HOOKS)).rejects.toThrow(/boom/);
    expect(JSON.parse(s3.text(cacheControlRecordKey('site'))!)).toEqual({ status: 'unconfirmed' });
  });
});

describe('history keeps deploys and staged builds apart', () => {
  async function plain(ctx: Awaited<ReturnType<typeof setup>>['ctx'], lines: () => string[]) {
    const start = lines().length;
    await history(ctx);
    return lines()
      .slice(start)
      .filter((line) => line.startsWith(HASH));
  }

  it('leaves a live deploy succeeded when a stage of the same hash fails', async () => {
    const { ctx, builder, lines } = await setup({ 'index.html': 'v1' });
    await deploy(ctx, NO_HOOKS);
    builder.fails = true;

    await expect(stage(ctx)).rejects.toThrow(/build failed/);

    expect((await readManifest(ctx, HASH))?.status).toBe('succeeded');
    expect((await readManifest(ctx, HASH, 'staged'))?.status).toBe('failed');
    const rows = (await plain(ctx, lines)).map((row) => row.split(/\s+/)[1]).sort();
    expect(rows).toEqual(['failed', 'succeeded']);
  });

  it('marks the deploy live until the stage of the same hash is promoted', async () => {
    const { ctx } = await setup({ 'index.html': 'v1' });
    await deploy(ctx, NO_HOOKS);
    // Pin the deploy well before the stage, so the order does not hang on the clock.
    const deployed = (await readManifest(ctx, HASH))!;
    await writeManifest(ctx, { ...deployed, finishedAt: '2026-01-01T00:00:00.000Z' });
    await stage(ctx);
    const entries = async () =>
      [(await readManifest(ctx, HASH, 'staged'))!, (await readManifest(ctx, HASH))!].sort((a, b) =>
        historyTime(a) > historyTime(b) ? -1 : 1,
      );
    const liveRow = async () =>
      renderHistoryTable(await entries(), Date.now())
        .map(stripColors)
        .findIndex((line) => line.includes('← live'));

    // Newest first: the staged row, then the deploy - which is what is live.
    expect(await liveRow()).toBe(2);
    await promote(ctx, HASH, NO_HOOKS);
    expect(await liveRow()).toBe(1);
  });
});

describe('the live-release record while site/ changes', () => {
  it('names neither release when a promotion stops partway, and the next one says so', async () => {
    const { s3, ctx, lines, build } = await setup({ 'index.html': 'one' });
    await deploy(ctx, NO_HOOKS);
    const first = await readArtifactManifest(ctx, HASH);
    build({ 'index.html': 'two' }, 'def456');
    await stage(ctx);
    const copyObject = ctx.clients.s3.copyObject.bind(ctx.clients.s3);
    ctx.clients.s3.copyObject = async () => {
      throw new AwsError({
        service: 's3',
        code: 'InternalError',
        message: 'boom',
        statusCode: 500,
      });
    };

    await expect(promote(ctx, 'def456', NO_HOOKS)).rejects.toThrow(/boom/);
    const record = await readLiveRelease(ctx);
    expect(record).toMatchObject({
      status: 'publishing',
      hash: 'def456',
      via: 'promote',
      previous: { hash: HASH, releaseHash: first!.releaseHash },
    });

    ctx.clients.s3.copyObject = copyObject;
    await promote(ctx, 'def456', NO_HOOKS);
    expect(
      lines().some(
        (line) =>
          line.startsWith('  previous: unknown (a promote of def456 started ') &&
          line.endsWith(
            `did not finish; the last completed release was ${first!.release} (sha256 ${first!.releaseHash}))`,
          ),
      ),
    ).toBe(true);
    expect(await readLiveRelease(ctx)).toMatchObject({ hash: 'def456', via: 'promote' });
    expect(s3.text('site/index.html')).toBe('two');
  });

  it('is marked publishing before a deploy builds, and stays so when the build fails', async () => {
    const { ctx, builder, build } = await setup({ 'index.html': 'one' });
    await deploy(ctx, NO_HOOKS);
    build({ 'index.html': 'two' }, 'def456');
    builder.fails = true;

    await expect(deploy(ctx, NO_HOOKS)).rejects.toThrow(/build failed/);

    expect(await readLiveRelease(ctx)).toMatchObject({
      status: 'publishing',
      hash: 'def456',
      via: 'deploy',
      previous: { hash: HASH },
    });
  });
});

describe('promote and object tags', () => {
  async function stagedTwoFiles() {
    const env = await setup({ 'a.html': 'a', 'b.html': 'b' });
    await stage(env.ctx);
    return env;
  }

  it('says how to copy the tags afterwards when it promotes untagged', async () => {
    const { ctx, lines } = await stagedTwoFiles();
    const copyObject = ctx.clients.s3.copyObject.bind(ctx.clients.s3);
    ctx.clients.s3.copyObject = async (bucket, source, destination, options = {}) => {
      if ((options.tags ?? 'copy') === 'copy') {
        throw new AwsError({ service: 's3', code: 'AccessDenied', message: 'no', statusCode: 403 });
      }
      return copyObject(bucket, source, destination, options);
    };
    await promote(ctx, HASH, NO_HOOKS);
    expect(lines()).toContainEqual(
      expect.stringContaining(`then \`blogwright promote ${HASH} production --refresh\``),
    );
  });

  it('fails without blaming tags when the untagged copy is denied too', async () => {
    const { s3, ctx, lines } = await stagedTwoFiles();
    ctx.clients.s3.copyObject = async () => {
      throw new AwsError({ service: 's3', code: 'AccessDenied', message: 'no', statusCode: 403 });
    };
    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(/AccessDenied/);
    expect(lines().some((line) => line.includes('cannot copy object tags'))).toBe(false);
    expect(snapshot(s3, 'site/')).toEqual({});
  });

  it('does not retry a 403 that is not an access denial', async () => {
    const { ctx } = await stagedTwoFiles();
    let calls = 0;
    ctx.clients.s3.copyObject = async () => {
      calls += 1;
      throw new AwsError({
        service: 's3',
        code: 'SignatureDoesNotMatch',
        message: 'bad signature',
        statusCode: 403,
      });
    };
    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(/SignatureDoesNotMatch/);
    // The first failure stops further copies; none was retried without tags.
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe('promote applies the response headers', () => {
  it('converges the response headers policy before copying, and stops when CloudFront rejects it', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    ctx.config.headers = {
      security: { contentTypeOptions: true, contentSecurityPolicy: "default-src 'self'" },
      custom: [],
    };
    ctx.state.resources['response-headers-policy'] = { id: 'RHP-1', attachedTo: 'D1' };
    let updates = 0;
    Object.assign(ctx.clients.cloudfront, {
      getResponseHeadersPolicy: async (id: string) => ({ id, config: '<x/>', etag: 'E1' }),
      responseHeadersPolicyMatches: () => false,
      updateResponseHeadersPolicy: async () => {
        updates += 1;
        throw new AwsError({
          service: 'cloudfront',
          code: 'TooLongCSPInResponseHeadersPolicy',
          message: 'too long',
          statusCode: 400,
        });
      },
    });

    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(/contentSecurityPolicy/);
    expect(updates).toBe(1);
    expect(snapshot(s3, 'site/')).toEqual({});
    expect(await readLiveRelease(ctx)).toBeUndefined();
  });
});

describe('stage --refresh', () => {
  it('asks the builder to re-upload every file into the staged prefix', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    const jobs: Record<string, unknown>[] = [];
    s3.onPut((key, body) => {
      if (key.startsWith('build/pending/')) jobs.push(JSON.parse(new TextDecoder().decode(body)));
    });
    await stage(ctx); // the first build to the target writes every file anyway
    await stage(ctx);
    await stage(ctx, { refresh: true });
    expect(jobs.map((job) => job.refresh)).toEqual([true, undefined, true]);
  });
});

describe('promote stops before copying when it cannot mark the Cache-Control record', () => {
  it("names the record and says nothing was published, not 'the build'", async () => {
    const { s3, ctx, build } = await setup({ 'index.html': 'home' });
    await deploy(ctx, NO_HOOKS);
    Object.assign(ctx.config, { cacheControl: [{ match: ['**'], value: 'no-store' }] });
    build({ 'index.html': 'home, edited' }, 'def456');
    await stage(ctx);
    const putObject = ctx.clients.s3.putObject.bind(ctx.clients.s3);
    ctx.clients.s3.putObject = async (bucket, key, ...rest) => {
      if (key === cacheControlRecordKey('site')) throw new Error('AccessDenied');
      return putObject(bucket, key, ...rest);
    };

    await expect(promote(ctx, 'def456', NO_HOOKS)).rejects.toThrow(
      'could not mark build/cache-control/site.json unconfirmed before rewriting its files ' +
        '(AccessDenied); nothing was published',
    );
    expect(s3.text('site/index.html')).toBe('home');
    // Nothing changed, so the live release is still the deploy's.
    expect(await readLiveRelease(ctx)).toMatchObject({ hash: HASH, via: 'deploy' });
  });
});
