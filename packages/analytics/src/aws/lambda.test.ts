import {
  AwsError,
  SigningClient,
  staticCredentials,
  type RawResponse,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { LambdaClient, type CreateFunctionInput, type FunctionState } from './lambda.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

const NAME = 'analytics-transform-function';
const ARN = `arn:aws:lambda:us-east-1:123456789012:function:${NAME}`;
const ROLE_ARN = 'arn:aws:iam::123456789012:role/analytics-transform-role';
const HOST = 'https://lambda.us-east-1.amazonaws.com';

/** Two bytes that are not valid UTF-8, so a base64 round trip proves the encoder handles raw binary. */
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]);
const ZIP_BASE64 = 'UEsDBP/+';

const INPUT: CreateFunctionInput = {
  name: NAME,
  roleArn: ROLE_ARN,
  runtime: 'nodejs22.x',
  handler: 'index.handler',
  memoryMb: 256,
  timeoutSeconds: 60,
  environment: { SALT_SECRET_NAME: 'blog/prod/analytics-salt' },
  zipFile: ZIP,
};

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function lambdaWith(transport: Transport): LambdaClient {
  return new LambdaClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

interface SeenRequest {
  method: string;
  url: string;
  contentType: string | undefined;
  body: unknown;
}

/** Records the method, full request URL, `content-type` header and parsed JSON body of every request the transport receives. */
function recordingTransport(
  replyStatus: number,
  replyBody: string,
): { transport: Transport; seen: () => SeenRequest; all: () => SeenRequest[] } {
  const requests: SeenRequest[] = [];
  const transport: Transport = async (req) => {
    requests.push({
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'],
      body: req.body === undefined ? undefined : JSON.parse(String(req.body)),
    });
    return response(replyStatus, replyBody);
  };
  return { transport, seen: () => requests[0]!, all: () => requests };
}

/**
 * The failure shape Lambda actually puts on the wire, probed against the live
 * endpoint rather than transcribed from a documentation page: an unauthenticated
 * `GET https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/<name>` answers
 * `403` with `x-amzn-errortype: MissingAuthenticationTokenException`,
 * `x-amzn-requestid: <uuid>` and a body of exactly
 * `{"message":"Missing Authentication Token"}`.
 *
 * So the exception name is header-only and the body carries `message` plus - on the
 * modelled exceptions - a `Type` of `"User"` or `"Service"`, which is the *category*
 * and never the exception name. Core's `parseError` reads `__type`/`code`/`Code` from
 * the body and nothing from the headers, so `AwsError.code` degrades to
 * `"Http<status>"` for every Lambda failure and `requestId` stays `undefined`. This
 * helper emits that shape deliberately: a fixture that invented a body `code` key
 * would make the client's narrowing look like it matched on the exception name when
 * on the wire it cannot, and every idempotency assertion below would pass for a
 * reason that does not hold against AWS.
 */
function errorResponse(status: number, code: string, message: string): RawResponse {
  return {
    ...response(status, JSON.stringify({ Type: 'User', message })),
    headers: {
      'x-amzn-errortype': code,
      'x-amzn-requestid': '3000c094-0cbf-4394-983b-11be7491450c',
    },
  };
}

/** A `GetFunction` success body in the service's own shape - the configuration nested under `Configuration`. */
function getFunctionResponse(state = 'Active'): Record<string, unknown> {
  return {
    Code: {
      RepositoryType: 'S3',
      Location: 'https://awslambda-us-east-1-tasks.s3.amazonaws.com/…',
    },
    Configuration: {
      FunctionName: NAME,
      FunctionArn: ARN,
      Runtime: 'nodejs22.x',
      Role: ROLE_ARN,
      Handler: 'index.handler',
      CodeSha256: 'l3Vc0lZ8u5Y8lJb1F1Rr1qOgqzT3nS5CkQyIu8L0eXo=',
      State: state,
      LastUpdateStatus: 'Successful',
    },
    Tags: {},
  };
}

describe('LambdaClient request wire format', () => {
  it('pins CreateFunction to POST /2015-03-31/functions with the full function body', async () => {
    const { transport, seen } = recordingTransport(201, JSON.stringify({ FunctionArn: ARN }));
    await lambdaWith(transport).createFunction(INPUT);
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: `${HOST}/2015-03-31/functions`,
      contentType: 'application/json',
      body: {
        FunctionName: NAME,
        PackageType: 'Zip',
        Code: { ZipFile: ZIP_BASE64 },
        Role: ROLE_ARN,
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        MemorySize: 256,
        Timeout: 60,
        Environment: { Variables: { SALT_SECRET_NAME: 'blog/prod/analytics-salt' } },
      },
    });
  });

  // CreateFunction nests the deployment package under `Code`; UpdateFunctionCode takes
  // the same bytes as a top-level `ZipFile`. Sending either shape to the other
  // operation deploys no code at all rather than failing, so both halves are pinned.
  it('nests the zip under Code.ZipFile on create and never at the top level', async () => {
    const { transport, seen } = recordingTransport(201, JSON.stringify({ FunctionArn: ARN }));
    await lambdaWith(transport).createFunction(INPUT);
    const body = seen().body as Record<string, unknown>;
    expect(body.Code).toStrictEqual({ ZipFile: ZIP_BASE64 });
    expect(Object.keys(body)).not.toContain('ZipFile');
  });

  it('pins UpdateFunctionCode to PUT .../code with ZipFile at the top level, not under Code', async () => {
    const { transport, seen } = recordingTransport(200, JSON.stringify({ FunctionArn: ARN }));
    await lambdaWith(transport).updateFunctionCode(NAME, ZIP);
    expect(seen()).toStrictEqual({
      method: 'PUT',
      url: `${HOST}/2015-03-31/functions/${NAME}/code`,
      contentType: 'application/json',
      body: { ZipFile: ZIP_BASE64 },
    });
  });

  it('pins UpdateFunctionConfiguration to PUT .../configuration and keeps the name out of the body', async () => {
    const { transport, seen } = recordingTransport(200, JSON.stringify({ FunctionArn: ARN }));
    await lambdaWith(transport).updateFunctionConfiguration(NAME, INPUT);
    expect(seen()).toStrictEqual({
      method: 'PUT',
      url: `${HOST}/2015-03-31/functions/${NAME}/configuration`,
      contentType: 'application/json',
      body: {
        Role: ROLE_ARN,
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        MemorySize: 256,
        Timeout: 60,
        Environment: { Variables: { SALT_SECRET_NAME: 'blog/prod/analytics-salt' } },
      },
    });
    expect(Object.keys(seen().body as object)).not.toContain('FunctionName');
  });

  it('pins GetFunction to GET /2015-03-31/functions/{name} with no body', async () => {
    const { transport, seen } = recordingTransport(200, JSON.stringify(getFunctionResponse()));
    await lambdaWith(transport).getFunction(NAME);
    expect(seen()).toStrictEqual({
      method: 'GET',
      url: `${HOST}/2015-03-31/functions/${NAME}`,
      contentType: 'application/json',
      body: undefined,
    });
  });

  it('pins DeleteFunction to DELETE /2015-03-31/functions/{name} with no body', async () => {
    const { transport, seen } = recordingTransport(204, '');
    await lambdaWith(transport).deleteFunction(NAME);
    expect(seen()).toStrictEqual({
      method: 'DELETE',
      url: `${HOST}/2015-03-31/functions/${NAME}`,
      contentType: 'application/json',
      body: undefined,
    });
  });

  // The name is percent-encoded into its path segment, so a name carrying a separator
  // cannot address a different operation than the one that was called.
  it('percent-encodes the function name into every path it appears in', async () => {
    const { transport, all } = recordingTransport(200, JSON.stringify(getFunctionResponse()));
    const client = lambdaWith(transport);
    await client.getFunction('a/b');
    await client.updateFunctionCode('a/b', ZIP);
    await client.updateFunctionConfiguration('a/b', INPUT);
    await client.deleteFunction('a/b');
    expect(all().map((r) => new URL(r.url).pathname)).toStrictEqual([
      '/2015-03-31/functions/a%2Fb',
      '/2015-03-31/functions/a%2Fb/code',
      '/2015-03-31/functions/a%2Fb/configuration',
      '/2015-03-31/functions/a%2Fb',
    ]);
  });

  // The whole point of this client: it shares a host and a signing name with core's
  // MicrovmsClient and none of its paths. MicrovmsClient owns /2025-09-09/ exclusively.
  it('addresses the standard /2015-03-31/ function API and never the /2025-09-09/ MicroVM paths', async () => {
    const { transport, all } = recordingTransport(200, JSON.stringify(getFunctionResponse()));
    const client = lambdaWith(transport);
    await client.createFunction(INPUT);
    await client.getFunction(NAME);
    await client.updateFunctionCode(NAME, ZIP);
    await client.updateFunctionConfiguration(NAME, INPUT);
    await client.deleteFunction(NAME);

    const urls = all().map((r) => r.url);
    // Guards the assertions below against a vacuous pass: an empty list would satisfy
    // every `not.toContain` trivially.
    expect(urls).toHaveLength(5);
    for (const url of urls) {
      expect(url).toContain('/2015-03-31/functions');
      expect(url).not.toContain('/2025-09-09');
      expect(new URL(url).host).toBe('lambda.us-east-1.amazonaws.com');
    }
  });

  it('carries the caller values through rather than fixed ones', async () => {
    const { transport, seen } = recordingTransport(201, JSON.stringify({ FunctionArn: ARN }));
    await lambdaWith(transport).createFunction({
      ...INPUT,
      roleArn: 'arn:aws:iam::210987654321:role/other-role',
      runtime: 'nodejs20.x',
      handler: 'transform.main',
      memoryMb: 1024,
      timeoutSeconds: 120,
    });
    expect(seen().body).toMatchObject({
      Role: 'arn:aws:iam::210987654321:role/other-role',
      Runtime: 'nodejs20.x',
      Handler: 'transform.main',
      MemorySize: 1024,
      Timeout: 120,
    });
  });
});

