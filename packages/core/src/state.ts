import type { S3Client } from './aws/s3.js';

export type ResourceOutputs = Record<string, string | number | boolean | string[]>;

export interface OpsState {
  version: number;
  env: string;
  updatedAt: string | undefined;
  /** nodeId -> recorded outputs (ARNs, ids, domains). */
  resources: Record<string, ResourceOutputs>;
}

export function emptyState(env: string): OpsState {
  return { version: 1, env, updatedAt: undefined, resources: {} };
}

function stateKey(env: string): string {
  return `state/${env}.json`;
}

/**
 * S3-backed topology state. Lives at `s3://<bucket>/state/<env>.json` so it is shared
 * across machines and is the single source of truth for what has been provisioned.
 */
export class StateStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly env: string,
  ) {}

  async load(): Promise<OpsState> {
    // getObjectText returns undefined only when the object/bucket does not exist (a fresh
    // environment). A present-but-corrupt document must NOT be silently treated as empty —
    // that would cause duplicate-resource creation — so let a parse error surface.
    const text = await this.s3.getObjectText(this.bucket, stateKey(this.env));
    // Strictly undefined: a present-but-empty (zero-byte) state object is
    // corruption, not a fresh environment, and must hit the guard below.
    if (text === undefined) return emptyState(this.env);
    try {
      return JSON.parse(text) as OpsState;
    } catch (err) {
      throw new Error(
        `state/${this.env}.json in s3://${this.bucket} is not valid JSON — refusing to proceed with empty state`,
        { cause: err },
      );
    }
  }

  async save(state: OpsState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.s3.putObject(
      this.bucket,
      stateKey(this.env),
      JSON.stringify(state, null, 2),
      'application/json',
    );
  }

  async delete(): Promise<void> {
    await this.s3.deleteObject(this.bucket, stateKey(this.env)).catch(() => undefined);
  }
}
