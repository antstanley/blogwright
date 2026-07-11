import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createNodeTerminal } from './node-terminal.js';

function ttyStream(): PassThrough & { isTTY: boolean } {
  return Object.assign(new PassThrough(), { isTTY: true });
}

function drain(stream: PassThrough): string {
  const chunk: unknown = stream.read();
  return chunk === null ? '' : String(chunk);
}

describe('createNodeTerminal', () => {
  it('writes lines to the output stream and errors to the error stream', () => {
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    const terminal = createNodeTerminal({ input: new PassThrough(), output, errorOutput });

    terminal.write('hello');
    terminal.error('boom');

    expect(drain(output)).toBe('hello\n');
    expect(drain(errorOutput)).toBe('boom\n');
  });

  it('is interactive only when both input and output are TTYs', () => {
    const both = createNodeTerminal({ input: ttyStream(), output: ttyStream() });
    const inputOnly = createNodeTerminal({ input: ttyStream(), output: new PassThrough() });
    const outputOnly = createNodeTerminal({ input: new PassThrough(), output: ttyStream() });
    const neither = createNodeTerminal({ input: new PassThrough(), output: new PassThrough() });

    expect(both.isInteractive).toBe(true);
    expect(inputOnly.isInteractive).toBe(false);
    expect(outputOnly.isInteractive).toBe(false);
    expect(neither.isInteractive).toBe(false);
  });

  it('captures TTY state at construction, not at use', () => {
    const input = ttyStream();
    const terminal = createNodeTerminal({ input, output: ttyStream() });

    input.isTTY = false;

    expect(terminal.isInteractive).toBe(true);
  });

  it('question shows the prompt and resolves with the typed line', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const terminal = createNodeTerminal({ input, output, errorOutput: new PassThrough() });

    const pending = terminal.question('Paste the URL: ');
    input.write('https://example.com/cb?code=1\n');

    await expect(pending).resolves.toBe('https://example.com/cb?code=1');
    expect(drain(output)).toContain('Paste the URL: ');
  });
});
