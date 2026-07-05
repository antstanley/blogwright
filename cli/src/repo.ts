import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { zipSync, type Zippable } from 'fflate';

const run = promisify(execFile);

/** Fixed timestamp for reproducible zips (fflate requires 1980-2099). */
const ZIP_MTIME = new Date('1980-01-01T00:00:00Z');

/**
 * Resolve a stable revision hash for the current working copy. Prefers jj's git
 * commit id (jj auto-commits the working copy), falling back to git HEAD.
 */
export async function revisionHash(cwd: string): Promise<string> {
  try {
    const { stdout } = await run(
      'jj',
      ['log', '--no-graph', '-r', '@', '-T', 'commit_id.short()'],
      {
        cwd,
      },
    );
    const hash = stdout.trim();
    if (hash) return hash;
  } catch {
    /* jj not available — fall through to git */
  }
  const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  return stdout.trim();
}

/**
 * List repository files honoring .gitignore: tracked files plus untracked files that
 * are not ignored. Applies the extra `ignore` prefixes on top.
 */
export async function listRepoFiles(cwd: string, ignore: string[]): Promise<string[]> {
  // -z gives NUL-separated, un-quoted paths (correct for names with spaces/unicode).
  const { stdout } = await run(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  );
  const files = stdout.split('\0').filter(Boolean);
  const filtered = files.filter(
    (f) => !ignore.some((prefix) => f === prefix || f.startsWith(prefix)),
  );
  // Drop tracked-but-deleted-on-disk paths so a later readFile can't ENOENT the whole zip.
  const present = await Promise.all(
    filtered.map(async (f) => ((await stat(`${cwd}/${f}`).catch(() => null)) ? f : null)),
  );
  return present.filter((f): f is string => f !== null);
}

/** Build a deterministic zip of the given files (read relative to cwd). */
export async function buildRepoZip(cwd: string, files: string[]): Promise<Uint8Array> {
  const entries: Zippable = {};
  for (const file of files) {
    entries[file] = await readFile(`${cwd}/${file}`);
  }
  return zipSync(entries, { level: 6, mtime: ZIP_MTIME });
}
