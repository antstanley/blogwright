import {
  AwsError,
  SigningClient,
  staticCredentials,
  type RawResponse,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { FirehoseClient, type IcebergDestinationInput } from './firehose.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

const STREAM = 'preview-example-analytics';
const STREAM_ARN = `arn:aws:firehose:us-east-1:123456789012:deliverystream/${STREAM}`;
const ENDPOINT = 'https://firehose.us-east-1.amazonaws.com/';

/**
 * A destination in the shape the analytics stream node will build: the Glue catalog the
 * S3 Tables bucket is federated into, the one delivery role, the `web.page_views` table,
 * the plugin's own error bucket, and the transform Lambda every record passes through.
 */
const DESTINATION: IcebergDestinationInput = {
  catalogArn: 'arn:aws:glue:us-east-1:123456789012:catalog',
  roleArn: 'arn:aws:iam::123456789012:role/preview-example-analytics-firehose',
  namespace: 'web',
  tableName: 'page_views',
  errorBucketArn: 'arn:aws:s3:::preview-example-analytics-errors',
  errorOutputPrefix: 'firehose-errors/',
  bufferIntervalSeconds: 60,
  bufferSizeMb: 5,
  transformLambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:preview-example-analytics',
};

/** The `IcebergDestinationConfiguration` `DESTINATION` must produce, spelled out independently of the builder. */
const EXPECTED_DESTINATION = {
  RoleARN: 'arn:aws:iam::123456789012:role/preview-example-analytics-firehose',
  CatalogConfiguration: { CatalogARN: 'arn:aws:glue:us-east-1:123456789012:catalog' },
  S3Configuration: {
    BucketARN: 'arn:aws:s3:::preview-example-analytics-errors',
    RoleARN: 'arn:aws:iam::123456789012:role/preview-example-analytics-firehose',
    ErrorOutputPrefix: 'firehose-errors/',
  },
  AppendOnly: true,
  BufferingHints: { IntervalInSeconds: 60, SizeInMBs: 5 },
  DestinationTableConfigurationList: [
    {
      DestinationDatabaseName: 'web',
      DestinationTableName: 'page_views',
      S3ErrorOutputPrefix: 'firehose-errors/',
    },
  ],
  ProcessingConfiguration: {
    Enabled: true,
    Processors: [
      {
        Type: 'Lambda',
        Parameters: [
          {
            ParameterName: 'LambdaArn',
            ParameterValue:
              'arn:aws:lambda:us-east-1:123456789012:function:preview-example-analytics',
          },
        ],
      },
    ],
  },
};

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function firehoseWith(transport: Transport): FirehoseClient {
  return new FirehoseClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

interface SeenRequest {
  method: string;
  url: string;
  target: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

/**
 * Records the method, URL, `x-amz-target`/`content-type` headers and parsed JSON body of
 * each request the transport receives, and counts them - so a test can assert that a
 * call was skipped rather than merely that it did not throw.
 */
function recordingTransport(
  replyStatus: number,
  replyBody: string,
): { transport: Transport; seen: () => SeenRequest; calls: () => number } {
  const requests: SeenRequest[] = [];
  const transport: Transport = async (req) => {
    requests.push({
      method: req.method,
      url: req.url,
      target: req.headers['x-amz-target'],
      contentType: req.headers['content-type'],
      body: req.body === undefined ? undefined : JSON.parse(String(req.body)),
    });
    return response(replyStatus, replyBody);
  };
  return { transport, seen: () => requests[0]!, calls: () => requests.length };
}

/**
 * The failure shape Firehose actually puts on the wire. It is an AWS-JSON 1.1 service,
 * so the exception name travels in the body's `__type` key and core's `parseError`
 * (`packages/core/src/aws/signer.ts`) reads it into `AwsError.code` - unlike the
 * rest-json `s3tables` sibling, whose exception name is header-only and whose every
 * failure therefore degrades to `Http<status>`. Note the status: every documented
 * Firehose exception, `ResourceNotFoundException` and `ResourceInUseException`
 * included, is **HTTP 400**, never 404 or 409, so the code is the only signal that
 * separates them.
 */
function errorResponse(status: number, code: string, message: string): RawResponse {
  return response(status, JSON.stringify({ __type: code, message }));
}

function describeResponse(
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    DeliveryStreamDescription: {
      DeliveryStreamName: STREAM,
      DeliveryStreamARN: STREAM_ARN,
      DeliveryStreamStatus: status,
      DeliveryStreamType: 'DirectPut',
      VersionId: '1',
      HasMoreDestinations: false,
      ...extra,
    },
  };
}

describe('FirehoseClient request wire format', () => {
  it('pins CreateDeliveryStream to its x-amz-target and full Iceberg destination body', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ DeliveryStreamARN: STREAM_ARN }),
    );
    await firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION);
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'Firehose_20150804.CreateDeliveryStream',
      contentType: 'application/x-amz-json-1.1',
      body: {
        DeliveryStreamName: STREAM,
        DeliveryStreamType: 'DirectPut',
        IcebergDestinationConfiguration: EXPECTED_DESTINATION,
      },
    });
  });

  it('pins DescribeDeliveryStream to its x-amz-target and a name-only body', async () => {
    const { transport, seen } = recordingTransport(200, JSON.stringify(describeResponse('ACTIVE')));
    await firehoseWith(transport).describeDeliveryStream(STREAM);
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'Firehose_20150804.DescribeDeliveryStream',
      contentType: 'application/x-amz-json-1.1',
      body: { DeliveryStreamName: STREAM },
    });
  });

  it('pins UpdateDestination to its target, CurrentDeliveryStreamVersionId and IcebergDestinationUpdate', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await firehoseWith(transport).updateDestination(STREAM, DESTINATION, {
      versionId: '7',
      destinationId: 'destinationId-000000000001',
    });
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'Firehose_20150804.UpdateDestination',
      contentType: 'application/x-amz-json-1.1',
      body: {
        DeliveryStreamName: STREAM,
        // The key `DescribeDeliveryStream` answers with is `VersionId`; the key this
        // request wants is `CurrentDeliveryStreamVersionId`. Same value, different name -
        // sending the response's spelling would drop the required member and the service
        // would reject the call for a version it was in fact given.
        CurrentDeliveryStreamVersionId: '7',
        DestinationId: 'destinationId-000000000001',
        IcebergDestinationUpdate: EXPECTED_DESTINATION,
      },
    });
    // Stated separately because the equality above would still pass if both the builder
    // and this fixture used the wrong member name: `IcebergDestinationUpdate` keeps the
    // create's `S3Configuration` key, where every other `*DestinationUpdate` in the same
    // request renames it to `S3Update`. A stream whose error bucket arrived under
    // `S3Update` would have no error destination at all.
    const update = (seen().body as { IcebergDestinationUpdate: object }).IcebergDestinationUpdate;
    expect(Object.keys(update)).toContain('S3Configuration');
    expect(Object.keys(update)).not.toContain('S3Update');
  });

  it('pins DeleteDeliveryStream to its x-amz-target and a name-only body, without AllowForceDelete', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await firehoseWith(transport).deleteDeliveryStream(STREAM);
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'Firehose_20150804.DeleteDeliveryStream',
      contentType: 'application/x-amz-json-1.1',
      body: { DeliveryStreamName: STREAM },
    });
    expect(Object.keys(seen().body as object)).not.toContain('AllowForceDelete');
  });

  it('pins TagDeliveryStream to its x-amz-target and a Key/Value tag list', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await firehoseWith(transport).tagDeliveryStream(STREAM, {
      'blogwright:site': 'example',
      'blogwright:env': 'preview',
    });
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'Firehose_20150804.TagDeliveryStream',
      contentType: 'application/x-amz-json-1.1',
      body: {
        DeliveryStreamName: STREAM,
        Tags: [
          { Key: 'blogwright:site', Value: 'example' },
          { Key: 'blogwright:env', Value: 'preview' },
        ],
      },
    });
  });
});

