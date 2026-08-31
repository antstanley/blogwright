import { AwsError, type ServiceDescriptor, type SigningClient } from 'blogwright-core';

import { rethrowWithContext } from './errors.js';

/**
 * AWS Lambda control-plane client for the *standard* function API - create, get,
 * update (code and configuration) and delete for the one function this plugin owns,
 * the record-transform Lambda that Firehose runs over every CloudFront log record.
 *
 * **Its relationship to core's `MicrovmsClient`
 * (`packages/core/src/aws/microvms.ts`).** The two clients share a host and a SigV4
 * signing name, and share nothing else. Both resolve to
 * `lambda.<region>.amazonaws.com` and both sign as `lambda` - Lambda MicroVMs is
 * served off the standard Lambda endpoint - and what separates them is the path
 * prefix. `MicrovmsClient` owns `/2025-09-09/` (`microvm-images`, `microvms`,
 * `auth-token`) and owns it exclusively: not one request this module issues carries
 * that prefix, which `lambda.test.ts` asserts over every recorded URL of every
 * operation. This module owns `/2015-03-31/functions`, the function API that has
 * been Lambda's since 2015. Neither module's `PATHS` table can collide with the
 * other's, and neither needs to know the other exists at runtime.
 *
 * It lives in `blogwright-analytics`, not in core: core's `SIGNING_NAMES` gains no
 * `lambda` key (`microvms` is already keyed there and maps to the `lambda` signing
 * name), and every request here signs through the `{ service: 'lambda', signingName:
 * 'lambda' }` descriptor the plugin transport seam accepts (see
 * `packages/core/src/aws/endpoint.ts`'s `ServiceDescriptor`), which resolves to the
 * canonical `lambda.<region>.amazonaws.com` host through `canonicalHost`'s default
 * `${service}.${region}.amazonaws.com` branch.
 *
 * Protocol: REST-JSON - a method and a path per operation with
 * `content-type: application/json`, the shape `packages/core/src/aws/microvms.ts`
 * and `s3tables.ts` next door use, not the AWS-JSON `POST /` + `x-amz-target` of the
 * `firehose.ts` and `glue.ts` siblings. Methods and paths below are verified
 * operation by operation against the Lambda API reference; two of them are easy to
 * get wrong and are pinned by their own tests:
 *
 * - The deployment package is nested as `Code.ZipFile` in `CreateFunction`'s body
 *   but is a **top-level** `ZipFile` in `UpdateFunctionCode`'s. The two operations
 *   do not share a body shape, and a create-shaped body sent to `/code` would set no
 *   code at all.
 * - `GetFunction`'s response nests the function's configuration under
 *   `Configuration` (beside `Code`, `Tags` and `Concurrency`), while
 *   `CreateFunction`, `UpdateFunctionCode` and `UpdateFunctionConfiguration` return a
 *   `FunctionConfiguration` at the top level. Reading `FunctionArn` off the root of a
 *   `GetFunction` response yields `undefined`, not an error.
 *
 * `Qualifier` is deliberately never sent, so every operation addresses the
 * unpublished `$LATEST` version. Nothing in this pipeline publishes a version or an
 * alias, and `Publish` is likewise never sent: a published version would freeze code
 * and configuration that the transform-function node reconciles in place.
 *
 * **Error regime (rest-json, header-only exception names).** This service is in the
 * same regime as the `s3tables.ts` sibling and not the `firehose.ts`/`glue.ts` ones.
 * Lambda puts the exception name in an `x-amzn-ErrorType` header and its request id
 * in `x-amzn-RequestId`, and its error *body* carries at most `{"Type": ...,
 * "message": ...}` - where `Type` is the category, `"User"` or `"Service"`, never the
 * exception name, and is absent altogether on the unmodelled failures. Core's `parseError` (`packages/core/src/aws/signer.ts`) reads a code from the
 * body alone (`__type`/`code`/`Code`), so for every Lambda failure `AwsError.code`
 * arrives as `"Http<status>"` and `AwsError.requestId` is always `undefined`. Probed
 * against the live endpoint, not read off a documentation page: an unauthenticated
 * `GET https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/<name>` answers
 * `403` with `x-amzn-errortype: MissingAuthenticationTokenException`,
 * `x-amzn-requestid: <uuid>` and a body of exactly
 * `{"message":"Missing Authentication Token"}`.
 *
 * The status code is what survives, and unlike S3 Tables' single generic
 * `ConflictException` the statuses here are genuinely discriminating - each of the
 * two this client narrows on belongs to exactly one exception:
 *
 * | status | exception                     | meaning on this client's operations |
 * | ------ | ----------------------------- | ----------------------------------- |
 * | 404    | `ResourceNotFoundException`   | the function is absent - *except on create*, where it is the execution role (or a layer, or a code-signing config) that is absent |
 * | 409    | `ResourceConflictException`   | "already exists" on create; "another operation is in progress" on update and delete |
 * | 412    | `PreconditionFailedException` | a `RevisionId` mismatch; unreachable here, no `RevisionId` is ever sent |
 * | 400    | `InvalidParameterValueException`, `CodeStorageExceededException`, `CodeVerificationFailedException`, `InvalidCodeSignatureException` | |
 * | 429    | `TooManyRequestsException`    | |
 * | 500    | `ServiceException`            | |
 *
 * So `AwsError.isNotFound` works on this service through its `statusCode === 404`
 * limb (its `code` regex never matches `"Http404"`), while `isAlreadyExists` matches
 * nothing at all and `isFunctionAlreadyExists` below bridges the gap. Both
 * overloadings in the table above are load-bearing and are handled where they arise:
 * see `createFunction` for the 404 one and `deleteFunction` for the 409 one.
 *
 * The durable fix is core-level and deliberately not made here (this task must not
 * touch `packages/core`): `parseError` should read `x-amzn-errortype` and
 * `x-amzn-requestid` from the headers it already receives, which would hand this
 * client a real exception name and a request id to quote to AWS support. It is
 * recorded as a follow-up in the plan's open questions and would subsume both this
 * module's 409 limb and `s3tables.ts`'s.
 *
 * The floci emulator does not implement this service, so it is covered by transport
 * mocks in tests.
 */

