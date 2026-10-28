/**
 * The live-release record (`build/live-release.json`): which recorded release
 * the last deploy, promote or rollback published to `site/`, so the next
 * promotion can name the release it replaces. It records what blogwright did,
 * not what S3 holds - `blogwright verify` is the reading of S3.
 *
 * Before a command starts changing `site/` it marks the record `publishing`,
 * keeping the release it replaces as `previous`, and only a command that
 * finished turns it back into a live release. A command that stops partway
 * therefore leaves "a publish of X stopped partway", never the old release's
 * name over a `site/` that no longer holds it.
 */

import type { ArtifactManifest } from 'blogwright-core';

import type { OpsContext } from './context.js';

export const LIVE_RELEASE_KEY = 'build/live-release.json';

/** The command that published a live release, or emptied `site/`. */
export type LiveReleaseSource = 'deploy' | 'promote' | 'rollback' | 'delete';

/** A release a command finished publishing to `site/`. */
interface LiveRelease {
  hash: string;
  release: string;
  releaseHash: string;
  publishedAt: string;
  via: LiveReleaseSource;
}

/**
 * A command is changing `site/`, or stopped partway through changing it: what
 * `site/` holds is unknown until a command finishes.
 */
interface PublishingLiveRelease {
  status: 'publishing';
  /** The revision being published; absent when `site/` is being emptied. */
  hash?: string | undefined;
  via: LiveReleaseSource;
  startedAt: string;
  /** The last release a command finished publishing before this one began. */
  previous?: LiveRelease | undefined;
}

export type LiveReleaseRecord = LiveRelease | PublishingLiveRelease;

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLiveRelease(value: unknown): value is LiveRelease {
  if (!isRecordObject(value) || value.status !== undefined) return false;
  return ['hash', 'release', 'releaseHash', 'publishedAt', 'via'].every(
    (field) => typeof value[field] === 'string',
  );
}

function isPublishing(value: unknown): value is PublishingLiveRelease {
  if (!isRecordObject(value) || value.status !== 'publishing') return false;
  return (
    typeof value.via === 'string' &&
    typeof value.startedAt === 'string' &&
    (value.hash === undefined || typeof value.hash === 'string') &&
    (value.previous === undefined || isLiveRelease(value.previous))
  );
}

/** Whether a record names a release a command finished publishing. */
export function isSettledLiveRelease(record: LiveReleaseRecord | undefined): record is LiveRelease {
  return record !== undefined && !('status' in record);
}

/**
 * The live-release record, or undefined when none is recorded. The record is
 * informational, so an unreadable one is reported and treated as absent
 * rather than failing the command that wanted to name it.
 */
export async function readLiveRelease(ctx: OpsContext): Promise<LiveReleaseRecord | undefined> {
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, LIVE_RELEASE_KEY);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (isLiveRelease(parsed) || isPublishing(parsed)) return parsed;
  ctx.logger.warn(
    `ignoring unreadable live-release record s3://${ctx.names.bucket}/${LIVE_RELEASE_KEY}`,
  );
  return undefined;
}

async function writeLiveRelease(ctx: OpsContext, record: LiveReleaseRecord): Promise<void> {
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    LIVE_RELEASE_KEY,
    JSON.stringify(record, null, 2),
    'application/json',
  );
}

/**
 * Mark `site/` as changing before a command touches it. The release it
 * replaces is kept as `previous` - carried over from an earlier publish that
 * stopped partway, so it always names the last release a command finished.
 */
export async function markLiveReleasePublishing(
  ctx: OpsContext,
  hash: string | undefined,
  via: LiveReleaseSource,
): Promise<void> {
  const current = await readLiveRelease(ctx);
  const previous = isSettledLiveRelease(current) ? current : current?.previous;
  await writeLiveRelease(ctx, {
    status: 'publishing',
    ...(hash ? { hash } : {}),
    via,
    startedAt: new Date().toISOString(),
    ...(previous ? { previous } : {}),
  });
}

