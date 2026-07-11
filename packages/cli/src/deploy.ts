import { randomUUID } from 'node:crypto';

import { networkConnectors, pollUntil, sleep, type LogEvent } from 'blogwright-core';

import type { OpsContext } from './context.js';
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
 * Nudge the MicroVM's endpoint to wake its event loop. A Firecracker-resumed process
 * can sit idle with its poll timer pending until some I/O arrives; a connection here —
 * even one the agent's HTTP/1 server can't fully parse — wakes the loop so the timer
 * fires and the build starts. The wake-up, not the response, is the point: a missing
 * endpoint or token means nothing to nudge, and a rejecting ping never fails the poll.
 */
async function nudge(ctx: OpsContext, endpoint: string, token: string): Promise<void> {
  if (!endpoint || !token) return;
  await ctx.ports.ping(endpoint, token).catch(() => undefined);
}

/**
 * Resolve the MicroVM build log group from bootstrapped state rather than re-deriving it.
 * The image and the build-role IAM policy bake this name in at bootstrap, so if the derived
 * name (`ctx.names.microvmLogGroup`) is renamed in code later, a deploy must still target
 * the group the running stack actually logs to — otherwise the VM's logs land in (or are
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
  const deadline = Date.now() + ctx.config.microvm.maxDurationSeconds * 1000;

  for (;;) {
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
    // an authoritative completion signal too — a successful build then can't hang until the
    // deadline just because its logs never reached CloudWatch. runBuild clears any stale copy
    // before launch, so its presence means *this* build finished.
    if (await ctx.clients.s3.objectExists(ctx.names.bucket, `build/changed/${hash}.json`)) {
      return { state: 'done' };
    }
    if (Date.now() >= deadline) return { state: 'failed', message: 'build timed out' };
    await sleep(3000);
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
  },
): Promise<DeployManifest> {
  const sitePrefix = opts.sitePrefix ?? 'site/';
  const seo = resolveSeo(ctx, opts.baseUrl);
  const pendingKey = `build/pending/${opts.target ?? 'site'}.json`;
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
    .deleteObject(ctx.names.bucket, `build/changed/${opts.hash}.json`)
    .catch(() => undefined);

  const connectors = networkConnectors(ctx.config.region);
  const startedAt = new Date();
  ctx.logger.step(`running builder MicroVM for ${opts.hash}`);

  // Launch first: if runMicrovm throws, no pending.json is left behind (a leaked job
  // could otherwise be picked up during a later image bake and poison the snapshot).
  // A MicroVM is ephemeral compute, so the client token is unique per launch — keying it
  // on the hash would make a re-deploy (or workflow re-run) of the same source idempotently
  // return the ALREADY-TERMINATED original VM instead of launching a fresh one. Generated
  // once here so a network retry of this single call still dedupes.
  const clientToken = `run-${opts.hash}-${randomUUID()}`;
  const run = await ctx.clients.microvms.runMicrovm({
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
      JSON.stringify({ hash: opts.hash, sourceKey: opts.sourceKey, sitePrefix, ...seo }),
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
    await ctx.clients.microvms.terminateMicrovm(run.microvmId);
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
  await ctx.clients.s3.putObject(
    ctx.names.bucket,
    manifestKey(opts.hash),
    JSON.stringify(manifest, null, 2),
    'application/json',
  );

  if (manifest.status === 'failed') {
    throw new Error(
      `build failed for ${opts.hash}${manifest.message ? `: ${manifest.message}` : ''}`,
    );
  }
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

/**
 * Invalidate only the URL paths that changed in this build (from the agent's manifest),
 * so unchanged pages stay cached. Falls back to `/*` when the manifest is missing or the
 * changed set is larger than the configured cap.
 */
export async function invalidateChanged(ctx: OpsContext, hash: string): Promise<void> {
  const text = await ctx.clients.s3
    .getObjectText(ctx.names.bucket, `build/changed/${hash}.json`)
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
    ctx.logger.warn('no changed-paths manifest — invalidating everything (/*)');
    await invalidateCloudFront(ctx, ['/*']);
    return;
  }
  if (paths.length === 0) {
    ctx.logger.ok('no content changed — skipping CloudFront invalidation');
  } else if (paths.length > ctx.config.invalidationMaxPaths) {
    ctx.logger.step(`${paths.length} paths changed (> cap) — invalidating everything (/*)`);
    await invalidateCloudFront(ctx, ['/*']);
  } else {
    await invalidateCloudFront(ctx, paths);
  }
  await ctx.clients.s3
    .deleteObject(ctx.names.bucket, `build/changed/${hash}.json`)
    .catch(() => undefined);
}

export { manifestKey };