describe('FirehoseClient destination translation', () => {
  it('reflects a changed destination field straight through to the request body', async () => {
    const baseline = recordingTransport(200, JSON.stringify({ DeliveryStreamARN: STREAM_ARN }));
    await firehoseWith(baseline.transport).createDeliveryStream(STREAM, DESTINATION);

    const altered = recordingTransport(200, JSON.stringify({ DeliveryStreamARN: STREAM_ARN }));
    await firehoseWith(altered.transport).createDeliveryStream(STREAM, {
      ...DESTINATION,
      tableName: 'page_views_v2',
      bufferSizeMb: 1,
    });

    expect(baseline.seen().body).not.toStrictEqual(altered.seen().body);
    const config = (
      altered.seen().body as { IcebergDestinationConfiguration: typeof EXPECTED_DESTINATION }
    ).IcebergDestinationConfiguration;
    expect(config.DestinationTableConfigurationList[0]?.DestinationTableName).toBe('page_views_v2');
    expect(config.BufferingHints).toStrictEqual({ IntervalInSeconds: 60, SizeInMBs: 1 });
  });
});

describe('FirehoseClient createDeliveryStream tagging', () => {
  it('omits Tags entirely when no tag map is given', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ DeliveryStreamARN: STREAM_ARN }),
    );
    await firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION);
    expect(Object.keys(seen().body as object)).not.toContain('Tags');
  });

  it('omits Tags when the tag map is present but empty, rather than sending a rejected empty list', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ DeliveryStreamARN: STREAM_ARN }),
    );
    await firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION, {});
    expect(Object.keys(seen().body as object)).not.toContain('Tags');
  });

  it('carries a non-empty tag map into the create request as a Key/Value list', async () => {
    const { transport, seen } = recordingTransport(
      200,
      JSON.stringify({ DeliveryStreamARN: STREAM_ARN }),
    );
    await firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION, {
      'blogwright:site': 'example',
    });
    expect((seen().body as { Tags: unknown }).Tags).toStrictEqual([
      { Key: 'blogwright:site', Value: 'example' },
    ]);
  });
});

