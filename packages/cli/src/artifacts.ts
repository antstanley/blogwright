/**
 * The CLI's side of the artifact manifest. Every static build is asked to
 * record its manifest at a key of its own, `build/artifacts/<hash>/<buildId>.json`,
 * so finding it there proves that build wrote it. A deploy then keeps the
 * first manifest recorded for a revision, write-once, as its original at
 * `build/artifacts/<hash>.json`: no later build of the same revision - a
 * redeploy or a rollback's rebuild - can replace the record a review covered.
 *
 * A staged release is bound to the manifest of the build that staged it,
 * copied by the CLI to `build/releases/<hash>.json`: that, not the original,
 * is what `promote` checks the staged and the promoted bytes against, so a
 * revision first deployed with other bytes can still be staged and promoted.
 */

import { randomUUID } from 'node:crypto';

import {
  artifactBuildManifestKey,
  artifactManifestKey,
  parseArtifactManifest,
  serializeArtifactManifest,
  stagedReleaseManifestKey,
  type ArtifactManifest,
} from 'blogwright-core';

import type { OpsContext } from './context.js';

/**
 * A new build's manifest key. The id sorts by start time and is unique by its
 * random suffix, so no other build can have written the object.
 */
export function newArtifactBuildManifestKey(hash: string, now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return artifactBuildManifestKey(hash, `${stamp}-${randomUUID().slice(0, 8)}`);
}

/**
 * The manifest at `key`, or undefined when there is none. A manifest that
 * does not validate, or that records a different revision than `hash`, is an
 * error, never read as absent.
 */
async function readArtifactManifestAt(
  ctx: OpsContext,
  hash: string,
  key: string,
): Promise<ArtifactManifest | undefined> {
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, key);
  if (text === undefined) return undefined;
  const source = `s3://${ctx.names.bucket}/${key}`;
  const manifest = parseArtifactManifest(text, source);
  if (manifest.hash !== hash) {
    throw new Error(`${source} records revision ${manifest.hash}, not ${hash}`);
  }
  return manifest;
}

/**
 * A revision's original artifact manifest (`build/artifacts/<hash>.json`), or
 * undefined when none was recorded: a build from before artifact manifests, or
 * one whose builder was denied the write.
 */
