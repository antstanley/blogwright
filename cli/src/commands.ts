import type { OpsContext } from './context.js';
import {
  invalidateChanged,
  invalidateCloudFront,
  manifestKey,
  microvmLogGroup,
  runBuild,
  type DeployManifest,
} from './deploy.js';
import { applyGraph, destroyGraph } from './graph.js';
import { colors } from './logger.js';
import { clearRunningMicrovms } from './microvms.js';
import { buildNodes } from './nodes.js';
import { syncAfterDeploy } from './pds/commands.js';
import { buildRepoZip, listRepoFiles, revisionHash } from './repo.js';

/**
 * Canonical origin the live site is served from: the custom domain if configured,
 * else the distribution's CloudFront domain. Used for robots.txt / sitemap.xml URLs.
 */
function siteBaseUrl(ctx: OpsContext): string | undefined {
  if (ctx.domain) return `https://${ctx.domain}`;
  const cf = ctx.state.resources['cloudfront-distribution']?.domainName;
  return typeof cf === 'string' ? `https://${cf}` : undefined;
}

/** Create the full infrastructure graph. */
export async function bootstrap(ctx: OpsContext): Promise<void> {
  ctx.logger.info(colors.bold(`Bootstrapping "${ctx.env}" (bucket ${ctx.names.bucket})`));
  // The state bucket must exist before anything else can persist state.
  await applyGraph(buildNodes(ctx), ctx);
  ctx.logger.ok(`bootstrap complete for "${ctx.env}"`);
  const domain = ctx.state.resources['cloudfront-distribution']?.domainName;
  if (typeof domain === 'string') ctx.logger.info(`Site will be served at https://${domain}`);
}

/** Destroy the full infrastructure graph. */
export async function destroy(ctx: OpsContext, opts: { yes: boolean }): Promise<void> {
  if (!opts.yes) {
    throw new Error(`refusing to destroy "${ctx.env}" without --yes`);
  }
  ctx.logger.info(colors.bold(`Destroying "${ctx.env}"`));
  // Running builder MicroVMs pin the image and make its deletion fail; clear them first
  // (or let the operator cancel and wait for in-flight builds to finish).
  if (!(await clearRunningMicrovms(ctx))) return;
  await destroyGraph(buildNodes(ctx), ctx);
  await ctx.store.delete();
  ctx.logger.ok(`destroyed "${ctx.env}"`);
}

/** Zip the repo, upload it, run the builder MicroVM, and invalidate the cache. */
export async function deploy(ctx: OpsContext): Promise<void> {
  const cwd = process.cwd();
  const hash = await revisionHash(cwd);
  ctx.logger.info(colors.bold(`Deploying ${hash} to "${ctx.env}"`));

  const files = await listRepoFiles(cwd, ctx.config.sourceIgnore);
  ctx.logger.step(`zipping ${files.length} files`);
  const zip = await buildRepoZip(cwd, files);
  const sourceKey = `build/${hash}.zip`;
  await ctx.clients.s3.putObject(ctx.names.bucket, sourceKey, zip, 'application/zip');
  ctx.logger.ok(`uploaded ${sourceKey} (${(zip.byteLength / 1024).toFixed(0)} KiB)`);

  await runBuild(ctx, { hash, sourceKey, baseUrl: siteBaseUrl(ctx) });
  await invalidateChanged(ctx, hash);
  // Production content changed — mirror it to the PDS (non-fatal; see syncAfterDeploy).
  await syncAfterDeploy(ctx);
  ctx.logger.ok(`deployed ${hash}`);
}

/** Re-run the builder against an existing source zip for the given hash. */
export async function rollback(ctx: OpsContext, hash: string): Promise<void> {
  const sourceKey = `build/${hash}.zip`;
  if (!(await ctx.clients.s3.objectExists(ctx.names.bucket, sourceKey))) {
    throw new Error(`no build artifact at ${sourceKey}; cannot roll back to ${hash}`);
  }
  ctx.logger.info(colors.bold(`Rolling back "${ctx.env}" to ${hash}`));
  await runBuild(ctx, { hash, sourceKey, baseUrl: siteBaseUrl(ctx) });
  await invalidateChanged(ctx, hash);
  // A rollback changes production content too, but the PDS mirrors the *working tree*
  // content, which a rollback does not restore — so only warn about the divergence.
  if (ctx.env === 'production' && ctx.config.pds) {
    ctx.logger.warn(
      'rollback does not sync the PDS (records mirror the current repo content); ' +
        'check out the rolled-back revision and run `blog-ops pds sync` if needed',
    );
  }
  ctx.logger.ok(`rolled back to ${hash}`);
}

function assertPreviewId(id: string): void {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`preview id must be lowercase alphanumeric/dashes (e.g. pr-42), got "${id}"`);
  }
}

/** Provision the shared preview stack (one CloudFront distribution + host router + OIDC role). */
export async function previewBootstrap(ctx: OpsContext): Promise<void> {
  if (!ctx.domain)
    throw new Error('preview bootstrap requires a domain (e.g. preview.iamstan.dev)');
  ctx.logger.info(colors.bold(`Bootstrapping preview stack (bucket ${ctx.names.bucket})`));
  await applyGraph(buildNodes(ctx), ctx);
  ctx.logger.ok('preview stack ready');
}

