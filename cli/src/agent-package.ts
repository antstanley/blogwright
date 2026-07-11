import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { zipSync, type Zippable } from 'fflate';

import type { OpsContext } from './context.js';

/**
 * Resolve the directory holding the build-agent artifacts — Dockerfile, bundled
 * server.js, and agent-manifest.json — copied into this package by its build
 * (scripts/copy-agent.mjs). Overridable for tests via OPS_AGENT_DIR.
 */
function agentDir(): string {
  if (process.env.OPS_AGENT_DIR) return process.env.OPS_AGENT_DIR;
  return fileURLToPath(new URL('../agent', import.meta.url));
}

const IMAGE_PACKAGE_JSON = JSON.stringify({
  name: 'site-builder',
  private: true,
  type: 'module',
});

/**
 * Package the build-agent (Dockerfile + bundled server) into a zip and upload it to
 * `build/agent/agent-<hash>.zip`. `<hash>` is the reproducible source hash stamped
 * into agent-manifest.json when the agent was bundled — a hash of the agent's
 * *source*, not the bundle, because bundle bytes vary by build platform/toolchain
 * while source bytes are identical everywhere. The MicroVM image is then built from
 * this artifact and keyed by the same hash, so identical source never rebuilds.
 */
export async function packageAndUploadAgent(
  ctx: OpsContext,
): Promise<{ key: string; hash: string }> {
  const dir = agentDir();
  let dockerfile: Uint8Array;
  let server: Uint8Array;
  let manifest: { hash?: string };
  try {
    dockerfile = await readFile(`${dir}/Dockerfile`);
    server = await readFile(`${dir}/server.js`);
    manifest = JSON.parse(await readFile(`${dir}/agent-manifest.json`, 'utf8'));
  } catch {
    throw new Error(
      `build-agent artifacts not found in ${dir}. Run "pnpm --filter @iamstan/ops-cli build" first.`,
    );
  }
  const hash = manifest.hash;
  if (!hash || !/^[0-9a-f]{12}$/.test(hash)) {
    throw new Error(`agent-manifest.json in ${dir} has no valid hash — rebuild the agent`);
  }

  const entries: Zippable = {
    Dockerfile: dockerfile,
    'server.js': server,
    'package.json': new TextEncoder().encode(IMAGE_PACKAGE_JSON),
  };
  const zip = zipSync(entries, { level: 6, mtime: new Date('1980-01-01T00:00:00Z') });
  const key = `build/agent/agent-${hash}.zip`;

  await ctx.clients.s3.putObject(ctx.names.bucket, key, zip, 'application/zip');
  return { key, hash };
}
