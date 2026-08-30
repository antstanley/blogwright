/**
 * OWNERSHIP: this file and `plugin-commands.ts` are created by task 10,
 * which is their sole author for the whole plan - see that module's own
 * comment. Tasks 13, 16 and 17 extend BOTH files with cases for the generic
 * `init` action, the generic `bootstrap`/`status`/`destroy` lifecycle verbs
 * and `blogwright plugin list`, respectively; none of the three depends on
 * either of the others, so this file must not be re-created by any of them.
 *
 * These are UNIT-level tests of `runPlugin`/`toPluginContext`, called
 * directly with hand-built `positionals`/`values` rather than through
 * `main`'s `argv` parsing - `cli.test.ts`'s "main - generic plugin dispatch"
 * block covers the same behaviour end to end, through `main`, as the
 * integration layer. Fixtures (`buildDiscoveryPorts`, `makeFakePlugin`,
 * `RecordedRun`) live in `test-support.ts`, shared with `cli.test.ts` - both
 * files are owned by this task, so they carry one definition rather than
 * two near-identical copies.
 */

import {
  createNodeFileSystem,
  createScriptedTerminal,
  findRepoRoot,
  parseConfig,
  parseConfigDocument,
  type Plugin,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { cliPackageDir, type ContextOptions, type OpsContext } from './context.js';
import { createLogger } from './logger.js';
import { runPlugin, toPluginContext, type PluginValues } from './plugin-commands.js';
import { discover } from './plugins.js';
import {
  buildDiscoveryPorts,
  createTestContext,
  makeFakePlugin,
  type RecordedRun,
} from './test-support.js';

/**
 * The real repo root `buildDiscoveryPorts` resolves its fixture `fs` around
 * (see that function's own doc comment) - a test seeding an additional
 * config file on top of that fixture (task 13's generic `init` cases) needs
 * the same value to build the same path, rather than a test-local constant
 * that would not match what `runPlugin`'s own (non-injectable) `findRepoRoot`
 * call resolves to.
 */
async function realRepoRoot(): Promise<string> {
  return findRepoRoot(createNodeFileSystem());
}

/** Every `PluginValues` field at its parsed-but-unset default. */
const BASE_VALUES: PluginValues = {
  env: undefined,
  domain: undefined,
  config: undefined,
  endpoint: undefined,
  hash: undefined,
  id: undefined,
  identifier: undefined,
  plain: false,
  refresh: false,
  yes: false,
  help: false,
};

/** A ContextFactory over `createTestContext`. */
function testContextFactory(terminal: ReturnType<typeof createScriptedTerminal>): {
  makeContext: (opts: ContextOptions) => Promise<OpsContext>;
  contexts: OpsContext[];
} {
  const contexts: OpsContext[] = [];
  const makeContext = async (opts: ContextOptions): Promise<OpsContext> => {
    const ctx = createTestContext({
      env: opts.env,
      ports: opts.ports,
      logger: createLogger(terminal),
    });
    contexts.push(ctx);
    return ctx;
  };
  return { makeContext, contexts };
}

describe('runPlugin', () => {
  it('dispatches a single-word action, defaulting the environment to "production"', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'fake',
      ['sync'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      { action: 'sync', ctx: expect.objectContaining({ env: 'production' }), args: [] },
    ]);
  });

  it('matches the longest declared action ("secret status" over the bare "secret") and passes the remaining args and flags through', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'fake',
      ['secret', 'status', 'staging'],
      { ...BASE_VALUES, identifier: 'alice.example', yes: true },
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe('secret status');
    expect(calls[0]?.ctx.env).toBe('staging');
    expect(calls[0]?.args).toEqual(['--identifier', 'alice.example', '--yes']);
  });

  it('lets --env override a positional environment', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'fake',
      ['sync', 'staging'],
      { ...BASE_VALUES, env: 'canary' },
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(calls[0]?.ctx.env).toBe('canary');
  });

  it('propagates a plugin command failure by rejecting, rather than swallowing it into a return code', async () => {
    // Refusal-shaped exit codes (unknown plugin/action) come from `runPlugin`
    // itself and are deliberately non-throwing; a plugin's OWN command
    // failing is not translated into a return code at all - it propagates
    // exactly like every built-in command's own refusals do (e.g.
    // `destroy` without `--yes` throws through `main` to `bin.ts`'s
    // top-level catch), so `run` reporting failure is never mistaken for
    // `run` succeeding.
    const terminal = createScriptedTerminal({ interactive: false });
    const plugin: Plugin = {
      name: 'fake',
      description: 'a fake plugin for dispatch tests',
      commands: [
        {
          action: 'sync',
          summary: 'sync it',
          run: async () => {
            throw new Error('sync failed');
          },
        },
      ],
    };
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin },
    ]);
    const { makeContext } = testContextFactory(terminal);

    await expect(
      runPlugin('fake', ['sync'], BASE_VALUES, terminal, createLogger(terminal), makeContext, {
        fs,
        loader,
      }),
    ).rejects.toThrow('sync failed');
  });

  it('reports an unknown plugin name naming `blogwright plugin list`, and exits 1', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([]);
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'ghost',
      ['sync'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual([
      '✗ no built-in command or installed plugin claims "ghost" - run ' +
        '`blogwright plugin list` to see what is installed',
    ]);
  });

  it('reports an unknown action inside a known plugin, listing its declared actions, and exits 1', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin([]) },
    ]);
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'fake',
      ['bogus'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown fake action: bogus']);
    expect(terminal.writes[0]).toContain('"fake" actions:');
    expect(terminal.writes[0]).toContain('secret status - show secret status');
  });

  it('calls discover with all three arguments - repoRoot, cliPackageDir(), and ports - dispatching a plugin bundled with the CLI from a consumer package.json naming only "blogwright"', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts(
      [
        {
          packageName: 'blogwright-fake',
          namespace: 'fake',
          plugin: makeFakePlugin(calls),
          bundled: true,
        },
      ],
      { consumerDeps: { blogwright: '^1.0.0' } },
    );
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'fake',
      ['sync'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(loader.packageJsonPathForCalls).toContainEqual({
      specifier: 'blogwright-fake',
      fromDir: cliPackageDir(),
    });
  });
});

