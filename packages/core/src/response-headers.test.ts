import { describe, expect, it } from 'vitest';

import { parseConfig } from './config.js';
import {
  CONTENT_SECURITY_POLICY_DEFAULT_QUOTA,
  CUSTOM_RESPONSE_HEADERS_DEFAULT_QUOTA,
  CUSTOM_RESPONSE_HEADERS_MAX_TOTAL_LENGTH,
  HSTS_DEFAULT_MAX_AGE_SECONDS,
  HSTS_MAX_AGE_LIMIT_SECONDS,
  RESPONSE_HEADER_NAME_MAX_LENGTH,
  RESPONSE_HEADER_VALUE_MAX_LENGTH,
} from './response-headers.js';

/** Parse a config whose only non-required key is `headers`. */
function headersOf(headers: unknown) {
  return parseConfig(JSON.stringify({ siteName: 'example', headers })).headers;
}

function customHeaders(count: number, value = 'x') {
  return Array.from({ length: count }, (_, i) => ({ name: `X-Custom-${i}`, value }));
}

describe('headers config', () => {
  it('is absent by default', () => {
    expect(parseConfig('{ "siteName": "example" }').headers).toBeUndefined();
  });

  it('accepts the full security set plus custom headers, as written in the issue', () => {
    const csp = "default-src 'self'; frame-ancestors 'none'; object-src 'none'";
    expect(
      headersOf({
        security: {
          hsts: true,
          contentTypeOptions: true,
          frameOptions: 'deny',
          referrerPolicy: 'no-referrer',
          contentSecurityPolicy: csp,
        },
        custom: [
          { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { name: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { name: 'Permissions-Policy', value: 'accelerometer=(), camera=()' },
        ],
      }),
    ).toEqual({
      security: {
        hsts: {
          maxAgeSeconds: HSTS_DEFAULT_MAX_AGE_SECONDS,
          includeSubdomains: false,
          preload: false,
        },
        contentTypeOptions: true,
        frameOptions: 'deny',
        referrerPolicy: 'no-referrer',
        contentSecurityPolicy: csp,
      },
      custom: [
        { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { name: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        { name: 'Permissions-Policy', value: 'accelerometer=(), camera=()' },
      ],
    });
  });

  it('treats a block that adds no header as no block at all', () => {
    expect(headersOf({})).toBeUndefined();
    expect(headersOf({ security: { hsts: false, contentTypeOptions: false }, custom: [] })).toBe(
      undefined,
    );
  });

  it('rejects a non-object block and unknown keys at every level', () => {
    for (const block of [null, 'headers', [], 42, true]) {
      expect(() => headersOf(block)).toThrow(/config\.headers must be an object/);
    }
    expect(() => headersOf({ securty: {} })).toThrow(/config\.headers has unknown key "securty"/);
    expect(() => headersOf({ security: { xssProtection: true } })).toThrow(
      /headers\.security has unknown key "xssProtection"/,
    );
    expect(() => headersOf({ security: { hsts: { maxAge: 1 } } })).toThrow(
      /headers\.security\.hsts has unknown key "maxAge"/,
    );
    expect(() => headersOf({ custom: [{ name: 'X-A', value: 'b', override: false }] })).toThrow(
      /headers\.custom\[0\] has unknown key "override"/,
    );
  });

  describe('hsts', () => {
    it('fills the object form from the defaults', () => {
      expect(headersOf({ security: { hsts: { includeSubdomains: true } } })?.security.hsts).toEqual(
        { maxAgeSeconds: HSTS_DEFAULT_MAX_AGE_SECONDS, includeSubdomains: true, preload: false },
      );
    });

    it('accepts max-age from 0 to the 32-bit limit and rejects either side', () => {
      for (const maxAgeSeconds of [0, HSTS_MAX_AGE_LIMIT_SECONDS]) {
        expect(headersOf({ security: { hsts: { maxAgeSeconds } } })?.security.hsts).toMatchObject({
          maxAgeSeconds,
        });
      }
      for (const maxAgeSeconds of [-1, HSTS_MAX_AGE_LIMIT_SECONDS + 1, 1.5, '600']) {
        expect(() => headersOf({ security: { hsts: { maxAgeSeconds } } })).toThrow(
          /hsts\.maxAgeSeconds must be an integer/,
        );
      }
    });

    it('rejects a non-boolean flag or a string in place of the block', () => {
      expect(() => headersOf({ security: { hsts: { preload: 'yes' } } })).toThrow(
        /hsts\.preload must be true or false/,
      );
      expect(() => headersOf({ security: { hsts: 'max-age=600' } })).toThrow(
        /hsts must be true, false, or an object/,
      );
    });
  });

  it('accepts each frame option and referrer policy CloudFront knows, and nothing else', () => {
    expect(headersOf({ security: { frameOptions: 'sameorigin' } })?.security.frameOptions).toBe(
      'sameorigin',
    );
    expect(() => headersOf({ security: { frameOptions: 'DENY' } })).toThrow(
      /frameOptions must be one of deny, sameorigin/,
    );
    expect(() => headersOf({ security: { frameOptions: 'allow-from' } })).toThrow(/frameOptions/);
    expect(
      headersOf({ security: { referrerPolicy: 'strict-origin-when-cross-origin' } })?.security
        .referrerPolicy,
    ).toBe('strict-origin-when-cross-origin');
    expect(() => headersOf({ security: { referrerPolicy: 'never' } })).toThrow(
      /referrerPolicy must be one of no-referrer,/,
    );
  });

  it('rejects a non-boolean contentTypeOptions', () => {
    expect(() => headersOf({ security: { contentTypeOptions: 'nosniff' } })).toThrow(
      /contentTypeOptions must be true or false/,
    );
  });

  it('leaves the adjustable CSP length quota to CloudFront and refuses control characters', () => {
    // An account may have raised the 1,783-character default, so load does not refuse it.
    const overDefault = 'a'.repeat(CONTENT_SECURITY_POLICY_DEFAULT_QUOTA + 1);
    expect(
      headersOf({ security: { contentSecurityPolicy: overDefault } })?.security
        .contentSecurityPolicy,
    ).toBe(overDefault);
    expect(() => headersOf({ security: { contentSecurityPolicy: '' } })).toThrow(/non-empty/);
    expect(() => headersOf({ security: { contentSecurityPolicy: 42 } })).toThrow(
      /contentSecurityPolicy must be a string/,
    );
    expect(() =>
      headersOf({ security: { contentSecurityPolicy: "default-src 'self'\r\nX-Evil: 1" } }),
    ).toThrow(/must not contain control characters/);
  });

  describe('custom headers', () => {
    it('leaves the adjustable header-count quota to CloudFront', () => {
      // An account may have raised the default of 10, so load does not refuse more.
      const overDefault = CUSTOM_RESPONSE_HEADERS_DEFAULT_QUOTA + 1;
      expect(headersOf({ custom: customHeaders(overDefault) })?.custom).toHaveLength(overDefault);
    });

    it('bounds a value at the fixed 1,783-character limit, and accepts an empty one', () => {
      const atLimit = 'v'.repeat(RESPONSE_HEADER_VALUE_MAX_LENGTH);
      expect(headersOf({ custom: [{ name: 'X-A', value: atLimit }] })?.custom[0]?.value).toBe(
        atLimit,
      );
      expect(() => headersOf({ custom: [{ name: 'X-A', value: `${atLimit}v` }] })).toThrow(
        /value is 1784 characters, over CloudFront's 1783-character/,
      );
      // CloudFront sends a custom header with no value; so does Blogwright.
      expect(headersOf({ custom: [{ name: 'X-Empty', value: '' }] })?.custom).toEqual([
        { name: 'X-Empty', value: '' },
      ]);
    });

    it('bounds the name at 256 characters', () => {
      const name = `X-${'n'.repeat(RESPONSE_HEADER_NAME_MAX_LENGTH - 2)}`;
      expect(headersOf({ custom: [{ name, value: 'v' }] })?.custom[0]?.name).toBe(name);
      expect(() => headersOf({ custom: [{ name: `${name}n`, value: 'v' }] })).toThrow(
        /name is longer than CloudFront's 256-character/,
      );
    });

    it('bounds the combined length of every name and value', () => {
      // Ten 10-character names ("X-Custom-0"..."X-Custom-9"), values filled to the limit exactly.
      const nameLength = 'X-Custom-0'.length;
      const valueLength = CUSTOM_RESPONSE_HEADERS_MAX_TOTAL_LENGTH / 10 - nameLength;
      expect(headersOf({ custom: customHeaders(10, 'v'.repeat(valueLength)) })).toBeDefined();
      const over = customHeaders(10, 'v'.repeat(valueLength));
      over[0] = { name: 'X-Custom-0', value: 'v'.repeat(valueLength + 1) };
      expect(() => headersOf({ custom: over })).toThrow(/total 10241 characters, over/);
    });

    it('rejects a malformed name, a duplicate, a missing value and a header-splitting value', () => {
      expect(() => headersOf({ custom: [{ name: 'Bad Name', value: 'v' }] })).toThrow(
        /custom\[0\]\.name must be an HTTP header name/,
      );
      expect(() =>
        headersOf({
          custom: [
            { name: 'Permissions-Policy', value: 'a' },
            { name: 'permissions-policy', value: 'b' },
          ],
        }),
      ).toThrow(/lists "permissions-policy" more than once/);
      expect(() => headersOf({ custom: [{ name: 'X-A' }] })).toThrow(
        /custom\[0\]\.value must be a string/,
      );
      expect(() => headersOf({ custom: [{ name: 'X-A', value: 'a\nSet-Cookie: x' }] })).toThrow(
        /control characters/,
      );
      expect(() => headersOf({ custom: { name: 'X-A', value: 'b' } })).toThrow(
        /headers\.custom must be an array/,
      );
    });

    it('points a security header at its security field', () => {
      expect(() =>
        headersOf({ custom: [{ name: 'Content-Security-Policy', value: "default-src 'self'" }] }),
      ).toThrow(
        /cannot set "Content-Security-Policy": .* set headers\.security\.contentSecurityPolicy/,
      );
      expect(() => headersOf({ custom: [{ name: 'x-frame-options', value: 'DENY' }] })).toThrow(
        /headers\.security\.frameOptions/,
      );
    });
  });
});
