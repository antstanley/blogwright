import {
  AwsCredentialsError,
  createClients,
  createMemoryFileSystem,
  createScriptedTerminal,
  parseConfig,
  parseConfigDocument,
  type Plugin,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { initSite } from './init.js';
import type { Logger } from './logger.js';
import { createRecordingAwsLogin, TEST_HOME, testAwsAccess } from './test-support.js';

/** Writes under `/repo`; no shared AWS files, so the profile question is skipped. */
const INIT_OPTIONS = { root: '/repo', aws: testAwsAccess()() };

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
 * Byte-for-byte pin of the `ssr` block for Astro, followed by a plugin block:
 * the block renders between the core entries and the plugin blocks, with the
 * comma discipline the other pins hold.
 */
const EXPECTED_ASTRO_SSR_CONFIG =
  '// config/production.jsonc - created by `blogwright init`\n' +
  '{\n' +
  '  "region": "us-east-1",\n' +
  '  "siteName": "myblog", // stable slug in every AWS resource name - never change it\n' +
  '  "ssr": {\n' +
  '    "packageDir": "dist", // all of dist/: the adapter looks for server/\n' +
  '    "entryPoint": "server/entry.mjs",\n' +
  '    "shim": { "host": "HOST", "port": "PORT" }, // generated entry shim: the server reads HOST and PORT\n' +
  '    "staticDir": "dist/client",\n' +
  '    "staticPaths": ["/_astro/*", "/favicon.svg", "/robots.txt"]\n' +
  '  },\n' +
  '  "alpha": {\n' +
  '    "one": 1\n' +
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
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog', '', 'n'],
    });
    const logger = capturingLogger();

    const code = await initSite(fs, terminal, logger, [], INIT_OPTIONS);

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
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog', '', 'n'],
    });

    const code = await initSite(fs, terminal, capturingLogger(), [], INIT_OPTIONS);

    expect(code).toBe(0);
    expect(await fs.readText('/repo/config/production.jsonc')).toBe(EXPECTED_NO_PLUGIN_CONFIG);
  });

  it('omits optional keys left blank', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({ answers: ['myblog', 'eu-west-1', '', '', '', 'n'] });

    await initSite(fs, terminal, capturingLogger(), [], INIT_OPTIONS);

    const written = await fs.readText('/repo/config/production.jsonc');
    expect(written).toContain('"region": "eu-west-1"');
    expect(written).not.toContain('domain');
    expect(written).not.toContain('githubRepo');
  });

  it('re-asks until the site name is a valid slug', async () => {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({
      answers: ['My Blog!', 'myblog', '', '', '', '', 'n'],
    });
    const logger = capturingLogger();

    const code = await initSite(fs, terminal, logger, [], INIT_OPTIONS);

    expect(code).toBe(0);
    expect(logger.lines.some((l) => l.includes('lowercase'))).toBe(true);
    expect(await fs.readText('/repo/config/production.jsonc')).toContain('"siteName": "myblog"');
  });

  it('refuses to run non-interactively', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const logger = capturingLogger();

    const code = await initSite(createMemoryFileSystem(), terminal, logger, [], INIT_OPTIONS);

    expect(code).toBe(1);
    expect(terminal.prompts).toEqual([]);
    expect(logger.lines.some((l) => l.includes('interactive wizard'))).toBe(true);
  });

  it('refuses to overwrite an existing config', async () => {
    const fs = createMemoryFileSystem();
    await fs.writeText('/repo/config/production.jsonc', '{}');
    const logger = capturingLogger();

    const code = await initSite(fs, createScriptedTerminal(), logger, [], INIT_OPTIONS);

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
      answers: ['myblog', '', '', '', '', 'n', 'app-key-123', 'UA-ZEBRA'],
    });

    const code = await initSite(fs, terminal, capturingLogger(), [zebra, apple], INIT_OPTIONS);

    expect(code).toBe(0);
    expect(askedOrder).toEqual(['apple', 'zebra']);
    // Pins the FULL prompt sequence, not just plugin-vs-plugin order: the
    // four core questions and the SSR question are asked first, in their
    // fixed order, and only then "apple" (sorted before "zebra"). A reorder that asked plugin
    // questions before - or interleaved with - the core four would fail
    // this even if it also happened to keep the scripted answers lined up.
    expect(terminal.prompts).toEqual([
      'site name (lowercase slug, names every AWS resource): ',
      'AWS region [us-east-1]: ',
      'custom domain (blank to use the CloudFront domain): ',
      'GitHub repo for CI deploys, owner/repo (blank to skip): ',
      'server-rendered (SSR) app on a Lambda Web Function? (y/n) [n]: ',
      'Detect the AWS account and pin it to this config? [Y/n] ',
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
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', '', '', 'n'] });

    const code = await initSite(fs, terminal, capturingLogger(), [alpha, omega], INIT_OPTIONS);

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
      answers: ['myblog', '', 'blog.example.com', 'ant/myblog', '', 'n'],
    });

    const code = await initSite(
      fs,
      terminal,
      capturingLogger(),
      [declines, noContributor],
      INIT_OPTIONS,
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
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', '', '', 'n'] });

    await expect(initSite(fs, terminal, capturingLogger(), [boom], INIT_OPTIONS)).rejects.toThrow(
      'kaboom',
    );

    expect(await fs.exists('/repo/config/production.jsonc')).toBe(false);
  });

  it('raises naming the plugin when its init(io) contributor has no configKey to file answers under', async () => {
    const fs = createMemoryFileSystem();
    const noKey = fakeInitPlugin('nokey', async () => [{ property: '"x": true' }], undefined);
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', '', '', 'n'] });

    await expect(initSite(fs, terminal, capturingLogger(), [noKey], INIT_OPTIONS)).rejects.toThrow(
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
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', '', '', 'n'] });

    await expect(
      initSite(fs, terminal, capturingLogger(), [broken], INIT_OPTIONS),
    ).rejects.toThrow();

    expect(await fs.exists('/repo/config/production.jsonc')).toBe(false);
  });
});

