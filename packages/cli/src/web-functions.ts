/**
 * The SSR deploy contract: build-result reading, revision fingerprints, the
 * signed endpoint probes, publishing a revision, the restore path when a
 * revision is Active but never serves, and rollback from a recorded artifact.
 *
 * `commands.ts` orchestrates; this module owns the sequence. Every cloud call
 * goes through `ctx.clients`, so the whole contract is covered by transport
 * mocks - `floci` does not emulate `lambda-web`.
 */

import { createHash } from 'node:crypto';

import {
  pollUntil,
  WEB_FUNCTION_RUNTIME,
  type RawResponse,
  type SsrConfig,
  type WebFunctionBuildConfig,
  type WebFunctionRevision,
  type WebFunctionS3Object,
  type WebFunctionServiceConfig,
} from 'blogwright-core';

import type { OpsContext } from './context.js';
import {
  artifactKeys,
  invalidateChanged,
  invalidateCloudFront,
  writeManifest,
  type DeployManifest,
  type InvalidationSummary,
} from './deploy.js';
import { formatDuration } from './render.js';

/** The environment's `ssr` block, or a refusal naming what is missing. */
export function requireSsr(ctx: OpsContext): SsrConfig {
  const config = ctx.config.ssr;
  if (!config) throw new Error(`environment "${ctx.env}" has no config.ssr block`);
  return config;
}

/** What the build agent wrote to `web/results/<hash>.json`. */
export interface WebFunctionBuildResult {
  artifactKey: string;
  artifactVersionId: string;
  artifactSha256: string;
  artifactSize: number;
  staleStaticKeys: string[];
}

/** The revision-scoped settings, exactly as they are sent to the service. */
export interface RevisionSettings {
  entryPoint: string;
  env: Record<string, string>;
  timeoutSeconds: number;
  maxConcurrencyPerEnvironment: number;
}

/** How long the deploy waits for a revision to leave `Creating`. */
const REVISION_ACTIVATION_TIMEOUT_MS = 5 * 60_000;
/** How long the deploy waits for the endpoint to answer below 500. */
const READINESS_PROBE_TIMEOUT_MS = 120_000;
const PROBE_INTERVAL_MS = 5_000;
/** The tag the fingerprint is stored under in a revision's `description`. */
export const FINGERPRINT_PREFIX = 'blogwright:';

function webRoleArn(ctx: OpsContext): string {
  return String(ctx.state.resources['iam-web-role']?.arn);
}

/** The endpoint's domain from bootstrapped state. */
function endpointDomain(ctx: OpsContext): string {
  const domain = ctx.state.resources['web-function']?.endpointDomainName;
  if (typeof domain !== 'string' || domain.length === 0) {
    throw new Error(`no Web Function endpoint recorded for "${ctx.env}" - run bootstrap first`);
  }
  return domain;
}

/**
 * The revision-scoped settings as sent: the resolved environment carries
 * `NODE_ENV=production` unless `ssr.env` overrides it, and
 * `AWS_LAMBDA_NODEJS_ENTRYPOINT` whenever the entry point is not the runtime's
 * `index.js` default.
 */
export function revisionSettings(ctx: OpsContext): RevisionSettings {
  const config = requireSsr(ctx);
  const env: Record<string, string> = { NODE_ENV: 'production', ...config.env };
  if (config.entryPoint !== 'index.js') env['AWS_LAMBDA_NODEJS_ENTRYPOINT'] = config.entryPoint;
  return {
    entryPoint: config.entryPoint,
    env,
    timeoutSeconds: config.timeoutSeconds,
    maxConcurrencyPerEnvironment: config.maxConcurrencyPerEnvironment,
  };
}

/**
 * The revision fingerprint: a sha256 over the artifact digest, the runtime,
 * the execution role, the log group and the revision-scoped settings as they
 * will be sent. Two deploys with the same fingerprint produce the same
 * revision, so the second creates nothing.
 */
