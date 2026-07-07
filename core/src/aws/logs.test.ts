import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { LogsClient } from './logs.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function logsWith(transport: Transport): LogsClient {
  return new LogsClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

describe('LogsClient.findDeliveryIdBySource', () => {
  it('paginates DescribeDeliveries and returns the id whose source matches', async () => {
    const transport: Transport = async (req) => {
      const body = JSON.parse(String(req.body ?? '{}')) as { nextToken?: string };
      if (!body.nextToken) {
        return response(
          200,
          JSON.stringify({
            deliveries: [{ id: 'other', deliverySourceName: 'someone-else-cf-source' }],
            nextToken: 'p2',
          }),
        );
      }
      return response(
        200,
        JSON.stringify({ deliveries: [{ id: 'want', deliverySourceName: 'preview-iamstan-cf-source' }] }),
      );
    };
    expect(await logsWith(transport).findDeliveryIdBySource('preview-iamstan-cf-source')).toBe('want');
  });

  it('returns undefined when nothing matches', async () => {
    const transport: Transport = async () => response(200, JSON.stringify({ deliveries: [] }));
    expect(await logsWith(transport).findDeliveryIdBySource('nope')).toBeUndefined();
  });
});

describe('LogsClient delete* idempotency', () => {
  it('swallows ResourceNotFoundException so teardown is re-runnable', async () => {
    const transport: Transport = async () =>
      response(400, JSON.stringify({ __type: 'ResourceNotFoundException', message: 'gone' }));
    const logs = logsWith(transport);
    await expect(logs.deleteDelivery('id')).resolves.toBeUndefined();
    await expect(logs.deleteDeliverySource('s')).resolves.toBeUndefined();
    await expect(logs.deleteDeliveryDestination('d')).resolves.toBeUndefined();
  });

  it('rethrows non-not-found errors', async () => {
    const transport: Transport = async () =>
      response(400, JSON.stringify({ __type: 'ValidationException', message: 'bad input' }));
    await expect(logsWith(transport).deleteDeliverySource('s')).rejects.toThrow(/ValidationException|bad input/);
  });
});
