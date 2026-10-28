/**
 * The CLI's side of the artifact manifest (`build/artifacts/<hash>.json`): the
 * builder writes it, and the CLI reads it back to report the release a build
 * produced and to check a rebuild against what was recorded before it.
 */

import { artifactManifestKey, parseArtifactManifest, type ArtifactManifest } from 'blogwright-core';

import type { OpsContext } from './context.js';

/**
 * A hash's artifact manifest, or undefined when none was recorded (a build
 * from before artifact manifests, or a builder denied the write). A manifest
 * that exists but does not validate is an error, never read as absent.
 */
export async function readArtifactManifest(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest | undefined> {
  const key = artifactManifestKey(hash);
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, key);
  if (text === undefined) return undefined;
  return parseArtifactManifest(text, `s3://${ctx.names.bucket}/${key}`);
}

/** A hash's artifact manifest, refusing a hash that has none. */
export async function requireArtifactManifest(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest> {
  const manifest = await readArtifactManifest(ctx, hash);
  if (manifest) return manifest;
  throw new Error(
    `no artifact manifest is recorded for ${hash} at s3://${ctx.names.bucket}/` +
      `${artifactManifestKey(hash)} - only static builds made since artifact manifests ` +
      'were introduced have one (see `blogwright history` for hashes)',
  );
}

/** One line naming a release: identity, size and aggregate hash. */
export function describeRelease(manifest: ArtifactManifest): string {
  const kib = (manifest.totalBytes / 1024).toFixed(0);
  return `${manifest.release} (${manifest.fileCount} files, ${kib} KiB, sha256 ${manifest.releaseHash})`;
}

/**
 * Log the release a static build recorded, or warn that it recorded none. A
 * stack bootstrapped before artifact manifests existed denies the builder the
 * write, which only `bootstrap` can fix.
 */
export function logRecordedRelease(
  ctx: OpsContext,
  hash: string,
  manifest: ArtifactManifest | undefined,
): void {
  if (manifest) {
    ctx.logger.ok(`release ${describeRelease(manifest)}`);
    ctx.logger.info(`  artifact manifest s3://${ctx.names.bucket}/${artifactManifestKey(hash)}`);
    return;
  }
  ctx.logger.warn(
    `no artifact manifest was recorded at ${artifactManifestKey(hash)} - run ` +
      `\`blogwright bootstrap ${ctx.env}\` to grant the builder write access to build/artifacts/`,
  );
}

/**
 * The manifest recorded for a hash before a rebuild overwrites it. A rollback
 * is a recovery path, so an unreadable record is reported and treated as
 * absent rather than blocking it.
 */
export async function readRecordedBeforeRebuild(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest | undefined> {
  try {
    return await readArtifactManifest(ctx, hash);
  } catch (err) {
    ctx.logger.warn(`ignoring the recorded artifact manifest: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Report whether a rebuild reproduced the recorded artifact. Two builds of the
 * same source are not guaranteed byte-identical (builder image, dependency
 * resolution, toolchain), so a difference is a warning naming both hashes.
 */
export function logRebuildComparison(
  ctx: OpsContext,
  recorded: ArtifactManifest | undefined,
  rebuilt: ArtifactManifest | undefined,
): void {
  if (!rebuilt) return;
  if (!recorded) {
    ctx.logger.info(`  no artifact manifest was recorded before this rebuild`);
    return;
  }
  ctx.logger.info(`  recorded release sha256 ${recorded.releaseHash} (${recorded.release})`);
  ctx.logger.info(`  rebuilt  release sha256 ${rebuilt.releaseHash} (${rebuilt.release})`);
  if (recorded.releaseHash === rebuilt.releaseHash) {
    ctx.logger.ok('the rebuild is byte-identical to the recorded artifact');
  } else {
    ctx.logger.warn(
      'the rebuild is NOT byte-identical to the recorded artifact - the live site now serves ' +
        'the rebuilt bytes, which no review covered',
    );
  }
}
