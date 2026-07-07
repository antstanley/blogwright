import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';

const TARGET = 'secretsmanager';

export interface SecretMetadata {
  arn: string;
  name: string;
  /** Epoch seconds (fractional) of the last value change, when reported. */
  lastChangedDate?: number | undefined;
}

/** AWS Secrets Manager client (AWS JSON 1.1). */
export class SecretsManagerClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(op: string, payload: object): Promise<T> {
    const res = await this.client.send({
      service: 'secretsmanager',
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `${TARGET}.${op}`,
      },
      body: JSON.stringify(payload),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Create the secret, or update its value if it already exists. */
  async upsertSecret(name: string, value: string, description?: string): Promise<void> {
    try {
      await this.call('CreateSecret', {
        Name: name,
        SecretString: value,
        ...(description ? { Description: description } : {}),
      });
    } catch (err) {
      // Secrets Manager reports an existing secret as ResourceExistsException.
      const exists =
        err instanceof AwsError && (err.isAlreadyExists || err.code === 'ResourceExistsException');
      if (!exists) throw err;
      await this.call('PutSecretValue', { SecretId: name, SecretString: value });
    }
  }

  /** Fetch the secret's string value; undefined when the secret does not exist. */
  async getSecretValue(name: string): Promise<string | undefined> {
    try {
      const out = await this.call<{ SecretString?: string }>('GetSecretValue', {
        SecretId: name,
      });
      return out.SecretString;
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Fetch metadata (never the value); undefined when the secret does not exist. */
  async describeSecret(name: string): Promise<SecretMetadata | undefined> {
    try {
      const out = await this.call<{ ARN: string; Name: string; LastChangedDate?: number }>(
        'DescribeSecret',
        { SecretId: name },
      );
      return { arn: out.ARN, name: out.Name, lastChangedDate: out.LastChangedDate };
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return undefined;
      throw err;
    }
  }

  /** Delete immediately (no recovery window). No-op when the secret does not exist. */
  async deleteSecret(name: string): Promise<void> {
    try {
      await this.call('DeleteSecret', { SecretId: name, ForceDeleteWithoutRecovery: true });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }
}