export async function readArtifactManifest(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest | undefined> {
  return readArtifactManifestAt(ctx, hash, artifactManifestKey(hash));
}

/**
 * Read a manifest after the site is already live: a read failure or a corrupt
 * record is reported and treated as absent, because nothing it could say
 * should stop the rest of a deploy or rollback.
 */
async function readOrWarn(
  ctx: OpsContext,
  hash: string,
  key: string,
  what: string,
): Promise<ArtifactManifest | undefined> {
  try {
    return await readArtifactManifestAt(ctx, hash, key);
  } catch (err) {
    ctx.logger.warn(`ignoring the ${what}: ${(err as Error).message}`);
    return undefined;
  }
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
 * The manifest a build recorded at its own `key`, logged as this build's
 * release - or a warning when it recorded none. Never throws.
 */
export async function readBuildArtifact(
  ctx: OpsContext,
  hash: string,
  key: string,
): Promise<ArtifactManifest | undefined> {
  const manifest = await readOrWarn(ctx, hash, key, "build's artifact manifest");
  if (manifest) {
    ctx.logger.ok(`release ${describeRelease(manifest)}`);
    ctx.logger.info(`  artifact manifest s3://${ctx.names.bucket}/${key}`);
    return manifest;
  }
  ctx.logger.warn(
    `the builder recorded no artifact manifest at ${key} - a stack bootstrapped before ` +
      `artifact manifests needs \`blogwright bootstrap ${ctx.env}\` to grant the builder write ` +
      'access to build/artifacts/, and a builder image older than this blogwright records ' +
      'none until the next deploy rebuilds it',
  );
  return undefined;
}

/**
 * Keep `manifest` as the revision's original record unless one exists: the
 * write is conditional, so the first build recorded wins and is never
 * replaced. When one exists, say whether this build reproduced it. Never
 * throws - the site is already live.
 */
/**
 * How a build's manifest relates to its revision's original: it became the
 * original, it matches it, it differs from it, or the original could not be
 * written or read.
 */
type OriginalOutcome = 'created' | 'matches' | 'differs' | 'unknown';

async function recordOriginalArtifact(
  ctx: OpsContext,
  manifest: ArtifactManifest,
): Promise<OriginalOutcome> {
  const key = artifactManifestKey(manifest.hash);
  const location = `s3://${ctx.names.bucket}/${key}`;
  let created: boolean;
  try {
    created = await ctx.clients.s3.putObjectIfAbsent(
      ctx.names.bucket,
      key,
      serializeArtifactManifest(manifest),
      'application/json',
    );
  } catch (err) {
    ctx.logger.warn(
      `could not record the original artifact manifest at ${location}: ${(err as Error).message}`,
    );
    return 'unknown';
  }
  if (created) {
    ctx.logger.info(`  recorded as the original release of ${manifest.hash} at ${location}`);
    return 'created';
  }
  const original = await readOrWarn(ctx, manifest.hash, key, 'original artifact manifest');
  if (!original) return 'unknown';
  if (original.releaseHash === manifest.releaseHash) {
    ctx.logger.info(`  matches the original release of ${manifest.hash} recorded at ${location}`);
    return 'matches';
  }
  ctx.logger.warn(
    `this build of ${manifest.hash} is not byte-identical to its original release ` +
      `${original.release} (sha256 ${original.releaseHash}); the original record at ` +
      `${location} is kept unchanged`,
  );
  return 'differs';
}

/**
 * After a deploy's build: read the manifest it recorded at `key` and keep it
 * as the revision's original when it is the first. Never throws.
 */
export async function recordDeployArtifact(
  ctx: OpsContext,
  hash: string,
  key: string,
): Promise<ArtifactManifest | undefined> {
  const manifest = await readBuildArtifact(ctx, hash, key);
  if (manifest) await recordOriginalArtifact(ctx, manifest);
  return manifest;
}

/**
 * The manifest a staged release is bound to, or undefined when the hash has
 * no staged release. A corrupt record, or one for another revision, throws.
 */
export async function readStagedReleaseManifest(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest | undefined> {
  return readArtifactManifestAt(ctx, hash, stagedReleaseManifestKey(hash));
}

/** The manifest a staged release is bound to, refusing a hash that has no staged release. */
export async function requireStagedReleaseManifest(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest> {
  const manifest = await readStagedReleaseManifest(ctx, hash);
  if (manifest) return manifest;
  throw new Error(
    `${hash} is not staged: there is no staged release record at s3://${ctx.names.bucket}/` +
      `${stagedReleaseManifestKey(hash)}. Stage it first with \`blogwright stage ${ctx.env}\` ` +
      `from a checkout of ${hash}.`,
  );
}

/** Drop a hash's staged-release binding, before its staged bytes are replaced. */
export async function forgetStagedRelease(ctx: OpsContext, hash: string): Promise<void> {
  await ctx.clients.s3.deleteObject(ctx.names.bucket, stagedReleaseManifestKey(hash));
}

/**
 * Bind a staged release to the manifest its bytes were checked against, then
 * keep that manifest as the revision's original when it has none - so the
 * usual stage, promote, `verify <hash>` sequence checks one record. A
 * revision whose original is another build keeps that original, and is told
 * what `verify <hash>` will then report. Throws when the binding cannot be
 * written: without it there is nothing to promote.
 */
export async function recordStagedRelease(
  ctx: OpsContext,
  manifest: ArtifactManifest,
): Promise<void> {
  const key = stagedReleaseManifestKey(manifest.hash);
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    key,
    serializeArtifactManifest(manifest),
    'application/json',
  );
  ctx.logger.info(`  staged release recorded at s3://${ctx.names.bucket}/${key}`);
  if ((await recordOriginalArtifact(ctx, manifest)) === 'differs') {
    ctx.logger.warn(
      `promote publishes and checks this staged release; \`blogwright verify ${manifest.hash}\` ` +
        "checks site/ against the revision's original release, so after promotion it reports " +
        'the differences - `blogwright verify ' +
        `${manifest.hash} --staged\` checks the staged copy`,
    );
  }
}

/**
 * The original manifest recorded for a hash, read before a rebuild. A
 * rollback is a recovery path, so an unreadable record is reported and
 * treated as absent rather than blocking it.
 */
export async function readRecordedBeforeRebuild(
  ctx: OpsContext,
  hash: string,
): Promise<ArtifactManifest | undefined> {
  return readOrWarn(ctx, hash, artifactManifestKey(hash), 'recorded artifact manifest');
}

/**
 * Report whether a rebuild reproduced the recorded artifact. Two builds of the
 * same source are not guaranteed byte-identical (builder image, dependency
 * resolution, toolchain), so a difference is a warning naming both hashes. A
 * rebuild that recorded no manifest of its own cannot be checked, and is never
 * reported as identical.
 */
export function logRebuildComparison(
  ctx: OpsContext,
  recorded: ArtifactManifest | undefined,
  rebuilt: ArtifactManifest | undefined,
): void {
  if (!recorded) {
    ctx.logger.info(`  no artifact manifest was recorded before this rebuild`);
    return;
  }
  ctx.logger.info(`  recorded release sha256 ${recorded.releaseHash} (${recorded.release})`);
  if (!rebuilt) {
    ctx.logger.warn(
      'the rebuild recorded no artifact manifest, so it cannot be checked against the recorded ' +
        'release - treat the live site as unverified',
    );
    return;
  }
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