/** Record that `manifest`'s release is now what `site/` holds. */
export async function recordLiveRelease(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  via: LiveReleaseSource,
): Promise<void> {
  await writeLiveRelease(ctx, {
    hash: manifest.hash,
    release: manifest.release,
    releaseHash: manifest.releaseHash,
    publishedAt: new Date().toISOString(),
    via,
  });
}

/** Drop the record when `site/` changed in a way no artifact manifest describes. */
export async function forgetLiveRelease(ctx: OpsContext): Promise<void> {
  await ctx.clients.s3.deleteObject(ctx.names.bucket, LIVE_RELEASE_KEY);
}

/** One line naming the live release, for a before/after report. */
export function describeLiveRelease(live: LiveReleaseRecord | undefined): string {
  if (live === undefined) {
    return (
      'unknown - no live-release record: site/ was last published before blogwright ' +
      'recorded releases, by a build that recorded no artifact manifest, or not at all'
    );
  }
  if (isSettledLiveRelease(live)) return `${live.release} (sha256 ${live.releaseHash})`;
  const what = live.hash ? `a ${live.via} of ${live.hash}` : `a ${live.via}`;
  const before = live.previous
    ? `; the last completed release was ${live.previous.release} (sha256 ${live.previous.releaseHash})`
    : '';
  return `unknown (${what} started ${live.startedAt} did not finish${before})`;
}

/**
 * Every staged release a `promote` or a republishing `rollback` published for
 * a revision (`build/published/<hash>.json`), oldest first. `stage` never
 * writes it, so it outlives a re-stage of the same revision: the record of
 * what was actually live is kept even after the staged bytes are replaced.
 */
const PUBLISHED_RELEASES_PREFIX = 'build/published/';

/** How many publications a revision's record keeps - the newest ones. */
export const PUBLISHED_RELEASES_KEPT = 50;

/** One publication of a staged release into `site/`. */
export interface ReleasePublication {
  release: string;
  releaseHash: string;
  via: Extract<LiveReleaseSource, 'promote' | 'rollback'>;
  publishedAt: string;
}

interface PublishedReleases {
  hash: string;
  publications: ReleasePublication[];
}

export function publishedReleasesKey(hash: string): string {
  return `${PUBLISHED_RELEASES_PREFIX}${hash}.json`;
}

function isPublication(value: unknown): value is ReleasePublication {
  return (
    isRecordObject(value) &&
    ['release', 'releaseHash', 'via', 'publishedAt'].every(
      (field) => typeof value[field] === 'string',
    )
  );
}

function isPublishedReleases(value: unknown): value is PublishedReleases {
  return (
    isRecordObject(value) &&
    typeof value.hash === 'string' &&
    Array.isArray(value.publications) &&
    value.publications.every(isPublication)
  );
}

/**
 * A revision's publications, oldest first; empty when none is recorded. Like
 * the live-release record it is informational, so an unreadable one is
 * reported and read as empty.
 */
export async function readPublications(
  ctx: OpsContext,
  hash: string,
): Promise<ReleasePublication[]> {
  const key = publishedReleasesKey(hash);
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, key);
  if (text === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (isPublishedReleases(parsed) && parsed.hash === hash) return parsed.publications;
  ctx.logger.warn(`ignoring unreadable publication record s3://${ctx.names.bucket}/${key}`);
  return [];
}

/** Append a publication of `manifest`'s release to its revision's record. */
export async function recordPublication(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  via: ReleasePublication['via'],
): Promise<void> {
  const publications = [
    ...(await readPublications(ctx, manifest.hash)),
    {
      release: manifest.release,
      releaseHash: manifest.releaseHash,
      via,
      publishedAt: new Date().toISOString(),
    },
  ].slice(-PUBLISHED_RELEASES_KEPT);
  const record: PublishedReleases = { hash: manifest.hash, publications };
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    publishedReleasesKey(manifest.hash),
    JSON.stringify(record, null, 2),
    'application/json',
  );
}
