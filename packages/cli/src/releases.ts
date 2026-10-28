/**
 * Release gating for static sites: `stage` builds once and publishes the
 * output to `releases/<hash>/`, which nothing serves, and records its artifact
 * manifest; `promote` copies those exact bytes into the live `site/` without
 * rebuilding, invalidates what changed, and verifies the result against the
 * manifest. The staged copy stays, so a later promotion of the same hash
 * restores the same bytes - and `rollback <hash>` to a staged hash republishes
 * it through the same checked copy instead of rebuilding.
 */

import {
  AwsError,
  colors,
  findRepoRoot,
  invalidationPaths,
  mapConcurrently,
  RepoRootNotFoundError,
  stagedReleasePrefix,
  stagedReleaseManifestKey,
  type ArtifactComparison,
  type ArtifactManifest,
  type ObjectTagCopy,
} from 'blogwright-core';

import {
  describeRelease,
  forgetStagedRelease,
  readArtifactManifest,
  newArtifactBuildManifestKey,
  readBuildArtifact,
  readStagedReleaseManifest,
  recordStagedRelease,
  requireStagedReleaseManifest,
} from './artifacts.js';
import {
  cacheControlRecordKey,
  markCacheControlUnconfirmed,
  readCacheControlRecord,
  sameCacheControlRules,
  writeCacheControlRecord,
  type CacheControlRecord,
} from './cache-control.js';
import type { OpsContext } from './context.js';
import {
  changedManifestKey,
  invalidatePaths,
  LIVE_SITE_TARGET,
  readManifest,
  runBuild,
  uploadSource,
  writeManifest,
  type AfterDeploy,
  type InvalidationSummary,
} from './deploy.js';
import {
  describeLiveRelease,
  isSettledLiveRelease,
  markLiveReleasePublishing,
  readLiveRelease,
  readPublications,
  recordLiveRelease,
  recordPublication,
  type LiveReleaseRecord,
  type ReleasePublication,
} from './live-release.js';
import { withEnvLock, type LockOptions } from './lock.js';
import {
  RELEASE_STAGING_OUTPUT,
  reconcileBuilderImage,
  reconcileResponseHeadersOnDeploy,
} from './nodes.js';
import { describeInvalidation, formatDuration, renderSummary, type SummaryRow } from './render.js';
import { resolveSeo } from './seo.js';
import { assertServingModeMatches, siteBaseUrl } from './serving.js';
import { LIVE_SITE_PREFIX, ReleaseMismatchError, verifyStoredRelease } from './verify.js';

/** How many objects a promotion copies at once. */
const PROMOTE_CONCURRENCY = 8;

/**
 * How many leading bytes of a staged `sitemap.xml` are read to find its
 * origin: enough for the XML declaration, the `<urlset>` element and the
 * first `<loc>`, without reading a large sitemap whole.
 */
const SITEMAP_HEAD_BYTES = 4096;

/** The commands that publish a staged release into `site/`. */
type RepublishCommand = ReleasePublication['via'];

/** How a message names the act of publishing for each command. */
function publishing(command: RepublishCommand): string {
  return command === 'promote' ? 'promoting' : 'republishing';
}

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

/** The build target a staged release publishes as: its pending-job and Cache-Control record name. */
function stagedReleaseTarget(hash: string): string {
  return `release-${hash}`;
}

export interface StageOptions extends LockOptions {
  /**
   * Re-upload every file into the staged prefix, even content the previous
   * stage of this hash already wrote, so metadata fixes reach the staged copy.
   */
  refresh?: boolean | undefined;
}

/** Build the working copy and publish it to `releases/<hash>/` for a later `promote`. */
export async function stage(ctx: OpsContext, opts: StageOptions = {}): Promise<void> {
  const startedAt = Date.now();
  assertStaticEnvironment(ctx, 'stage');
  assertReleaseStagingGranted(ctx);
  const cwd = await findRepoRoot(ctx.ports.fs);
  const hash = await ctx.ports.vcs.revisionHash(cwd);
  const prefix = stagedReleasePrefix(hash);
  ctx.logger.info(colors.bold(`Staging ${hash} for "${ctx.env}" at ${prefix}`));
  // Staging writes no site/, but it shares the bucket's build records and
  // replaces a release a promotion may be copying, so it holds the lock too.
  await withEnvLock(ctx, 'stage', hash, opts, () =>
    stageLocked(ctx, { cwd, hash, prefix, startedAt, refresh: opts.refresh }),
  );
}

