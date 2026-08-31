import {
  AwsError,
  SigningClient,
  staticCredentials,
  type RawResponse,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { GlueClient } from './glue.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

const CATALOG = 's3tablescatalog';
const BUCKET_ARN = 'arn:aws:s3tables:us-east-1:123456789012:bucket/*';
const CATALOG_ARN = `arn:aws:glue:us-east-1:123456789012:catalog/${CATALOG}`;
const ENDPOINT = 'https://glue.us-east-1.amazonaws.com/';

/**
 * The `CreateCatalog` body `createCatalogFederation` must produce, spelled out
 * independently of the client and transcribed from AWS's own documented S3 Tables
 * integration procedure rather than from the implementation. `Name` sits beside
 * `CatalogInput`, not inside it, and the two default-permission lists are what put the
 * catalog under IAM access control instead of Lake Formation grants.
 */
const EXPECTED_CREATE_BODY = {
  Name: CATALOG,
  CatalogInput: {
    FederatedCatalog: {
      Identifier: BUCKET_ARN,
      ConnectionName: 'aws:s3tables',
    },
    CreateDatabaseDefaultPermissions: [
      {
        Principal: { DataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS' },
        Permissions: ['ALL'],
      },
    ],
    CreateTableDefaultPermissions: [
      {
        Principal: { DataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS' },
        Permissions: ['ALL'],
      },
    ],
  },
};

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

function glueWith(transport: Transport): GlueClient {
  return new GlueClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

interface SeenRequest {
  method: string;
  url: string;
  target: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

/** Records the method, URL, `x-amz-target`/`content-type` headers and parsed JSON body of each request the transport receives. */
function recordingTransport(
  replyStatus: number,
  replyBody: string,
): { transport: Transport; seen: () => SeenRequest } {
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
  return { transport, seen: () => requests[0]! };
}

/**
 * The failure shape Glue actually puts on the wire. It is an AWS-JSON 1.1 service, so
 * the exception name travels in the body's `__type` key and core's `parseError` reads
 * it into `AwsError.code` - unlike the rest-json `s3tables` sibling, whose exception
 * name is header-only and whose every failure degrades to `Http<status>`. The message
 * key is `Message` (capital M) in every Glue exception shape, which `parseError`'s
 * `json.message ?? json.Message` fallback covers; it is spelled that way here so the
 * fixture is the real wire shape and not a convenient one. Every documented Glue
 * exception is HTTP 400 except `InternalServiceException` at 500, so the status never
 * separates them - the code is the only signal.
 */
function errorResponse(status: number, code: string, message: string): RawResponse {
  return response(status, JSON.stringify({ __type: code, Message: message }));
}

/** A `GetCatalog` success body in the service's own shape. */
function getCatalogResponse(federated = true): Record<string, unknown> {
  return {
    Catalog: {
      CatalogId: CATALOG,
      Name: CATALOG,
      ResourceArn: CATALOG_ARN,
      CreateTime: 1750000000,
      UpdateTime: 1750000000,
      ...(federated
        ? { FederatedCatalog: { Identifier: BUCKET_ARN, ConnectionName: 'aws:s3tables' } }
        : {}),
      CreateDatabaseDefaultPermissions: [
        {
          Principal: { DataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS' },
          Permissions: ['ALL'],
        },
      ],
    },
  };
}

describe('GlueClient request wire format', () => {
  it('pins CreateCatalog to its x-amz-target and the full federated catalog body', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN);
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'AWSGlue.CreateCatalog',
      contentType: 'application/x-amz-json-1.1',
      body: EXPECTED_CREATE_BODY,
    });
  });

  it('pins GetCatalog to its x-amz-target and a CatalogId-only body', async () => {
    const { transport, seen } = recordingTransport(200, JSON.stringify(getCatalogResponse()));
    await glueWith(transport).getCatalogFederation(CATALOG);
    expect(seen()).toStrictEqual({
      method: 'POST',
      url: ENDPOINT,
      target: 'AWSGlue.GetCatalog',
      contentType: 'application/x-amz-json-1.1',
      body: { CatalogId: CATALOG },
    });
  });

  // CatalogInput has no required members, so a create that dropped FederatedCatalog
  // would still return HTTP 200 and leave a non-federated catalog behind under the
  // right name - the failure mode no transport-mocked assertion of the body the client
  // itself builds can notice. Named here so a regression is a red test, not a silently
  // broken pipeline.
  it('carries the caller bucket ARN into FederatedCatalog.Identifier rather than a fixed one', async () => {
    const { transport, seen } = recordingTransport(200, '');
    const other = 'arn:aws:s3tables:eu-west-1:210987654321:bucket/*';
    await glueWith(transport).createCatalogFederation(CATALOG, other);
    expect(
      (seen().body as { CatalogInput: { FederatedCatalog: { Identifier: string } } }).CatalogInput
        .FederatedCatalog,
    ).toStrictEqual({ Identifier: other, ConnectionName: 'aws:s3tables' });
  });

  it('sends Name beside CatalogInput, never inside it, where the service would ignore it', async () => {
    const { transport, seen } = recordingTransport(200, '');
    await glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN);
    const body = seen().body as { CatalogInput: Record<string, unknown> };
    expect(Object.keys(body)).toStrictEqual(['Name', 'CatalogInput']);
    expect(Object.keys(body.CatalogInput)).not.toContain('Name');
  });
});

describe('GlueClient.getCatalogFederation', () => {
  it('maps a present federation onto the domain value', async () => {
    const transport: Transport = async () => response(200, JSON.stringify(getCatalogResponse()));
    expect(await glueWith(transport).getCatalogFederation(CATALOG)).toStrictEqual({
      name: CATALOG,
      resourceArn: CATALOG_ARN,
      sourceIdentifier: BUCKET_ARN,
      connectionName: 'aws:s3tables',
    });
  });

  // A catalog of the right name that is not federated at all is not something to
  // adopt, so the two federation keys have to come back undefined rather than being
  // filled in from the request.
  it('reports a catalog carrying no FederatedCatalog with both federation fields undefined', async () => {
    const transport: Transport = async () =>
      response(200, JSON.stringify(getCatalogResponse(false)));
    expect(await glueWith(transport).getCatalogFederation(CATALOG)).toStrictEqual({
      name: CATALOG,
      resourceArn: CATALOG_ARN,
      sourceIdentifier: undefined,
      connectionName: undefined,
    });
  });

  it('returns undefined on EntityNotFoundException so the node creates rather than adopts', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'EntityNotFoundException', 'Catalog s3tablescatalog not found');
    expect(await glueWith(transport).getCatalogFederation(CATALOG)).toBeUndefined();
  });

  it('rethrows a non-not-found failure with the operation and catalog name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidInputException', 'CatalogId is not valid');
    await expect(glueWith(transport).getCatalogFederation(CATALOG)).rejects.toThrow(
      new RegExp(`getCatalogFederation "${CATALOG}": CatalogId is not valid`),
    );
  });

  it('rejects a ValidationException rather than swallowing it', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ValidationException', 'Unsupported Federation Resource');
    await expect(glueWith(transport).getCatalogFederation(CATALOG)).rejects.toThrow(
      /ValidationException|Unsupported Federation Resource/,
    );
  });

  // FederationSourceErrorCode is itself an enum that includes EntityNotFoundException,
  // but parseError reads the outer __type - so a failed federation source surfaces as
  // a broken federation rather than being mistaken for a missing one.
  it('rethrows FederationSourceException rather than reading it as absent', async () => {
    const transport: Transport = async () =>
      response(
        400,
        JSON.stringify({
          __type: 'FederationSourceException',
          FederationSourceErrorCode: 'EntityNotFoundException',
          Message: 'the federation source failed',
        }),
      );
    await expect(glueWith(transport).getCatalogFederation(CATALOG)).rejects.toThrow(AwsError);
  });

  it('rethrows a 500 rather than reading it as absent', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'InternalServiceException', 'try again later');
    await expect(glueWith(transport).getCatalogFederation(CATALOG)).rejects.toThrow(AwsError);
  });
});

