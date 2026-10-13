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
      if (req.method === 'GET')
        return response(200, configXml(['example.com'], CERT), { etag: 'E1' });
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
        return response(
          200,
          configXml(['example.com'], 'arn:aws:acm:us-east-1:1:certificate/old'),
          {
            etag: 'E1',
          },
        );
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
      response(
        404,
        '<ErrorResponse><Error><Code>NoSuchDistribution</Code></Error></ErrorResponse>',
      );

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

describe('CloudFrontClient origin access control', () => {
  it('writes a lambda origin with always-amz-auth for a Web Function origin', async () => {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(200, '<OriginAccessControl><Id>OAC-W</Id></OriginAccessControl>');
    };
    const id = await cloudfrontWith(transport).createOriginAccessControl({
      name: 'prod-example-web-oac',
      originType: 'lambda',
      signingBehavior: 'always-amz-auth',
    });
    expect(id).toBe('OAC-W');
    expect(body).toContain('<OriginAccessControlOriginType>lambda</OriginAccessControlOriginType>');
    expect(body).toContain('<SigningBehavior>always-amz-auth</SigningBehavior>');
    expect(body).toContain('<SigningProtocol>sigv4</SigningProtocol>');
  });

  it('defaults to an s3 origin signed always', async () => {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(200, '<OriginAccessControl><Id>OAC-S</Id></OriginAccessControl>');
    };
    await cloudfrontWith(transport).createOriginAccessControl({
      name: 'prod-example-oac',
      originType: 's3',
    });
    expect(body).toContain('<OriginAccessControlOriginType>s3</OriginAccessControlOriginType>');
    expect(body).toContain('<SigningBehavior>always</SigningBehavior>');
  });
});

describe('CloudFrontClient cache policies', () => {
  const SSR_POLICY = {
    name: 'prod-example-ssr',
    comment: 'ssr responses',
    minTtl: 0,
    defaultTtl: 0,
    maxTtl: 31_536_000,
    headerNames: ['Authorization'],
    queryStrings: 'all' as const,
    cookies: 'none' as const,
    gzip: true,
    brotli: true,
  };

  it('updates a policy with a PUT on the policy itself, guarded by its ETag', async () => {
    const requests: { method: string; path: string; ifMatch: string | undefined; body: string }[] =
      [];
    const transport: Transport = async (req) => {
      requests.push({
        method: req.method,
        path: new URL(req.url).pathname,
        ifMatch: req.headers['if-match'],
        body: String(req.body ?? ''),
      });
      return response(200, '');
    };
    await cloudfrontWith(transport).updateCachePolicy('CP-1', SSR_POLICY, 'E1');
    expect(requests).toHaveLength(1);
    // Not `/config`: CloudFront answers a PUT there with InvalidAction (HTTP 404).
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      path: '/2020-05-31/cache-policy/CP-1',
      ifMatch: 'E1',
    });
    expect(requests[0]?.body).toContain('<Name>Authorization</Name>');
  });

  it('creates a policy keyed on every query string and exactly the named headers', async () => {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(200, '<CachePolicy><Id>CP-1</Id></CachePolicy>');
    };
    const { id } = await cloudfrontWith(transport).createCachePolicy(SSR_POLICY);
    expect(id).toBe('CP-1');
    expect(body).toContain('<DefaultTTL>0</DefaultTTL><MaxTTL>31536000</MaxTTL><MinTTL>0</MinTTL>');
    expect(body).toContain('<QueryStringBehavior>all</QueryStringBehavior>');
    expect(body).toContain('<CookieBehavior>none</CookieBehavior>');
    expect(body).toContain('<HeaderBehavior>whitelist</HeaderBehavior>');
    expect(body).toContain('<Name>Authorization</Name>');
    expect(body).toContain('<EnableAcceptEncodingGzip>true</EnableAcceptEncodingGzip>');
    expect(body).toContain('<EnableAcceptEncodingBrotli>true</EnableAcceptEncodingBrotli>');
  });

  it('renders HeaderBehavior none for the empty default set', async () => {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(200, '<CachePolicy><Id>CP-2</Id></CachePolicy>');
    };
    await cloudfrontWith(transport).createCachePolicy({ ...SSR_POLICY, headerNames: [] });
    expect(body).toContain('<HeadersConfig><HeaderBehavior>none</HeaderBehavior></HeadersConfig>');
    expect(body).not.toContain('whitelist');
  });

  it('compares a live policy semantically, and a changed header set is a difference', async () => {
    const live =
      '<?xml version="1.0"?><CachePolicy><CachePolicyConfig><Name>p</Name>' +
      '<DefaultTTL>0</DefaultTTL><MaxTTL>31536000</MaxTTL><MinTTL>0</MinTTL>' +
      '<ParametersInCacheKeyAndForwardedToOrigin>' +
      '<CookiesConfig><CookieBehavior>none</CookieBehavior></CookiesConfig>' +
      '<EnableAcceptEncodingBrotli>true</EnableAcceptEncodingBrotli>' +
      '<EnableAcceptEncodingGzip>true</EnableAcceptEncodingGzip>' +
      '<HeadersConfig><HeaderBehavior>whitelist</HeaderBehavior><Headers><Quantity>1</Quantity><Items><Name>Authorization</Name></Items></Headers></HeadersConfig>' +
      '<QueryStringsConfig><QueryStringBehavior>all</QueryStringBehavior></QueryStringsConfig>' +
      '</ParametersInCacheKeyAndForwardedToOrigin></CachePolicyConfig></CachePolicy>';
    const client = cloudfrontWith(async () => response(200, ''));
    expect(client.cachePolicyMatches(live, SSR_POLICY)).toBe(true);
    expect(client.cachePolicyMatches(live, { ...SSR_POLICY, headerNames: [] })).toBe(false);
    expect(client.cachePolicyMatches(live, { ...SSR_POLICY, defaultTtl: 86_400 })).toBe(false);
    expect(client.cachePolicyMatches(live, { ...SSR_POLICY, cookies: 'all' })).toBe(false);
  });
});

