/**
 * Release gating for static sites: `stage` builds once and publishes the
 * output to `releases/<hash>/`, which nothing serves, and records its artifact
 * manifest; `promote` copies those exact bytes into the live `site/` without
 * rebuilding, invalidates what changed, and verifies the result against the
 * manifest. The staged copy stays, so a later promotion of the same hash
 * restores the same bytes.
 */

import {
  AwsError,
  colors,
  findRepoRoot,
  invalidationPaths,
  mapConcurrently,
  RepoRootNotFoundError,
  artifactManifestKey,
  stagedReleasePrefix,
  type ArtifactManifest,
  type ObjectTagCopy,
} from 'blogwright-core';

import { describeRelease } from './artifacts.js';
import type { OpsContext } from './context.js';
import {
  invalidatePaths,
  readManifest,
  runBuild,
  uploadSource,
  writeManifest,
  type AfterDeploy,
  type InvalidationSummary,
} from './deploy.js';
import { describeLiveRelease, readLiveRelease, recordLiveRelease } from './live-release.js';
import { RELEASE_STAGING_OUTPUT, reconcileBuilderImage } from './nodes.js';
import { describeInvalidation, formatDuration, renderSummary, type SummaryRow } from './render.js';
import { assertServingModeMatches, siteBaseUrl } from './serving.js';
import { LIVE_SITE_PREFIX, verifyRelease } from './verify.js';

/** How many objects a promotion copies at once. */
const PROMOTE_CONCURRENCY = 8;

/** Stage and promote publish static output; SSR and preview stacks have other paths. */
function assertStaticEnvironment(ctx: OpsContext, command: string): void {
  if (ctx.preview) {
    throw new Error(`${command} does not apply to the shared preview stack`);
  }
  if (ctx.config.ssr) {
    throw new Error(
      `${command} publishes static releases, and "${ctx.env}" is an SSR environment: deploy ` +
        'publishes a Web Function revision, and rollback reproduces a recorded one without a rebuild',
    );
  }
  assertServingModeMatches(ctx);
}

/**
 * Refuse to stage on a stack whose builder may not write `releases/`: the
 * build would run in full and only then be denied.
 */
function assertReleaseStagingGranted(ctx: OpsContext): void {
  if (ctx.state.resources['iam-exec-role']?.[RELEASE_STAGING_OUTPUT] === true) return;
  throw new Error(
    `"${ctx.env}" was bootstrapped before release staging existed: run \`blogwright bootstrap ` +
      `${ctx.env}\` once so the builder may write releases/ and build/artifacts/. Nothing was built.`,
  );
}

/** Build the working copy and publish it to `releases/<hash>/` for a later `promote`. */
export async function stage(ctx: OpsContext): Promise<void> {
  const startedAt = Date.now();
  assertStaticEnvironment(ctx, 'stage');
  assertReleaseStagingGranted(ctx);
  const cwd = await findRepoRoot(ctx.ports.fs);
  const hash = await ctx.ports.vcs.revisionHash(cwd);
  const prefix = stagedReleasePrefix(hash);
  ctx.logger.info(colors.bold(`Staging ${hash} for "${ctx.env}" at ${prefix}`));

  const source = await uploadSource(ctx, cwd, hash);
  await reconcileBuilderImage(ctx);
  const build = await runBuild(ctx, {
    hash,
    sourceKey: source.sourceKey,
    sitePrefix: prefix,
    target: 'stage',
    // robots.txt and sitemap.xml are written for the environment the release
    // will be promoted into, so the staged bytes are exactly the live bytes.
    baseUrl: siteBaseUrl(ctx),
    artifactManifestKey: artifactManifestKey(hash),
    kind: 'staged',
  });
  // The builder records changed paths for every build; a staged one serves
  // nothing, so there is nothing to invalidate.
  await ctx.clients.s3.deleteObject(ctx.names.bucket, `build/changed/${hash}.json`);
  const manifest = await verifyRelease(ctx, hash, prefix);

  const rows: SummaryRow[] = [
    { label: 'revision', value: hash },
    { label: 'environment', value: ctx.env },
    { label: 'release', value: describeRelease(manifest) },
    { label: 'staged at', value: `s3://${ctx.names.bucket}/${prefix}` },
    { label: 'build', value: formatDuration(build.durationMs) },
  ];
  for (const line of renderSummary('stage summary', rows, ctx.ports.terminal.isInteractive)) {
    ctx.logger.info(line);
  }
  ctx.logger.ok(`staged ${hash} in ${formatDuration(Date.now() - startedAt)}`);
  ctx.logger.info(`  promote it with: blogwright promote ${hash} ${ctx.env}`);
}

