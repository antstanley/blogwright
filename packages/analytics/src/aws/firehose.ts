import {
  AwsError,
  type ResourceTags,
  type ServiceDescriptor,
  type SigningClient,
} from 'blogwright-core';

import { rethrowWithContext } from './errors.js';

/**
 * Amazon Data Firehose control-plane client - create/describe/update-destination/delete
 * and tagging for the one delivery stream this plugin owns (the `firehose` API, AWS
 * JSON 1.1).
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
 * `UpdateDestination`, `DeleteDeliveryStream`, `TagDeliveryStream`, and the
 * `IcebergDestinationConfiguration`, `IcebergDestinationUpdate`, `CatalogConfiguration`,
 * `S3DestinationConfiguration`, `DestinationTableConfiguration`, `DeliveryStreamDescription`,
 * `DestinationDescription`, `IcebergDestinationDescription`, `BufferingHints`, `Processor`
 * and `ProcessorParameter` shapes they nest). No SDK
 * validates them here and transport-mocked tests can only assert the body this module
 * itself builds, so the reference is the only thing that catches a wrong key - and a
 * wrong key produces a silently misconfigured stream, not an error. Four spellings are
 * easy to get wrong and are pinned deliberately: the ARN-bearing keys are `RoleARN`,
 * `BucketARN` and `CatalogARN` (upper-case `ARN`), while the Lambda processor's
 * parameter is `LambdaArn` (mixed case) - one of the eleven literals
 * `ProcessorParameter.ParameterName` accepts; `UpdateDestination` names the current
 * version `CurrentDeliveryStreamVersionId`, **not** the `VersionId` that
 * `DeliveryStreamDescription` answers with (the value is the same, the key is not); and
 * `IcebergDestinationUpdate` nests its error bucket under `S3Configuration`, where every
 * other `*DestinationUpdate` in the same request body nests one under `S3Update` (see
 * {@link FirehoseClient.updateDestination}).
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
 * also lets Firehose scale the stream's throughput limit automatically.
 *
 * A module constant rather than a field of {@link IcebergDestinationInput}: this client
 * builds exactly one shape of destination, and both operations that send one -
 * `CreateDeliveryStream` and `UpdateDestination` - send this same value, so there is no
 * call site that could ever ask for anything else. Whether the flag is mutable after
 * creation is unsettled between two AWS documentation pages, and the node that
 * reconciles the stream (not this client) is where that question is answered - which is
 * why the constant is **exported**: the node compares it against the flag
 * {@link DeliveryStreamStatus.appendOnly} read back off the live stream, and a second
 * copy of the desired value in `nodes.ts` would let the two drift apart in silence.
 */
export const STREAM_APPEND_ONLY = true;

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
   * The Glue catalog ARN the S3 Tables bucket is federated into
   * (`CatalogConfiguration.CatalogARN`). Firehose reads the Iceberg table through this
   * catalog, never through S3 Tables directly.
   *
   * The field's prose names the bare `arn:aws:glue:<region>:<account-id>:catalog` form,
   * but its pattern is `arn:.*:glue:.*:\d{12}:catalog(?:(/[a-z0-9_-]+){1,2})?` - up to
   * two further segments - and an S3 Tables destination needs both of them:
   * `…:catalog/s3tablescatalog/<table-bucket>`, the child catalog the federation creates
   * per table bucket. The bare form names the account's own Data Catalog, which holds no
   * S3 Tables table at all. The stream node derives the child form; this is recorded
   * here so nobody "corrects" it back to the prose.
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
  /**
   * The CloudWatch log group Firehose writes its delivery errors into, sent as
   * `CloudWatchLoggingOptions.LogGroupName`. Firehose creates neither the group nor the
   * stream inside it, so both have to exist before a record can fail into them.
   *
   * Required rather than optional, for {@link STREAM_APPEND_ONLY}'s reason: this client
   * builds exactly one shape of destination and always enables logging, so an optional
   * field would model a call site that does not exist. A destination that quietly
   * omitted the options is the failure this field exists to remove - one where the only
   * account of an undelivered record is the record's absence.
   */
  readonly logGroupName: string;
  /**
   * The log stream inside {@link IcebergDestinationInput.logGroupName}, sent as
   * `CloudWatchLoggingOptions.LogStreamName`. Named explicitly because enabling logging
   * through the API - rather than through the console - creates neither the group nor
   * the stream, so the caller owns both names.
   */
  readonly logStreamName: string;
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

