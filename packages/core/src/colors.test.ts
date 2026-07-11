import { describe, expect, it } from 'vitest';

import { colors, stripColors } from './colors.js';

const ESCAPE = '\u001B';

describe('colors', () => {
  it('wraps text in the ANSI code and reset', () => {
    expect(colors.bold('Deploying')).toBe(`${ESCAPE}[1mDeploying${ESCAPE}[0m`);
    expect(colors.green('ok')).toBe(`${ESCAPE}[32mok${ESCAPE}[0m`);
  });
});

describe('stripColors', () => {
  it('removes every colour code and keeps the text', () => {
    const painted = `${colors.cyan('›')} ${colors.bold('step')} plain`;
    expect(stripColors(painted)).toBe('› step plain');
  });

  it('leaves uncoloured text untouched', () => {
    expect(stripColors('plain text, no codes')).toBe('plain text, no codes');
  });
});
