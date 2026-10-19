import type { CallerIdentity } from './identity.js';
import type { SigningClient } from './signer.js';
import { textTag } from './xml.js';

/** STS client - only GetCallerIdentity, used to learn whose credentials are in use. */
export class StsClient {
  constructor(private readonly client: SigningClient) {}

  /** The account, ARN and user id the signing credentials belong to. Needs no IAM permission. */
  async getCallerIdentity(): Promise<CallerIdentity> {
    const res = await this.client.send({
      service: 'sts',
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: 'Action=GetCallerIdentity&Version=2011-06-15',
    });
    const text = res.text();
    const account = textTag(text, 'Account');
    if (!account) throw new Error('STS GetCallerIdentity returned no Account');
    return { account, arn: textTag(text, 'Arn') ?? '', userId: textTag(text, 'UserId') ?? '' };
  }

  async getAccountId(): Promise<string> {
    return (await this.getCallerIdentity()).account;
  }
}