describe('FirehoseClient.describeDeliveryStream', () => {
  it.each([
    ['CREATING', 'creating'],
    ['CREATING_FAILED', 'create-failed'],
    ['ACTIVE', 'active'],
    ['DELETING', 'deleting'],
    ['DELETING_FAILED', 'delete-failed'],
  ])('maps the service state %s onto the domain state %s', async (wire, domain) => {
    const transport: Transport = async () => response(200, JSON.stringify(describeResponse(wire)));
    const status = await firehoseWith(transport).describeDeliveryStream(STREAM);
    // `versionId` joins the mapped view because `UpdateDestination` cannot be called
    // without it. `describeResponse` has carried `VersionId: '1'` since this suite was
    // written, so this is the field surfacing, not a fixture value being changed to fit.
    expect(status).toStrictEqual({ name: STREAM, arn: STREAM_ARN, state: domain, versionId: '1' });
  });

  it('reports a state the service adds later as unknown rather than guessing', async () => {
    const transport: Transport = async () =>
      response(200, JSON.stringify(describeResponse('SOMETHING_NEW')));
    expect((await firehoseWith(transport).describeDeliveryStream(STREAM))?.state).toBe('unknown');
  });

  it('flattens FailureDescription into one printable line when the service reports one', async () => {
    const transport: Transport = async () =>
      response(
        200,
        JSON.stringify(
          describeResponse('CREATING_FAILED', {
            FailureDescription: {
              Type: 'CREATE_KMS_GRANT_FAILED',
              Details: 'the grant could not be created',
            },
          }),
        ),
      );
    expect(await firehoseWith(transport).describeDeliveryStream(STREAM)).toStrictEqual({
      name: STREAM,
      arn: STREAM_ARN,
      state: 'create-failed',
      failure: 'CREATE_KMS_GRANT_FAILED: the grant could not be created',
      versionId: '1',
    });
  });

  it('leaves the failure key absent on a healthy stream rather than setting it to undefined', async () => {
    const transport: Transport = async () =>
      response(200, JSON.stringify(describeResponse('ACTIVE')));
    const status = await firehoseWith(transport).describeDeliveryStream(STREAM);
    expect(status).toBeDefined();
    expect(Object.keys(status!)).not.toContain('failure');
  });

  it('surfaces the version, destination id and live AppendOnly flag UpdateDestination needs', async () => {
    const transport: Transport = async () =>
      response(
        200,
        JSON.stringify(
          describeResponse('ACTIVE', {
            VersionId: '4',
            Destinations: [
              {
                DestinationId: 'destinationId-000000000001',
                IcebergDestinationDescription: { AppendOnly: false },
              },
            ],
          }),
        ),
      );
    // `appendOnly: false` is the interesting value: a stream whose flag is not what this
    // pipeline wants is exactly the case the node's reconcile exists for, and reading it
    // back off the live stream is the only way to know. A client that dropped it would
    // leave the node comparing its own constant against itself.
    expect(await firehoseWith(transport).describeDeliveryStream(STREAM)).toStrictEqual({
      name: STREAM,
      arn: STREAM_ARN,
      state: 'active',
      versionId: '4',
      destinationId: 'destinationId-000000000001',
      appendOnly: false,
    });
  });

  it('leaves the destination keys absent when the response carries no destinations', async () => {
    const transport: Transport = async () =>
      response(200, JSON.stringify(describeResponse('CREATING', { Destinations: [] })));
    const status = await firehoseWith(transport).describeDeliveryStream(STREAM);
    // Absent, not `''`/`false`: an empty CurrentDeliveryStreamVersionId fails the
    // service's own `[0-9]+` pattern, and a fabricated `appendOnly: false` would make the
    // stream node replace a stream that needed nothing done to it.
    expect(Object.keys(status!)).not.toContain('destinationId');
    expect(Object.keys(status!)).not.toContain('appendOnly');
  });

  it('returns undefined on ResourceNotFoundException rather than throwing', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ResourceNotFoundException', 'Firehose stream not found');
    expect(await firehoseWith(transport).describeDeliveryStream(STREAM)).toBeUndefined();
  });

  it('rethrows a non-not-found failure with the operation and stream name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidArgumentException', 'bad name');
    await expect(firehoseWith(transport).describeDeliveryStream(STREAM)).rejects.toThrow(
      new RegExp(`describeDeliveryStream "${STREAM}": bad name`),
    );
  });
});

