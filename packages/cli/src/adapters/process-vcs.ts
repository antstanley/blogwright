/**
 * Process adapter for the Vcs port: shells out to jj/git. The only module
 * outside the build-agent that may import node:child_process; failures are
 * translated with the command and directory before they cross the port.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Vcs } from '../ports.js';

const run = promisify(execFile);

/** `git ls-files -z` output can exceed the 1 MiB default buffer on large repos. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

async function runVcsCommand(cwd: string, command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(command, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES });
    return stdout;
  } catch (err) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

/**
 * Build the jj/git process adapter. The revision hash prefers jj's git commit
 * id (jj auto-commits the working copy), falling back to git HEAD; listings
 * honor .gitignore — tracked files plus untracked files that are not ignored.
 */
export function createProcessVcs(): Vcs {
  return {
    async revisionHash(cwd: string): Promise<string> {
      try {
        const jjArgs = ['log', '--no-graph', '-r', '@', '-T', 'commit_id.short()'];
        const hash = (await runVcsCommand(cwd, 'jj', jjArgs)).trim();
        if (hash) return hash;
      } catch {
        /* jj unavailable or not a jj repo — fall through to git */
      }
      return (await runVcsCommand(cwd, 'git', ['rev-parse', '--short', 'HEAD'])).trim();
    },

    async listFiles(cwd: string): Promise<string[]> {
      // -z gives NUL-separated, un-quoted paths (correct for names with spaces/unicode).
      const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
      const stdout = await runVcsCommand(cwd, 'git', args);
      return stdout.split('\0').filter(Boolean);
    },
  };
}