describe('LambdaClient environment handling', () => {
  // Omitting the key and sending an empty map are different instructions to the
  // service on an update: absent leaves the function's variables alone, an explicit
  // map replaces them, so an empty one clears them.
  it('omits Environment entirely when the input carries none', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await lambdaWith(transport).updateFunctionConfiguration(NAME, {
      roleArn: ROLE_ARN,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memoryMb: 256,
      timeoutSeconds: 60,
    });
    expect(Object.keys(seen().body as object)).not.toContain('Environment');
  });

  it('sends an explicit empty Variables map when the input carries an empty environment', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await lambdaWith(transport).updateFunctionConfiguration(NAME, { ...INPUT, environment: {} });
    expect((seen().body as { Environment: unknown }).Environment).toStrictEqual({ Variables: {} });
  });
});

describe('LambdaClient.getFunction', () => {
  // GetFunction nests the configuration under `Configuration`, unlike the create and
  // update responses which return a FunctionConfiguration at the top level. Reading
  // FunctionArn off the root here yields undefined, not an error.
  it('reads the ARN out of Configuration, not the response root', async () => {
    const transport: Transport = async () => response(200, JSON.stringify(getFunctionResponse()));
    expect(await lambdaWith(transport).getFunction(NAME)).toStrictEqual({
      name: NAME,
      arn: ARN,
      state: 'active',
    });
  });

  it('maps every state the service documents onto the domain union', async () => {
    const cases: Array<[string, FunctionState]> = [
      ['Pending', 'pending'],
      ['Active', 'active'],
      ['Inactive', 'inactive'],
      ['Failed', 'failed'],
      ['Deactivating', 'deactivating'],
      ['Deactivated', 'deactivated'],
      ['ActiveNonInvocable', 'active-non-invocable'],
      ['Deleting', 'deleting'],
      ['SomethingAWSAddedLater', 'unknown'],
    ];
    for (const [wire, expected] of cases) {
      const transport: Transport = async () =>
        response(200, JSON.stringify(getFunctionResponse(wire)));
      const fn = await lambdaWith(transport).getFunction(NAME);
      expect(fn?.state).toBe(expected);
    }
  });

  it('falls back to the requested name and an empty ARN when a 200 carries no Configuration', async () => {
    const transport: Transport = async () => response(200, JSON.stringify({ Tags: {} }));
    expect(await lambdaWith(transport).getFunction(NAME)).toStrictEqual({
      name: NAME,
      arn: '',
      state: 'unknown',
    });
  });

  it('returns undefined on a 404 ResourceNotFoundException so the node creates rather than adopts', async () => {
    const transport: Transport = async () =>
      errorResponse(404, 'ResourceNotFoundException', `Function not found: ${ARN}`);
    expect(await lambdaWith(transport).getFunction(NAME)).toBeUndefined();
  });

  it('rethrows a 403 rather than reading a permissions failure as absence', async () => {
    const transport: Transport = async () =>
      errorResponse(403, 'AccessDeniedException', 'not authorized to perform lambda:GetFunction');
    await expect(lambdaWith(transport).getFunction(NAME)).rejects.toThrow(AwsError);
  });

  it('rethrows a 500 with the operation and function name', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'ServiceException', 'internal error');
    await expect(lambdaWith(transport).getFunction(NAME)).rejects.toThrow(
      new RegExp(`getFunction "${NAME}": internal error`),
    );
  });
});

