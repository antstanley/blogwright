import { describe, expect, it } from 'vitest';

import {
  certificateToken,
  configuredHostnames,
  desiredHostnames,
  findHostedZone,
  findZoneApex,
  recordedDomains,
  routingGuidance,
  sameSet,
} from './domains.js';
import type { DnsPort } from './ports.js';
import { createTestContext } from './test-support.js';

/** A DNS fake: zones maps a name to the SOA it answers; a CNAME name answers its target's. */
function dnsWith(soas: Record<string, string>, throwOn?: string): DnsPort {
  return {
    soa: async (name) => {
      if (name === throwOn) throw new Error('no resolver answered');
      return soas[name];
    },
  };
}

describe('findZoneApex', () => {
  const dns = dnsWith({
    'example.com': 'ns1 admin 7',
    // `www` is a CNAME to the apex, so a resolver answers its SOA query with the apex's.
    'www.example.com': 'ns1 admin 7',
    'example.co.uk': 'ns2 admin 3',
    'co.uk': 'nominet admin 1',
    'blog.example.com': 'ns9 admin 1',
    com: 'gtld admin 1',
  });

  it('finds the apex when the host is the apex', async () => {
    expect(await findZoneApex(dns, 'example.com')).toBe('example.com');
  });

  it('does not mistake a CNAME to the apex for an apex', async () => {
    expect(await findZoneApex(dns, 'www.example.com')).toBe('example.com');
  });

  it('classifies a host under a multi-label public suffix without a suffix list', async () => {
    expect(await findZoneApex(dns, 'example.co.uk')).toBe('example.co.uk');
    expect(await findZoneApex(dns, 'www.example.co.uk')).toBe('example.co.uk');
  });

  it('treats a delegated sub-zone as its own apex', async () => {
    expect(await findZoneApex(dns, 'blog.example.com')).toBe('blog.example.com');
  });

  it('finds the zone of a host that has no records of its own', async () => {
    expect(await findZoneApex(dns, 'deep.nested.example.com')).toBe('example.com');
  });

  it('is undefined when nothing answers or the resolvers fail', async () => {
    expect(await findZoneApex(dnsWith({}), 'new.example.net')).toBeUndefined();
    expect(await findZoneApex(dnsWith({ 'example.com': 's' }, 'example.com'), 'example.com')).toBe(
      undefined,
    );
  });
});

describe('routingGuidance', () => {
  const dns = dnsWith({ 'example.com': 's 1', 'www.example.com': 's 1' });
  it('asks for ALIAS/ANAME at an apex, a CNAME below it, and both when the zone is unknown', async () => {
    expect(await routingGuidance(dns, 'example.com', 'd1.cloudfront.net')).toMatch(
      /^example\.com {2}ALIAS\/ANAME -> d1\.cloudfront\.net/,
    );
    expect(await routingGuidance(dns, 'www.example.com', 'd1.cloudfront.net')).toBe(
      'www.example.com  CNAME -> d1.cloudfront.net',
    );
    expect(await routingGuidance(dnsWith({}), 'example.org', 'd1.cloudfront.net')).toContain(
      'zone could not be looked up',
    );
  });
});

describe('findHostedZone', () => {
  it('tries the host and then each parent, stopping above the bare TLD', async () => {
    const asked: string[] = [];
    const route53 = {
      hostedZoneId: async (name: string) => {
        asked.push(name);
        return name === 'example.com' ? 'Z1' : undefined;
      },
    };
    expect(await findHostedZone(route53, 'www.example.com')).toEqual({
      zoneId: 'Z1',
      zone: 'example.com',
    });
    expect(asked).toEqual(['www.example.com', 'example.com']);
    asked.length = 0;
    expect(await findHostedZone({ hostedZoneId: async (n) => void asked.push(n) }, 'a.b.org')).toBe(
      undefined,
    );
    expect(asked).toEqual(['a.b.org', 'b.org']);
  });
});

describe('name sets', () => {
  it('compares sets regardless of order', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameSet(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  it('derives a stable ACM token of at most 32 word characters', () => {
    const a = certificateToken('site', 'production', ['example.com', 'www.example.com']);
    expect(a).toMatch(/^\w{1,32}$/);
    expect(a).toBe(certificateToken('site', 'production', ['www.example.com', 'example.com']));
    expect(a).not.toBe(certificateToken('site', 'production', ['example.com']));
    expect(a).not.toBe(certificateToken('site', 'staging', ['example.com', 'www.example.com']));
  });

  it('lists the primary first, then the aliases, and nothing without a domain', () => {
    const ctx = createTestContext({
      config: { domain: 'example.com', aliases: ['www.example.com', 'example.org'] },
    });
    expect(configuredHostnames(ctx)).toEqual(['example.com', 'www.example.com', 'example.org']);
    expect(configuredHostnames(createTestContext())).toEqual([]);
  });

  it('treats a certificate recorded before aliases existed as covering the primary', () => {
    const legacy = createTestContext({
      config: { domain: 'example.com' },
      state: { resources: { 'acm-certificate': { arn: 'arn:old' } } },
    });
    expect(recordedDomains(legacy)).toEqual(['example.com']);
    const recorded = createTestContext({
      config: { domain: 'example.com' },
      state: { resources: { 'acm-certificate': { arn: 'a', domains: ['example.com', 'x.org'] } } },
    });
    expect(recordedDomains(recorded)).toEqual(['example.com', 'x.org']);
  });
});

describe('desiredHostnames', () => {
  function ctxWith(opts: { prune?: boolean; live?: string[] | undefined }) {
    const warnings: string[] = [];
    const ctx = createTestContext({
      pruneAliases: opts.prune ?? false,
      config: { domain: 'example.com', aliases: ['www.example.com'] },
      state: { resources: { 'cloudfront-distribution': { id: 'D1' } } },
      logger: { warn: (m: string) => void warnings.push(m) },
      clients: {
        cloudfront: {
          getDistributionAliases: async () =>
            opts.live === undefined ? undefined : { aliases: opts.live, certificateArn: undefined },
        } as never,
      },
    });
    return { ctx, warnings };
  }

  it('is just the configured set when the distribution carries nothing extra', async () => {
    const { ctx, warnings } = ctxWith({ live: ['example.com', 'www.example.com'] });
    expect(await desiredHostnames(ctx)).toEqual(['example.com', 'www.example.com']);
    expect(warnings).toEqual([]);
  });

  it('keeps an attached alias config does not name, and says so once', async () => {
    const { ctx, warnings } = ctxWith({ live: ['example.com', 'old.example.com'] });
    expect(await desiredHostnames(ctx)).toEqual([
      'example.com',
      'www.example.com',
      'old.example.com',
    ]);
    await desiredHostnames(ctx);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('old.example.com');
    expect(warnings[0]).toContain('--prune-aliases');
  });

  it('drops the undeclared alias only when pruning', async () => {
    const { ctx, warnings } = ctxWith({ prune: true, live: ['example.com', 'old.example.com'] });
    expect(await desiredHostnames(ctx)).toEqual(['example.com', 'www.example.com']);
    expect(warnings.join()).toContain('detaching aliases not in config: old.example.com');
  });

  it('has nothing to keep for a distribution that is gone', async () => {
    const { ctx } = ctxWith({ live: undefined });
    expect(await desiredHostnames(ctx)).toEqual(['example.com', 'www.example.com']);
  });
});
