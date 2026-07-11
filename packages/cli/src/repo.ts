/**
 * Deploy source packaging: choose the repository files to ship and build a
 * deterministic zip of them. Pure domain — the VCS listing and file contents
 * arrive through ports (see ports.ts; the process adapter owns jj/git).
 */

import { zipSync, type Zippable } from 'fflate';

import type { FileSystem } from 'blogwright-core';

import type { Ports } from './ports.js';

/** Fixed timestamp for reproducible zips (fflate requires 1980-2099). */
const ZIP_MTIME = new Date('1980-01-01T00:00:00Z');

/**
 * Filename injected into the source zip carrying the build revision. The site build
 * runs in a MicroVM from this zip (no `.git`), so `astro.config` reads the hash from
 * this file — see the repo's astro.config.mjs.
 */
export const COMMIT_FILE = '.commit-hash';

/**
 * List deployable repository files: the VCS listing minus the extra `ignore`
 * prefixes, minus tracked-but-deleted-on-disk paths (so a later read cannot
 * fail the whole zip).
 */
export async function listRepoFiles(
  ports: Ports,
  cwd: string,
  ignore: string[],
): Promise<string[]> {
  const files = await ports.vcs.listFiles(cwd);
  const kept = files.filter((f) => !ignore.some((prefix) => f === prefix || f.startsWith(prefix)));
  const present = await Promise.all(
    kept.map(async (f) => ((await ports.fs.exists(`${cwd}/${f}`)) ? f : null)),
  );
  return present.filter((f): f is string => f !== null);
}

/**
 * Build a deterministic zip of the given files (read relative to cwd). Extra entries
 * (path → text content) are added in memory — used to inject build metadata such as
 * the commit hash without touching the working tree.
 */
export async function buildRepoZip(
  fs: FileSystem,
  cwd: string,
  files: string[],
  extra: Record<string, string> = {},
): Promise<Uint8Array> {
  const entries: Zippable = {};
  for (const file of files) {
    entries[file] = await fs.readBytes(`${cwd}/${file}`);
  }
  for (const [path, content] of Object.entries(extra)) {
    entries[path] = new TextEncoder().encode(content);
  }
  return zipSync(entries, { level: 6, mtime: ZIP_MTIME });
}
