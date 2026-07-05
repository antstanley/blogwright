import { AwsError } from './errors.js';
import { formEncode } from './form.js';
import type { SigningClient } from './signer.js';
import { allTags, textTag } from './xml.js';

const VERSION = '2010-05-08';

/** IAM client (query protocol) — roles with inline policies. */
export class IamClient {
  constructor(private readonly client: SigningClient) {}

  private async call(params: Record<string, string | undefined>): Promise<string> {
    const res = await this.client.send({
      service: 'iam',
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: formEncode({ ...params, Version: VERSION }),
    });
    return res.text();
  }

  /** Return the role ARN, or undefined if the role does not exist. */
  async getRoleArn(roleName: string): Promise<string | undefined> {
    try {
      const xml = await this.call({ Action: 'GetRole', RoleName: roleName });
      return textTag(xml, 'Arn');
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Create a role (idempotent) and return its ARN. */
  async ensureRole(
    roleName: string,
    assumeRolePolicy: object,
    description?: string,
  ): Promise<string> {
    try {
      const xml = await this.call({
        Action: 'CreateRole',
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
        Description: description,
      });
      const arn = textTag(xml, 'Arn');
      if (!arn) throw new Error('CreateRole returned no Arn');
      return arn;
    } catch (err) {
      if (err instanceof AwsError && err.isAlreadyExists) {
        const arn = await this.getRoleArn(roleName);
        if (arn) return arn;
      }
      throw err;
    }
  }

  async putRolePolicy(roleName: string, policyName: string, policy: object): Promise<void> {
    await this.call({
      Action: 'PutRolePolicy',
      RoleName: roleName,
      PolicyName: policyName,
      PolicyDocument: JSON.stringify(policy),
    });
  }

  async listRolePolicies(roleName: string): Promise<string[]> {
    const names: string[] = [];
    let marker: string | undefined;
    do {
      const xml = await this.call({
        Action: 'ListRolePolicies',
        RoleName: roleName,
        Marker: marker,
      });
      for (const m of allTags(xml, 'member')) names.push(m.trim());
      marker = textTag(xml, 'IsTruncated') === 'true' ? textTag(xml, 'Marker') : undefined;
    } while (marker);
    return names;
  }

  async deleteRolePolicy(roleName: string, policyName: string): Promise<void> {
    await this.call({ Action: 'DeleteRolePolicy', RoleName: roleName, PolicyName: policyName });
  }

  /** Create an OIDC identity provider (idempotent). Account-global; never deleted here. */
  async ensureOidcProvider(url: string, clientId: string, thumbprint: string): Promise<void> {
    try {
      await this.call({
        Action: 'CreateOpenIDConnectProvider',
        Url: url,
        'ClientIDList.member.1': clientId,
        'ThumbprintList.member.1': thumbprint,
      });
    } catch (err) {
      if (err instanceof AwsError && err.isAlreadyExists) return;
      throw err;
    }
  }

  /** Delete a role, first removing any inline policies. Idempotent. */
  async deleteRole(roleName: string): Promise<void> {
    try {
      for (const policy of await this.listRolePolicies(roleName)) {
        await this.deleteRolePolicy(roleName, policy);
      }
      await this.call({ Action: 'DeleteRole', RoleName: roleName });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }
}