describe('LambdaClient.createFunction idempotency', () => {
  // The routed finding's case. ResourceConflictException's name reaches the client
  // only in the x-amzn-ErrorType header, so AwsError.code is "Http409" and
  // isAlreadyExists matches nothing; the statusCode === 409 limb is what makes a
  // re-bootstrap a no-op instead of a failure.
  it('resolves on a 409 ResourceConflictException so a re-run of create is a no-op', async () => {
    const transport: Transport = async () =>
      errorResponse(409, 'ResourceConflictException', `Function already exist: ${NAME}`);
    await expect(lambdaWith(transport).createFunction(INPUT)).resolves.toBeUndefined();
  });

  // Pins the gap the limb above exists to bridge, so the day core's parseError learns
  // to read the header this test says so rather than silently going slack.
  it('sees the conflict only as a degraded Http409 code, never as the exception name', async () => {
    const transport: Transport = async () =>
      errorResponse(409, 'ResourceConflictException', `Function already exist: ${NAME}`);
    await expect(lambdaWith(transport).getFunction(NAME)).rejects.toMatchObject({
      code: 'Http409',
      statusCode: 409,
      requestId: undefined,
    });
  });

  // On CreateFunction a 404 is not "no such function" - the function is what is being
  // created - it is "the execution role does not exist". Swallowing it would report a
  // function that was never created.
  it('rejects a 404 rather than reading the absent execution role as an existing function', async () => {
    const transport: Transport = async () =>
      errorResponse(
        404,
        'ResourceNotFoundException',
        `The role defined for the function cannot be assumed: ${ROLE_ARN}`,
      );
    await expect(lambdaWith(transport).createFunction(INPUT)).rejects.toThrow(
      /createFunction .*role defined for the function/,
    );
  });

  it('rejects a 400 rather than treating every failure as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidParameterValueException', 'MemorySize must be a multiple of 1 MB');
    await expect(lambdaWith(transport).createFunction(INPUT)).rejects.toThrow(
      /MemorySize must be a multiple/,
    );
  });

  it('rejects a 500 rather than treating it as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'ServiceException', 'internal error');
    await expect(lambdaWith(transport).createFunction(INPUT)).rejects.toThrow(AwsError);
  });
});