describe('FirehoseClient.createDeliveryStream idempotency', () => {
  // The routed finding this task exists to close. Firehose reports a duplicate stream as
  // ResourceInUseException, which core's AwsError.isAlreadyExists
  // (/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i) matches on
  // none of its alternatives - so a create narrowing on that predicate alone would
  // reject here instead of resolving.
  it('resolves on ResourceInUseException so a re-run of create is a no-op', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ResourceInUseException', 'Firehose stream already exists');
    await expect(
      firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION),
    ).resolves.toBeUndefined();
  });

  it('rethrows InvalidArgumentException rather than treating every failure as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidArgumentException', 'RoleARN is not valid');
    await expect(firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION)).rejects.toThrow(
      AwsError,
    );
  });

  it('rethrows a 500 rather than treating it as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'InternalFailure', 'try again later');
    await expect(firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION)).rejects.toThrow(
      AwsError,
    );
  });
});

describe('FirehoseClient.deleteDeliveryStream idempotency', () => {
  it('swallows ResourceNotFoundException so teardown is re-runnable', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ResourceNotFoundException', 'Firehose stream not found');
    await expect(firehoseWith(transport).deleteDeliveryStream(STREAM)).resolves.toBeUndefined();
  });

  it('rejects a ValidationException rather than swallowing it', async () => {
    const transport: Transport = async () => errorResponse(400, 'ValidationException', 'bad input');
    await expect(firehoseWith(transport).deleteDeliveryStream(STREAM)).rejects.toThrow(
      /ValidationException|bad input/,
    );
  });

  // The create/delete asymmetry: the same exception name means "already exists" on
  // create and "still CREATING, cannot be deleted yet" on delete. Swallowing it here
  // would report a live stream as torn down.
  it("rejects ResourceInUseException rather than reusing create's already-exists narrowing", async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ResourceInUseException', 'Firehose stream is CREATING');
    await expect(firehoseWith(transport).deleteDeliveryStream(STREAM)).rejects.toThrow(
      /ResourceInUseException|is CREATING/,
    );
  });
});