export function revisionFingerprint(ctx: OpsContext, artifactSha256: string): string {
  const settings = revisionSettings(ctx);
  const env = Object.fromEntries(
    Object.entries(settings.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256')
    .update(
      JSON.stringify({
        artifactSha256,
        runtime: WEB_FUNCTION_RUNTIME,
        executionRoleArn: webRoleArn(ctx),
        logGroup: ctx.names.webLogGroup,
        entryPoint: settings.entryPoint,
        env,
        timeoutSeconds: settings.timeoutSeconds,
        maxConcurrencyPerEnvironment: settings.maxConcurrencyPerEnvironment,
      }),
    )
    .digest('hex');
}

/** The fingerprint a revision was created with, from its `description`. */
function revisionFingerprintOf(revision: WebFunctionRevision): string | undefined {
  const description = revision.description;
  return description?.startsWith(FINGERPRINT_PREFIX)
    ? description.slice(FINGERPRINT_PREFIX.length)
    : undefined;
}

/** A signed GET of the endpoint root - the only evidence that a deploy serves. */
async function probeWebEndpoint(ctx: OpsContext): Promise<RawResponse> {
  return ctx.clients.signing.sendToUrl({
    url: `https://${endpointDomain(ctx)}/`,
    method: 'GET',
    service: 'lambda',
  });
}

/**
 * True for the one signal that distinguishes an authorization refusal from an
 * application answer: Lambda omits `lambda-web-error-type` when the caller may
 * not invoke the endpoint at all.
 */
export function isInvokeAuthorizationFailure(response: RawResponse): boolean {
  return response.statusCode === 403 && response.headers['lambda-web-error-type'] === undefined;
}

/**
 * The mandatory preflight, run BEFORE anything is built or published. Any
 * answer from the application passes, including the placeholder's 503; only a
 * caller that cannot invoke the endpoint at all stops here.
 */
export async function preflightWebFunction(ctx: OpsContext): Promise<void> {
  const response = await probeWebEndpoint(ctx);
  if (!isInvokeAuthorizationFailure(response)) return;
  throw new Error(
    'this caller may not invoke the Web Function endpoint: it answered HTTP 403 without an ' +
      'application error, which is how Lambda reports a denied ' +
      `lambda:InvokeWebFunctionEndpoint on ${ctx.names.webFunction}. Grant the action to the ` +
      'caller (the GitHub OIDC deploy role carries it) and retry; nothing was built or published.',
  );
}

/** Read the agent's result sidecar for a hash. */
export async function readWebBuildResult(
  ctx: OpsContext,
  hash: string,
): Promise<WebFunctionBuildResult> {
  const { resultKey } = artifactKeys(hash);
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, resultKey);
  if (!text) {
    throw new Error(
      `no SSR build result at s3://${ctx.names.bucket}/${resultKey} - the build agent did not ` +
        'package the output',
    );
  }
  const parsed = JSON.parse(text) as Partial<WebFunctionBuildResult>;
  if (!parsed.artifactKey || !parsed.artifactSha256) {
    throw new Error(`${resultKey} carries no artifact key/digest - rebuild with a current agent`);
  }
  return {
    artifactKey: parsed.artifactKey,
    artifactVersionId: parsed.artifactVersionId ?? 'null',
    artifactSha256: parsed.artifactSha256,
    artifactSize: parsed.artifactSize ?? 0,
    staleStaticKeys: parsed.staleStaticKeys ?? [],
  };
}

/**
 * The revision a `LatestRevision` endpoint routes to: the newest Active one in
 * `ListWebFunctionRevisions`, which the service orders newest first. The list
 * yields summaries only, so the revision's configuration is read back with a
 * second call - that is what a failed readiness probe restores from.
 */
async function servingRevision(ctx: OpsContext): Promise<WebFunctionRevision | undefined> {
  const summaries = await ctx.clients.lambdaWeb.listWebFunctionRevisions(ctx.names.webFunction);
  const newest = summaries.find((revision) => /^Active$/i.test(revision.state));
  if (!newest) return undefined;
  return ctx.clients.lambdaWeb.getWebFunctionRevision(ctx.names.webFunction, newest.revisionId);
}

/** Poll a revision until it leaves `Pending`, or report the state it settled in. */
async function awaitRevisionActive(
  ctx: OpsContext,
  revision: WebFunctionRevision,
): Promise<WebFunctionRevision> {
  const settled = await pollUntil(
    () => ctx.clients.lambdaWeb.getWebFunctionRevision(ctx.names.webFunction, revision.revisionId),
    (current) => Boolean(current) && !/^Pending$/i.test(current?.state ?? ''),
    { intervalMs: 5_000, timeoutMs: REVISION_ACTIVATION_TIMEOUT_MS },
  );
  return settled ?? revision;
}

/** The revision's errors, as one readable line, each naming its attribute. */
function revisionErrors(revision: WebFunctionRevision): string {
  if (revision.errors.length === 0) {
    return `revision state is ${revision.state}${revision.stateReason ? ` (${revision.stateReason})` : ''}`;
  }
  return revision.errors
    .map((error) =>
      [error.attribute, [error.errorCode, error.errorMessage].filter(Boolean).join(': ')]
        .filter(Boolean)
        .join(' '),
    )
    .join('; ');
}

/**
 * Wait for the endpoint to answer below 500; anything else retries. The
 * pacing is a parameter so tests can pin a retry boundary without waiting out
 * the production window.
 */
export interface ProbePacing {
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
}

async function waitForServing(ctx: OpsContext, pacing: ProbePacing = {}): Promise<boolean> {
  // The endpoint has already cut over when this runs, so a probe that throws (a
  // reset connection, a DNS miss) is one more "not serving yet" answer: letting
  // it escape would skip the restore and leave the outcome unrecorded.
  const serving = (response: RawResponse | undefined): boolean =>
    response !== undefined && response.statusCode < 500;
  let warned = false;
  const response = await pollUntil(
    () =>
      probeWebEndpoint(ctx).catch((err: unknown) => {
        if (!warned) {
          ctx.logger.warn(`readiness probe did not reach the endpoint: ${(err as Error).message}`);
          warned = true;
        }
        return undefined;
      }),
    serving,
    {
      intervalMs: pacing.intervalMs ?? PROBE_INTERVAL_MS,
      timeoutMs: pacing.timeoutMs ?? READINESS_PROBE_TIMEOUT_MS,
    },
  );
  return serving(response);
}

/** Remove the site keys the agent left behind, once a revision is verified. */
async function deleteStaleKeys(ctx: OpsContext, keys: string[]): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    // Only live site objects: the agent computes these under site/ and a
    // malformed result file must not be able to delete anything else.
    if (!key.startsWith('site/')) continue;
    await ctx.clients.s3.deleteObject(ctx.names.bucket, key);
    deleted += 1;
  }
  if (deleted > 0) ctx.logger.ok(`removed ${deleted} stale site object(s)`);
  return deleted;
}

