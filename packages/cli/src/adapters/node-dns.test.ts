import { describe, expect, it } from 'vitest';

import { createNodeDns, type SoaResolver } from './node-dns.js';

const SOA = { nsname: 'ns1.example.com', hostmaster: 'admin.example.com', serial: 42 };

function resolver(
  answer: (name: string) => Promise<typeof SOA>,
): SoaResolver & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolveSoa: async (name) => {
      asked.push(name);
      return answer(name);
    },
  };
}

const failure = (code: string) => Object.assign(new Error(code), { code });

describe('createNodeDns', () => {
  it('fingerprints the SOA the system resolver answers with, never touching the public ones', async () => {
    const system = resolver(async () => SOA);
    let built = 0;
    const dns = createNodeDns(system, () => {
      built += 1;
      return resolver(async () => SOA);
    });
    expect(await dns.soa('example.com')).toBe('ns1.example.com admin.example.com 42');
    expect(built).toBe(0);
  });

  it.each(['ENODATA', 'ENOTFOUND', 'NXDOMAIN'])(
    'treats %s as "no SOA" and does not fall back',
    async (code) => {
      let built = 0;
      const dns = createNodeDns(
        resolver(async () => Promise.reject(failure(code))),
        () => {
          built += 1;
          return resolver(async () => SOA);
        },
      );
      expect(await dns.soa('www.example.com')).toBeUndefined();
      expect(built).toBe(0);
    },
  );

  it.each(['ETIMEOUT', 'ESERVFAIL', 'EREFUSED', 'ECONNREFUSED'])(
    'retries a %s against the public resolvers',
    async (code) => {
      const publicResolver = resolver(async () => SOA);
      const dns = createNodeDns(
        resolver(async () => Promise.reject(failure(code))),
        () => publicResolver,
      );
      expect(await dns.soa('example.com')).toBe('ns1.example.com admin.example.com 42');
      expect(publicResolver.asked).toEqual(['example.com']);
    },
  );

  it('lets the public resolvers say "no SOA" after the system resolver failed', async () => {
    const dns = createNodeDns(
      resolver(async () => Promise.reject(failure('ETIMEOUT'))),
      () => resolver(async () => Promise.reject(failure('ENODATA'))),
    );
    expect(await dns.soa('example.com')).toBeUndefined();
  });

  it('throws when no resolver could answer at all', async () => {
    const dns = createNodeDns(
      resolver(async () => Promise.reject(failure('ETIMEOUT'))),
      () => resolver(async () => Promise.reject(failure('ESERVFAIL'))),
    );
    await expect(dns.soa('example.com')).rejects.toThrow('ESERVFAIL');
  });
});