/**
 * A plugin carrying only an `init?(io)` contributor - no `init` command, so
 * the generic action is the only thing `blogwright <namespace> init` can
 * mean for it (declaring both is rejected at discovery - see the
 * "declares both" describe block below). Every question the fixture asks is
 * required, so a scripted terminal's `answers` array lines up 1:1 with the
 * entries returned.
 */
const CONTRIBUTOR_CONFIG_KEY = 'demo';

function makeContributorOnlyPlugin(): Plugin {
  return {
    name: 'demo',
    description: 'a demo plugin with only an init(io) contributor',
    commands: [],
    configKey: CONTRIBUTOR_CONFIG_KEY,
    init: async (io) => {
      const token = await io.ask({ prompt: 'API token', required: true });
      return [{ property: `"token": "${token}"`, comment: 'demo API token' }];
    },
  };
}

describe('runPlugin - the generic `init` action', () => {
  it("splices a contributor-only plugin's answered block into config/<env>.jsonc, and the result re-parses cleanly", async () => {
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeContributorOnlyPlugin() },
    ]);
    const configPath = `${repoRoot}/config/production.jsonc`;
    await fs.writeText(configPath, '{\n  "siteName": "demo"\n}\n');
    const terminal = createScriptedTerminal({ interactive: true, answers: ['secret-abc'] });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['init'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    const written = await fs.readText(configPath);
    expect(written).toContain('"demo": {');
    expect(written).toContain('"token": "secret-abc"');
    expect(written).toContain('"siteName": "demo"'); // every other byte is untouched
    // The whole point: a bug in the splice must never leave an unloadable file.
    const { raw } = parseConfigDocument(written);
    expect(raw['demo']).toEqual({ token: 'secret-abc' });
  });

  it('writes to the file resolved via --config when one is given, not to config/<env>.jsonc', async () => {
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeContributorOnlyPlugin() },
    ]);
    const configPath = '/elsewhere/custom.jsonc';
    await fs.writeText(configPath, '{\n  "siteName": "demo"\n}\n');
    const terminal = createScriptedTerminal({ interactive: true, answers: ['secret-xyz'] });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['init'],
      { ...BASE_VALUES, config: configPath },
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    const written = await fs.readText(configPath);
    expect(written).toContain('"token": "secret-xyz"');
    expect(() => parseConfig(written)).not.toThrow();
  });

  it("lets a plugin's own declared `init` command win - it reaches its own `run` and the config file is never touched", async () => {
    const calls: RecordedRun[] = [];
    const plugin: Plugin = {
      name: 'pdslike',
      description: 'declares its own init, like pds - creates a record, writes no config block',
      commands: [
        {
          action: 'init',
          summary: 'create the publication record',
          run: async (ctx, args) => {
            calls.push({ action: 'init', ctx, args });
          },
        },
      ],
      // No init(io) contributor: declaring both would be a discovery-time
      // rejection (see the "declares both" describe block below).
    };
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-pdslike', namespace: 'pdslike', plugin },
    ]);
    const configPath = `${repoRoot}/config/production.jsonc`;
    const seeded = '{\n  "siteName": "demo"\n}\n';
    await fs.writeText(configPath, seeded);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'pdslike',
      ['init'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([{ action: 'init', ctx: expect.anything(), args: [] }]);
    // Nothing in the config-writing path ran at all - byte-identical.
    expect(await fs.readText(configPath)).toBe(seeded);
  });

  it('reports the action unavailable and lists the actions it does have when a plugin declares neither an init command nor a contributor, exiting non-zero', async () => {
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'fake',
      ['init'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(terminal.errors).toEqual(['✗ unknown fake action: init']);
    expect(terminal.writes[0]).toContain('"fake" actions:');
    expect(terminal.writes[0]).toContain('sync - sync it');
  });

  it("rejects with the splice module's own message and leaves the file byte-identical when the config already declares the plugin's key", async () => {
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeContributorOnlyPlugin() },
    ]);
    const configPath = `${repoRoot}/config/production.jsonc`;
    const seeded = '{\n  "siteName": "demo",\n  "demo": { "token": "existing" }\n}\n';
    await fs.writeText(configPath, seeded);
    const terminal = createScriptedTerminal({ interactive: true, answers: ['secret-abc'] });
    const { makeContext } = testContextFactory(terminal);

    await expect(
      runPlugin('demo', ['init'], BASE_VALUES, terminal, createLogger(terminal), makeContext, {
        fs,
        loader,
      }),
    ).rejects.toThrow(/already declares a "demo" key/);

    expect(await fs.readText(configPath)).toBe(seeded);
  });

  it('writes nothing and says so when the contributor answers no questions', async () => {
    const plugin: Plugin = {
      name: 'declines',
      description: 'a plugin whose operator may decline every question',
      commands: [],
      configKey: 'declines',
      init: async () => [],
    };
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-declines', namespace: 'declines', plugin },
    ]);
    const configPath = `${repoRoot}/config/production.jsonc`;
    const seeded = '{\n  "siteName": "demo"\n}\n';
    await fs.writeText(configPath, seeded);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'declines',
      ['init'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(await fs.readText(configPath)).toBe(seeded);
    expect(terminal.writes.some((line) => line.includes('nothing written'))).toBe(true);
  });

  it('rejects naming the plugin when an init(io) contributor is declared but the plugin has no configKey to file its block under', async () => {
    const plugin: Plugin = {
      name: 'nokey',
      description: 'an authoring bug: init(io) with no configKey',
      commands: [],
      init: async () => [{ property: '"x": 1' }],
    };
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-nokey', namespace: 'nokey', plugin },
    ]);
    await fs.writeText(`${repoRoot}/config/production.jsonc`, '{\n  "siteName": "demo"\n}\n');
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    await expect(
      runPlugin('nokey', ['init'], BASE_VALUES, terminal, createLogger(terminal), makeContext, {
        fs,
        loader,
      }),
    ).rejects.toThrow(/"nokey".*no configKey/);
  });
});

