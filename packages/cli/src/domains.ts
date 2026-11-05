/**
 * The hostnames a production environment serves and the questions asked about
 * them: which set the certificate and distribution should carry, which
 * attached aliases config does not name, which DNS zone a host sits in, and
 * whether it is that zone's apex.
 */

import { createHash } from 'node:crypto';

import type { AwsClients } from 'blogwright-core';

import type { OpsContext } from './context.js';
import type { DnsPort } from './ports.js';

/** The primary then the configured aliases; empty when no domain is configured. */
export function configuredHostnames(ctx: Pick<OpsContext, 'domain' | 'config'>): string[] {
  return ctx.domain ? [ctx.domain, ...ctx.config.aliases] : [];
}

/** Per-run desired set, so the certificate and distribution nodes agree and drift is reported once. */
const desiredCache = new WeakMap<OpsContext, string[]>();

/**
 * The hostnames this run should serve: `configuredHostnames` plus any alias
 * already attached to the distribution that config does not name. Those are
 * kept (and kept on the certificate) so editing config never drops a live
 * host; `--prune-aliases` leaves them out. Reports each such alias once.
 */
export async function desiredHostnames(ctx: OpsContext): Promise<string[]> {
  const cached = desiredCache.get(ctx);
  if (cached) return cached;
  const configured = configuredHostnames(ctx);
  let desired = configured;
  const id = ctx.state.resources['cloudfront-distribution']?.id;
  if (ctx.domain && typeof id === 'string') {
    const live = await ctx.clients.cloudfront.getDistributionAliases(id);
    const undeclared = (live?.aliases ?? []).filter((a) => !configured.includes(a)).sort();
    if (undeclared.length > 0 && ctx.pruneAliases) {
      ctx.logger.warn(`detaching aliases not in config: ${undeclared.join(', ')}`);
    } else if (undeclared.length > 0) {
      for (const alias of undeclared) {
        ctx.logger.warn(
          `${alias} is attached to the distribution but not named in config; leaving it ` +
            'attached (run bootstrap --prune-aliases to detach it)',
        );
      }
      desired = [...configured, ...undeclared];
    }
  }
  desiredCache.set(ctx, desired);
  return desired;
}

/** What the nodes after the certificate should treat as the site's hostnames. */
export function siteHostnames(ctx: OpsContext): string[] {
  return desiredCache.get(ctx) ?? configuredHostnames(ctx);
}

/** The names the recorded certificate was requested for; a pre-aliases certificate covers the primary. */
export function recordedDomains(ctx: OpsContext): string[] {
  const recorded = ctx.state.resources['acm-certificate']?.domains;
  if (Array.isArray(recorded)) return recorded;
  return ctx.domain ? [ctx.domain] : [];
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((name, i) => name === [...b].sort()[i]);
}

/**
 * ACM idempotency token (`\w+`, at most 32): stable for one site, environment
 * and name set, so a retry of the same request reuses the certificate while a
 * changed set requests a new one.
 */
export function certificateToken(siteName: string, env: string, names: readonly string[]): string {
  return createHash('sha256')
    .update(`${siteName}\n${env}\n${[...names].sort().join(',')}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * The apex of the DNS zone `host` lives in, found by asking DNS: walk from the
 * host up through its parents and take the highest name that answers with the
 * same SOA as the first that does. Resolvers follow a CNAME when asked for SOA,
 * so `www` aliased to an apex answers with the apex's record - requiring the
 * run of identical records to end at the real apex handles that, and handles
 * multi-label suffixes such as `example.co.uk` without a suffix list.
 * `undefined` when nothing answers or no resolver could be reached.
 */
export async function findZoneApex(dns: DnsPort, host: string): Promise<string | undefined> {
  const labels = host.split('.');
  let apex: { name: string; soa: string } | undefined;
  try {
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join('.');
      const soa = await dns.soa(name);
      if (apex === undefined) {
        if (soa !== undefined) apex = { name, soa };
      } else if (soa === apex.soa) {
        apex = { name, soa };
      } else {
        break;
      }
    }
  } catch {
    return undefined;
  }
  return apex?.name;
}

/** The Route 53 hosted zone holding `host`, trying the host and then each parent. */
export async function findHostedZone(
  route53: Pick<AwsClients['route53'], 'hostedZoneId'>,
  host: string,
): Promise<{ zoneId: string; zone: string } | undefined> {
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const zone = labels.slice(i).join('.');
    const zoneId = await route53.hostedZoneId(zone);
    if (zoneId) return { zoneId, zone };
  }
  return undefined;
}

/** One printed routing instruction for a host that blogwright does not manage DNS for. */
export async function routingGuidance(
  dns: DnsPort,
  host: string,
  target: string,
): Promise<string> {
  const apex = await findZoneApex(dns, host);
  if (apex === undefined) {
    return (
      `${host}  CNAME -> ${target}  (if ${host} is a zone apex use ALIAS/ANAME, or A and AAAA ` +
      'alias records, instead; its zone could not be looked up)'
    );
  }
  if (apex === host) {
    return (
      `${host}  ALIAS/ANAME -> ${target}  (or A and AAAA alias records where the DNS host ` +
      'cannot flatten a CNAME at the apex)'
    );
  }
  return `${host}  CNAME -> ${target}`;
}
