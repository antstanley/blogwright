import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';
import type { ResourceTags } from '../tags.js';
import { allTags, encodeEntities, textTag } from './xml.js';

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

/** One entry from ListDistributions — enough to identify a distribution for adoption. */
export interface DistributionListItem {
  id: string;
  arn: string;
  domainName: string;
  comment: string;
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

  /**
   * List every distribution in the account (paginated via Marker/NextMarker).
   * Used to find a distribution a crashed bootstrap created but never recorded.
   */
  async listDistributions(): Promise<DistributionListItem[]> {
    const items: DistributionListItem[] = [];
    let marker: string | undefined;
    do {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/distribution`,
        ...(marker ? { query: { Marker: marker } } : {}),
      });
      const xml = res.text();
      for (const summary of allTags(xml, 'DistributionSummary')) {
        items.push({
          id: textTag(summary, 'Id') ?? '',
          arn: textTag(summary, 'ARN') ?? '',
          domainName: textTag(summary, 'DomainName') ?? '',
          comment: textTag(summary, 'Comment') ?? '',
        });
      }
      marker = textTag(xml, 'IsTruncated') === 'true' ? textTag(xml, 'NextMarker') : undefined;
    } while (marker);
    return items;
  }

  /** Apply tags to a distribution (or any taggable CloudFront resource) by ARN. */
  async tagResource(resourceArn: string, tags: ResourceTags): Promise<void> {
    const items = Object.entries(tags)
      .map(([k, v]) => `<Tag><Key>${encodeEntities(k)}</Key><Value>${encodeEntities(v)}</Value></Tag>`)
      .join('');
    await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/tagging`,
      // Operation=Tag is required — the tagging path is shared with UntagResource
      // (Operation=Untag) and CloudFront routes on it; without it: InvalidAction.
      query: { Operation: 'Tag', Resource: resourceArn },
      headers: { 'content-type': 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><Tags xmlns="${XMLNS}"><Items>${items}</Items></Tags>`,
    });
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
   * Reconcile the distribution's aliases and viewer certificate in place — the
   * path taken when a domain is added (or changed) after the distribution was
   * first created. Compares semantically (CNAME set + certificate ARN), since
   * the returned config carries legacy elements our builder never emits.
   * Returns true when a change was pushed.
   */
  async setDistributionAliases(
    id: string,
    aliases: string[],
    acmCertificateArn: string | undefined,
  ): Promise<boolean> {
    const current = await this.getDistributionConfig(id);
    if (!current) throw new Error(`distribution ${id} not found while reconciling aliases`);
    const currentAliases = [...current.config.matchAll(/<CNAME>(.*?)<\/CNAME>/g)]
      .map((m) => m[1] ?? '')
      .sort();
    const currentCert = textTag(current.config, 'ACMCertificateArn');
    const sameAliases =
      currentAliases.length === aliases.length &&
      [...aliases].sort().every((a, i) => a === currentAliases[i]);
    if (sameAliases && currentCert === acmCertificateArn) return false;
    const next = current.config
      .replace(/<Aliases>.*?<\/Aliases>/s, aliasesBlock(aliases))
      .replace(/<ViewerCertificate>.*?<\/ViewerCertificate>/s, viewerCertificateBlock(acmCertificateArn));
    await this.client.send({
      service: 'cloudfront',
      method: 'PUT',
      path: `${API}/distribution/${id}/config`,
      headers: { 'content-type': 'application/xml', 'if-match': current.etag },
      body: next,
    });
    return true;
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
    // DescribeFunction is GET …/function/{name}/describe (XML summary). The
    // bare GET …/function/{name} is GetFunction, whose body is the raw code
    // bytes — no FunctionARN to parse.
    try {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/function/${name}/describe`,
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
    if (existing) {
      await this.client.send({
        service: 'cloudfront',
        method: 'PUT',
        path: `${API}/function/${name}`,
        headers: { 'content-type': 'application/xml', 'if-match': existing.etag },
        body: this.functionBody('UpdateFunctionRequest', name, code, comment),
      });
    } else {
      await this.client.send({
        service: 'cloudfront',
        method: 'POST',
        path: `${API}/function`,
        headers: { 'content-type': 'application/xml' },
        body: this.functionBody('CreateFunctionRequest', name, code, comment),
      });
    }
    // Re-read the current ETag before publishing. Create/update return a fresh ETag, but
    // it isn't reliably surfaced from the response headers — publishing the DEVELOPMENT
    // stage with a stale ETag fails the precondition (HTTP 412), which is what broke
    // reconciling an already-existing function.
    const current = await this.describeFunction(name);
    const pub = await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/function/${name}/publish`,
      headers: { 'if-match': current?.etag ?? '' },
    });
    return textTag(pub.text(), 'FunctionARN') ?? current?.arn ?? existing?.arn ?? '';
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

function aliasesBlock(aliases: string[]): string {
  return aliases.length > 0
    ? `<Aliases><Quantity>${aliases.length}</Quantity><Items>${aliases
        .map((a) => `<CNAME>${encodeEntities(a)}</CNAME>`)
        .join('')}</Items></Aliases>`
    : `<Aliases><Quantity>0</Quantity></Aliases>`;
}

function viewerCertificateBlock(acmCertificateArn: string | undefined): string {
  return acmCertificateArn
    ? `<ViewerCertificate><ACMCertificateArn>${encodeEntities(
        acmCertificateArn,
      )}</ACMCertificateArn><SSLSupportMethod>sni-only</SSLSupportMethod><MinimumProtocolVersion>TLSv1.2_2021</MinimumProtocolVersion></ViewerCertificate>`
    : `<ViewerCertificate><CloudFrontDefaultCertificate>true</CloudFrontDefaultCertificate></ViewerCertificate>`;
}

/** Build a DistributionConfig document. Element order follows the CloudFront schema. */
function buildDistributionConfig(input: DistributionConfigInput): string {
  const aliases = aliasesBlock(input.aliases);
  const viewerCertificate = viewerCertificateBlock(input.acmCertificateArn);

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
