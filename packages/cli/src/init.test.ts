import {
  createMemoryFileSystem,
  createScriptedTerminal,
  parseConfig,
  parseConfigDocument,
  type Plugin,
} from 'blogwright-core';
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

/**
 * Byte-for-byte pin of today's `renderConfig` output for the four core
 * answers below - the "no plugins installed" contract `initSite` must never
 * drift from. Recorded independently of the source (like `cli.test.ts`'s own
 * `EXPECTED_USAGE`), so a change to the wizard's rendered style - not just a
 * change in behaviour - fails this test.
 */
const EXPECTED_NO_PLUGIN_CONFIG =
  '// config/production.jsonc - created by `blogwright init`\n' +
  '{\n' +
  '  "region": "us-east-1",\n' +
  '  "siteName": "myblog", // stable slug in every AWS resource name - never change it\n' +
  '  "domain": "blog.example.com",\n' +
  '  "githubRepo": "ant/myblog" // enables the GitHub OIDC deploy role\n' +
  '}\n';

/**
 * Byte-for-byte pin of today's `renderConfig` output when a plugin block is
 * the LAST top-level item, with a second block ahead of it. Recorded
 * independently of the source, like `EXPECTED_NO_PLUGIN_CONFIG` above.
 *
 * Comma discipline is the whole point of pinning this, and it needs a
 * BYTE-level assertion to pin at all: `parseConfig` runs
 * `stripTrailingCommas`, so a stray comma after the last block round-trips
 * through it happily and no `expect(() => parseConfig(...)).not.toThrow()`
 * can ever see it. The two directions this kills:
 *   - `renderTopLevelItem` always appending a comma after a block puts one
 *     after `"omega"`'s closing brace, and this comparison fails;
 *   - it never appending one drops the comma after `"alpha"`'s, which
 *     `initSite`'s own pre-write `parseConfig` rejects, so the call rejects
 *     before writing anything at all.
 */
const EXPECTED_TRAILING_BLOCK_CONFIG =
  '// config/production.jsonc - created by `blogwright init`\n' +
  '{\n' +
  '  "region": "us-east-1",\n' +
  '  "siteName": "myblog", // stable slug in every AWS resource name - never change it\n' +
  '  "alpha": {\n' +
  '    "one": 1\n' +
  '  },\n' +
  '  "omega": {\n' +
  '    "two": 2 // note\n' +
  '  }\n' +
  '}\n';

/**
 * A minimal, otherwise-inert plugin declaring only an `init(io)` contributor.
 * `configKey` is required (never defaulted) so a test can build a plugin
 * with a contributor but no key to file its answers under by passing
 * `undefined` explicitly - a default parameter would not distinguish that
 * from an omitted argument, since JS substitutes the default for either.
 */
function fakeInitPlugin(
  name: string,
  init: NonNullable<Plugin['init']>,
  configKey: string | undefined,
): Plugin {
  const base = { name, description: `fake plugin "${name}"`, commands: [], init };
  return configKey === undefined ? base : { ...base, configKey };
}

