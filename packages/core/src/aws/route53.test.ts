import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { CLOUDFRONT_ALIAS_ZONE_ID, Route53Client } from './route53.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function clientWith(transport: Transport): Route53Client {
  return new Route53Client(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

describe('Route53Client.upsertRecord', () => {
  it('emits TTL + ResourceRecords for a plain record', async () => {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(200, '<ChangeResourceRecordSetsResponse/>');
    };

    await clientWith(transport).upsertRecord('Z1', {
      name: 'blog.example.com',
      type: 'CNAME',
      value: 'target.example.net',
    });

    expect(body).toContain('<Type>CNAME</Type><TTL>300</TTL>');
    expect(body).toContain('<Value>target.example.net</Value>');
    expect(body).not.toContain('AliasTarget');
  });

  it('emits an AliasTarget (no TTL) for an alias record', async () => {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(200, '<ChangeResourceRecordSetsResponse/>');
    };

    await clientWith(transport).upsertRecord('Z1', {
      name: '*.preview.example.com',
      type: 'A',
      value: 'd123.cloudfront.net',
      aliasZoneId: CLOUDFRONT_ALIAS_ZONE_ID,
    });

    expect(body).toContain(
      `<AliasTarget><HostedZoneId>${CLOUDFRONT_ALIAS_ZONE_ID}</HostedZoneId>` +
        '<DNSName>d123.cloudfront.net</DNSName>' +
        '<EvaluateTargetHealth>false</EvaluateTargetHealth></AliasTarget>',
    );
    expect(body).not.toContain('<TTL>');
    expect(body).not.toContain('ResourceRecords');
  });
});

describe('Route53Client.deleteRecord', () => {
  it('swallows only record-not-found failures', async () => {
    const notFound = response(
      400,
      '<ErrorResponse><Error><Code>InvalidChangeBatch</Code><Message>' +
        'Tried to delete resource record set but it was not found</Message></Error></ErrorResponse>',
    );
    const throttled = response(
      400,
      '<ErrorResponse><Error><Code>Throttling</Code><Message>Rate exceeded</Message></Error></ErrorResponse>',
    );

    const record = { name: 'x.example.com', type: 'CNAME', value: 'y' };
    await expect(
      clientWith(async () => notFound).deleteRecord('Z1', record),
    ).resolves.toBeUndefined();
    await expect(clientWith(async () => throttled).deleteRecord('Z1', record)).rejects.toThrow(
      /Throttling/,
    );
  });
});
