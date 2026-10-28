import { randomUUID } from 'node:crypto';

import {
  AwsError,
  entryShim,
  networkConnectors,
  pollUntil,
  sleep,
  type EntryShim,
  type LogEvent,
  type Microvm,
  type RunMicrovmInput,
} from 'blogwright-core';

import {
  cacheControlRefreshReason,
  describeCacheControlRefresh,
  markCacheControlUnconfirmed,
  recordCacheControl,
} from './cache-control.js';
import type { OpsContext } from './context.js';
import type { WebFunctionManifest } from './web-functions.js';
import { formatDuration, spinnerFrame } from './render.js';
import { resolveSeo } from './seo.js';

export interface DeployManifest {
  hash: string;
  sourceKey: string;
  status: 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  microvmId: string;
  message?: string;
  /**
   * The last revision verified for this hash (or found already serving).
   * Rollback reads it to reproduce the revision a hash is pinned to. A
   * `failed` manifest carries it only when an earlier outcome for the same
   * hash was verified - see {@link writeManifest}.
   */
  webFunction?: WebFunctionManifest;
}

/** Read one hash's deployment manifest, or undefined when there is none. */
export async function readManifest(
  ctx: OpsContext,
  hash: string,
): Promise<DeployManifest | undefined> {
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, manifestKey(hash));
  if (!text) return undefined;
  try {
    return JSON.parse(text) as DeployManifest;
  } catch {
    return undefined;
  }
}

/**
 * Write a hash's manifest and return what was written. In SSR mode a `failed`
 * outcome keeps the `webFunction` block the hash's manifest already carried:
 * that block is the only record of the artifact version and settings a
 * verified revision was created with, and a failed redeploy or rollback of the
 * same hash must not erase what `rollback` reproduces it from.
 */
export async function writeManifest(
  ctx: OpsContext,
  manifest: DeployManifest,
  opts: { ssr?: boolean | undefined } = {},
): Promise<DeployManifest> {
  let record = manifest;
  if (opts.ssr && manifest.status === 'failed' && !manifest.webFunction) {
    const verified = (await readManifest(ctx, manifest.hash))?.webFunction;
    if (verified) record = { ...manifest, webFunction: verified };
  }
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    manifestKey(manifest.hash),
    JSON.stringify(record, null, 2),
    'application/json',
  );
  return record;
}

/** Artifact and result keys for one deploy hash. */
export function artifactKeys(hash: string): { artifactKey: string; resultKey: string } {
  return { artifactKey: `web/artifacts/${hash}.zip`, resultKey: `web/results/${hash}.json` };
}

/**
 * The pending-job half of an SSR build: what to package, what to call the
 * artifact, and where the agent writes the result the CLI's publish step reads.
 */
export interface WebFunctionJob {
  packageDir: string;
  entryPoint: string;
  /** The generated entry shim the agent adds to the package, when `ssr.shim` is set. */
  shim?: EntryShim | undefined;
  staticDir?: string | undefined;
  artifactKey: string;
  resultKey: string;
}

/** The SSR packaging job for a hash, from the environment's `ssr` block. */
export function webFunctionJob(ctx: OpsContext, hash: string): WebFunctionJob {
  const ssr = ctx.config.ssr;
  if (!ssr) throw new Error(`environment "${ctx.env}" has no config.ssr block`);
  const { artifactKey, resultKey } = artifactKeys(hash);
  const shim = entryShim(ssr);
  return {
    packageDir: ssr.packageDir,
    entryPoint: ssr.entryPoint,
    ...(shim !== undefined ? { shim } : {}),
    ...(ssr.staticDir !== undefined ? { staticDir: ssr.staticDir } : {}),
    artifactKey,
    resultKey,
  };
}

/** Terminal outcome the log poller extracts from the agent's build markers. */
export interface AgentStatus {
  state: 'idle' | 'building' | 'done' | 'failed';
  message?: string | undefined;
}

function manifestKey(hash: string): string {
  return `build/manifests/${hash}.json`;
}