const SERVICE: ServiceDescriptor = { service: 'lambda', signingName: 'lambda' };

/**
 * The standard Lambda function API's date prefix. Distinct from
 * `packages/core/src/aws/microvms.ts`'s `API = '/2025-09-09'`, which that module owns
 * and this one never emits.
 */
const API = '/2015-03-31';

const PATHS = {
  functions: `${API}/functions`,
  // The function name is percent-encoded into its path segment the way
  // `microvms.ts:17` encodes an image id. Lambda's own name pattern would not need
  // it, but the encoding is what keeps a caller-supplied name inside its segment
  // rather than letting it address a different operation.
  function: (name: string) => `${API}/functions/${encodeURIComponent(name)}`,
  functionCode: (name: string) => `${API}/functions/${encodeURIComponent(name)}/code`,
  functionConfiguration: (name: string) =>
    `${API}/functions/${encodeURIComponent(name)}/configuration`,
};

/**
 * The only `PackageType` this client deploys. Sent explicitly on create rather than
 * relying on the service default, so the request states the packaging model its
 * `Code.ZipFile` and its `Handler`/`Runtime` depend on - the same call `firehose.ts`
 * makes for `DeliveryStreamType`.
 */
const PACKAGE_TYPE = 'Zip';

/**
 * The version-specific settings shared by `CreateFunction` and
 * `UpdateFunctionConfiguration` - the two operations that carry exactly these keys,
 * one nested in a create body and one as the whole body of the configuration PUT.
 * Expressed once so the pair cannot drift.
 */
