import { createClients, staticCredentials, type Transport } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { createAnalyticsClients, type AnalyticsClients } from './clients.js';

/**
 * The region a site would carry in `config.region`. Deliberately not
 * us-east-1: every assertion below would pass vacuously if it were, since the
 * host's own signer and the pinned one would be the same region.
 */
const CONFIG_REGION = 'eu-west-1';

const TABLE_BUCKET_ARN = 'arn:aws:s3tables:us-east-1:123456789012:bucket/example-analytics';

/**
 * The `<date>/<region>/<service>/aws4_request` credential scope out of a SigV4
 * `Authorization` header.
 *
 * These assertions are the ONLY place in the repo that can catch a wrong
 * `signingName` on the plugin's four clients. Mutating one changes nothing a
 * transport stub inspects - the URL, method, headers and body a client sends
 * are all unaffected - so `signingName: 'gluex'` passes the whole of
 * `glue.test.ts`. It changes exactly one observable thing: the `<service>`
 * field of this scope, which is the signing name and not the service name.
 * Reading both halves out and asserting them together is therefore a check on
 * the signing name as much as on the region pin.
 *
 * Throws rather than returning a sentinel: a request that was never signed must
 * fail the test that expected a scope, not compare unequal to one.
 */
function credentialScope(headers: Record<string, string>): { region: string; service: string } {
  const authorization = headers['authorization'];
  if (authorization === undefined) {
    throw new Error(`recorded request carried no authorization header: ${JSON.stringify(headers)}`);
  }
  const match = /Credential=[^/]+\/\d{8}\/([^/]+)\/([^/]+)\/aws4_request/.exec(authorization);
  if (!match) throw new Error(`no SigV4 credential scope in: ${authorization}`);
  return { region: match[1] as string, service: match[2] as string };
}

/**
 * Build the plugin's bundle from a host bundle in {@link CONFIG_REGION}, over a
 * transport that records what was signed.
 *
 * The context is `{ clients }` and nothing else because that is exactly what
 * `createAnalyticsClients` accepts - a `Pick` of core's `PluginContext` - so
 * standing up the rest of the SPI here would test nothing this does not.
 *
 * `signedRequest()` insists on exactly one recorded request: a client that
 * signed nothing at all would otherwise leave every assertion below with
 * nothing to compare, which is how a fixture goes vacuous.
 */
function bundle(): {
  clients: AnalyticsClients;
  signedRequest: () => { url: string; headers: Record<string, string> };
} {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const transport: Transport = async (req) => {
    seen.push({ url: req.url, headers: req.headers });
    const body = new TextEncoder().encode('{}');
    return { statusCode: 200, headers: {}, body, text: () => '{}' };
  };
  const clients = createAnalyticsClients({
    clients: createClients({
      region: CONFIG_REGION,
      credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
      transport,
    }),
  });
  return {
    clients,
    signedRequest: () => {
      if (seen.length !== 1) {
        throw new Error(`expected exactly one signed request, recorded ${seen.length}`);
      }
      return seen[0] as { url: string; headers: Record<string, string> };
    },
  };
}

describe('createAnalyticsClients', () => {
  it('signs S3 Tables in us-east-1, whatever config.region says', async () => {
    const { clients, signedRequest } = bundle();
    await clients.s3tables.getTableBucket(TABLE_BUCKET_ARN);
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 's3tables',
    });
  });

  it('signs Firehose in us-east-1, whatever config.region says', async () => {
    const { clients, signedRequest } = bundle();
    await clients.firehose.describeDeliveryStream('example-analytics');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 'firehose',
    });
  });

  it('signs Glue in us-east-1, whatever config.region says', async () => {
    const { clients, signedRequest } = bundle();
    await clients.glue.getCatalogFederation('s3tablescatalog');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 'glue',
    });
  });

  it('signs Lambda in us-east-1, whatever config.region says', async () => {
    const { clients, signedRequest } = bundle();
    await clients.lambda.getFunction('example-analytics-transform');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 'lambda',
    });
  });

  it('signs the error bucket in us-east-1, not with the host s3 client', async () => {
    // The host bundle carries an `S3Client` of its own, and lifting that one
    // onto the plugin's bundle would compile. It signs in `config.region`, so
    // reusing it would create `analytics-error-bucket` outside the pin every
    // other node in the pipeline obeys.
    const { clients, signedRequest } = bundle();
    await clients.s3.getObjectText('example-analytics-errors', 'probe');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 's3',
    });
  });

  it('signs the salt secret in us-east-1, not with the host secrets client', async () => {
    // The easy mistake, and the costliest: the host bundle's own
    // `SecretsManagerClient` would put the salt in `config.region`, out of
    // reach of the us-east-1 transform Lambda that reads it to hash
    // `visitor_key`.
    const { clients, signedRequest } = bundle();
    await clients.secrets.describeSecret('example/production/analytics-salt');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 'secretsmanager',
    });
  });
});
