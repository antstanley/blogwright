import { AwsError, colors, findRepoRoot, type ResourceNode, type S3Object } from 'blogwright-core';
/*
 * A STATIC, NON-OPTIONAL IMPORT, and deliberately the last one left in the
 * CLI. Task 29 deleted every other reference to `blogwright-pds` from the
 * dispatcher (`cli.ts` now knows no namespace by name; the package is
 * discovered and dispatched as an ordinary plugin), and this one still
 * stays, for two reasons:
 *
 *   - THE SPI HAS NO LIFECYCLE HOOKS. `Plugin` (`blogwright-core`'s
 *     `plugin.ts`) declares `commands`, `nodes`, `configKey`,
 *     `validateConfig` and `init` - nothing a plugin could register to be
 *     called after a successful deploy. `deploy` below therefore reaches
 *     this function by name, exactly as it always has; routing it through
 *     plugin dispatch would mean inventing a hook the change spec does not
 *     describe.
 *   - THE PACKAGE SHIPS BY DEFAULT. `blogwright-pds` is a non-optional
 *     `dependencies` entry of `packages/cli/package.json` - that is how the
 *     bundled plugin reaches a consuming repo that depends on `blogwright`
 *     alone - so the import can never fail to resolve, and no optional-
 *     dependency guard is needed around it.
 *
 * `syncAfterDeploy` no-ops for any environment but `production` and for a
 * site with no `pds` config block, so an unconfigured repo pays nothing for
 * it. Both halves are asserted in `commands.test.ts`.
 */
import { syncAfterDeploy } from 'blogwright-pds';

import type { OpsContext } from './context.js';
import {
  invalidateChanged,
  invalidateCloudFront,
  manifestKey,
  microvmLogGroup,
  runBuild,
  type DeployManifest,
} from './deploy.js';
import { applyGraph, destroyGraph, type GraphContext } from './graph.js';
import { clearRunningMicrovms } from './microvms.js';
import { buildNodes, reconcileBuilderImage } from './nodes.js';
import {
  formatDuration,
  logStatusEntries,
  renderHistoryTable,
  renderSummary,
  type StatusEntry,
  type SummaryRow,
} from './render.js';
import { buildRepoZip, COMMIT_FILE, listRepoFiles } from './repo.js';

/** One line per invalidation outcome, shared by the summary card and logs. */
function describeInvalidation(inv: { mode: 'none' | 'paths' | 'all'; count: number }): string {
  if (inv.mode === 'none') return 'nothing changed - skipped';
  if (inv.mode === 'paths') return `${inv.count} changed path${inv.count === 1 ? '' : 's'}`;
  return inv.count > 0 ? `everything (/*) - ${inv.count} paths over cap` : 'everything (/*)';
}

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

/**
 * The prefix every state object - scoped or not - is filed under
 * (`StateStore`, `packages/core/src/state.ts`). Not exported from core, so
 * mirrored here rather than reached for; the guard below only ever reads
 * this prefix, never constructs a key to write.
 */
const STATE_PREFIX = 'state/';

/** The site's own unscoped state key - the one object under `STATE_PREFIX` the guard below must never treat as a plugin's. */
function siteStateKey(env: string): string {
  return `${STATE_PREFIX}${env}.json`;
}

/**
 * Every plugin scope with a `state/<env>.<scope>.json` object present under
 * `STATE_PREFIX`, derived from a listing rather than the plugin registry -
 * so {@link assertNoScopedState} holds even for a plugin that has since
 * been uninstalled. Sorted, so the guard's message is deterministic
 * regardless of the order S3 lists objects in.
 */
function scopedStateScopes(env: string, objects: readonly { key: string }[]): string[] {
  const prefix = `${STATE_PREFIX}${env}.`;
  const site = siteStateKey(env);
  const scopes = objects
    .map((o) => o.key)
    .filter((key) => key !== site && key.startsWith(prefix) && key.endsWith('.json'))
    .map((key) => key.slice(prefix.length, -'.json'.length));
  return [...new Set(scopes)].sort();
}

