import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { OpsContext } from '../context.js';
import { colors } from '../logger.js';
import {
  ATPROTO_JSON_PATH,
  PUBLICATION_COLLECTION,
  WELL_KNOWN_PATH,
  loadPdsCredentials,
  publicationRecord,
  readWellKnownUri,
  requirePdsConfig,
  syncPds,
  type SyncSummary,
} from './sync.js';
import { PdsClient, rkeyFromUri } from './xrpc.js';

export interface SecretSetOptions {
  /** DID (or handle) used for com.atproto.server.createSession. */
  identifier?: string | undefined;
  /** App password — never the account password. */
  password?: string | undefined;
  /** AT Protocol host; defaults to the configured pds.service (bsky.social). */
  service?: string | undefined;
}

/** Create/update the Secrets Manager secret from explicit CLI parameters. */
export async function secretSet(ctx: OpsContext, opts: SecretSetOptions): Promise<void> {
  const pds = requirePdsConfig(ctx);
  if (!opts.identifier) {
    throw new Error('pds secret set requires --identifier <did-or-handle>');
  }
  if (!opts.password) {
    throw new Error(
      'pds secret set requires --password <app-password> (never your account password)',
    );
  }
  const service = opts.service ?? pds.service;
  let parsed: URL;
  try {
    parsed = new URL(service);
  } catch {
    throw new Error(`--service must be a URL, got "${service}"`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`--service must be https, got "${service}"`);
  }
  const value = JSON.stringify({ identifier: opts.identifier, password: opts.password, service });
  await ctx.clients.secrets.upsertSecret(
    pds.secretName,
    value,
    `AT Protocol app-password credentials for ${opts.identifier} (blog-ops pds)`,
  );
  ctx.logger.ok(`secret "${pds.secretName}" set for ${opts.identifier} (${service})`);
}

/** Show whether the secret exists and when it last changed. Never prints the value. */
export async function secretStatus(ctx: OpsContext): Promise<void> {
  const pds = requirePdsConfig(ctx);
  const meta = await ctx.clients.secrets.describeSecret(pds.secretName);
  if (!meta) {
    ctx.logger.info(`no secret at "${pds.secretName}" — create it with \`blog-ops pds secret set\``);
    return;
  }
  ctx.logger.info(`  name          ${meta.name}`);
  ctx.logger.info(`  arn           ${meta.arn}`);
  if (meta.lastChangedDate !== undefined) {
    ctx.logger.info(`  last changed  ${new Date(meta.lastChangedDate * 1000).toISOString()}`);
  }
}

/** Delete the secret (immediate, no recovery window). */
export async function secretDelete(ctx: OpsContext, opts: { yes: boolean }): Promise<void> {
  const pds = requirePdsConfig(ctx);
  if (!opts.yes) throw new Error(`refusing to delete secret "${pds.secretName}" without --yes`);
  await ctx.clients.secrets.deleteSecret(pds.secretName);
  ctx.logger.ok(`deleted secret "${pds.secretName}"`);
}

/**
 * One-time (idempotent) publication setup: create the site.standard.publication
 * record — or update it when the committed well-known file already names one — and
 * write the two site files the user commits.
 */
export async function init(ctx: OpsContext, repoRoot = process.cwd()): Promise<void> {
  const pds = requirePdsConfig(ctx);
  if (!ctx.domain) throw new Error('pds init requires a configured domain');
  const creds = await loadPdsCredentials(ctx);
  const client = new PdsClient(creds.service ?? pds.service);
  const session = await client.createSession(creds.identifier, creds.password);

  const record = publicationRecord(pds, `https://${ctx.domain}/`);
  const existingUri = await readWellKnownUri(repoRoot);
  let publicationUri: string;
  if (existingUri) {
    await client.putRecord(PUBLICATION_COLLECTION, rkeyFromUri(existingUri), record);
    publicationUri = existingUri;
    ctx.logger.ok(`updated publication ${publicationUri}`);
  } else {
    const created = await client.createRecord(PUBLICATION_COLLECTION, record);
    publicationUri = created.uri;
    ctx.logger.ok(`created publication ${publicationUri}`);
  }

  const wellKnownFile = join(repoRoot, WELL_KNOWN_PATH);
  await mkdir(dirname(wellKnownFile), { recursive: true });
  await writeFile(wellKnownFile, `${publicationUri}\n`);
  const jsonFile = join(repoRoot, ATPROTO_JSON_PATH);
  await writeFile(jsonFile, `${JSON.stringify({ did: session.did, publicationUri }, null, 2)}\n`);
  ctx.logger.info(`  wrote ${WELL_KNOWN_PATH}`);
  ctx.logger.info(`  wrote ${ATPROTO_JSON_PATH}`);
  ctx.logger.info(
    colors.bold('Commit both files and deploy — they verify the publication and the post link tags.'),
  );
}

/** Reconcile PDS records against local content. Production only. */
export async function sync(ctx: OpsContext, repoRoot = process.cwd()): Promise<void> {
  if (ctx.env !== 'production') {
    throw new Error(
      `pds sync publishes canonical production URLs and refuses to run for "${ctx.env}"`,
    );
  }
  const summary = await syncPds(ctx, repoRoot);
  logSummary(ctx, summary);
}

function logSummary(ctx: OpsContext, s: SyncSummary): void {
  ctx.logger.ok(
    `publication ${s.publication}; documents: ${s.created.length} created, ` +
      `${s.updated.length} updated, ${s.unchanged} unchanged`,
  );
  for (const slug of s.created) ctx.logger.info(`  created  ${slug}`);
  for (const slug of s.updated) ctx.logger.info(`  updated  ${slug}`);
  if (s.orphans.length > 0) {
    ctx.logger.warn(
      `${s.orphans.length} PDS record(s) have no local post (rkeys: ${s.orphans.join(', ')}) — ` +
        'not deleted; remove them manually if intended',
    );
  }
}

/**
 * Post-deploy hook: reconcile the PDS after a successful production deploy.
 * Never fatal — a PDS outage must not fail a good site deploy; the next deploy
 * re-reconciles. No-op unless production, configured, and initialised.
 */
export async function syncAfterDeploy(
  ctx: OpsContext,
  repoRoot = process.cwd(),
  doSync: typeof syncPds = syncPds,
): Promise<void> {
  if (ctx.env !== 'production' || !ctx.config.pds) return;
  const initialised = await readWellKnownUri(repoRoot).catch(() => undefined);
  if (!initialised) {
    ctx.logger.info('standard.site publishing not initialised (`blog-ops pds init`) — skipping');
    return;
  }
  try {
    ctx.logger.step('syncing standard.site records to the PDS');
    logSummary(ctx, await doSync(ctx, repoRoot));
  } catch (err) {
    ctx.logger.warn(`pds sync failed (deploy unaffected): ${(err as Error).message}`);
  }
}