/**
 * The agent's changed-paths manifest: the paths to invalidate, the rules it
 * wrote, and (by appearing) the build's completion signal.
 */
function changedManifestKey(hash: string): string {
  return `build/changed/${hash}.json`;
}

/**
 * Nudge the MicroVM's endpoint to wake its event loop. A Firecracker-resumed process
 * can sit idle with its poll timer pending until some I/O arrives; a connection here -
 * even one the agent's HTTP/1 server can't fully parse - wakes the loop so the timer
 * fires and the build starts. The wake-up, not the response, is the point: a missing
 * endpoint or token means nothing to nudge, and a rejecting ping never fails the poll.
 */
async function nudge(ctx: OpsContext, endpoint: string, token: string): Promise<void> {
  if (!endpoint || !token) return;
  await ctx.ports.ping(endpoint, token).catch(() => undefined);
}

/** Backoff between MicroVM-launch retries; the total window (~2m) bounds the wait. */
const RUN_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

function isGatewayError(err: unknown): boolean {
  return (
    err instanceof AwsError &&
    (err.statusCode === 502 || err.statusCode === 503 || err.statusCode === 504)
  );
}

/**
 * Launch the builder MicroVM, retrying gateway errors (502/503/504) with a
 * bounded backoff. The control plane can answer 502 for a short window right
 * after the builder image was updated (fresh agent hash) - an
 * eventual-consistency gap that would otherwise fail every consumer's first
 * deploy after a blogwright upgrade. Retrying is safe: the input's client
 * token makes the launch idempotent. Exported for tests.
 */
export async function runMicrovmWithRetry(
  ctx: OpsContext,
  input: RunMicrovmInput,
  delaysMs: readonly number[] = RUN_RETRY_DELAYS_MS,
): Promise<Microvm> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ctx.clients.microvms.runMicrovm(input);
    } catch (err) {
      const delay = delaysMs[attempt];
      if (!isGatewayError(err) || delay === undefined) throw err;
      ctx.logger.warn(
        `MicroVM launch returned HTTP ${(err as AwsError).statusCode} - ` +
          `retrying in ${Math.round(delay / 1000)}s (a just-updated builder image can lag)`,
      );
      await sleep(delay);
    }
  }
}

/**
 * Resolve the MicroVM build log group from bootstrapped state rather than re-deriving it.
 * The image and the build-role IAM policy bake this name in at bootstrap, so if the derived
 * name (`ctx.names.microvmLogGroup`) is renamed in code later, a deploy must still target
 * the group the running stack actually logs to - otherwise the VM's logs land in (or are
 * denied to) a different group and `pollBuild` waits on an empty one.
 */
export function microvmLogGroup(ctx: OpsContext): string {
  const recorded = ctx.state.resources['microvm-image']?.logGroup;
  if (typeof recorded === 'string' && recorded) return recorded;
  const arn = ctx.state.resources['microvm-log-group']?.arn;
  if (typeof arn === 'string') {
    // arn:aws:logs:<region>:<acct>:log-group:<name>:*
    const name = arn.split(':log-group:')[1]?.replace(/:\*$/, '');
    if (name) return name;
  }
  return ctx.names.microvmLogGroup;
}

/**
 * Poll the CloudWatch build log group for the agent's output, streaming new lines and
 * detecting the terminal marker (the source of truth). Each cycle also nudges the VM
 * endpoint to keep the agent's event loop alive so the build triggers reliably.
 * Exported for tests.
 */
