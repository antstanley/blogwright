import {
  AwsError,
  type ResourceTags,
  type ServiceDescriptor,
  type SigningClient,
} from 'blogwright-core';

import { rethrowWithContext } from './errors.js';

/**
 * Amazon Data Firehose control-plane client - create/describe/delete and tagging
 * for the one delivery stream this plugin owns (the `firehose` API, AWS JSON 1.1).
 * It lives in `blogwright-analytics`, not in core: core's `SIGNING_NAMES` gains no
 * `firehose` key, and every request signs through the `{ service: 'firehose',
 * signingName: 'firehose' }` descriptor the plugin transport seam accepts (see
 * `packages/core/src/aws/endpoint.ts`'s `ServiceDescriptor`), which resolves to the
 * canonical `firehose.<region>.amazonaws.com` host.
 *
 * Protocol: AWS JSON 1.1 - every operation is `POST /` with
 * `content-type: application/x-amz-json-1.1` and an
 * `x-amz-target: Firehose_20150804.<Operation>` header, exactly as
 * `packages/core/src/aws/secretsmanager.ts` and `logs.ts` do for their services.
 * `Firehose_20150804` is the service's own target prefix, confirmed against the
 * `X-Amz-Target` line of every sample request in the Firehose API reference.
 *
 * Operation names and body shapes below are verified field by field against the
 * Firehose API reference (`CreateDeliveryStream`, `DescribeDeliveryStream`,
 * `DeleteDeliveryStream`, `TagDeliveryStream`, and the `IcebergDestinationConfiguration`,
 * `CatalogConfiguration`, `S3DestinationConfiguration`, `DestinationTableConfiguration`,
 * `BufferingHints`, `Processor` and `ProcessorParameter` shapes they nest). No SDK
 * validates them here and transport-mocked tests can only assert the body this module
 * itself builds, so the reference is the only thing that catches a wrong key - and a
 * wrong key produces a silently misconfigured stream, not an error. Two spellings are
 * easy to get wrong and are pinned deliberately: the ARN-bearing keys are `RoleARN`,
 * `BucketARN` and `CatalogARN` (upper-case `ARN`), while the Lambda processor's
 * parameter is `LambdaArn` (mixed case) - one of the eleven literals
 * `ProcessorParameter.ParameterName` accepts.
 *
 * The floci emulator does not implement this service, so it is covered by transport
 * mocks in tests.
 */

const SERVICE: ServiceDescriptor = { service: 'firehose', signingName: 'firehose' };

/** The service's AWS-JSON target prefix; every `x-amz-target` is `${TARGET}.<Operation>`. */
const TARGET = 'Firehose_20150804';

/**
 * The stream's source type. CloudFront's vended log delivery puts records into the
 * stream directly rather than through a Kinesis stream, an MSK cluster or a database,
 * so `DirectPut` is the only correct value of the four `DeliveryStreamType` accepts.
 * Sent explicitly rather than relying on the service default, so the request states
 * the source model it depends on.
 */
const STREAM_TYPE = 'DirectPut';

/**
 * `page_views` is insert-only by design, so the stream is created append-only - the
 * analytics change spec settles this ("*The stream is created `AppendOnly`.*"), and it
 * also lets Firehose scale the stream's throughput limit automatically. It is a module
 * constant rather than a field of `IcebergDestinationInput` because this client creates
 * exactly one shape of stream and exposes no update operation that could ever set it to
 * anything else; whether the flag is even mutable after creation is unsettled between
 * two AWS documentation pages, and the node that reconciles the stream (not this client)
 * is where that question is answered.
 */
const APPEND_ONLY = true;

/** The `Processor.Type` for a record-transforming Lambda; one of six literals the field accepts. */
const LAMBDA_PROCESSOR = 'Lambda';

/** The `ProcessorParameter.ParameterName` carrying the transform function's ARN. Mixed case (`Arn`), unlike the `RoleARN`/`BucketARN`/`CatalogARN` keys. */
const LAMBDA_ARN_PARAMETER = 'LambdaArn';

