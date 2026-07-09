import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { SecretsManagerClient } from './secretsmanager.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function secretsWith(transport: Transport): SecretsManagerClient {
  return new SecretsManagerClient(
    new SigningClient({ region: 'us-east-1', credentials, transport }),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('SecretsManagerClient.upsertSecret', () => {
  it('sends the ClientRequestToken the raw API requires on CreateSecret', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = secretsWith(async (req) => {
      bodies.push(JSON.parse(String(req.body)) as Record<string, unknown>);
      return response(200, '{}');
    });
    await client.upsertSecret('s', 'v', 'desc');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.Name).toBe('s');
    expect(bodies[0]!.ClientRequestToken).toMatch(UUID);
  });

  it('falls back to PutSecretValue (with its own token) when the secret exists', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = secretsWith(async (req) => {
      const body = JSON.parse(String(req.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.Name) {
        return response(400, JSON.stringify({ __type: 'ResourceExistsException', message: 'x' }));
      }
      return response(200, '{}');
    });
    await client.upsertSecret('s', 'v');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.SecretId).toBe('s');
    expect(bodies[1]!.ClientRequestToken).toMatch(UUID);
    expect(bodies[1]!.ClientRequestToken).not.toBe(bodies[0]!.ClientRequestToken);
  });
});
