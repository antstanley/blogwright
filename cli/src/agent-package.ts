import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { zipSync, type Zippable } from 'fflate';

import type { OpsContext } from './context.js';

/** Resolve the build-agent package directory (overridable for tests / installs). */
function agentDir(): string {
  if (process.env.OPS_AGENT_DIR) return process.env.OPS_AGENT_DIR;
  return fileURLToPath(new URL('../../build-agent', import.meta.url));
}

const IMAGE_PACKAGE_JSON = JSON.stringify({
  name: 'iamstan-builder',
  private: true,
  type: 'module',
});

/**
 * Package the build-agent (Dockerfile + bundled server) into a zip and upload it to
 * `build/agent/agent-<hash>.zip`. The MicroVM image is then built from this artifact.
 * Requires the build-agent to have been bundled (`pnpm --filter ops-build-agent build`).
 */
export async function packageAndUploadAgent(
  ctx: OpsContext,
): Promise<{ key: string; hash: string }> {
  const dir = agentDir();
  let dockerfile: Uint8Array;
  let server: Uint8Array;
  try {
    dockerfile = await readFile(`${dir}/Dockerfile`);
    server = await readFile(`${dir}/dist/server.js`);
  } catch {
    throw new Error(
      `build-agent artifacts not found in ${dir}. Run "pnpm --filter @iamstan/ops-build-agent build" first.`,
    );
  }

  const entries: Zippable = {
    Dockerfile: dockerfile,
    'server.js': server,
    'package.json': new TextEncoder().encode(IMAGE_PACKAGE_JSON),
  };
  const zip = zipSync(entries, { level: 6, mtime: new Date('1980-01-01T00:00:00Z') });
  const hash = createHash('sha256').update(zip).digest('hex').slice(0, 12);
  const key = `build/agent/agent-${hash}.zip`;

  await ctx.clients.s3.putObject(ctx.names.bucket, key, zip, 'application/zip');
  return { key, hash };
}