/**
 * The Iceberg destination a delivery stream is created against, as a typed input
 * rather than a raw `IcebergDestinationConfiguration` object: the caller names its
 * resources in the plugin's own vocabulary and this module owns the translation to
 * the wire, which is where every AWS spelling is spelled out exactly once.
 */
export interface IcebergDestinationInput {
  /**
   * The Glue catalog ARN the S3 Tables bucket is federated into, in the
   * `arn:aws:glue:<region>:<account-id>:catalog` form the service requires
   * (`CatalogConfiguration.CatalogARN`). Firehose reads the Iceberg table through
   * this catalog, never through S3 Tables directly.
   */
  readonly catalogArn: string;
  /**
   * The delivery role Firehose assumes (`IcebergDestinationConfiguration.RoleARN`).
   * The same role is used for the error bucket's `S3Configuration.RoleARN`: the
   * analytics spec provisions one `analytics-firehose-role` granting Glue, S3 Tables,
   * Lambda invoke and the error bucket together, so a second role would have nothing
   * different to grant.
   */
  readonly roleArn: string;
  /** The Iceberg namespace holding the table, sent as `DestinationDatabaseName`. */
  readonly namespace: string;
  /** The Iceberg table records are written to, sent as `DestinationTableName`. */
  readonly tableName: string;
  /** ARN of the S3 bucket failed records are written to, as `arn:aws:s3:::<bucket>`. */
  readonly errorBucketArn: string;
  /**
   * Key prefix under `errorBucketArn` that failed records land at. Sent twice, because
   * the service has two distinct error prefixes and they are not interchangeable: the
   * stream-level `S3Configuration.ErrorOutputPrefix` covers failures that never reached
   * a table (a rejected transform, a delivery error), while the table-level
   * `DestinationTableConfiguration.S3ErrorOutputPrefix` covers records rejected by that
   * one table's schema - the dominant failure mode here, since Firehose routes every
   * record whose keys do not match the Iceberg columns to the error bucket. One prefix
   * serves both because a single stream writes to a single table.
   */
  readonly errorOutputPrefix: string;
  /** Buffer flush interval in **seconds** (`BufferingHints.IntervalInSeconds`). */
  readonly bufferIntervalSeconds: number;
  /** Buffer flush size in **MiB** (`BufferingHints.SizeInMBs`). */
  readonly bufferSizeMb: number;
  /**
   * ARN of the Lambda that transforms every record before delivery. Mandatory rather
   * than optional: CloudFront's field names are not the Iceberg column names, and
   * Firehose sends every unmatched record to the error bucket, so a stream created
   * without this processor would fail every record with nothing surfacing as an error.
   */
  readonly transformLambdaArn: string;
}

/**
 * A delivery stream's lifecycle state in this repo's vocabulary rather than the
 * service's `CREATING | CREATING_FAILED | DELETING | DELETING_FAILED | ACTIVE`
 * screaming case, so `analytics status` reports health without re-reading the raw
 * response. `unknown` covers a state the service adds later: reporting an unrecognised
 * state as unknown is honest, where mapping it onto one of the five would not be.
 */
export type DeliveryState =
  | 'creating'
  | 'create-failed'
  | 'active'
  | 'deleting'
  | 'delete-failed'
  | 'unknown';

/** The narrow view of `DescribeDeliveryStream` that `analytics status` needs. */
export interface DeliveryStreamStatus {
  readonly name: string;
  readonly arn: string;
  readonly state: DeliveryState;
  /**
   * The service's last failure detail, present only when one is reported - which the
   * API documents for a create or delete that failed on a KMS error. Absent (the key
   * is not set at all) on a healthy stream.
   */
  readonly failure?: string | undefined;
}

interface FailureDescriptionResponse {
  Type?: string;
  Details?: string;
}

interface DescribeDeliveryStreamResponse {
  DeliveryStreamDescription?: {
    DeliveryStreamName?: string;
    DeliveryStreamARN?: string;
    DeliveryStreamStatus?: string;
    FailureDescription?: FailureDescriptionResponse;
  };
}