/** Invalidate everything a new revision may have changed. */
async function invalidateAll(ctx: OpsContext): Promise<InvalidationSummary> {
  await invalidateCloudFront(ctx, ['/*']);
  return { mode: 'all', count: 0 };
}

/**
 * Where a publish in flight is noted, per fingerprint. The note is written
 * before the revision is created and removed once the cache is invalidated and
 * the manifest recorded. A later deploy that finds the fingerprint already
 * serving reads it to tell a finished publish from one that stopped between
 * the cutover and the invalidation - which the fingerprint alone cannot say,
 * and which would otherwise leave the previous revision's pages cached.
 */
function publishingKey(fingerprint: string): string {
  return `web/publishing/${fingerprint}.json`;
}

async function markPublishing(
  ctx: OpsContext,
  source: ManifestSource,
  fingerprint: string,
): Promise<void> {
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    publishingKey(fingerprint),
    JSON.stringify({ hash: source.hash, startedAt: source.startedAt.toISOString() }),
    'application/json',
  );
}

async function publishUnfinished(ctx: OpsContext, fingerprint: string): Promise<boolean> {
  return Boolean(await ctx.clients.s3.getObjectText(ctx.names.bucket, publishingKey(fingerprint)));
}

/** Best-effort: a note left behind costs one extra probe and `/*`, never correctness. */
async function clearPublishing(ctx: OpsContext, fingerprint: string): Promise<void> {
  await ctx.clients.s3
    .deleteObject(ctx.names.bucket, publishingKey(fingerprint))
    .catch(() => undefined);
}

/** The manifest's `webFunction` block, written only for a serving revision. */
export interface WebFunctionManifest {
  revisionId: string;
  revisionArn: string;
  fingerprint: string;
  artifactKey: string;
  artifactVersionId: string;
  artifactSha256: string;
  settings: RevisionSettings;
  endpointName: string;
  endpointDomainName: string;
}