export interface FunctionConfigurationInput {
  /** ARN of the function's execution role (`Role`). */
  readonly roleArn: string;
  /** Runtime identifier, e.g. `nodejs22.x` (`Runtime`). */
  readonly runtime: string;
  /** Entry point, `<file>.<export>` for a Node runtime (`Handler`). */
  readonly handler: string;
  /** Memory available to the function in **MB** (`MemorySize`; 128-32768, any multiple of 1 MB). */
  readonly memoryMb: number;
  /** Maximum run time in **seconds** (`Timeout`; the service caps it at 900). */
  readonly timeoutSeconds: number;
  /**
   * Environment variables (`Environment.Variables`). Absent and empty mean different
   * things to the service on an update and are sent differently: omitting the key
   * leaves the function's existing variables untouched, while an explicit map
   * replaces them wholesale - so an empty map *clears* them.
   */
  readonly environment?: Record<string, string> | undefined;
}

/** Everything `CreateFunction` needs on top of the shared configuration. */
export interface CreateFunctionInput extends FunctionConfigurationInput {
  /** The function's name (`FunctionName`), also the name every other operation addresses it by. */
  readonly name: string;
  /**
   * The deployment package as raw zip bytes, sent inline. This client base64-encodes
   * them into the wire's blob member itself - that translation is its concern, not
   * its callers'. Inline rather than an S3 code location because Lambda requires the
   * code bucket to sit in the function's own region while the site's bucket is in
   * `config.region` and this function is pinned to us-east-1; the node that reads the
   * bundle owns the size guard against the inline-payload limit.
   */
  readonly zipFile: Uint8Array;
}

/**
 * A function's lifecycle state in this repo's vocabulary rather than the service's
 * mixed case, mirroring how `firehose.ts` maps `DeliveryStreamStatus`. It is not
 * decoration: a function that exists but is `failed` is not something the
 * transform-function node should adopt as reconciled (the pipeline would then route
 * every record to the error bucket with nothing surfacing as an error), and an update
 * against a `pending` function is answered with a 409. `unknown` covers a state the
 * service adds later - reporting an unrecognised state as unknown is honest, where
 * mapping it onto one of the eight would not be.
 */
export type FunctionState =
  | 'pending'
  | 'active'
  | 'inactive'
  | 'failed'
  | 'deactivating'
  | 'deactivated'
  | 'active-non-invocable'
  | 'deleting'
  | 'unknown';

/** The narrow view of `GetFunction` the transform-function node needs. */
export interface LambdaFunction {
  readonly name: string;
  /** The function's ARN (`Configuration.FunctionArn`). Empty string when the service reports none. */
  readonly arn: string;
  readonly state: FunctionState;
}

interface FunctionConfigurationResponse {
  FunctionName?: string;
  FunctionArn?: string;
  State?: string;
}

/**
 * `GetFunction`'s response envelope. Note `Configuration` - the function's settings
 * are nested here, unlike the create and update responses which return a
 * `FunctionConfiguration` at the top level.
 *
 * `Code.Location` (a presigned download URL), `Tags` and `Concurrency` also come back
 * and are deliberately dropped. So is `Configuration.CodeSha256`: it digests the
 * *built zip*, and DEVELOPMENT.md §Repository hygiene requires the deployment
 * decision to turn on a hash of the *source* (task 43's), so surfacing it here would
 * offer the transform-function node exactly the wrong gate.
 */
interface GetFunctionResponse {
  Configuration?: FunctionConfigurationResponse;
}

function toFunctionState(state: string | undefined): FunctionState {
  switch (state) {
    case 'Pending':
      return 'pending';
    case 'Active':
      return 'active';
    case 'Inactive':
      return 'inactive';
    case 'Failed':
      return 'failed';
    case 'Deactivating':
      return 'deactivating';
    case 'Deactivated':
      return 'deactivated';
    case 'ActiveNonInvocable':
      return 'active-non-invocable';
    case 'Deleting':
      return 'deleting';
    default:
      return 'unknown';
  }
}

/**
 * Map `GetFunction`'s response onto the domain value. A 200 is the existence signal:
 * `Configuration` is optional in the service model, but a 200 carrying none is
 * neither documented nor observed, so an absent field falls back rather than
 * inventing a second "does not exist" answer next to `ResourceNotFoundException` -
 * the same call `glue.ts`'s `normalizeCatalog` and `s3tables.ts`'s `normalizeTable`
 * make.
 */
