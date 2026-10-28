/**
 * The CloudFront `ResponseHeadersPolicyConfig` document for a Blogwright-owned
 * response headers policy: rendering the desired shape, and the semantic
 * comparison that decides whether a live policy needs an update. The policy
 * is owned whole - a section Blogwright never writes (CORS, `X-XSS-Protection`,
 * removed headers, `Server-Timing`) counts as drift and is cleared by the
 * next update.
 */

import type {
  CustomResponseHeader,
  ResponseHeadersConfig,
  StrictTransportSecurityConfig,
} from '../response-headers.js';
import { decodeEntities, encodeEntities } from './xml.js';

const XMLNS = 'http://cloudfront.amazonaws.com/doc/2020-05-31/';

/** A response headers policy Blogwright owns: its identity plus the `headers` config. */
export interface ResponseHeadersPolicyConfigInput {
  name: string;
  comment: string;
  headers: ResponseHeadersConfig;
}

/** A live policy as `GetResponseHeadersPolicy` returns it. */
export interface ResponseHeadersPolicySummary {
  id: string;
  config: string;
  etag: string | undefined;
}

/** `<Override>true</Override>`: the policy's value replaces one the origin sends. */
const OVERRIDE = '<Override>true</Override>';

/** Sections a Blogwright policy never writes; any of them in a live policy is drift. */
const UNOWNED_SECTIONS = ['CorsConfig', 'XSSProtection', 'RemoveHeadersConfig'];

function strictTransportSecurityXml(hsts: StrictTransportSecurityConfig): string {
  return (
    `<StrictTransportSecurity>${OVERRIDE}` +
    `<IncludeSubdomains>${hsts.includeSubdomains}</IncludeSubdomains>` +
    `<Preload>${hsts.preload}</Preload>` +
    `<AccessControlMaxAgeSec>${hsts.maxAgeSeconds}</AccessControlMaxAgeSec>` +
    `</StrictTransportSecurity>`
  );
}

/** `SecurityHeadersConfig` in the order of the CloudFront model; empty when nothing is set. */
function securityHeadersXml(headers: ResponseHeadersConfig): string {
  const { hsts, contentTypeOptions, frameOptions, referrerPolicy, contentSecurityPolicy } =
    headers.security;
  const inner =
    (frameOptions
      ? `<FrameOptions>${OVERRIDE}<FrameOption>${frameOptions.toUpperCase()}</FrameOption></FrameOptions>`
      : '') +
    (referrerPolicy
      ? `<ReferrerPolicy>${OVERRIDE}<ReferrerPolicy>${referrerPolicy}</ReferrerPolicy></ReferrerPolicy>`
      : '') +
    (contentSecurityPolicy
      ? `<ContentSecurityPolicy>${OVERRIDE}<ContentSecurityPolicy>${encodeEntities(
          contentSecurityPolicy,
        )}</ContentSecurityPolicy></ContentSecurityPolicy>`
      : '') +
    (contentTypeOptions ? `<ContentTypeOptions>${OVERRIDE}</ContentTypeOptions>` : '') +
    (hsts ? strictTransportSecurityXml(hsts) : '');
  return inner ? `<SecurityHeadersConfig>${inner}</SecurityHeadersConfig>` : '';
}

function customHeadersXml(custom: CustomResponseHeader[]): string {
  if (custom.length === 0)
    return `<CustomHeadersConfig><Quantity>0</Quantity></CustomHeadersConfig>`;
  const items = custom
    .map(
      (header) =>
        `<ResponseHeadersPolicyCustomHeader>` +
        `<Header>${encodeEntities(header.name)}</Header>` +
        `<Value>${encodeEntities(header.value)}</Value>` +
        OVERRIDE +
        `</ResponseHeadersPolicyCustomHeader>`,
    )
    .join('');
  return (
    `<CustomHeadersConfig><Quantity>${custom.length}</Quantity>` +
    `<Items>${items}</Items></CustomHeadersConfig>`
  );
}

/** The request body of `CreateResponseHeadersPolicy` / `UpdateResponseHeadersPolicy`. */
export function responseHeadersPolicyBody(input: ResponseHeadersPolicyConfigInput): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ResponseHeadersPolicyConfig xmlns="${XMLNS}">` +
    `<Name>${encodeEntities(input.name)}</Name>` +
    `<Comment>${encodeEntities(input.comment)}</Comment>` +
    securityHeadersXml(input.headers) +
    customHeadersXml(input.headers.custom) +
    `</ResponseHeadersPolicyConfig>`
  );
}

/** Outer XML of the first `<tag>…</tag>` element, or undefined. */
function element(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`).exec(xml)?.[0];
}

