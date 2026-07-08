import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
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

/** Recursively collect non-test source files under `root`, labelled by their path under `prefix`. */
async function collectSource(
  root: string,
  prefix: string,
): Promise<Array<{ label: string; abs: string }>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.endsWith('.test.ts'))
    .map((e) => {
      const abs = join(e.parentPath, e.name);
      return { label: `${prefix}/${relative(root, abs).split(sep).join('/')}`, abs };
    });
}

/**
 * A hash of the agent's *source* — the build-agent package plus the ops-core it bundles,
 * and their manifests. Used to key the image artifact and decide whether the builder image
 * needs rebuilding. Deliberately NOT a hash of the bundled `server.js`: that output varies
 * by build platform/toolchain (e.g. macOS vs the Linux CI runner), so hashing it caused
 * spurious cross-platform image rebuilds. Source bytes are identical everywhere, so this is
 * reproducible. It's a superset of what's actually tree-shaken into the bundle, so an
 * unrelated ops-core change can trigger a (harmless) rebuild — an acceptable trade for
 * never shipping a stale agent.
 */
export async function agentSourceHash(dir: string): Promise<string> {
  const coreDir = join(dir, '..', 'core');
  const inputs = [
    ...(await collectSource(join(dir, 'src'), 'agent/src')),
    ...(await collectSource(join(coreDir, 'src'), 'core/src')),
    { label: 'agent/Dockerfile', abs: join(dir, 'Dockerfile') },
    { label: 'agent/package.json', abs: join(dir, 'package.json') },
    { label: 'core/package.json', abs: join(coreDir, 'package.json') },
  ].sort((a, b) => a.label.localeCompare(b.label));

  const h = createHash('sha256');
  for (const { label, abs } of inputs) {
    h.update(label);
    h.update('\0');
    h.update(await readFile(abs));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * Package the build-agent (Dockerfile + bundled server) into a zip and upload it to
 * `build/agent/agent-<hash>.zip`, where `<hash>` is the reproducible source hash. The
 * MicroVM image is then built from this artifact. Requires the build-agent to have been
 * bundled (`pnpm --filter ops-build-agent build`).
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
  // Key the artifact by the reproducible source hash rather than the (platform-dependent)
  // zip bytes, so the same source resolves to the same image across build environments.
  const hash = await agentSourceHash(dir);
  const key = `build/agent/agent-${hash}.zip`;

  await ctx.clients.s3.putObject(ctx.names.bucket, key, zip, 'application/zip');
  return { key, hash };
}
