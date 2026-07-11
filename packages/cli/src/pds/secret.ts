/**
 * The Secrets Manager secret backing standard.site publishing: one JSON value
 * holding the OAuth confidential-client private key, the account DID, and the
 * current OAuth session (rotated on every token refresh).
 *
 * Writers: `pds keygen` (clientKey, clears session), `pds login` (session+did),
 * and the session store below whenever the OAuth client refreshes tokens.
 */

import type { Jwk, NodeSavedSession, NodeSavedSessionStore } from '@atproto/oauth-client-node';
import type { SecretsManagerClient } from 'blogwright-core';

import type { OpsContext } from '../context.js';
import { requirePdsConfig } from './sync.js';

/** The client surface secret persistence needs — structural, so tests can stub it. */
export type SecretsStore = Pick<SecretsManagerClient, 'getSecretValue' | 'upsertSecret'>;

export interface PdsSecret {
  version: 1;
  /** Private ES256 JWK authenticating the OAuth client (private_key_jwt). */
  clientKey?: Jwk | undefined;
  /** Account DID; set by `pds login`, checked against src/data/atproto.json. */
  did?: string | undefined;
  /** Current OAuth session (token set + DPoP key); rotates on refresh. */
  session?: NodeSavedSession | undefined;
}

const SECRET_DESCRIPTION =
  'AT Protocol OAuth client key + session for standard.site publishing (blogwright pds)';

function parseJsonObject(raw: string, secretName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`secret "${secretName}" is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`secret "${secretName}" is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** The pre-OAuth `{ identifier, password }` shape, replaced only by keygen. */
function isLegacySecret(parsed: Record<string, unknown>): boolean {
  return 'identifier' in parsed || 'password' in parsed;
}

/** Parse the secret JSON, rejecting the pre-OAuth app-password shape. */
export function parsePdsSecret(raw: string, secretName: string): PdsSecret {
  const parsed = parseJsonObject(raw, secretName);
  if (isLegacySecret(parsed)) {
    throw new Error(
      `secret "${secretName}" holds app-password credentials — app passwords are no longer ` +
        'supported; run `blogwright pds keygen` then `blogwright pds login`',
    );
  }
  if (parsed.version !== 1) {
    throw new Error(`secret "${secretName}" has unsupported version ${String(parsed.version)}`);
  }
  return parsed as unknown as PdsSecret;
}

/**
 * Fetch and parse the secret. Called only at keygen/login/sync time —
 * secret material must never be loaded during context creation.
 */
export async function loadPdsSecret(ctx: OpsContext): Promise<PdsSecret> {
  const pds = requirePdsConfig(ctx);
  const raw = await ctx.clients.secrets.getSecretValue(pds.secretName);
  if (!raw) {
    throw new Error(`no secret at "${pds.secretName}" — create it with \`blogwright pds keygen\``);
  }
  return parsePdsSecret(raw, pds.secretName);
}

/**
 * Read-modify-write the secret; starts from an empty v1 value when absent.
 * `replaceLegacy` lets keygen start over from a pre-OAuth app-password value —
 * the migration entry point; every other writer must reject it.
 */
export async function updatePdsSecret(
  secrets: SecretsStore,
  secretName: string,
  mutate: (secret: PdsSecret) => PdsSecret,
  opts: { replaceLegacy?: boolean } = {},
): Promise<PdsSecret> {
  const raw = await secrets.getSecretValue(secretName);
  const current: PdsSecret =
    !raw || (opts.replaceLegacy && isLegacySecret(parseJsonObject(raw, secretName)))
      ? { version: 1 }
      : parsePdsSecret(raw, secretName);
  const next = mutate(current);
  await secrets.upsertSecret(secretName, JSON.stringify(next), SECRET_DESCRIPTION);
  return next;
}

/**
 * NodeOAuthClient session store backed by the secret. `set` runs on login and
 * on every refresh-token rotation — persisting it is what keeps the CI session
 * alive; `del` clears only the session (client key and DID survive a logout).
 */
export function sessionStoreForSecret(
  secrets: SecretsStore,
  secretName: string,
): NodeSavedSessionStore {
  return {
    async get(sub: string): Promise<NodeSavedSession | undefined> {
      const raw = await secrets.getSecretValue(secretName);
      if (!raw) return undefined;
      const secret = parsePdsSecret(raw, secretName);
      if (secret.did !== sub) return undefined;
      return secret.session;
    },
    async set(sub: string, session: NodeSavedSession): Promise<void> {
      await updatePdsSecret(secrets, secretName, (secret) => ({
        ...secret,
        did: sub,
        session,
      }));
    },
    async del(sub: string): Promise<void> {
      await updatePdsSecret(secrets, secretName, (secret) =>
        secret.did === sub ? { ...secret, session: undefined } : secret,
      );
    },
  };
}
