import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';
import { encodeEntities, textTag } from './xml.js';

const API = '/2020-05-31';
const XMLNS = 'http://cloudfront.amazonaws.com/doc/2020-05-31/';
/** AWS managed "CachingOptimized" cache policy. */
export const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
/** AWS managed "CachingDisabled" cache policy (used for previews — no CDN caching). */
export const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

export interface DistributionSummary {
  id: string;
  arn: string;
  domainName: string;
  status: string;
  etag: string | undefined;
}

export interface DistributionConfigInput {
  callerReference: string;
  comment: string;
  bucketDomainName: string;
  originPath: string;
  originAccessControlId: string;
  defaultRootObject: string;
  aliases: string[];
  acmCertificateArn: string | undefined;
  /** Managed cache policy id (defaults to CachingOptimized). */
  cachePolicyId?: string | undefined;
  /** CloudFront Function ARN to associate on viewer-request (for preview routing). */
  functionArn?: string | undefined;
  /** Custom error responses (e.g. map the S3 REST origin's 403 for a missing key to /404.html). */
  customErrorResponses?: CustomErrorResponse[] | undefined;
}

export interface CustomErrorResponse {
  errorCode: number;
  responsePagePath: string;
  responseCode: number;
  /** Seconds CloudFront caches the error response before re-querying the origin. */
  errorCachingMinTtl?: number | undefined;
}

/** CloudFront client (REST-XML). Global service, signed in us-east-1. */
export class CloudFrontClient {
  constructor(private readonly client: SigningClient) {}

