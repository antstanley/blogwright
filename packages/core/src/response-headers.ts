/**
 * The `headers` config key: the HTTP response headers CloudFront adds to every
 * response of a site, through one Blogwright-owned response headers policy.
 * Owns the key's types, its CloudFront-derived limits and its validation;
 * `mergeConfig` calls {@link normalizeResponseHeadersConfig} and the CLI's
 * resource graph turns the result into the policy.
 */

/** `X-Frame-Options` directive, spelled as CloudFront's `FrameOption` lowercased. */
export type FrameOptionsMode = 'deny' | 'sameorigin';

/** The `Referrer-Policy` values CloudFront accepts. */
export const REFERRER_POLICY_MODES = [
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
] as const;

/** One `Referrer-Policy` value; see {@link REFERRER_POLICY_MODES}. */
export type ReferrerPolicyMode = (typeof REFERRER_POLICY_MODES)[number];

/** `Strict-Transport-Security` directives. */
export interface StrictTransportSecurityConfig {
  /** The `max-age` directive, in seconds. */
  maxAgeSeconds: number;
  /** Adds `includeSubDomains`. */
  includeSubdomains: boolean;
  /** Adds `preload`. */
  preload: boolean;
}

/**
 * The security headers CloudFront configures by name. Absent fields add no
 * header; `contentTypeOptions: true` adds `X-Content-Type-Options: nosniff`.
 */
export interface SecurityHeadersConfig {
  hsts?: StrictTransportSecurityConfig | undefined;
  contentTypeOptions: boolean;
  frameOptions?: FrameOptionsMode | undefined;
  referrerPolicy?: ReferrerPolicyMode | undefined;
  contentSecurityPolicy?: string | undefined;
}

/** One header added verbatim (`Permissions-Policy`, `Cross-Origin-Opener-Policy`, ...). */
export interface CustomResponseHeader {
  name: string;
  value: string;
}

/**
 * The validated `headers` block. Every header overrides one of the same name
 * the origin sends, so the configured value is the one viewers receive.
 */
export interface ResponseHeadersConfig {
  security: SecurityHeadersConfig;
  custom: CustomResponseHeader[];
}

/** What a config file may write under `headers`; `hsts: true` takes the defaults below. */
export interface ResponseHeadersInput {
  security?:
    | (Omit<Partial<SecurityHeadersConfig>, 'hsts'> & {
        hsts?: boolean | Partial<StrictTransportSecurityConfig> | undefined;
      })
    | undefined;
  custom?: CustomResponseHeader[] | undefined;
}

/** `max-age` for `hsts: true`: one year, the common minimum for a long-lived policy. */
export const HSTS_DEFAULT_MAX_AGE_SECONDS = 31_536_000;
/** CloudFront stores `max-age` as a signed 32-bit integer. */
export const HSTS_MAX_AGE_LIMIT_SECONDS = 2_147_483_647;
/**
 * CloudFront's default quota for custom headers in one response headers
 * policy. Adjustable per account, so config load does not enforce it: a policy
 * over the account's quota is refused by CloudFront, and the CLI names this
 * default when it is.
 */
export const CUSTOM_RESPONSE_HEADERS_DEFAULT_QUOTA = 10;
/**
 * CloudFront's default quota for the length of the `Content-Security-Policy`
 * value. Adjustable per account, so - like the custom header count - it is
 * left to CloudFront rather than enforced at config load.
 */
export const CONTENT_SECURITY_POLICY_DEFAULT_QUOTA = 1_783;
/** CloudFront's maximum length of a custom header name (a fixed limit). */
export const RESPONSE_HEADER_NAME_MAX_LENGTH = 256;
/** CloudFront's maximum length of one custom header value (a fixed limit). */
export const RESPONSE_HEADER_VALUE_MAX_LENGTH = 1_783;
/**
 * CloudFront's maximum length of every custom header name and value combined
 * (a fixed limit).
 */
export const CUSTOM_RESPONSE_HEADERS_MAX_TOTAL_LENGTH = 10_240;

/** RFC 7230 token characters - what an HTTP header name may contain. */
export const HEADER_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** DEL, the one control character above the C0 range. */
const DELETE_CHARACTER_CODE = 0x7f;
/** The first printable character: everything below it is a C0 control character. */
const FIRST_PRINTABLE_CHARACTER_CODE = 0x20;

