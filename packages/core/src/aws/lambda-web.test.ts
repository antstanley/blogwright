import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { LambdaWebClient } from './lambda-web.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string, headers: Record<string, string> = {}): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers, body: bytes, text: () => body };
}

function clientWith(transport: Transport): LambdaWebClient {
  return new LambdaWebClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

const S3_OBJECT = { bucket: 'b', key: 'web/artifacts/h.zip', versionId: 'v9' };
const BUILD_CONFIG = {
  codeConfig: { s3Object: S3_OBJECT },
  runtimeConfig: { runtime: 'nodejs24.x' },
};
const SERVICE_CONFIG = {
  executionRoleArn: 'arn:aws:iam::123456789012:role/web',
  timeoutSeconds: 45,
  maxConcurrencyPerEnvironment: 12,
  environmentVariables: {
    NODE_ENV: 'production',
    AWS_LAMBDA_NODEJS_ENTRYPOINT: 'server/lambda.mjs',
  },
  telemetryConfig: { loggingConfig: { logGroup: '/example/production/web' } },
};

describe('LambdaWebClient requests', () => {
  it('creates a function with PUT, nesting the revision and endpoint config', async () => {
    let url = '';
    let method = '';
    let body: Record<string, unknown> = {};
    const transport: Transport = async (req) => {
      url = req.url;
      method = req.method;
      body = JSON.parse(String(req.body ?? '{}')) as Record<string, unknown>;
      return response(
        200,
        JSON.stringify({
          functionName: 'p-web',
          functionArn: 'arn:aws:lambda:us-east-1:1:web-function/p-web',
          state: 'Active',
          revision: { revisionArn: 'arn:rev', revisionId: 'rev-1', state: 'Pending' },
          endpoint: {
            endpointArn: 'arn:ep',
            endpointName: 'site',
            domainName: 'abc.lambda-web.us-east-1.on.aws',
            state: 'Pending',
          },
        }),
      );
    };
    const fn = await clientWith(transport).createWebFunction({
      functionName: 'p-web',
      revisionConfig: {
        description: 'blogwright:placeholder',
        buildConfig: BUILD_CONFIG,
        serviceConfig: SERVICE_CONFIG,
      },
      endpointConfig: {
        endpointName: 'site',
        endpointType: 'HomeRegion',
        authType: 'IamAuth',
        autoDeploymentMode: 'LatestRevision',
      },
      tags: { environment: 'production' },
    });

    expect(method).toBe('PUT');
    expect(url).toBe('https://lambda.us-east-1.amazonaws.com/2025-03-07/web-functions');
    expect(body['revisionConfig']).toEqual({
      description: 'blogwright:placeholder',
      buildConfig: BUILD_CONFIG,
      serviceConfig: SERVICE_CONFIG,
    });
    expect(body['endpointConfig']).toEqual({
      endpointName: 'site',
      endpointType: 'HomeRegion',
      authType: 'IamAuth',
      autoDeploymentMode: 'LatestRevision',
    });
    // The create response carries the initial revision and endpoint, so a
    // bootstrap needs no extra round trips.
    expect(fn.functionArn).toBe('arn:aws:lambda:us-east-1:1:web-function/p-web');
    expect(fn.revision?.revisionId).toBe('rev-1');
    expect(fn.endpoint).toMatchObject({
      endpointName: 'site',
      endpointArn: 'arn:ep',
      domainName: 'abc.lambda-web.us-east-1.on.aws',
    });
  });

  it('creates a revision with buildConfig/serviceConfig and the fingerprint description', async () => {
    let body: Record<string, unknown> = {};
    let url = '';
    const transport: Transport = async (req) => {
      url = req.url;
      body = JSON.parse(String(req.body ?? '{}')) as Record<string, unknown>;
      return response(
        200,
        JSON.stringify({
          functionArn: 'arn:fn',
          revisionArn: 'arn:rev-2',
          revisionId: 'rev-2',
          description: 'blogwright:fp',
          buildConfig: BUILD_CONFIG,
          serviceConfig: SERVICE_CONFIG,
          state: 'Pending',
          errors: [],
        }),
      );
    };
    const revision = await clientWith(transport).createWebFunctionRevision({
      functionName: 'p-web',
      description: 'blogwright:fp',
      buildConfig: BUILD_CONFIG,
      serviceConfig: SERVICE_CONFIG,
    });
    expect(url).toBe(
      'https://lambda.us-east-1.amazonaws.com/2025-03-07/web-functions/p-web/revisions',
    );
    expect(body).toEqual({
      description: 'blogwright:fp',
      buildConfig: BUILD_CONFIG,
      serviceConfig: SERVICE_CONFIG,
    });
    expect(revision.state).toBe('Pending');
    expect(revision.buildConfig?.codeConfig.s3Object).toEqual(S3_OBJECT);
    expect(revision.serviceConfig).toEqual(SERVICE_CONFIG);
  });

  it('reads a revision back with its captured configuration', async () => {
    const transport: Transport = async () =>
      response(
        200,
        JSON.stringify({
          functionArn: 'arn:fn',
          revisionArn: 'arn:rev',
          revisionId: 'rev-1',
          description: 'blogwright:old',
          buildConfig: BUILD_CONFIG,
          serviceConfig: SERVICE_CONFIG,
          state: 'Active',
          errors: [],
        }),
      );
    const revision = await clientWith(transport).getWebFunctionRevision('p-web', 'rev-1');
    expect(revision?.buildConfig?.codeConfig.s3Object.versionId).toBe('v9');
    expect(revision?.serviceConfig?.environmentVariables).toEqual({
      NODE_ENV: 'production',
      AWS_LAMBDA_NODEJS_ENTRYPOINT: 'server/lambda.mjs',
    });
    expect(revision?.serviceConfig?.telemetryConfig?.loggingConfig.logGroup).toBe(
      '/example/production/web',
    );
  });

  it('lists revisions with POST list-revisions and keeps the service order (newest first)', async () => {
    const urls: string[] = [];
    const transport: Transport = async (req) => {
      urls.push(`${req.method} ${req.url}`);
      if (String(req.body ?? '').includes('nextToken')) {
        return response(
          200,
          '{"revisions":[{"revisionArn":"arn:old","revisionId":"rev-old","state":"Active"}],"nextToken":null}',
        );
      }
      return response(
        200,
        '{"revisions":[{"revisionArn":"arn:new","revisionId":"rev-new","state":"Active","description":"blogwright:fp"}],"nextToken":"tok"}',
      );
    };
    const revisions = await clientWith(transport).listWebFunctionRevisions('p-web');
    expect(revisions.map((r) => r.revisionId)).toEqual(['rev-new', 'rev-old']);
    expect(revisions[0]?.description).toBe('blogwright:fp');
    expect(urls[0]).toBe(
      'POST https://lambda.us-east-1.amazonaws.com/2025-03-07/web-functions/p-web/list-revisions',
    );
  });

  it('creates and lists endpoints with authType, and reads domainName back', async () => {
    const calls: string[] = [];
    const transport: Transport = async (req) => {
      calls.push(`${req.method} ${req.url.split('?')[0]}`);
      if (req.method === 'PUT') {
        return response(
          200,
          '{"endpointArn":"arn:ep","endpointName":"site","endpointType":"HomeRegion","domainName":"abc.lambda-web.us-east-1.on.aws","authType":"IamAuth","autoDeploymentMode":"LatestRevision","state":"Pending"}',
        );
      }
      return response(
        200,
        '{"endpoints":[{"endpointArn":"arn:ep","endpointName":"site","domainName":"abc.lambda-web.us-east-1.on.aws","state":"Active"}]}',
      );
    };
    const client = clientWith(transport);
    const endpoint = await client.createWebFunctionEndpoint({
      functionName: 'p-web',
      endpointName: 'site',
      endpointType: 'HomeRegion',
      authType: 'IamAuth',
      autoDeploymentMode: 'LatestRevision',
    });
    expect(endpoint.domainName).toBe('abc.lambda-web.us-east-1.on.aws');
    const listed = await client.listWebFunctionEndpoints('p-web');
    expect(listed[0]?.endpointName).toBe('site');
    expect(calls).toEqual([
      'PUT https://lambda.us-east-1.amazonaws.com/2025-03-07/web-functions/p-web/endpoints',
      'POST https://lambda.us-east-1.amazonaws.com/2025-03-07/web-functions/p-web/list-endpoints',
    ]);
  });

  it('addresses the resource policy by FUNCTION ARN and round-trips the policy revision', async () => {
    const urls: string[] = [];
    let sent = '';
    const transport: Transport = async (req) => {
      urls.push(`${req.method} ${req.url}`);
      if (req.method === 'PUT') {
        sent = String(req.body ?? '');
        return response(200, '{"Policy":"{}","RevisionId":"policy-rev-7"}');
      }
      return response(404, '{"message":"not found"}');
    };
    const client = clientWith(transport);
    const arn = 'arn:aws:lambda:us-east-1:1:web-function/p-web';
    expect(await client.getResourcePolicy(arn)).toBeUndefined();
    const result = await client.putResourcePolicy(arn, '{"Statement":[]}');
    expect(result.revisionId).toBe('policy-rev-7');
    // The model's locationName capitalises both body members.
    expect(JSON.parse(sent)).toEqual({ Policy: '{"Statement":[]}' });
    expect(urls[1]).toBe(
      'PUT https://lambda.us-east-1.amazonaws.com/2025-03-07/resource-policy/arn%3Aaws%3Alambda%3Aus-east-1%3A1%3Aweb-function%2Fp-web',
    );
  });

  it('reads not-found as undefined and surfaces service error codes as AwsError', async () => {
    const gone = clientWith(async () =>
      response(404, '{"__type":"ResourceNotFoundException","message":"no function"}'),
    );
    expect(await gone.getWebFunction('missing')).toBeUndefined();
    expect(await gone.getWebFunctionRevision('missing', 'rev-1')).toBeUndefined();
    expect(await gone.getWebFunctionEndpoint('missing', 'site')).toBeUndefined();

    const conflict = clientWith(async () =>
      response(409, '{"__type":"ConflictException","message":"already exists"}'),
    );
    await expect(
      conflict.createWebFunction({
        functionName: 'p-web',
        revisionConfig: { buildConfig: BUILD_CONFIG, serviceConfig: SERVICE_CONFIG },
        endpointConfig: {
          endpointName: 'site',
          endpointType: 'HomeRegion',
          authType: 'IamAuth',
        },
      }),
    ).rejects.toMatchObject({ code: 'ConflictException', statusCode: 409 });
  });
});