/** Build the current repo and publish it to this PR's preview prefix. Prints the URL. */
export async function previewDeploy(ctx: OpsContext, id: string): Promise<string> {
  assertPreviewId(id);
  const cwd = process.cwd();
  const hash = await revisionHash(cwd);
  ctx.logger.info(colors.bold(`Preview deploy ${id} (${hash})`));

  const files = await listRepoFiles(cwd, ctx.config.sourceIgnore);
  ctx.logger.step(`zipping ${files.length} files`);
  const zip = await buildRepoZip(cwd, files);
  const sourceKey = `build/${hash}.zip`;
  await ctx.clients.s3.putObject(ctx.names.bucket, sourceKey, zip, 'application/zip');

  const url = `https://${id}.${ctx.domain}`;
  await runBuild(ctx, {
    hash,
    sourceKey,
    sitePrefix: `previews/${id}/site/`,
    target: `preview-${id}`,
    baseUrl: url,
  });
  ctx.logger.ok(`preview ready: ${url}`);
  return url;
}

/** Remove one PR's preview (delete its prefix). No invalidation — previews aren't cached. */
export async function previewDestroy(ctx: OpsContext, id: string): Promise<void> {
  assertPreviewId(id);
  const count = await ctx.clients.s3.deletePrefix(ctx.names.bucket, `previews/${id}/`);
  ctx.logger.ok(`removed preview ${id} (${count} object(s))`);
}

/** List active previews (by prefix). */
export async function previewList(ctx: OpsContext): Promise<void> {
  const objects = await ctx.clients.s3.listObjects(ctx.names.bucket, 'previews/');
  const ids = [...new Set(objects.map((o) => o.key.split('/')[1]).filter(Boolean))].sort();
  if (ids.length === 0) {
    ctx.logger.info('no active previews');
    return;
  }
  for (const id of ids) ctx.logger.info(`  ${id}  https://${id}.${ctx.domain}`);
}

/** Tear down the entire shared preview stack. */
export async function previewTeardown(ctx: OpsContext, opts: { yes: boolean }): Promise<void> {
  if (!opts.yes) throw new Error('refusing to tear down the preview stack without --yes');
  ctx.logger.info(colors.bold('Tearing down preview stack'));
  if (!(await clearRunningMicrovms(ctx))) return;
  await destroyGraph(buildNodes(ctx), ctx);
  await ctx.store.delete();
  ctx.logger.ok('preview stack destroyed');
}

/** Empty the live site/ prefix (leaves infra and build history intact). */
export async function deleteSite(ctx: OpsContext): Promise<void> {
  const count = await ctx.clients.s3.deletePrefix(ctx.names.bucket, 'site/');
  ctx.logger.ok(`deleted ${count} object(s) under site/`);
  await invalidateCloudFront(ctx);
}

/** List deployment history from build manifests. */
export async function history(ctx: OpsContext): Promise<void> {
  const objects = await ctx.clients.s3.listObjects(ctx.names.bucket, 'build/manifests/');
  if (objects.length === 0) {
    ctx.logger.info('no deployments yet');
    return;
  }
  const manifests: DeployManifest[] = [];
  for (const obj of objects) {
    const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, obj.key);
    if (text) manifests.push(JSON.parse(text) as DeployManifest);
  }
  manifests.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  ctx.logger.info(colors.bold('hash          status      finished                 duration'));
  for (const m of manifests) {
    const cell =
      m.status === 'succeeded'
        ? colors.green(m.status.padEnd(10))
        : colors.red(m.status.padEnd(10));
    ctx.logger.info(
      `${m.hash.padEnd(13)} ${cell}  ${m.finishedAt}  ${(m.durationMs / 1000).toFixed(0)}s`,
    );
  }
}

/** Show CloudWatch build logs for a given hash. */
export async function logs(ctx: OpsContext, hash: string): Promise<void> {
  const text = await ctx.clients.s3.getObjectText(ctx.names.bucket, manifestKey(hash));
  const manifest = text ? (JSON.parse(text) as DeployManifest) : undefined;
  // Filter to the build's time window (± a minute) from the manifest.
  const startTime = manifest ? Date.parse(manifest.startedAt) - 60_000 : undefined;
  const endTime = manifest ? Date.parse(manifest.finishedAt) + 60_000 : undefined;
  const events = await ctx.clients.logs.filterEvents(microvmLogGroup(ctx), {
    ...(startTime !== undefined ? { startTime } : {}),
    ...(endTime !== undefined ? { endTime } : {}),
  });
  if (events.length === 0) {
    ctx.logger.info(`no log events for ${hash}`);
    return;
  }
  for (const e of events) {
    ctx.logger.info(`${colors.dim(new Date(e.timestamp).toISOString())} ${e.message.trimEnd()}`);
  }
}

/** Show the planned graph against live state (drift view). */
export async function status(ctx: OpsContext): Promise<void> {
  ctx.logger.info(colors.bold(`Status for "${ctx.env}" (bucket ${ctx.names.bucket})`));
  for (const node of buildNodes(ctx)) {
    let exists = false;
    try {
      exists = await node.read(ctx);
    } catch (err) {
      ctx.logger.warn(`${node.title}: read failed (${(err as Error).message})`);
      continue;
    }
    const mark = exists ? colors.green('present') : colors.yellow('missing');
    const outputs = ctx.state.resources[node.id];
    const detail = outputs ? colors.dim(JSON.stringify(outputs)) : '';
    ctx.logger.info(`  ${mark}  ${node.title} ${detail}`);
  }
}
