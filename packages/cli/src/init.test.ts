import { createMemoryFileSystem, createScriptedTerminal, parseConfig } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { initSite } from './init.js';
import type { Logger } from './logger.js';

function capturingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (msg: string) => {
    lines.push(msg);
  };
  return { lines, info: push, step: push, ok: push, warn: push, error: push };
}

describe('initSite', () => {
  it('writes a commented production config from the answers', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog'],
    });
    const logger = capturingLogger();

    const code = await initSite(fs, terminal, logger, '/repo');

    expect(code).toBe(0);
    const written = await fs.readText('/repo/config/production.jsonc');
    expect(written).toContain('"siteName": "myblog"');
    expect(written).toContain('"region": "us-east-1"');
    expect(written).toContain('"domain": "blog.example.com"');
    expect(written).toContain('"githubRepo": "ant/myblog"');
    expect(logger.lines.some((l) => l.includes('Next steps'))).toBe(true);
    // The wizard's output must round-trip through the CLI's own config parser.
    const parsed = parseConfig(written);
    expect(parsed.siteName).toBe('myblog');
    expect(parsed.domain).toBe('blog.example.com');
    expect(parsed.githubRepo).toBe('ant/myblog');
  });

  it('omits optional keys left blank', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({ answers: ['myblog', 'eu-west-1', '', ''] });

    await initSite(fs, terminal, capturingLogger(), '/repo');

    const written = await fs.readText('/repo/config/production.jsonc');
    expect(written).toContain('"region": "eu-west-1"');
    expect(written).not.toContain('domain');
    expect(written).not.toContain('githubRepo');
  });

  it('re-asks until the site name is a valid slug', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({
      answers: ['My Blog!', 'myblog', '', '', ''],
    });
    const logger = capturingLogger();

    const code = await initSite(fs, terminal, logger, '/repo');

    expect(code).toBe(0);
    expect(logger.lines.some((l) => l.includes('lowercase'))).toBe(true);
    expect(await fs.readText('/repo/config/production.jsonc')).toContain('"siteName": "myblog"');
  });

  it('refuses to run non-interactively', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const logger = capturingLogger();

    const code = await initSite(createMemoryFileSystem(), terminal, logger, '/repo');

    expect(code).toBe(1);
    expect(terminal.prompts).toEqual([]);
    expect(logger.lines.some((l) => l.includes('interactive wizard'))).toBe(true);
  });

  it('refuses to overwrite an existing config', async () => {
    const fs = createMemoryFileSystem();
    await fs.writeText('/repo/config/production.jsonc', '{}');
    const logger = capturingLogger();

    const code = await initSite(fs, createScriptedTerminal(), logger, '/repo');

    expect(code).toBe(1);
    expect(await fs.readText('/repo/config/production.jsonc')).toBe('{}');
    expect(logger.lines.some((l) => l.includes('already exists'))).toBe(true);
  });
});
