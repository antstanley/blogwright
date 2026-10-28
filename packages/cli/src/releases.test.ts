import { AwsError, artifactManifestKey, sha256Hex, stripColors } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { readArtifactManifest } from './artifacts.js';
import { cacheControlRecordKey } from './cache-control.js';
import { deleteSite, deploy, history, rollback } from './commands.js';
import { readManifest } from './deploy.js';
import { LIVE_RELEASE_KEY, readLiveRelease } from './live-release.js';
import { RELEASE_STAGING_OUTPUT } from './nodes.js';
import { promote, stage } from './releases.js';
import { attachFakeBuilder, createBuildContext, createMemoryS3 } from './test-support.js';
import { verify } from './verify.js';

const HASH = 'abc123';
const NO_HOOKS = { afterDeploy: async () => undefined };

/** A production context whose builder publishes `site()` and whose exec role grants staging. */
async function setup(initial: Record<string, string>, hash = HASH) {
  const s3 = createMemoryS3();
  let files = initial;
  attachFakeBuilder(s3, () => files);
  const logged: string[] = [];
  const invalidations: string[][] = [];
  const ctx = await createBuildContext({ s3, hash, logged, invalidations });
  ctx.state.resources['iam-exec-role']![RELEASE_STAGING_OUTPUT] = true;
  return {
    s3,
    ctx,
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
    expect(pending[0]!.job).toMatchObject({
      sitePrefix: `releases/${HASH}/`,
      artifactManifestKey: artifactManifestKey(HASH),
    });
    expect(snapshot(s3, `releases/${HASH}/`)).toEqual({ 'index.html': sha256Hex('v1') });
    expect(s3.text('site/index.html')).toBe('live');
    expect(s3.objects.has(`build/changed/${HASH}.json`)).toBe(false);
    expect(invalidations).toEqual([]);
    expect((await readManifest(ctx, HASH))?.kind).toBe('staged');
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

  it('refuses a hash that was never staged', async () => {
    const { ctx } = await setup({ 'index.html': 'v1' });
    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      new RegExp(`${HASH} is not staged: s3://.*/releases/${HASH}/ is empty`),
    );
  });

  it('refuses a staged release whose bytes no longer match, copying nothing', async () => {
    const { s3, ctx } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    await s3.client.putObject('b', `releases/${HASH}/index.html`, 'v2');

    await expect(promote(ctx, HASH, NO_HOOKS)).rejects.toThrow(
      /releases\/abc123\/ does not match release .*0 missing, 1 changed, 0 unexpected/,
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
    const promotedAt = (await readManifest(ctx, HASH))?.promotedAt;
    expect((await plainRows())[0]).toMatch(new RegExp(`^abc123\\s+promoted\\s+${promotedAt}`));
  });
});

describe('rollback to a staged release', () => {
  /** Stage and promote two releases, leaving the second live. */
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

    await rollback(ctx, HASH);

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
  });

  it('restores the Cache-Control the release was staged with, and its record', async () => {
    const noStore = [{ match: ['**'], value: 'no-store' }];
    const { s3, ctx, build } = await setup({ 'index.html': 'first' });
    Object.assign(ctx.config, { cacheControl: noStore });
    await stage(ctx);
    await promote(ctx, HASH, NO_HOOKS);
    Object.assign(ctx.config, { cacheControl: [{ match: ['**'], value: 'max-age=60' }] });
    build({ 'index.html': 'second' }, 'def456');
    await stage(ctx);
    await promote(ctx, 'def456', NO_HOOKS);
    expect(s3.objects.get('site/index.html')?.cacheControl).toBe('max-age=60');

    await rollback(ctx, HASH);

    expect(s3.objects.get('site/index.html')?.cacheControl).toBe('no-store');
    expect(JSON.parse(s3.text(cacheControlRecordKey('site'))!)).toEqual({
      status: 'applied',
      rules: noStore,
    });
  });

  it('refuses to republish staged bytes that no longer match, leaving site/ as it was', async () => {
    const { s3, ctx } = await twoReleases();
    const live = snapshot(s3, 'site/');
    await s3.client.putObject('b', `releases/${HASH}/index.html`, 'tampered');

    await expect(rollback(ctx, HASH)).rejects.toThrow(/releases\/abc123\/ does not match release/);
    expect(snapshot(s3, 'site/')).toEqual(live);
  });

  it('rebuilds from the source zip when the hash was never staged', async () => {
    const { ctx, lines } = await setup({ 'index.html': 'v1' });
    await deploy(ctx, NO_HOOKS);
    const builds = launches(lines());

    await rollback(ctx, HASH);

    expect(launches(lines())).toBe(builds + 1);
    expect(lines()).toContain(
      `${HASH} has no staged release to republish - rebuilding from build/${HASH}.zip`,
    );
  });

  it('rebuilds, with a warning, when the staged release has an unreadable manifest', async () => {
    const { s3, ctx, lines } = await setup({ 'index.html': 'v1' });
    await stage(ctx);
    await s3.client.putObject('b', artifactManifestKey(HASH), 'not json');
    const builds = launches(lines());

    await rollback(ctx, HASH);

    expect(launches(lines())).toBe(builds + 1);
    expect(lines().some((line) => line.startsWith('ignoring the recorded artifact manifest'))).toBe(
      true,
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