function normalizeFunction(out: GetFunctionResponse, fallbackName: string): LambdaFunction {
  const configuration = out.Configuration;
  return {
    name: configuration?.FunctionName ?? fallbackName,
    arn: configuration?.FunctionArn ?? '',
    state: toFunctionState(configuration?.State),
  };
}

/** Encode the deployment package for the wire's blob member; the one place the base64 step is spelled out. */
function encodeZip(zipFile: Uint8Array): string {
  return Buffer.from(zipFile).toString('base64');
}

/**
 * Build the version-specific settings shared by `CreateFunction` and
 * `UpdateFunctionConfiguration`. `Environment` is omitted entirely when the input
 * carries none, which on the update path leaves the function's existing variables
 * alone; an explicit map (empty included) is sent as `{ Variables }` and replaces
 * them.
 */
function configurationBody(input: FunctionConfigurationInput): object {
  return {
    Role: input.roleArn,
    Runtime: input.runtime,
    Handler: input.handler,
    MemorySize: input.memoryMb,
    Timeout: input.timeoutSeconds,
    ...(input.environment !== undefined ? { Environment: { Variables: input.environment } } : {}),
  };
}

/**
 * True when a `CreateFunction` failure means the function already exists, so a re-run
 * of the create is a no-op rather than an error.
 *
 * The `statusCode === 409` limb is what actually does the work, and it is not
 * belt-and-braces. Lambda answers a duplicate function name with
 * `ResourceConflictException`, whose only status is 409 and which is the only Lambda
 * exception at 409 - but the name never reaches `AwsError.code`, because it travels
 * in the `x-amzn-ErrorType` header and core's `parseError` reads the body alone (see
 * the module doc comment). So `code` is `"Http409"`, `AwsError.isAlreadyExists` -
 * which tests `code` against `/AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i`
 * - matches nothing, and a create written against it alone would report every
 * re-bootstrap as a failure. This is a header-parsing gap and not, as in
 * `firehose.ts`, a predicate-breadth one: `ResourceConflictException` *would* match
 * core's regex on its `Conflict` alternative the day `parseError` learns to read the
 * header, which is why `isAlreadyExists` is kept as the first limb rather than
 * replaced.
 *
 * Named for the create path rather than as a general `isAlreadyExists` because the
 * same exception means something else on every other operation. The service documents
 * it as "the resource already exists, **or another operation is in progress**": on
 * `DeleteFunction` a 409 means the function is mid-update and cannot be deleted yet,
 * and on the two update operations it means a previous update has not finished. This
 * predicate is applied to `createFunction` and nowhere else, so those three surface
 * as failures instead of being reported as a torn-down or reconciled function.
 */
function isFunctionAlreadyExists(err: unknown): err is AwsError {
  return err instanceof AwsError && (err.isAlreadyExists || err.statusCode === 409);
}

