/** A structured error raised when an AWS API returns a non-2xx response. */
export class AwsError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string | undefined;
  readonly service: string;

  constructor(opts: {
    service: string;
    code: string;
    message: string;
    statusCode: number;
    requestId?: string | undefined;
  }) {
    super(`${opts.service}: ${opts.code} - ${opts.message} (HTTP ${opts.statusCode})`);
    this.name = 'AwsError';
    this.service = opts.service;
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.requestId = opts.requestId;
  }

  /** True for error codes that indicate the resource simply does not exist. */
  get isNotFound(): boolean {
    return (
      this.statusCode === 404 ||
      /NotFound|NoSuchEntity|NoSuchBucket|NoSuchKey|ResourceNotFoundException/i.test(this.code)
    );
  }

  /**
   * True when AWS refused the request for its rate: the request was rejected
   * before it was acted on, so retrying it is safe for any method - a create
   * included. See {@link THROTTLING_CODE}.
   */
  get isThrottling(): boolean {
    return this.statusCode === 429 || THROTTLING_CODE.test(this.code);
  }

  /** True for "already exists" style conflicts that bootstrap can treat as success. */
  get isAlreadyExists(): boolean {
    return /AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i.test(this.code);
  }
}

/**
 * The error codes AWS services use for a request refused for its rate, across
 * the protocols this repo speaks: CloudFront's and IAM's `Throttling` (HTTP
 * 400), the JSON services' `ThrottlingException` and `TooManyRequestsException`,
 * S3's `SlowDown` (HTTP 503), Route 53's `PriorRequestNotComplete`, and the
 * rest of the family. Matched whole, so a quota error such as
 * `LimitExceededException` - which waiting does not clear - is not retried.
 */
const THROTTLING_CODE =
  /^(?:Throttling|ThrottlingException|ThrottledException|Throttled|TooManyRequests|TooManyRequestsException|RequestLimitExceeded|RequestThrottled|RequestThrottledException|SlowDown|PriorRequestNotComplete|ProvisionedThroughputExceededException|BandwidthLimitExceeded|EC2ThrottledException)$/i;

/** True when an error is AWS refusing a request for its rate. */
export function isThrottling(err: unknown): boolean {
  return err instanceof AwsError && err.isThrottling;
}

/** True for transient errors worth retrying with backoff. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AwsError) {
    return (
      err.isThrottling ||
      err.statusCode >= 500 ||
      /InternalError|ServiceUnavailable/i.test(err.code)
    );
  }
  // Network-level failures (fetch throws TypeError) are retryable.
  return err instanceof TypeError;
}
