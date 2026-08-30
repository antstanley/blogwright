import { describe, expect, it } from 'vitest';

import { staticCredentials } from './aws/credentials.js';
import type { Transport } from './aws/signer.js';
import { createClients, type AwsClients } from './clients.js';

/**
 * The negative half of the analytics region pin. `AwsClients` gained
 * `signingUsEast1` so a plugin can build clients for services core does not
 * enumerate against us-east-1; adding it must move nothing that was already
 * signing in the configured region.
 *
 * The four clients asserted below are the ones the analytics plugin has a
 * same-named or same-signing-name counterpart for, which is where a
 * mis-repointing would land: `s3` and `secrets` because the plugin builds its
 * own pair over the us-east-1 signer, `logs` because `logsUsEast1` already sits
 * beside it, and `microvms` because it signs as `lambda` - the same signing
 * name as the plugin's transform-function client - so it is the one core client
 * a careless edit could move without the name looking wrong.
 */
const CONFIG_REGION = 'eu-west-1';

/**
 * The `<date>/<region>/<service>/aws4_request` credential scope out of a SigV4
 * `Authorization` header. `<service>` is the SIGNING name, not the service key,
 * which is what makes `microvms` worth asserting: its scope reads `lambda`.
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
 * A client bundle in {@link CONFIG_REGION} over a recording transport.
 *
 * `signedRequest()` insists on exactly one recorded request, so a call that
 * signed nothing leaves the test with an error rather than with nothing to
 * assert against.
 */
function bundle(): {
  clients: AwsClients;
  signedRequest: () => { url: string; headers: Record<string, string> };
} {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const transport: Transport = async (req) => {
    seen.push({ url: req.url, headers: req.headers });
    const body = new TextEncoder().encode('{}');
    return { statusCode: 200, headers: {}, body, text: () => '{}' };
  };
  const clients = createClients({
    region: CONFIG_REGION,
    credentials: staticCredentials({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
    transport,
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

describe('createClients', () => {
  it('signs s3 in the configured region', async () => {
    const { clients, signedRequest } = bundle();
    await clients.s3.getObjectText('example-site', 'state/production.json');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: CONFIG_REGION,
      service: 's3',
    });
  });

  it('signs logs in the configured region', async () => {
    const { clients, signedRequest } = bundle();
    await clients.logs.logGroupExists('/aws/blogwright/example');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: CONFIG_REGION,
      service: 'logs',
    });
  });

  it('signs secrets in the configured region', async () => {
    const { clients, signedRequest } = bundle();
    await clients.secrets.describeSecret('example/production/pds');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: CONFIG_REGION,
      service: 'secretsmanager',
    });
  });

  it('signs microvms in the configured region, as "lambda"', async () => {
    const { clients, signedRequest } = bundle();
    await clients.microvms.getImage('img-1');
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: CONFIG_REGION,
      service: 'lambda',
    });
  });

  it('exposes a us-east-1 signer that shares the bundle transport', async () => {
    // Same service key as the `s3` case above, so the ONLY difference between
    // the two expectations is the region - which is the whole of what
    // `signingUsEast1` adds. It is the host's own signer, so the request lands
    // on the transport this bundle was built with; a hand-built one would not.
    const { clients, signedRequest } = bundle();
    await clients.signingUsEast1.send({
      service: 's3',
      method: 'GET',
      path: '/example-site/probe',
    });
    expect(credentialScope(signedRequest().headers)).toEqual({
      region: 'us-east-1',
      service: 's3',
    });
  });
});