  async createOriginAccessControl(name: string): Promise<string> {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<OriginAccessControlConfig xmlns="${XMLNS}">` +
      `<Name>${encodeEntities(name)}</Name>` +
      `<Description>OAC for ${encodeEntities(name)}</Description>` +
      `<SigningProtocol>sigv4</SigningProtocol>` +
      `<SigningBehavior>always</SigningBehavior>` +
      `<OriginAccessControlOriginType>s3</OriginAccessControlOriginType>` +
      `</OriginAccessControlConfig>`;
    const res = await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/origin-access-control`,
      headers: { 'content-type': 'application/xml' },
      body,
    });
    const id = textTag(res.text(), 'Id');
    if (!id) throw new Error('CreateOriginAccessControl returned no Id');
    return id;
  }

  async deleteOriginAccessControl(id: string): Promise<void> {
    try {
      const get = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/origin-access-control/${id}`,
      });
      const etag = get.headers['etag'];
      await this.client.send({
        service: 'cloudfront',
        method: 'DELETE',
        path: `${API}/origin-access-control/${id}`,
        ...(etag ? { headers: { 'if-match': etag } } : {}),
      });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async createDistribution(input: DistributionConfigInput): Promise<DistributionSummary> {
    const body = buildDistributionConfig(input);
    const res = await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/distribution`,
      headers: { 'content-type': 'application/xml' },
      body,
    });
    return parseDistribution(res.text(), res.headers['etag']);
  }

  async getDistribution(id: string): Promise<DistributionSummary | undefined> {
    try {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/distribution/${id}`,
      });
      return parseDistribution(res.text(), res.headers['etag']);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Fetch the raw DistributionConfig XML plus its ETag (needed to update/disable). */
  async getDistributionConfig(id: string): Promise<{ config: string; etag: string } | undefined> {
    try {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/distribution/${id}/config`,
      });
      return { config: res.text(), etag: res.headers['etag'] ?? '' };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /**
   * Disable a distribution by flipping its top-level `<Enabled>` to false. The config
   * also contains `<Enabled>false</Enabled>` inside TrustedSigners/Logging, so the
   * distribution-level flag must be matched specifically — it is the one immediately
   * followed by `<ViewerCertificate>` in the schema.
   */
  async disableDistribution(id: string): Promise<void> {
    const current = await this.getDistributionConfig(id);
    if (!current) return;
    if (/<Enabled>false<\/Enabled><ViewerCertificate>/.test(current.config)) return; // already disabled
    const disabled = current.config.replace(
      /<Enabled>true<\/Enabled><ViewerCertificate>/,
      '<Enabled>false</Enabled><ViewerCertificate>',
    );
    await this.client.send({
      service: 'cloudfront',
      method: 'PUT',
      path: `${API}/distribution/${id}/config`,
      headers: { 'content-type': 'application/xml', 'if-match': current.etag },
      body: disabled,
    });
  }

  async deleteDistribution(id: string): Promise<void> {
    try {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/distribution/${id}`,
      });
      const etag = res.headers['etag'];
      await this.client.send({
        service: 'cloudfront',
        method: 'DELETE',
        path: `${API}/distribution/${id}`,
        ...(etag ? { headers: { 'if-match': etag } } : {}),
      });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  /** Invalidate paths (defaults to everything). Returns the invalidation id. */
  async createInvalidation(id: string, paths: string[], reference: string): Promise<string> {
    const items = paths.map((p) => `<Path>${encodeEntities(p)}</Path>`).join('');
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<InvalidationBatch xmlns="${XMLNS}">` +
      `<Paths><Quantity>${paths.length}</Quantity><Items>${items}</Items></Paths>` +
      `<CallerReference>${encodeEntities(reference)}</CallerReference>` +
      `</InvalidationBatch>`;
    const res = await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/distribution/${id}/invalidation`,
      headers: { 'content-type': 'application/xml' },
      body,
    });
    return textTag(res.text(), 'Id') ?? '';
  }

  // --- CloudFront Functions (viewer-request routing for previews) ---

  private functionBody(root: string, name: string, code: string, comment: string): string {
    const b64 = Buffer.from(code, 'utf8').toString('base64');
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<${root} xmlns="${XMLNS}">` +
      `<FunctionCode>${b64}</FunctionCode>` +
      `<FunctionConfig><Comment>${encodeEntities(comment)}</Comment><Runtime>cloudfront-js-2.0</Runtime></FunctionConfig>` +
      `<Name>${encodeEntities(name)}</Name>` +
      `</${root}>`
    );
  }

  private async describeFunction(name: string): Promise<{ arn: string; etag: string } | undefined> {
    try {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/function/${name}`,
      });
      return { arn: textTag(res.text(), 'FunctionARN') ?? '', etag: res.headers['etag'] ?? '' };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Create-or-update the function code and publish it. Returns the published ARN. */
  async ensureFunction(name: string, code: string, comment: string): Promise<string> {
    const existing = await this.describeFunction(name);
    let etag: string;
    if (existing) {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'PUT',
        path: `${API}/function/${name}`,
        headers: { 'content-type': 'application/xml', 'if-match': existing.etag },
        body: this.functionBody('UpdateFunctionRequest', name, code, comment),
      });
      etag = res.headers['etag'] ?? existing.etag;
    } else {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'POST',
        path: `${API}/function`,
        headers: { 'content-type': 'application/xml' },
        body: this.functionBody('CreateFunctionRequest', name, code, comment),
      });
      etag = res.headers['etag'] ?? '';
    }
    const pub = await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/function/${name}/publish`,
      headers: { 'if-match': etag },
    });
    return textTag(pub.text(), 'FunctionARN') ?? existing?.arn ?? '';
  }

  async deleteFunction(name: string): Promise<void> {
    const existing = await this.describeFunction(name);
    if (!existing) return;
    await this.client.send({
      service: 'cloudfront',
      method: 'DELETE',
      path: `${API}/function/${name}`,
      headers: { 'if-match': existing.etag },
    });
  }
}

/** Build the <CustomErrorResponses> block, ordered by error code for a stable payload. */
function buildCustomErrorResponses(responses: CustomErrorResponse[] | undefined): string {
  if (!responses || responses.length === 0) {
    return `<CustomErrorResponses><Quantity>0</Quantity></CustomErrorResponses>`;
  }
  const items = [...responses]
    .sort((a, b) => a.errorCode - b.errorCode)
    .map(
      (r) =>
        `<CustomErrorResponse>` +
        `<ErrorCode>${r.errorCode}</ErrorCode>` +
        `<ResponsePagePath>${encodeEntities(r.responsePagePath)}</ResponsePagePath>` +
        `<ResponseCode>${r.responseCode}</ResponseCode>` +
        `<ErrorCachingMinTTL>${r.errorCachingMinTtl ?? 10}</ErrorCachingMinTTL>` +
        `</CustomErrorResponse>`,
    )
    .join('');
  return `<CustomErrorResponses><Quantity>${responses.length}</Quantity><Items>${items}</Items></CustomErrorResponses>`;
}