function toDeliveryState(status: string | undefined): DeliveryState {
  switch (status) {
    case 'CREATING':
      return 'creating';
    case 'CREATING_FAILED':
      return 'create-failed';
    case 'ACTIVE':
      return 'active';
    case 'DELETING':
      return 'deleting';
    case 'DELETING_FAILED':
      return 'delete-failed';
    default:
      return 'unknown';
  }
}

/** Flatten `FailureDescription`'s `{ Type, Details }` into one printable line, or undefined when the service reported neither. */
function formatFailure(failure: FailureDescriptionResponse | undefined): string | undefined {
  const parts = [failure?.Type, failure?.Details].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? parts.join(': ') : undefined;
}

/**
 * True when a `CreateDeliveryStream` failure means the stream already exists, so a
 * re-run of the create is a no-op rather than an error.
 *
 * This predicate is local to this package deliberately. Firehose signals a duplicate
 * delivery stream with `ResourceInUseException`, and `AwsError.isAlreadyExists`
 * (`packages/core/src/aws/errors.ts:32`) tests `code` against
 * `/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i` - which that
 * name matches on none of its four alternatives. Unlike the S3 Tables gap next door in
 * `s3tables.ts`, `code` itself is correct here: Firehose is an AWS-JSON service and its
 * error body carries `{"__type":"ResourceInUseException","message":...}`, which core's
 * `parseError` reads. So this is a predicate-breadth gap, not a header-parsing one, and
 * the fix belongs here rather than in core's regex, which is shared with the site's own
 * bootstrap and would start swallowing `ResourceInUseException` on every other service.
 * `packages/core/src/aws/secretsmanager.ts:53-54` widens the same predicate the same way
 * for its own `ResourceExistsException`.
 *
 * Named for the create path rather than as a general `isAlreadyExists` because the same
 * exception means something else on delete: `DeleteDeliveryStream` answers
 * `ResourceInUseException` when the stream is still `CREATING` and therefore cannot be
 * deleted yet. Swallowing that would report a live stream as torn down, so
 * `deleteDeliveryStream` narrows on `isNotFound` only and lets this one through.
 *
 * The status code is no help either way: every one of these is HTTP 400, so
 * `statusCode` cannot separate an already-exists from a validation error the way it can
 * for S3 Tables' 409.
 */
function isStreamAlreadyExists(err: unknown): err is AwsError {
  return err instanceof AwsError && (err.isAlreadyExists || err.code === 'ResourceInUseException');
}