describe('LambdaClient.deleteFunction idempotency', () => {
  it('swallows a 404 so teardown is re-runnable', async () => {
    const transport: Transport = async () =>
      errorResponse(404, 'ResourceNotFoundException', `Function not found: ${ARN}`);
    await expect(lambdaWith(transport).deleteFunction(NAME)).resolves.toBeUndefined();
  });

  // ResourceConflictException is overloaded across operations: "already exists" on
  // create, "another operation is in progress" on delete. Reusing the create
  // predicate here would report a live function as torn down.
  it('rejects a 409 rather than reporting a function that is mid-operation as torn down', async () => {
    const transport: Transport = async () =>
      errorResponse(
        409,
        'ResourceConflictException',
        'The operation cannot be performed at this time. An update is in progress',
      );
    await expect(lambdaWith(transport).deleteFunction(NAME)).rejects.toThrow(
      /deleteFunction .*An update is in progress/,
    );
  });

  it('rejects a 500 rather than swallowing it as not-found', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'ServiceException', 'internal error');
    await expect(lambdaWith(transport).deleteFunction(NAME)).rejects.toThrow(AwsError);
  });
});

describe('LambdaClient update failures', () => {
  it('updateFunctionCode rejects a 409 rather than reading an in-progress update as success', async () => {
    const transport: Transport = async () =>
      errorResponse(
        409,
        'ResourceConflictException',
        'The function is currently in the following state: Pending',
      );
    await expect(lambdaWith(transport).updateFunctionCode(NAME, ZIP)).rejects.toThrow(
      /updateFunctionCode .*state: Pending/,
    );
  });

  it('updateFunctionConfiguration rejects a 404 rather than swallowing an absent function', async () => {
    const transport: Transport = async () =>
      errorResponse(404, 'ResourceNotFoundException', `Function not found: ${ARN}`);
    await expect(lambdaWith(transport).updateFunctionConfiguration(NAME, INPUT)).rejects.toThrow(
      /updateFunctionConfiguration .*Function not found/,
    );
  });
});

