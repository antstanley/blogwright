/**
 * The two error-framing helpers every client in this directory shares.
 *
 * `s3tables.ts`, `firehose.ts`, `glue.ts` and `lambda.ts` each grew a
 * byte-identical private copy of both, one per task, because extracting them
 * would have meant editing a landed sibling no contract had opened. This module
 * is where that extraction lands; the four now import from here.
 *
 * **Only the framing is shared.** The four already-exists predicates stay
 * private to their own modules and must NOT be collapsed into one here - they
 * key on genuinely different signals:
 *
 * - `s3tables.ts` needs a `statusCode === 409` limb, because S3 Tables returns
 *   its error code only in an `x-amzn-ErrorType` header that core's
 *   `parseError` never reads, so `code` is `"Http409"`;
 * - `lambda.ts` needs a 409 limb for the same reason;
 * - every **Firehose** exception is HTTP 400, so on that service `code` is the
 *   only usable signal and a status limb would match nothing;
 * - **Glue** is AWS-JSON and narrows with core's `AwsError.isAlreadyExists`
 *   unmodified.
 *
 * A single status-keyed helper would therefore be silently wrong on two of the
 * four. There is a second reason not to reach for one: on both Firehose and
 * Lambda the already-exists code is *overloaded on the delete/update path* -
 * Firehose answers `DeleteDeliveryStream` with `ResourceInUseException` meaning
 * "still CREATING, cannot be deleted yet", and Lambda answers a delete or
 * update with `ResourceConflictException` meaning "another operation is in
 * progress". Reusing a create-path predicate on either would report a live
 * resource as already torn down. Each module names its predicate for the create
 * path (`isStreamAlreadyExists`, `isFunctionAlreadyExists`) for exactly that
 * reason.
 */

import { AwsError } from 'blogwright-core';

/**
 * Strip the `AwsError` constructor's own `${service}: ${code} - … (HTTP
 * ${statusCode})` framing back to the underlying AWS message, so a
 * context-prefixed rethrow does not repeat it. Not exported: it was private to
 * each of the four copies and `rethrowWithContext` is still its only caller, so
 * exporting it would leave `pnpm knip` reporting an export nothing consumes.
 */
function stripAwsFraming(err: AwsError): string {
  const prefix = `${err.service}: ${err.code} - `;
  const suffix = ` (HTTP ${err.statusCode})`;
  let message = err.message;
  if (message.startsWith(prefix)) message = message.slice(prefix.length);
  if (message.endsWith(suffix)) message = message.slice(0, -suffix.length);
  return message;
}

/**
 * Rethrow a failure that was not the expected not-found/already-exists case as
 * an `AwsError` naming the operation and the offending resource - a bucket ARN,
 * a stream, a catalog, a function - preserving the original `code`,
 * `statusCode` and `requestId` so `isNotFound` and each module's own
 * already-exists predicate still narrow it downstream. A non-`AwsError` (e.g. a
 * network-level failure) passes through unchanged.
 */
export function rethrowWithContext(err: unknown, operation: string, resource: string): never {
  if (err instanceof AwsError) {
    throw new AwsError({
      service: err.service,
      code: err.code,
      statusCode: err.statusCode,
      requestId: err.requestId,
      message: `${operation} "${resource}": ${stripAwsFraming(err)}`,
    });
  }
  throw err;
}
