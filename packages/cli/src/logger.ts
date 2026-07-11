/* Minimal leveled logger with ANSI colour when attached to a TTY. */

import { createInterface } from 'node:readline/promises';

const isTty = process.stdout.isTTY === true;

function paint(code: string, text: string): string {
  return isTty ? `[${code}m${text}[0m` : text;
}

export const colors = {
  dim: (s: string) => paint('2', s),
  bold: (s: string) => paint('1', s),
  green: (s: string) => paint('32', s),
  yellow: (s: string) => paint('33', s),
  red: (s: string) => paint('31', s),
  cyan: (s: string) => paint('36', s),
};

export interface Logger {
  info(msg: string): void;
  step(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(): Logger {
  return {
    info: (msg) => console.log(msg),
    step: (msg) => console.log(`${colors.cyan('›')} ${msg}`),
    ok: (msg) => console.log(`${colors.green('✓')} ${msg}`),
    warn: (msg) => console.warn(`${colors.yellow('!')} ${msg}`),
    error: (msg) => console.error(`${colors.red('✗')} ${msg}`),
  };
}

/**
 * Ask a yes/no question on the terminal. Returns the default when there's no TTY (CI or a
 * piped invocation) so automation isn't left hanging on a prompt.
 */
export async function confirm(
  question: string,
  opts: { defaultYes?: boolean } = {},
): Promise<boolean> {
  const defaultYes = opts.defaultYes ?? true;
  if (process.stdin.isTTY !== true) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [${defaultYes ? 'Y/n' : 'y/N'}] `))
      .trim()
      .toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
