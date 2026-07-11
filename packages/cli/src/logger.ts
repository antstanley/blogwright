/*
 * Leveled logger and confirm prompt over the Terminal port. Messages are
 * composed with ANSI colour; the logger strips the codes for non-interactive
 * sessions (piped output, CI) so they stay plain text.
 */

import type { Terminal } from 'blogwright-core';

const ESCAPE = '\u001B';

function paint(code: string, text: string): string {
  return `${ESCAPE}[${code}m${text}${ESCAPE}[0m`;
}

/** ANSI colour helpers; {@link createLogger} strips the codes off-TTY. */
export const colors = {
  dim: (s: string) => paint('2', s),
  bold: (s: string) => paint('1', s),
  green: (s: string) => paint('32', s),
  yellow: (s: string) => paint('33', s),
  red: (s: string) => paint('31', s),
  cyan: (s: string) => paint('36', s),
};

const COLOR_CODES = new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g');

function stripColors(text: string): string {
  return text.replace(COLOR_CODES, '');
}

export interface Logger {
  info(msg: string): void;
  step(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Build the leveled logger: info/step/ok to standard output, warn/error to standard error. */
export function createLogger(terminal: Terminal): Logger {
  const render = (msg: string) => (terminal.isInteractive ? msg : stripColors(msg));
  return {
    info: (msg) => terminal.write(render(msg)),
    step: (msg) => terminal.write(render(`${colors.cyan('›')} ${msg}`)),
    ok: (msg) => terminal.write(render(`${colors.green('✓')} ${msg}`)),
    warn: (msg) => terminal.error(render(`${colors.yellow('!')} ${msg}`)),
    error: (msg) => terminal.error(render(`${colors.red('✗')} ${msg}`)),
  };
}

/**
 * Ask a yes/no question on the terminal. Returns the default for a
 * non-interactive session (CI or a piped invocation) so automation isn't left
 * hanging on a prompt.
 */
export async function confirm(
  terminal: Terminal,
  question: string,
  opts: { defaultYes?: boolean } = {},
): Promise<boolean> {
  const defaultYes = opts.defaultYes ?? true;
  if (!terminal.isInteractive) return defaultYes;
  const answer = (await terminal.question(`${question} [${defaultYes ? 'Y/n' : 'y/N'}] `))
    .trim()
    .toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}
