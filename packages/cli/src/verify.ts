/**
 * `blogwright verify`: compare the objects stored under a prefix - the live
 * `site/`, or a release staged under `releases/<hash>/` - with the artifact
 * manifest recorded for a hash, byte for byte - every object the manifest
 * lists with its recorded size is read and hashed, so a pass means the bytes
 * are exactly the recorded ones.
 */

import { createHash } from 'node:crypto';

import {
  AwsError,
  colors,
  compareArtifact,
  isExactMatch,
  mapConcurrently,
  stagedReleasePrefix,
  type ArtifactComparison,
  type ArtifactManifest,
  type ObservedFile,
  type S3Object,
} from 'blogwright-core';

import { requireArtifactManifest } from './artifacts.js';
import type { OpsContext } from './context.js';

/**
 * How many objects verification reads at once. A tuning value for the
 * client's own requests, not a limit on anything provisioned.
 */
const VERIFY_CONCURRENCY = 8;

/**
 * The most bytes one read holds in memory. Larger objects are hashed in
 * ranged reads of this size, so verification's memory stays near
 * `VERIFY_CONCURRENCY` x this, however large the site's objects are.
 */
export const VERIFY_READ_CHUNK_BYTES = 8 * 1024 * 1024;

/** The prefix CloudFront serves the live site from. */
export const LIVE_SITE_PREFIX = 'site/';

/** The environment name `blogwright preview` commands run in (`cli.ts`'s `runPreview`). */
const PREVIEW_ENV = 'preview';

/**
 * An S3 console "folder": an empty object whose key ends in `/`. CloudFront
 * never requests one - the router serves a URL ending in `/` its
 * `index.html` - so it is not part of what the site serves.
 */
function isFolderMarker(object: S3Object): boolean {
  return object.size === 0 && object.key.endsWith('/');
}

/**
 * Read one object in ranged reads and hash it. Every read is conditional on
 * the ETag the listing reported, so the bytes hashed are one version's.
 * Undefined when the object was deleted after it was listed, which the
 * comparison then reports as missing.
 */