export async function pollBuild(
  ctx: OpsContext,
  hash: string,
  startTime: number,
  endpoint: string,
  token: string,
): Promise<AgentStatus> {
  const seen = new Set<string>();
  // Anchored at VM launch (startTime), like the VM's own maximumDuration -
  // anchoring at poll start would keep polling a VM that is already dead for
  // however long the RUNNING-wait consumed. One grace minute for log delivery.
  const deadline = startTime + ctx.config.microvm.maxDurationSeconds * 1000 + 60_000;
  const { terminal } = ctx.ports;
  let tick = 0;

  try {
    for (;;) {
      terminal.status(
        `${spinnerFrame(tick++)} building ${hash} in MicroVM … ${formatDuration(Date.now() - startTime)}`,
      );
      await nudge(ctx, endpoint, token);
      const events = await ctx.clients.logs
        .filterEvents(microvmLogGroup(ctx), { startTime })
        .catch(() => [] as LogEvent[]);
      events.sort((a, b) => a.timestamp - b.timestamp);

      let result: AgentStatus | undefined;
      for (const e of events) {
        if (seen.has(e.eventId)) continue;
        seen.add(e.eventId);
        ctx.logger.info(`  ${e.message.trimEnd()}`);
        // Hash-scoped structured markers so unrelated log lines (raw pnpm/astro output, or
        // an orphaned VM from a different deploy) can't be mistaken for this build's result.
        if (e.message.includes(`##build:done:${hash}`)) result = { state: 'done' };
        else if (e.message.includes(`##build:failed:${hash}`)) {
          result = {
            state: 'failed',
            message: e.message.split(`##build:failed:${hash}:`)[1]?.trim(),
          };
        }
      }
      if (result) return result;
      // Log delivery can lag or drop (e.g. the VM logging to a group the deploy isn't tailing).
      // The agent writes build/changed/<hash>.json as its final step, so treat that artifact as
      // an authoritative completion signal too - a successful build then can't hang until the
      // deadline just because its logs never reached CloudWatch. runBuild clears any stale copy
      // before launch, so its presence means *this* build finished.
      if (await ctx.clients.s3.objectExists(ctx.names.bucket, changedManifestKey(hash))) {
        return { state: 'done' };
      }
      if (Date.now() >= deadline) return { state: 'failed', message: 'build timed out' };
      await sleep(3000);
    }
  } finally {
    terminal.status('');
  }
}

/**
 * Run the builder MicroVM against a source zip already present at `sourceKey`, stream
 * its logs, terminate it, and record a deployment manifest. Shared by deploy + rollback.
 */
