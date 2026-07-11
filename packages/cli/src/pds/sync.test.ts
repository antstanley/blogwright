import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CONFIG } from 'blogwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpsContext } from '../context.js';
import { postPath, tidFromPath } from './rkey.js';
import {
  DOCUMENT_COLLECTION,
  PUBLICATION_COLLECTION,
  documentRecord,
  syncDocuments,
  syncPds,
  syncPublication,
  type OpenRepo,
  type PdsRepo,
} from './sync.js';
import type { PdsRecord } from './xrpc.js';

const DID = 'did:plc:test';
const PUB_URI = `at://${DID}/${PUBLICATION_COLLECTION}/3abc`;

/** In-memory PDS repo that records every write. */
class StubRepo implements PdsRepo {
  records = new Map<string, PdsRecord>(); // key: collection/rkey
  writes: string[] = [];
  did = DID;

  seed(collection: string, rkey: string, value: Record<string, unknown>): void {
    this.records.set(`${collection}/${rkey}`, {
      uri: `at://${this.did}/${collection}/${rkey}`,
      cid: 'cid',
      value,
    });
  }

  async listRecords(collection: string): Promise<PdsRecord[]> {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${collection}/`))
      .map(([, record]) => record);
  }

  async getRecord(collection: string, rkey: string): Promise<PdsRecord | undefined> {
    return this.records.get(`${collection}/${rkey}`);
  }

  async putRecord(collection: string, rkey: string, record: Record<string, unknown>) {
    this.writes.push(`${collection}/${rkey}`);
    this.seed(collection, rkey, record);
    return { uri: `at://${this.did}/${collection}/${rkey}` };
  }
}

const POSTS = [
  { slug: 'hello-world', title: 'Hello', description: 'First.', pubDate: new Date('2026-06-20') },
  { slug: 'second', title: 'Second', description: 'More.', pubDate: new Date('2026-06-28') },
];

describe('syncDocuments', () => {
  it('creates every record on first run and none on the second', async () => {
    const repo = new StubRepo();
    const first = await syncDocuments(repo, POSTS, PUB_URI);
    expect(first.created.sort()).toEqual(['hello-world', 'second']);
    expect(repo.writes).toHaveLength(2);

    const second = await syncDocuments(repo, POSTS, PUB_URI);
    expect(second).toEqual({ created: [], updated: [], unchanged: 2, orphans: [] });
    expect(repo.writes).toHaveLength(2); // idempotent — no further writes
  });

  it('updates only the record whose fields drifted', async () => {
    const repo = new StubRepo();
    await syncDocuments(repo, POSTS, PUB_URI);
    repo.writes = [];
    const edited = [{ ...POSTS[0]!, title: 'Hello, again' }, POSTS[1]!];
    const summary = await syncDocuments(repo, edited, PUB_URI);
    expect(summary.updated).toEqual(['hello-world']);
    expect(summary.unchanged).toBe(1);
    expect(repo.writes).toEqual([`${DOCUMENT_COLLECTION}/${tidFromPath(postPath('hello-world'))}`]);
  });

  it('warns about (never deletes) records for removed posts', async () => {
    const repo = new StubRepo();
    await syncDocuments(repo, POSTS, PUB_URI);
    const summary = await syncDocuments(repo, [POSTS[1]!], PUB_URI);
    expect(summary.orphans).toEqual([tidFromPath(postPath('hello-world'))]);
    expect(repo.records.size).toBe(2); // nothing deleted
  });

  it('ignores documents belonging to a different publication', async () => {
    const repo = new StubRepo();
    repo.seed(DOCUMENT_COLLECTION, 'otherkey', { site: 'at://other/pub/x', title: 'x' });
    const summary = await syncDocuments(repo, [], PUB_URI);
    expect(summary.orphans).toEqual([]);
  });
});

describe('syncPublication', () => {
  const desired = {
    $type: PUBLICATION_COLLECTION,
    url: 'https://example.com/',
    name: 'Ant Stanley',
    description: 'd',
    preferences: { showInDiscover: true },
  };

  it('puts when missing, skips when identical, puts when drifted', async () => {
    const repo = new StubRepo();
    expect(await syncPublication(repo, desired, PUB_URI)).toBe('updated');
    expect(await syncPublication(repo, desired, PUB_URI)).toBe('unchanged');
    expect(await syncPublication(repo, { ...desired, name: 'New' }, PUB_URI)).toBe('updated');
    expect(repo.writes).toHaveLength(2);
  });
});

describe('syncPds', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pds-sync-'));
    await mkdir(join(root, 'src/data'), { recursive: true });
    await mkdir(join(root, 'src/content/blog'), { recursive: true });
    await mkdir(join(root, 'public/.well-known'), { recursive: true });
    await writeFile(
      join(root, 'src/content/blog/hello-world.md'),
      `---\ntitle: 'Hello'\ndescription: 'First.'\npubDate: 2026-06-20\n---\n\nHi.\n`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function ctx(): OpsContext {
    return {
      env: 'production',
      domain: 'example.com',
      config: { paths: DEFAULT_CONFIG.paths, pds: { name: 'Ant Stanley', secretName: 's' } },
    } as unknown as OpsContext;
  }

  function opens(repo: PdsRepo, did = DID): OpenRepo {
    return async () => ({ did, repo });
  }

  async function initialise(uri = PUB_URI, did = DID): Promise<void> {
    await writeFile(
      join(root, 'src/data/atproto.json'),
      JSON.stringify({ did, publicationUri: uri }),
    );
    await writeFile(join(root, 'public/.well-known/site.standard.publication'), `${uri}\n`);
  }

  it('refuses when atproto.json is uninitialised', async () => {
    await writeFile(join(root, 'src/data/atproto.json'), '{"did":"","publicationUri":""}');
    await expect(syncPds(ctx(), root, opens(new StubRepo()))).rejects.toThrow(/pds init/);
  });

  it('refuses when the well-known file disagrees with atproto.json', async () => {
    await initialise();
    await writeFile(join(root, 'public/.well-known/site.standard.publication'), 'at://other\n');
    await expect(syncPds(ctx(), root, opens(new StubRepo()))).rejects.toThrow(/does not match/);
  });

  it('refuses when the session DID differs from the committed one', async () => {
    await initialise(PUB_URI, 'did:plc:someone-else');
    await expect(syncPds(ctx(), root, opens(new StubRepo()))).rejects.toThrow(/does not match/);
  });

  it('creates the publication and document records end to end', async () => {
    await initialise();
    const repo = new StubRepo();
    const summary = await syncPds(ctx(), root, opens(repo));
    expect(summary.publication).toBe('updated');
    expect(summary.created).toEqual(['hello-world']);
    const pub = repo.records.get(`${PUBLICATION_COLLECTION}/3abc`);
    expect(pub?.value.url).toBe('https://example.com'); // no trailing slash (standard.site)
    const doc = repo.records.get(`${DOCUMENT_COLLECTION}/${tidFromPath(postPath('hello-world'))}`);
    expect(doc?.value).toEqual(
      documentRecord(PUB_URI, {
        slug: 'hello-world',
        title: 'Hello',
        description: 'First.',
        pubDate: new Date('2026-06-20'),
      }),
    );
  });
});