/**
 * Refuse to destroy the site while any plugin's own state object still
 * exists in the bucket - §State → Scoped state stores' "`blogwright
 * destroy` therefore refuses while any `state/<env>.<plugin>.json` exists".
 *
 * A scope changes the state object's KEY, not the bucket it lives in
 * (`StateStore`, `packages/core/src/state.ts`) - a scoped and an unscoped
 * store for the same environment are constructed over the very same
 * `names.bucket` - and the site's own bucket node empties every prefix
 * before deleting the bucket (`deletePrefix(ctx.names.bucket, '')`,
 * `nodes.ts`'s `bucketNode().delete()`). Without this guard, a site
 * teardown deletes `state/<env>.<scope>.json` while every resource it
 * records lives on: the plugin's next `destroy` then loads empty state,
 * every node's `read()` returns false, and nothing is removed - the
 * plugin's resources are silently orphaned.
 *
 * Reads the bucket, not the plugin registry, so the refusal holds even for
 * a plugin that has since been uninstalled. Runs inside the teardown verbs
 * themselves, not `createContext` - so no other command pays for the extra
 * `listObjects` call and plugin discovery stays lazy - and ahead of
 * `clearRunningMicrovms`/`destroyGraph` in each, so a refusal has zero side
 * effects: nothing is terminated, nothing is deleted.
 *
 * BOTH teardown verbs call it: `destroy` (below) and `previewTeardown`,
 * which runs the very same `destroyGraph(buildNodes(ctx), ctx)` over the
 * very same `bucketNode().delete()` and so empties the preview stack's
 * bucket - including a `state/<env>.<scope>.json` a plugin bootstrapped
 * against that environment - in exactly the same way. Nothing about the
 * orphaning above is specific to the site's own environment, so nothing
 * about the guard is either.
 *
 * A MISSING BUCKET IS TREATED AS CLEAR, not as an error. `listObjects` does
 * not swallow a 404 the way `getObjectText` does, so an environment whose
 * bucket a previous (interrupted) teardown already deleted would otherwise
 * fail here with a raw `NoSuchBucket` before a single non-bucket resource -
 * roles, log groups, the CloudFront function, the delivery trio - had been
 * cleaned up, on precisely the recovery path an operator reaches for after
 * an interrupted teardown. A bucket that is gone holds no state object at
 * all, scoped or otherwise, so there is nothing to protect and every reason
 * to let the teardown finish: refusing here would CAUSE the orphaning this
 * guard exists to prevent. Only `NoSuchBucket` is treated this way - every
 * other failure (denied, throttled, a network fault) still propagates,
 * because those say nothing about whether scoped state exists.
 *
 * Exported - like `readNodeStatus` above - so a test can pin its outcomes
 * directly against a recording S3 client, rather than only through a full
 * `destroy()` run over the entire production graph.
 */