/** AWS Lambda function client, over the shared SigV4 transport. */
export class LambdaClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(method: string, path: string, payload?: object): Promise<T> {
    const res = await this.client.send({
      service: SERVICE,
      method,
      path,
      headers: { 'content-type': 'application/json' },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Create the function with its code and configuration in one request. Idempotent:
   * a function of the same name already existing is not an error (see
   * `isFunctionAlreadyExists`). Its code and configuration are *not* reconciled
   * against `input` on that path - that is what `updateFunctionCode` and
   * `updateFunctionConfiguration` are for, and the node that owns the function
   * decides between them on its recorded source hash.
   *
   * A 404 is deliberately **not** swallowed here even though `getFunction` and
   * `deleteFunction` read one as absence. On this operation
   * `ResourceNotFoundException` does not mean "no such function" - the function is
   * the thing being created - it means the execution role in `roleArn` does not
   * exist. Treating it as success would report a function that was never created,
   * the same asymmetry `glue.ts`'s `createCatalogFederation` documents for
   * `EntityNotFoundException`.
   *
   * Returns `void`, discarding the response's `FunctionArn`: it is unavailable on the
   * already-exists path (the error body carries no ARN), so returning it from only
   * one of the two branches would be a false economy. A caller needing the ARN either
   * reads it back with `getFunction` - the call it made before creating anyway - or
   * builds the fixed `arn:aws:lambda:<region>:<account-id>:function:<name>` form from
   * what a `PluginContext` already carries, exactly as `s3tables.ts`'s
   * `createTableBucket` argues.
   *
   * Tags are not accepted. The transform-function node does not tag the function, and
   * tagging it later is `TagResource`, a separate operation this client can grow when
   * a node needs it, rather than a parameter carried unused today.
   */
  async createFunction(input: CreateFunctionInput): Promise<void> {
    try {
      await this.call('POST', PATHS.functions, {
        FunctionName: input.name,
        PackageType: PACKAGE_TYPE,
        // Nested under `Code` here; `UpdateFunctionCode` takes the same bytes as a
        // top-level `ZipFile` instead.
        Code: { ZipFile: encodeZip(input.zipFile) },
        ...configurationBody(input),
      });
    } catch (err) {
      if (isFunctionAlreadyExists(err)) return;
      rethrowWithContext(err, 'createFunction', input.name);
    }
  }

  /**
   * The function's name, ARN and lifecycle state; `undefined` when no such function
   * exists, so the transform-function node's `read` reports absence without throwing
   * and its `create` runs instead. Lambda answers an absent function with
   * `ResourceNotFoundException` at HTTP 404, which `AwsError.isNotFound` matches on
   * its status limb.
   */
  async getFunction(name: string): Promise<LambdaFunction | undefined> {
    try {
      const out = await this.call<GetFunctionResponse>('GET', PATHS.function(name));
      return normalizeFunction(out, name);
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      rethrowWithContext(err, 'getFunction', name);
    }
  }

  /**
   * Replace the function's deployment package. The zip bytes go on the wire as a
   * **top-level** `ZipFile`, not nested under `Code` the way `CreateFunction` takes
   * them - the two operations do not share a body shape.
   *
   * Nothing is swallowed. A 409 here means a previous update has not finished, not
   * that the code is already what was sent, and a 404 means the function is gone -
   * both are the node's to see.
   */
  async updateFunctionCode(name: string, zipFile: Uint8Array): Promise<void> {
    try {
      await this.call('PUT', PATHS.functionCode(name), { ZipFile: encodeZip(zipFile) });
    } catch (err) {
      rethrowWithContext(err, 'updateFunctionCode', name);
    }
  }

  /**
   * Replace the function's version-specific settings - role, runtime, handler, memory,
   * timeout and environment. The name travels in the path, never in the body, which
   * is why this takes it as a separate argument rather than reusing
   * `CreateFunctionInput`.
   *
   * Nothing is swallowed, for the same reasons as `updateFunctionCode`.
   */
  async updateFunctionConfiguration(
    name: string,
    input: FunctionConfigurationInput,
  ): Promise<void> {
    try {
      await this.call('PUT', PATHS.functionConfiguration(name), configurationBody(input));
    } catch (err) {
      rethrowWithContext(err, 'updateFunctionConfiguration', name);
    }
  }

  /**
   * Delete the function and every version and alias of it. No-op when it does not
   * exist, so teardown is re-runnable.
   *
   * Every other failure is rethrown with context - including the 409
   * `ResourceConflictException`, which on this operation means the function is
   * mid-operation and cannot be deleted yet, not that it is already gone. Swallowing
   * it (by reusing `isFunctionAlreadyExists` here) would report a live function as
   * torn down, leaving the Firehose stream pointing at a processor the teardown
   * claimed to have removed.
   */
  async deleteFunction(name: string): Promise<void> {
    try {
      await this.call('DELETE', PATHS.function(name));
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      rethrowWithContext(err, 'deleteFunction', name);
    }
  }
}