function webFunctionBlock(
  ctx: OpsContext,
  revision: WebFunctionRevision,
  fingerprint: string,
  artifact: { artifactKey: string; artifactVersionId: string; artifactSha256: string },
): WebFunctionManifest {
  const pinned = revision.buildConfig?.codeConfig.s3Object;
  return {
    revisionId: revision.revisionId,
    revisionArn: revision.revisionArn,
    fingerprint,
    // A revision pins its own artifact version, which the service echoes back
    // in its buildConfig; that pin is what rollback must reproduce, not a
    // version this build uploaded for a revision it never created.
    artifactKey: pinned?.key ?? artifact.artifactKey,
    artifactVersionId: pinned?.versionId ?? artifact.artifactVersionId,
    artifactSha256: artifact.artifactSha256,
    settings: revisionSettings(ctx),
    endpointName: String(ctx.state.resources['web-function']?.endpointName ?? 'site'),
    endpointDomainName: String(ctx.state.resources['web-function']?.endpointDomainName ?? ''),
  };
}

/** Timing/identity a manifest needs, independent of whether a build ran. */
export interface ManifestSource {
  hash: string;
  sourceKey: string;
  startedAt: Date;
  microvmId: string;
}

/**
 * Record an outcome. The manifest is written only when the outcome is known,
 * and a failed one keeps the hash's last verified `webFunction` block.
 */
export async function recordManifest(
  ctx: OpsContext,
  source: ManifestSource,
  status: 'succeeded' | 'failed',
  webFunction?: WebFunctionManifest,
  message?: string,
): Promise<DeployManifest> {
  const finishedAt = new Date();
  const manifest: DeployManifest = {
    hash: source.hash,
    sourceKey: source.sourceKey,
    status,
    startedAt: source.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - source.startedAt.getTime(),
    microvmId: source.microvmId,
    ...(message ? { message } : {}),
    ...(webFunction ? { webFunction } : {}),
  };
  return writeManifest(ctx, manifest, { ssr: true });
}

/**
 * The build and service configuration a revision is created with. The entry
 * point travels as `AWS_LAMBDA_NODEJS_ENTRYPOINT` inside `environmentVariables`
 * (the API has no entry-point field), which is why config rejects that name.
 */
function revisionConfig(
  ctx: OpsContext,
  s3Object: WebFunctionS3Object,
): { buildConfig: WebFunctionBuildConfig; serviceConfig: WebFunctionServiceConfig } {
  const settings = revisionSettings(ctx);
  return {
    buildConfig: {
      codeConfig: { s3Object },
      runtimeConfig: { runtime: WEB_FUNCTION_RUNTIME },
    },
    serviceConfig: {
      executionRoleArn: webRoleArn(ctx),
      timeoutSeconds: settings.timeoutSeconds,
      maxConcurrencyPerEnvironment: settings.maxConcurrencyPerEnvironment,
      environmentVariables: settings.env,
      telemetryConfig: { loggingConfig: { logGroup: ctx.names.webLogGroup } },
    },
  };
}

/** Create a revision carrying the settings this deploy resolved. */
async function createRevision(
  ctx: OpsContext,
  s3Object: WebFunctionS3Object,
  fingerprint: string,
): Promise<WebFunctionRevision> {
  return ctx.clients.lambdaWeb.createWebFunctionRevision({
    functionName: ctx.names.webFunction,
    description: `${FINGERPRINT_PREFIX}${fingerprint}`,
    ...revisionConfig(ctx, s3Object),
  });
}

/**
 * Re-create a captured revision from its own config. A `LatestRevision`
 * endpoint has already cut over by the time a probe runs, so this is how a
 * deploy that cannot verify its revision puts service back. The request
 * carries the captured configuration verbatim - it is what the service
 * returned, so it is what the service accepts - with the current settings
 * filling anything the capture lacks.
 */
async function restoreRevision(
  ctx: OpsContext,
  previous: WebFunctionRevision,
  fallbackS3Object: WebFunctionS3Object,
  pacing: ProbePacing,
): Promise<WebFunctionRevision | undefined> {
  const captured = revisionConfig(ctx, fallbackS3Object);
  const revision = await ctx.clients.lambdaWeb.createWebFunctionRevision({
    functionName: ctx.names.webFunction,
    ...(previous.description !== undefined ? { description: previous.description } : {}),
    buildConfig: previous.buildConfig ?? captured.buildConfig,
    serviceConfig: previous.serviceConfig ?? captured.serviceConfig,
  });
  const settled = await awaitRevisionActive(ctx, revision);
  if (!/^Active$/i.test(settled.state)) return undefined;
  return (await waitForServing(ctx, pacing)) ? settled : undefined;
}

