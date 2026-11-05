import { AwsError } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { buildNodes } from './nodes.js';
import { createTestContext } from './test-support.js';

const OLD = 'arn:aws:acm:us-east-1:1:certificate/old';
const NEW = 'arn:aws:acm:us-east-1:1:certificate/new';

interface Harness {
  ctx: OpsContext;
  calls: string[];
  logs: string[];
  requested: Array<{ subject: string; token: string; sans: readonly string[] }>;
  upserts: Array<{ zone: string; name: string; type: string; value: string }>;
  deleted: string[];
}

interface Options {
  config?: Record<string, unknown>;
  state?: Record<string, Record<string, string | number | boolean | string[]>>;
  live?: { aliases: string[]; certificateArn: string | undefined } | undefined;
  prune?: boolean;
  zones?: Record<string, string>;
  /** What describeCertificate answers, one entry per call (the last repeats). */
  describes?: Array<{
    status: string;
    validation: Array<{ name: string; type: string; value: string; domain?: string; status?: string }>;
  }>;
  deleteFails?: boolean;
  dns?: Record<string, string>;
}

function harness(opts: Options = {}): Harness {
  const calls: string[] = [];
  const logs: string[] = [];
  const requested: Harness['requested'] = [];
  const upserts: Harness['upserts'] = [];
  const deleted: string[] = [];
  const describes = opts.describes ?? [{ status: 'ISSUED', validation: [] }];
  let describeCalls = 0;
  const log = (m: string) => void logs.push(m);
  const ctx = createTestContext({
    env: 'production',
    pruneAliases: opts.prune ?? false,
    config: { domain: 'example.com', ...opts.config },
    state: { resources: opts.state ?? {} },
    logger: { info: log, warn: log, ok: log, step: log },
    ports: { dns: { soa: async (n: string) => opts.dns?.[n] } },
    clients: {
      acm: {
        requestCertificate: async (
          subject: string,
          token: string,
          _tags: unknown,
          sans: readonly string[] = [],
        ) => {
          requested.push({ subject, token, sans });
          return NEW;
        },
        describeCertificate: async () => {
          const i = Math.min(describeCalls, describes.length - 1);
          describeCalls += 1;
          return describes[i];
        },
        deleteCertificate: async (arn: string) => {
          if (opts.deleteFails) {
            throw new AwsError({
            service: 'acm',
            code: 'ResourceInUseException',
            message: 'in use',
            statusCode: 400,
          });
          }
          deleted.push(arn);
        },
      } as never,
      cloudfront: {
        getDistributionAliases: async () => opts.live,
        setDistributionAliases: async (_id: string, aliases: string[], arn: string) => {
          calls.push(`setAliases ${aliases.join(',')} ${arn}`);
          return true;
        },
      } as never,
      route53: {
        hostedZoneId: async (name: string) => opts.zones?.[name],
        upsertRecord: async (zone: string, r: { name: string; type: string; value: string }) => {
          upserts.push({ zone, name: r.name, type: r.type, value: r.value });
        },
        deleteRecord: async (zone: string, r: { name: string; type: string; value: string }) => {
          calls.push(`deleteRecord ${zone} ${r.name} ${r.type}`);
        },
      } as never,
    },
  });
  return { ctx, calls, logs, requested, upserts, deleted };
}

function node(h: Harness, id: string) {
  const found = buildNodes(h.ctx).find((n) => n.id === id);
  if (!found) throw new Error(`${id} not in the graph`);
  return found;
}

const live = (aliases: string[], certificateArn?: string) => ({ aliases, certificateArn });
const DIST = { 'cloudfront-distribution': { id: 'D1', domainName: 'd1.cloudfront.net' } };