describe('FirehoseClient.updateDestination', () => {
  const CURRENT = { versionId: '1', destinationId: 'destinationId-000000000001' };

  // The third face of the overloaded exception name. On `CreateDeliveryStream`
  // `ResourceInUseException` means "already exists" and is swallowed; on
  // `DeleteDeliveryStream` it means "still CREATING"; here the reference defines it as
  // "the resource is already in use and not available for this operation" - the stream is
  // busy. Reusing the create-path predicate would report a refused update as applied.
  it("rejects ResourceInUseException rather than reusing create's already-exists narrowing", async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ResourceInUseException', 'Firehose stream is busy');
    await expect(
      firehoseWith(transport).updateDestination(STREAM, DESTINATION, CURRENT),
    ).rejects.toThrow(new RegExp(`updateDestination "${STREAM}": Firehose stream is busy`));
  });

  // The rejection the whole defensive reconcile turns on: whichever way AWS's two
  // contradicting pages resolve, an InvalidArgumentException here has to reach the node
  // so it can fall back to replacing the stream. Nothing is narrowed away in this client.
  it('rethrows InvalidArgumentException, leaving the fallback decision to the caller', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidArgumentException', 'AppendOnly cannot be updated');
    await expect(
      firehoseWith(transport).updateDestination(STREAM, DESTINATION, CURRENT),
    ).rejects.toMatchObject({ code: 'InvalidArgumentException' });
  });

  it('rethrows ConcurrentModificationException with the operation and stream name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ConcurrentModificationException', 'fetch VersionId again');
    await expect(
      firehoseWith(transport).updateDestination(STREAM, DESTINATION, CURRENT),
    ).rejects.toThrow(new RegExp(`updateDestination "${STREAM}": fetch VersionId again`));
  });
});

describe('FirehoseClient.tagDeliveryStream', () => {
  it('makes no request at all when the tag map is empty', async () => {
    const { transport, calls } = recordingTransport(200, '');
    await expect(firehoseWith(transport).tagDeliveryStream(STREAM, {})).resolves.toBeUndefined();
    expect(calls()).toBe(0);
  });

  it('rethrows a failure with the operation and stream name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ResourceNotFoundException', 'Firehose stream not found');
    await expect(
      firehoseWith(transport).tagDeliveryStream(STREAM, { 'blogwright:site': 'example' }),
    ).rejects.toThrow(new RegExp(`tagDeliveryStream "${STREAM}": Firehose stream not found`));
  });
});

describe('FirehoseClient error context', () => {
  it('carries the firehose service label, the real error code, the operation and the stream name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidArgumentException', 'RoleARN is not valid');
    await expect(
      firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION),
    ).rejects.toMatchObject({
      name: 'AwsError',
      service: 'firehose',
      code: 'InvalidArgumentException',
      statusCode: 400,
    });
  });

  it('does not repeat the AwsError framing when adding context', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidArgumentException', 'RoleARN is not valid');
    await expect(
      firehoseWith(transport).createDeliveryStream(STREAM, DESTINATION),
    ).rejects.toMatchObject({
      message: `firehose: InvalidArgumentException - createDeliveryStream "${STREAM}": RoleARN is not valid (HTTP 400)`,
    });
  });
});