describe('initSite', () => {
  it('writes a commented production config from the answers', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog'],
    });
    const logger = capturingLogger();

    const code = await initSite(fs, terminal, logger, [], '/repo');

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

  it('with no plugins installed, writes exactly the file it writes today (pinned byte-for-byte)', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog'],
    });

    const code = await initSite(fs, terminal, capturingLogger(), [], '/repo');

    expect(code).toBe(0);
    expect(await fs.readText('/repo/config/production.jsonc')).toBe(EXPECTED_NO_PLUGIN_CONFIG);
  });

  it('omits optional keys left blank', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({ answers: ['myblog', 'eu-west-1', '', ''] });

    await initSite(fs, terminal, capturingLogger(), [], '/repo');

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

    const code = await initSite(fs, terminal, logger, [], '/repo');

    expect(code).toBe(0);
    expect(logger.lines.some((l) => l.includes('lowercase'))).toBe(true);
    expect(await fs.readText('/repo/config/production.jsonc')).toContain('"siteName": "myblog"');
  });

  it('refuses to run non-interactively', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const logger = capturingLogger();

    const code = await initSite(createMemoryFileSystem(), terminal, logger, [], '/repo');

    expect(code).toBe(1);
    expect(terminal.prompts).toEqual([]);
    expect(logger.lines.some((l) => l.includes('interactive wizard'))).toBe(true);
  });

  it('refuses to overwrite an existing config', async () => {
    const fs = createMemoryFileSystem();
    await fs.writeText('/repo/config/production.jsonc', '{}');
    const logger = capturingLogger();

    const code = await initSite(fs, createScriptedTerminal(), logger, [], '/repo');

    expect(code).toBe(1);
    expect(await fs.readText('/repo/config/production.jsonc')).toBe('{}');
    expect(logger.lines.some((l) => l.includes('already exists'))).toBe(true);
  });

  it('asks each discovered plugin its own questions, in deterministic (name-sorted) order, and writes every answered block', async () => {
    const fs = createMemoryFileSystem();
    const askedOrder: string[] = [];
    const zebra = fakeInitPlugin(
      'zebra',
      async (io) => {
        askedOrder.push('zebra');
        const enabled = await io.ask({ prompt: 'enable zebra tracking?' });
        return enabled ? [{ property: `"trackingId": "${enabled}"`, comment: 'from zebra' }] : [];
      },
      'zebra',
    );
    const apple = fakeInitPlugin(
      'apple',
      async (io) => {
        askedOrder.push('apple');
        const key = await io.ask({ prompt: 'apple api key?' });
        return key ? [{ property: `"apiKey": "${key}"` }] : [];
      },
      'apple',
    );
    // Passed in discovery order (z, a) - the wizard must still ask "apple"
    // before "zebra", proving it sorts rather than trusting caller order.
    const terminal = createScriptedTerminal({
      answers: ['myblog', '', '', '', 'app-key-123', 'UA-ZEBRA'],
    });

    const code = await initSite(fs, terminal, capturingLogger(), [zebra, apple], '/repo');

    expect(code).toBe(0);
    expect(askedOrder).toEqual(['apple', 'zebra']);
    // Pins the FULL prompt sequence, not just plugin-vs-plugin order: the
    // four core questions are asked first, in their fixed order, and only
    // then "apple" (sorted before "zebra"). A reorder that asked plugin
    // questions before - or interleaved with - the core four would fail
    // this even if it also happened to keep the scripted answers lined up.
    expect(terminal.prompts).toEqual([
      'site name (lowercase slug, names every AWS resource): ',
      'AWS region [us-east-1]: ',
      'custom domain (blank to use the CloudFront domain): ',
      'GitHub repo for CI deploys, owner/repo (blank to skip): ',
      'apple api key?: ',
      'enable zebra tracking?: ',
    ]);
    const written = await fs.readText('/repo/config/production.jsonc');
    expect(written).toContain('"apple": {\n    "apiKey": "app-key-123"\n  }');
    expect(written).toContain('"zebra": {\n    "trackingId": "UA-ZEBRA" // from zebra\n  }');
    // Asserted on the PARSED value, not merely that parsing does not throw:
    // the two `toContain`s above pin the block's bytes, but bytes satisfy
    // them from anywhere in the file - nested one level down under a
    // `"plugins": { ... }` wrapper, say. Reading each block back off the
    // parsed document pins it as a top-level property under the plugin's own
    // `configKey`, carrying exactly the operator's answer (the `// from
    // zebra` comment documents the entry, it is not part of its value).
    const { raw } = parseConfigDocument(written);
    expect(raw['apple']).toEqual({ apiKey: 'app-key-123' });
    expect(raw['zebra']).toEqual({ trackingId: 'UA-ZEBRA' });
  });

  it('closes the object cleanly when a plugin block is the last top-level item, and commas the one before it (pinned byte-for-byte)', async () => {
    const fs = createMemoryFileSystem();
    // Neither contributor asks anything, so the only prompts are the four
    // core questions and the rendered file is a pure function of these two
    // blocks' position - which is what this test is pinning.
    const alpha = fakeInitPlugin('alpha', async () => [{ property: '"one": 1' }], 'alpha');
    const omega = fakeInitPlugin(
      'omega',
      async () => [{ property: '"two": 2', comment: 'note' }],
      'omega',
    );
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });

    const code = await initSite(fs, terminal, capturingLogger(), [alpha, omega], '/repo');

    expect(code).toBe(0);
    expect(await fs.readText('/repo/config/production.jsonc')).toBe(EXPECTED_TRAILING_BLOCK_CONFIG);
  });

  it('adds nothing and leaves no stray comma for a plugin that declines or carries no init contributor', async () => {
    const fs = createMemoryFileSystem();
    const declines = fakeInitPlugin('declines', async () => [], 'declines');
    const noContributor: Plugin = { name: 'silent', description: 'no init', commands: [] };
    // The same four answers `EXPECTED_NO_PLUGIN_CONFIG` was recorded for, so
    // the claim below is the strongest form of "adds nothing": a decliner and
    // a contributor-less plugin leave the file BYTE-identical to the one this
    // wizard writes with no plugins installed at all.
    const terminal = createScriptedTerminal({
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog'],
    });

    const code = await initSite(
      fs,
      terminal,
      capturingLogger(),
      [declines, noContributor],
      '/repo',
    );

    expect(code).toBe(0);
    const written = await fs.readText('/repo/config/production.jsonc');
    expect(written).not.toContain('declines');
    expect(written).not.toContain('silent');
    // Byte-exact, not `not.toMatch(/,\s*}/)`: with both plugins declining the
    // output has no block in it at all, so a trailing-comma regex here is
    // satisfied by the fixed no-plugins vector no matter what the block comma
    // discipline does. The test above pins that; this pins that a decliner
    // contributes nothing to begin with - an empty `"declines": {}` block, or
    // the comma that would precede it, fails this comparison.
    expect(written).toBe(EXPECTED_NO_PLUGIN_CONFIG);
    // No `expect(() => parseConfig(written)).not.toThrow()` here on purpose:
    // once `written` is pinned equal to a known-good constant, re-parsing it
    // is a tautology relative to the module under test - it could only ever
    // fail if `parseConfig` itself regressed, which core's own tests pin.
    // Nor is that bare form used anywhere above as the pin for `initSite`'s
    // pre-write `parseConfig` guard: output the wizard composed from VALID
    // pieces parses whether or not the guard is there, so no such assertion
    // over it can fail. What pins the guard is the LAST test in this file
    // ("never writes an unloadable config file ..."), where a plugin
    // contributes invalid JSON - delete `init.ts`'s `parseConfig(rendered)`
    // and it is the only test in the suite that fails.
  });

  it('leaves the config file unwritten when a plugin init(io) contributor throws', async () => {
    const fs = createMemoryFileSystem();
    const boom = fakeInitPlugin(
      'boom',
      async () => {
        throw new Error('kaboom');
      },
      'boom',
    );
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });

    await expect(initSite(fs, terminal, capturingLogger(), [boom], '/repo')).rejects.toThrow(
      'kaboom',
    );

    expect(await fs.exists('/repo/config/production.jsonc')).toBe(false);
  });

  it('raises naming the plugin when its init(io) contributor has no configKey to file answers under', async () => {
    const fs = createMemoryFileSystem();
    const noKey = fakeInitPlugin('nokey', async () => [{ property: '"x": true' }], undefined);
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });

    await expect(initSite(fs, terminal, capturingLogger(), [noKey], '/repo')).rejects.toThrow(
      /plugin "nokey" declares an init\(io\) contributor but no configKey/,
    );

    expect(await fs.exists('/repo/config/production.jsonc')).toBe(false);
  });

  it('never writes an unloadable config file, even when a plugin composes invalid JSON into its block', async () => {
    // Mirrors `plugin-commands.ts`'s `runGenericInit`, which re-parses its
    // spliced result before trusting it onto disk: a bug in COMPOSITION -
    // not just in a plugin's own answers - must never reach the operator as
    // a file the CLI's own parser cannot load back.
    const fs = createMemoryFileSystem();
    const broken = fakeInitPlugin(
      'broken',
      async () => [{ property: '"unterminated": {' }],
      'broken',
    );
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });

    await expect(initSite(fs, terminal, capturingLogger(), [broken], '/repo')).rejects.toThrow();

    expect(await fs.exists('/repo/config/production.jsonc')).toBe(false);
  });
});
