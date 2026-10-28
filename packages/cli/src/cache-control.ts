/**
 * Keeps live objects' `Cache-Control` in step with the config. The build only
 * re-uploads changed content, and S3 writes a header only on a PUT, so after
 * the `cacheControl` rules change the unchanged objects would keep the old
 * header. The rules each target was last built with are recorded beside the
 * deploy manifests; a build whose rules differ re-uploads every file, exactly
 * as `--refresh` does.
 */

import type { CacheControlRule } from 'blogwright-core';

import type { OpsContext } from './context.js';

/** The S3 key recording the rules a target's last successful build applied. */
export function cacheControlRecordKey(target: string): string {
  return `build/cache-control/${target}.json`;
}

/** The record's shape: the rules as the agent received them. */
interface CacheControlRecord {
  rules: readonly CacheControlRule[];
}

function sameRules(a: readonly CacheControlRule[], b: readonly CacheControlRule[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The rules a target's live objects were last written with. No record means
 * none were: every deploy before `cacheControl` existed wrote no header. An
 * unreadable record is reported as undefined, so the caller re-applies.
 */
async function recordedRules(
  ctx: OpsContext,
  target: string,
): Promise<readonly CacheControlRule[] | undefined> {
  const key = cacheControlRecordKey(target);
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, key);
  if (text === undefined) return [];
  try {
    const record = JSON.parse(text) as Partial<CacheControlRecord>;
    if (Array.isArray(record.rules)) return record.rules;
  } catch {
    // Reported below, with the key, like any other malformed record.
  }
  ctx.logger.warn(`ignoring malformed ${key}; re-applying Cache-Control to every file`);
  return undefined;
}

/**
 * Whether the configured rules differ from the ones the target was last
 * built with, so this build must re-upload every file - an implicit
 * `--refresh`, announced so the wider invalidation is not a surprise.
 */
export async function cacheControlNeedsRefresh(ctx: OpsContext, target: string): Promise<boolean> {
  const recorded = await recordedRules(ctx, target);
  if (recorded !== undefined && sameRules(recorded, ctx.config.cacheControl)) return false;
  ctx.logger.step(
    "cacheControl rules differ from the ones this target's files were written with - " +
      're-uploading every file so unchanged ones get the new Cache-Control too (an implicit --refresh)',
  );
  return true;
}

/**
 * Record the rules a successful build applied. Non-fatal: the site is already
 * published, and a missing record only makes the next build refresh again.
 */
export async function recordCacheControl(ctx: OpsContext, target: string): Promise<void> {
  const record: CacheControlRecord = { rules: ctx.config.cacheControl };
  try {
    await ctx.clients.s3.putObject(
      ctx.names.bucket,
      cacheControlRecordKey(target),
      JSON.stringify(record, null, 2),
      'application/json',
    );
  } catch (err) {
    ctx.logger.warn(
      `could not record the applied cacheControl rules (${(err as Error).message}); ` +
        'the next deploy re-uploads every file again',
    );
  }
}