describe('certificate node with several hostnames', () => {
  it('requests one certificate: the primary as subject, the aliases as alternative names', async () => {
    const h = harness({ config: { aliases: ['www.example.com', 'example.org'] } });
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.requested).toHaveLength(1);
    expect(h.requested[0]).toMatchObject({
      subject: 'example.com',
      sans: ['www.example.com', 'example.org'],
    });
    expect(h.requested[0]?.token).toMatch(/^\w{1,32}$/);
    expect(h.ctx.state.resources['acm-certificate']).toMatchObject({
      arn: NEW,
      domains: ['example.com', 'example.org', 'www.example.com'],
    });
  });

  it('keeps the single-name request single-name', async () => {
    const h = harness();
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.requested[0]).toMatchObject({ subject: 'example.com', sans: [] });
  });

  it('is up to date when the recorded names match and the certificate is issued', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { 'acm-certificate': { arn: OLD, domains: ['www.example.com', 'example.com'] } },
    });
    expect(await node(h, 'acm-certificate').read(h.ctx)).toBe(true);
  });

  it('treats a pre-aliases certificate as current while only the primary is configured', async () => {
    const h = harness({ state: { 'acm-certificate': { arn: OLD } } });
    expect(await node(h, 'acm-certificate').read(h.ctx)).toBe(true);
  });

  it('needs a replacement once an alias is added', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { 'acm-certificate': { arn: OLD } },
    });
    expect(await node(h, 'acm-certificate').read(h.ctx)).toBe(false);
  });

  it('requests a replacement, remembers the old certificate and does not delete it', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { 'acm-certificate': { arn: OLD, domains: ['example.com'] } },
    });
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.requested).toHaveLength(1);
    expect(h.deleted).toEqual([]);
    expect(h.ctx.state.resources['acm-certificate']).toMatchObject({
      arn: NEW,
      previousArn: OLD,
      domains: ['example.com', 'www.example.com'],
    });
  });

  it('drops a never-attached pending certificate when the set changes again mid-swap', async () => {
    const PENDING = 'arn:aws:acm:us-east-1:1:certificate/pending';
    const h = harness({
      config: { aliases: ['www.example.com', 'example.org'] },
      state: {
        'acm-certificate': { arn: PENDING, previousArn: OLD, domains: ['example.com', 'www.example.com'] },
      },
    });
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.deleted).toEqual([PENDING]);
    expect(h.ctx.state.resources['acm-certificate']).toMatchObject({ arn: NEW, previousArn: OLD });
  });

  it('records nothing about the old certificate when the replacement request fails', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { 'acm-certificate': { arn: OLD, domains: ['example.com'] } },
    });
    (h.ctx.clients.acm as unknown as { requestCertificate: () => Promise<string> }).requestCertificate =
      async () => {
        throw new Error('quota');
      };
    await expect(node(h, 'acm-certificate').create(h.ctx)).rejects.toThrow('quota');
    expect(h.ctx.state.resources['acm-certificate']?.previousArn).toBeUndefined();
    expect(h.deleted).toEqual([]);
  });

  it('retires the attached certificate, not the older one, when the set changes after a swap whose cleanup was refused', async () => {
    const ATTACHED = 'arn:aws:acm:us-east-1:1:certificate/attached';
    const h = harness({
      config: { aliases: ['www.example.com', 'example.org'] },
      state: {
        ...DIST,
        'acm-certificate': { arn: ATTACHED, previousArn: OLD, domains: ['example.com', 'www.example.com'] },
      },
      live: live(['example.com', 'www.example.com'], ATTACHED),
    });
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.deleted).toEqual([OLD]);
    expect(h.ctx.state.resources['acm-certificate']).toMatchObject({ arn: NEW, previousArn: ATTACHED });
  });

  it('keeps and covers an attached alias that config does not name', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { ...DIST, 'acm-certificate': { arn: OLD, domains: ['example.com', 'www.example.com'] } },
      live: live(['example.com', 'www.example.com', 'legacy.example.com'], OLD),
    });
    expect(await node(h, 'acm-certificate').read(h.ctx)).toBe(false);
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.requested[0]?.sans).toEqual(['www.example.com', 'legacy.example.com']);
    expect(h.logs.join('\n')).toContain('legacy.example.com is attached');
  });

  it('with --prune-aliases requests the narrower set', async () => {
    const h = harness({
      prune: true,
      config: { aliases: ['www.example.com'] },
      state: { ...DIST, 'acm-certificate': { arn: OLD, domains: ['example.com', 'www.example.com', 'legacy.example.com'] } },
      live: live(['example.com', 'www.example.com', 'legacy.example.com'], OLD),
    });
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.requested[0]?.sans).toEqual(['www.example.com']);
  });

  it('prints only the pending validation records, per hostname', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      describes: [
        {
          status: 'PENDING_VALIDATION',
          validation: [
            { name: '_a.example.com.', type: 'CNAME', value: '_a.acm.', domain: 'example.com', status: 'SUCCESS' },
            { name: '_b.www.example.com.', type: 'CNAME', value: '_b.acm.', domain: 'www.example.com', status: 'PENDING_VALIDATION' },
          ],
        },
        { status: 'ISSUED', validation: [] },
      ],
    });
    await node(h, 'acm-certificate').create(h.ctx);
    const text = h.logs.join('\n');
    expect(text).toContain('Add these DNS records at your registrar');
    expect(text).toContain('www.example.com: CNAME  _b.www.example.com.  ->  _b.acm.');
    expect(text).not.toContain('_a.example.com.');
  });

  it('with manageDns creates validation records in Route 53 where the zone is, prints the rest', async () => {
    const h = harness({
      config: { aliases: ['www.example.com', 'example.org'], manageDns: true },
      zones: { 'example.com': 'ZCOM' },
      describes: [
        {
          status: 'PENDING_VALIDATION',
          validation: [
            { name: '_a.example.com.', type: 'CNAME', value: '_a.acm.', domain: 'example.com', status: 'PENDING_VALIDATION' },
            { name: '_b.www.example.com.', type: 'CNAME', value: '_b.acm.', domain: 'www.example.com', status: 'PENDING_VALIDATION' },
            { name: '_c.example.org.', type: 'CNAME', value: '_c.acm.', domain: 'example.org', status: 'PENDING_VALIDATION' },
          ],
        },
        { status: 'ISSUED', validation: [] },
      ],
    });
    await node(h, 'acm-certificate').create(h.ctx);
    expect(h.upserts.map((u) => `${u.zone} ${u.name}`)).toEqual([
      'ZCOM _a.example.com.',
      'ZCOM _b.www.example.com.',
    ]);
    const text = h.logs.join('\n');
    expect(text).toContain('example.org: CNAME  _c.example.org.');
    expect(text).not.toContain('example.com: CNAME  _a');
  });

  it('removes both certificates on teardown', async () => {
    const h = harness({ state: { 'acm-certificate': { arn: NEW, previousArn: OLD } } });
    await node(h, 'acm-certificate').delete(h.ctx);
    expect(h.deleted).toEqual([NEW, OLD]);
  });
});

