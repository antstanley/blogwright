import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PdsConfig } from '@iamstan/ops-core';

import type { OpsContext } from '../context.js';
import { listPublishablePosts, type PostMeta } from './content.js';
import { postPath, tidFromPath } from './rkey.js';
import { rkeyFromUri, type PdsClient, type PdsRecord } from './xrpc.js';

/** The client surface the sync needs — structural, so tests can stub it. */
export type PdsRepo = Pick<PdsClient, 'listRecords' | 'getRecord' | 'putRecord'>;

/**
 * Opens an authenticated repo for the configured account. Production wiring is
 * oauth.ts#openPdsRepo (OAuth session restore); tests inject stubs.
 */
export type OpenRepo = (ctx: OpsContext) => Promise<{ did: string; repo: PdsRepo }>;

export const PUBLICATION_COLLECTION = 'site.standard.publication';
export const DOCUMENT_COLLECTION = 'site.standard.document';

/** Repo-relative paths of the two files `pds init` writes and the site ships. */
export const ATPROTO_JSON_PATH = 'src/data/atproto.json';
export const WELL_KNOWN_PATH = 'public/.well-known/site.standard.publication';

interface AtprotoSiteConfig {
  did: string;
  publicationUri: string;
}

export interface SyncSummary {
  publication: 'updated' | 'unchanged';
  created: string[];
  updated: string[];
  unchanged: number;
  /** rkeys of PDS document records with no matching local post (never deleted). */
  orphans: string[];
}

export function requirePdsConfig(ctx: OpsContext): PdsConfig {
  if (!ctx.config.pds) {
    throw new Error('config has no "pds" section — add it to ops/config/production.jsonc');
  }
  return ctx.config.pds;
}

/** Read src/data/atproto.json; undefined when the site has not been initialised. */
async function readAtprotoSiteConfig(repoRoot: string): Promise<AtprotoSiteConfig | undefined> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, ATPROTO_JSON_PATH), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const parsed = JSON.parse(text) as Partial<AtprotoSiteConfig>;
  if (!parsed.did || !parsed.publicationUri) return undefined;
  return { did: parsed.did, publicationUri: parsed.publicationUri };
}

/** Read the committed well-known file; undefined when absent. */
export async function readWellKnownUri(repoRoot: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(repoRoot, WELL_KNOWN_PATH), 'utf8');
    return text.trim() || undefined;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * The publication record as config + domain describe it. `siteUrl` must have
 * no trailing slash — standard.site appends the document `path`, which already
 * starts with one.
 */
export function publicationRecord(pds: PdsConfig, siteUrl: string): Record<string, unknown> {
  return {
    $type: PUBLICATION_COLLECTION,
    url: siteUrl,
    name: pds.name,
    ...(pds.description ? { description: pds.description } : {}),
    preferences: { showInDiscover: true },
  };
}

/** The document record for a post. */
export function documentRecord(publicationUri: string, post: PostMeta): Record<string, unknown> {
  return {
    $type: DOCUMENT_COLLECTION,
    site: publicationUri,
    title: post.title,
    path: postPath(post.slug),
    description: post.description,
    publishedAt: post.pubDate.toISOString(),
  };
}

/** Fields compared to decide whether an existing record needs a put. */
const DOCUMENT_DIFF_FIELDS = ['site', 'title', 'path', 'description', 'publishedAt'] as const;
const PUBLICATION_DIFF_FIELDS = ['url', 'name', 'description'] as const;

function recordsDiffer(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.some((f) => existing[f] !== desired[f]);
}

/** Put the publication record when it differs from (or is missing at) its rkey. */
export async function syncPublication(
  client: PdsRepo,
  desired: Record<string, unknown>,
  publicationUri: string,
): Promise<'updated' | 'unchanged'> {
  const rkey = rkeyFromUri(publicationUri);
  const existing = await client.getRecord(PUBLICATION_COLLECTION, rkey);
  if (existing && !recordsDiffer(existing.value, desired, PUBLICATION_DIFF_FIELDS)) {
    return 'unchanged';
  }
  await client.putRecord(PUBLICATION_COLLECTION, rkey, desired);
  return 'updated';
}

/**
 * Reconcile document records against the local posts: create missing rkeys,
 * update drifted ones, report (never delete) orphans. Adapted from
 * mastrojs/atproto createOrUpdateDocuments (MIT) onto the local XRPC client.
 */
export async function syncDocuments(
  client: PdsRepo,
  posts: PostMeta[],
  publicationUri: string,
): Promise<Omit<SyncSummary, 'publication'>> {
  const existing = new Map<string, PdsRecord>();
  for (const record of await client.listRecords(DOCUMENT_COLLECTION)) {
    if (record.value.site === publicationUri) existing.set(rkeyFromUri(record.uri), record);
  }

  const summary: Omit<SyncSummary, 'publication'> = {
    created: [],
    updated: [],
    unchanged: 0,
    orphans: [],
  };
  const localRkeys = new Set<string>();
  for (const post of posts) {
    const rkey = tidFromPath(postPath(post.slug));
    if (localRkeys.has(rkey)) throw new Error(`rkey collision for slug "${post.slug}"`);
    localRkeys.add(rkey);
    const desired = documentRecord(publicationUri, post);
    const current = existing.get(rkey);
    if (!current) {
      await client.putRecord(DOCUMENT_COLLECTION, rkey, desired);
      summary.created.push(post.slug);
    } else if (recordsDiffer(current.value, desired, DOCUMENT_DIFF_FIELDS)) {
      await client.putRecord(DOCUMENT_COLLECTION, rkey, desired);
      summary.updated.push(post.slug);
    } else {
      summary.unchanged += 1;
    }
  }
  for (const rkey of existing.keys()) {
    if (!localRkeys.has(rkey)) summary.orphans.push(rkey);
  }
  return summary;
}

/**
 * Full reconcile: OAuth session restore against the PDS, publication +
 * documents. The caller decides when this may run (production only) and
 * whether a failure is fatal.
 */
export async function syncPds(
  ctx: OpsContext,
  repoRoot: string,
  openRepo: OpenRepo,
): Promise<SyncSummary> {
  const pds = requirePdsConfig(ctx);
  const site = await readAtprotoSiteConfig(repoRoot);
  if (!site) {
    throw new Error(`${ATPROTO_JSON_PATH} is not initialised — run \`blog-ops pds init\` first`);
  }
  const wellKnown = await readWellKnownUri(repoRoot);
  if (wellKnown !== site.publicationUri) {
    throw new Error(
      `${WELL_KNOWN_PATH} (${wellKnown ?? 'missing'}) does not match ${ATPROTO_JSON_PATH} ` +
        `(${site.publicationUri}) — re-run \`blog-ops pds init\``,
    );
  }
  if (!ctx.domain) throw new Error('pds sync requires a configured domain');

  const { did, repo } = await openRepo(ctx);
  if (did !== site.did) {
    throw new Error(`session DID ${did} does not match ${ATPROTO_JSON_PATH} DID ${site.did}`);
  }

  const posts = await listPublishablePosts(repoRoot);
  const publication = await syncPublication(
    repo,
    publicationRecord(pds, `https://${ctx.domain}`),
    site.publicationUri,
  );
  const documents = await syncDocuments(repo, posts, site.publicationUri);
  return { publication, ...documents };
}