describe('initSite server-rendered sites', () => {
  async function initSsr(answers: string[]) {
    const fs = createMemoryFileSystem();
    const terminal = createScriptedTerminal({ answers });
    const logger = capturingLogger();
    const code = await initSite(fs, terminal, logger, [], INIT_OPTIONS);
    const written = await fs.readText('/repo/config/production.jsonc');
    return { code, written, terminal, logger };
  }

  it.each([
    ['astro', 'dist', 'server/entry.mjs', { host: 'HOST', port: 'PORT' }, 'dist/client'],
    ['sveltekit', 'build', 'index.js', { host: 'HOST', port: 'PORT' }, 'build/client'],
    [
      'nuxt',
      '.output/server',
      'index.mjs',
      { host: 'NITRO_HOST', port: 'NITRO_PORT' },
      '.output/public',
    ],
    [
      'tanstack-start',
      '.output/server',
      'index.mjs',
      { host: 'NITRO_HOST', port: 'NITRO_PORT' },
      '.output/public',
    ],
    ['nextjs', '.next/standalone', 'server.js', { host: 'HOSTNAME', port: 'PORT' }, undefined],
  ])(
    'writes the %s ssr block with its generated entry shim',
    async (name, packageDir, entryPoint, shim, staticDir) => {
      const { code, written } = await initSsr(['myblog', '', '', '', 'y', name, 'n']);

      expect(code).toBe(0);
      const ssr = parseConfig(written).ssr;
      expect(ssr?.packageDir).toBe(packageDir);
      expect(ssr?.entryPoint).toBe(entryPoint);
      expect(ssr?.shim).toEqual(shim);
      expect(ssr?.staticDir).toBe(staticDir);
    },
  );

  it('renders the ssr block between the core entries and plugin blocks (pinned byte-for-byte)', async () => {
    const fs = createMemoryFileSystem();
    const alpha = fakeInitPlugin('alpha', async () => [{ property: '"one": 1' }], 'alpha');
    const terminal = createScriptedTerminal({
      answers: ['myblog', '', '', '', 'yes', 'Astro', 'n'],
    });

    const code = await initSite(fs, terminal, capturingLogger(), [alpha], INIT_OPTIONS);

    expect(code).toBe(0);
    expect(await fs.readText('/repo/config/production.jsonc')).toBe(EXPECTED_ASTRO_SSR_CONFIG);
  });

  it('writes the defaults with no shim for another framework', async () => {
    const { written, logger } = await initSsr(['myblog', '', '', '', 'y', 'other', 'n']);

    const ssr = parseConfig(written).ssr;
    expect(ssr?.packageDir).toBe('dist');
    expect(ssr?.entryPoint).toBe('index.js');
    expect(ssr?.shim).toBeUndefined();
    expect(written).toContain('add "shim" unless it listens on AWS_LAMBDA_HTTP_ENDPOINT');
    expect(logger.lines).toContain(
      'set up the build for your framework: ' +
        'https://blogwright.iamstan.dev/guides/server-rendered-sites/#the-entry-shim',
    );
  });

  it("points the next steps at the framework's recipe", async () => {
    const { logger } = await initSsr(['myblog', '', '', '', 'y', 'nextjs', 'n']);

    expect(logger.lines).toContain(
      'set up the build for Next.js (standalone output): ' +
        'https://blogwright.iamstan.dev/guides/server-rendered-sites/#nextjs-standalone-output',
    );
  });

  it('writes no ssr block for a static site', async () => {
    const { written, terminal } = await initSsr(['myblog', '', '', '', 'n', 'n']);

    expect(written).not.toContain('ssr');
    expect(terminal.prompts.some((p) => p.startsWith('framework'))).toBe(false);
  });

  it('re-asks an answer that is not yes or no, and a framework it does not know', async () => {
    const { code, written, logger } = await initSsr([
      'myblog',
      '',
      '',
      '',
      'maybe',
      'y',
      'remix',
      'nuxt',
      'n',
    ]);

    expect(code).toBe(0);
    expect(logger.lines).toContain('answer y or n');
    expect(logger.lines.some((l) => l.startsWith('expected astro, sveltekit'))).toBe(true);
    expect(parseConfig(written).ssr?.shim).toEqual({ host: 'NITRO_HOST', port: 'NITRO_PORT' });
  });

  it('re-asks the region when it has no Lambda Web Functions', async () => {
    const { code, written, terminal, logger } = await initSsr([
      'myblog',
      'eu-central-1',
      '',
      '',
      'y',
      'astro',
      'eu-central-1',
      'eu-west-1',
      'n',
    ]);

    expect(code).toBe(0);
    expect(logger.lines.some((l) => l.includes('available in us-east-1, us-east-2'))).toBe(true);
    expect(terminal.prompts.filter((p) => p === 'AWS region [us-east-1]: ')).toHaveLength(3);
    expect(parseConfig(written).region).toBe('eu-west-1');
  });
});

