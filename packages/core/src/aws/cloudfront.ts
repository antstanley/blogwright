import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';
import type { ResourceTags } from '../tags.js';
import { allTags, encodeEntities, textTag } from './xml.js';

const API = '/2020-05-31';
const XMLNS = 'http://cloudfront.amazonaws.com/doc/2020-05-31/';
/** AWS managed "CachingOptimized" cache policy. */
export const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
/** AWS managed "CachingDisabled" cache policy (used for previews - no CDN caching). */
export const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
/** AWS managed `AllViewerExceptHostHeader` origin-request policy (SSR behavior). */
export const ALL_VIEWER_EXCEPT_HOST_HEADER = 'b689b0a8-53d0-40ab-baf2-68738e2966ac';

/** Origin access control origin types this client writes. */
export type OriginAccessControlOriginType = 's3' | 'lambda';
/** `always-amz-auth` is what a Lambda Web Function origin requires. */
export type OriginAccessControlSigningBehavior = 'always' | 'always-amz-auth';

export interface CreateOriginAccessControlInput {
  name: string;
  originType: OriginAccessControlOriginType;
  signingProtocol?: 'sigv4' | undefined;
  signingBehavior?: OriginAccessControlSigningBehavior | undefined;
}

export interface DistributionSummary {
  id: string;
  arn: string;
  domainName: string;
  status: string;
  etag: string | undefined;
}

/** One entry from ListDistributions - enough to identify a distribution for adoption. */
export interface DistributionListItem {
  id: string;
  arn: string;
  domainName: string;
  comment: string;
}

/** A cache policy Blogwright owns (the SSR behavior's `<prefix>-ssr`). */
export interface CachePolicyConfigInput {
  name: string;
  comment?: string | undefined;
  minTtl: number;
  defaultTtl: number;
  maxTtl: number;
  /** Headers included in the cache key and forwarded to the origin. */
  headerNames: string[];
  /** `all` includes every query string in the key. */
  queryStrings: 'all' | 'none';
  /** Seen by the origin through the origin-request policy, never part of the key. */
  cookies: 'all' | 'none';
  gzip: boolean;
  brotli: boolean;
}

export interface CachePolicySummary {
  id: string;
  config: string;
  etag: string | undefined;
}

/** One origin in the desired distribution shape. */
export interface DistributionOriginInput {
  id: string;
  domainName: string;
  originPath: string;
  /** S3 REST origin vs Lambda Web Function endpoint. */
  kind: 's3' | 'web-function';
  originAccessControlId: string;
  /** Origin read timeout in seconds; the CloudFront default is 30. */
  originReadTimeoutSeconds?: number | undefined;
}

/** One behavior (default or ordered) in the desired distribution shape. */
export interface DistributionBehaviorInput {
  /** Ordered behaviors only; the default behavior omits it. */
  pathPattern?: string | undefined;
  targetOriginId: string;
  cachePolicyId: string;
  /** Managed policy forwarded to the origin (SSR uses AllViewerExceptHostHeader). */
  originRequestPolicyId?: string | undefined;
  /**
   * Viewer methods the behavior accepts. Omitted renders CloudFront's default
   * (GET/HEAD) exactly as the static builder always has.
   */
  allowedMethods?: string[] | undefined;
  /** Viewer-request CloudFront Function, when one is attached. */
  functionArn?: string | undefined;
}

export interface DistributionConfigInput {
  callerReference: string;
  comment: string;
  defaultRootObject: string;
  /** Empty means "leave whatever aliases the distribution already has". */
  aliases: string[];
  acmCertificateArn: string | undefined;
  origins: DistributionOriginInput[];
  defaultBehavior: DistributionBehaviorInput;
  orderedBehaviors?: DistributionBehaviorInput[] | undefined;
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