/** Encode `ResourceTags` as the service's `[{ Key, Value }]` tag list. */
function toTagList(tags: ResourceTags): Array<{ Key: string; Value: string }> {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

/** Translate the client's `IcebergDestinationInput` into the wire's `IcebergDestinationConfiguration`. */
function buildIcebergDestination(input: IcebergDestinationInput): object {
  return {
    RoleARN: input.roleArn,
    CatalogConfiguration: { CatalogARN: input.catalogArn },
    S3Configuration: {
      // BucketARN and RoleARN are both required members of S3DestinationConfiguration;
      // omitting either is rejected at create time.
      BucketARN: input.errorBucketArn,
      RoleARN: input.roleArn,
      ErrorOutputPrefix: input.errorOutputPrefix,
    },
    AppendOnly: APPEND_ONLY,
    BufferingHints: {
      IntervalInSeconds: input.bufferIntervalSeconds,
      SizeInMBs: input.bufferSizeMb,
    },
    // A single-element list: one stream writes to one table (the spec declines to point
    // two streams at one Iceberg table). Without this list Firehose would expect each
    // record to carry its own routing metadata, which the transform Lambda does not emit.
    DestinationTableConfigurationList: [
      {
        DestinationDatabaseName: input.namespace,
        DestinationTableName: input.tableName,
        S3ErrorOutputPrefix: input.errorOutputPrefix,
      },
    ],
    ProcessingConfiguration: {
      Enabled: true,
      Processors: [
        {
          Type: LAMBDA_PROCESSOR,
          Parameters: [
            { ParameterName: LAMBDA_ARN_PARAMETER, ParameterValue: input.transformLambdaArn },
          ],
        },
      ],
    },
  };
}

/** Amazon Data Firehose control-plane client, over the shared SigV4 transport. */
export class FirehoseClient {
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
   * Create the delivery stream with its Iceberg destination. Idempotent: a stream of
   * the same name already existing is not an error (see `isStreamAlreadyExists`). Its
   * destination is not reconciled against `destination` on that path - changing a live
   * stream's destination is `UpdateDestination`, a separate operation this client does
   * not expose, and the node that owns the stream decides between updating and
   * replacing it.
   *
   * `tags` are sent in the create request itself when non-empty, saving a round trip
   * and matching how `packages/core/src/aws/logs.ts:41` and `secretsmanager.ts:47-49`
   * tag on create. They are *not* applied on the already-exists path, because the
   * create that would have carried them failed - which is one of the reasons
   * `tagDeliveryStream` exists as its own operation.
   *
   * Returns `void`, discarding the response's `DeliveryStreamARN`: it is unavailable on
   * the already-exists path (the error body carries no ARN), so returning it from only
   * one of the two branches would be a false economy, and `describeDeliveryStream` is
   * name-keyed, so a caller that needs the ARN reads it back.
   */
  async createDeliveryStream(
    name: string,
    destination: IcebergDestinationInput,
    tags?: ResourceTags,
  ): Promise<void> {
    try {
      await this.call('CreateDeliveryStream', {
        DeliveryStreamName: name,
        DeliveryStreamType: STREAM_TYPE,
        IcebergDestinationConfiguration: buildIcebergDestination(destination),
        ...(tags && Object.keys(tags).length > 0 ? { Tags: toTagList(tags) } : {}),
      });
    } catch (err) {
      if (isStreamAlreadyExists(err)) return;
      rethrowWithContext(err, 'createDeliveryStream', name);
    }
  }

  /**
   * The stream's name, ARN and lifecycle state, with the service's last failure detail
   * when it reports one. `undefined` when no such stream exists - Firehose answers an
   * absent stream with `ResourceNotFoundException` (at HTTP 400, not 404, which is why
   * the narrowing reads the code rather than the status), mirroring
   * `packages/core/src/aws/secretsmanager.ts:78-89`.
   */
  async describeDeliveryStream(name: string): Promise<DeliveryStreamStatus | undefined> {
    try {
      const out = await this.call<DescribeDeliveryStreamResponse>('DescribeDeliveryStream', {
        DeliveryStreamName: name,
      });
      const description = out.DeliveryStreamDescription;
      const failure = formatFailure(description?.FailureDescription);
      return {
        name: description?.DeliveryStreamName ?? name,
        arn: description?.DeliveryStreamARN ?? '',
        state: toDeliveryState(description?.DeliveryStreamStatus),
        ...(failure !== undefined ? { failure } : {}),
      };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'describeDeliveryStream', name);
    }
  }

  /**
   * Delete the stream. No-op when it does not exist, so teardown is re-runnable.
   *
   * Every other failure is rethrown with context - including `ResourceInUseException`,
   * which on this operation means the stream is still `CREATING` and cannot be deleted
   * yet, not that it is already gone (see `isStreamAlreadyExists`).
   *
   * `AllowForceDelete` is deliberately not sent: it exists only to abandon a KMS grant
   * Firehose cannot retire, and this stream is created with no customer-managed key, so
   * setting it would suppress a class of failure that cannot arise here.
   */
  async deleteDeliveryStream(name: string): Promise<void> {
    try {
      await this.call('DeleteDeliveryStream', { DeliveryStreamName: name });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      rethrowWithContext(err, 'deleteDeliveryStream', name);
    }
  }

  /**
   * Add or replace tags on an existing stream. An empty map skips the call entirely
   * rather than sending an empty list: `TagDeliveryStream` requires `Tags` and rejects
   * a list of fewer than one item, so the request could only fail.
   */
  async tagDeliveryStream(name: string, tags: ResourceTags): Promise<void> {
    if (Object.keys(tags).length === 0) return;
    try {
      await this.call('TagDeliveryStream', {
        DeliveryStreamName: name,
        Tags: toTagList(tags),
      });
    } catch (err) {
      rethrowWithContext(err, 'tagDeliveryStream', name);
    }
  }
}
