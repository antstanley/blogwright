import { AwsError, type ServiceDescriptor, type SigningClient } from 'blogwright-core';

import { rethrowWithContext } from './errors.js';

/**
 * AWS Glue Data Catalog client, cut down to the one thing this plugin needs: the
 * `s3tablescatalog` federation Firehose writes the `page_views` table through.
 * Firehose reaches an S3 Tables table only via a Glue catalog
 * (`IcebergDestinationConfiguration.CatalogConfiguration.CatalogARN`), never via
 * the S3 Tables API directly, so without this federation the delivery stream has
 * nothing to point at. It exposes exactly two operations - create the federation
 * and look one up - because `analytics-catalog-integration` is a read-then-adopt
 * node and needs nothing else; no update, no delete (the change spec makes that
 * node's `delete()` a no-op, since the federation is account-and-region scoped
 * shared state that other environments and other tools also depend on).
 *
 * It lives in `blogwright-analytics`, not in core: core's `SIGNING_NAMES` gains no
 * `glue` key, and every request signs through the `{ service: 'glue', signingName:
 * 'glue' }` descriptor the plugin transport seam accepts (see
 * `packages/core/src/aws/endpoint.ts`'s `ServiceDescriptor`), which resolves to the
 * canonical `glue.<region>.amazonaws.com` host.
 *
 * Protocol: AWS JSON 1.1 - `POST /` with `content-type: application/x-amz-json-1.1`
 * and an `x-amz-target: AWSGlue.<Operation>` header, exactly as
 * `packages/core/src/aws/secretsmanager.ts` and `logs.ts` do for their services.
 * `AWSGlue` is the service's own target prefix (`glue-2017-03-31`'s `targetPrefix`),
 * and both operations are `POST /` despite Glue's reference calling them "Get" and
 * "Create".
 *
 * Operation names and body keys below are verified against the Glue API reference
 * (`CreateCatalog`, `GetCatalog`, and the `CatalogInput`, `FederatedCatalog`,
 * `PrincipalPermissions` and `Catalog` shapes they nest) and against AWS's own
 * documented S3 Tables integration procedure. No SDK validates them here and a
 * transport-mocked test can only assert the body this module itself builds, so the
 * reference is the only thing that catches a wrong or missing key - and here a wrong
 * key produces a *silently misconfigured federation*, not an error: `CatalogInput`
 * has no required members at all, so a `CreateCatalog` that omitted
 * `FederatedCatalog` entirely would return HTTP 200 and leave an empty non-federated
 * catalog behind under the right name, which `getCatalogFederation` would then
 * happily adopt.
 *
 * Two easy-to-miss spellings are pinned deliberately:
 * - `Name` is a *sibling* of `CatalogInput`, not a member of it. `CatalogInput`
 *   carries no name; putting one inside it is silently ignored.
 * - `CatalogNameString`'s pattern is `^(?!(.*[.\/\\]|aws:)).*$` - a catalog name may
 *   not start with `aws:`. That restriction does *not* apply to
 *   `FederatedCatalog.ConnectionName`, which is exactly `aws:s3tables`; the two are
 *   different fields with different patterns.
 *
 * The floci emulator does not implement this service, so it is covered by transport
 * mocks in tests.
 */

const SERVICE: ServiceDescriptor = { service: 'glue', signingName: 'glue' };

/** The service's AWS-JSON target prefix; every `x-amz-target` is `${TARGET}.<Operation>`. */
const TARGET = 'AWSGlue';

/**
 * The AWS-managed connection that federates S3 Tables into the Data Catalog, sent as
 * `FederatedCatalog.ConnectionName`. Hard-coded rather than a parameter because this
 * client exists only for the S3 Tables federation; any other connection would make
 * `createCatalogFederation` a different operation. `FederatedCatalog.ConnectionType`
 * is deliberately not sent - AWS's documented S3 Tables integration omits it, and the
 * connection name alone identifies the source.
 */
const S3_TABLES_CONNECTION = 'aws:s3tables';

