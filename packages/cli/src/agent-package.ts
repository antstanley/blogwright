/**
 * Packages the build-agent artifacts (Dockerfile, bundled server.js,
 * agent-manifest.json) into a reproducible zip and uploads it to S3. Reads the
 * artifacts through the FileSystem port from the composition-root-resolved
 * `ctx.agentDir`; this module touches no Node API directly.
 */

import { zipSync, type Zippable } from 'fflate';

import type { OpsContext } from './context.js';

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
  const dir = ctx.agentDir;
  const { fs } = ctx.ports;
  let dockerfile: Uint8Array;
  let server: Uint8Array;
  let manifest: { hash?: string };
  try {
    dockerfile = await fs.readBytes(`${dir}/Dockerfile`);
    server = await fs.readBytes(`${dir}/server.js`);
    manifest = JSON.parse(await fs.readText(`${dir}/agent-manifest.json`));
  } catch {
    throw new Error(
      `build-agent artifacts not found in ${dir}. Run "pnpm --filter blogwright build" first.`,
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
