import { describe, expect, it } from 'vitest';

import { CloudFrontClient } from './cloudfront.js';
import { staticCredentials } from './credentials.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string, headers: Record<string, string> = {}): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers, body: bytes, text: () => body };
}

function cloudfrontWith(transport: Transport): CloudFrontClient {
  return new CloudFrontClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

/** A compact DistributionConfig the way CloudFront returns it (legacy cert elements included). */
function configXml(aliases: string[], certArn?: string): string {
  const aliasBlock =
    aliases.length > 0
      ? `<Aliases><Quantity>${aliases.length}</Quantity><Items>${aliases
          .map((a) => `<CNAME>${a}</CNAME>`)
          .join('')}</Items></Aliases>`
      : `<Aliases><Quantity>0</Quantity></Aliases>`;
  const cert = certArn
    ? `<ViewerCertificate><ACMCertificateArn>${certArn}</ACMCertificateArn><SSLSupportMethod>sni-only</SSLSupportMethod><MinimumProtocolVersion>TLSv1.2_2021</MinimumProtocolVersion><Certificate>${certArn}</Certificate><CertificateSource>acm</CertificateSource></ViewerCertificate>`
    : `<ViewerCertificate><CloudFrontDefaultCertificate>true</CloudFrontDefaultCertificate><CertificateSource>cloudfront</CertificateSource></ViewerCertificate>`;
  return (
    `<DistributionConfig><CallerReference>ref</CallerReference>${aliasBlock}` +
    `<DefaultRootObject>index.html</DefaultRootObject>` +
    `<Enabled>true</Enabled>${cert}</DistributionConfig>`
  );
}

const CERT = 'arn:aws:acm:us-east-1:1:certificate/abc';

describe('CloudFrontClient.setDistributionAliases', () => {
  it('attaches a new alias and certificate to an alias-less distribution', async () => {
    let putBody = '';
    let putEtag = '';
    const transport: Transport = async (req) => {
      if (req.method === 'GET') return response(200, configXml([]), { etag: 'E1' });
      putBody = String(req.body ?? '');
      putEtag = req.headers['if-match'] ?? '';
      return response(200, configXml(['example.com'], CERT), { etag: 'E2' });
    };

    const changed = await cloudfrontWith(transport).setDistributionAliases(
      'D1',
      ['example.com'],
      CERT,
    );

    expect(changed).toBe(true);
    expect(putEtag).toBe('E1');
    expect(putBody).toContain(
      '<Aliases><Quantity>1</Quantity><Items><CNAME>example.com</CNAME></Items></Aliases>',
    );
    expect(putBody).toContain(`<ACMCertificateArn>${CERT}</ACMCertificateArn>`);
    expect(putBody).not.toContain('CloudFrontDefaultCertificate');
  });

  it('is a no-op when the alias set and certificate already match (legacy elements ignored)', async () => {
    let puts = 0;
    const transport: Transport = async (req) => {
      if (req.method === 'GET') return response(200, configXml(['example.com'], CERT), { etag: 'E1' });
      puts += 1;
      return response(200, '', {});
    };

    const changed = await cloudfrontWith(transport).setDistributionAliases(
      'D1',
      ['example.com'],
      CERT,
    );

    expect(changed).toBe(false);
    expect(puts).toBe(0);
  });

  it('pushes a change when only the certificate differs', async () => {
    let putBody = '';
    const transport: Transport = async (req) => {
      if (req.method === 'GET') {
        return response(200, configXml(['example.com'], 'arn:aws:acm:us-east-1:1:certificate/old'), {
          etag: 'E1',
        });
      }
      putBody = String(req.body ?? '');
      return response(200, '', {});
    };

    const changed = await cloudfrontWith(transport).setDistributionAliases(
      'D1',
      ['example.com'],
      CERT,
    );

    expect(changed).toBe(true);
    expect(putBody).toContain(`<ACMCertificateArn>${CERT}</ACMCertificateArn>`);
  });

  it('throws with the distribution id when the distribution is gone', async () => {
    const transport: Transport = async () =>
      response(404, '<ErrorResponse><Error><Code>NoSuchDistribution</Code></Error></ErrorResponse>');

    await expect(
      cloudfrontWith(transport).setDistributionAliases('D-gone', ['x.com'], CERT),
    ).rejects.toThrow(/D-gone/);
  });
});

describe('CloudFrontClient.listDistributions', () => {
  function summaryXml(id: string, comment: string): string {
    return (
      `<DistributionSummary><Id>${id}</Id>` +
      `<ARN>arn:aws:cloudfront::1:distribution/${id}</ARN>` +
      `<Status>Deployed</Status><DomainName>${id.toLowerCase()}.cloudfront.net</DomainName>` +
      `<Aliases><Quantity>0</Quantity></Aliases>` +
      `<Comment>${comment}</Comment></DistributionSummary>`
    );
  }

  it('follows NextMarker pagination and extracts id/arn/domainName/comment', async () => {
    const urls: string[] = [];
    const page1 =
      `<DistributionList><Marker></Marker><NextMarker>M2</NextMarker><MaxItems>1</MaxItems>` +
      `<IsTruncated>true</IsTruncated><Quantity>1</Quantity><Items>` +
      summaryXml('D1', 'example staging') +
      `</Items></DistributionList>`;
    const page2 =
      `<DistributionList><Marker>M2</Marker><MaxItems>1</MaxItems>` +
      `<IsTruncated>false</IsTruncated><Quantity>1</Quantity><Items>` +
      summaryXml('D2', 'example production') +
      `</Items></DistributionList>`;
    const transport: Transport = async (req) => {
      urls.push(req.url);
      return response(200, req.url.includes('Marker=M2') ? page2 : page1);
    };

    const items = await cloudfrontWith(transport).listDistributions();

    expect(items).toEqual([
      {
        id: 'D1',
        arn: 'arn:aws:cloudfront::1:distribution/D1',
        domainName: 'd1.cloudfront.net',
        comment: 'example staging',
      },
      {
        id: 'D2',
        arn: 'arn:aws:cloudfront::1:distribution/D2',
        domainName: 'd2.cloudfront.net',
        comment: 'example production',
      },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('Marker=M2');
  });

  it('returns an empty list for an account with no distributions', async () => {
    const empty =
      `<DistributionList><Marker></Marker><MaxItems>100</MaxItems>` +
      `<IsTruncated>false</IsTruncated><Quantity>0</Quantity></DistributionList>`;
    const transport: Transport = async () => response(200, empty);

    expect(await cloudfrontWith(transport).listDistributions()).toEqual([]);
  });
});

describe('CloudFrontClient.tagResource', () => {
  it('sends Operation=Tag alongside the encoded Resource ARN', async () => {
    let url = '';
    let body = '';
    const transport: Transport = async (req) => {
      url = req.url;
      body = String(req.body ?? '');
      return response(204, '');
    };
    await cloudfrontWith(transport).tagResource('arn:aws:cloudfront::1:distribution/D1', {
      environment: 'staging',
    });
    // The tagging path routes on Operation (Tag vs Untag); omitting it is InvalidAction.
    expect(url).toContain('Operation=Tag');
    expect(url).toContain('Resource=arn%3Aaws%3Acloudfront%3A%3A1%3Adistribution%2FD1');
    expect(body).toContain('<Tag><Key>environment</Key><Value>staging</Value></Tag>');
  });
});
