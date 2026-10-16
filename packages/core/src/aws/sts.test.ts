import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { SigningClient, type Transport } from './signer.js';
import { StsClient } from './sts.js';

const IDENTITY_XML = `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>arn:aws:sts::123456789012:assumed-role/AdminRole/ant</Arn>
    <UserId>AROAEXAMPLE:ant</UserId>
    <Account>123456789012</Account>
  </GetCallerIdentityResult>
</GetCallerIdentityResponse>`;

function stsAnswering(body: string): StsClient {
  const transport: Transport = async () => {
    const bytes = new TextEncoder().encode(body);
    return { statusCode: 200, headers: {}, body: bytes, text: () => body };
  };
  const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });
  return new StsClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

describe('StsClient', () => {
  it('reads the account, ARN and user id from GetCallerIdentity', async () => {
    expect(await stsAnswering(IDENTITY_XML).getCallerIdentity()).toEqual({
      account: '123456789012',
      arn: 'arn:aws:sts::123456789012:assumed-role/AdminRole/ant',
      userId: 'AROAEXAMPLE:ant',
    });
  });

  it('getAccountId returns the account', async () => {
    expect(await stsAnswering(IDENTITY_XML).getAccountId()).toBe('123456789012');
  });

  it('refuses a response with no Account', async () => {
    await expect(stsAnswering('<x/>').getCallerIdentity()).rejects.toThrow(
      'STS GetCallerIdentity returned no Account',
    );
  });
});