async function stageLocked(
  ctx: OpsContext,
  run: {
    cwd: string;
    hash: string;
    prefix: string;
    startedAt: number;
    refresh: boolean | undefined;
  },
): Promise<void> {
  const { cwd, hash, prefix, startedAt } = run;

  // The staged bytes are about to be replaced, so the record binding them to
  // a manifest goes first: a stage that stops partway leaves nothing promotable.
  await forgetStagedRelease(ctx, hash);
  const source = await uploadSource(ctx, cwd, hash);
  await reconcileBuilderImage(ctx);
  const buildManifestKey = newArtifactBuildManifestKey(hash);
  const build = await runBuild(ctx, {
    hash,
    sourceKey: source.sourceKey,
    sitePrefix: prefix,
    // Each staged release is its own target, so its Cache-Control record
    // says which rules the files under its prefix were written with - what
    // a promotion carries into site/.
    target: stagedReleaseTarget(hash),
    // robots.txt and sitemap.xml are written for the environment the release
    // will be promoted into, so the staged bytes are exactly the live bytes.
    baseUrl: siteBaseUrl(ctx),
    artifactManifestKey: buildManifestKey,
    kind: 'staged',
    ...(run.refresh ? { refresh: true } : {}),
  });
  // The builder records changed paths for every build; a staged one serves
  // nothing, so there is nothing to invalidate.
  await ctx.clients.s3.deleteObject(
    ctx.names.bucket,
    changedManifestKey(stagedReleaseTarget(hash), hash),
  );
  const recorded = await readBuildArtifact(ctx, hash, buildManifestKey);
  if (!recorded) {
    throw new Error(
      `the staged build of ${hash} recorded no artifact manifest, so there is nothing to check ` +
        'its bytes against - nothing was staged',
    );
  }
  const manifest = await verifyStoredRelease(ctx, recorded, prefix);
  await recordStagedRelease(ctx, manifest);

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

/** S3's denial code - not any 403: a bad signature or a skewed clock is no tagging question. */
function isAccessDenied(err: unknown): boolean {
  return err instanceof AwsError && err.code === 'AccessDenied';
}

/**
 * Copy staged objects into `site/`, carrying their tags - or, once the caller
 * turns out not to hold the tagging permissions (a deploy role bootstrapped
 * before promotion existed), without them for the rest of the run. Tags are
 * cost metadata, never content, so they do not fail a promotion.
 *
 * S3 answers a missing tagging grant with the same `AccessDenied` as any
 * other denial, so a denied tag-copying copy is retried without tags: only
 * when that succeeds was the denial about tags. A denial the untagged copy
 * gets too - no s3:PutObject, a bucket policy - fails the promotion with no
 * word about tags.
 */
function createReleaseCopier(ctx: OpsContext, hash: string, command: RepublishCommand) {
  let tags: ObjectTagCopy = 'copy';
  const copyUntagged = (sourceKey: string, destinationKey: string) =>
    ctx.clients.s3.copyObject(ctx.names.bucket, sourceKey, destinationKey, { tags: 'drop' });
  return async function copy(sourceKey: string, destinationKey: string): Promise<void> {
    if (tags === 'drop') return copyUntagged(sourceKey, destinationKey);
    try {
      await ctx.clients.s3.copyObject(ctx.names.bucket, sourceKey, destinationKey, {
        tags: 'copy',
      });
      return;
    } catch (err) {
      if (!isAccessDenied(err)) throw err;
    }
    await copyUntagged(sourceKey, destinationKey);
    if (tags === 'copy') {
      tags = 'drop';
      ctx.logger.warn(
        'this role cannot copy object tags (s3:GetObjectTagging/s3:PutObjectTagging denied) - ' +
          `${publishing(command)} untagged. Run \`blogwright bootstrap ${ctx.env}\` to grant them, ` +
          `then \`blogwright ${command} ${hash} ${ctx.env} --refresh\` to copy the tags onto every file.`,
      );
    }
  };
}

/**
 * How a promotion keeps `Cache-Control` coherent. A copy carries each staged
 * object's header, which the rules in force when it was staged decided; a
 * file the promotion skips because its content is unchanged keeps the header
 * site/ already had. So unless both are known to come from the same rules,
 * every file is copied - the promotion's equivalent of a deploy's implicit
 * `--refresh` - and site/'s record is marked unconfirmed first, so a
 * promotion that stops partway is re-applied by the next build.
 */
interface CacheControlPlan {
  /** The staged release's record: what site/ carries once it is promoted. */
  staged: CacheControlRecord;
  copyEveryFile: boolean;
}

/**
 * Read both records and decide. No record for site/ means its files were
 * written before `cacheControl` existed, with no header - the same as empty
 * rules. A staged release always records its rules, so a missing record there
 * proves nothing and counts as unconfirmed.
 */
async function planCacheControl(
  ctx: OpsContext,
  hash: string,
  command: RepublishCommand,
): Promise<CacheControlPlan> {
  const staged = (await readCacheControlRecord(ctx, stagedReleaseTarget(hash))) ?? {
    status: 'unconfirmed',
  };
  const live = (await readCacheControlRecord(ctx, LIVE_SITE_TARGET)) ?? {
    status: 'applied',
    rules: [],
  };
  if (
    staged.status === 'applied' &&
    !sameCacheControlRules(staged.rules, ctx.config.cacheControl)
  ) {
    ctx.logger.warn(
      `${hash} was staged with cacheControl rules that differ from the current config - ` +
        `${publishing(command)} the Cache-Control it was staged with. Stage it again to apply the ` +
        'current rules.',
    );
  }
  const copyEveryFile = !(
    staged.status === 'applied' &&
    live.status === 'applied' &&
    sameCacheControlRules(staged.rules, live.rules)
  );
  if (copyEveryFile) {
    ctx.logger.step(
      "the staged release's Cache-Control may differ from what site/ was written with - copying " +
        'every file, so unchanged ones carry the staged headers too',
    );
    await markCacheControlUnconfirmed(ctx, LIVE_SITE_TARGET);
  }
  return { staged, copyEveryFile };
}

/**
 * site/ now carries the staged release's headers, so it takes the staged
 * record. Non-fatal like a build's own record: the release is published, and
 * a record left unconfirmed only makes the next build re-apply the rules.
 */
async function recordPromotedCacheControl(
  ctx: OpsContext,
  staged: CacheControlRecord,
): Promise<void> {
  try {
    await writeCacheControlRecord(ctx, LIVE_SITE_TARGET, staged);
  } catch (err) {
    ctx.logger.warn(
      `could not record the promoted Cache-Control in ${cacheControlRecordKey(LIVE_SITE_TARGET)} ` +
        `(${err instanceof Error ? err.message : String(err)}); the next build to site/ re-uploads every file`,
    );
  }
}

/** What publishing a staged release into `site/` changed. */
interface PublishedRelease {
  copied: number;
  deleted: number;
  invalidation: InvalidationSummary;
}

/**
 * Make `site/` hold exactly the staged release: server-side copy every file
 * whose live ETag differs from the staged one (every file with `refresh`, or
 * when the Cache-Control rules may differ), then delete live objects the
 * release does not contain, then invalidate the changed paths.
 *
 * The copies run in parallel, in no page-before-asset order, so while they
 * run a visitor can get a new page whose new assets are not copied yet, or
 * an old page beside a new asset - as during a deploy's upload. Deleting only
 * after every copy succeeded means no page that is still live ever loses an
 * asset it references. A copy moves the staged object's bytes, content type,
 * Cache-Control and tags as they are; a file whose content is unchanged is
 * not copied, so it keeps its live content type and tags (`--refresh` copies
 * those too).
 */
async function publishStagedRelease(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  opts: { refresh?: boolean | undefined; via: RepublishCommand },
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
  const headers = await planCacheControl(ctx, manifest.hash, opts.via);
  // From here site/ changes: until the promotion finishes, the live-release
  // record must not keep naming the release it replaces.
  await markLiveReleasePublishing(ctx, manifest.hash, opts.via);
  const copyAll = opts.refresh === true || headers.copyEveryFile;
  const toCopy = manifest.files
    .map((file) => file.path)
    .filter((path) => copyAll || live.get(path) !== staged.get(path));
  const releasePaths = new Set(manifest.files.map((file) => file.path));
  const toDelete = [...live.keys()].filter((path) => !releasePaths.has(path));

  ctx.logger.step(
    `copying ${toCopy.length} of ${manifest.fileCount} files from ${prefix} to ${LIVE_SITE_PREFIX}`,
  );
  const copy = createReleaseCopier(ctx, manifest.hash, opts.via);
  await mapConcurrently(toCopy, PROMOTE_CONCURRENCY, (path) =>
    copy(`${prefix}${path}`, `${LIVE_SITE_PREFIX}${path}`),
  );
  for (const path of toDelete) {
    await ctx.clients.s3.deleteObject(ctx.names.bucket, `${LIVE_SITE_PREFIX}${path}`);
  }
  if (toDelete.length > 0) ctx.logger.step(`deleted ${toDelete.length} stale object(s)`);
  await recordPromotedCacheControl(ctx, headers.staged);

  const changedKeys = [...toCopy, ...toDelete].map((path) => `${LIVE_SITE_PREFIX}${path}`);
  const paths = [
    ...new Set(changedKeys.flatMap((key) => invalidationPaths(key, LIVE_SITE_PREFIX))),
  ];
  const invalidation = await invalidatePaths(ctx, paths);
  return { copied: toCopy.length, deleted: toDelete.length, invalidation };
}

/**
 * `verify <hash>` checks site/ against the revision's original manifest. When
 * the promoted release is another build of the revision, say so: the
 * promotion was checked against the staged release, and `verify` will differ.
 */
async function warnIfOriginalDiffers(
  ctx: OpsContext,
  promoted: ArtifactManifest,
  command: RepublishCommand,
): Promise<void> {
  let original: ArtifactManifest | undefined;
  try {
    original = await readArtifactManifest(ctx, promoted.hash);
  } catch (err) {
    ctx.logger.warn(
      `could not read the original artifact manifest of ${promoted.hash}: ${(err as Error).message}`,
    );
    return;
  }
  if (!original || original.releaseHash === promoted.releaseHash) return;
  const published = command === 'promote' ? 'promoted' : 'restored';
  ctx.logger.warn(
    `the ${published} release is not byte-identical to ${promoted.hash}'s original release ` +
      `${original.release} (sha256 ${original.releaseHash}): \`blogwright verify ${promoted.hash}\` ` +
      `checks the original and will report the differences; this ${command} was checked against ` +
      'the staged release',
  );
}

/** Stamp the promotion on the hash's staged build record, so `history` shows it live. */
async function recordPromotion(ctx: OpsContext, hash: string): Promise<void> {
  const manifest = await readManifest(ctx, hash, 'staged');
  if (!manifest) return;
  await writeManifest(ctx, { ...manifest, promotedAt: new Date().toISOString() });
}

/**
 * Run the post-deploy plugin steps after a `promote` or a `rollback` only when
 * the working copy is the revision now live: they publish the working copy's
 * content (the standard.site sync, for one), which matches the live site then
 * and would not match a release built from another revision. Otherwise warn
 * and skip them - whichever plugins are installed.
 */
export async function runAfterPublish(
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

/** A staged release published to `site/`, and the release it replaced. */
interface Republished {
  before: LiveReleaseRecord | undefined;
  manifest: ArtifactManifest;
  published: PublishedRelease;
}

/** What a staged copy that no longer matches its record most likely went through. */
function describeStagedDamage(comparison: ArtifactComparison): string {
  const onlyMissing = comparison.changed.length === 0 && comparison.unexpected.length === 0;
  if (onlyMissing) {
    return (
      'objects are missing from the staged copy - an S3 lifecycle rule expiring releases/ ' +
      'objects, or a delete, removes them'
    );
  }
  return 'the staged copy was modified after it was staged and checked';
}

/** How to recover from a staged release that cannot be published, per command. */
function stagedRecoveryHint(ctx: OpsContext, hash: string, command: RepublishCommand): string {
  const restage = `\`blogwright stage ${ctx.env}\` from a checkout of ${hash}`;
  if (command === 'promote') return `Stage it again with ${restage}, then promote it.`;
  return (
    `To recover, stage it again with ${restage} and roll back again, or rebuild it from its ` +
    `archived source with \`blogwright rollback ${hash} ${ctx.env} --rebuild\` - the rebuild is ` +
    'compared with the original release, but no review covered its bytes.'
  );
}

/**
 * The staged copy must still be exactly the reviewed bytes before any is
 * published. When it is not, refuse - nothing has been written - naming the
 * counts, the likely cause and the way out.
 */
async function verifyStagedCopy(
  ctx: OpsContext,
  staged: ArtifactManifest,
  command: RepublishCommand,
): Promise<ArtifactManifest> {
  try {
    return await verifyStoredRelease(ctx, staged, stagedReleasePrefix(staged.hash));
  } catch (err) {
    if (!(err instanceof ReleaseMismatchError)) throw err;
    throw new Error(
      `cannot ${command === 'promote' ? 'promote' : 'republish'} ${staged.hash}: ${err.message} ` +
        `(${describeStagedDamage(err.comparison)}). Nothing was published. ` +
        stagedRecoveryHint(ctx, staged.hash, command),
      { cause: err },
    );
  }
}

/**
 * A revision staged again since it was last published may now hold other
 * bytes than the ones that were live then: say which release this publishes
 * and which one was published before. Both were verified when staged.
 */
async function warnIfRestaged(
  ctx: OpsContext,
  staged: ArtifactManifest,
  command: RepublishCommand,
): Promise<void> {
  const last = (await readPublications(ctx, staged.hash)).at(-1);
  if (!last || last.releaseHash === staged.releaseHash) return;
  ctx.logger.warn(
    `${staged.hash} was staged again since its last ${last.via} on ${last.publishedAt}, which ` +
      `published ${last.release} (sha256 ${last.releaseHash}); this ${command} publishes the ` +
      `release staged now, ${staged.release} (sha256 ${staged.releaseHash}) - checked when it was ` +
      'staged, but not the bytes that were live then',
  );
}

/** The first `<loc>` URL's origin in the head of a sitemap, if there is one. */
function sitemapOrigin(head: string): string | undefined {
  const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(head)?.[1];
  if (!loc) return undefined;
  try {
    return new URL(loc).origin;
  } catch {
    return undefined;
  }
}

/**
 * `robots.txt` and `sitemap.xml` are written for the origin the environment
 * had when the release was staged. A release staged before a domain change
 * would publish the old origin's: compare what was staged with what the
 * current config and domain produce - the robots.txt the CLI generates, and
 * the origin of the sitemap's first URL - reading only small objects and the
 * head of the sitemap. Files the app owns (a robots.txt left to the build)
 * are not compared.
 */
async function warnIfStagedForAnotherOrigin(
  ctx: OpsContext,
  staged: ArtifactManifest,
  command: RepublishCommand,
): Promise<void> {
  const seo = resolveSeo(ctx, siteBaseUrl(ctx));
  const prefix = stagedReleasePrefix(staged.hash);
  const sizes = new Map(staged.files.map((file) => [file.path, file.bytes]));
  const paths = new Set(sizes.keys());
  const differs: string[] = [];
  if (seo.robots !== undefined && paths.has('robots.txt')) {
    const robots = await ctx.clients.s3.getObjectText(ctx.names.bucket, `${prefix}robots.txt`);
    if (robots !== undefined && robots !== seo.robots) differs.push('robots.txt');
  }
  const sitemapBytes = sizes.get('sitemap.xml') ?? 0;
  if (seo.sitemapBaseUrl !== undefined && sitemapBytes > 0) {
    const head = await ctx.clients.s3.getObject(ctx.names.bucket, `${prefix}sitemap.xml`, {
      range: { start: 0, end: Math.min(sitemapBytes, SITEMAP_HEAD_BYTES) - 1 },
    });
    const origin = sitemapOrigin(new TextDecoder().decode(head));
    if (origin !== undefined && origin !== new URL(seo.sitemapBaseUrl).origin) {
      differs.push(`sitemap.xml (its URLs are on ${origin})`);
    }
  }
  if (differs.length === 0) return;
  const published = command === 'promote' ? 'promoted' : 'restored';
  ctx.logger.warn(
    `${staged.hash} was staged for another origin or seo config than "${ctx.env}" has now - ` +
      `${differs.join(' and ')} ${differs.length === 1 ? 'differs' : 'differ'} from what a build ` +
      `for ${siteBaseUrl(ctx) ?? 'this environment'} would publish today. The staged bytes are ` +
      `${published} as they are; stage it again to publish them for the current origin.`,
  );
}

/**
 * Publish a staged release to `site/` with byte-for-byte checks on both
 * sides, against the one staged release record: the staged objects must still
 * match it before anything is copied, and the live objects must match it
 * afterwards. Shared by `promote` and a republishing `rollback`, so both run
 * the same checks, copy, delete, invalidation and records.
 */
async function republishStagedRelease(
  ctx: OpsContext,
  staged: ArtifactManifest,
  opts: { refresh?: boolean | undefined; via: RepublishCommand },
): Promise<Republished> {
  const before = await readLiveRelease(ctx);
  const alreadyLive =
    isSettledLiveRelease(before) &&
    before.hash === staged.hash &&
    before.releaseHash === staged.releaseHash;
  if (alreadyLive) {
    ctx.logger.step(
      `${staged.release} is already the live release - this ${opts.via} only checks site/ ` +
        'against it and repairs any difference',
    );
  }
  const manifest = await verifyStagedCopy(ctx, staged, opts.via);
  await warnIfRestaged(ctx, manifest, opts.via);
  await warnIfStagedForAnotherOrigin(ctx, manifest, opts.via).catch((err: unknown) => {
    // Only a warning hangs on it, so a failed read must not stop the publish.
    ctx.logger.warn(
      `could not compare the staged robots.txt and sitemap.xml with the current origin: ` +
        `${(err as Error).message}`,
    );
  });
  // Converge the response headers as a deploy does, before anything is
  // published, so a policy CloudFront rejects stops the publish untouched.
  await reconcileResponseHeadersOnDeploy(ctx);
  const published = await publishStagedRelease(ctx, manifest, opts);
  // And the live bytes must now be exactly those - promotion's guarantee.
  await verifyStoredRelease(ctx, manifest, LIVE_SITE_PREFIX);
  await recordLiveRelease(ctx, manifest, opts.via);
  await recordPublicationOrWarn(ctx, manifest, opts.via);
  await recordPromotion(ctx, manifest.hash);
  await warnIfOriginalDiffers(ctx, manifest, opts.via);
  if (published.copied === 0 && published.deleted === 0) {
    ctx.logger.ok(
      `site/ already held ${manifest.release}: nothing was copied, deleted or invalidated`,
    );
  }
  return { before, manifest, published };
}

/**
 * Keep the publication in the revision's record. The release is already live
 * and verified, so a failed write only loses the re-stage warning: warn.
 */
async function recordPublicationOrWarn(
  ctx: OpsContext,
  manifest: ArtifactManifest,
  command: RepublishCommand,
): Promise<void> {
  try {
    await recordPublication(ctx, manifest, command);
  } catch (err) {
    ctx.logger.warn(
      `could not record this ${command} of ${manifest.release}: ${(err as Error).message}`,
    );
  }
}

export interface PromoteOptions extends LockOptions {
  /** Copy every file, not only those whose content differs from the live object. */
  refresh?: boolean | undefined;
  /** The post-deploy plugin steps; see {@link runAfterPublish}. */
  afterDeploy: AfterDeploy;
}

/**
 * Point production at a staged release without rebuilding: check the staged
 * objects still match the recorded manifest, copy them into `site/`,
 * invalidate the changed paths, and verify the live objects match too.
 */
export async function promote(ctx: OpsContext, hash: string, opts: PromoteOptions): Promise<void> {
  assertStaticEnvironment(ctx, 'promote');
  await withEnvLock(ctx, 'promote', hash, opts, () => promoteLocked(ctx, hash, opts));
}

async function promoteLocked(ctx: OpsContext, hash: string, opts: PromoteOptions): Promise<void> {
  const startedAt = Date.now();
  // The release is bound to the manifest it was staged with, read once: both
  // checks below compare against this same record.
  const staged = await requireStagedReleaseManifest(ctx, hash);
  ctx.logger.info(colors.bold(`Promoting ${hash} to "${ctx.env}"`));
  const { before, manifest, published } = await republishStagedRelease(ctx, staged, {
    refresh: opts.refresh,
    via: 'promote',
  });
  await runAfterPublish(ctx, hash, opts.afterDeploy);

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

/**
 * A revision's staged release record, read once for a rollback: absent when
 * the hash has no staged release, or the error that made it unreadable.
 */
type StagedReleaseLookup =
  | { status: 'none' }
  | { status: 'staged'; manifest: ArtifactManifest }
  | { status: 'unreadable'; error: Error };

async function lookUpStagedRelease(ctx: OpsContext, hash: string): Promise<StagedReleaseLookup> {
  try {
    const manifest = await readStagedReleaseManifest(ctx, hash);
    return manifest ? { status: 'staged', manifest } : { status: 'none' };
  } catch (err) {
    return { status: 'unreadable', error: err as Error };
  }
}

/**
 * `rollback <hash>`'s first choice in a static environment, run holding the
 * environment lock: a hash with a staged release record is republished from
 * its stored bytes, through the same checked copy `promote` makes, and the
 * release that was live is printed beside the one restored. A record that
 * cannot be read, or a staged copy that no longer matches it, refuses with
 * nothing published - a quiet rebuild would publish bytes no review covered.
 * Resolves `not-staged` when the hash has no staged release, for the caller
 * to rebuild.
 */
export async function rollbackToStagedRelease(
  ctx: OpsContext,
  hash: string,
  opts: { refresh?: boolean | undefined } = {},
): Promise<'republished' | 'not-staged'> {
  const lookup = await lookUpStagedRelease(ctx, hash);
  if (lookup.status === 'none') return 'not-staged';
  if (lookup.status === 'unreadable') {
    throw new Error(
      `cannot republish ${hash}: its staged release record at s3://${ctx.names.bucket}/` +
        `${stagedReleaseManifestKey(hash)} is unreadable (${lookup.error.message}), so its ` +
        `staged bytes cannot be checked. Nothing was published. ` +
        stagedRecoveryHint(ctx, hash, 'rollback'),
      { cause: lookup.error },
    );
  }
  ctx.logger.step(`republishing the release staged at ${stagedReleasePrefix(hash)} (no rebuild)`);
  const { before, manifest, published } = await republishStagedRelease(ctx, lookup.manifest, {
    refresh: opts.refresh,
    via: 'rollback',
  });
  ctx.logger.info(`  previous release ${describeLiveRelease(before)}`);
  ctx.logger.info(`  restored release ${manifest.release} (sha256 ${manifest.releaseHash})`);
  ctx.logger.info(
    `  copied ${published.copied} of ${manifest.fileCount} files, deleted ${published.deleted}, ` +
      `invalidated ${describeInvalidation(published.invalidation)}`,
  );
  return 'republished';
}
