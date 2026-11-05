/**
 * `node:dns` adapter for the DnsPort: SOA lookups through the system resolver,
 * retried once against public resolvers when the system resolver fails to
 * answer. A definite negative (the name has no SOA) is an answer, not a
 * failure, and never triggers the fallback.
 */

import { promises as dns } from 'node:dns';

import type { DnsPort } from '../ports.js';

/** Public resolvers tried, in order, when the system resolver cannot answer. */
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'] as const;

/** Codes meaning "the resolver answered: this name has no SOA record". */
const NEGATIVE = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

/** The slice of a resolver the adapter uses; both `dns.promises` and a `Resolver` fit. */
export interface SoaResolver {
  resolveSoa(name: string): Promise<{ nsname: string; hostmaster: string; serial: number }>;
}

function code(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}

/**
 * Build the port. `system` and `publicResolver` are injectable for tests;
 * `publicResolver` is built lazily so a run that never needs it makes none.
 */
export function createNodeDns(
  system: SoaResolver = dns,
  publicResolver: () => SoaResolver = () => {
    const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([...PUBLIC_RESOLVERS]);
    return resolver;
  },
): DnsPort {
  async function ask(resolver: SoaResolver, name: string): Promise<string | undefined> {
    try {
      const r = await resolver.resolveSoa(name);
      return `${r.nsname} ${r.hostmaster} ${r.serial}`;
    } catch (err) {
      if (NEGATIVE.has(code(err))) return undefined;
      throw err;
    }
  }
  return {
    async soa(name) {
      try {
        return await ask(system, name);
      } catch {
        // The system resolver did not answer; ask the public ones. Their own
        // failure propagates so the caller can tell "no answer" from "no SOA".
        return await ask(publicResolver(), name);
      }
    },
  };
}