export async function runBuild(
  ctx: OpsContext,
  opts: {
    hash: string;
    sourceKey: string;
    sitePrefix?: string;
    target?: string;
    /** Canonical origin the site is served from, for robots.txt/sitemap.xml. */
    baseUrl?: string | undefined;
    /** S3 object tags for the synced site files; defaults to the stack tags. */
    objectTags?: Record<string, string> | undefined;
    /**
     * Re-upload every file, so metadata-only fixes (content type, tags,
     * Cache-Control) land. Implied when the `cacheControl` rules changed.
     */
    refresh?: boolean | undefined;
    /**
     * Package the output as a Lambda Web Function revision artifact. When set,
     * the manifest is left to the publish step: the build outcome alone is not
     * the deploy outcome.
     */
    webFunction?: WebFunctionJob | undefined;
  },
): Promise<DeployManifest> {
  const sitePrefix = opts.sitePrefix ?? 'site/';
  // robots.txt/sitemap.xml are the application's routes in SSR mode, so no SEO
  // payload is sent (and the agent writes none).
  const seo = opts.webFunction ? {} : resolveSeo(ctx, opts.baseUrl);
  const target = opts.target ?? 'site';
  const pendingKey = `build/pending/${target}.json`;
  const imageArn = ctx.state.resources['microvm-image']?.arn;
  const execRoleArn = ctx.state.resources['iam-exec-role']?.arn;
  if (typeof imageArn !== 'string' || typeof execRoleArn !== 'string') {
    throw new Error(
      'infrastructure not bootstrapped (missing MicroVM image or exec role); run bootstrap first',
    );
  }

  // Clear any stale completion manifest from a prior aborted build of this same hash, so its
  // reappearance is an unambiguous "this build finished" signal for pollBuild's S3 fallback.
  await ctx.clients.s3
    .deleteObject(ctx.names.bucket, changedManifestKey(opts.hash))
    .catch(() => undefined);

  // Checked even under an explicit --refresh: a build that changes the rules
  // must mark the record first, whatever asked for the re-upload.
  const rulesRefresh = await cacheControlRefreshReason(ctx, target);
  if (rulesRefresh !== undefined) {
    const implicit = opts.refresh === true ? '' : ' (an implicit --refresh)';
    ctx.logger.step(`${describeCacheControlRefresh(rulesRefresh)}${implicit}`);
    await markCacheControlUnconfirmed(ctx, target);
  }
  const refresh = opts.refresh === true || rulesRefresh !== undefined;
  const connectors = networkConnectors(ctx.config.region);
  const startedAt = new Date();
  ctx.logger.step(`running builder MicroVM for ${opts.hash}`);

  // Launch first: if runMicrovm throws, no pending.json is left behind (a leaked job
  // could otherwise be picked up during a later image bake and poison the snapshot).
  // A MicroVM is ephemeral compute, so the client token is unique per launch - keying it
  // on the hash would make a re-deploy (or workflow re-run) of the same source idempotently
  // return the ALREADY-TERMINATED original VM instead of launching a fresh one. Generated
  // once here so a network retry of this single call still dedupes.
  const clientToken = `run-${opts.hash}-${randomUUID()}`;
  const run = await runMicrovmWithRetry(ctx, {
    imageIdentifier: imageArn,
    executionRoleArn: execRoleArn,
    clientToken,
    maximumDurationInSeconds: ctx.config.microvm.maxDurationSeconds,
    idlePolicy: ctx.config.microvm.idle,
    ingressNetworkConnectors: [connectors.allIngress],
    egressNetworkConnectors: [connectors.internetEgress],
    logGroupName: microvmLogGroup(ctx),
  });

  let result: AgentStatus = { state: 'failed', message: 'did not start' };
  try {
    // The agent (booting ~30s) polls this for the job; write it now that the VM exists.
    await ctx.clients.s3.putObject(
      ctx.names.bucket,
      pendingKey,
      JSON.stringify({
        hash: opts.hash,
        sourceKey: opts.sourceKey,
        sitePrefix,
        // Repo-relative build cwd and output dir (config paths.app/paths.dist);
        // older agents ignore unknown fields and use their root/dist defaults.
        appDir: ctx.config.paths.app,
        distDir: ctx.config.paths.dist,
        objectTags: opts.objectTags ?? ctx.tags,
        cacheControl: ctx.config.cacheControl,
        ...(refresh ? { refresh: true } : {}),
        ...(opts.webFunction ? { webFunction: opts.webFunction } : {}),
        ...seo,
      }),
      'application/json',
    );
    // Confirm the MicroVM actually reached RUNNING (a FAILED launch must not fall through
    // to the build poll, which would otherwise wait out the full maxDuration).
    const ready = await pollUntil(
      () => ctx.clients.microvms.getMicrovm(run.microvmId),
      (vm) => Boolean(vm) && /RUNNING|FAILED|TERMINATED/i.test(vm?.state ?? ''),
      { intervalMs: 3000, timeoutMs: 300_000 },
    );
    if (!ready || !/RUNNING/i.test(ready.state)) {
      throw new Error(`MicroVM did not reach RUNNING (state=${ready?.state ?? 'unknown'})`);
    }
    // Nudge the endpoint each cycle to keep the agent's event loop awake; the token must
    // outlive the build window.
    const endpoint = run.endpoint || ready.endpoint || '';
    const tokenMinutes = Math.min(60, Math.ceil(ctx.config.microvm.maxDurationSeconds / 60) + 1);
    const token = await ctx.clients.microvms
      .createAuthToken(run.microvmId, tokenMinutes)
      .catch(() => '');
    result = await pollBuild(ctx, opts.hash, startedAt.getTime(), endpoint, token);
  } finally {
    // The pending-job cleanup must survive a terminate failure: a leaked
    // pending.json is the poison-the-next-image-bake hazard the launch
    // ordering above exists to avoid. A failed terminate is only logged -
    // the VM self-terminates at maxDuration, and the build outcome (already
    // determined) must not be masked by a cleanup error.
    await ctx.clients.microvms.terminateMicrovm(run.microvmId).catch((err: unknown) => {
      ctx.logger.warn(
        `failed to terminate MicroVM ${run.microvmId} (it will expire on its own): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    });
    // Clear the job so a future MicroVM does not re-run it.
    await ctx.clients.s3.deleteObject(ctx.names.bucket, pendingKey).catch(() => undefined);
  }

  const finishedAt = new Date();
  const manifest: DeployManifest = {
    hash: opts.hash,
    sourceKey: opts.sourceKey,
    status: result.state === 'done' ? 'succeeded' : 'failed',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    microvmId: run.microvmId,
    ...(result.message ? { message: result.message } : {}),
  };
  // In SSR mode a successful build is NOT yet a successful deploy: the publish
  // step writes the manifest once the revision outcome is known. A failed build
  // has no revision to wait for, so it is recorded here.
  if (manifest.status === 'failed' || !opts.webFunction) {
    await writeManifest(ctx, manifest, { ssr: Boolean(opts.webFunction) });
  }

  if (manifest.status === 'failed') {
    // The record is left as it was - unconfirmed if this build was changing the rules - so the
    // next build re-applies them.
    throw new Error(
      `build failed for ${opts.hash}${manifest.message ? `: ${manifest.message}` : ''}`,
    );
  }
  // The static files are published even in SSR mode, where the revision is still to come.
  await recordCacheControl(ctx, target, changedManifestKey(opts.hash));
  return manifest;
}

export async function invalidateCloudFront(ctx: OpsContext, paths = ['/*']): Promise<void> {
  const id = ctx.state.resources['cloudfront-distribution']?.id;
  if (typeof id !== 'string' || paths.length === 0) return;
  await ctx.clients.cloudfront.createInvalidation(id, paths, `inv-${Date.now()}`);
  const shown =
    paths.length > 6
      ? `${paths.slice(0, 6).join(', ')}, …(${paths.length} total)`
      : paths.join(', ');
  ctx.logger.ok(`CloudFront invalidation requested (${shown})`);
}

/** What a deploy's cache invalidation actually did, for the deploy summary. */
export interface InvalidationSummary {
  mode: 'none' | 'paths' | 'all';
  count: number;
}

/**
 * Invalidate only the URL paths that changed in this build (from the agent's manifest),
 * so unchanged pages stay cached. Falls back to `/*` when the manifest is missing or the
 * changed set is larger than the configured cap.
 */
export async function invalidateChanged(
  ctx: OpsContext,
  hash: string,
): Promise<InvalidationSummary> {
  const text = await ctx.clients.s3
    .getObjectText(ctx.names.bucket, changedManifestKey(hash))
    .catch(() => undefined);
  let paths: string[] | undefined;
  if (text) {
    try {
      paths = (JSON.parse(text) as { paths?: string[] }).paths;
    } catch {
      /* fall through to the /* fallback */
    }
  }
  if (!paths) {
    ctx.logger.warn('no changed-paths manifest - invalidating everything (/*)');
    await invalidateCloudFront(ctx, ['/*']);
    return { mode: 'all', count: 0 };
  }
  let summary: InvalidationSummary;
  if (paths.length === 0) {
    ctx.logger.ok('no content changed - skipping CloudFront invalidation');
    summary = { mode: 'none', count: 0 };
  } else if (paths.length > ctx.config.invalidationMaxPaths) {
    ctx.logger.step(`${paths.length} paths changed (> cap) - invalidating everything (/*)`);
    await invalidateCloudFront(ctx, ['/*']);
    summary = { mode: 'all', count: paths.length };
  } else {
    await invalidateCloudFront(ctx, paths);
    summary = { mode: 'paths', count: paths.length };
  }
  await ctx.clients.s3
    .deleteObject(ctx.names.bucket, changedManifestKey(hash))
    .catch(() => undefined);
  return summary;
}

export { manifestKey };