function isAccessDenied(err: unknown): boolean {
  return err instanceof AwsError && (err.statusCode === 403 || /AccessDenied/i.test(err.code));
}

/**
 * Copy staged objects into `site/`, carrying their tags - or, once the caller
 * turns out not to hold the tagging permissions (a deploy role bootstrapped
 * before promotion existed), without them for the rest of the run. Tags are
 * cost metadata, never content, so they do not fail a promotion.
 */
function createReleaseCopier(ctx: OpsContext) {
  let tags: ObjectTagCopy = 'copy';
  return async function copy(sourceKey: string, destinationKey: string): Promise<void> {
    if (tags === 'copy') {
      try {
        await ctx.clients.s3.copyObject(ctx.names.bucket, sourceKey, destinationKey, 'copy');
        return;
      } catch (err) {
        if (!isAccessDenied(err)) throw err;
        if (tags === 'copy') {
          tags = 'drop';
          ctx.logger.warn(
            'this role cannot copy object tags (s3:GetObjectTagging/s3:PutObjectTagging denied) - ' +
              `promoting untagged. Run \`blogwright bootstrap ${ctx.env}\` to grant them.`,
          );
        }
      }
    }
    await ctx.clients.s3.copyObject(ctx.names.bucket, sourceKey, destinationKey, 'drop');
  };
}

/** What publishing a staged release into `site/` changed. */
interface PublishedRelease {
  copied: number;
  deleted: number;
  invalidation: InvalidationSummary;
}

/**
 * Make `site/` hold exactly the staged release: server-side copy every file
 * whose live ETag differs from the staged one (every file with `refresh`),
 * then delete live objects the release does not contain - after the copies,
 * so the site never has a partial window - and invalidate the changed paths.
 * A server-side copy moves the stored bytes, content type and tags as they
 * are; nothing is rebuilt or re-encoded.
 */
async function publishStagedRelease(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  opts: { refresh?: boolean | undefined } = {},
): Promise<PublishedRelease> {
  const prefix = stagedReleasePrefix(manifest.hash);
  const etags = async (listPrefix: string) =>
    new Map(
      (await ctx.clients.s3.listObjects(ctx.names.bucket, listPrefix)).map((object) => [
        object.key.slice(listPrefix.length),
        object.etag,
      ]),
    );
  const staged = await etags(prefix);
  const live = await etags(LIVE_SITE_PREFIX);
  const toCopy = manifest.files
    .map((file) => file.path)
    .filter((path) => opts.refresh || live.get(path) !== staged.get(path));
  const releasePaths = new Set(manifest.files.map((file) => file.path));
  const toDelete = [...live.keys()].filter((path) => !releasePaths.has(path));

  ctx.logger.step(
    `copying ${toCopy.length} of ${manifest.fileCount} files from ${prefix} to ${LIVE_SITE_PREFIX}`,
  );
  const copy = createReleaseCopier(ctx);
  await mapConcurrently(toCopy, PROMOTE_CONCURRENCY, (path) =>
    copy(`${prefix}${path}`, `${LIVE_SITE_PREFIX}${path}`),
  );
  for (const path of toDelete) {
    await ctx.clients.s3.deleteObject(ctx.names.bucket, `${LIVE_SITE_PREFIX}${path}`);
  }
  if (toDelete.length > 0) ctx.logger.step(`deleted ${toDelete.length} stale object(s)`);

  const changedKeys = [...toCopy, ...toDelete].map((path) => `${LIVE_SITE_PREFIX}${path}`);
  const paths = [
    ...new Set(changedKeys.flatMap((key) => invalidationPaths(key, LIVE_SITE_PREFIX))),
  ];
  const invalidation = await invalidatePaths(ctx, paths);
  return { copied: toCopy.length, deleted: toDelete.length, invalidation };
}