describe('CloudFrontClient distribution shapes', () => {
  const STATIC_SHAPE = {
    callerReference: 'prod-example-1',
    comment: 'example production',
    defaultRootObject: 'index.html',
    aliases: [],
    acmCertificateArn: undefined,
    origins: [
      {
        id: 's3-site',
        domainName: 'b.s3.us-east-1.amazonaws.com',
        originPath: '/site',
        kind: 's3' as const,
        originAccessControlId: 'OAC-S',
      },
    ],
    defaultBehavior: {
      targetOriginId: 's3-site',
      cachePolicyId: 'CACHING_OPTIMIZED_ID',
      functionArn: 'arn:function:router',
    },
    customErrorResponses: [
      { errorCode: 403, responsePagePath: '/404.html', responseCode: 404 },
      { errorCode: 404, responsePagePath: '/404.html', responseCode: 404 },
    ],
  };

  async function createBody(shape: unknown): Promise<string> {
    let body = '';
    const transport: Transport = async (req) => {
      body = String(req.body ?? '');
      return response(
        200,
        '<Distribution><Id>D1</Id><ARN>arn:D1</ARN><DomainName>d1.cloudfront.net</DomainName><Status>Deployed</Status></Distribution>',
      );
    };
    await cloudfrontWith(transport).createDistribution(shape as never);
    return body;
  }

  it('renders the static shape exactly as the single-origin builder always did', async () => {
    const body = await createBody(STATIC_SHAPE);
    expect(body).toContain(
      '<Origins><Quantity>1</Quantity><Items><Origin>' +
        '<Id>s3-site</Id>' +
        '<DomainName>b.s3.us-east-1.amazonaws.com</DomainName>' +
        '<OriginPath>/site</OriginPath>' +
        '<CustomHeaders><Quantity>0</Quantity></CustomHeaders>' +
        '<S3OriginConfig><OriginAccessIdentity></OriginAccessIdentity></S3OriginConfig>' +
        '<OriginAccessControlId>OAC-S</OriginAccessControlId>' +
        '<ConnectionAttempts>3</ConnectionAttempts><ConnectionTimeout>10</ConnectionTimeout>' +
        '</Origin></Items></Origins>',
    );
    expect(body).toContain(
      '<DefaultCacheBehavior><TargetOriginId>s3-site</TargetOriginId>' +
        '<TrustedSigners><Enabled>false</Enabled><Quantity>0</Quantity></TrustedSigners>' +
        '<ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy>' +
        '<Compress>true</Compress>',
    );
    // No AllowedMethods block in static mode: CloudFront's GET/HEAD default stands.
    expect(body).not.toContain('<AllowedMethods>');
    expect(body).toContain('<CacheBehaviors><Quantity>0</Quantity></CacheBehaviors>');
    expect(body).toContain('<CustomErrorResponses><Quantity>2</Quantity>');
  });

  it('renders the SSR shape: two origins, the probe policy, static paths, no error responses', async () => {
    const body = await createBody({
      ...STATIC_SHAPE,
      defaultRootObject: '',
      origins: [
        STATIC_SHAPE.origins[0]!,
        {
          id: 'web-function',
          domainName: 'abc.lambda-url.us-east-1.on.aws',
          originPath: '',
          kind: 'web-function',
          originAccessControlId: 'OAC-W',
          originReadTimeoutSeconds: 60,
        },
      ],
      defaultBehavior: {
        targetOriginId: 'web-function',
        cachePolicyId: 'CP-SSR',
        originRequestPolicyId: 'ALL_VIEWER_EXCEPT_HOST',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      },
      orderedBehaviors: [
        {
          pathPattern: '/_astro/*',
          targetOriginId: 's3-site',
          cachePolicyId: 'CACHING_OPTIMIZED_ID',
        },
        {
          pathPattern: '/favicon.svg',
          targetOriginId: 's3-site',
          cachePolicyId: 'CACHING_OPTIMIZED_ID',
        },
      ],
      customErrorResponses: undefined,
    });
    expect(body).toContain('<DefaultRootObject></DefaultRootObject>');
    expect(body).toContain(
      '<CustomOriginConfig><HTTPPort>80</HTTPPort><HTTPSPort>443</HTTPSPort>' +
        '<OriginProtocolPolicy>https-only</OriginProtocolPolicy>' +
        '<OriginSslProtocols><Quantity>3</Quantity><Items>' +
        '<SslProtocol>TLSv1</SslProtocol><SslProtocol>TLSv1.1</SslProtocol>' +
        '<SslProtocol>TLSv1.2</SslProtocol></Items></OriginSslProtocols>' +
        '<OriginReadTimeout>60</OriginReadTimeout><OriginKeepaliveTimeout>5</OriginKeepaliveTimeout>' +
        '</CustomOriginConfig>',
    );
    expect(body).toContain('<OriginAccessControlId>OAC-W</OriginAccessControlId>');
    expect(body).toContain(
      '<DefaultCacheBehavior><TargetOriginId>web-function</TargetOriginId>' +
        '<TrustedSigners><Enabled>false</Enabled><Quantity>0</Quantity></TrustedSigners>' +
        '<ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy>' +
        '<AllowedMethods><Quantity>7</Quantity><Items>' +
        '<Method>GET</Method><Method>HEAD</Method><Method>OPTIONS</Method><Method>PUT</Method>' +
        '<Method>POST</Method><Method>PATCH</Method><Method>DELETE</Method></Items>' +
        '<CachedMethods><Quantity>2</Quantity><Items><Method>GET</Method><Method>HEAD</Method></Items></CachedMethods>' +
        '</AllowedMethods>',
    );
    expect(body).toContain('<CachePolicyId>CP-SSR</CachePolicyId>');
    expect(body).toContain('<OriginRequestPolicyId>ALL_VIEWER_EXCEPT_HOST</OriginRequestPolicyId>');
    expect(body).not.toContain('<FunctionAssociations><Quantity>1</Quantity>');
    expect(body).toContain(
      '<CacheBehaviors><Quantity>2</Quantity><Items>' +
        '<CacheBehavior><PathPattern>/_astro/*</PathPattern>' +
        '<TargetOriginId>s3-site</TargetOriginId>',
    );
    expect(body).toContain('<PathPattern>/favicon.svg</PathPattern>');
    expect(body).toContain('<CachePolicyId>CACHING_OPTIMIZED_ID</CachePolicyId></CacheBehavior>');
    expect(body).toContain('<CustomErrorResponses><Quantity>0</Quantity></CustomErrorResponses>');
  });
});

