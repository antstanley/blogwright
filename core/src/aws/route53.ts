import type { SigningClient } from './signer.js';
import { encodeEntities, textTag } from './xml.js';

const API = '/2013-04-01';

export interface DnsRecord {
  name: string;
  type: string;
  value: string;
  ttl?: number;
}

/** Route53 client (REST-XML). Global service, signed in us-east-1. */
export class Route53Client {
  constructor(private readonly client: SigningClient) {}

  /** Find the hosted zone id for a domain (e.g. "preview.iamstan.dev"). */
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
      `<TTL>${r.ttl ?? 300}</TTL>` +
      `<ResourceRecords><ResourceRecord><Value>${encodeEntities(r.value)}</Value></ResourceRecord></ResourceRecords>` +
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
    } catch {
      // Route53 errors if the exact record doesn't exist — treat as already gone.
    }
  }
}
