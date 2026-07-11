import { describe, expect, it } from 'vitest';

import {
  callbackUrl,
  clientMetadata,
  clientMetadataUrl,
  jwksDocument,
  jwksUrl,
} from './client-metadata.js';

const PDS = { name: 'Ant Stanley', description: 'd', secretName: 's' };

describe('clientMetadata', () => {
  it('derives every URL from the domain', () => {
    expect(clientMetadataUrl('example.com')).toBe('https://example.com/oauth/client-metadata.json');
    expect(jwksUrl('example.com')).toBe('https://example.com/oauth/jwks.json');
    expect(callbackUrl('example.com')).toBe('https://example.com/oauth/callback');
  });

  it('builds a confidential web-client document (client_id = metadata URL)', () => {
    const meta = clientMetadata('example.com', PDS);
    expect(meta).toEqual({
      client_id: 'https://example.com/oauth/client-metadata.json',
      client_name: 'Ant Stanley',
      client_uri: 'https://example.com',
      application_type: 'web',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      redirect_uris: ['https://example.com/oauth/callback'],
      scope: 'atproto transition:generic',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      jwks_uri: 'https://example.com/oauth/jwks.json',
    });
  });
});

describe('jwksDocument', () => {
  it('wraps a public JWK', () => {
    const jwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'k1' };
    expect(jwksDocument(jwk)).toEqual({ keys: [jwk] });
  });

  it('refuses private key material', () => {
    expect(() => jwksDocument({ kty: 'EC', d: 'secret' })).toThrow(/private JWK/);
  });
});