/**
 * The narrow view of `DescribeDeliveryStream` that `analytics status` needs, plus the
 * three fields {@link FirehoseClient.updateDestination} cannot be called without.
 *
 * The last four are optional and are set only when the response actually carried them.
 * `VersionId` and `Destinations` are documented as required members of
 * `DeliveryStreamDescription`, so on the service's own response model they are always
 * there - but an absent one must reach the caller as absent rather than as `''` or
 * `false`, because an empty `CurrentDeliveryStreamVersionId` fails the service's own
 * `[0-9]+` pattern and a fabricated `appendOnly: false` would make the stream node
 * replace a stream that needed nothing done to it.
 */
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
  /**
   * The stream's current configuration version, off `DeliveryStreamDescription.VersionId`.
   * `UpdateDestination` refuses to run without it (it is how the service avoids
   * conflicting merges) and calls the request key `CurrentDeliveryStreamVersionId`.
   */
  readonly versionId?: string | undefined;
  /**
   * The id of the stream's one destination, off `Destinations[0].DestinationId`.
   * `UpdateDestination` requires it and there is nowhere else to get it: it is generated
   * by the service (`destinationId-000000000001` in AWS's own example) and is not
   * derivable from anything the caller knows.
   */
  readonly destinationId?: string | undefined;
  /**
   * The live `AppendOnly` flag off `Destinations[0].IcebergDestinationDescription`.
   * Read back rather than assumed: it is what the stream node compares against
   * {@link STREAM_APPEND_ONLY} to decide whether the destination needs reconciling at
   * all. Absent for a destination that is not an Iceberg one, or for a service response
   * that omits the flag.
   */
  readonly appendOnly?: boolean | undefined;
  /**
   * Whether the live destination has CloudWatch error logging switched on, off
   * `Destinations[0].IcebergDestinationDescription.CloudWatchLoggingOptions.Enabled`.
   *
   * Read back rather than assumed, for {@link DeliveryStreamStatus.appendOnly}'s reason:
   * it is the second flag the stream node compares to decide whether the destination
   * needs reconciling, and assuming a stream this plugin created carries the
   * configuration this plugin sends today is exactly wrong for every stream created
   * before it sent this one. Absent for a destination that is not an Iceberg one, or for
   * a response that reports no logging options at all.
   */
  readonly loggingEnabled?: boolean | undefined;
}

/**
 * The current version and destination id `UpdateDestination` conditions on - the two
 * halves of {@link DeliveryStreamStatus} that a caller must have read back off the live
 * stream before it can update one. Taken as a pair rather than two positional strings
 * so a call site cannot silently transpose them: both are opaque service-generated
 * strings, so a swap would typecheck and fail only on the wire.
 */
export interface DestinationVersion {
  /** `DeliveryStreamDescription.VersionId`, sent as `CurrentDeliveryStreamVersionId`. */
  readonly versionId: string;
  /** `Destinations[].DestinationId`, sent as `DestinationId`. */
  readonly destinationId: string;
}

interface FailureDescriptionResponse {
  Type?: string;
  Details?: string;
}

interface DestinationDescriptionResponse {
  DestinationId?: string;
  IcebergDestinationDescription?: {
    AppendOnly?: boolean;
    CloudWatchLoggingOptions?: { Enabled?: boolean };
  };
}

