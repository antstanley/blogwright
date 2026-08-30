import { AwsError, type ServiceDescriptor, type SigningClient } from 'blogwright-core';

import { rethrowWithContext } from './errors.js';

/**
 * Amazon S3 Tables control-plane client - create/get/delete for table buckets,
 * namespaces and tables (the `s3tables` API, REST-JSON). It lives in
 * `blogwright-analytics`, not in core: core's `SIGNING_NAMES` gains no `s3tables`
 * key, and every request signs through the `{ service: 's3tables', signingName:
 * 's3tables' }` descriptor the plugin transport seam accepts (see
 * `packages/core/src/aws/endpoint.ts`'s `ServiceDescriptor`), which resolves to
 * the canonical `s3tables.<region>.amazonaws.com` host. Operation names, methods
 * and URI templates below follow the published S3 Tables API reference - GetTable
 * is the one operation that is not path-templated like its siblings; it takes its
 * identifiers as query parameters (`/get-table?tableBucketARN=&namespace=&name=`).
 * The floci emulator does not implement this service, so it is covered by
 * transport mocks in tests.
 *
 * `createTable`'s `schema` parameter mirrors `CreateTableRequest.metadata.iceberg`
 * (`TableMetadata` is a union whose sole member today is `iceberg: IcebergMetadata`).
 * Field names below are verified against the service's `IcebergMetadata`,
 * `IcebergSchema`, `SchemaField`, `IcebergPartitionSpec` and `IcebergPartitionField`
 * shapes: `IcebergMetadata.schema.fields` (not `schemaV2`, which exists only for
 * nested/complex Iceberg types this table never uses) carries `{ name, type, id,
 * required }` - already camelCase on the wire - while `IcebergPartitionSpec.fields`
 * carries `IcebergPartitionField`, whose `source-id` and `field-id` are genuinely
 * hyphenated JSON keys, not a documentation typo. This client accepts `sourceId`/
 * `fieldId` (idiomatic TypeScript) and translates to the wire's hyphenated keys
 * itself - that translation is this client's concern, not its callers'. A schema
 * field's `id` is optional in the API (auto-assigned when omitted) but required
 * here: a partition field can only reference an id the caller already knows, and
 * schema and partition spec travel in the same `CreateTable` request, so an
 * auto-assigned id would not exist yet for `sourceId` to reference.
 */

const SERVICE: ServiceDescriptor = { service: 's3tables', signingName: 's3tables' };

/** The only table format S3 Tables accepts today; named so `createTable` never repeats the literal. */
const ICEBERG_FORMAT = 'ICEBERG';

