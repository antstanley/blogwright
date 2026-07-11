import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';
import { encodeEntities, textTag } from './xml.js';

const API = '/2013-04-01';

export interface DnsRecord {
  name: string;
  type: string;
  /** Record data; for an alias record, the target DNS name (e.g. dxxx.cloudfront.net). */
  value: string;
  ttl?: number;
  /** When set, emit an AliasTarget (no TTL/ResourceRecords) pointing at `value`. */
  aliasZoneId?: string | undefined;
}

/** CloudFront's fixed alias hosted zone id — the same for every distribution. */
export const CLOUDFRONT_ALIAS_ZONE_ID = 'Z2FDTNDATAQYW2';

/** Route53 client (REST-XML). Global service, signed in us-east-1. */
export class Route53Client {
  constructor(private readonly client: SigningClient) {}

  /** Find the hosted zone id for a domain (e.g. "preview.example.com"). */
  async hostedZoneId(dnsName: string): Promise<string | undefined> {
    const res = await this.client.send({
      service: 'route53',
      method: 'GET',
      path: `${API}/hostedzonesbyname`,
      query: { dnsname: dnsName },
    });
    const xml = res.text();
    const want = dnsName.endsWith('.') ? dnsName : `${dnsName}.`;
    // Match the HostedZone block whose <Name> equals the requested domain.
    for (const block of xml.split('<HostedZone>').slice(1)) {
      if (textTag(block, 'Name') === want) {
        const id = textTag(block, 'Id');
        return id?.replace(/^\/hostedzone\//, '');
      }
    }
    return undefined;
  }

  private async change(zoneId: string, action: 'UPSERT' | 'DELETE', r: DnsRecord): Promise<void> {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">` +
      `<ChangeBatch><Changes><Change>` +
      `<Action>${action}</Action>` +
      `<ResourceRecordSet>` +
      `<Name>${encodeEntities(r.name)}</Name>` +
      `<Type>${r.type}</Type>` +
      (r.aliasZoneId
        ? `<AliasTarget><HostedZoneId>${encodeEntities(r.aliasZoneId)}</HostedZoneId>` +
          `<DNSName>${encodeEntities(r.value)}</DNSName>` +
          `<EvaluateTargetHealth>false</EvaluateTargetHealth></AliasTarget>`
        : `<TTL>${r.ttl ?? 300}</TTL>` +
          `<ResourceRecords><ResourceRecord><Value>${encodeEntities(r.value)}</Value></ResourceRecord></ResourceRecords>`) +
      `</ResourceRecordSet>` +
      `</Change></Changes></ChangeBatch>` +
      `</ChangeResourceRecordSetsRequest>`;
    await this.client.send({
      service: 'route53',
      method: 'POST',
      path: `${API}/hostedzone/${zoneId}/rrset`,
      headers: { 'content-type': 'application/xml' },
      body,
    });
  }

  /** Create or update a record (idempotent). */
  async upsertRecord(zoneId: string, record: DnsRecord): Promise<void> {
    await this.change(zoneId, 'UPSERT', record);
  }

  /** Delete a record; ignores an already-absent record. */
  async deleteRecord(zoneId: string, record: DnsRecord): Promise<void> {
    try {
      await this.change(zoneId, 'DELETE', record);
    } catch (err) {
      // Route53 rejects a DELETE whose record doesn't exactly match/exist —
      // that (and only that) means "already gone". Throttling, auth, and other
      // failures must surface, or a teardown leaves the record dangling while
      // reporting success.
      const gone =
        err instanceof AwsError &&
        (err.isNotFound || (err.code === 'InvalidChangeBatch' && /not found/i.test(err.message)));
      if (!gone) throw err;
    }
  }
}
