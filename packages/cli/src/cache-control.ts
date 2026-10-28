/**
 * Keeps live objects' `Cache-Control` in step with the config. The build only
 * re-uploads changed content, and S3 writes a header only on a PUT, so after
 * the `cacheControl` rules change the unchanged objects would keep the old
 * header. Each target has a record beside the deploy manifests saying which
 * rules its files were written with; a build whose rules differ re-uploads
 * every file, exactly as `--refresh` does.
 *
 * The record says `applied` only on evidence: the agent reports the rules it
 * wrote in its changed-paths manifest, and an agent older than `cacheControl`
 * reports none. Before a build that changes the rules, the record is marked
 * `unconfirmed`, so a build that fails or is cancelled partway - leaving some
 * files with the new header and some with the old - is re-applied in full by
 * the next build, whatever the rules are by then.
 */

import { parseCacheControlRules, type CacheControlRule } from 'blogwright-core';

import type { OpsContext } from './context.js';

/** The S3 key recording the rules a target's files were last written with. */
export function cacheControlRecordKey(target: string): string {
  return `build/cache-control/${target}.json`;
}

/**
 * A target's record. `unconfirmed` means its files may carry headers from
 * rules other than any recorded: a rule-changing build has not finished, or
 * the agent did not report what it wrote.
 */
export type CacheControlRecord =
  | { status: 'applied'; rules: readonly CacheControlRule[] }
  | { status: 'unconfirmed' };

/** Why a build must re-upload every file to bring `Cache-Control` in line with the config. */
export type CacheControlRefreshReason = 'unrecorded' | 'changed' | 'unconfirmed' | 'unreadable';

const REFRESH_MESSAGES: Record<CacheControlRefreshReason, string> = {
  unrecorded:
    'no Cache-Control record for this target yet - uploading every file with the current ' +
    'cacheControl rules, so any files already there get them too',
  changed:
    "cacheControl rules differ from the ones this target's files were written with - " +
    're-uploading every file so unchanged ones get the new Cache-Control too',
  unconfirmed:
    'the last build to this target did not confirm the Cache-Control it wrote (it stopped ' +
    'while changing the rules, or ran on an older builder image) - re-uploading every file ' +
    'with the current cacheControl rules',
  unreadable: 're-uploading every file with the current cacheControl rules',
};