interface DescribeDeliveryStreamResponse {
  DeliveryStreamDescription?: {
    DeliveryStreamName?: string;
    DeliveryStreamARN?: string;
    DeliveryStreamStatus?: string;
    VersionId?: string;
    Destinations?: DestinationDescriptionResponse[];
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
    AppendOnly: STREAM_APPEND_ONLY,
    // Firehose's only account of a record it could not deliver. Off by default, and
    // `IcebergDestinationConfiguration` and `IcebergDestinationUpdate` both accept the
    // member, so the one builder enables it on the create and on the reconcile alike -
    // an existing stream is switched on in place rather than replaced.
    CloudWatchLoggingOptions: {
      Enabled: true,
      LogGroupName: input.logGroupName,
      LogStreamName: input.logStreamName,
    },
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
   * stream's destination is {@link updateDestination}, a separate operation, and the
   * node that owns the stream decides between updating and replacing it.
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
      // The stream's single destination. `Destinations` is a list because the API shape
      // is shared with services that fan out; a Firehose stream has exactly one, so the
      // first element is it. `noUncheckedIndexedAccess` is why this is `undefined`-typed.
      const destination = description?.Destinations?.[0];
      const versionId = description?.VersionId;
      const destinationId = destination?.DestinationId;
      const appendOnly = destination?.IcebergDestinationDescription?.AppendOnly;
      const loggingEnabled =
        destination?.IcebergDestinationDescription?.CloudWatchLoggingOptions?.Enabled;
      return {
        name: description?.DeliveryStreamName ?? name,
        arn: description?.DeliveryStreamARN ?? '',
        state: toDeliveryState(description?.DeliveryStreamStatus),
        ...(failure !== undefined ? { failure } : {}),
        ...(versionId !== undefined ? { versionId } : {}),
        ...(destinationId !== undefined ? { destinationId } : {}),
        ...(appendOnly !== undefined ? { appendOnly } : {}),
        ...(loggingEnabled !== undefined ? { loggingEnabled } : {}),
      };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'describeDeliveryStream', name);
    }
  }

  /**
   * Reconfigure the live stream's destination in place, leaving its ARN - and therefore
   * the CloudFront log delivery pointed at it - untouched. The alternative is deleting
   * and recreating the stream, which cascades: a new stream carries a new ARN, so the
   * delivery has to be repointed, and every record in flight during the gap is lost.
   *
   * **Every failure is rethrown; nothing is swallowed here.** `ResourceInUseException`
   * on this operation is *not* the already-exists it is on `CreateDeliveryStream` (see
   * {@link isStreamAlreadyExists}) - the reference defines it here as "the resource is
   * already in use and not available for this operation", i.e. the stream is busy. So
   * `isStreamAlreadyExists` is deliberately **not** reused, and neither is any other
   * narrowing: whether a rejection means "fall back to replacing the stream" is the
   * caller's decision, not this client's, precisely because AWS's own documentation
   * contradicts itself on whether `AppendOnly` is settable after creation. Swallowing
   * anything here would turn a refused update into a silent no-op.
   *
   * Three wire details are load-bearing and each is verified against the reference:
   *
   * - the current version travels as **`CurrentDeliveryStreamVersionId`**, not as the
   *   `VersionId` that `DescribeDeliveryStream` answers with. Same value, different key;
   *   sending `VersionId` would be dropped as an unknown member and the request rejected
   *   for a missing required one.
   * - `DestinationId` is required and comes from `Destinations[].DestinationId` - the
   *   service generates it, so {@link describeDeliveryStream} is the only source.
   * - the destination is sent under **`IcebergDestinationUpdate`**, whose shape is a
   *   subset of the `IcebergDestinationConfiguration` {@link buildIcebergDestination}
   *   already builds - including, unusually, its `S3Configuration` key. Every *other*
   *   `*DestinationUpdate` in this request body renames that member to `S3Update`; the
   *   Iceberg one does not. That is why the create's builder is reused verbatim rather
   *   than a second, nearly-identical update builder being written: one builder is one
   *   place for every spelling, and the two payloads are genuinely the same object.
   *
   * The service merges what is sent with what exists when the destination type is
   * unchanged, so sending the whole destination (rather than only the changed field) is
   * both allowed and what makes this a reconcile: whatever drifted converges.
   */
  async updateDestination(
    name: string,
    destination: IcebergDestinationInput,
    current: DestinationVersion,
  ): Promise<void> {
    try {
      await this.call('UpdateDestination', {
        DeliveryStreamName: name,
        CurrentDeliveryStreamVersionId: current.versionId,
        DestinationId: current.destinationId,
        IcebergDestinationUpdate: buildIcebergDestination(destination),
      });
    } catch (err) {
      rethrowWithContext(err, 'updateDestination', name);
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