describe('LambdaClient error context', () => {
  // `code` is `Http400`, not `InvalidParameterValueException`, and that is the truth
  // about this service rather than a shortcut in the test: the exception name is
  // header-only (see `errorResponse`) and core's `parseError` reads the body alone.
  // The same gap leaves `requestId` permanently undefined even though Lambda sends
  // `x-amzn-RequestId` on every failure.
  it('carries the lambda service label, the degraded code, the operation and the function name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidParameterValueException', 'Runtime is not supported');
    await expect(lambdaWith(transport).createFunction(INPUT)).rejects.toMatchObject({
      name: 'AwsError',
      service: 'lambda',
      code: 'Http400',
      statusCode: 400,
      requestId: undefined,
    });
  });

  it('does not repeat the AwsError framing when adding context', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidParameterValueException', 'Runtime is not supported');
    await expect(lambdaWith(transport).createFunction(INPUT)).rejects.toMatchObject({
      message: `lambda: Http400 - createFunction "${NAME}": Runtime is not supported (HTTP 400)`,
    });
  });
});

describe('LambdaClient public surface', () => {
  // The contract is create/get/update/delete for a function and its configuration,
  // and nothing the transform-function node does not need. A sixth operation would be
  // new surface, so the set is pinned rather than left to review.
  it('declares exactly the five operations the transform-function node needs', () => {
    expect(Object.getOwnPropertyNames(LambdaClient.prototype).sort()).toStrictEqual([
      'call',
      'constructor',
      'createFunction',
      'deleteFunction',
      'getFunction',
      'updateFunctionCode',
      'updateFunctionConfiguration',
    ]);
  });
});
