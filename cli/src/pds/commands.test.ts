import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpsContext } from '../context.js';
import { secretSet, syncAfterDeploy } from './commands.js';
import type { SyncSummary } from './sync.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pds-hook-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function ctx(env: string, pdsConfigured = true): OpsContext & { lines: string[] } {
  const lines: string[] = [];
  const log = (prefix: string) => (msg: string) => lines.push(`${prefix}:${msg}`);
  return {
    env,
    config: pdsConfigured ? { pds: { name: 'x', service: 'https://x', secretName: 's' } } : {},
    logger: { info: log('info'), step: log('step'), ok: log('ok'), warn: log('warn'), error: log('error') },
    lines,
  } as unknown as OpsContext & { lines: string[] };
}

async function markInitialised(): Promise<void> {
  await mkdir(join(root, 'public/.well-known'), { recursive: true });
  await writeFile(join(root, 'public/.well-known/site.standard.publication'), 'at://x/p/r\n');
}

const SUMMARY: SyncSummary = {
  publication: 'unchanged',
  created: [],
  updated: [],
  unchanged: 1,
  orphans: [],
};

describe('secretSet', () => {
  function ctxWithStore(): OpsContext & { stored: Record<string, string> } {
    const stored: Record<string, string> = {};
    return {
      config: { pds: { name: 'x', service: 'https://bsky.social', secretName: 's' } },
      clients: {
        secrets: {
          upsertSecret: async (name: string, value: string) => {
            stored[name] = value;
          },
        },
      },
      logger: { ok: () => undefined },
      stored,
    } as unknown as OpsContext & { stored: Record<string, string> };
  }

  it('stores identifier, password, and the default service', async () => {
    const c = ctxWithStore();
    await secretSet(c, { identifier: 'did:plc:me', password: 'app-pass' });
    expect(JSON.parse(c.stored.s as string)).toEqual({
      identifier: 'did:plc:me',
      password: 'app-pass',
      service: 'https://bsky.social',
    });
  });

  it('stores an explicit service override', async () => {
    const c = ctxWithStore();
    await secretSet(c, {
      identifier: 'did:plc:me',
      password: 'p',
      service: 'https://pds.example',
    });
    expect(JSON.parse(c.stored.s as string).service).toBe('https://pds.example');
  });

  it('requires identifier and password, and an https service', async () => {
    const c = ctxWithStore();
    await expect(secretSet(c, { password: 'p' })).rejects.toThrow(/--identifier/);
    await expect(secretSet(c, { identifier: 'x' })).rejects.toThrow(/--password/);
    await expect(
      secretSet(c, { identifier: 'x', password: 'p', service: 'http://pds' }),
    ).rejects.toThrow(/https/);
    await expect(
      secretSet(c, { identifier: 'x', password: 'p', service: 'nope' }),
    ).rejects.toThrow(/URL/);
    expect(c.stored).toEqual({});
  });
});

describe('syncAfterDeploy', () => {
  it('does nothing outside production or when pds is unconfigured', async () => {
    let calls = 0;
    const count = async () => ((calls += 1), SUMMARY);
    await syncAfterDeploy(ctx('staging'), root, count);
    await syncAfterDeploy(ctx('production', false), root, count);
    expect(calls).toBe(0);
  });

  it('skips (with a note) when the site is not initialised', async () => {
    const c = ctx('production');
    let calls = 0;
    await syncAfterDeploy(c, root, async () => ((calls += 1), SUMMARY));
    expect(calls).toBe(0);
    expect(c.lines.some((l) => l.includes('not initialised'))).toBe(true);
  });

  it('runs the sync and logs the summary when initialised', async () => {
    await markInitialised();
    const c = ctx('production');
    await syncAfterDeploy(c, root, async () => SUMMARY);
    expect(c.lines.some((l) => l.startsWith('ok:') && l.includes('1 unchanged'))).toBe(true);
  });

  it('never lets a sync failure escape (deploy must not fail)', async () => {
    await markInitialised();
    const c = ctx('production');
    await expect(
      syncAfterDeploy(c, root, async () => {
        throw new Error('PDS is down');
      }),
    ).resolves.toBeUndefined();
    expect(c.lines.some((l) => l.startsWith('warn:') && l.includes('PDS is down'))).toBe(true);
  });
});