/** The log line announcing a {@link CacheControlRefreshReason}. */
export function describeCacheControlRefresh(reason: CacheControlRefreshReason): string {
  return REFRESH_MESSAGES[reason];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether two rule lists are the same rules in the same order. */
export function sameCacheControlRules(
  a: readonly CacheControlRule[],
  b: readonly CacheControlRule[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse and validate a record body; throws, naming the key, on anything malformed. */
function parseRecord(text: string, key: string): CacheControlRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${key} is not valid JSON (${errorMessage(err)})`, { cause: err });
  }
  if (!isRecord(raw)) throw new Error(`${key} must hold a JSON object`);
  if (raw.status === 'unconfirmed') return { status: 'unconfirmed' };
  if (raw.status !== 'applied') {
    throw new Error(`${key} has status ${JSON.stringify(raw.status)}, not "applied"/"unconfirmed"`);
  }
  try {
    return { status: 'applied', rules: parseCacheControlRules(raw.rules) };
  } catch (err) {
    throw new Error(`${key} holds rules that do not validate (${errorMessage(err)})`, {
      cause: err,
    });
  }
}

/**
 * Why this build to `target` must re-upload every file, or undefined when the
 * target's files already carry the configured rules. No record means none
 * were ever written - every deploy before `cacheControl` wrote no header - so
 * empty rules need nothing. An unreadable record is warned about and re-applied.
 */
export async function cacheControlRefreshReason(
  ctx: OpsContext,
  target: string,
): Promise<CacheControlRefreshReason | undefined> {
  const key = cacheControlRecordKey(target);
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, key);
  if (text === undefined) return ctx.config.cacheControl.length > 0 ? 'unrecorded' : undefined;
  let record: CacheControlRecord;
  try {
    record = parseRecord(text, key);
  } catch (err) {
    ctx.logger.warn(`ignoring malformed ${key}: ${errorMessage(err)}`);
    return 'unreadable';
  }
  if (record.status === 'unconfirmed') return 'unconfirmed';
  return sameCacheControlRules(record.rules, ctx.config.cacheControl) ? undefined : 'changed';
}

/**
 * A target's record, or undefined when it has none. A malformed record is
 * warned about and read as `unconfirmed`, which makes the next build to the
 * target re-apply the rules.
 */
export async function readCacheControlRecord(
  ctx: OpsContext,
  target: string,
): Promise<CacheControlRecord | undefined> {
  const key = cacheControlRecordKey(target);
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, key);
  if (text === undefined) return undefined;
  try {
    return parseRecord(text, key);
  } catch (err) {
    ctx.logger.warn(`ignoring malformed ${key}: ${errorMessage(err)}`);
    return { status: 'unconfirmed' };
  }
}

/** Write a target's record as given. */
export async function writeCacheControlRecord(
  ctx: OpsContext,
  target: string,
  record: CacheControlRecord,
): Promise<void> {
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    cacheControlRecordKey(target),
    JSON.stringify(record, null, 2),
    'application/json',
  );
}

/**
 * Mark the target's record `unconfirmed` before its files are rewritten with
 * other rules - by a build that re-applies them, or a promotion copying a
 * staged release's headers in - so one that stops partway is re-applied by the
 * next build. Fatal: nothing has been published yet, and going on without the
 * mark could leave mixed headers that no later build notices.
 */
export async function markCacheControlUnconfirmed(ctx: OpsContext, target: string): Promise<void> {
  try {
    await writeCacheControlRecord(ctx, target, { status: 'unconfirmed' });
  } catch (err) {
    throw new Error(
      `could not mark ${cacheControlRecordKey(target)} unconfirmed before rewriting its files ` +
        `(${errorMessage(err)}); nothing was published`,
      { cause: err },
    );
  }
}

/** The rules the agent's changed-paths manifest reports, or undefined when it reports none. */
function reportedRules(text: string): CacheControlRule[] | undefined {
  const manifest: unknown = JSON.parse(text);
  if (!isRecord(manifest) || manifest.cacheControl === undefined) return undefined;
  return parseCacheControlRules(manifest.cacheControl);
}

/**
 * Whether the agent reported writing exactly the configured rules. An agent
 * older than `cacheControl` reports nothing, and a missing or unreadable
 * manifest proves nothing either; both are warned about and count as unconfirmed.
 */
async function agentConfirmedRules(ctx: OpsContext, reportKey: string): Promise<boolean> {
  try {
    const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, reportKey);
    const reported = text === undefined ? undefined : reportedRules(text);
    if (reported !== undefined && sameCacheControlRules(reported, ctx.config.cacheControl))
      return true;
    ctx.logger.warn(
      `the builder did not report writing the configured Cache-Control in ${reportKey} ` +
        '(an older builder image, or a missing manifest) - the next build to this target ' +
        're-uploads every file',
    );
  } catch (err) {
    ctx.logger.warn(
      `could not read the Cache-Control the builder reported in ${reportKey} ` +
        `(${errorMessage(err)}) - the next build to this target re-uploads every file`,
    );
  }
  return false;
}

/**
 * Record what a successful build wrote: `applied` with the rules when the
 * agent's manifest at `reportKey` confirms them, `unconfirmed` otherwise.
 * Non-fatal: the site is already published, so a failed write only warns and
 * leaves the record as it was.
 */
export async function recordCacheControl(
  ctx: OpsContext,
  target: string,
  reportKey: string,
): Promise<void> {
  const record: CacheControlRecord = (await agentConfirmedRules(ctx, reportKey))
    ? { status: 'applied', rules: ctx.config.cacheControl }
    : { status: 'unconfirmed' };
  try {
    await writeCacheControlRecord(ctx, target, record);
  } catch (err) {
    ctx.logger.warn(
      `could not record the Cache-Control this build wrote in ${cacheControlRecordKey(target)} ` +
        `(${errorMessage(err)}); the record is left as it was`,
    );
  }
}