/** Refuse a hash with nothing under its staged prefix, before anything is read in full. */
async function assertStaged(ctx: OpsContext, hash: string): Promise<void> {
  const prefix = stagedReleasePrefix(hash);
  const objects = await ctx.clients.s3.listObjects(ctx.names.bucket, prefix);
  if (objects.length > 0) return;
  throw new Error(
    `${hash} is not staged: s3://${ctx.names.bucket}/${prefix} is empty. Stage it first ` +
      `with \`blogwright stage ${ctx.env}\` from a checkout of ${hash}.`,
  );
}

/** Stamp the promotion on the hash's deployment manifest, so `history` shows it live. */
async function recordPromotion(ctx: OpsContext, hash: string): Promise<void> {
  const manifest = await readManifest(ctx, hash);
  if (!manifest) return;
  await writeManifest(ctx, { ...manifest, promotedAt: new Date().toISOString() });
}

/**
 * Run the post-deploy plugin steps only when the working copy is the promoted
 * revision: they publish the working copy's content (the standard.site sync,
 * for one), which would not match a release built from another revision.
 */
async function runAfterPromote(
  ctx: OpsContext,
  hash: string,
  afterDeploy: AfterDeploy,
): Promise<void> {
  let checkedOut: string | undefined;
  try {
    checkedOut = await ctx.ports.vcs.revisionHash(await findRepoRoot(ctx.ports.fs));
  } catch (err) {
    if (!(err instanceof RepoRootNotFoundError)) throw err;
  }
  if (checkedOut === hash) {
    await afterDeploy(ctx);
    return;
  }
  ctx.logger.warn(
    `skipping the post-deploy plugin steps: they publish the working copy's content, and the ` +
      `working copy is ${checkedOut ?? 'not a repository'}, not ${hash}. Check out ${hash} and ` +
      'run them yourself (for example `blogwright pds sync`) if needed.',
  );
}

export interface PromoteOptions {
  /** Copy every file, not only those whose content differs from the live object. */
  refresh?: boolean | undefined;
  /** The post-deploy plugin steps; see {@link runAfterPromote}. */
  afterDeploy: AfterDeploy;
}

/**
 * Point production at a staged release without rebuilding: check the staged
 * objects still match the recorded manifest, copy them into `site/`,
 * invalidate the changed paths, and verify the live objects match too.
 */
export async function promote(ctx: OpsContext, hash: string, opts: PromoteOptions): Promise<void> {
  const startedAt = Date.now();
  assertStaticEnvironment(ctx, 'promote');
  await assertStaged(ctx, hash);
  const before = await readLiveRelease(ctx);
  ctx.logger.info(colors.bold(`Promoting ${hash} to "${ctx.env}"`));

  // The staged bytes must still be the reviewed ones before any is published.
  const manifest = await verifyRelease(ctx, hash, stagedReleasePrefix(hash));
  const published = await publishStagedRelease(ctx, manifest, opts);
  // And the live bytes must now be exactly those - promotion's guarantee.
  await verifyRelease(ctx, hash, LIVE_SITE_PREFIX);
  await recordLiveRelease(ctx, manifest, 'promote');
  await recordPromotion(ctx, hash);
  await runAfterPromote(ctx, hash, opts.afterDeploy);

  const url = siteBaseUrl(ctx);
  const rows: SummaryRow[] = [
    { label: 'environment', value: ctx.env },
    { label: 'previous', value: describeLiveRelease(before) },
    { label: 'release', value: describeRelease(manifest) },
    { label: 'copied', value: `${published.copied} of ${manifest.fileCount} files` },
    { label: 'deleted', value: `${published.deleted} stale object(s)` },
    { label: 'invalidated', value: describeInvalidation(published.invalidation) },
    ...(url ? [{ label: 'site', value: colors.cyan(url) }] : []),
  ];
  for (const line of renderSummary('promote summary', rows, ctx.ports.terminal.isInteractive)) {
    ctx.logger.info(line);
  }
  ctx.logger.ok(`promoted ${hash} in ${formatDuration(Date.now() - startedAt)}`);
}
