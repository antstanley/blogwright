/**
 * atproto OAuth (confidential client) for standard.site publishing — the only
 * module that touches @atproto/oauth-client-node. The blog itself is the OAuth
 * client: its metadata + JWKS are static files on the site (client-metadata.ts),
 * the private key and session live in the Secrets Manager secret (secret.ts),
 * and every token refresh persists the rotated refresh token back there.
 */

import {
  JoseKey,
  NodeOAuthClient,
  OAuthResponseError,
  TokenRefreshError,
  TokenRevokedError,
  requestLocalLock,
  type Jwk,
  type NodeSavedState,
} from '@atproto/oauth-client-node';
import type { PdsConfig } from 'blogwright-core';

import type { OpsContext } from '../context.js';
import { clientMetadata, clientMetadataUrl, jwksDocument, jwksUrl } from './client-metadata.js';
import { loadPdsSecret, sessionStoreForSecret, type PdsSecret } from './secret.js';
import { requirePdsConfig } from './sync.js';
import { PdsClient } from './xrpc.js';

const DEFAULT_HANDLE_RESOLVER = 'https://public.api.bsky.app';

function requireDomain(ctx: OpsContext): string {
  if (!ctx.domain) throw new Error('pds OAuth requires a configured domain');
  return ctx.domain;
}

function requireClientKey(secret: PdsSecret, pds: PdsConfig): Jwk {
  if (!secret.clientKey) {
    throw new Error(
      `secret "${pds.secretName}" has no OAuth client key — run \`blogwright pds keygen\``,
    );
  }
  return secret.clientKey;
}