/** The newest manifest that carries a `webFunction` block, for rollback advice. */
async function newestWebFunctionHash(ctx: OpsContext): Promise<string | undefined> {
  const objects = await ctx.clients.s3.listObjects(ctx.names.bucket, 'build/manifests/');
  const manifests: DeployManifest[] = [];
  for (const object of objects) {
    const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, object.key);
    if (!text) continue;
    try {
      manifests.push(JSON.parse(text) as DeployManifest);
    } catch {
      // One corrupt manifest must not hide the good ones.
    }
  }
  manifests.sort((a, b) =>
    a.finishedAt > b.finishedAt ? -1 : a.finishedAt < b.finishedAt ? 1 : 0,
  );
  return manifests.find((manifest) => manifest.webFunction)?.hash;
}

/** What to run when nothing serves and nothing was captured to restore from. */
async function rollbackAdvice(ctx: OpsContext): Promise<string> {
  const target = await newestWebFunctionHash(ctx);
  return (
    `Run \`blogwright rollback ${target ?? '<hash>'} ${ctx.env}\` with the newest hash ` +
    `whose manifest carries a webFunction block (see \`blogwright history\`). ` +
    `Logs: ${ctx.names.webLogGroup}`
  );
}

export interface PublishOutcome {
  manifest: DeployManifest;
  /** False when the fingerprint already served and no revision was created. */
  created: boolean;
  revisionId: string;
  invalidation: InvalidationSummary;
  staleKeysDeleted: number;
}

/**
 * Publish a revision for a finished build: compare fingerprints, capture what
 * is serving, create and verify, restore on a failed readiness probe, and only
 * then touch the cache and the stale site keys.
 */
