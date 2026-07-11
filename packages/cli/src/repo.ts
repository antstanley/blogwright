/**
 * Deploy source packaging: choose the repository files to ship and build a
 * deterministic zip of them. Pure domain — the VCS listing and file contents
 * arrive through ports (see ports.ts; the process adapter owns jj/git).
 */

import { zipSync, type Zippable } from 'fflate';

import { FileNotFoundError, type FileSystem } from 'blogwright-core';

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
  ports: Pick<Ports, 'vcs' | 'fs'>,
  cwd: string,
  ignore: string[],
  include: string[] = [],
): Promise<string[]> {
  const files = await ports.vcs.listFiles(cwd);
  // An ignore entry matches an exact path or a directory boundary — "dist"
  // drops dist and dist/**, never dist-notes.md (files silently missing from
  // the deployed site are painful to trace back to a prefix collision).
  const matches = (f: string, entry: string) => {
    const dir = entry.endsWith('/') ? entry : `${entry}/`;
    return f === entry || f.startsWith(dir);
  };
  const kept = files.filter((f) => !ignore.some((entry) => matches(f, entry)));
  const present = await Promise.all(
    kept.map(async (f) => ((await ports.fs.exists(`${cwd}/${f}`)) ? f : null)),
  );
  const all = new Set(present.filter((f): f is string => f !== null));
  for (const entry of include) {
    for (const f of await includedFiles(ports.fs, cwd, entry)) all.add(f);
  }
  return [...all];
}

/**
 * Expand one `sourceInclude` entry (gitignored pre-deploy artifacts) into
 * repo-relative files. A missing or empty path is a hard error: it means the
 * pre-deploy build (e.g. `just wasm`) did not run, and shipping without the
 * artifacts would deploy a broken site.
 */
async function includedFiles(
  fs: FileSystem,
  cwd: string,
  entry: string,
): Promise<string[]> {
  const rel = entry.replace(/\/+$/, '');
  const abs = `${cwd}/${rel}`;
  try {
    const listed = await fs.listFiles(abs);
    if (listed.length === 0) throw new FileNotFoundError(abs);
    return listed.map((f) => `${rel}/${f}`).sort();
  } catch (err) {
    if (err instanceof FileNotFoundError && (await fs.exists(abs))) return [rel]; // a single file
    throw new Error(
      `sourceInclude path "${entry}" is missing or empty — run the pre-deploy build that produces it before deploying`,
      { cause: err },
    );
  }
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