/** The OAuth client, keyed with the secret's private JWK. */
async function buildClient(ctx: OpsContext, clientKey: Jwk): Promise<NodeOAuthClient> {
  const pds = requirePdsConfig(ctx);
  const states = new Map<string, NodeSavedState>();
  return new NodeOAuthClient({
    clientMetadata: clientMetadata(requireDomain(ctx), pds),
    keyset: [await JoseKey.fromJWK(clientKey as Record<string, unknown>)],
    responseMode: 'query',
    // The authorize → callback round-trip happens within one `pds login`
    // process, so authorization state never needs to outlive it.
    stateStore: {
      get: async (key) => states.get(key),
      set: async (key, state) => void states.set(key, state),
      del: async (key) => void states.delete(key),
    },
    sessionStore: sessionStoreForSecret(ctx.clients.secrets, pds.secretName),
    handleResolver: pds.handleResolver ?? DEFAULT_HANDLE_RESOLVER,
    requestLock: requestLocalLock,
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return (
      deepEqual(ka, kb) &&
      ka.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/** A fresh ES256 private JWK for private_key_jwt client authentication. */
export async function generateClientKey(kid: string): Promise<Jwk> {
  const key = await JoseKey.generate(['ES256'], kid);
  const privateJwk = key.privateJwk;
  if (!privateJwk) throw new Error('generated key has no private JWK');
  return JSON.parse(JSON.stringify(privateJwk)) as Jwk;
}

/** Public half of the client key, for the served JWKS. */
export async function publicClientJwk(clientKey: Jwk): Promise<Record<string, unknown>> {
  const key = await JoseKey.fromJWK(clientKey as Record<string, unknown>);
  const publicJwk = (key.publicJwk ?? {}) as Record<string, unknown>;
  const source = Object.keys(publicJwk).length > 0 ? publicJwk : clientKey;
  // Round-trip through JSON: drops `d: undefined` left by the getter and
  // matches exactly what the committed jwks.json file will contain.
  const plain = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  delete plain.d;
  return plain;
}

/**
 * Check that the deployed /oauth/ documents match what this CLI would send the
 * authorization server. Run before login/init — a stale or missing deployment
 * would otherwise fail deep inside the OAuth flow.
 */
export async function verifyClientAssets(
  ctx: OpsContext,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const pds = requirePdsConfig(ctx);
  const domain = requireDomain(ctx);
  const secret = await loadPdsSecret(ctx);
  const clientKey = requireClientKey(secret, pds);
  const expectations: [url: string, expected: unknown][] = [
    [clientMetadataUrl(domain), clientMetadata(domain, pds)],
    [jwksUrl(domain), jwksDocument(await publicClientJwk(clientKey))],
  ];
  for (const [url, expected] of expectations) {
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(
        `${url} is not deployed (HTTP ${res.status}) — commit public/oauth/* and release first`,
      );
    }
    let deployed: unknown;
    try {
      deployed = await res.json();
    } catch {
      throw new Error(`${url} is not valid JSON — re-run \`blogwright pds keygen\` and redeploy`);
    }
    if (!deepEqual(deployed, expected)) {
      throw new Error(
        `${url} does not match the local client configuration — ` +
          're-run `blogwright pds keygen`, commit public/oauth/*, and release before logging in',
      );
    }
  }
}

/** The authorize/callback surface of NodeOAuthClient — injectable for tests. */
interface OauthFlow {
  authorize(input: string): Promise<URL>;
  callback(params: URLSearchParams): Promise<{ session: { did: string } }>;
}

export interface LoginDeps {
  /** Ask the operator one question and return their answer. */
  promptLine: (question: string) => Promise<string>;
  flow?: OauthFlow | undefined;
  verifyAssets?: typeof verifyClientAssets | undefined;
}

/**
 * One-time interactive bootstrap: authorize in a browser, land on the site's
 * /oauth/callback page, paste the redirect URL back. The client persists the
 * session (and DID) into the secret through the session store.
 */
export async function login(ctx: OpsContext, identifier: string, deps: LoginDeps): Promise<string> {
  await (deps.verifyAssets ?? verifyClientAssets)(ctx);
  let flow = deps.flow;
  if (!flow) {
    const secret = await loadPdsSecret(ctx);
    flow = await buildClient(ctx, requireClientKey(secret, requirePdsConfig(ctx)));
  }
  const url = await flow.authorize(identifier);
  ctx.logger.info('Open this URL in a browser and approve access:');
  ctx.logger.info(`  ${url.toString()}`);
  const pasted = await deps.promptLine(
    'Paste the full URL of the /oauth/callback page you landed on: ',
  );
  let params: URLSearchParams;
  try {
    params = new URL(pasted.trim()).searchParams;
  } catch {
    throw new Error('that was not a URL — paste the full callback address, query string and all');
  }
  if (params.get('error')) {
    throw new Error(
      `authorization failed: ${params.get('error')} — ${params.get('error_description') ?? ''}`,
    );
  }
  const { session } = await flow.callback(params);
  ctx.logger.ok(`logged in as ${session.did}`);
  return session.did;
}

function sessionExpired(err: unknown): boolean {
  if (err instanceof TokenRefreshError || err instanceof TokenRevokedError) return true;
  return err instanceof OAuthResponseError && err.error === 'invalid_grant';
}

/**
 * Restore the stored OAuth session (transparently refreshing — the rotated
 * refresh token lands back in the secret) and wrap it as a PdsClient. The
 * session's fetchHandler adds DPoP + auth headers and handles nonce retries.
 */
export async function openPdsRepo(ctx: OpsContext): Promise<{ did: string; repo: PdsClient }> {
  const pds = requirePdsConfig(ctx);
  const secret = await loadPdsSecret(ctx);
  const clientKey = requireClientKey(secret, pds);
  if (!secret.did || !secret.session) {
    throw new Error(`secret "${pds.secretName}" has no OAuth session — run \`blogwright pds login\``);
  }
  const client = await buildClient(ctx, clientKey);
  try {
    const session = await client.restore(secret.did);
    return { did: secret.did, repo: new PdsClient(secret.did, session.fetchHandler.bind(session)) };
  } catch (err) {
    if (sessionExpired(err)) {
      throw new Error(
        'the stored OAuth session is no longer valid (refresh tokens expire after 180 idle ' +
          'days, and rotation races invalidate them) — re-run `blogwright pds login`',
        { cause: err },
      );
    }
    throw err;
  }
}