export async function assertNoScopedState(ctx: OpsContext): Promise<void> {
  let objects: S3Object[];
  try {
    objects = await ctx.clients.s3.listObjects(ctx.names.bucket, STATE_PREFIX);
  } catch (err) {
    // No bucket, no state objects - see this function's doc comment. Matched
    // on the bucket's own error code rather than the broad `isNotFound`,
    // which is equally true of `NoSuchKey` and of ANY 404 (`AwsError`,
    // `packages/core/src/aws/errors.ts`): a spurious 404 from a non-AWS,
    // S3-compatible endpoint (`--endpoint`) would otherwise read as "no
    // scoped state" and let the teardown empty the bucket over a plugin's
    // live state object - the exact orphaning this guard exists to prevent.
    // Every other failure propagates, which ends the teardown safely rather
    // than deleting past the guard.
    if (err instanceof AwsError && err.code === 'NoSuchBucket') return;
    throw err;
  }
  const scopes = scopedStateScopes(ctx.env, objects);
  if (scopes.length === 0) return;
  // The remedy MUST name the environment. `runPlugin` resolves a plugin
  // command's environment as `values.env ?? envPositional ?? DEFAULT_ENV`
  // with `DEFAULT_ENV = 'production'` (`plugin-commands.ts`), so an env-less
  // `blogwright <scope> destroy --yes` silently targets production - always
  // the wrong environment when this guard fires from `previewTeardown`,
  // which builds `env: 'preview'` unconditionally (`cli.ts`'s `runPreview`).
  // Printed against a preview refusal, the env-less form at best loads empty
  // state and removes nothing, leaving the operator stuck in this same
  // refusal, and at worst tears down the live production stack. `deriveNames`
  // keys off `env` alone, so the positional below is the whole fix - and it
  // covers both callers, because each passes the very environment it is
  // tearing down.
  const lines = scopes.map(
    (scope) => `  - ${scope}: run \`blogwright ${scope} destroy ${ctx.env} --yes\` first`,
  );
  throw new Error(
    `refusing to destroy "${ctx.env}": ${scopes.length} plugin state object(s) still exist in ` +
      `s3://${ctx.names.bucket}/${STATE_PREFIX}\n${lines.join('\n')}`,
  );
}

/** Destroy the full infrastructure graph. */
export async function destroy(ctx: OpsContext, opts: { yes: boolean }): Promise<void> {
  if (!opts.yes) {
    throw new Error(`refusing to destroy "${ctx.env}" without --yes`);
  }
  await assertNoScopedState(ctx);
  ctx.logger.info(colors.bold(`Destroying "${ctx.env}"`));
  // Running builder MicroVMs pin the image and make its deletion fail; clear them first
  // (or let the operator cancel and wait for in-flight builds to finish).
  if (!(await clearRunningMicrovms(ctx))) return;
  await destroyGraph(buildNodes(ctx), ctx);
  await ctx.store.delete();
  ctx.logger.ok(`destroyed "${ctx.env}"`);
}

/** Zip the repo, upload it, run the builder MicroVM, and invalidate the cache. */
export async function deploy(ctx: OpsContext, opts: { refresh?: boolean } = {}): Promise<void> {
  const startedAt = Date.now();
  const cwd = await findRepoRoot(ctx.ports.fs);
  const hash = await ctx.ports.vcs.revisionHash(cwd);
  ctx.logger.info(colors.bold(`Deploying ${hash} to "${ctx.env}"`));

  const files = await listRepoFiles(
    ctx.ports,
    cwd,
    ctx.config.sourceIgnore,
    ctx.config.sourceInclude,
  );
  ctx.logger.step(`zipping ${files.length} files`);
  const zip = await buildRepoZip(ctx.ports.fs, cwd, files, { [COMMIT_FILE]: hash });
  const sourceKey = `build/${hash}.zip`;
  await ctx.clients.s3.putObject(ctx.names.bucket, sourceKey, zip, 'application/zip');
  ctx.logger.ok(`uploaded ${sourceKey} (${(zip.byteLength / 1024).toFixed(0)} KiB)`);

  // Rebuild the builder image first if the agent bundle changed, so build-agent fixes
  // ship on the same deploy (no-op when unchanged).
  await reconcileBuilderImage(ctx);
  const manifest = await runBuild(ctx, {
    hash,
    sourceKey,
    baseUrl: siteBaseUrl(ctx),
    ...(opts.refresh ? { refresh: true } : {}),
  });
  const invalidation = await invalidateChanged(ctx, hash);
  // Production content changed - mirror it to the PDS (non-fatal; see syncAfterDeploy).
  await syncAfterDeploy(ctx);

  const url = siteBaseUrl(ctx);
  const rows: SummaryRow[] = [
    { label: 'revision', value: hash },
    { label: 'environment', value: ctx.env },
    { label: 'source', value: `${files.length} files, ${(zip.byteLength / 1024).toFixed(0)} KiB` },
    { label: 'build', value: formatDuration(manifest.durationMs) },
    { label: 'invalidated', value: describeInvalidation(invalidation) },
    ...(url ? [{ label: 'site', value: colors.cyan(url) }] : []),
  ];
  for (const line of renderSummary('deploy summary', rows, ctx.ports.terminal.isInteractive)) {
    ctx.logger.info(line);
  }
  ctx.logger.ok(`deployed ${hash} in ${formatDuration(Date.now() - startedAt)}`);
}

