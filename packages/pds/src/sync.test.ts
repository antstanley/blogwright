import { join } from 'node:path';

import { createNodeFileSystem } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { PdsContext } from './context.js';
import { createTestContext, makeTempDir, removeTempDir } from './test-support.js';
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

  it('preserves preferences set out-of-band when pushing a config-driven update', async () => {
    const repo = new StubRepo();
    await syncPublication(repo, desired, PUB_URI);
    const key = `${PUBLICATION_COLLECTION}/3abc`;
    const stored = repo.records.get(key);
    repo.records.set(key, {
      ...stored!,
      value: { ...stored!.value, preferences: { showInDiscover: false } },
    });

    await syncPublication(repo, { ...desired, name: 'Renamed' }, PUB_URI);

    const updated = repo.records.get(key)!.value as { preferences: { showInDiscover: boolean } };
    expect(updated.preferences).toEqual({ showInDiscover: false });
  });
});

describe('syncPds', () => {
  const ROOT = '/repo';
  const HELLO_POST = `---\ntitle: 'Hello'\ndescription: 'First.'\npubDate: 2026-06-20\n---\n\nHi.\n`;

  async function ctx(): Promise<PdsContext> {
    const c = createTestContext({
      env: 'production',
      domain: 'example.com',
      config: { pds: { name: 'Ant Stanley', secretName: 's' } },
    });
    await c.ports.fs.writeText(`${ROOT}/src/content/blog/hello-world.md`, HELLO_POST);
    return c;
  }

  function opens(repo: PdsRepo, did = DID): OpenRepo {
    return async () => ({ did, repo });
  }

  async function initialise(c: PdsContext, uri = PUB_URI, did = DID): Promise<void> {
    await c.ports.fs.writeText(
      `${ROOT}/src/data/atproto.json`,
      JSON.stringify({ did, publicationUri: uri }),
    );
    await c.ports.fs.writeText(`${ROOT}/public/.well-known/site.standard.publication`, `${uri}\n`);
  }

  it('refuses when atproto.json is missing entirely', async () => {
    const c = await ctx();
    await expect(syncPds(c, ROOT, opens(new StubRepo()))).rejects.toThrow(/pds init/);
  });

  it('refuses when atproto.json is uninitialised', async () => {
    const c = await ctx();
    await c.ports.fs.writeText(`${ROOT}/src/data/atproto.json`, '{"did":"","publicationUri":""}');
    await expect(syncPds(c, ROOT, opens(new StubRepo()))).rejects.toThrow(/pds init/);
  });

  it('refuses when the well-known file is missing', async () => {
    const c = await ctx();
    await c.ports.fs.writeText(
      `${ROOT}/src/data/atproto.json`,
      JSON.stringify({ did: DID, publicationUri: PUB_URI }),
    );
    await expect(syncPds(c, ROOT, opens(new StubRepo()))).rejects.toThrow(
      /missing.*does not match/,
    );
  });

  it('refuses when the well-known file disagrees with atproto.json', async () => {
    const c = await ctx();
    await initialise(c);
    await c.ports.fs.writeText(
      `${ROOT}/public/.well-known/site.standard.publication`,
      'at://other\n',
    );
    await expect(syncPds(c, ROOT, opens(new StubRepo()))).rejects.toThrow(/does not match/);
  });

  it('refuses when the session DID differs from the committed one', async () => {
    const c = await ctx();
    await initialise(c, PUB_URI, 'did:plc:someone-else');
    await expect(syncPds(c, ROOT, opens(new StubRepo()))).rejects.toThrow(/does not match/);
  });

  it('creates the publication and document records end to end', async () => {
    const c = await ctx();
    await initialise(c);
    const repo = new StubRepo();
    const summary = await syncPds(c, ROOT, opens(repo));
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

  it('reconciles a real directory tree through the node adapter', async () => {
    const root = await makeTempDir('pds-sync');
    try {
      const fs = createNodeFileSystem();
      const c = createTestContext({
        env: 'production',
        domain: 'example.com',
        config: { pds: { name: 'Ant Stanley', secretName: 's' } },
        ports: { fs },
      });
      await fs.writeText(join(root, 'src/content/blog/hello-world.md'), HELLO_POST);
      await fs.writeText(
        join(root, 'src/data/atproto.json'),
        JSON.stringify({ did: DID, publicationUri: PUB_URI }),
      );
      await fs.writeText(
        join(root, 'public/.well-known/site.standard.publication'),
        `${PUB_URI}\n`,
      );
      const repo = new StubRepo();
      const summary = await syncPds(c, root, opens(repo));
      expect(summary.publication).toBe('updated');
      expect(summary.created).toEqual(['hello-world']);
    } finally {
      await removeTempDir(root);
    }
  });
});