function parseDistribution(xml: string, etag: string | undefined): DistributionSummary {
  return {
    id: textTag(xml, 'Id') ?? '',
    arn: textTag(xml, 'ARN') ?? '',
    domainName: textTag(xml, 'DomainName') ?? '',
    status: textTag(xml, 'Status') ?? 'InProgress',
    etag,
  };
}

/** Build a DistributionConfig document. Element order follows the CloudFront schema. */
function buildDistributionConfig(input: DistributionConfigInput): string {
  const aliases =
    input.aliases.length > 0
      ? `<Aliases><Quantity>${input.aliases.length}</Quantity><Items>${input.aliases
          .map((a) => `<CNAME>${encodeEntities(a)}</CNAME>`)
          .join('')}</Items></Aliases>`
      : `<Aliases><Quantity>0</Quantity></Aliases>`;

  const viewerCertificate = input.acmCertificateArn
    ? `<ViewerCertificate><ACMCertificateArn>${encodeEntities(
        input.acmCertificateArn,
      )}</ACMCertificateArn><SSLSupportMethod>sni-only</SSLSupportMethod><MinimumProtocolVersion>TLSv1.2_2021</MinimumProtocolVersion></ViewerCertificate>`
    : `<ViewerCertificate><CloudFrontDefaultCertificate>true</CloudFrontDefaultCertificate></ViewerCertificate>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DistributionConfig xmlns="${XMLNS}">` +
    `<CallerReference>${encodeEntities(input.callerReference)}</CallerReference>` +
    aliases +
    `<DefaultRootObject>${encodeEntities(input.defaultRootObject)}</DefaultRootObject>` +
    `<Origins><Quantity>1</Quantity><Items><Origin>` +
    `<Id>s3-site</Id>` +
    `<DomainName>${encodeEntities(input.bucketDomainName)}</DomainName>` +
    `<OriginPath>${encodeEntities(input.originPath)}</OriginPath>` +
    `<CustomHeaders><Quantity>0</Quantity></CustomHeaders>` +
    `<S3OriginConfig><OriginAccessIdentity></OriginAccessIdentity></S3OriginConfig>` +
    `<OriginAccessControlId>${encodeEntities(input.originAccessControlId)}</OriginAccessControlId>` +
    `<ConnectionAttempts>3</ConnectionAttempts><ConnectionTimeout>10</ConnectionTimeout>` +
    `</Origin></Items></Origins>` +
    `<DefaultCacheBehavior>` +
    `<TargetOriginId>s3-site</TargetOriginId>` +
    `<TrustedSigners><Enabled>false</Enabled><Quantity>0</Quantity></TrustedSigners>` +
    `<ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy>` +
    `<Compress>true</Compress>` +
    (input.functionArn
      ? `<FunctionAssociations><Quantity>1</Quantity><Items><FunctionAssociation><EventType>viewer-request</EventType><FunctionARN>${encodeEntities(input.functionArn)}</FunctionARN></FunctionAssociation></Items></FunctionAssociations>`
      : `<FunctionAssociations><Quantity>0</Quantity></FunctionAssociations>`) +
    `<CachePolicyId>${input.cachePolicyId ?? CACHING_OPTIMIZED}</CachePolicyId>` +
    `</DefaultCacheBehavior>` +
    `<CacheBehaviors><Quantity>0</Quantity></CacheBehaviors>` +
    buildCustomErrorResponses(input.customErrorResponses) +
    `<Comment>${encodeEntities(input.comment)}</Comment>` +
    `<Logging><Enabled>false</Enabled><IncludeCookies>false</IncludeCookies><Bucket></Bucket><Prefix></Prefix></Logging>` +
    `<PriceClass>PriceClass_100</PriceClass>` +
    `<Enabled>true</Enabled>` +
    viewerCertificate +
    `<Restrictions><GeoRestriction><RestrictionType>none</RestrictionType><Quantity>0</Quantity></GeoRestriction></Restrictions>` +
    `<WebACLId></WebACLId>` +
    `<HttpVersion>http2and3</HttpVersion>` +
    `<IsIPV6Enabled>true</IsIPV6Enabled>` +
    `</DistributionConfig>`
  );
}
