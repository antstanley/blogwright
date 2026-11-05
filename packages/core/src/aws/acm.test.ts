import { describe, expect, it } from 'vitest';

import { AcmClient } from './acm.js';
import { staticCredentials } from './credentials.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(body: unknown): RawResponse {
  const text = JSON.stringify(body);
  return { statusCode: 200, headers: {}, body: new TextEncoder().encode(text), text: () => text };
}

function acmWith(transport: Transport): AcmClient {
  return new AcmClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

describe('AcmClient.requestCertificate', () => {
  it('sends subject alternative names after the subject', async () => {
    let sent: Record<string, unknown> = {};
    const acm = acmWith(async (req) => {
      sent = JSON.parse(String(req.body)) as Record<string, unknown>;
      return response({ CertificateArn: 'arn:cert' });
    });
    const arn = await acm.requestCertificate('example.com', 'tok', undefined, [
      'www.example.com',
      'example.org',
    ]);
    expect(arn).toBe('arn:cert');
    expect(sent['DomainName']).toBe('example.com');
    expect(sent['SubjectAlternativeNames']).toEqual(['www.example.com', 'example.org']);
    expect(sent['ValidationMethod']).toBe('DNS');
  });

  it('omits SubjectAlternativeNames for a single-name request', async () => {
    let sent: Record<string, unknown> = {};
    const acm = acmWith(async (req) => {
      sent = JSON.parse(String(req.body)) as Record<string, unknown>;
      return response({ CertificateArn: 'arn:cert' });
    });
    await acm.requestCertificate('example.com', 'tok');
    expect(sent).not.toHaveProperty('SubjectAlternativeNames');
  });
});

describe('AcmClient.describeCertificate', () => {
  it('reports the hostname and validation state each record belongs to', async () => {
    const acm = acmWith(async () =>
      response({
        Certificate: {
          Status: 'PENDING_VALIDATION',
          DomainValidationOptions: [
            {
              DomainName: 'example.com',
              ValidationStatus: 'SUCCESS',
              ResourceRecord: { Name: '_a.example.com.', Type: 'CNAME', Value: '_a.acm.' },
            },
            {
              DomainName: 'www.example.com',
              ValidationStatus: 'PENDING_VALIDATION',
              ResourceRecord: { Name: '_b.www.example.com.', Type: 'CNAME', Value: '_b.acm.' },
            },
            { DomainName: 'late.example.com', ValidationStatus: 'PENDING_VALIDATION' },
          ],
        },
      }),
    );
    const out = await acm.describeCertificate('arn:cert');
    expect(out.status).toBe('PENDING_VALIDATION');
    expect(out.validation).toEqual([
      {
        name: '_a.example.com.',
        type: 'CNAME',
        value: '_a.acm.',
        domain: 'example.com',
        status: 'SUCCESS',
      },
      {
        name: '_b.www.example.com.',
        type: 'CNAME',
        value: '_b.acm.',
        domain: 'www.example.com',
        status: 'PENDING_VALIDATION',
      },
    ]);
  });
});