describe('CloudFrontClient.reconcileDistribution', () => {
  /** A live config: the static shape plus a console-managed WAF the reconcile must keep. */
  function liveConfig(): string {
    return (
      '<DistributionConfig><CallerReference>prod-example-1</CallerReference>' +
      '<Aliases><Quantity>1</Quantity><Items><CNAME>example.com</CNAME></Items></Aliases>' +
      '<DefaultRootObject>index.html</DefaultRootObject>' +
      '<Origins><Quantity>1</Quantity><Items><Origin><Id>s3-site</Id>' +
      '<DomainName>b.s3.us-east-1.amazonaws.com</DomainName><OriginPath>/site</OriginPath>' +
      '<CustomHeaders><Quantity>0</Quantity></CustomHeaders>' +
      '<S3OriginConfig><OriginAccessIdentity></OriginAccessIdentity></S3OriginConfig>' +
      '<OriginAccessControlId>OAC-S</OriginAccessControlId>' +
      '<ConnectionAttempts>3</ConnectionAttempts><ConnectionTimeout>10</ConnectionTimeout>' +
      '</Origin></Items></Origins>' +
      '<DefaultCacheBehavior><TargetOriginId>s3-site</TargetOriginId>' +
      '<TrustedSigners><Enabled>false</Enabled><Quantity>0</Quantity></TrustedSigners>' +
      '<ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy><Compress>true</Compress>' +
      '<FunctionAssociations><Quantity>1</Quantity><Items><FunctionAssociation>' +
      '<EventType>viewer-request</EventType><FunctionARN>arn:function:router</FunctionARN>' +
      '</FunctionAssociation></Items></FunctionAssociations>' +
      '<CachePolicyId>CACHING_OPTIMIZED_ID</CachePolicyId></DefaultCacheBehavior>' +
      '<CacheBehaviors><Quantity>0</Quantity></CacheBehaviors>' +
      '<CustomErrorResponses><Quantity>0</Quantity></CustomErrorResponses>' +
      '<Comment>example production</Comment>' +
      '<ViewerCertificate><ACMCertificateArn>arn:acm:cert</ACMCertificateArn>' +
      '<SSLSupportMethod>sni-only</SSLSupportMethod></ViewerCertificate>' +
      '<WebACLId>waf-managed-in-console</WebACLId>' +
      '</DistributionConfig>'
    );
  }

  const SHAPE = {
    callerReference: 'prod-example-1',
    comment: 'example production',
    defaultRootObject: 'index.html',
    aliases: [],
    acmCertificateArn: undefined,
    origins: [
      {
        id: 's3-site',
        domainName: 'b.s3.us-east-1.amazonaws.com',
        originPath: '/site',
        kind: 's3' as const,
        originAccessControlId: 'OAC-S',
      },
    ],
    defaultBehavior: {
      targetOriginId: 's3-site',
      cachePolicyId: 'CACHING_OPTIMIZED_ID',
      functionArn: 'arn:function:router',
    },
  };

  it('pushes nothing when the owned shape already matches', async () => {
    let puts = 0;
    const transport: Transport = async (req) => {
      if (req.method === 'GET') return response(200, liveConfig(), { etag: 'E1' });
      puts += 1;
      return response(200, '');
    };
    const changed = await cloudfrontWith(transport).reconcileDistribution('D1', SHAPE);
    expect(changed).toBe(false);
    expect(puts).toBe(0);
  });

  it('patches the owned elements and preserves a console-managed field', async () => {
    let putBody = '';
    let putEtag = '';
    const transport: Transport = async (req) => {
      if (req.method === 'GET') return response(200, liveConfig(), { etag: 'E1' });
      putBody = String(req.body ?? '');
      putEtag = req.headers['if-match'] ?? '';
      return response(200, '');
    };
    const changed = await cloudfrontWith(transport).reconcileDistribution('D1', {
      ...SHAPE,
      origins: [
        SHAPE.origins[0]!,
        {
          id: 'web-function',
          domainName: 'abc.lambda-url.us-east-1.on.aws',
          originPath: '',
          kind: 'web-function' as const,
          originAccessControlId: 'OAC-W',
          originReadTimeoutSeconds: 60,
        },
      ],
      defaultBehavior: {
        targetOriginId: 'web-function',
        cachePolicyId: 'CP-SSR',
        originRequestPolicyId: 'ALL_VIEWER_EXCEPT_HOST',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      },
    });
    expect(changed).toBe(true);
    expect(putEtag).toBe('E1');
    expect(putBody).toContain('<Id>web-function</Id>');
    expect(putBody).toContain('<TargetOriginId>web-function</TargetOriginId>');
    expect(putBody).toContain(
      '<OriginRequestPolicyId>ALL_VIEWER_EXCEPT_HOST</OriginRequestPolicyId>',
    );
    // Console-managed fields survive; the alias set is untouched because the
    // desired shape carries none (dropping --domain never detaches a hostname).
    expect(putBody).toContain('<WebACLId>waf-managed-in-console</WebACLId>');
    expect(putBody).toContain('<CNAME>example.com</CNAME>');
    expect(putBody).toContain('<Comment>example production</Comment>');
  });

  it('moves aliases only when the desired shape carries them', async () => {
    let putBody = '';
    const transport: Transport = async (req) => {
      if (req.method === 'GET') return response(200, liveConfig(), { etag: 'E1' });
      putBody = String(req.body ?? '');
      return response(200, '');
    };
    const changed = await cloudfrontWith(transport).reconcileDistribution('D1', {
      ...SHAPE,
      aliases: ['www.example.com'],
      acmCertificateArn: 'arn:acm:new',
    });
    expect(changed).toBe(true);
    expect(putBody).toContain('<CNAME>www.example.com</CNAME>');
    expect(putBody).not.toContain('<CNAME>example.com</CNAME>');
    expect(putBody).toContain('<ACMCertificateArn>arn:acm:new</ACMCertificateArn>');
  });

  it('converges: the document a reconcile pushed matches the shape that produced it', async () => {
    // What CloudFront answers with after a PUT carries `<CachedMethods>` nested
    // in `<AllowedMethods>`, exactly as the pushed document does.
    const shapes = [
      // Static, as a switch back from SSR leaves it.
      { ...SHAPE, defaultRootObject: 'home.html' },
      {
        ...SHAPE,
        defaultRootObject: '',
        origins: [
          SHAPE.origins[0]!,
          {
            id: 'web-function',
            domainName: 'abc.lambda-url.us-east-1.on.aws',
            originPath: '',
            kind: 'web-function' as const,
            originAccessControlId: 'OAC-W',
            originReadTimeoutSeconds: 60,
          },
        ],
        defaultBehavior: {
          targetOriginId: 'web-function',
          cachePolicyId: 'CP-SSR',
          originRequestPolicyId: 'ALL_VIEWER_EXCEPT_HOST',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        },
        orderedBehaviors: [
          {
            pathPattern: '/_astro/*',
            targetOriginId: 's3-site',
            cachePolicyId: 'CACHING_OPTIMIZED_ID',
          },
        ],
      },
    ];
    for (const shape of shapes) {
      let live = liveConfig();
      let puts = 0;
      const transport: Transport = async (req) => {
        if (req.method === 'GET') return response(200, live, { etag: 'E1' });
        puts += 1;
        live = String(req.body ?? '');
        return response(200, '');
      };
      const client = cloudfrontWith(transport);
      expect(await client.reconcileDistribution('D1', shape)).toBe(true);
      expect(live).toContain('<CachedMethods>');
      expect(await client.reconcileDistribution('D1', shape)).toBe(false);
      expect(puts).toBe(1);
    }
  });

  it('still sees a changed allowed-method set through the nested cached methods', async () => {
    const withMethods = (allowedMethods: string[]) => ({
      ...SHAPE,
      defaultBehavior: { ...SHAPE.defaultBehavior, allowedMethods },
    });
    let live = liveConfig();
    const transport: Transport = async (req) => {
      if (req.method === 'GET') return response(200, live, { etag: 'E1' });
      live = String(req.body ?? '');
      return response(200, '');
    };
    const client = cloudfrontWith(transport);
    await client.reconcileDistribution('D1', withMethods(['GET', 'HEAD', 'OPTIONS']));
    expect(await client.reconcileDistribution('D1', withMethods(['GET', 'HEAD']))).toBe(true);
  });
});
