/** Scripted in-memory adapter for the Terminal port, for tests. */

import type { Terminal } from '../ports.js';

/** A Terminal that captures output and answers prompts from a script. */
export interface ScriptedTerminal extends Terminal {
  /** Lines written to standard output, in order. */
  readonly writes: string[];
  /** Lines written to standard error, in order. */
  readonly errors: string[];
  /** Transient status lines, in order ('' is a clear). */
  readonly statuses: string[];
  /** Prompts shown by `question`, in order. */
  readonly prompts: string[];
}

/**
 * Build a scripted Terminal. It reports interactive unless told otherwise
 * (a scripted terminal exists to answer prompts) and hands out `answers` in
 * order; a question beyond the script throws so a test never hangs on input.
 */
export function createScriptedTerminal(
  options: { interactive?: boolean | undefined; answers?: string[] | undefined } = {},
): ScriptedTerminal {
  const pendingAnswers = [...(options.answers ?? [])];
  const writes: string[] = [];
  const errors: string[] = [];
  const statuses: string[] = [];
  const prompts: string[] = [];
  return {
    isInteractive: options.interactive ?? true,
    writes,
    errors,
    statuses,
    prompts,

    write(line: string): void {
      writes.push(line);
    },

    error(line: string): void {
      errors.push(line);
    },

    status(line: string): void {
      statuses.push(line);
    },

    async question(prompt: string): Promise<string> {
      prompts.push(prompt);
      const answer = pendingAnswers.shift();
      if (answer === undefined) {
        throw new Error(`scripted terminal has no answer left for prompt: ${prompt}`);
      }
      return answer;
    },
  };
}
