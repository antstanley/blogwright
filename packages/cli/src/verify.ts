/**
 * `blogwright verify`: compare the objects stored under a prefix with the
 * artifact manifest recorded for a hash, byte for byte - every listed object
 * is read and hashed, so a pass means the bytes are exactly the recorded ones.
 */

import {
  colors,
  compareArtifact,
  isExactMatch,
  mapConcurrently,
  sha256Hex,
  type ArtifactComparison,
  type ArtifactManifest,
  type ObservedFile,
} from 'blogwright-core';

import { requireArtifactManifest } from './artifacts.js';
import type { OpsContext } from './context.js';

/** How many objects verification reads at once. */
const VERIFY_CONCURRENCY = 8;

/** The prefix CloudFront serves the live site from. */
const LIVE_SITE_PREFIX = 'site/';

/**
 * What is stored under `prefix`, keyed by site-root-relative path. Objects the
 * manifest lists with the recorded size are read and hashed; any other object
 * is described by its size alone, which already decides the comparison.
 */
export async function observeObjects(
  ctx: OpsContext,
  prefix: string,
  manifest: ArtifactManifest,
): Promise<Map<string, ObservedFile>> {
  const recordedSizes = new Map(manifest.files.map((file) => [file.path, file.bytes]));
  const listed = await ctx.clients.s3.listObjects(ctx.names.bucket, prefix);
  const observed = await mapConcurrently(listed, VERIFY_CONCURRENCY, async (object) => {
    const path = object.key.slice(prefix.length);
    if (recordedSizes.get(path) !== object.size) {
      return [path, { bytes: object.size }] as const;
    }
    const body = await ctx.clients.s3.getObject(ctx.names.bucket, object.key);
    return [path, { bytes: body.byteLength, sha256: sha256Hex(body) }] as const;
  });
  return new Map(observed);
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
async function verifyRelease(
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

/** `blogwright verify <hash>`: the live site against a hash's recorded release. */
export async function verify(ctx: OpsContext, hash: string): Promise<void> {
  if (ctx.config.ssr) {
    throw new Error(
      `verify compares a static site with its artifact manifest, and "${ctx.env}" is an SSR ` +
        'environment: an SSR deploy pins the exact artifact object version its revision serves ' +
        'instead (see `blogwright history`)',
    );
  }
  ctx.logger.info(colors.bold(`Verifying "${ctx.env}" against ${hash}`));
  await verifyRelease(ctx, hash, LIVE_SITE_PREFIX);
}
