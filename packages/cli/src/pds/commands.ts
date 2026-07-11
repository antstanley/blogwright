import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { OpsContext } from '../context.js';
import { colors } from '../logger.js';
import { findRepoRoot } from '../repo-root.js';
import { clientDocumentPaths, clientMetadata, jwksDocument } from './client-metadata.js';
import {
  generateClientKey,
  login as oauthLogin,
  openPdsRepo,
  publicClientJwk,
  verifyClientAssets,
} from './oauth.js';
import { loadPdsSecret, updatePdsSecret } from './secret.js';
import {
  PUBLICATION_COLLECTION,
  publicationRecord,
  readWellKnownUri,
  requirePdsConfig,
  syncPds,
  wellKnownPath,
  type OpenRepo,
  type SyncSummary,
} from './sync.js';
import { rkeyFromUri } from './xrpc.js';

/**
 * Generate the OAuth confidential-client key: private JWK into the secret
 * (clearing any session — client auth is bound to the key), public half into
 * the two committed /oauth/ documents the site serves.
 */
export async function keygen(
  ctx: OpsContext,
  repoRoot?: string,
  generateKey: typeof generateClientKey = generateClientKey,
): Promise<void> {
  const pds = requirePdsConfig(ctx);
  if (!ctx.domain) throw new Error('pds keygen requires a configured domain');
  const root = repoRoot ?? (await findRepoRoot(ctx.ports.fs));
  const kid = `${ctx.config.siteName}-oauth-${new Date().toISOString().slice(0, 10)}`;
  const clientKey = await generateKey(kid);
  await updatePdsSecret(
    ctx.clients.secrets,
    pds.secretName,
    (secret) => ({ ...secret, clientKey, session: undefined }),
    // keygen is the migration entry point — a legacy app-password value is replaced
    { replaceLegacy: true },
  );
  ctx.logger.ok(`stored private key "${kid}" in secret "${pds.secretName}"`);

  const docPaths = clientDocumentPaths(ctx.config);
  const documents: [path: string, body: object][] = [
    [docPaths.clientMetadata, clientMetadata(ctx.domain, pds)],
    [docPaths.jwks, jwksDocument(await publicClientJwk(clientKey))],
  ];
  for (const [path, body] of documents) {
    await ctx.ports.fs.writeText(join(root, path), `${JSON.stringify(body, null, 2)}\n`);
    ctx.logger.info(`  wrote ${path}`);
  }
  ctx.logger.info(
    colors.bold(
      `Commit ${ctx.config.paths.publicDir}/oauth/* and release — then run \`blogwright pds login\`.`,
    ),
  );
}

/** Interactive OAuth bootstrap; see oauth.ts#login for the flow. */
export async function login(
  ctx: OpsContext,
  opts: { identifier?: string | undefined },
): Promise<void> {
  if (!opts.identifier) {
    throw new Error('pds login requires --identifier <handle-or-did>');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await oauthLogin(ctx, opts.identifier, {
      promptLine: (question) => rl.question(question),
    });
  } finally {
    rl.close();
  }
}

/** Show whether the secret exists and which parts it holds. Never prints values. */
export async function secretStatus(ctx: OpsContext): Promise<void> {
  const pds = requirePdsConfig(ctx);
  const meta = await ctx.clients.secrets.describeSecret(pds.secretName);
  if (!meta) {
    ctx.logger.info(`no secret at "${pds.secretName}" — create it with \`blogwright pds keygen\``);
    return;
  }
  ctx.logger.info(`  name          ${meta.name}`);
  ctx.logger.info(`  arn           ${meta.arn}`);
  if (meta.lastChangedDate !== undefined) {
    ctx.logger.info(`  last changed  ${new Date(meta.lastChangedDate * 1000).toISOString()}`);
  }
  try {
    const secret = await loadPdsSecret(ctx);
    const kid = (secret.clientKey as { kid?: string } | undefined)?.kid;
    ctx.logger.info(`  client key    ${secret.clientKey ? `yes (${kid ?? 'no kid'})` : 'no'}`);
    ctx.logger.info(`  did           ${secret.did ?? 'no'}`);
    ctx.logger.info(`  session       ${secret.session ? 'yes' : 'no'}`);
  } catch (err) {
    ctx.logger.warn((err as Error).message);
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
export async function init(
  ctx: OpsContext,
  repoRoot?: string,
  openRepo: typeof openPdsRepo = openPdsRepo,
  verifyAssets: typeof verifyClientAssets = verifyClientAssets,
): Promise<void> {
  const pds = requirePdsConfig(ctx);
  if (!ctx.domain) throw new Error('pds init requires a configured domain');
  const root = repoRoot ?? (await findRepoRoot(ctx.ports.fs));
  await verifyAssets(ctx);
  const { did, repo } = await openRepo(ctx);

  const record = publicationRecord(pds, `https://${ctx.domain}`);
  const existingUri = await readWellKnownUri(ctx.ports.fs, root, ctx.config);
  let publicationUri: string;
  if (existingUri) {
    await repo.putRecord(PUBLICATION_COLLECTION, rkeyFromUri(existingUri), record);
    publicationUri = existingUri;
    ctx.logger.ok(`updated publication ${publicationUri}`);
  } else {
    const created = await repo.createRecord(PUBLICATION_COLLECTION, record);
    publicationUri = created.uri;
    ctx.logger.ok(`created publication ${publicationUri}`);
  }

  const wellKnown = wellKnownPath(ctx.config);
  await ctx.ports.fs.writeText(join(root, wellKnown), `${publicationUri}\n`);
  await ctx.ports.fs.writeText(
    join(root, ctx.config.paths.atprotoJson),
    `${JSON.stringify({ did, publicationUri }, null, 2)}\n`,
  );
  ctx.logger.info(`  wrote ${wellKnown}`);
  ctx.logger.info(`  wrote ${ctx.config.paths.atprotoJson}`);
  ctx.logger.info(
    colors.bold(
      'Commit both files and deploy — they verify the publication and the post link tags.',
    ),
  );
}

/** Reconcile PDS records against local content. Production only. */
export async function sync(
  ctx: OpsContext,
  repoRoot?: string,
  openRepo: OpenRepo = openPdsRepo,
): Promise<void> {
  if (ctx.env !== 'production') {
    throw new Error(
      `pds sync publishes canonical production URLs and refuses to run for "${ctx.env}"`,
    );
  }
  const root = repoRoot ?? (await findRepoRoot(ctx.ports.fs));
  const summary = await syncPds(ctx, root, openRepo);
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
  repoRoot?: string,
  doSync: (ctx: OpsContext, repoRoot: string) => Promise<SyncSummary> = (c, r) =>
    syncPds(c, r, openPdsRepo),
): Promise<void> {
  if (ctx.env !== 'production' || !ctx.config.pds) return;
  const root = repoRoot ?? (await findRepoRoot(ctx.ports.fs));
  const initialised = await readWellKnownUri(ctx.ports.fs, root, ctx.config).catch(() => undefined);
  if (!initialised) {
    ctx.logger.info('standard.site publishing not initialised (`blogwright pds init`) — skipping');
    return;
  }
  try {
    ctx.logger.step('syncing standard.site records to the PDS');
    logSummary(ctx, await doSync(ctx, root));
  } catch (err) {
    ctx.logger.warn(`pds sync failed (deploy unaffected): ${(err as Error).message}`);
  }
}