export async function publishWebRevision(
  ctx: OpsContext,
  source: ManifestSource,
  result: WebFunctionBuildResult,
  pacing: ProbePacing = {},
): Promise<PublishOutcome> {
  const fingerprint = revisionFingerprint(ctx, result.artifactSha256);
  const serving = await servingRevision(ctx);

  // What follows a revision that is verified to serve: only now are the cache
  // and the stale site keys touched, and only then is the publish noted done.
  const complete = async (
    revision: WebFunctionRevision,
    created: boolean,
  ): Promise<PublishOutcome> => {
    const invalidation = await invalidateAll(ctx);
    const staleKeysDeleted = await deleteStaleKeys(ctx, result.staleStaticKeys);
    const manifest = await recordManifest(
      ctx,
      source,
      'succeeded',
      webFunctionBlock(ctx, revision, fingerprint, result),
    );
    await clearPublishing(ctx, fingerprint);
    ctx.logger.ok(`revision ${revision.revisionId} is serving`);
    return { manifest, created, revisionId: revision.revisionId, invalidation, staleKeysDeleted };
  };

  if (serving && revisionFingerprintOf(serving) === fingerprint) {
    if (await publishUnfinished(ctx, fingerprint)) {
      // An earlier publish created this revision and stopped before the cache
      // was invalidated, so it is finished here rather than read as unchanged:
      // the revision was never verified and the old pages are still cached.
      ctx.logger.warn(
        `revision ${serving.revisionId} matches this deploy, but the publish that created it ` +
          'never finished - verifying it and invalidating before it is recorded',
      );
      if (await waitForServing(ctx, pacing)) return complete(serving, false);
      await recordManifest(
        ctx,
        source,
        'failed',
        undefined,
        `revision ${serving.revisionId} did not serve within ` +
          `${formatDuration(READINESS_PROBE_TIMEOUT_MS)}`,
      );
      throw new Error(
        `Web Function revision ${serving.revisionId} is Active but did not serve within ` +
          `${formatDuration(READINESS_PROBE_TIMEOUT_MS)}, and the revision it replaced was ` +
          `not captured, so the endpoint is NOT serving. ${await rollbackAdvice(ctx)}`,
      );
    }
    ctx.logger.ok(`revision ${serving.revisionId} already matches this deploy - nothing to create`);
    // No new revision, so the invalidation is limited to the static assets this
    // build actually changed; `invalidationMaxPaths` applies here and nowhere else.
    const invalidation = await invalidateChanged(ctx, source.hash);
    const staleKeysDeleted = await deleteStaleKeys(ctx, result.staleStaticKeys);
    const manifest = await recordManifest(
      ctx,
      source,
      'succeeded',
      webFunctionBlock(ctx, serving, fingerprint, result),
    );
    return {
      manifest,
      created: false,
      revisionId: serving.revisionId,
      invalidation,
      staleKeysDeleted,
    };
  }

  const previous = serving;
  ctx.logger.step(`creating Web Function revision (fingerprint ${fingerprint.slice(0, 12)}…)`);
  const builtS3Object: WebFunctionS3Object = {
    bucket: ctx.names.bucket,
    key: result.artifactKey,
    versionId: result.artifactVersionId,
  };
  await markPublishing(ctx, source, fingerprint);
  const created = await createRevision(ctx, builtS3Object, fingerprint);
  const settled = await awaitRevisionActive(ctx, created);
  if (!/^Active$/i.test(settled.state)) {
    const reason = revisionErrors(settled);
    await recordManifest(
      ctx,
      source,
      'failed',
      undefined,
      `revision ${settled.revisionId} failed: ${reason}`,
    );
    // A Failed revision never took traffic, so there is nothing left to finish.
    await clearPublishing(ctx, fingerprint);
    throw new Error(
      `Web Function revision ${settled.revisionId} failed (${reason}). ` +
        `${
          previous
            ? `The previous revision ${previous.revisionId} keeps serving`
            : 'No revision is serving'
        }; nothing was invalidated. Logs: ${ctx.names.webLogGroup}`,
    );
  }

  if (await waitForServing(ctx, pacing)) return complete(settled, true);

  // The readiness probe did not pass. The endpoint has already cut over, so
  // restore service from the captured revision rather than leave a dead one
  // behind it - and leave the cache and the stale keys untouched, so whatever
  // is still cached keeps serving.
  const restored = previous
    ? await restoreRevision(ctx, previous, builtS3Object, pacing)
    : undefined;
  const restoreNote = restored
    ? `restored revision ${restored.revisionId} from its captured configuration`
    : 'the restore revision did not serve either, so the endpoint is NOT serving';
  await recordManifest(
    ctx,
    source,
    'failed',
    undefined,
    `revision ${settled.revisionId} did not serve within ` +
      `${formatDuration(READINESS_PROBE_TIMEOUT_MS)}; ${restoreNote}`,
  );
  // Restored, the rejected revision no longer serves and has nothing to finish.
  // Not restored, it is what the endpoint routes to: the note stays, so a retry
  // verifies it instead of reading it as an unchanged, finished publish.
  if (restored) await clearPublishing(ctx, fingerprint);
  const advice = restored
    ? 'The cache was not invalidated and no stale site keys were deleted, so cached pages keep ' +
      `serving. Logs: ${ctx.names.webLogGroup}`
    : await rollbackAdvice(ctx);
  throw new Error(
    `Web Function revision ${settled.revisionId} is Active but did not serve within ` +
      `${formatDuration(READINESS_PROBE_TIMEOUT_MS)}; ${restoreNote}. ${advice}`,
  );
}

/**
 * Rollback's artifact path: reproduce a recorded revision from the artifact
 * version and settings in that hash's manifest, without a rebuild. Skips
 * creation when the recorded fingerprint is already what serves, and probes
 * and invalidates exactly as a deploy does.
 */