describe('initSite AWS profile and account pin', () => {
  const ACCOUNT = '012345678901';
  const PROFILES = '[default]\nregion = us-east-1\n[profile mysite-prod]\nsso_session = s\n';

  function identityXml(): string {
    return (
      '<GetCallerIdentityResponse><GetCallerIdentityResult>' +
      `<Arn>arn:aws:sts::${ACCOUNT}:assumed-role/AdminRole/ant</Arn>` +
      `<UserId>AROA:ant</UserId><Account>${ACCOUNT}</Account>` +
      '</GetCallerIdentityResult></GetCallerIdentityResponse>'
    );
  }

  /** Init over shared files and a scripted STS: `sts` answers each attempt, in order. */
  async function initAws(setup: {
    answers: string[];
    sharedConfig?: string;
    profile?: string;
    processEnv?: NodeJS.ProcessEnv;
    sts?: ('identity' | 'credentials-fail')[];
  }) {
    const fs = createMemoryFileSystem(
      setup.sharedConfig === undefined ? {} : { [`${TEST_HOME}/.aws/config`]: setup.sharedConfig },
    );
    const terminal = createScriptedTerminal({ answers: setup.answers });
    const logger = capturingLogger();
    const sts = [...(setup.sts ?? ['identity'])];
    const built: { profile: string | null | undefined; endpoint: string | undefined }[] = [];
    const transport: Transport = async () => {
      const text = identityXml();
      return {
        statusCode: 200,
        headers: {},
        body: new TextEncoder().encode(text),
        text: () => text,
      };
    };
    const awsLogin = createRecordingAwsLogin();
    const access = testAwsAccess({
      awsLogin,
      host: {
        processEnv: setup.processEnv ?? {},
        createClients: (opts) => {
          built.push({ profile: opts.profile, endpoint: opts.endpointOverride });
          return createClients({
            ...opts,
            transport,
            credentials: async () => {
              if (sts.shift() === 'credentials-fail') {
                throw new AwsCredentialsError(new Error('Token has expired and refresh failed'));
              }
              return { accessKeyId: 'AKIA', secretAccessKey: 'secret' };
            },
          });
        },
      },
    })();
    const code = await initSite(fs, terminal, logger, [], {
      root: '/repo',
      aws: { ...access, profile: setup.profile },
    });
    const written = await fs.readText('/repo/config/production.jsonc');
    return { code, written, terminal, logger, built, awsLogin };
  }

  const PROFILE_PROMPT = 'AWS profile for this environment (blank for default credentials)';
  const PROFILE_PROMPT_WITH_DEFAULT =
    'AWS profile for this environment ("none" for default credentials)';
  const PIN_PROMPT = 'Detect the AWS account and pin it to this config? [Y/n] ';

  it('skips the profile question when no profiles are defined, and writes no aws block when declined', async () => {
    const { code, written, terminal } = await initAws({ answers: ['myblog', '', '', '', '', 'n'] });

    expect(code).toBe(0);
    expect(terminal.prompts.some((p) => p.startsWith(PROFILE_PROMPT))).toBe(false);
    expect(terminal.prompts.at(-1)).toBe(PIN_PROMPT);
    expect(written).not.toContain('"aws"');
  });

  it('asks for a profile after the SSR question, defaulting to --profile, and re-asks an unknown one', async () => {
    const { written, terminal, logger } = await initAws({
      sharedConfig: PROFILES,
      profile: 'mysite-prod',
      answers: ['myblog', '', '', '', '', 'nope', '', 'n'],
    });

    expect(terminal.prompts.slice(4)).toEqual([
      'server-rendered (SSR) app on a Lambda Web Function? (y/n) [n]: ',
      `${PROFILE_PROMPT_WITH_DEFAULT} [mysite-prod]: `,
      `${PROFILE_PROMPT_WITH_DEFAULT} [mysite-prod]: `,
      PIN_PROMPT,
    ]);
    expect(logger.lines).toContain(
      'no profile "nope" - expected one of default, mysite-prod, or "none"',
    );
    expect(parseConfig(written).aws).toEqual({ profile: 'mysite-prod' });
    expect(written).toContain('  "aws": {\n    "profile": "mysite-prod"\n  }\n}');
  });

  it('defaults the profile to AWS_PROFILE when there is no --profile', async () => {
    const { terminal } = await initAws({
      sharedConfig: PROFILES,
      processEnv: { AWS_PROFILE: 'default' },
      answers: ['myblog', '', '', '', '', '', 'n'],
    });

    expect(terminal.prompts).toContain(`${PROFILE_PROMPT_WITH_DEFAULT} [default]: `);
  });

  it('chooses default credentials with "none" when a default is offered', async () => {
    const { written } = await initAws({
      sharedConfig: PROFILES,
      profile: 'mysite-prod',
      answers: ['myblog', '', '', '', '', 'none', 'n'],
    });

    expect(parseConfig(written).aws).toBeUndefined();
  });

  it('drops a suggested profile the files do not define, so blank still means default credentials', async () => {
    const { code, written, terminal, logger } = await initAws({
      sharedConfig: PROFILES,
      processEnv: { AWS_PROFILE: 'old-project' },
      answers: ['myblog', '', '', '', '', '', 'n'],
    });

    expect(code).toBe(0);
    expect(terminal.prompts).toContain(`${PROFILE_PROMPT}: `);
    expect(logger.lines).toContain(
      'profile "old-project" from AWS_PROFILE is not in your AWS config files - not offering it as the default',
    );
    expect(parseConfig(written).aws).toBeUndefined();
  });

  it('pins the detected account through the chosen profile, rendering a block that parses', async () => {
    const { code, written, logger, built } = await initAws({
      sharedConfig: PROFILES,
      answers: ['myblog', '', '', '', '', 'mysite-prod', 'y'],
    });

    expect(code).toBe(0);
    expect(built).toEqual([{ profile: 'mysite-prod', endpoint: undefined }]);
    expect(logger.lines).toContain(`AWS account ${ACCOUNT} (AdminRole) - pinned as aws.accountId`);
    expect(written).toContain(
      '  "aws": {\n' +
        '    "profile": "mysite-prod",\n' +
        `    "accountId": "${ACCOUNT}" // deploys refuse credentials for any other account\n` +
        '  }\n}',
    );
    expect(parseConfig(written).aws).toEqual({ profile: 'mysite-prod', accountId: ACCOUNT });
  });

  it('commas the aws block when a plugin block follows it', async () => {
    const fs = createMemoryFileSystem();
    const alpha = fakeInitPlugin('alpha', async () => [{ property: '"one": 1' }], 'alpha');
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', '', '', 'y'] });
    const access = testAwsAccess({
      host: {
        createClients: (opts) =>
          createClients({
            ...opts,
            credentials: async () => ({ accessKeyId: 'A', secretAccessKey: 'B' }),
            transport: async () => {
              const text = identityXml();
              return {
                statusCode: 200,
                headers: {},
                body: new TextEncoder().encode(text),
                text: () => text,
              };
            },
          }),
      },
    })();

    await initSite(fs, terminal, capturingLogger(), [alpha], { root: '/repo', aws: access });

    const written = await fs.readText('/repo/config/production.jsonc');
    expect(written).toContain(
      `"accountId": "${ACCOUNT}" // deploys refuse credentials for any other account\n  },\n  "alpha"`,
    );
    expect(parseConfigDocument(written).raw['alpha']).toEqual({ one: 1 });
  });

  it('does not offer detection while AWS_ENDPOINT_URL is set: the pin must be a real account', async () => {
    const { code, built, terminal, logger } = await initAws({
      processEnv: { AWS_ENDPOINT_URL: 'http://localhost:4566' },
      answers: ['myblog', '', '', '', ''],
    });

    expect(code).toBe(0);
    expect(built).toEqual([]);
    expect(terminal.prompts).not.toContain(PIN_PROMPT);
    expect(logger.lines).toEqual(
      expect.arrayContaining([
        'AWS_ENDPOINT_URL is set, so the AWS account cannot be detected',
        'account not pinned - add aws.accountId later',
      ]),
    );
  });

  it('passes no endpoint override to the session', async () => {
    const { built } = await initAws({ answers: ['myblog', '', '', '', '', 'y'] });

    expect(built).toEqual([{ profile: null, endpoint: undefined }]);
  });

  it('warns and carries on, unpinned, when the account cannot be detected', async () => {
    const { code, written, logger } = await initAws({
      sharedConfig: PROFILES,
      sts: ['credentials-fail'],
      answers: ['myblog', '', '', '', '', 'mysite-prod', 'y', '3'],
    });

    expect(code).toBe(0);
    expect(logger.lines).toContain('account not pinned - add aws.accountId later');
    expect(parseConfig(written).aws).toEqual({ profile: 'mysite-prod' });
  });

  it('offers a sign-in when detection hits expired credentials, then pins', async () => {
    const { written, terminal, awsLogin } = await initAws({
      sharedConfig: PROFILES,
      sts: ['credentials-fail', 'identity'],
      answers: ['myblog', '', '', '', '', 'mysite-prod', '', ''],
    });

    expect(terminal.prompts.at(-1)).toBe('choice [1]: ');
    // testAwsAccess's host is Linux with no display, so the device-code flow.
    expect(awsLogin.calls).toEqual([
      ['sso', 'login', '--profile', 'mysite-prod', '--use-device-code'],
    ]);
    expect(parseConfig(written).aws?.accountId).toBe(ACCOUNT);
  });
});
