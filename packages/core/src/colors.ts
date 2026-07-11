/*
 * ANSI colour helpers shared by the CLI and feature packages. Pure string
 * composition — writing (and stripping for non-interactive sessions) is the
 * logger's job.
 */

const ESCAPE = '\u001B';

function paint(code: string, text: string): string {
  return `${ESCAPE}[${code}m${text}${ESCAPE}[0m`;
}

/** ANSI colour helpers; loggers strip the codes off-TTY via {@link stripColors}. */
export const colors = {
  dim: (s: string) => paint('2', s),
  bold: (s: string) => paint('1', s),
  green: (s: string) => paint('32', s),
  yellow: (s: string) => paint('33', s),
  red: (s: string) => paint('31', s),
  cyan: (s: string) => paint('36', s),
};

const COLOR_CODES = new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g');

/** Remove every ANSI colour code, for piped output and CI logs. */
export function stripColors(text: string): string {
  return text.replace(COLOR_CODES, '');
}
