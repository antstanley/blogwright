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
    super(`${opts.service}: ${opts.code} — ${opts.message} (HTTP ${opts.statusCode})`);
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

  /** True for "already exists" style conflicts that bootstrap can treat as success. */
  get isAlreadyExists(): boolean {
    return /AlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|Conflict/i.test(this.code);
  }
}

/** True for transient errors worth retrying with backoff. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AwsError) {
    return (
      err.statusCode >= 500 ||
      err.statusCode === 429 ||
      /Throttling|TooManyRequests|InternalError|ServiceUnavailable/i.test(err.code)
    );
  }
  // Network-level failures (fetch throws TypeError) are retryable.
  return err instanceof TypeError;
}