/** Control characters (CR and LF among them) would split or corrupt a header value. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < FIRST_PRINTABLE_CHARACTER_CODE || code === DELETE_CHARACTER_CODE) return true;
  }
  return false;
}

/**
 * Headers `headers.security` sets by name (lowercased). A custom entry for one
 * would be a second, competing definition, so it is refused with a pointer to
 * the security field.
 */
const SECURITY_HEADER_FIELDS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'hsts',
  'x-content-type-options': 'contentTypeOptions',
  'x-frame-options': 'frameOptions',
  'referrer-policy': 'referrerPolicy',
  'content-security-policy': 'contentSecurityPolicy',
};

const HEADERS_KEYS = new Set<string>(['security', 'custom']);
const SECURITY_KEYS = new Set<string>([
  'hsts',
  'contentTypeOptions',
  'frameOptions',
  'referrerPolicy',
  'contentSecurityPolicy',
]);
const HSTS_KEYS = new Set<string>(['maxAgeSeconds', 'includeSubdomains', 'preload']);
const CUSTOM_HEADER_KEYS = new Set<string>(['name', 'value']);
const FRAME_OPTIONS_MODES: readonly FrameOptionsMode[] = ['deny', 'sameorigin'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuseUnknownKeys(
  block: Record<string, unknown>,
  known: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(block)) {
    if (!known.has(key)) throw new Error(`config.${label} has unknown key "${key}"`);
  }
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`config.${label} must be true or false, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** A header value as text: a string free of control characters. */
function headerText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`config.${label} must be a string`);
  if (hasControlCharacter(value)) {
    throw new Error(`config.${label} must not contain control characters (line breaks included)`);
  }
  return value;
}

/** The CSP: non-empty, since a policy with no directives says nothing. */
function contentSecurityPolicy(value: unknown): string {
  const label = 'headers.security.contentSecurityPolicy';
  const text = headerText(value, label);
  if (text === '') throw new Error(`config.${label} must be a non-empty string`);
  return text;
}

/**
 * A custom header value: may be empty (CloudFront then sends the header with
 * no value), within CloudFront's fixed per-value limit.
 */
function customHeaderValue(value: unknown, label: string): string {
  const text = headerText(value, label);
  if (text.length > RESPONSE_HEADER_VALUE_MAX_LENGTH) {
    throw new Error(
      `config.${label} is ${text.length} characters, over CloudFront's ` +
        `${RESPONSE_HEADER_VALUE_MAX_LENGTH}-character header-value limit`,
    );
  }
  return text;
}

function normalizeHsts(raw: unknown): StrictTransportSecurityConfig | undefined {
  if (raw === false) return undefined;
  const defaults: StrictTransportSecurityConfig = {
    maxAgeSeconds: HSTS_DEFAULT_MAX_AGE_SECONDS,
    includeSubdomains: false,
    preload: false,
  };
  if (raw === true) return defaults;
  if (!isRecord(raw)) {
    throw new Error(
      'config.headers.security.hsts must be true, false, or an object of ' +
        '"maxAgeSeconds", "includeSubdomains" and "preload"',
    );
  }
  refuseUnknownKeys(raw, HSTS_KEYS, 'headers.security.hsts');
  const maxAgeSeconds = raw.maxAgeSeconds ?? defaults.maxAgeSeconds;
  if (
    typeof maxAgeSeconds !== 'number' ||
    !Number.isInteger(maxAgeSeconds) ||
    maxAgeSeconds < 0 ||
    maxAgeSeconds > HSTS_MAX_AGE_LIMIT_SECONDS
  ) {
    throw new Error(
      `config.headers.security.hsts.maxAgeSeconds must be an integer in ` +
        `0..${HSTS_MAX_AGE_LIMIT_SECONDS}, got ${String(maxAgeSeconds)}`,
    );
  }
  return {
    maxAgeSeconds,
    includeSubdomains:
      raw.includeSubdomains === undefined
        ? defaults.includeSubdomains
        : booleanField(raw.includeSubdomains, 'headers.security.hsts.includeSubdomains'),
    preload:
      raw.preload === undefined
        ? defaults.preload
        : booleanField(raw.preload, 'headers.security.hsts.preload'),
  };
}

function normalizeFrameOptions(raw: unknown): FrameOptionsMode {
  const mode = FRAME_OPTIONS_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) {
    throw new Error(
      `config.headers.security.frameOptions must be one of ${FRAME_OPTIONS_MODES.join(', ')}, ` +
        `got ${JSON.stringify(raw)}`,
    );
  }
  return mode;
}

