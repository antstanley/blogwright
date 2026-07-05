import type { SigningClient } from './signer.js';
import { textTag } from './xml.js';

/** STS client — only GetCallerIdentity, used to derive the account id. */
export class StsClient {
  constructor(private readonly client: SigningClient) {}

  async getAccountId(): Promise<string> {
    const res = await this.client.send({
      service: 'sts',
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: 'Action=GetCallerIdentity&Version=2011-06-15',
    });
    const account = textTag(res.text(), 'Account');
    if (!account) throw new Error('STS GetCallerIdentity returned no Account');
    return account;
  }
}
