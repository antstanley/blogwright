/** Node adapter for the Terminal port (process streams + node:readline). */

import { createInterface } from 'node:readline/promises';

import { stripColors } from '../colors.js';
import type { Terminal } from '../ports.js';

/** The standard streams the adapter owns; injectable for adapter tests only. */
export interface TerminalStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  output: NodeJS.WritableStream & { isTTY?: boolean | undefined };
  errorOutput: NodeJS.WritableStream;
}

export interface NodeTerminalOptions extends Partial<TerminalStreams> {
  /**
   * Force the minimal, machine-friendly presentation (`--plain`): the terminal
   * reports non-interactive, so output is plain durable lines — no colour, no
   * transient status, no prompts left hanging for automation.
   */
  plain?: boolean | undefined;
  /** Disable colour only (https://no-color.org). Defaults to the NO_COLOR env var. */
  noColor?: boolean | undefined;
}

const CLEAR_LINE = '\r\u001B[2K';

/**
 * Build the real Terminal adapter over the process's standard streams. TTY
 * state is read once, at construction — never at module load or per call.
 * The transient status line exists only on an interactive TTY; `write`/`error`
 * clear it first so durable lines never interleave with a stale status.
 */
export function createNodeTerminal(options: NodeTerminalOptions = {}): Terminal {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const plain = options.plain === true;
  const noColor = options.noColor ?? Boolean(process.env.NO_COLOR);
  const interactive = !plain && input.isTTY === true && output.isTTY === true;
  const paint = (line: string) => (noColor || plain ? stripColors(line) : line);
  let statusShown = false;

  const clearStatus = () => {
    if (!statusShown) return;
    output.write(CLEAR_LINE);
    statusShown = false;
  };

  return {
    isInteractive: interactive,

    write(line: string): void {
      clearStatus();
      output.write(`${paint(line)}\n`);
    },

    error(line: string): void {
      clearStatus();
      errorOutput.write(`${paint(line)}\n`);
    },

    status(line: string): void {
      if (!interactive) return;
      if (line === '') {
        clearStatus();
        return;
      }
      output.write(`${CLEAR_LINE}${paint(line)}`);
      statusShown = true;
    },

    async question(prompt: string): Promise<string> {
      clearStatus();
      const readline = createInterface({ input, output });
      try {
        return await readline.question(paint(prompt));
      } finally {
        readline.close();
      }
    },
  };
}