describe('distribution aliases with several hostnames', () => {
  const state = {
    ...DIST,
    'acm-certificate': { arn: NEW, domains: ['example.com', 'www.example.com'] },
  };

  it('attaches every configured hostname and the multi-name certificate', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state,
      live: live(['example.com'], OLD),
    });
    await node(h, 'acm-certificate').read(h.ctx);
    await node(h, 'cloudfront-distribution').update?.(h.ctx);
    expect(h.calls).toContain(`setAliases example.com,www.example.com ${NEW}`);
  });

  it('re-attaches an alias the config does not name rather than dropping it', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state,
      live: live(['example.com', 'www.example.com', 'legacy.example.com'], NEW),
    });
    await node(h, 'acm-certificate').read(h.ctx);
    await node(h, 'cloudfront-distribution').update?.(h.ctx);
    expect(h.calls).toContain(`setAliases example.com,www.example.com,legacy.example.com ${NEW}`);
  });

  it('with --prune-aliases detaches it', async () => {
    const h = harness({
      prune: true,
      config: { aliases: ['www.example.com'] },
      state,
      live: live(['example.com', 'www.example.com', 'legacy.example.com'], NEW),
    });
    await node(h, 'acm-certificate').read(h.ctx);
    await node(h, 'cloudfront-distribution').update?.(h.ctx);
    expect(h.calls).toContain(`setAliases example.com,www.example.com ${NEW}`);
  });

  it('deletes the superseded certificate once the distribution carries the new one', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { ...state, 'acm-certificate': { ...state['acm-certificate'], previousArn: OLD } },
      live: live(['example.com', 'www.example.com'], NEW),
    });
    await node(h, 'acm-certificate').read(h.ctx);
    await node(h, 'cloudfront-distribution').update?.(h.ctx);
    expect(h.deleted).toEqual([OLD]);
    expect(h.ctx.state.resources['acm-certificate']?.previousArn).toBeUndefined();
  });

  it('leaves the old certificate alone while the distribution still carries it', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state: { ...state, 'acm-certificate': { ...state['acm-certificate'], previousArn: OLD } },
      live: live(['example.com', 'www.example.com'], OLD),
    });
    await node(h, 'acm-certificate').read(h.ctx);
    await node(h, 'cloudfront-distribution').update?.(h.ctx);
    expect(h.deleted).toEqual([]);
    expect(h.ctx.state.resources['acm-certificate']?.previousArn).toBe(OLD);
  });

  it('keeps the old certificate for the next run when ACM still refuses to delete it', async () => {
    const h = harness({
      deleteFails: true,
      config: { aliases: ['www.example.com'] },
      state: { ...state, 'acm-certificate': { ...state['acm-certificate'], previousArn: OLD } },
      live: live(['example.com', 'www.example.com'], NEW),
    });
    await node(h, 'acm-certificate').read(h.ctx);
    await node(h, 'cloudfront-distribution').update?.(h.ctx);
    expect(h.ctx.state.resources['acm-certificate']?.previousArn).toBe(OLD);
    expect(h.logs.join('\n')).toContain('will be retried on the next bootstrap');
  });
});

