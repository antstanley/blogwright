import { colors, createScriptedTerminal } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { confirm, createLogger } from './logger.js';

const ESCAPE = '\u001B';

describe('createLogger', () => {
  it('keeps ANSI colour on an interactive terminal', () => {
    const terminal = createScriptedTerminal({ interactive: true });
    const logger = createLogger(terminal);

    logger.info(colors.bold('Deploying'));
    logger.step('zipping');
    logger.ok('done');

    expect(terminal.writes).toEqual([
      `${ESCAPE}[1mDeploying${ESCAPE}[0m`,
      `${ESCAPE}[36m›${ESCAPE}[0m zipping`,
      `${ESCAPE}[32m✓${ESCAPE}[0m done`,
    ]);
  });

  it('strips ANSI colour for a non-interactive terminal', () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const logger = createLogger(terminal);

    logger.info(colors.bold('Deploying'));
    logger.step('zipping');
    logger.ok('done');

    expect(terminal.writes).toEqual(['Deploying', '› zipping', '✓ done']);
  });

  it('routes warn and error to the error stream, coloured on a TTY', () => {
    const terminal = createScriptedTerminal({ interactive: true });
    const logger = createLogger(terminal);

    logger.warn('careful');
    logger.error('broken');

    expect(terminal.writes).toEqual([]);
    expect(terminal.errors).toEqual([
      `${ESCAPE}[33m!${ESCAPE}[0m careful`,
      `${ESCAPE}[31m✗${ESCAPE}[0m broken`,
    ]);
  });

  it('routes warn and error to the error stream, plain when piped', () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const logger = createLogger(terminal);

    logger.warn('careful');
    logger.error('broken');

    expect(terminal.errors).toEqual(['! careful', '✗ broken']);
  });
});

describe('confirm', () => {
  it('returns true for a yes answer and shows the default in the prompt', async () => {
    const terminal = createScriptedTerminal({ answers: ['y'] });

    await expect(confirm(terminal, 'Continue?')).resolves.toBe(true);
    expect(terminal.prompts).toEqual(['Continue? [Y/n] ']);
  });

  it('returns false for a no answer', async () => {
    const terminal = createScriptedTerminal({ answers: ['n'] });

    await expect(confirm(terminal, 'Continue?')).resolves.toBe(false);
  });

  it('returns the default for an empty answer', async () => {
    await expect(confirm(createScriptedTerminal({ answers: [''] }), 'Continue?')).resolves.toBe(
      true,
    );
    await expect(
      confirm(createScriptedTerminal({ answers: [''] }), 'Continue?', { defaultYes: false }),
    ).resolves.toBe(false);
  });

  it('treats anything other than y/yes as no', async () => {
    const terminal = createScriptedTerminal({ answers: ['nope'] });

    await expect(confirm(terminal, 'Continue?')).resolves.toBe(false);
  });

  it('returns the default without prompting on a non-interactive terminal', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    await expect(confirm(terminal, 'Continue?')).resolves.toBe(true);
    await expect(confirm(terminal, 'Continue?', { defaultYes: false })).resolves.toBe(false);
    expect(terminal.prompts).toEqual([]);
  });
});