/**
 * Decoded text of the first `<tag>value</tag>` holding text only. Matching
 * text-only content is what reads the inner `<ReferrerPolicy>` (and
 * `<ContentSecurityPolicy>`) rather than the same-named wrapper around it.
 */
function leafText(xml: string, tag: string): string | undefined {
  const raw = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
  return raw === undefined ? undefined : decodeEntities(raw);
}

function parseStrictTransportSecurity(security: string): StrictTransportSecurityConfig | undefined {
  const block = element(security, 'StrictTransportSecurity');
  if (!block) return undefined;
  return {
    maxAgeSeconds: Number(leafText(block, 'AccessControlMaxAgeSec') ?? '-1'),
    includeSubdomains: leafText(block, 'IncludeSubdomains') === 'true',
    preload: leafText(block, 'Preload') === 'true',
  };
}

/**
 * A live policy's headers, as text: compared against the desired config, never
 * turned back into one, so a value Blogwright would not write simply differs.
 */
interface LiveHeaders {
  hsts: StrictTransportSecurityConfig | undefined;
  contentTypeOptions: boolean;
  frameOption: string | undefined;
  referrerPolicy: string | undefined;
  contentSecurityPolicy: string | undefined;
  custom: CustomResponseHeader[];
}

function parseLiveHeaders(xml: string): LiveHeaders {
  const security = element(xml, 'SecurityHeadersConfig') ?? '';
  const custom = Array.from(
    (element(xml, 'CustomHeadersConfig') ?? '').matchAll(
      /<ResponseHeadersPolicyCustomHeader>[\s\S]*?<\/ResponseHeadersPolicyCustomHeader>/g,
    ),
    ([item]) => ({ name: leafText(item, 'Header') ?? '', value: leafText(item, 'Value') ?? '' }),
  );
  return {
    hsts: parseStrictTransportSecurity(security),
    contentTypeOptions: element(security, 'ContentTypeOptions') !== undefined,
    frameOption: leafText(element(security, 'FrameOptions') ?? '', 'FrameOption'),
    referrerPolicy: leafText(element(security, 'ReferrerPolicy') ?? '', 'ReferrerPolicy'),
    contentSecurityPolicy: leafText(
      element(security, 'ContentSecurityPolicy') ?? '',
      'ContentSecurityPolicy',
    ),
    custom,
  };
}

function sameHsts(
  live: StrictTransportSecurityConfig | undefined,
  desired: StrictTransportSecurityConfig | undefined,
): boolean {
  if (live === undefined || desired === undefined) return live === desired;
  return (
    live.maxAgeSeconds === desired.maxAgeSeconds &&
    live.includeSubdomains === desired.includeSubdomains &&
    live.preload === desired.preload
  );
}

function sameCustomHeaders(live: CustomResponseHeader[], desired: CustomResponseHeader[]): boolean {
  const key = (header: CustomResponseHeader) => `${header.name}\n${header.value}`;
  const liveKeys = live.map(key).sort();
  const desiredKeys = desired.map(key).sort();
  return liveKeys.length === desiredKeys.length && liveKeys.every((k, i) => k === desiredKeys[i]);
}

/** True when a live `GetResponseHeadersPolicy` document already carries exactly `headers`. */
export function responseHeadersPolicyMatches(xml: string, headers: ResponseHeadersConfig): boolean {
  if (UNOWNED_SECTIONS.some((section) => element(xml, section) !== undefined)) return false;
  if (leafText(element(xml, 'ServerTimingHeadersConfig') ?? '', 'Enabled') === 'true') return false;
  if (/<Override>false<\/Override>/.test(xml)) return false;
  const live = parseLiveHeaders(xml);
  const desired = headers.security;
  return (
    sameHsts(live.hsts, desired.hsts) &&
    live.contentTypeOptions === desired.contentTypeOptions &&
    live.frameOption === desired.frameOptions?.toUpperCase() &&
    live.referrerPolicy === desired.referrerPolicy &&
    live.contentSecurityPolicy === desired.contentSecurityPolicy &&
    sameCustomHeaders(live.custom, headers.custom)
  );
}
