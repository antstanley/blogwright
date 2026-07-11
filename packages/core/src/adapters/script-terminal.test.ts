import { describe, expect, it } from 'vitest';

import { createScriptedTerminal, type ScriptedTerminal } from './script-terminal.js';

describe('createScriptedTerminal', () => {
  it('captures output and error lines separately, in order', () => {
    const terminal: ScriptedTerminal = createScriptedTerminal();

    terminal.write('one');
    terminal.error('oops');
    terminal.write('two');

    expect(terminal.writes).toEqual(['one', 'two']);
    expect(terminal.errors).toEqual(['oops']);
  });

  it('answers questions from the script and records the prompts', async () => {
    const terminal = createScriptedTerminal({ answers: ['first', 'second'] });

    await expect(terminal.question('a? ')).resolves.toBe('first');
    await expect(terminal.question('b? ')).resolves.toBe('second');
    expect(terminal.prompts).toEqual(['a? ', 'b? ']);
  });

  it('throws instead of hanging when the script runs out of answers', async () => {
    const terminal = createScriptedTerminal({ answers: [] });

    await expect(terminal.question('anyone? ')).rejects.toThrow(
      'scripted terminal has no answer left for prompt: anyone? ',
    );
  });

  it('records transient status lines, including clears', () => {
    const terminal = createScriptedTerminal();

    terminal.status('working… 3s');
    terminal.status('');

    expect(terminal.statuses).toEqual(['working… 3s', '']);
  });

  it('defaults to interactive and honours an explicit non-interactive option', () => {
    expect(createScriptedTerminal().isInteractive).toBe(true);
    expect(createScriptedTerminal({ interactive: false }).isInteractive).toBe(false);
  });
});
