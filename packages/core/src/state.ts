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

/** Namespace shape a plugin manifest declares - reused here so a scope can't smuggle a `/` or `..` into the key. */
const SCOPE_PATTERN = /^[a-z0-9-]+$/;

function stateKey(env: string, scope?: string): string {
  return scope === undefined ? `state/${env}.json` : `state/${env}.${scope}.json`;
}

/**
 * S3-backed topology state: the single source of truth for what has been provisioned.
 *
 * An unscoped store (three constructor arguments) keys `s3://<bucket>/state/<env>.json`.
 * This is on-disk identity for every environment that already exists - it must never move,
 * or every existing site's state becomes unreadable.
 *
 * A store scoped to a plugin (the fourth argument) keys
 * `s3://<bucket>/state/<env>.<plugin>.json` instead, so a plugin's resources are recorded
 * separately from the site's: `blogwright <plugin> destroy` never touches, and never
 * discards, the site's own record of what exists.
 *
 * Scoping changes the key, not the bucket - a scoped and an unscoped store for the same
 * environment are constructed over the same `names.bucket` (see
 * `packages/cli/src/context.ts:134`) and both objects live side by side under that
 * bucket's `state/` prefix. That prefix is not itself a safety boundary: the site's own
 * bucket node empties it wholesale before deleting the bucket
 * (`deletePrefix(ctx.names.bucket, '')`, `packages/cli/src/nodes.ts:66`), which would take
 * every `state/<env>.<plugin>.json` with it. Keeping the two records genuinely independent
 * is therefore a CLI-level policy, not something this class enforces: `blogwright destroy`
 * is expected to refuse while any `state/<env>.<plugin>.json` exists, naming that plugin's
 * `blogwright <plugin> destroy --yes`, so plugins are always torn down before the site that
 * hosts them. `StateStore` itself is a store, not a policy - it does not add that guard.
 */
export class StateStore {
  private readonly key: string;

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly env: string,
    scope?: string,
  ) {
    if (scope !== undefined && !SCOPE_PATTERN.test(scope)) {
      throw new Error(
        `state store scope must be lowercase alphanumeric/dashes, got "${scope}" for s3://${bucket}`,
      );
    }
    this.key = stateKey(env, scope);
  }

  async load(): Promise<OpsState> {
    // getObjectText returns undefined only when the object/bucket does not exist (a fresh
    // environment). A present-but-corrupt document must NOT be silently treated as empty -
    // that would cause duplicate-resource creation - so let a parse error surface.
    const text = await this.s3.getObjectText(this.bucket, this.key);
    // Strictly undefined: a present-but-empty (zero-byte) state object is
    // corruption, not a fresh environment, and must hit the guard below.
    if (text === undefined) return emptyState(this.env);
    try {
      return JSON.parse(text) as OpsState;
    } catch (err) {
      throw new Error(
        `${this.key} in s3://${this.bucket} is not valid JSON - refusing to proceed with empty state`,
        { cause: err },
      );
    }
  }

  async save(state: OpsState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.s3.putObject(
      this.bucket,
      this.key,
      JSON.stringify(state, null, 2),
      'application/json',
    );
  }

  async delete(): Promise<void> {
    await this.s3.deleteObject(this.bucket, this.key).catch(() => undefined);
  }
}
