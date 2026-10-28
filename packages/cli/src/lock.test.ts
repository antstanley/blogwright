import { stripColors } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { deleteSite, deploy, destroy, rollback } from './commands.js';
import { acquireEnvLock, ENV_LOCK_KEY, releaseEnvLock, withEnvLock, type EnvLock } from './lock.js';
import { RELEASE_STAGING_OUTPUT } from './nodes.js';
import { promote, stage } from './releases.js';
import { attachFakeBuilder, createBuildContext, createMemoryS3 } from './test-support.js';

const HASH = 'abc123';
const NO_HOOKS = { afterDeploy: async () => undefined };

async function setup() {
  const s3 = createMemoryS3();
  attachFakeBuilder(s3, () => ({ 'index.html': 'v1' }));
  const logged: string[] = [];
  const ctx = await createBuildContext({ s3, hash: HASH, logged });
  ctx.state.resources['iam-exec-role']![RELEASE_STAGING_OUTPUT] = true;
  return { s3, ctx, lines: () => logged.map(stripColors) };
}

/** A lock some other run holds, as it would sit in the bucket. */
const HELD: EnvLock = {
  id: 'other-run',
  holder: 'arn:aws:sts::123456789012:assumed-role/deploy/GitHubActions',
  command: 'deploy',
  hash: 'fff999',
  startedAt: '2026-10-28T09:00:00.000Z',
};

describe('the environment lock', () => {
  it('is taken for the command and released when it finishes', async () => {
    const { s3, ctx } = await setup();
    let heldDuring: unknown;
    await withEnvLock(ctx, 'deploy', HASH, {}, async () => {
      heldDuring = JSON.parse(s3.text(ENV_LOCK_KEY)!);
    });
    expect(heldDuring).toMatchObject({
      holder: ctx.identity.arn,
      command: 'deploy',
      hash: HASH,
    });
    expect(s3.objects.has(ENV_LOCK_KEY)).toBe(false);
  });

  it('is released when the command fails', async () => {
    const { s3, ctx } = await setup();
    await expect(
      withEnvLock(ctx, 'promote', HASH, {}, async () => {
        throw new Error('copy failed');
      }),
    ).rejects.toThrow('copy failed');
    expect(s3.objects.has(ENV_LOCK_KEY)).toBe(false);
  });

  it.each([
    ['deploy', (ctx: Parameters<typeof deploy>[0]) => deploy(ctx, NO_HOOKS)],
    ['stage', (ctx: Parameters<typeof deploy>[0]) => stage(ctx)],
    ['promote', (ctx: Parameters<typeof deploy>[0]) => promote(ctx, HASH, NO_HOOKS)],
    ['rollback', (ctx: Parameters<typeof deploy>[0]) => rollback(ctx, HASH, NO_HOOKS)],
    ['delete', (ctx: Parameters<typeof deploy>[0]) => deleteSite(ctx)],
  ])(
    '%s refuses while another command holds it, naming the holder, and changes nothing',
    async (command, run) => {
      const { s3, ctx } = await setup();
      await s3.client.putObject('b', `build/${HASH}.zip`, 'zip');
      await s3.client.putObject('b', 'site/index.html', 'live');
      await s3.client.putObject('b', ENV_LOCK_KEY, JSON.stringify(HELD));
      const before = new Map(Array.from(s3.objects, ([key, object]) => [key, object.body]));

      const error = await run(ctx).then(
        () => new Error(`${command} ran while the environment was locked`),
        (err: unknown) => err as Error,
      );

      expect(error.message).toContain(`"production" is locked by deploy fff999 by ${HELD.holder}`);
      expect(error.message).toContain(`started ${HELD.startedAt}`);
      expect(error.message).toContain(`so ${command} would interleave its writes`);
      expect(error.message).toContain('re-run with `--force-unlock`');
      expect(new Map(Array.from(s3.objects, ([key, object]) => [key, object.body]))).toEqual(
        before,
      );
    },
  );

  it('lets exactly one of two concurrent commands take it', async () => {
    const { ctx } = await setup();
    const results = await Promise.allSettled([
      acquireEnvLock(ctx, 'deploy', HASH),
      acquireEnvLock(ctx, 'promote', HASH),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('is replaced by --force-unlock, with a warning naming what it replaced', async () => {
    const { s3, ctx, lines } = await setup();
    await s3.client.putObject('b', ENV_LOCK_KEY, JSON.stringify(HELD));

    await deploy(ctx, { ...NO_HOOKS, forceUnlock: true });

    expect(
      lines().some((line) =>
        line.startsWith(
          `--force-unlock: replacing the lock held by deploy fff999 by ${HELD.holder}`,
        ),
      ),
    ).toBe(true);
    expect(s3.objects.has(ENV_LOCK_KEY)).toBe(false);
    expect(s3.text('site/index.html')).toBe('v1');
  });

  it('treats an unreadable lock as held, and --force-unlock replaces it too', async () => {
    const { s3, ctx } = await setup();
    await s3.client.putObject('b', ENV_LOCK_KEY, 'not json');
    await expect(deploy(ctx, NO_HOOKS)).rejects.toThrow(/locked by an unreadable lock/);
    await deploy(ctx, { ...NO_HOOKS, forceUnlock: true });
    expect(s3.objects.has(ENV_LOCK_KEY)).toBe(false);
  });

  it('is not deleted by a run whose lock was force-replaced', async () => {
    const { s3, ctx, lines } = await setup();
    const mine = await acquireEnvLock(ctx, 'deploy', HASH);
    await s3.client.putObject('b', ENV_LOCK_KEY, JSON.stringify(HELD));

    await releaseEnvLock(ctx, mine);

    expect(JSON.parse(s3.text(ENV_LOCK_KEY)!)).toEqual(HELD);
    expect(lines().some((line) => line.startsWith('the environment lock was replaced'))).toBe(true);
  });

  it('makes destroy refuse while held', async () => {
    const { s3, ctx } = await setup();
    await s3.client.putObject('b', ENV_LOCK_KEY, JSON.stringify(HELD));
    await expect(destroy(ctx, { yes: true })).rejects.toThrow(
      /"production" is locked by deploy fff999.*so destroy would interleave/,
    );
  });
});
