import { describe, expect, it } from 'vitest';

import { AwsError, isRetryable, isThrottling } from './errors.js';

function error(code: string, statusCode: number): AwsError {
  return new AwsError({ service: 'test', code, message: 'm', statusCode });
}

describe('isThrottling', () => {
  it.each([
    ['Throttling', 400], // CloudFront, IAM, STS
    ['ThrottlingException', 400], // CloudWatch Logs, Glue, Firehose
    ['TooManyRequestsException', 429], // Lambda, Lambda Web Functions
    ['SlowDown', 503], // S3
    ['PriorRequestNotComplete', 400], // Route 53
    ['RequestLimitExceeded', 503],
    ['ProvisionedThroughputExceededException', 400],
    ['SomethingNew', 429], // any 429, whatever the code
  ])('treats %s (HTTP %i) as throttling', (code, status) => {
    expect(isThrottling(error(code, status))).toBe(true);
    expect(isRetryable(error(code, status))).toBe(true);
  });

  it.each([
    ['LimitExceededException', 400], // a quota: waiting does not clear it
    ['ValidationException', 400],
    ['AccessDenied', 403],
    ['TooManyInvalidationsInProgress', 400],
  ])('does not treat %s (HTTP %i) as throttling', (code, status) => {
    expect(isThrottling(error(code, status))).toBe(false);
    expect(isRetryable(error(code, status))).toBe(false);
  });

  it('is false for anything that is not an AwsError', () => {
    expect(isThrottling(new TypeError('fetch failed'))).toBe(false);
    expect(isThrottling('Throttling')).toBe(false);
  });
});

describe('isRetryable', () => {
  it('keeps retrying 5xx, internal errors and network failures', () => {
    expect(isRetryable(error('ServiceException', 500))).toBe(true);
    expect(isRetryable(error('InternalError', 400))).toBe(true);
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
  });
});
