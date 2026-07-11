import { describe, expect, it } from 'vitest';

import { resolveEndpoint } from './endpoint.js';

describe('resolveEndpoint', () => {
  it('uses canonical hosts without an override', () => {
    expect(resolveEndpoint('s3', 'us-east-1', undefined).host).toBe('s3.us-east-1.amazonaws.com');
    expect(resolveEndpoint('logs', 'eu-west-1', undefined).host).toBe(
      'logs.eu-west-1.amazonaws.com',
    );
    expect(resolveEndpoint('microvms', 'us-east-1', undefined).host).toBe(
      'lambda.us-east-1.amazonaws.com',
    );
  });

  it('signs global services in us-east-1', () => {
    expect(resolveEndpoint('iam', 'eu-west-1', undefined)).toMatchObject({
      host: 'iam.amazonaws.com',
      signingRegion: 'us-east-1',
    });
    expect(resolveEndpoint('cloudfront', 'ap-south-1', undefined).signingRegion).toBe('us-east-1');
  });

  it('routes everything to an override origin', () => {
    const ep = resolveEndpoint('s3', 'us-east-1', 'http://localhost:4566');
    expect(ep).toMatchObject({ protocol: 'http:', host: 'localhost:4566', override: true });
  });
});
