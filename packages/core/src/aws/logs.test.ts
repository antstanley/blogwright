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

/** A transport that records the parsed request body it was sent and replies with `replyBody`. */
function capturingTransport(replyBody: string): { transport: Transport; body: () => unknown } {
  let captured: unknown;
  const transport: Transport = async (req) => {
    captured = JSON.parse(String(req.body ?? '{}'));
    return response(200, replyBody);
  };
  return { transport, body: () => captured };
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
        JSON.stringify({
          deliveries: [{ id: 'want', deliverySourceName: 'preview-example-cf-source' }],
        }),
      );
    };
    expect(await logsWith(transport).findDeliveryIdBySource('preview-example-cf-source')).toBe(
      'want',
    );
  });

  it('returns undefined when nothing matches', async () => {
    const transport: Transport = async () => response(200, JSON.stringify({ deliveries: [] }));
    expect(await logsWith(transport).findDeliveryIdBySource('nope')).toBeUndefined();
  });
});

describe('LogsClient.deliveriesForSource', () => {
  it('pages DescribeDeliveries and pairs each id with its destination ARN', async () => {
    const transport: Transport = async (req) => {
      const body = JSON.parse(String(req.body ?? '{}')) as { nextToken?: string };
      if (!body.nextToken) {
        return response(
          200,
          JSON.stringify({
            deliveries: [
              {
                id: 'site',
                deliverySourceName: 'preview-example-cf-source',
                deliveryDestinationArn: 'arn:aws:logs:us-east-1:1:delivery-destination:cf-dest',
              },
            ],
            nextToken: 'p2',
          }),
        );
      }
      return response(
        200,
        JSON.stringify({
          deliveries: [
            {
              id: 'analytics',
              deliverySourceName: 'preview-example-cf-source',
              deliveryDestinationArn: 'arn:aws:logs:us-east-1:1:delivery-destination:firehose',
            },
            {
              // Another distribution's delivery: still filtered out by source name.
              id: 'elsewhere',
              deliverySourceName: 'someone-else-cf-source',
              deliveryDestinationArn: 'arn:aws:logs:us-east-1:1:delivery-destination:other',
            },
          ],
        }),
      );
    };
    expect(await logsWith(transport).deliveriesForSource('preview-example-cf-source')).toEqual([
      {
        id: 'site',
        deliveryDestinationArn: 'arn:aws:logs:us-east-1:1:delivery-destination:cf-dest',
      },
      {
        id: 'analytics',
        deliveryDestinationArn: 'arn:aws:logs:us-east-1:1:delivery-destination:firehose',
      },
    ]);
  });

  it('returns an empty list when the source carries nothing', async () => {
    const transport: Transport = async () => response(200, JSON.stringify({ deliveries: [] }));
    expect(await logsWith(transport).deliveriesForSource('nope')).toEqual([]);
  });

  /**
   * `deliveryDestinationArn` is optional in the DescribeDeliveries response, and the
   * empty string it falls back to is a deliberate fail-closed choice, not a filler:
   * it matches no destination name, so `isOwnDelivery` calls such a delivery foreign
   * and the delivery-source guards refuse rather than delete on unknown ownership.
   * Any other placeholder would do the same, but only until one of them collides -
   * this pins the value so a later tidy-up cannot quietly drop it or swap it.
   */
  it('falls back to an empty destination ARN so an unattributable delivery reads as foreign', async () => {
    const transport: Transport = async () =>
      response(
        200,
        JSON.stringify({
          deliveries: [{ id: 'no-dest', deliverySourceName: 'preview-example-cf-source' }],
        }),
      );
    const deliveries = await logsWith(transport).deliveriesForSource('preview-example-cf-source');
    expect(deliveries).toEqual([{ id: 'no-dest', deliveryDestinationArn: '' }]);
    // Explicit: `toEqual` alone would also accept `undefined` slipping through.
    expect(deliveries[0]?.deliveryDestinationArn).toBe('');
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
    await expect(logsWith(transport).deleteDeliverySource('s')).rejects.toThrow(
      /ValidationException|bad input/,
    );
  });
});

describe('LogsClient.putDeliveryDestination request body', () => {
  it("pins the no-options body to exactly what the site's existing CloudWatch delivery sends today", async () => {
    const { transport, body } = capturingTransport(
      JSON.stringify({ deliveryDestination: { arn: 'arn:dest' } }),
    );
    const arn = await logsWith(transport).putDeliveryDestination('dest-name', 'arn:log-group');
    expect(body()).toStrictEqual({
      name: 'dest-name',
      deliveryDestinationConfiguration: { destinationResourceArn: 'arn:log-group' },
    });
    expect(arn).toBe('arn:dest');
  });

  it('adds outputFormat to the body when supplied, and nothing else', async () => {
    const { transport, body } = capturingTransport(
      JSON.stringify({ deliveryDestination: { arn: 'arn:dest' } }),
    );
    await logsWith(transport).putDeliveryDestination('dest-name', 'arn:log-group', {
      outputFormat: 'parquet',
    });
    expect(body()).toStrictEqual({
      name: 'dest-name',
      deliveryDestinationConfiguration: { destinationResourceArn: 'arn:log-group' },
      outputFormat: 'parquet',
    });
  });
});

describe('LogsClient.createDelivery request body', () => {
  it("pins the no-options body to exactly what the site's existing CloudWatch delivery sends today", async () => {
    const { transport, body } = capturingTransport('{}');
    await logsWith(transport).createDelivery('source-name', 'arn:dest');
    expect(body()).toStrictEqual({
      deliverySourceName: 'source-name',
      deliveryDestinationArn: 'arn:dest',
    });
  });

  it('adds recordFields to the body when supplied and leaves fieldDelimiter absent', async () => {
    const { transport, body } = capturingTransport('{}');
    await logsWith(transport).createDelivery('source-name', 'arn:dest', {
      recordFields: ['cs-method', 'cs-uri-stem'],
    });
    expect(body()).toStrictEqual({
      deliverySourceName: 'source-name',
      deliveryDestinationArn: 'arn:dest',
      recordFields: ['cs-method', 'cs-uri-stem'],
    });
  });

  it('adds fieldDelimiter to the body when supplied and leaves recordFields absent', async () => {
    const { transport, body } = capturingTransport('{}');
    await logsWith(transport).createDelivery('source-name', 'arn:dest', { fieldDelimiter: ',' });
    expect(body()).toStrictEqual({
      deliverySourceName: 'source-name',
      deliveryDestinationArn: 'arn:dest',
      fieldDelimiter: ',',
    });
  });

  it('adds both recordFields and fieldDelimiter when both are supplied', async () => {
    const { transport, body } = capturingTransport('{}');
    await logsWith(transport).createDelivery('source-name', 'arn:dest', {
      recordFields: ['cs-method'],
      fieldDelimiter: ',',
    });
    expect(body()).toStrictEqual({
      deliverySourceName: 'source-name',
      deliveryDestinationArn: 'arn:dest',
      recordFields: ['cs-method'],
      fieldDelimiter: ',',
    });
  });

  it('still swallows ResourceAlreadyExistsException with the new options supplied', async () => {
    const transport: Transport = async () =>
      response(
        400,
        JSON.stringify({ __type: 'ResourceAlreadyExistsException', message: 'exists' }),
      );
    await expect(
      logsWith(transport).createDelivery('source-name', 'arn:dest', { fieldDelimiter: ',' }),
    ).resolves.toBeUndefined();
  });
});
