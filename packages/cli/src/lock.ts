/**
 * The environment lock (`build/lock.json`): one command at a time may write
 * an environment's live `site/` or its live-release record. `deploy`,
 * `rollback`, `stage`, `promote` and `delete` take it before they change
 * anything and release it when they finish, failed or not, so two of them can
 * never interleave their writes - a deploy's builder listing `site/` while a
 * promotion copies into it, or two deploys racing for the same objects.
 *
 * The lock is a conditional PUT (`If-None-Match: *`), so exactly one caller
 * creates it. A command that dies without releasing it - a killed CI job, a
 * closed laptop - leaves it behind; the next command refuses, naming who held
 * it, for what and since when, and `--force-unlock` replaces it once that
 * holder is known to be gone. Nothing expires it on a timer: a long build is
 * indistinguishable from a dead one, and guessing wrong would re-open the race.
 */

import { randomUUID } from 'node:crypto';

import type { OpsContext } from './context.js';

/** Where an environment's lock lives - outside every builder grant. */
export const ENV_LOCK_KEY = 'build/lock.json';

/** Who holds an environment's lock, and for what. */
export interface EnvLock {
  /** Unique per acquisition: release deletes the lock only while it is still this one. */
  id: string;
  /** The AWS identity (`sts:GetCallerIdentity` ARN) that took it. */
  holder: string;
  /** The command that took it, e.g. `promote`. */
  command: string;
  /** The revision the command is publishing, when it has one. */
  hash?: string | undefined;
  /** When it was taken (ISO-8601). */
  startedAt: string;
}

export interface LockOptions {
  /** Replace a lock left behind by a command that is no longer running. */
  forceUnlock?: boolean | undefined;
}

function isEnvLock(value: unknown): value is EnvLock {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['id', 'holder', 'command', 'startedAt'].every(
    (field) => typeof record[field] === 'string',
  );
}

/** The lock currently held, `unreadable` for an object that is not one, or undefined. */
async function readEnvLock(ctx: OpsContext): Promise<EnvLock | 'unreadable' | undefined> {
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, ENV_LOCK_KEY);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isEnvLock(parsed) ? parsed : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/** One line naming a lock's holder, command, revision and age. */
function describeEnvLock(lock: EnvLock, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(lock.startedAt)) / 60_000));
  const what = lock.hash ? `${lock.command} ${lock.hash}` : lock.command;
  return `${what} by ${lock.holder}, started ${lock.startedAt} (${minutes} min ago)`;
}

function lockedError(ctx: OpsContext, command: string, held: EnvLock | 'unreadable'): Error {
  const location = `s3://${ctx.names.bucket}/${ENV_LOCK_KEY}`;
  const holder =
    held === 'unreadable'
      ? `an unreadable lock at ${location}`
      : `${describeEnvLock(held)} (${location})`;
  return new Error(
    `"${ctx.env}" is locked by ${holder}, so ${command} would interleave its writes with that ` +
      'command - nothing was changed. Wait for it to finish; if it is no longer running ' +
      `(a cancelled job, a killed process), re-run with \`--force-unlock\` to replace the lock.`,
  );
}

/**
 * Take the environment's lock for `command`, or throw naming whoever holds
 * it. With `forceUnlock`, a held lock is first removed, with a warning.
 */
export async function acquireEnvLock(
  ctx: OpsContext,
  command: string,
  hash: string | undefined,
  opts: LockOptions = {},
): Promise<EnvLock> {
  if (opts.forceUnlock) {
    const held = await readEnvLock(ctx);
    if (held !== undefined) {
      ctx.logger.warn(
        `--force-unlock: replacing the lock held by ` +
          `${held === 'unreadable' ? 'an unreadable lock' : describeEnvLock(held)}`,
      );
      await ctx.clients.s3.deleteObject(ctx.names.bucket, ENV_LOCK_KEY);
    }
  }
  const lock: EnvLock = {
    id: randomUUID(),
    holder: ctx.identity.arn,
    command,
    ...(hash ? { hash } : {}),
    startedAt: new Date().toISOString(),
  };
  const created = await ctx.clients.s3.putObjectIfAbsent(
    ctx.names.bucket,
    ENV_LOCK_KEY,
    JSON.stringify(lock, null, 2),
    'application/json',
  );
  if (created) return lock;
  // Released between the PUT and this read: report it as held anyway, since
  // retrying silently could starve, and the operator can simply run again.
  throw lockedError(ctx, command, (await readEnvLock(ctx)) ?? 'unreadable');
}

/**
 * Release `lock` if it is still the one held. A lock replaced by
 * `--force-unlock` belongs to someone else now and is left alone. Never
 * throws: the command's own outcome must not be masked by its cleanup.
 */
export async function releaseEnvLock(ctx: OpsContext, lock: EnvLock): Promise<void> {
  try {
    const held = await readEnvLock(ctx);
    if (held === undefined) return;
    if (held === 'unreadable' || held.id !== lock.id) {
      ctx.logger.warn(
        `the environment lock was replaced while ${lock.command} ran (--force-unlock?) - ` +
          'leaving the new one in place',
      );
      return;
    }
    await ctx.clients.s3.deleteObject(ctx.names.bucket, ENV_LOCK_KEY);
  } catch (err) {
    ctx.logger.warn(
      `could not release the environment lock s3://${ctx.names.bucket}/${ENV_LOCK_KEY} ` +
        `(${err instanceof Error ? err.message : String(err)}); the next command will refuse ` +
        'until it is removed with `--force-unlock`',
    );
  }
}

/** Run `fn` holding the environment's lock, releasing it however `fn` ends. */
export async function withEnvLock<T>(
  ctx: OpsContext,
  command: string,
  hash: string | undefined,
  opts: LockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireEnvLock(ctx, command, hash, opts);
  try {
    return await fn();
  } finally {
    await releaseEnvLock(ctx, lock);
  }
}

/** Refuse when the environment is locked - for `destroy`, which removes the lock with the bucket. */
export async function assertEnvUnlocked(
  ctx: OpsContext,
  command: string,
  opts: LockOptions = {},
): Promise<void> {
  if (opts.forceUnlock) return;
  const held = await readEnvLock(ctx);
  if (held !== undefined) throw lockedError(ctx, command, held);
}