const PATHS = {
  buckets: '/buckets',
  bucket: (tableBucketArn: string) => `/buckets/${encodeURIComponent(tableBucketArn)}`,
  namespaces: (tableBucketArn: string) => `/namespaces/${encodeURIComponent(tableBucketArn)}`,
  namespace: (tableBucketArn: string, namespace: string) =>
    `/namespaces/${encodeURIComponent(tableBucketArn)}/${encodeURIComponent(namespace)}`,
  tables: (tableBucketArn: string, namespace: string) =>
    `/tables/${encodeURIComponent(tableBucketArn)}/${encodeURIComponent(namespace)}`,
  table: (tableBucketArn: string, namespace: string, name: string) =>
    `/tables/${encodeURIComponent(tableBucketArn)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  getTable: '/get-table',
};

export interface TableBucket {
  arn: string;
  name: string;
}

export interface Namespace {
  name: string;
  tableBucketArn: string;
}

export interface Table {
  arn: string;
  name: string;
  /** Absent until the table has been written to at least once. */
  metadataLocation: string | undefined;
}

interface TableBucketResponse {
  arn?: string;
  name?: string;
}

function normalizeTableBucket(res: TableBucketResponse): TableBucket {
  return { arn: res.arn ?? '', name: res.name ?? '' };
}

interface NamespaceResponse {
  namespace?: string[];
}

// GetNamespace's response carries no `tableBucketARN` field (only the response of
// CreateNamespace does), so the bucket ARN comes from what the caller already
// passed in, not from the response.
function normalizeNamespace(
  res: NamespaceResponse,
  tableBucketArn: string,
  fallback: string,
): Namespace {
  return { name: res.namespace?.[0] ?? fallback, tableBucketArn };
}

interface TableResponse {
  tableARN?: string;
  name?: string;
  metadataLocation?: string;
}

function normalizeTable(res: TableResponse, fallbackName: string): Table {
  return {
    arn: res.tableARN ?? '',
    name: res.name ?? fallbackName,
    metadataLocation: res.metadataLocation,
  };
}

/** One column of an Iceberg table's schema, in the shape `createTable` accepts. */
export interface IcebergSchemaField {
  readonly name: string;
  /** An Apache Iceberg primitive type name (e.g. `"string"`, `"timestamp"`, `"date"`, `"int"`, `"long"`, `"double"`, `"boolean"`). */
  readonly type: string;
  /** Explicit field id, required here (see the module doc comment) so a partition field can reference it via `sourceId`. */
  readonly id: number;
  readonly required?: boolean | undefined;
}

/** The Iceberg partition transforms `IcebergPartitionField.transform` accepts. */
export type PartitionTransform =
  | 'identity'
  | 'year'
  | 'month'
  | 'day'
  | 'hour'
  | 'bucket'
  | 'truncate';

/** One partition field, deriving its partition value from a schema field's `id`. */
export interface IcebergPartitionField {
  readonly name: string;
  /** The schema field (`IcebergSchemaField.id`) this partition is derived from. */
  readonly sourceId: number;
  readonly transform: PartitionTransform;
  readonly fieldId?: number | undefined;
}

/** The Iceberg schema and (optional) partition spec `createTable` writes into `metadata.iceberg`. */
export interface IcebergTableSchema {
  readonly fields: readonly IcebergSchemaField[];
  readonly partitionSpec?: readonly IcebergPartitionField[] | undefined;
}

interface IcebergMetadataWire {
  schema: { fields: Array<{ name: string; type: string; id: number; required?: boolean }> };
  partitionSpec?: {
    fields: Array<{ name: string; 'source-id': number; transform: string; 'field-id'?: number }>;
  };
}

/** Translate the client's camelCase `IcebergTableSchema` into the wire's `IcebergMetadata` shape - the one place `source-id`/`field-id`'s hyphenated JSON keys are spelled out. */
function buildIcebergMetadata(schema: IcebergTableSchema): { iceberg: IcebergMetadataWire } {
  return {
    iceberg: {
      schema: {
        fields: schema.fields.map((f) => ({
          name: f.name,
          type: f.type,
          id: f.id,
          ...(f.required !== undefined ? { required: f.required } : {}),
        })),
      },
      ...(schema.partitionSpec && schema.partitionSpec.length > 0
        ? {
            partitionSpec: {
              fields: schema.partitionSpec.map((p) => ({
                name: p.name,
                'source-id': p.sourceId,
                transform: p.transform,
                ...(p.fieldId !== undefined ? { 'field-id': p.fieldId } : {}),
              })),
            },
          }
        : {}),
    },
  };
}

/**
 * True when a `create*` failure should be swallowed as "the resource already
 * exists". S3 Tables answers a duplicate name with `ConflictException`, whose
 * only status in the service model is 409, and 409 is the signal this client has
 * to match on: S3 Tables returns the exception name in an `x-amzn-ErrorType`
 * header, while core's `parseError` (`packages/core/src/aws/signer.ts`) reads
 * only the response body, and an S3 Tables error body carries `{"message": ...}`
 * and nothing else. So every failure from this service arrives as
 * `AwsError.code === "Http<status>"`, and `AwsError.isAlreadyExists` - which
 * tests `code` against `/Conflict/i` - never matches here on its own. The
 * `statusCode === 409` limb below is what actually makes `createTableBucket`,
 * `createNamespace` and `createTable` idempotent, mirroring how `isNotFound`
 * survives the same gap on its `statusCode === 404` limb.
 *
 * The accepted gap: S3 Tables documents `ConflictException` generically - "the
 * request failed because there is a conflict with a previous write; retry" - and
 * has no dedicated already-exists exception for these operations, so a genuine
 * concurrent write conflict on `create*` reads as success here rather than being
 * retried or surfaced. A confirming `get*` after the 409 would narrow it without
 * any new signal, at the cost of a round trip on a path callers already reconcile
 * read-then-create; not taking it is a deliberate trade, not a missing capability.
 *
 * The durable fix is core-level and deliberately not made here (this task must
 * not touch `packages/core`): `parseError` should read `x-amzn-errortype` and
 * `x-amzn-requestid` from the headers it already receives, which would hand every
 * rest-json client its real error code and a request id to quote to AWS support,
 * and would subsume this 409 limb. Until then, for this service
 * `AwsError.requestId` is always `undefined` and any narrowing written as
 * `err.code === 'NotFoundException'` silently never matches - worth knowing
 * before adding one in tasks 34-36.
 */
function isAlreadyExists(err: unknown): err is AwsError {
  return err instanceof AwsError && (err.isAlreadyExists || err.statusCode === 409);
}

/** S3 Tables control-plane client, over the shared SigV4 transport. */
export class S3TablesClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(
    method: string,
    path: string,
    payload?: object,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const res = await this.client.send({
      service: SERVICE,
      method,
      path,
      ...(query ? { query } : {}),
      headers: { 'content-type': 'application/json' },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Create a table bucket. Idempotent: an already-existing bucket of the same
   * name is not an error.
   *
   * Deliberately returns `void`, discarding the response's `arn`, rather than
   * surfacing it: `getTableBucket` is ARN-keyed with no name-based lookup, so a
   * caller that wants the ARN has to compute it before calling `createTableBucket`
   * anyway - to run its own `getTableBucket` existence check first, per the usual
   * read-then-create reconcile pattern - using the fixed
   * `arn:aws:s3tables:<region>:<accountId>:bucket/<name>` form and the account id
   * a `PluginContext` already carries. By the time `createTableBucket` runs, the
   * caller already holds the ARN it needs; echoing the response's `arn` back would
   * be redundant on the happy path, and unavailable on the already-exists path
   * (the error body carries no `arn`), so returning it from only one of the two
   * branches would be a false economy. `createNamespace` needs no such lookup at
   * all (its identity is exactly its inputs); `createTable`'s identity is genuinely
   * unrecoverable from its inputs (a table ARN carries an opaque generated id, not
   * a name), but `getTable` is already name-keyed via `/get-table`'s query
   * parameters, so a caller hydrates a table's ARN with a lookup, not by
   * reconstructing it.
   */
  async createTableBucket(name: string): Promise<void> {
    try {
      await this.call('PUT', PATHS.buckets, { name });
    } catch (err) {
      if (isAlreadyExists(err)) return;
      rethrowWithContext(err, 'createTableBucket', name);
    }
  }

  /** Fetch a table bucket by ARN; undefined when it does not exist. */
  async getTableBucket(tableBucketArn: string): Promise<TableBucket | undefined> {
    try {
      const res = await this.call<TableBucketResponse>('GET', PATHS.bucket(tableBucketArn));
      return normalizeTableBucket(res);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'getTableBucket', tableBucketArn);
    }
  }

  /** Delete a table bucket. No-op when it does not exist, so teardown is re-runnable. */
  async deleteTableBucket(tableBucketArn: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.bucket(tableBucketArn));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      rethrowWithContext(err, 'deleteTableBucket', tableBucketArn);
    }
  }

  /** Create a namespace in a table bucket. Idempotent: an already-existing namespace is not an error. */
  async createNamespace(tableBucketArn: string, namespace: string): Promise<void> {
    try {
      await this.call('PUT', PATHS.namespaces(tableBucketArn), { namespace: [namespace] });
    } catch (err) {
      if (isAlreadyExists(err)) return;
      rethrowWithContext(err, 'createNamespace', `${tableBucketArn}/${namespace}`);
    }
  }

  /** Fetch a namespace by bucket ARN and name; undefined when it does not exist. */
  async getNamespace(tableBucketArn: string, namespace: string): Promise<Namespace | undefined> {
    try {
      const res = await this.call<NamespaceResponse>(
        'GET',
        PATHS.namespace(tableBucketArn, namespace),
      );
      return normalizeNamespace(res, tableBucketArn, namespace);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'getNamespace', `${tableBucketArn}/${namespace}`);
    }
  }

  /** Delete a namespace. No-op when it does not exist, so teardown is re-runnable. */
  async deleteNamespace(tableBucketArn: string, namespace: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.namespace(tableBucketArn, namespace));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      rethrowWithContext(err, 'deleteNamespace', `${tableBucketArn}/${namespace}`);
    }
  }

  /**
   * Create an Iceberg table in a namespace, carrying its schema (and, when given,
   * its partition spec) so the table is never created schema-less. This matters
   * beyond correctness-in-general: Firehose matches incoming record keys to
   * Iceberg column names *exactly* and silently routes anything that does not
   * match to the error bucket (see the analytics plugin spec's §Record
   * transformation), so a schema-less table here fails every subsequent record
   * with no error surfacing anywhere - the corruption this parameter exists to
   * prevent. Idempotent: an already-existing table is not an error (its schema is
   * not reconciled against `schema` on that path - S3 Tables has no
   * update-schema-on-conflict operation for `CreateTable` to fall back to).
   */
  async createTable(
    tableBucketArn: string,
    namespace: string,
    name: string,
    schema: IcebergTableSchema,
  ): Promise<void> {
    try {
      await this.call('PUT', PATHS.tables(tableBucketArn, namespace), {
        name,
        format: ICEBERG_FORMAT,
        metadata: buildIcebergMetadata(schema),
      });
    } catch (err) {
      if (isAlreadyExists(err)) return;
      rethrowWithContext(err, 'createTable', `${tableBucketArn}/${namespace}/${name}`);
    }
  }

  /** Fetch a table by bucket ARN, namespace and name; undefined when it does not exist. */
  async getTable(
    tableBucketArn: string,
    namespace: string,
    name: string,
  ): Promise<Table | undefined> {
    try {
      const res = await this.call<TableResponse>('GET', PATHS.getTable, undefined, {
        tableBucketARN: tableBucketArn,
        namespace,
        name,
      });
      return normalizeTable(res, name);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'getTable', `${tableBucketArn}/${namespace}/${name}`);
    }
  }

  /** Delete a table. No-op when it does not exist, so teardown is re-runnable. */
  async deleteTable(tableBucketArn: string, namespace: string, name: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.table(tableBucketArn, namespace, name));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      rethrowWithContext(err, 'deleteTable', `${tableBucketArn}/${namespace}/${name}`);
    }
  }
}