describe('discover - a plugin declaring both an init command and an init(io) contributor', () => {
  function makeBothPlugin(): Plugin {
    return {
      name: 'both',
      description: 'declares both an init command and a contributor - unsatisfiable',
      commands: [{ action: 'init', summary: 'own init', run: async () => undefined }],
      configKey: 'both',
      init: async () => [],
    };
  }

  it('is rejected at discovery, naming the package and both halves of the collision, and absent from the discovered plugins', async () => {
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-both', namespace: 'both', plugin: makeBothPlugin() },
    ]);

    const result = await discover(repoRoot, cliPackageDir(), { fs, loader });

    expect(result.plugins).toEqual([]);
    expect(result.failures).toEqual([
      {
        packageName: 'blogwright-both',
        reason:
          'blogwright-both declares both an "init" command and an init(io) contributor - ' +
          'a declared command always wins dispatch, so the contributor would never run; declare only one',
      },
    ]);
  });

  it('never reaches dispatch: `blogwright both init` reports "both" as not installed at all', async () => {
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-both', namespace: 'both', plugin: makeBothPlugin() },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'both',
      ['init'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(terminal.errors[0]).toContain('no built-in command or installed plugin claims "both"');
  });
});

describe('toPluginContext', () => {
  it('supplies exactly pluginConfig, siteState and record on top of the OpsContext, with no cast', () => {
    const ops = createTestContext({ env: 'staging' });

    const ctx = toPluginContext(ops);

    expect(ctx.env).toBe(ops.env);
    expect(ctx.domain).toBe(ops.domain);
    expect(ctx.preview).toBe(ops.preview);
    expect(ctx.config).toBe(ops.config);
    expect(ctx.names).toBe(ops.names);
    expect(ctx.accountId).toBe(ops.accountId);
    expect(ctx.clients).toBe(ops.clients);
    expect(ctx.ports.fs).toBe(ops.ports.fs);
    expect(ctx.ports.terminal).toBe(ops.ports.terminal);
    expect(ctx.tags).toBe(ops.tags);
    expect(ctx.logger).toBe(ops.logger);
    expect(ctx.pluginConfig).toEqual({});

    // Pre-task-16: all three state surfaces still read/write the SITE's own
    // store - see toPluginContext's doc comment on why nothing may call
    // `plugin.nodes` against a context built this way before task 16 lands.
    expect(ctx.siteState).toBe(ops.state);
    expect(ctx.state).toBe(ops.state);
    expect(ctx.store).toBe(ops.store);
    expect(ctx.save).toBe(ops.save);

    ctx.record('some-node', { arn: 'arn:aws:s3:::example' });
    expect(ops.state.resources['some-node']).toEqual({ arn: 'arn:aws:s3:::example' });
  });
});