async function hashStoredObject(
  ctx: OpsContext,
  object: S3Object,
  release: string,
): Promise<ObservedFile | undefined> {
  const location = `s3://${ctx.names.bucket}/${object.key}`;
  const hash = createHash('sha256');
  let read = 0;
  try {
    // An empty object takes one unranged read: a range on it is unsatisfiable.
    do {
      const end = Math.min(read + VERIFY_READ_CHUNK_BYTES, object.size) - 1;
      const bytes = await ctx.clients.s3.getObject(ctx.names.bucket, object.key, {
        ...(object.size > 0 ? { range: { start: read, end } } : {}),
        ...(object.etag !== undefined ? { ifMatch: object.etag } : {}),
      });
      hash.update(bytes);
      read += bytes.byteLength;
      if (bytes.byteLength === 0) break;
    } while (read < object.size);
  } catch (err) {
    if (err instanceof AwsError && err.code === 'NoSuchKey') return undefined;
    if (err instanceof AwsError && err.statusCode === 412) {
      throw new Error(
        `${location} changed while verifying release ${release} - run verify again once ` +
          'nothing is deploying to this environment',
        { cause: err },
      );
    }
    throw new Error(
      `could not read ${location} while verifying release ${release}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  return { bytes: read, sha256: hash.digest('hex') };
}

/**
 * What is stored under `prefix`, keyed by site-root-relative path. Objects the
 * manifest lists with the recorded size are read and hashed; any other object
 * is described by its size alone, which already decides the comparison. Empty
 * folder markers are logged and left out, and an object deleted since the
 * listing is left out too, so the comparison reports it as missing.
 */
export async function observeObjects(
  ctx: OpsContext,
  prefix: string,
  manifest: ArtifactManifest,
): Promise<Map<string, ObservedFile>> {
  const recordedSizes = new Map(manifest.files.map((file) => [file.path, file.bytes]));
  const listed = await ctx.clients.s3.listObjects(ctx.names.bucket, prefix);
  const markers = listed.filter(isFolderMarker);
  for (const marker of markers) {
    ctx.logger.info(`  ignored     ${marker.key}: an empty folder marker, never served`);
  }
  const stored = listed.filter((object) => !isFolderMarker(object));
  const { terminal } = ctx.ports;
  let done = 0;
  try {
    const observed = await mapConcurrently(stored, VERIFY_CONCURRENCY, async (object) => {
      const path = object.key.slice(prefix.length);
      const file =
        recordedSizes.get(path) === object.size
          ? await hashStoredObject(ctx, object, manifest.release)
          : { bytes: object.size };
      done += 1;
      terminal.status(`verifying ${done}/${stored.length} objects under ${prefix}`);
      return [path, file] as const;
    });
    return new Map(
      observed.filter((entry): entry is readonly [string, ObservedFile] => entry[1] !== undefined),
    );
  } finally {
    terminal.status('');
  }
}

/** Compare the objects under `prefix` with a manifest. */
async function compareStoredRelease(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  prefix: string,
): Promise<ArtifactComparison> {
  return compareArtifact(manifest, await observeObjects(ctx, prefix, manifest));
}

function describeObserved(file: ObservedFile): string {
  return `${file.bytes} bytes sha256 ${file.sha256 ?? '(not read: size differs)'}`;
}

/** One stable line per difference, for the terminal and for CI logs. */
function comparisonLines(comparison: ArtifactComparison): string[] {
  return [
    ...comparison.missing.map((path) => `  missing     ${path}`),
    ...comparison.changed.map(
      (change) =>
        `  changed     ${change.path}: expected ${describeObserved(change.expected)}, ` +
        `found ${describeObserved(change.actual)}`,
    ),
    ...comparison.unexpected.map((path) => `  unexpected  ${path}`),
  ];
}

/** The failure summary for a comparison that did not match. */
function mismatchSummary(comparison: ArtifactComparison): string {
  return (
    `${comparison.missing.length} missing, ${comparison.changed.length} changed, ` +
    `${comparison.unexpected.length} unexpected`
  );
}

/**
 * Check that `prefix` holds exactly the release recorded for `hash`: logs
 * every difference and throws when there is any, so CI fails the step.
 */
export async function verifyRelease(
  ctx: OpsContext,
  hash: string,
  prefix: string,
): Promise<ArtifactManifest> {
  const manifest = await requireArtifactManifest(ctx, hash);
  const location = `s3://${ctx.names.bucket}/${prefix}`;
  ctx.logger.step(
    `verifying ${manifest.release} against ${location} (${manifest.fileCount} files)`,
  );
  const comparison = await compareStoredRelease(ctx, manifest, prefix);
  for (const line of comparisonLines(comparison)) ctx.logger.info(line);
  if (!isExactMatch(comparison)) {
    throw new Error(
      `${location} does not match release ${manifest.release}: ${mismatchSummary(comparison)}`,
    );
  }
  ctx.logger.ok(
    `${location} matches release ${manifest.release}: ${manifest.fileCount} files, ` +
      `sha256 ${manifest.releaseHash}`,
  );
  return manifest;
}

/** Which copy of a release `verify` checks: what is served, or what `stage` stored. */
export type VerifyTarget = 'live' | 'staged';

/** `blogwright verify <hash>`: the live site (or the staged copy) against a hash's recorded release. */
export async function verify(
  ctx: OpsContext,
  hash: string,
  target: VerifyTarget = 'live',
): Promise<void> {
  if (ctx.preview || ctx.env === PREVIEW_ENV) {
    throw new Error(
      "verify checks an environment's live site/ against its artifact manifest, and PR previews " +
        'record none - deploy the revision to an environment and verify it there',
    );
  }
  if (ctx.config.ssr) {
    throw new Error(
      `verify compares a static site with its artifact manifest, and "${ctx.env}" is an SSR ` +
        'environment: an SSR deploy pins the exact artifact object version its revision serves ' +
        'instead (see `blogwright history`)',
    );
  }
  ctx.logger.info(colors.bold(`Verifying "${ctx.env}" against ${hash}`));
  await verifyRelease(ctx, hash, target === 'live' ? LIVE_SITE_PREFIX : stagedReleasePrefix(hash));
}