/** Re-run the builder against an existing source zip for the given hash. */
export async function rollback(
  ctx: OpsContext,
  hash: string,
  opts: { refresh?: boolean } = {},
): Promise<void> {
  const sourceKey = `build/${hash}.zip`;
  if (!(await ctx.clients.s3.objectExists(ctx.names.bucket, sourceKey))) {
    throw new Error(`no build artifact at ${sourceKey}; cannot roll back to ${hash}`);
  }
  ctx.logger.info(colors.bold(`Rolling back "${ctx.env}" to ${hash}`));
  const startedAt = Date.now();
  await runBuild(ctx, {
    hash,
    sourceKey,
    baseUrl: siteBaseUrl(ctx),
    ...(opts.refresh ? { refresh: true } : {}),
  });
  await invalidateChanged(ctx, hash);
  // A rollback changes production content too, but the PDS mirrors the *working tree*
  // content, which a rollback does not restore - so only warn about the divergence.
  if (ctx.env === 'production' && ctx.config.pds) {
    ctx.logger.warn(
      'rollback does not sync the PDS (records mirror the current repo content); ' +
        'check out the rolled-back revision and run `blogwright pds sync` if needed',
    );
  }
  ctx.logger.ok(`rolled back to ${hash} in ${formatDuration(Date.now() - startedAt)}`);
}

function assertPreviewId(id: string): void {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`preview id must be lowercase alphanumeric/dashes (e.g. pr-42), got "${id}"`);
  }
}

/** Provision the shared preview stack (one CloudFront distribution + host router + OIDC role). */
export async function previewBootstrap(ctx: OpsContext): Promise<void> {
  if (!ctx.domain)
    throw new Error('preview bootstrap requires a domain (e.g. preview.example.com)');
  ctx.logger.info(colors.bold(`Bootstrapping preview stack (bucket ${ctx.names.bucket})`));
  await applyGraph(buildNodes(ctx), ctx);
  ctx.logger.ok('preview stack ready');
}

/** Build the current repo and publish it to this PR's preview prefix. Prints the URL. */
export async function previewDeploy(
  ctx: OpsContext,
  id: string,
  opts: { refresh?: boolean } = {},
): Promise<string> {
  assertPreviewId(id);
  const startedAt = Date.now();
  const cwd = await findRepoRoot(ctx.ports.fs);
  const hash = await ctx.ports.vcs.revisionHash(cwd);
  ctx.logger.info(colors.bold(`Preview deploy ${id} (${hash})`));

  const files = await listRepoFiles(
    ctx.ports,
    cwd,
    ctx.config.sourceIgnore,
    ctx.config.sourceInclude,
  );
  ctx.logger.step(`zipping ${files.length} files`);
  const zip = await buildRepoZip(ctx.ports.fs, cwd, files, { [COMMIT_FILE]: hash });
  const sourceKey = `build/${hash}.zip`;
  await ctx.clients.s3.putObject(ctx.names.bucket, sourceKey, zip, 'application/zip');

  // Rebuild the shared preview builder image if the agent bundle changed (no-op when
  // unchanged), so agent fixes reach PR previews too.
  await reconcileBuilderImage(ctx);
  const url = `https://${id}.${ctx.domain}`;
  await runBuild(ctx, {
    hash,
    sourceKey,
    sitePrefix: `previews/${id}/site/`,
    target: `preview-${id}`,
    baseUrl: url,
    // Per-PR objects carry the PR id in the environment tag (preview-pr-42).
    objectTags: { ...ctx.tags, environment: `preview-${id}` },
    ...(opts.refresh ? { refresh: true } : {}),
  });
  ctx.logger.ok(`preview ready in ${formatDuration(Date.now() - startedAt)}: ${url}`);
  return url;
}