describe('GlueClient.createCatalogFederation idempotency', () => {
  // The federation is account-and-region-scoped shared state, so a second environment
  // (or a console-enabled account) finding it already there must adopt, not fail.
  it('resolves on AlreadyExistsException so a re-run of create is a no-op', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'AlreadyExistsException', 'Catalog already exists');
    await expect(
      glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN),
    ).resolves.toBeUndefined();
  });

  // CreateCatalog documents two distinct duplicate exceptions; both have to resolve.
  it('resolves on FederatedResourceAlreadyExistsException, the second duplicate name', async () => {
    const transport: Transport = async () =>
      response(
        400,
        JSON.stringify({
          __type: 'FederatedResourceAlreadyExistsException',
          AssociatedGlueResource: CATALOG,
          Message: 'a federated resource already exists',
        }),
      );
    await expect(
      glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN),
    ).resolves.toBeUndefined();
  });

  it('rejects a ValidationException rather than treating every failure as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'ValidationException', 'Identifier is not valid');
    await expect(glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN)).rejects.toThrow(
      /ValidationException|Identifier is not valid/,
    );
  });

  // The get/create asymmetry: EntityNotFoundException is documented on both operations
  // and means different things. On the lookup it is "no such catalog"; on the create it
  // is "the entity this catalog would federate does not exist", i.e. a wrong bucket
  // ARN. Swallowing it here would report a federation that was never created.
  it("rejects EntityNotFoundException rather than reusing the lookup's absent narrowing", async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'EntityNotFoundException', 'the S3 Tables resource does not exist');
    await expect(glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN)).rejects.toThrow(
      /EntityNotFoundException|does not exist/,
    );
  });

  it('rejects a 500 rather than treating it as already-exists', async () => {
    const transport: Transport = async () =>
      errorResponse(500, 'InternalServiceException', 'try again later');
    await expect(glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN)).rejects.toThrow(
      AwsError,
    );
  });
});

describe('GlueClient error context', () => {
  it('carries the glue service label, the real error code, the operation and the catalog name', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidInputException', 'Identifier is not valid');
    await expect(
      glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN),
    ).rejects.toMatchObject({
      name: 'AwsError',
      service: 'glue',
      code: 'InvalidInputException',
      statusCode: 400,
    });
  });

  it('does not repeat the AwsError framing when adding context', async () => {
    const transport: Transport = async () =>
      errorResponse(400, 'InvalidInputException', 'Identifier is not valid');
    await expect(
      glueWith(transport).createCatalogFederation(CATALOG, BUCKET_ARN),
    ).rejects.toMatchObject({
      message: `glue: InvalidInputException - createCatalogFederation "${CATALOG}": Identifier is not valid (HTTP 400)`,
    });
  });
});

describe('GlueClient public surface', () => {
  // The contract is "exactly two operations". A third would be a new capability on
  // account-scoped shared state - an update or a delete that another environment
  // depends on - so the count is pinned rather than left to review.
  it('declares exactly the two operations the catalog-integration node needs', () => {
    expect(Object.getOwnPropertyNames(GlueClient.prototype).sort()).toStrictEqual([
      'call',
      'constructor',
      'createCatalogFederation',
      'getCatalogFederation',
    ]);
  });
});
