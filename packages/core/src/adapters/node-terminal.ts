/** Node adapter for the Terminal port (process streams + node:readline). */

import { createInterface } from 'node:readline/promises';

import type { Terminal } from '../ports.js';

/** The standard streams the adapter owns; injectable for adapter tests only. */
export interface TerminalStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  output: NodeJS.WritableStream & { isTTY?: boolean | undefined };
  errorOutput: NodeJS.WritableStream;
}

/**
 * Build the real Terminal adapter over the process's standard streams. TTY
 * state is read once, at construction — never at module load or per call.
 */
export function createNodeTerminal(streams: Partial<TerminalStreams> = {}): Terminal {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const errorOutput = streams.errorOutput ?? process.stderr;
  return {
    isInteractive: input.isTTY === true && output.isTTY === true,

    write(line: string): void {
      output.write(`${line}\n`);
    },

    error(line: string): void {
      errorOutput.write(`${line}\n`);
    },

    async question(prompt: string): Promise<string> {
      const readline = createInterface({ input, output });
      try {
        return await readline.question(prompt);
      } finally {
        readline.close();
      }
    },
  };
}