function normalizeReferrerPolicy(raw: unknown): ReferrerPolicyMode {
  const mode = REFERRER_POLICY_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) {
    throw new Error(
      `config.headers.security.referrerPolicy must be one of ${REFERRER_POLICY_MODES.join(', ')}, ` +
        `got ${JSON.stringify(raw)}`,
    );
  }
  return mode;
}

function normalizeSecurityHeaders(raw: unknown): SecurityHeadersConfig {
  if (raw === undefined) return { contentTypeOptions: false };
  if (!isRecord(raw)) throw new Error('config.headers.security must be an object');
  refuseUnknownKeys(raw, SECURITY_KEYS, 'headers.security');
  const security: SecurityHeadersConfig = {
    contentTypeOptions:
      raw.contentTypeOptions === undefined
        ? false
        : booleanField(raw.contentTypeOptions, 'headers.security.contentTypeOptions'),
  };
  const hsts = raw.hsts === undefined ? undefined : normalizeHsts(raw.hsts);
  if (hsts) security.hsts = hsts;
  if (raw.frameOptions !== undefined)
    security.frameOptions = normalizeFrameOptions(raw.frameOptions);
  if (raw.referrerPolicy !== undefined) {
    security.referrerPolicy = normalizeReferrerPolicy(raw.referrerPolicy);
  }
  if (raw.contentSecurityPolicy !== undefined) {
    security.contentSecurityPolicy = contentSecurityPolicy(raw.contentSecurityPolicy);
  }
  return security;
}

function normalizeCustomHeader(raw: unknown, index: number): CustomResponseHeader {
  const label = `headers.custom[${index}]`;
  if (!isRecord(raw)) throw new Error(`config.${label} must be an object of "name" and "value"`);
  refuseUnknownKeys(raw, CUSTOM_HEADER_KEYS, label);
  const name = raw.name;
  if (typeof name !== 'string' || !HEADER_TOKEN_PATTERN.test(name)) {
    throw new Error(
      `config.${label}.name must be an HTTP header name (RFC 7230 token), got ${JSON.stringify(name)}`,
    );
  }
  if (name.length > RESPONSE_HEADER_NAME_MAX_LENGTH) {
    throw new Error(
      `config.${label}.name is longer than CloudFront's ` +
        `${RESPONSE_HEADER_NAME_MAX_LENGTH}-character header-name limit`,
    );
  }
  const securityField = SECURITY_HEADER_FIELDS[name.toLowerCase()];
  if (securityField !== undefined) {
    throw new Error(
      `config.${label} cannot set "${name}": it is a security header - set ` +
        `headers.security.${securityField} instead`,
    );
  }
  return { name, value: customHeaderValue(raw.value, `${label}.value`) };
}

function normalizeCustomHeaders(raw: unknown): CustomResponseHeader[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error('config.headers.custom must be an array of { "name", "value" } objects');
  }
  const headers = raw.map((entry: unknown, i: number) => normalizeCustomHeader(entry, i));
  const seen = new Set<string>();
  for (const { name } of headers) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) throw new Error(`config.headers.custom lists "${name}" more than once`);
    seen.add(lower);
  }
  const totalLength = headers.reduce((sum, h) => sum + h.name.length + h.value.length, 0);
  if (totalLength > CUSTOM_RESPONSE_HEADERS_MAX_TOTAL_LENGTH) {
    throw new Error(
      `config.headers.custom names and values total ${totalLength} characters, over ` +
        `CloudFront's ${CUSTOM_RESPONSE_HEADERS_MAX_TOTAL_LENGTH}-character limit`,
    );
  }
  return headers;
}

/** True when the validated block adds at least one header. */
function addsAnyHeader(config: ResponseHeadersConfig): boolean {
  const { security, custom } = config;
  return (
    security.hsts !== undefined ||
    security.contentTypeOptions ||
    security.frameOptions !== undefined ||
    security.referrerPolicy !== undefined ||
    security.contentSecurityPolicy !== undefined ||
    custom.length > 0
  );
}

/**
 * Validate a raw `headers` block. Returns undefined when the key is absent or
 * the block adds no header at all, so emptying the block retires the policy
 * exactly as deleting the key does.
 */
export function normalizeResponseHeadersConfig(raw: unknown): ResponseHeadersConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error('config.headers must be an object');
  refuseUnknownKeys(raw, HEADERS_KEYS, 'headers');
  const config: ResponseHeadersConfig = {
    security: normalizeSecurityHeaders(raw.security),
    custom: normalizeCustomHeaders(raw.custom),
  };
  return addsAnyHeader(config) ? config : undefined;
}
