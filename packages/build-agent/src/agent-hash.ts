import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

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
 *
 * Computed at bundle time (see write-manifest.ts) and shipped in dist/agent-manifest.json,
 * so the CLI never needs the source trees at runtime.
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