/**
 * The default permissions that put the federated catalog under **IAM access control**
 * rather than Lake Formation grants, sent as both
 * `CatalogInput.CreateDatabaseDefaultPermissions` and `CreateTableDefaultPermissions`.
 *
 * Load-bearing, not decoration. `CatalogInput` marks both fields optional, so omitting
 * them succeeds - and leaves the catalog under Lake Formation control, where every
 * read and write needs a grant this plugin never provisions. Firehose's delivery role
 * would be denied on write and the change spec's whole "requires `s3tables`
 * permissions but no Lake Formation grant" assumption would fail, with the only
 * symptom a stream quietly routing every record to the error bucket. AWS's own S3
 * Tables integration procedure sets both to `IAM_ALLOWED_PRINCIPALS` with `ALL` for
 * exactly this reason.
 *
 * `AllowFullTableExternalDataAccess` is deliberately *not* sent alongside them. It
 * only opens Lake-Formation-registered S3 locations to third-party engines, and the
 * one third-party reader here (DuckDB) attaches through S3 Tables' own endpoint, not
 * through Glue credential vending - so setting it would widen access this pipeline
 * never uses. Note if it is ever needed that it is a **string** enum, `"True"` or
 * `"False"`, not a boolean.
 */
const IAM_DEFAULT_PERMISSIONS = [
  { Principal: { DataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS' }, Permissions: ['ALL'] },
];

/**
 * A catalog federation as this plugin reads it, mapped out of Glue's `Catalog` shape
 * so the catalog-integration node decides whether to adopt without re-reading the raw
 * response. `sourceIdentifier` and `connectionName` are what make that decision
 * possible: a catalog of the right name that is not federated at all, or federated
 * somewhere else, is not something to adopt, and both keys are absent in that case.
 */
export interface CatalogFederation {
  /** The catalog's name (`s3tablescatalog` for this plugin's federation). */
  readonly name: string;
  /**
   * The catalog's own ARN (`Catalog.ResourceArn`), in the
   * `arn:aws:glue:<region>:<account-id>:catalog/<name>` form. Empty string when the
   * service reports none.
   */
  readonly resourceArn: string;
  /**
   * `FederatedCatalog.Identifier` - the S3 Tables resource the catalog federates, as
   * `arn:aws:s3tables:<region>:<account-id>:bucket/*`. Undefined when the catalog
   * exists but carries no `FederatedCatalog` at all.
   */
  readonly sourceIdentifier: string | undefined;
  /** `FederatedCatalog.ConnectionName` - `aws:s3tables` for this federation. Undefined when the catalog is not federated. */
  readonly connectionName: string | undefined;
}

interface FederatedCatalogResponse {
  Identifier?: string;
  ConnectionName?: string;
  ConnectionType?: string;
}

interface GetCatalogResponse {
  Catalog?: {
    Name?: string;
    CatalogId?: string;
    ResourceArn?: string;
    FederatedCatalog?: FederatedCatalogResponse;
  };
}

/**
 * Map `GetCatalog`'s response onto the domain value.
 *
 * A 200 is the existence signal: `GetCatalogResponse.Catalog` is optional in the
 * service model, but a 200 carrying no catalog is neither documented nor observed, so
 * an absent field falls back rather than inventing a second "does not exist" answer
 * next to `EntityNotFoundException` - the same call this module's siblings make
 * (`s3tables.ts`'s `normalizeTable`, `firehose.ts`'s `describeDeliveryStream`).
 */
function normalizeCatalog(out: GetCatalogResponse, fallbackName: string): CatalogFederation {
  const catalog = out.Catalog;
  return {
    name: catalog?.Name ?? fallbackName,
    resourceArn: catalog?.ResourceArn ?? '',
    sourceIdentifier: catalog?.FederatedCatalog?.Identifier,
    connectionName: catalog?.FederatedCatalog?.ConnectionName,
  };
}

/**
 * AWS Glue Data Catalog client for the S3 Tables federation, over the shared SigV4
 * transport.
 *
 * Both narrowings below use `AwsError`'s predicates unmodified, unlike this module's
 * two siblings, and that is a property of the service rather than luck: Glue is
 * AWS-JSON, so its error body carries `{"__type":"EntityNotFoundException",...}` and
 * core's `parseError` (`packages/core/src/aws/signer.ts`) reads a real exception name
 * into `AwsError.code` - where `s3tables.ts` gets `Http<status>` because S3 Tables
 * puts the name in an `x-amzn-ErrorType` header the parser never reads. And Glue's
 * names happen to fall inside both patterns: `EntityNotFoundException` matches
 * `isNotFound`'s `/NotFound/i` (`packages/core/src/aws/errors.ts:24`), while both
 * `AlreadyExistsException` *and* `FederatedResourceAlreadyExistsException` - the two
 * distinct duplicates `CreateCatalog` documents - match `isAlreadyExists`'s
 * `/AlreadyExists/i` (`errors.ts:32`). So no local predicate is needed here and core's
 * regex, which the site's own bootstrap shares, is left alone.
 *
 * `statusCode` is no help either way and is never narrowed on: every Glue exception is
 * HTTP 400 except `InternalServiceException` at 500, so `isNotFound`'s `=== 404` limb
 * and any `=== 409` limb are dead on this service - the code is the only signal. Glue
 * also returns its request id only in the `x-amzn-requestid` header, which
 * `parseError` does not read, so `AwsError.requestId` is always `undefined` here.
 */
export class GlueClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(op: string, payload: object): Promise<T> {
    const res = await this.client.send({
      service: SERVICE,
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `${TARGET}.${op}`,
      },
      body: JSON.stringify(payload),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Create the `s3tablescatalog` federation over an S3 Tables bucket resource.
   * `tableBucketArn` is the `FederatedCatalog.Identifier`, and AWS's integration
   * procedure passes the account-and-region wildcard
   * `arn:aws:s3tables:<region>:<account-id>:bucket/*` there: one catalog federates
   * every table bucket in the account and Region, mounting each as a child catalog.
   * This client sends whatever the caller passes rather than building the wildcard
   * itself - the node owns the account id and Region.
   *
   * Idempotent: an already-existing federation resolves rather than throwing, because
   * the integration is **account-and-region-scoped shared state**. Two blogwright
   * environments in one account share the single `s3tablescatalog`, as does anything
   * else in that account that enabled the integration, so a second environment's
   * bootstrap must adopt what is there instead of fighting over it. Both duplicate
   * exceptions are covered: `AlreadyExistsException` when a catalog of that name
   * exists, and `FederatedResourceAlreadyExistsException` when the federation itself
   * is already registered (which is what a second run against a console-enabled
   * account hits).
   *
   * Nothing else is swallowed. In particular `EntityNotFoundException`, which
   * `CreateCatalog` also documents, means something entirely different here than it
   * does on `getCatalogFederation` - not "no such catalog" but "the entity this
   * catalog would federate does not exist", i.e. the S3 Tables resource in
   * `tableBucketArn` is wrong. Treating that as success would report a federation that
   * was never created.
   *
   * Returns `void`: `CreateCatalog`'s success response is an empty body, so there is
   * nothing to return, and a caller that needs the catalog's ARN reads it back with
   * `getCatalogFederation` - which is the call it made before creating anyway.
   */
  async createCatalogFederation(name: string, tableBucketArn: string): Promise<void> {
    try {
      await this.call('CreateCatalog', {
        Name: name,
        CatalogInput: {
          FederatedCatalog: {
            Identifier: tableBucketArn,
            ConnectionName: S3_TABLES_CONNECTION,
          },
          CreateDatabaseDefaultPermissions: IAM_DEFAULT_PERMISSIONS,
          CreateTableDefaultPermissions: IAM_DEFAULT_PERMISSIONS,
        },
      });
    } catch (err) {
      if (err instanceof AwsError && err.isAlreadyExists) return;
      rethrowWithContext(err, 'createCatalogFederation', name);
    }
  }

  /**
   * Look the federation up by catalog name; `undefined` when it does not exist, so the
   * catalog-integration node adopts an existing federation instead of creating one, in
   * the `packages/core/src/aws/secretsmanager.ts:78-89` shape.
   *
   * The name *is* the id: `GetCatalog` is keyed by `CatalogId`, and for a catalog
   * created directly under the account that id is the catalog's own name (AWS's
   * verification step for the integration is literally
   * `aws glue get-catalog --catalog-id s3tablescatalog`). It takes no bucket ARN -
   * `GetCatalogRequest` has exactly one member.
   *
   * Only `EntityNotFoundException` reads as absent. `FederationSourceException` in
   * particular is rethrown even though its `FederationSourceErrorCode` can itself be
   * `EntityNotFoundException`: `parseError` reads the outer `__type`, so `code` is the
   * wrapper name, and a federation source that failed is a broken federation to
   * surface, not a missing one to silently re-create.
   */
  async getCatalogFederation(name: string): Promise<CatalogFederation | undefined> {
    try {
      const out = await this.call<GetCatalogResponse>('GetCatalog', { CatalogId: name });
      return normalizeCatalog(out, name);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'getCatalogFederation', name);
    }
  }
}
