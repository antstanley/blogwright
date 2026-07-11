/**
 * Single source of truth for the atproto OAuth confidential-client documents.
 * The site serves these from /oauth/ (see `blogwright pds keygen`, which writes
 * the committed public/oauth/*.json files); `pds login` verifies the deployed
 * copies match before authorizing, so the CLI and the PDS always agree.
 */

import type { OAuthClientMetadataInput } from '@atproto/oauth-client-node';
import type { OpsConfig, PdsConfig } from 'blogwright-core';

/**
 * Repo-relative paths of the committed OAuth client documents. The segments
 * under the public dir are protocol-fixed — they must mirror the URL paths in
 * the client metadata — so only the public dir itself is configurable.
 */
export function clientDocumentPaths(cfg: Pick<OpsConfig, 'paths'>): {
  clientMetadata: string;
  jwks: string;
} {
  return {
    clientMetadata: `${cfg.paths.publicDir}/oauth/client-metadata.json`,
    jwks: `${cfg.paths.publicDir}/oauth/jwks.json`,
  };
}

/** Per the atproto OAuth spec the client_id IS the metadata document URL. */
export function clientMetadataUrl(domain: string): string {
  return `https://${domain}/oauth/client-metadata.json`;
}

export function jwksUrl(domain: string): string {
  return `https://${domain}/oauth/jwks.json`;
}

/** Static page (src/pages/oauth/callback.astro) that displays the redirect params. */
export function callbackUrl(domain: string): string {
  return `https://${domain}/oauth/callback`;
}

/** The client metadata document served at clientMetadataUrl(domain). */
export function clientMetadata(domain: string, pds: PdsConfig): OAuthClientMetadataInput {
  return {
    client_id: clientMetadataUrl(domain),
    client_name: pds.name,
    client_uri: `https://${domain}`,
    application_type: 'web',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [callbackUrl(domain)],
    scope: 'atproto transition:generic',
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    jwks_uri: jwksUrl(domain),
  };
}

/** The JWKS document served at jwksUrl(domain) — public key material only. */
export function jwksDocument(publicJwk: Record<string, unknown>): { keys: [typeof publicJwk] } {
  if (publicJwk.d !== undefined) throw new Error('jwksDocument received a private JWK (has "d")');
  return { keys: [publicJwk] };
}
