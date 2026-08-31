import { describe, expect, it } from 'vitest';

import { resolveEndpoint, resolveService, SIGNING_NAMES } from './endpoint.js';

describe('resolveEndpoint', () => {
  it('uses canonical hosts without an override', () => {
    expect(resolveEndpoint('s3', 'us-east-1', undefined).host).toBe('s3.us-east-1.amazonaws.com');
    expect(resolveEndpoint('logs', 'eu-west-1', undefined).host).toBe(
      'logs.eu-west-1.amazonaws.com',
    );
    expect(resolveEndpoint('microvms', 'us-east-1', undefined).host).toBe(
      'lambda.us-east-1.amazonaws.com',
    );
    // Regression anchor: microvms is served off the standard Lambda endpoint and
    // must keep signing as "lambda" - see the comment on SIGNING_NAMES.microvms.
    expect(SIGNING_NAMES.microvms).toBe('lambda');

    // A plugin-supplied descriptor for a service core does not enumerate resolves
    // the same way, under its own signing name - the analytics plugin's clients.
    expect(
      resolveEndpoint({ service: 's3tables', signingName: 's3tables' }, 'us-east-1', undefined)
        .host,
    ).toBe('s3tables.us-east-1.amazonaws.com');
    expect(
      resolveEndpoint({ service: 'firehose', signingName: 'firehose' }, 'us-east-1', undefined)
        .host,
    ).toBe('firehose.us-east-1.amazonaws.com');
    expect(
      resolveEndpoint({ service: 'glue', signingName: 'glue' }, 'us-east-1', undefined).host,
    ).toBe('glue.us-east-1.amazonaws.com');
    expect(
      resolveEndpoint({ service: 'lambda', signingName: 'lambda' }, 'us-east-1', undefined).host,
    ).toBe('lambda.us-east-1.amazonaws.com');
  });

  it('signs global services in us-east-1', () => {
    expect(resolveEndpoint('iam', 'eu-west-1', undefined)).toMatchObject({
      host: 'iam.amazonaws.com',
      signingRegion: 'us-east-1',
    });
    expect(resolveEndpoint('cloudfront', 'ap-south-1', undefined).signingRegion).toBe('us-east-1');

    // A descriptor with global: true signs in us-east-1 too, without joining
    // GLOBAL_SERVICES - it carries its own flag.
    expect(
      resolveEndpoint(
        { service: 'plugin-global', signingName: 'pluginglobal', global: true },
        'ap-south-1',
        undefined,
      ).signingRegion,
    ).toBe('us-east-1');
  });

  it('signs a descriptor without global in the region passed, not us-east-1', () => {
    expect(
      resolveEndpoint({ service: 's3tables', signingName: 's3tables' }, 'eu-west-1', undefined)
        .signingRegion,
    ).toBe('eu-west-1');
    expect(
      resolveEndpoint(
        { service: 's3tables', signingName: 's3tables', global: false },
        'eu-west-1',
        undefined,
      ).signingRegion,
    ).toBe('eu-west-1');
  });

  it('routes everything to an override origin', () => {
    const ep = resolveEndpoint('s3', 'us-east-1', 'http://localhost:4566');
    expect(ep).toMatchObject({ protocol: 'http:', host: 'localhost:4566', override: true });
  });

  it('routes a descriptor to an override origin too', () => {
    const ep = resolveEndpoint(
      { service: 's3tables', signingName: 's3tables' },
      'us-east-1',
      'http://localhost:4566',
    );
    expect(ep).toMatchObject({ protocol: 'http:', host: 'localhost:4566', override: true });
  });

  it('is undisturbed for microvms: host, signing name and signing region', () => {
    const ep = resolveEndpoint('microvms', 'us-east-1', undefined);
    expect(ep).toMatchObject({
      host: 'lambda.us-east-1.amazonaws.com',
      signingRegion: 'us-east-1',
      override: false,
    });
    expect(resolveService('microvms')).toEqual({
      name: 'microvms',
      signingName: 'lambda',
      global: false,
    });
  });
});

describe('resolveService', () => {
  it('resolves a core ServiceKey through SIGNING_NAMES and GLOBAL_SERVICES', () => {
    expect(resolveService('s3')).toEqual({ name: 's3', signingName: 's3', global: false });
    expect(resolveService('iam')).toEqual({ name: 'iam', signingName: 'iam', global: true });
  });

  it('resolves a descriptor from its own fields, defaulting global to false', () => {
    expect(resolveService({ service: 'glue', signingName: 'glue' })).toEqual({
      name: 'glue',
      signingName: 'glue',
      global: false,
    });
    expect(resolveService({ service: 'glue', signingName: 'glue', global: true })).toEqual({
      name: 'glue',
      signingName: 'glue',
      global: true,
    });
  });
});
