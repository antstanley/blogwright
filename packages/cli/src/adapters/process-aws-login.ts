/**
 * Process adapter for the AwsLogin port: runs the `aws` CLI with the
 * terminal attached (stdio inherited, no shell) so its browser or device-code
 * sign-in reaches the operator. A missing binary is reported as
 * `not-installed`; any other launch failure is raised with the command.
 */

import { spawn } from 'node:child_process';

import type { AwsLogin, AwsLoginResult } from '../ports.js';

/** Exit code reported for a sign-in killed by a signal, which has no numeric code. */
const SIGNALLED_EXIT_CODE = 1;

/** The slice of a child process the adapter listens to. */
interface LaunchedProcess {
  once(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
}

/** Starts `aws`; injectable so a test can drive the adapter without spawning. */
export type LaunchAws = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; shell: false },
) => LaunchedProcess;

export function createProcessAwsLogin(launch: LaunchAws = spawn): AwsLogin {
  return {
    run: (args) =>
      new Promise<AwsLoginResult>((resolve, reject) => {
        const child = launch('aws', [...args], { stdio: 'inherit', shell: false });
        child.once('error', (err) => {
          if (err.code === 'ENOENT') resolve({ ok: false, reason: 'not-installed' });
          else
            reject(
              new Error(`could not run aws ${args.join(' ')}: ${err.message}`, { cause: err }),
            );
        });
        child.once('exit', (code) => {
          if (code === 0) resolve({ ok: true });
          else resolve({ ok: false, reason: 'exit', code: code ?? SIGNALLED_EXIT_CODE });
        });
      }),
  };
}