describe('site-dns node', () => {
  const state = { ...DIST, 'acm-certificate': { arn: NEW } };

  it('is only in the production graph of a site with a domain', () => {
    const withDomain = harness();
    expect(buildNodes(withDomain.ctx).some((n) => n.id === 'site-dns')).toBe(true);
    const preview = createTestContext({ preview: true, config: { domain: 'preview.example.com' } });
    expect(buildNodes(preview).some((n) => n.id === 'site-dns')).toBe(false);
    expect(buildNodes(createTestContext()).some((n) => n.id === 'site-dns')).toBe(false);
  });

  it('prints an apex and a sub-domain differently, from what DNS says about their zone', async () => {
    const h = harness({
      config: { aliases: ['www.example.com'] },
      state,
      dns: { 'example.com': 'ns admin 1', 'www.example.com': 'ns admin 1' },
    });
    await node(h, 'site-dns').create(h.ctx);
    const text = h.logs.join('\n');
    expect(text).toContain('Point these hostnames at d1.cloudfront.net');
    expect(text).toContain('example.com  ALIAS/ANAME -> d1.cloudfront.net');
    expect(text).toContain('www.example.com  CNAME -> d1.cloudfront.net');
    expect(h.upserts).toEqual([]);
  });

  it('prints the guidance once, then stays quiet until something changes', async () => {
    const h = harness({ config: { aliases: ['www.example.com'] }, state });
    await node(h, 'site-dns').create(h.ctx);
    const first = h.logs.length;
    expect(first).toBeGreaterThan(0);
    await node(h, 'site-dns').update?.(h.ctx);
    expect(h.logs.length).toBe(first);
  });

  it('with manageDns writes A and AAAA alias records for hosts with a Route 53 zone', async () => {
    const h = harness({
      config: { aliases: ['www.example.com', 'example.org'], manageDns: true },
      state,
      zones: { 'example.com': 'ZCOM' },
    });
    await node(h, 'site-dns').create(h.ctx);
    expect(h.upserts.map((u) => `${u.zone} ${u.name} ${u.type} ${u.value}`)).toEqual([
      'ZCOM example.com A d1.cloudfront.net',
      'ZCOM example.com AAAA d1.cloudfront.net',
      'ZCOM www.example.com A d1.cloudfront.net',
      'ZCOM www.example.com AAAA d1.cloudfront.net',
    ]);
    const text = h.logs.join('\n');
    expect(text).toContain('example.org');
    expect(h.ctx.state.resources['site-dns']).toMatchObject({
      hosts: ['example.com', 'www.example.com'],
      zoneIds: ['ZCOM', 'ZCOM'],
    });
  });

  it('keeps track of records it wrote for a host that is still served but no longer managed', async () => {
    const h = harness({
      config: { manageDns: false },
      state: { ...state, 'site-dns': { signature: 'x', hosts: ['example.com'], zoneIds: ['ZCOM'] } },
    });
    await node(h, 'site-dns').update?.(h.ctx);
    expect(h.calls).toEqual([]);
    expect(h.ctx.state.resources['site-dns']).toMatchObject({ hosts: ['example.com'], zoneIds: ['ZCOM'] });
  });

  it('removes the records it wrote for a host that is no longer served, and on teardown', async () => {
    const h = harness({
      config: { manageDns: true },
      state: {
        ...state,
        'site-dns': { signature: 'x', hosts: ['example.com', 'gone.example.com'], zoneIds: ['ZCOM', 'ZCOM'] },
      },
      zones: { 'example.com': 'ZCOM' },
    });
    await node(h, 'site-dns').update?.(h.ctx);
    expect(h.calls).toEqual(['deleteRecord ZCOM gone.example.com A', 'deleteRecord ZCOM gone.example.com AAAA']);
    h.calls.length = 0;
    await node(h, 'site-dns').delete(h.ctx);
    expect(h.calls).toEqual(['deleteRecord ZCOM example.com A', 'deleteRecord ZCOM example.com AAAA']);
  });
});