export async function publishRecordedRevision(
  ctx: OpsContext,
  source: ManifestSource,
  recorded: WebFunctionManifest,
  pacing: ProbePacing = {},
): Promise<PublishOutcome> {
  const serving = await servingRevision(ctx);
  if (serving && revisionFingerprintOf(serving) === recorded.fingerprint) {
    ctx.logger.ok(
      `revision ${serving.revisionId} already matches ${source.hash} - nothing to create`,
    );
    const invalidation = await invalidateAll(ctx);
    // The serving revision may be a later re-creation of the recorded one (a
    // restore, an earlier rollback), so the manifest names what serves now.
    const manifest = await recordManifest(ctx, source, 'succeeded', {
      ...recorded,
      revisionId: serving.revisionId,
      revisionArn: serving.revisionArn,
    });
    await clearPublishing(ctx, recorded.fingerprint);
    return {
      manifest,
      created: false,
      revisionId: serving.revisionId,
      invalidation,
      staleKeysDeleted: 0,
    };
  }

  const previous = serving;
  const recordedS3Object: WebFunctionS3Object = {
    bucket: ctx.names.bucket,
    key: recorded.artifactKey,
    versionId: recorded.artifactVersionId,
  };
  ctx.logger.step(`creating revision from ${source.hash}'s recorded settings`);
  // Noted like a deploy's publish: a deploy of the same fingerprint that follows
  // an interrupted rollback must not read this revision as finished.
  await markPublishing(ctx, source, recorded.fingerprint);
  const created = await ctx.clients.lambdaWeb.createWebFunctionRevision({
    functionName: ctx.names.webFunction,
    description: `${FINGERPRINT_PREFIX}${recorded.fingerprint}`,
    buildConfig: {
      codeConfig: { s3Object: recordedS3Object },
      runtimeConfig: { runtime: WEB_FUNCTION_RUNTIME },
    },
    serviceConfig: {
      executionRoleArn: webRoleArn(ctx),
      timeoutSeconds: recorded.settings.timeoutSeconds,
      maxConcurrencyPerEnvironment: recorded.settings.maxConcurrencyPerEnvironment,
      environmentVariables: recorded.settings.env,
      telemetryConfig: { loggingConfig: { logGroup: ctx.names.webLogGroup } },
    },
  });
  const settled = await awaitRevisionActive(ctx, created);
  if (!/^Active$/i.test(settled.state)) {
    const reason = revisionErrors(settled);
    await recordManifest(
      ctx,
      source,
      'failed',
      undefined,
      `rollback revision ${settled.revisionId} failed: ${reason}`,
    );
    await clearPublishing(ctx, recorded.fingerprint);
    throw new Error(
      `rollback revision ${settled.revisionId} failed (${reason}); ` +
        `${
          previous ? `revision ${previous.revisionId} keeps serving` : 'no revision is serving'
        }. Logs: ${ctx.names.webLogGroup}`,
    );
  }
  if (!(await waitForServing(ctx, pacing))) {
    const restored = previous
      ? await restoreRevision(ctx, previous, recordedS3Object, pacing)
      : undefined;
    await recordManifest(
      ctx,
      source,
      'failed',
      undefined,
      `rollback revision ${settled.revisionId} did not serve`,
    );
    if (restored) await clearPublishing(ctx, recorded.fingerprint);
    throw new Error(
      `rollback revision ${settled.revisionId} is Active but did not serve` +
        (restored ? `; restored revision ${restored.revisionId}` : ' and no restore was possible') +
        `. Logs: ${ctx.names.webLogGroup}`,
    );
  }
  const invalidation = await invalidateAll(ctx);
  const manifest = await recordManifest(ctx, source, 'succeeded', {
    ...recorded,
    revisionId: settled.revisionId,
    revisionArn: settled.revisionArn,
  });
  await clearPublishing(ctx, recorded.fingerprint);
  ctx.logger.ok(`revision ${settled.revisionId} is serving`);
  return {
    manifest,
    created: true,
    revisionId: settled.revisionId,
    invalidation,
    staleKeysDeleted: 0,
  };
}

/**
 * `seo` is inert in SSR mode - the application owns robots.txt and
 * sitemap.xml - so a written, non-`off` value warns once per deploy. The check
 * reads the RAW config document: the merged defaults are `auto`, so reading
 * the merged config would warn on every SSR deploy.
 */
export function warnAboutSsrSeo(ctx: OpsContext): void {
  const raw = ctx.configDocument['seo'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
  const written = raw as Record<string, unknown>;
  const inert = Object.entries(written).some(([key, value]) => {
    if (value === undefined) return false;
    if (key === 'robots' || key === 'sitemap') return value !== 'off';
    return true;
  });
  if (!inert) return;
  ctx.logger.warn(
    'config.seo is inert in SSR mode: the application owns the robots.txt and sitemap.xml routes',
  );
}

/** Refuse a preview command on an environment that configures SSR. */
export function assertNotSsrForPreviews(ctx: OpsContext): void {
  if (!ctx.config.ssr) return;
  throw new Error(
    `the preview stack does not support SSR ("${ctx.env}" sets config.ssr): an SSR preview ` +
      'needs its own endpoint, which is a separate design. Remove the ssr block from the ' +
      'preview config, or preview a static branch.',
  );
}
