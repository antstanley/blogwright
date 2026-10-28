/**
 * The live-release record (`build/live-release.json`): which recorded release
 * the last deploy, promote or rollback published to `site/`, so the next
 * promotion can name the release it replaces. It records what blogwright did,
 * not what S3 holds - `blogwright verify` is the reading of S3.
 */

import type { ArtifactManifest } from 'blogwright-core';

import type { OpsContext } from './context.js';

export const LIVE_RELEASE_KEY = 'build/live-release.json';

/** The command that published a live release. */
export type LiveReleaseSource = 'deploy' | 'promote' | 'rollback';

export interface LiveRelease {
  hash: string;
  release: string;
  releaseHash: string;
  publishedAt: string;
  via: LiveReleaseSource;
}

function isLiveRelease(value: unknown): value is LiveRelease {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['hash', 'release', 'releaseHash', 'publishedAt', 'via'].every(
    (field) => typeof record[field] === 'string',
  );
}

/**
 * The release last published to `site/`, or undefined when none is recorded.
 * The record is informational, so an unreadable one is reported and treated
 * as absent rather than failing the command that wanted to name it.
 */
export async function readLiveRelease(ctx: OpsContext): Promise<LiveRelease | undefined> {
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, LIVE_RELEASE_KEY);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (isLiveRelease(parsed)) return parsed;
  ctx.logger.warn(
    `ignoring unreadable live-release record s3://${ctx.names.bucket}/${LIVE_RELEASE_KEY}`,
  );
  return undefined;
}

/** Record that `manifest`'s release is now what `site/` holds. */
export async function recordLiveRelease(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  via: LiveReleaseSource,
): Promise<void> {
  const record: LiveRelease = {
    hash: manifest.hash,
    release: manifest.release,
    releaseHash: manifest.releaseHash,
    publishedAt: new Date().toISOString(),
    via,
  };
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    LIVE_RELEASE_KEY,
    JSON.stringify(record, null, 2),
    'application/json',
  );
}

/** Drop the record when `site/` changed in a way no artifact manifest describes. */
export async function forgetLiveRelease(ctx: OpsContext): Promise<void> {
  await ctx.clients.s3.deleteObject(ctx.names.bucket, LIVE_RELEASE_KEY);
}

/** One line naming the live release, for a before/after report. */
export function describeLiveRelease(live: LiveRelease | undefined): string {
  return live ? `${live.release} (sha256 ${live.releaseHash})` : 'unknown (no release recorded)';
}