/** Remove one PR's preview (delete its prefix). No invalidation - previews aren't cached. */
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
  // The preview stack's teardown is the SITE teardown's graph over the
  // preview environment's own bucket - same `destroyGraph(buildNodes(ctx))`,
  // same `bucketNode().delete()` emptying every prefix - so a plugin
  // bootstrapped against this environment is orphaned here in exactly the
  // way `destroy` above is guarded against. See `assertNoScopedState`.
  await assertNoScopedState(ctx);
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
    if (!text) continue;
    try {
      manifests.push(JSON.parse(text) as DeployManifest);
    } catch {
      // One corrupt manifest must not take down the whole listing.
      ctx.logger.warn(`skipping unreadable manifest ${obj.key}`);
    }
  }
  // Newest first. Codepoint sort, not localeCompare: collation must not depend on host locale/ICU
  // (finishedAt is ISO-8601, which orders correctly by codepoint).
  manifests.sort((a, b) =>
    a.finishedAt > b.finishedAt ? -1 : a.finishedAt < b.finishedAt ? 1 : 0,
  );
  if (ctx.ports.terminal.isInteractive) {
    for (const line of renderHistoryTable(manifests, Date.now())) ctx.logger.info(line);
    return;
  }
  // The plain form is the stable contract for CI logs and agents.
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
  let manifest: DeployManifest | undefined;
  try {
    manifest = text ? (JSON.parse(text) as DeployManifest) : undefined;
  } catch {
    ctx.logger.warn(`manifest for ${hash} is unreadable - showing the unfiltered log window`);
  }
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

/**
 * Read each node's live status against `ctx.state`: present/missing from
 * `node.read(ctx)`, or an `error` entry carrying the message if it throws.
 * A query, not a command - it never writes to the logger, so a caller (the
 * CLI's own `status` below, and a plugin's `status` verb) decides how to
 * report each entry. Iterates `nodes` in the order given (no `topoSort` -
 * status is a read, not a reconcile, so dependency order doesn't matter).
 */
export async function readNodeStatus<Ctx extends GraphContext>(
  nodes: ResourceNode<Ctx>[],
  ctx: Ctx,
): Promise<StatusEntry[]> {
  const entries: StatusEntry[] = [];
  for (const node of nodes) {
    let exists = false;
    try {
      exists = await node.read(ctx);
    } catch (err) {
      entries.push({ title: node.title, state: 'error', detail: (err as Error).message });
      continue;
    }
    const outputs = ctx.state.resources[node.id];
    const detail = outputs ? JSON.stringify(outputs) : undefined;
    entries.push({ title: node.title, state: exists ? 'present' : 'missing', detail });
  }
  return entries;
}

/**
 * Show the planned graph against live state (drift view). `nodes` defaults to
 * the production graph (`buildNodes(ctx)`) - every real call site is
 * unchanged - but is a parameter, not reached-for, so a test (or a future
 * caller) can hand this the same loop over a different node set without
 * patching a module.
 */
export async function status(
  ctx: OpsContext,
  nodes: ResourceNode<OpsContext>[] = buildNodes(ctx),
): Promise<void> {
  ctx.logger.info(colors.bold(`Status for "${ctx.env}" (bucket ${ctx.names.bucket})`));
  const entries = await readNodeStatus(nodes, ctx);
  logStatusEntries(entries, ctx.ports.terminal.isInteractive, ctx.logger);
}
