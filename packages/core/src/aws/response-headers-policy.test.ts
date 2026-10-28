import { describe, expect, it } from 'vitest';

import type { ResponseHeadersConfig } from '../response-headers.js';
import { CloudFrontClient, type DistributionConfigInput } from './cloudfront.js';
import { staticCredentials } from './credentials.js';
import { responseHeadersPolicyBody } from './response-headers-policy.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string, headers: Record<string, string> = {}): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers, body: bytes, text: () => body };
}

function cloudfrontWith(transport: Transport): CloudFrontClient {
  return new CloudFrontClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

const CSP = "default-src 'self'; frame-ancestors 'none'; object-src 'none'";

/** The issue's example block, validated. */
const HEADERS: ResponseHeadersConfig = {
  security: {
    hsts: { maxAgeSeconds: 31_536_000, includeSubdomains: false, preload: false },
    contentTypeOptions: true,
    frameOptions: 'deny',
    referrerPolicy: 'no-referrer',
    contentSecurityPolicy: CSP,
  },
  custom: [
    { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { name: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { name: 'Permissions-Policy', value: 'accelerometer=(), camera=()' },
  ],
};

const POLICY = {
  name: 'production-example-headers',
  comment: 'example production',
  headers: HEADERS,
};

/**
 * A live `GetResponseHeadersPolicy` answer for `headers`: the request body
 * wrapped the way CloudFront returns it, with `'` left unencoded as the
 * service writes it.
 */
function livePolicy(headers: ResponseHeadersConfig, extra = ''): string {
  const config = responseHeadersPolicyBody({ ...POLICY, headers })
    .replace(/^<\?xml[^>]*\?>/, '')
    .replace(/ xmlns="[^"]*"/, '')
    .replaceAll('&apos;', "'")
    .replace('</ResponseHeadersPolicyConfig>', `${extra}</ResponseHeadersPolicyConfig>`);
  return `<?xml version="1.0"?><ResponseHeadersPolicy><Id>RHP-1</Id>${config}</ResponseHeadersPolicy>`;
}

describe('CloudFrontClient response headers policies', () => {
  it('creates the policy with every header overriding the origin, in model order', async () => {
    let request = { method: '', path: '', body: '' };
    const transport: Transport = async (req) => {
      request = { method: req.method, path: new URL(req.url).pathname, body: String(req.body) };
      return response(201, '<ResponseHeadersPolicy><Id>RHP-1</Id></ResponseHeadersPolicy>');
    };
    const id = await cloudfrontWith(transport).createResponseHeadersPolicy(POLICY);
    expect(id).toBe('RHP-1');
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/2020-05-31/response-headers-policy');
    expect(request.body).toContain(
      '<Name>production-example-headers</Name><Comment>example production</Comment>' +
        '<SecurityHeadersConfig>' +
        '<FrameOptions><Override>true</Override><FrameOption>DENY</FrameOption></FrameOptions>' +
        '<ReferrerPolicy><Override>true</Override><ReferrerPolicy>no-referrer</ReferrerPolicy></ReferrerPolicy>' +
        '<ContentSecurityPolicy><Override>true</Override><ContentSecurityPolicy>' +
        'default-src &apos;self&apos;; frame-ancestors &apos;none&apos;; object-src &apos;none&apos;' +
        '</ContentSecurityPolicy></ContentSecurityPolicy>' +
        '<ContentTypeOptions><Override>true</Override></ContentTypeOptions>' +
        '<StrictTransportSecurity><Override>true</Override><IncludeSubdomains>false</IncludeSubdomains>' +
        '<Preload>false</Preload><AccessControlMaxAgeSec>31536000</AccessControlMaxAgeSec>' +
        '</StrictTransportSecurity></SecurityHeadersConfig>',
    );
    expect(request.body).toContain(
      '<CustomHeadersConfig><Quantity>3</Quantity><Items>' +
        '<ResponseHeadersPolicyCustomHeader><Header>Cross-Origin-Opener-Policy</Header>' +
        '<Value>same-origin</Value><Override>true</Override></ResponseHeadersPolicyCustomHeader>',
    );
  });

  it('omits the security section when only custom headers are configured', () => {
    const body = responseHeadersPolicyBody({
      ...POLICY,
      headers: { security: { contentTypeOptions: false }, custom: HEADERS.custom },
    });
    expect(body).not.toContain('SecurityHeadersConfig');
    expect(body).toContain('<CustomHeadersConfig><Quantity>3</Quantity>');
  });

  it('updates in place with a PUT on the policy, guarded by its ETag', async () => {
    const requests: { method: string; path: string; ifMatch: string | undefined }[] = [];
    const transport: Transport = async (req) => {
      requests.push({
        method: req.method,
        path: new URL(req.url).pathname,
        ifMatch: req.headers['if-match'],
      });
      return response(200, '');
    };
    await cloudfrontWith(transport).updateResponseHeadersPolicy('RHP-1', POLICY, 'E1');
    expect(requests).toEqual([
      { method: 'PUT', path: '/2020-05-31/response-headers-policy/RHP-1', ifMatch: 'E1' },
    ]);
  });

  it('reads a policy with its ETag, and a missing one as undefined', async () => {
    const found = cloudfrontWith(async () => response(200, livePolicy(HEADERS), { etag: 'E7' }));
    expect(await found.getResponseHeadersPolicy('RHP-1')).toMatchObject({
      id: 'RHP-1',
      etag: 'E7',
    });
    const missing = cloudfrontWith(async () =>
      response(
        404,
        '<ErrorResponse><Error><Code>NoSuchResponseHeadersPolicy</Code></Error></ErrorResponse>',
      ),
    );
    expect(await missing.getResponseHeadersPolicy('RHP-1')).toBeUndefined();
  });

  it('deletes with the current ETag, treats a gone policy as deleted, and surfaces InUse', async () => {
    const requests: string[] = [];
    const deleting = cloudfrontWith(async (req) => {
      requests.push(`${req.method} ${req.headers['if-match'] ?? ''}`);
      return response(200, livePolicy(HEADERS), { etag: 'E3' });
    });
    await deleting.deleteResponseHeadersPolicy('RHP-1');
    expect(requests).toEqual(['GET ', 'DELETE E3']);

    const gone = cloudfrontWith(async () =>
      response(
        404,
        '<ErrorResponse><Error><Code>NoSuchResponseHeadersPolicy</Code></Error></ErrorResponse>',
      ),
    );
    await expect(gone.deleteResponseHeadersPolicy('RHP-1')).resolves.toBeUndefined();

    const inUse = cloudfrontWith(async (req) =>
      req.method === 'GET'
        ? response(200, livePolicy(HEADERS), { etag: 'E3' })
        : response(
            409,
            '<ErrorResponse><Error><Code>ResponseHeadersPolicyInUse</Code><Message>in use</Message></Error></ErrorResponse>',
          ),
    );
    await expect(inUse.deleteResponseHeadersPolicy('RHP-1')).rejects.toThrow(
      /ResponseHeadersPolicyInUse/,
    );
  });

  it('finds a custom policy by name across pages, and nothing for an unknown name', async () => {
    const queries: string[] = [];
    const client = cloudfrontWith(async (req) => {
      const url = new URL(req.url);
      queries.push(url.search);
      const summary = (id: string, name: string) =>
        `<ResponseHeadersPolicySummary><Type>custom</Type><ResponseHeadersPolicy><Id>${id}</Id>` +
        `<ResponseHeadersPolicyConfig><Name>${name}</Name></ResponseHeadersPolicyConfig>` +
        `</ResponseHeadersPolicy></ResponseHeadersPolicySummary>`;
      return url.searchParams.get('Marker') === 'page-2'
        ? response(
            200,
            `<ResponseHeadersPolicyList><Items>${summary('RHP-9', 'production-example-headers')}</Items></ResponseHeadersPolicyList>`,
          )
        : response(
            200,
            `<ResponseHeadersPolicyList><NextMarker>page-2</NextMarker><Items>${summary('RHP-2', 'other-headers')}</Items></ResponseHeadersPolicyList>`,
          );
    });
    expect(await client.findResponseHeadersPolicyId('production-example-headers')).toBe('RHP-9');
    expect(queries[0]).toContain('Type=custom');
    expect(queries[1]).toContain('Marker=page-2');
    expect(await client.findResponseHeadersPolicyId('missing-headers')).toBeUndefined();
  });

  it('lists the distributions that use a policy, across pages', async () => {
    const paths: string[] = [];
    const client = cloudfrontWith(async (req) => {
      const url = new URL(req.url);
      paths.push(url.pathname);
      return url.searchParams.get('Marker') === 'm2'
        ? response(
            200,
            '<DistributionIdList><IsTruncated>false</IsTruncated><Items><DistributionId>D3</DistributionId></Items></DistributionIdList>',
          )
        : response(
            200,
            '<DistributionIdList><IsTruncated>true</IsTruncated><NextMarker>m2</NextMarker>' +
              '<Items><DistributionId>D1</DistributionId><DistributionId>D2</DistributionId></Items></DistributionIdList>',
          );
    });
    expect(await client.listDistributionIdsUsingResponseHeadersPolicy('RHP-1')).toEqual([
      'D1',
      'D2',
      'D3',
    ]);
    expect(paths[0]).toBe('/2020-05-31/distributionsByResponseHeadersPolicyId/RHP-1');
  });

  describe('responseHeadersPolicyMatches', () => {
    const client = cloudfrontWith(async () => response(200, ''));

    it('matches the document it wrote, whatever the entity encoding or header order', () => {
      expect(client.responseHeadersPolicyMatches(livePolicy(HEADERS), POLICY)).toBe(true);
      const reordered = { ...HEADERS, custom: [...HEADERS.custom].reverse() };
      expect(client.responseHeadersPolicyMatches(livePolicy(reordered), POLICY)).toBe(true);
    });

    it('sees a removed, added or changed header as drift', () => {
      const live = livePolicy(HEADERS);
      const withoutPermissions = { ...HEADERS, custom: HEADERS.custom.slice(0, 2) };
      expect(
        client.responseHeadersPolicyMatches(live, { ...POLICY, headers: withoutPermissions }),
      ).toBe(false);
      const withoutCsp = {
        ...HEADERS,
        security: { ...HEADERS.security, contentSecurityPolicy: undefined },
      };
      expect(client.responseHeadersPolicyMatches(live, { ...POLICY, headers: withoutCsp })).toBe(
        false,
      );
      const sameOrigin = {
        ...HEADERS,
        security: { ...HEADERS.security, frameOptions: 'sameorigin' as const },
      };
      expect(client.responseHeadersPolicyMatches(live, { ...POLICY, headers: sameOrigin })).toBe(
        false,
      );
      const longerHsts = {
        ...HEADERS,
        security: {
          ...HEADERS.security,
          hsts: { maxAgeSeconds: 63_072_000, includeSubdomains: true, preload: false },
        },
      };
      expect(client.responseHeadersPolicyMatches(live, { ...POLICY, headers: longerHsts })).toBe(
        false,
      );
      const noSniffOff = {
        ...HEADERS,
        security: { ...HEADERS.security, contentTypeOptions: false },
      };
      expect(client.responseHeadersPolicyMatches(live, { ...POLICY, headers: noSniffOff })).toBe(
        false,
      );
    });

    it('sees a console-added section or a flipped override as drift', () => {
      const cors =
        '<CorsConfig><AccessControlAllowCredentials>false</AccessControlAllowCredentials></CorsConfig>';
      expect(client.responseHeadersPolicyMatches(livePolicy(HEADERS, cors), POLICY)).toBe(false);
      const timing =
        '<ServerTimingHeadersConfig><Enabled>true</Enabled><SamplingRate>1</SamplingRate></ServerTimingHeadersConfig>';
      expect(client.responseHeadersPolicyMatches(livePolicy(HEADERS, timing), POLICY)).toBe(false);
      const timingOff = timing.replace('true', 'false');
      expect(client.responseHeadersPolicyMatches(livePolicy(HEADERS, timingOff), POLICY)).toBe(
        true,
      );
      const notOverriding = livePolicy(HEADERS).replace(
        '<Value>same-origin</Value><Override>true</Override>',
        '<Value>same-origin</Value><Override>false</Override>',
      );
      expect(client.responseHeadersPolicyMatches(notOverriding, POLICY)).toBe(false);
    });

    it('treats a section CloudFront echoes back empty as unset, not as drift', () => {
      for (const echoed of [
        '<RemoveHeadersConfig><Quantity>0</Quantity></RemoveHeadersConfig>',
        '<RemoveHeadersConfig><Quantity>0</Quantity><Items/></RemoveHeadersConfig>',
        '<RemoveHeadersConfig/>',
        '<CorsConfig></CorsConfig>',
        '<XSSProtection></XSSProtection>',
      ]) {
        expect(client.responseHeadersPolicyMatches(livePolicy(HEADERS, echoed), POLICY)).toBe(true);
      }
    });

    it('still sees a section that removes a header as drift', () => {
      const removing =
        '<RemoveHeadersConfig><Quantity>1</Quantity><Items><ResponseHeadersPolicyRemoveHeader>' +
        '<Header>X-Powered-By</Header></ResponseHeadersPolicyRemoveHeader></Items></RemoveHeadersConfig>';
      expect(client.responseHeadersPolicyMatches(livePolicy(HEADERS, removing), POLICY)).toBe(
        false,
      );
      const xss =
        '<XSSProtection><Override>true</Override><Protection>false</Protection></XSSProtection>';
      const withXss = livePolicy(HEADERS).replace(
        '<SecurityHeadersConfig>',
        `<SecurityHeadersConfig>${xss}`,
      );
      expect(client.responseHeadersPolicyMatches(withXss, POLICY)).toBe(false);
    });
  });
});

/** A live config with a static default behavior and one ordered behavior. */
function liveDistribution(defaultExtra = '', orderedExtra = ''): string {
  return (
    '<DistributionConfig><CallerReference>prod-example-1</CallerReference>' +
    '<Aliases><Quantity>0</Quantity></Aliases>' +
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
    '<FunctionAssociations><Quantity>0</Quantity></FunctionAssociations>' +
    `<FieldLevelEncryptionId></FieldLevelEncryptionId><CachePolicyId>CACHING_OPTIMIZED_ID</CachePolicyId>${defaultExtra}` +
    '<GrpcConfig><Enabled>false</Enabled></GrpcConfig></DefaultCacheBehavior>' +
    '<CacheBehaviors><Quantity>1</Quantity><Items><CacheBehavior>' +
    '<PathPattern>/_app/*</PathPattern><TargetOriginId>s3-site</TargetOriginId>' +
    `<CachePolicyId>CACHING_OPTIMIZED_ID</CachePolicyId><OriginRequestPolicyId>ORP</OriginRequestPolicyId>${orderedExtra}` +
    '</CacheBehavior></Items></CacheBehaviors>' +
    '<CustomErrorResponses><Quantity>0</Quantity></CustomErrorResponses>' +
    '<Comment>example production</Comment>' +
    '<WebACLId>waf-managed-in-console</WebACLId>' +
    '</DistributionConfig>'
  );
}

/** A fake distribution that stores what each PUT sent, so a second call sees the first. */
function distributionStore(initial: string) {
  const state = { live: initial, puts: 0, etags: [] as string[] };
  const transport: Transport = async (req) => {
    if (req.method === 'GET') return response(200, state.live, { etag: `E${state.puts}` });
    state.puts += 1;
    state.etags.push(req.headers['if-match'] ?? '');
    state.live = String(req.body ?? '');
    return response(200, '');
  };
  return { state, client: cloudfrontWith(transport) };
}

describe('CloudFrontClient response headers policy association', () => {
  it('attaches to the default and every ordered behavior where the schema places it', async () => {
    const { state, client } = distributionStore(liveDistribution());
    expect(await client.attachResponseHeadersPolicy('D1', 'RHP-1')).toBe(true);
    expect(state.etags).toEqual(['E0']);
    expect(state.live).toContain(
      '<CachePolicyId>CACHING_OPTIMIZED_ID</CachePolicyId>' +
        '<ResponseHeadersPolicyId>RHP-1</ResponseHeadersPolicyId><GrpcConfig>',
    );
    expect(state.live).toContain(
      '<OriginRequestPolicyId>ORP</OriginRequestPolicyId>' +
        '<ResponseHeadersPolicyId>RHP-1</ResponseHeadersPolicyId></CacheBehavior>',
    );
    // Nothing else moves: the console-managed WAF survives the PUT.
    expect(state.live).toContain('<WebACLId>waf-managed-in-console</WebACLId>');
  });

  it('is idempotent: an attached policy pushes nothing', async () => {
    const { state, client } = distributionStore(liveDistribution());
    await client.attachResponseHeadersPolicy('D1', 'RHP-1');
    expect(await client.attachResponseHeadersPolicy('D1', 'RHP-1')).toBe(false);
    expect(state.puts).toBe(1);
  });

  it('fills an empty policy element, in either form CloudFront may return it', async () => {
    const { state, client } = distributionStore(
      liveDistribution(
        '<ResponseHeadersPolicyId/>',
        '<ResponseHeadersPolicyId></ResponseHeadersPolicyId>',
      ),
    );
    expect(await client.attachResponseHeadersPolicy('D1', 'RHP-1')).toBe(true);
    expect(
      state.live.match(/<ResponseHeadersPolicyId>RHP-1<\/ResponseHeadersPolicyId>/g),
    ).toHaveLength(2);
  });

  it('refuses to overwrite a policy attached by hand, naming it and the behavior', async () => {
    for (const [defaultExtra, orderedExtra, where] of [
      ['<ResponseHeadersPolicyId>HAND-ATTACHED</ResponseHeadersPolicyId>', '', /default cache/],
      ['', '<ResponseHeadersPolicyId>HAND-ATTACHED</ResponseHeadersPolicyId>', /for \/_app\/\*/],
    ] as const) {
      const { state, client } = distributionStore(liveDistribution(defaultExtra, orderedExtra));
      const attach = client.attachResponseHeadersPolicy('D1', 'RHP-1');
      await expect(attach).rejects.toThrow(where);
      await expect(client.attachResponseHeadersPolicy('D1', 'RHP-1')).rejects.toThrow(
        /already carries response headers policy HAND-ATTACHED.*detach it in the CloudFront console/,
      );
      // Nothing was pushed: neither behavior changed.
      expect(state.puts).toBe(0);
    }
  });

  it('refuses a legacy behavior with no cache policy to anchor on', async () => {
    const legacy = liveDistribution().replace(
      '<CachePolicyId>CACHING_OPTIMIZED_ID</CachePolicyId><OriginRequestPolicyId>ORP</OriginRequestPolicyId>',
      '<ForwardedValues><QueryString>false</QueryString></ForwardedValues>',
    );
    const { state, client } = distributionStore(legacy);
    await expect(client.attachResponseHeadersPolicy('D1', 'RHP-1')).rejects.toThrow(
      /without a cache policy/,
    );
    expect(state.puts).toBe(0);
  });

  it('detaches only its own policy, leaving another behavior policy in place', async () => {
    const { state, client } = distributionStore(
      liveDistribution(
        '<ResponseHeadersPolicyId>RHP-1</ResponseHeadersPolicyId>',
        '<ResponseHeadersPolicyId>SOMEONE-ELSE</ResponseHeadersPolicyId>',
      ),
    );
    expect(await client.detachResponseHeadersPolicy('D1', 'RHP-1')).toBe(true);
    expect(state.live).not.toContain('RHP-1');
    expect(state.live).toContain('<ResponseHeadersPolicyId>SOMEONE-ELSE</ResponseHeadersPolicyId>');
    expect(await client.detachResponseHeadersPolicy('D1', 'RHP-1')).toBe(false);
    expect(state.puts).toBe(1);
  });

  it('names the distribution when it is gone', async () => {
    const client = cloudfrontWith(async () =>
      response(
        404,
        '<ErrorResponse><Error><Code>NoSuchDistribution</Code></Error></ErrorResponse>',
      ),
    );
    await expect(client.attachResponseHeadersPolicy('D1', 'RHP-1')).rejects.toThrow(
      /distribution D1 not found/,
    );
  });
});

describe('CloudFrontClient.reconcileDistribution with a response headers policy', () => {
  const SHAPE: DistributionConfigInput = {
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
        kind: 's3',
        originAccessControlId: 'OAC-S',
      },
    ],
    defaultBehavior: { targetOriginId: 's3-site', cachePolicyId: 'CACHING_OPTIMIZED_ID' },
    orderedBehaviors: [
      {
        pathPattern: '/_app/*',
        targetOriginId: 's3-site',
        cachePolicyId: 'CACHING_OPTIMIZED_ID',
        originRequestPolicyId: 'ORP',
      },
    ],
  };

  function withPolicy(shape: DistributionConfigInput, policyId: string): DistributionConfigInput {
    return {
      ...shape,
      defaultBehavior: { ...shape.defaultBehavior, responseHeadersPolicyId: policyId },
      orderedBehaviors: (shape.orderedBehaviors ?? []).map((behavior) =>
        Object.assign({}, behavior, { responseHeadersPolicyId: policyId }),
      ),
    };
  }

  it('matches a live config whose behaviors carry no policy, or an empty element', async () => {
    for (const extra of ['', '<ResponseHeadersPolicyId></ResponseHeadersPolicyId>']) {
      const { state, client } = distributionStore(liveDistribution(extra, extra));
      expect(await client.reconcileDistribution('D1', SHAPE)).toBe(false);
      expect(state.puts).toBe(0);
    }
  });

  it('compares the policy id, so a desired policy is attached and then converges', async () => {
    const { state, client } = distributionStore(liveDistribution());
    const desired = withPolicy(SHAPE, 'RHP-1');
    expect(await client.reconcileDistribution('D1', desired)).toBe(true);
    expect(state.live).toContain(
      '<OriginRequestPolicyId>ORP</OriginRequestPolicyId>' +
        '<ResponseHeadersPolicyId>RHP-1</ResponseHeadersPolicyId><GrpcConfig>',
    );
    expect(await client.reconcileDistribution('D1', desired)).toBe(false);
    expect(state.puts).toBe(1);
  });

  it('a policy the shape does not name is drift, so the rewrite never drops it silently', async () => {
    const attached = '<ResponseHeadersPolicyId>RHP-1</ResponseHeadersPolicyId>';
    const { state, client } = distributionStore(liveDistribution(attached, attached));
    // Same everything else: before the comparison existed, this was a no-op
    // that left the policy until an unrelated drift rewrote the behavior.
    expect(await client.reconcileDistribution('D1', withPolicy(SHAPE, 'RHP-1'))).toBe(false);
    expect(await client.reconcileDistribution('D1', SHAPE)).toBe(true);
    expect(state.live).not.toContain('<ResponseHeadersPolicyId>');
  });
});
