import { describe, expect, it } from 'vitest';

import type { NodeSavedSession } from '@atproto/oauth-client-node';

import type { OpsContext } from '../context.js';
import { createTestContext } from '../test-support.js';
import {
  loadPdsSecret,
  parsePdsSecret,
  sessionStoreForSecret,
  updatePdsSecret,
  type SecretsStore,
} from './secret.js';

const DID = 'did:plc:test';
const SESSION = { tokenSet: { sub: DID }, dpopJwk: { kty: 'EC' } } as unknown as NodeSavedSession;

/** In-memory Secrets Manager holding a single named secret. */
class StubSecrets implements SecretsStore {
  constructor(public value: string | undefined = undefined) {}
  async getSecretValue(_name: string): Promise<string | undefined> {
    return this.value;
  }
  async upsertSecret(_name: string, value: string): Promise<void> {
    this.value = value;
  }
}

describe('parsePdsSecret', () => {
  it('round-trips a v1 secret', () => {
    const secret = { version: 1, clientKey: { kty: 'EC' }, did: DID, session: SESSION };
    expect(parsePdsSecret(JSON.stringify(secret), 's')).toEqual(secret);
  });

  it('rejects malformed and non-object JSON', () => {
    expect(() => parsePdsSecret('not json', 's')).toThrow(/valid JSON/);
    expect(() => parsePdsSecret('null', 's')).toThrow(/JSON object/);
    expect(() => parsePdsSecret('[1]', 's')).toThrow(/JSON object/);
  });

  it('rejects the legacy app-password shape with a migration hint', () => {
    expect(() => parsePdsSecret('{"identifier":"x","password":"p"}', 's')).toThrow(
      /app passwords are no longer supported.*pds keygen/,
    );
  });

  it('rejects unknown versions', () => {
    expect(() => parsePdsSecret('{"version":2}', 's')).toThrow(/unsupported version 2/);
  });
});

describe('loadPdsSecret', () => {
  function ctxWithSecret(value: string | undefined): OpsContext {
    return createTestContext({
      config: { pds: { name: 'x', secretName: 's' } },
      clients: { secrets: { getSecretValue: async () => value } },
    });
  }

  it('parses the stored secret', async () => {
    const secret = await loadPdsSecret(ctxWithSecret(`{"version":1,"did":"${DID}"}`));
    expect(secret.did).toBe(DID);
  });

  it('points at `pds keygen` when the secret is missing', async () => {
    await expect(loadPdsSecret(ctxWithSecret(undefined))).rejects.toThrow(/pds keygen/);
  });
});

describe('updatePdsSecret', () => {
  it('starts from an empty v1 value when the secret is absent', async () => {
    const secrets = new StubSecrets();
    await updatePdsSecret(secrets, 's', (s) => ({ ...s, did: DID }));
    expect(JSON.parse(secrets.value!)).toEqual({ version: 1, did: DID });
  });

  it('preserves fields the mutation does not touch', async () => {
    const secrets = new StubSecrets(JSON.stringify({ version: 1, clientKey: { kty: 'EC' } }));
    await updatePdsSecret(secrets, 's', (s) => ({ ...s, did: DID }));
    expect(JSON.parse(secrets.value!)).toEqual({ version: 1, clientKey: { kty: 'EC' }, did: DID });
  });

  it('replaces a legacy app-password value only when asked (the keygen path)', async () => {
    const legacy = JSON.stringify({ identifier: 'x', password: 'p' });
    await expect(updatePdsSecret(new StubSecrets(legacy), 's', (s) => s)).rejects.toThrow(
      /app passwords/,
    );

    const secrets = new StubSecrets(legacy);
    await updatePdsSecret(secrets, 's', (s) => ({ ...s, did: DID }), { replaceLegacy: true });
    expect(JSON.parse(secrets.value!)).toEqual({ version: 1, did: DID });
  });
});

describe('sessionStoreForSecret', () => {
  it('set persists session + did; get returns it for the same sub only', async () => {
    const secrets = new StubSecrets(JSON.stringify({ version: 1, clientKey: { kty: 'EC' } }));
    const store = sessionStoreForSecret(secrets, 's');
    await store.set(DID, SESSION);
    expect(await store.get(DID)).toEqual(SESSION);
    expect(await store.get('did:plc:other')).toBeUndefined();
    // keygen material survives session writes
    expect(JSON.parse(secrets.value!).clientKey).toEqual({ kty: 'EC' });
  });

  it('del clears only the session', async () => {
    const secrets = new StubSecrets(
      JSON.stringify({ version: 1, clientKey: { kty: 'EC' }, did: DID, session: SESSION }),
    );
    const store = sessionStoreForSecret(secrets, 's');
    await store.del(DID);
    const stored = JSON.parse(secrets.value!);
    expect(stored.session).toBeUndefined();
    expect(stored.did).toBe(DID);
    expect(stored.clientKey).toEqual({ kty: 'EC' });
  });

  it('get returns undefined when no secret exists', async () => {
    const store = sessionStoreForSecret(new StubSecrets(), 's');
    expect(await store.get(DID)).toBeUndefined();
  });
});