  async createOriginAccessControl(input: CreateOriginAccessControlInput): Promise<string> {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<OriginAccessControlConfig xmlns="${XMLNS}">` +
      `<Name>${encodeEntities(input.name)}</Name>` +
      `<Description>OAC for ${encodeEntities(input.name)}</Description>` +
      `<SigningProtocol>${input.signingProtocol ?? 'sigv4'}</SigningProtocol>` +
      `<SigningBehavior>${input.signingBehavior ?? 'always'}</SigningBehavior>` +
      `<OriginAccessControlOriginType>${input.originType}</OriginAccessControlOriginType>` +
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

  // --- Cache policies (the SSR behavior's own policy) ---

  private cachePolicyBody(config: CachePolicyConfigInput): string {
    const headers =
      config.headerNames.length > 0
        ? `<HeadersConfig><HeaderBehavior>whitelist</HeaderBehavior><Headers>` +
          `<Quantity>${config.headerNames.length}</Quantity><Items>` +
          config.headerNames.map((name) => `<Name>${encodeEntities(name)}</Name>`).join('') +
          `</Items></Headers></HeadersConfig>`
        : `<HeadersConfig><HeaderBehavior>none</HeaderBehavior></HeadersConfig>`;
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<CachePolicyConfig xmlns="${XMLNS}">` +
      `<Name>${encodeEntities(config.name)}</Name>` +
      (config.comment ? `<Comment>${encodeEntities(config.comment)}</Comment>` : '') +
      `<DefaultTTL>${config.defaultTtl}</DefaultTTL>` +
      `<MaxTTL>${config.maxTtl}</MaxTTL>` +
      `<MinTTL>${config.minTtl}</MinTTL>` +
      `<ParametersInCacheKeyAndForwardedToOrigin>` +
      `<CookiesConfig><CookieBehavior>${config.cookies}</CookieBehavior></CookiesConfig>` +
      `<EnableAcceptEncodingBrotli>${config.brotli}</EnableAcceptEncodingBrotli>` +
      `<EnableAcceptEncodingGzip>${config.gzip}</EnableAcceptEncodingGzip>` +
      headers +
      `<QueryStringsConfig><QueryStringBehavior>${config.queryStrings}</QueryStringBehavior></QueryStringsConfig>` +
      `</ParametersInCacheKeyAndForwardedToOrigin>` +
      `</CachePolicyConfig>`
    );
  }

  async createCachePolicy(config: CachePolicyConfigInput): Promise<{ id: string; etag: string }> {
    const res = await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/cache-policy`,
      headers: { 'content-type': 'application/xml' },
      body: this.cachePolicyBody(config),
    });
    const id = textTag(res.text(), 'Id');
    if (!id) throw new Error('CreateCachePolicy returned no Id');
    return { id, etag: res.headers['etag'] ?? '' };
  }

  async getCachePolicy(id: string): Promise<CachePolicySummary | undefined> {
    try {
      const res = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/cache-policy/${id}`,
      });
      return { id, config: res.text(), etag: res.headers['etag'] };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /**
   * Update a cache policy in place (headers/quota drift after a config change).
   * `UpdateCachePolicy` is a PUT on the policy itself; `/config` is only the
   * read path of `GetCachePolicyConfig`, and a PUT there is an `InvalidAction`.
   */
  async updateCachePolicy(
    id: string,
    config: CachePolicyConfigInput,
    etag: string | undefined,
  ): Promise<void> {
    await this.client.send({
      service: 'cloudfront',
      method: 'PUT',
      path: `${API}/cache-policy/${id}`,
      headers: {
        'content-type': 'application/xml',
        ...(etag ? { 'if-match': etag } : {}),
      },
      body: this.cachePolicyBody(config),
    });
  }

  async deleteCachePolicy(id: string): Promise<void> {
    try {
      const get = await this.client.send({
        service: 'cloudfront',
        method: 'GET',
        path: `${API}/cache-policy/${id}`,
      });
      const etag = get.headers['etag'];
      await this.client.send({
        service: 'cloudfront',
        method: 'DELETE',
        path: `${API}/cache-policy/${id}`,
        ...(etag ? { headers: { 'if-match': etag } } : {}),
      });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  /** True when a live cache-policy document already matches the desired shape. */
  cachePolicyMatches(xml: string, config: CachePolicyConfigInput): boolean {
    const params = elementXml(xml, 'ParametersInCacheKeyAndForwardedToOrigin');
    if (!params) return false;
    const headers = elementXml(params, 'HeadersConfig');
    const headerBehavior = headers ? elementText(headers, 'HeaderBehavior') : undefined;
    const names = headers
      ? elementsXml(headers, 'Name').map((n) => elementText(n, 'Name') ?? '')
      : [];
    const cookies = elementXml(params, 'CookiesConfig');
    const query = elementXml(params, 'QueryStringsConfig');
    const expectedBehavior = config.headerNames.length > 0 ? 'whitelist' : 'none';
    return (
      Number(elementText(xml, 'DefaultTTL') ?? '-1') === config.defaultTtl &&
      Number(elementText(xml, 'MaxTTL') ?? '-1') === config.maxTtl &&
      Number(elementText(xml, 'MinTTL') ?? '-1') === config.minTtl &&
      headerBehavior === expectedBehavior &&
      sameStringSet(names, config.headerNames) &&
      elementText(cookies ?? '', 'CookieBehavior') === config.cookies &&
      elementText(query ?? '', 'QueryStringBehavior') === config.queryStrings &&
      elementText(params, 'EnableAcceptEncodingGzip') === String(config.gzip) &&
      elementText(params, 'EnableAcceptEncodingBrotli') === String(config.brotli)
    );
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
      .map(
        ([k, v]) => `<Tag><Key>${encodeEntities(k)}</Key><Value>${encodeEntities(v)}</Value></Tag>`,
      )
      .join('');
    await this.client.send({
      service: 'cloudfront',
      method: 'POST',
      path: `${API}/tagging`,
      // Operation=Tag is required - the tagging path is shared with UntagResource
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
   * Reconcile the distribution's aliases and viewer certificate in place - the
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
    const currentAliases = Array.from(
      current.config.matchAll(/<CNAME>(.*?)<\/CNAME>/g),
      (m) => m[1] ?? '',
    ).sort();
    const currentCert = textTag(current.config, 'ACMCertificateArn');
    const sameAliases =
      currentAliases.length === aliases.length &&
      [...aliases].sort().every((a, i) => a === currentAliases[i]);
    if (sameAliases && currentCert === acmCertificateArn) return false;
    const next = current.config
      .replace(/<Aliases>.*?<\/Aliases>/s, aliasesBlock(aliases))
      .replace(
        /<ViewerCertificate>.*?<\/ViewerCertificate>/s,
        viewerCertificateBlock(acmCertificateArn),
      );
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
   * Reconcile the fields Blogwright owns in place: origins, default and
   * ordered behaviors, the default root object, custom error responses, and
   * - only when a domain is configured - aliases and the viewer certificate.
   * Compares the desired shape semantically against the live config and PUTs
   * only when something Blogwright owns differs, patching the current
   * document so a console-managed field (a WAF, say) survives untouched.
   * Returns true when a change was pushed.
   */
  async reconcileDistribution(id: string, input: DistributionConfigInput): Promise<boolean> {
    const current = await this.getDistributionConfig(id);
    if (!current) throw new Error(`distribution ${id} not found while reconciling`);
    if (distributionShapeMatches(current.config, input)) return false;
    const next = patchDistributionConfig(current.config, input);
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
   * distribution-level flag must be matched specifically - it is the one immediately
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
    // bytes - no FunctionARN to parse.
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
    // it isn't reliably surfaced from the response headers - publishing the DEVELOPMENT
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

/** Outer XML of the first `<tag>…</tag>` element, or undefined. */
function elementXml(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`).exec(xml)?.[0];
}

/** Every `<tag>…</tag>` element at any depth (no nested same-name elements are read). */
function elementsXml(xml: string, tag: string): string[] {
  return Array.from(
    xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g')),
    (m) => m[0],
  );
}

/** First `<tag>value</tag>` text inside a block, trimmed of nothing (values are raw). */
function elementText(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
}

/**
 * One origin. `complete` spells out every member CloudFront defaults, which
 * `UpdateDistribution` then demands explicitly - CreateDistribution accepts
 * the minimal form, an update of the same document does not. Create keeps the
 * minimal form so a static stack's request is unchanged; the patch path (the
 * only PUT) uses the complete one.
 */
function originXml(origin: DistributionOriginInput, complete: boolean): string {
  const originConfig =
    origin.kind === 's3'
      ? `<S3OriginConfig><OriginAccessIdentity></OriginAccessIdentity>` +
        (complete ? `<OriginReadTimeout>30</OriginReadTimeout>` : '') +
        `</S3OriginConfig>`
      : `<CustomOriginConfig>` +
        `<HTTPPort>80</HTTPPort><HTTPSPort>443</HTTPSPort>` +
        `<OriginProtocolPolicy>https-only</OriginProtocolPolicy>` +
        // Stated rather than left to the service default: UpdateDistribution
        // rejects an origin without it ("The parameter OriginSslProtocols is
        // required"), while CreateDistribution fills in these three - so
        // emitting them keeps the patched shape identical to the created one.
        `<OriginSslProtocols><Quantity>3</Quantity><Items>` +
        `<SslProtocol>TLSv1</SslProtocol><SslProtocol>TLSv1.1</SslProtocol>` +
        `<SslProtocol>TLSv1.2</SslProtocol>` +
        `</Items></OriginSslProtocols>` +
        `<OriginReadTimeout>${origin.originReadTimeoutSeconds ?? 30}</OriginReadTimeout>` +
        `<OriginKeepaliveTimeout>5</OriginKeepaliveTimeout>` +
        `</CustomOriginConfig>`;
  return (
    `<Origin>` +
    `<Id>${encodeEntities(origin.id)}</Id>` +
    `<DomainName>${encodeEntities(origin.domainName)}</DomainName>` +
    `<OriginPath>${encodeEntities(origin.originPath)}</OriginPath>` +
    `<CustomHeaders><Quantity>0</Quantity></CustomHeaders>` +
    originConfig +
    `<OriginAccessControlId>${encodeEntities(origin.originAccessControlId)}</OriginAccessControlId>` +
    `<ConnectionAttempts>3</ConnectionAttempts><ConnectionTimeout>10</ConnectionTimeout>` +
    (complete ? `<OriginShield><Enabled>false</Enabled></OriginShield>` : '') +
    `</Origin>`
  );
}

function originsBlock(origins: DistributionOriginInput[], complete: boolean): string {
  return (
    `<Origins><Quantity>${origins.length}</Quantity><Items>` +
    origins.map((origin) => originXml(origin, complete)).join('') +
    `</Items></Origins>`
  );
}

/**
 * One cache behavior. `pathPattern` is emitted only for ordered behaviors;
 * `complete` spells out the members CloudFront defaults and an update demands
 * (see {@link originXml}).
 */
function behaviorXml(
  behavior: DistributionBehaviorInput,
  withPathPattern: boolean,
  complete: boolean,
): string {
  const methods = behavior.allowedMethods ?? ['GET', 'HEAD'];
  return (
    (withPathPattern && behavior.pathPattern !== undefined
      ? `<PathPattern>${encodeEntities(behavior.pathPattern)}</PathPattern>`
      : '') +
    `<TargetOriginId>${encodeEntities(behavior.targetOriginId)}</TargetOriginId>` +
    `<TrustedSigners><Enabled>false</Enabled><Quantity>0</Quantity></TrustedSigners>` +
    (complete
      ? `<TrustedKeyGroups><Enabled>false</Enabled><Quantity>0</Quantity></TrustedKeyGroups>`
      : '') +
    `<ViewerProtocolPolicy>redirect-to-https</ViewerProtocolPolicy>` +
    (behavior.allowedMethods || complete
      ? `<AllowedMethods><Quantity>${methods.length}</Quantity><Items>` +
        methods.map((m) => `<Method>${m}</Method>`).join('') +
        `</Items><CachedMethods><Quantity>2</Quantity><Items><Method>GET</Method><Method>HEAD</Method></Items></CachedMethods></AllowedMethods>`
      : '') +
    (complete ? `<SmoothStreaming>false</SmoothStreaming>` : '') +
    `<Compress>true</Compress>` +
    (complete
      ? `<LambdaFunctionAssociations><Quantity>0</Quantity></LambdaFunctionAssociations>`
      : '') +
    (behavior.functionArn
      ? `<FunctionAssociations><Quantity>1</Quantity><Items><FunctionAssociation><EventType>viewer-request</EventType><FunctionARN>${encodeEntities(behavior.functionArn)}</FunctionARN></FunctionAssociation></Items></FunctionAssociations>`
      : `<FunctionAssociations><Quantity>0</Quantity></FunctionAssociations>`) +
    (complete ? `<FieldLevelEncryptionId></FieldLevelEncryptionId>` : '') +
    `<CachePolicyId>${encodeEntities(behavior.cachePolicyId)}</CachePolicyId>` +
    (behavior.originRequestPolicyId
      ? `<OriginRequestPolicyId>${encodeEntities(behavior.originRequestPolicyId)}</OriginRequestPolicyId>`
      : '') +
    (complete ? `<GrpcConfig><Enabled>false</Enabled></GrpcConfig>` : '')
  );
}

function defaultBehaviorBlock(behavior: DistributionBehaviorInput, complete: boolean): string {
  return `<DefaultCacheBehavior>${behaviorXml(behavior, false, complete)}</DefaultCacheBehavior>`;
}

function cacheBehaviorsBlock(behaviors: DistributionBehaviorInput[], complete: boolean): string {
  if (behaviors.length === 0) return `<CacheBehaviors><Quantity>0</Quantity></CacheBehaviors>`;
  return (
    `<CacheBehaviors><Quantity>${behaviors.length}</Quantity><Items>` +
    behaviors
      .map((b) => `<CacheBehavior>${behaviorXml(b, true, complete)}</CacheBehavior>`)
      .join('') +
    `</Items></CacheBehaviors>`
  );
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
    originsBlock(input.origins, false) +
    defaultBehaviorBlock(input.defaultBehavior, false) +
    cacheBehaviorsBlock(input.orderedBehaviors ?? [], false) +
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

/** The aliases + viewer certificate a reconcile should end at, or undefined to leave them. */
function desiredAliases(
  input: DistributionConfigInput,
): { aliases: string[]; cert: string | undefined } | undefined {
  return input.aliases.length > 0
    ? { aliases: input.aliases, cert: input.acmCertificateArn }
    : undefined;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}

interface ParsedOrigin {
  id: string;
  domainName: string;
  originPath: string;
  kind: 's3' | 'web-function';
  oacId: string;
  readTimeout: number | undefined;
}

function parseOrigin(block: string): ParsedOrigin {
  const custom = elementXml(block, 'CustomOriginConfig') !== undefined;
  return {
    id: elementText(block, 'Id') ?? '',
    domainName: elementText(block, 'DomainName') ?? '',
    originPath: elementText(block, 'OriginPath') ?? '',
    kind: custom ? 'web-function' : 's3',
    oacId: elementText(block, 'OriginAccessControlId') ?? '',
    readTimeout: custom ? Number(elementText(block, 'OriginReadTimeout') ?? '30') : undefined,
  };
}

interface ParsedBehavior {
  targetOriginId: string;
  cachePolicyId: string;
  originRequestPolicyId: string | undefined;
  allowedMethods: string[];
  functionArns: string[];
  pathPattern: string | undefined;
}

function parseBehavior(block: string): ParsedBehavior {
  // `<CachedMethods>` nests inside `<AllowedMethods>` and lists `<Method>`
  // elements of its own; counted as allowed methods they make every live
  // document differ from the shape that produced it.
  const allowed = elementXml(block, 'AllowedMethods')?.replace(
    /<CachedMethods(?:\s[^>]*)?>[\s\S]*?<\/CachedMethods>/,
    '',
  );
  const functions = elementXml(block, 'FunctionAssociations');
  return {
    targetOriginId: elementText(block, 'TargetOriginId') ?? '',
    cachePolicyId: elementText(block, 'CachePolicyId') ?? '',
    originRequestPolicyId: elementText(block, 'OriginRequestPolicyId'),
    allowedMethods: allowed
      ? elementsXml(allowed, 'Method').map((m) => elementText(m, 'Method') ?? '')
      : ['GET', 'HEAD'],
    functionArns: functions
      ? elementsXml(functions, 'FunctionARN').map((m) => elementText(m, 'FunctionARN') ?? '')
      : [],
    pathPattern: elementText(block, 'PathPattern'),
  };
}

function sameOrigin(parsed: ParsedOrigin, desired: DistributionOriginInput): boolean {
  const readTimeout = desired.originReadTimeoutSeconds ?? (desired.kind === 's3' ? undefined : 30);
  return (
    parsed.id === desired.id &&
    parsed.domainName === desired.domainName &&
    parsed.originPath === desired.originPath &&
    parsed.kind === desired.kind &&
    parsed.oacId === desired.originAccessControlId &&
    parsed.readTimeout === readTimeout
  );
}

function sameBehavior(parsed: ParsedBehavior, desired: DistributionBehaviorInput): boolean {
  const allowed = desired.allowedMethods ?? ['GET', 'HEAD'];
  const functions = desired.functionArn ? [desired.functionArn] : [];
  return (
    parsed.targetOriginId === desired.targetOriginId &&
    parsed.cachePolicyId === desired.cachePolicyId &&
    parsed.originRequestPolicyId === desired.originRequestPolicyId &&
    sameStringSet(parsed.allowedMethods, allowed) &&
    sameStringSet(parsed.functionArns, functions) &&
    parsed.pathPattern === desired.pathPattern
  );
}

function sameCustomErrorResponses(
  block: string | undefined,
  responses: CustomErrorResponse[] | undefined,
): boolean {
  const desired = [...(responses ?? [])].sort((a, b) => a.errorCode - b.errorCode);
  const parsed = elementsXml(block ?? '', 'CustomErrorResponse').map((r) => ({
    errorCode: Number(elementText(r, 'ErrorCode') ?? '0'),
    responsePagePath: elementText(r, 'ResponsePagePath') ?? '',
    responseCode: Number(elementText(r, 'ResponseCode') ?? '0'),
  }));
  return (
    parsed.length === desired.length &&
    parsed.every((p, i) => {
      const d = desired[i];
      return (
        d !== undefined &&
        p.errorCode === d.errorCode &&
        p.responsePagePath === d.responsePagePath &&
        p.responseCode === d.responseCode
      );
    })
  );
}

/**
 * Semantic comparison of the fields Blogwright owns. CallerReference, Comment
 * and ViewerCertificate are deliberately not compared here: the first is
 * immutable identity, and the certificate is only reconciled together with a
 * configured alias set (so dropping `--domain` never detaches a live host).
 */
function distributionShapeMatches(current: string, input: DistributionConfigInput): boolean {
  const parsedOrigins = elementsXml(elementXml(current, 'Origins') ?? '', 'Origin').map(
    parseOrigin,
  );
  if (parsedOrigins.length !== input.origins.length) return false;
  const byId = new Map(parsedOrigins.map((o) => [o.id, o]));
  for (const desired of input.origins) {
    const parsed = byId.get(desired.id);
    if (!parsed || !sameOrigin(parsed, desired)) return false;
  }

  const defaultBlock = elementXml(current, 'DefaultCacheBehavior');
  if (!defaultBlock || !sameBehavior(parseBehavior(defaultBlock), input.defaultBehavior)) {
    return false;
  }

  const desiredOrdered = input.orderedBehaviors ?? [];
  const parsedOrdered = elementsXml(elementXml(current, 'CacheBehaviors') ?? '', 'CacheBehavior');
  if (parsedOrdered.length !== desiredOrdered.length) return false;
  for (const [i, desired] of desiredOrdered.entries()) {
    const parsed = parsedOrdered[i];
    if (parsed === undefined || !sameBehavior(parseBehavior(parsed), desired)) return false;
  }

  if ((elementText(current, 'DefaultRootObject') ?? '') !== input.defaultRootObject) return false;
  if (
    !sameCustomErrorResponses(
      elementXml(current, 'CustomErrorResponses'),
      input.customErrorResponses,
    )
  ) {
    return false;
  }

  const desiredAlias = desiredAliases(input);
  if (desiredAlias) {
    const currentAliases = Array.from(
      current.matchAll(/<CNAME>(.*?)<\/CNAME>/g),
      (m) => m[1] ?? '',
    );
    if (!sameStringSet(currentAliases, desiredAlias.aliases)) return false;
    if ((textTag(current, 'ACMCertificateArn') ?? undefined) !== desiredAlias.cert) return false;
  }
  return true;
}

/** Replace an element in place, inserting it after `afterTag` when absent. */
function replaceOrInsertElement(xml: string, tag: string, block: string, afterTag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`);
  if (re.test(xml)) return xml.replace(re, block);
  const after = new RegExp(`</${afterTag}>`).exec(xml);
  if (!after)
    throw new Error(`cannot patch <${tag}>: no </${afterTag}> in the distribution config`);
  const at = after.index + after[0].length;
  return xml.slice(0, at) + block + xml.slice(at);
}

/** Patch only the owned elements into the live document, preserving everything else. */
function patchDistributionConfig(current: string, input: DistributionConfigInput): string {
  const desiredAlias = desiredAliases(input);
  let next = current;
  if (desiredAlias) {
    next = next
      .replace(/<Aliases>[\s\S]*?<\/Aliases>/, aliasesBlock(desiredAlias.aliases))
      .replace(
        /<ViewerCertificate>[\s\S]*?<\/ViewerCertificate>/,
        viewerCertificateBlock(desiredAlias.cert),
      );
  }
  next = replaceOrInsertElement(
    next,
    'DefaultRootObject',
    `<DefaultRootObject>${encodeEntities(input.defaultRootObject)}</DefaultRootObject>`,
    'Aliases',
  );
  next = replaceOrInsertElement(
    next,
    'Origins',
    originsBlock(input.origins, true),
    'DefaultRootObject',
  );
  next = replaceOrInsertElement(
    next,
    'DefaultCacheBehavior',
    defaultBehaviorBlock(input.defaultBehavior, true),
    'Origins',
  );
  next = replaceOrInsertElement(
    next,
    'CacheBehaviors',
    cacheBehaviorsBlock(input.orderedBehaviors ?? [], true),
    'DefaultCacheBehavior',
  );
  next = replaceOrInsertElement(
    next,
    'CustomErrorResponses',
    buildCustomErrorResponses(input.customErrorResponses),
    'CacheBehaviors',
  );
  return next;
}
