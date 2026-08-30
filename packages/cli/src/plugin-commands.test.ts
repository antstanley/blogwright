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
  type FileSystem,
  type Plugin,
  type PluginContext,
  type ResourceNode,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { main } from './cli.js';
import { cliPackageDir, type ContextOptions, type OpsContext } from './context.js';
import { createLogger } from './logger.js';
import { buildNodes } from './nodes.js';
import { runPlugin, toPluginContext, type PluginValues } from './plugin-commands.js';
import { discover } from './plugins.js';
import {
  buildDiscoveryPorts,
  createTestContext,
  makeFakePlugin,
  scopedStateOnlyS3,
  type RecordedRun,
  type TestContextOverrides,
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

/**
 * A ContextFactory over `createTestContext`. Defaults `clients.s3` to
 * {@link scopedStateOnlyS3}: every dispatched plugin command now runs
 * through `toPluginContext`, which loads the plugin's own SCOPED store (see
 * this file's `toPluginContext` describe block) - a call the tests in this
 * file that dispatch a command, but don't care about state, never asked for
 * and shouldn't have to mock themselves. That default answers ONLY a
 * scoped-shaped state key; every other S3 read, the site's own
 * `state/<env>.json` included, still fails fast exactly as
 * `createTestContext`'s reject-everything default does.
 */
function testContextFactory(
  terminal: ReturnType<typeof createScriptedTerminal>,
  clients: TestContextOverrides['clients'] = { s3: scopedStateOnlyS3() },
): {
  makeContext: (opts: ContextOptions) => Promise<OpsContext>;
  contexts: OpsContext[];
} {
  const contexts: OpsContext[] = [];
  const makeContext = async (opts: ContextOptions): Promise<OpsContext> => {
    const ctx = createTestContext({
      env: opts.env,
      ports: opts.ports,
      logger: createLogger(terminal),
      clients,
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
  it('writes the environment named by the trailing positional, not the default', async () => {
    // The generic init is a second path through runPlugin that never reaches
    // matchAction, where the matched-action path resolves the environment. It
    // reads the positional itself, and until this test nothing pinned that:
    // mutating its `rest.slice(1)` to `[]` left the whole suite green while
    // silently sending `analytics init staging` at config/production.jsonc -
    // the exact fallback-to-production defect runPlugin's own doc comment
    // warns about. Both files are seeded, so writing the wrong one is visible.
    const repoRoot = await realRepoRoot();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeContributorOnlyPlugin() },
    ]);
    const production = `${repoRoot}/config/production.jsonc`;
    const staging = `${repoRoot}/config/staging.jsonc`;
    const seeded = '{\n  "siteName": "demo"\n}\n';
    await fs.writeText(production, seeded);
    await fs.writeText(staging, seeded);
    const terminal = createScriptedTerminal({ interactive: true, answers: ['secret-abc'] });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['init', 'staging'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(await fs.readText(staging)).toContain('"token"');
    // Production must be byte-identical to what was seeded.
    expect(await fs.readText(production)).toBe(seeded);
  });

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
  it("supplies pluginConfig/siteState/record and scopes store/state/save to the plugin's own name, with no cast", async () => {
    // A recording override, not a fixture: this is the one test that proves
    // the scoped store genuinely reads/writes `state/<env>.<plugin>.json`
    // rather than the site's own `state/<env>.json` - a context that merely
    // TYPECHECKS as PluginContext while every state surface still points at
    // the site's store would pass every other assertion here and still be
    // the exact defect this task exists to fix (see this module's TASK 16
    // doc comment).
    const s3Calls: { op: string; key: string }[] = [];
    const ops = createTestContext({
      env: 'staging',
      clients: {
        s3: {
          getObjectText: async (_bucket: string, key: string) => {
            s3Calls.push({ op: 'get', key });
            return undefined;
          },
          putObject: async (_bucket: string, key: string) => {
            s3Calls.push({ op: 'put', key });
          },
        },
      },
    });

    const ctx = await toPluginContext(ops, 'demo');

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

    // siteState is the SITE's own state, passed straight through, read-only -
    // never the scoped load (task 53's log-delivery node reads the site's
    // distribution outputs through exactly this, and must still find them).
    expect(ctx.siteState).toBe(ops.state);
    // store/state/save are genuinely distinct objects from the site's own -
    // scoped to the plugin's name, not merely type-compatible with it.
    expect(ctx.store).not.toBe(ops.store);
    expect(ctx.state).not.toBe(ops.state);
    expect(ctx.save).not.toBe(ops.save);
    expect(s3Calls).toEqual([{ op: 'get', key: 'state/staging.demo.json' }]);

    ctx.record('some-node', { arn: 'arn:aws:s3:::example' });
    // Recorded into the PLUGIN's own state - never the site's.
    expect(ctx.state.resources['some-node']).toEqual({ arn: 'arn:aws:s3:::example' });
    expect(ops.state.resources['some-node']).toBeUndefined();

    await ctx.save();
    expect(s3Calls).toEqual([
      { op: 'get', key: 'state/staging.demo.json' },
      { op: 'put', key: 'state/staging.demo.json' },
    ]);
  });
});

/** The one id {@link fakePluginNode} below tracks. */
const NODE_PLUGIN_RESOURCE_ID = 'demo-resource';

/**
 * A single fake resource node: existence lives in `world` (a plain `Set`
 * the test inspects directly, standing in for a real AWS resource, never
 * read through S3), and `create` records a fixed output via `ctx.record` -
 * exactly what a real node does, and the one thing that proves `applyGraph`
 * ran against the PLUGIN's own `record`/`state`, not the site's.
 */
function fakePluginNode(id: string, world: Set<string>): ResourceNode<PluginContext<unknown>> {
  return {
    id,
    dependsOn: [],
    title: id,
    read: async () => world.has(id),
    create: async (ctx) => {
      world.add(id);
      ctx.record(id, { name: id });
    },
    delete: async () => {
      world.delete(id);
    },
  };
}

/** A fake plugin declaring no commands of its own - only a `nodes(ctx)` contributor over one fake resource tracked in `world`. */
function makeNodePlugin(world: Set<string>): Plugin {
  return {
    name: 'demo',
    description: 'a fake plugin contributing one resource node',
    commands: [],
    nodes: () => [fakePluginNode(NODE_PLUGIN_RESOURCE_ID, world)],
  };
}

/**
 * Records every `getObjectText`/`putObject`/`deleteObject` key touched -
 * every other S3 method is left at `createTestContext`'s reject-all
 * default, since none of the lifecycle-verb tests below need it (the fake
 * node's own "AWS calls" are just `world` mutations).
 */
function recordingS3(): {
  calls: { op: 'get' | 'put' | 'delete'; key: string }[];
  s3: NonNullable<NonNullable<TestContextOverrides['clients']>['s3']>;
} {
  const calls: { op: 'get' | 'put' | 'delete'; key: string }[] = [];
  return {
    calls,
    s3: {
      getObjectText: async (_bucket, key) => {
        calls.push({ op: 'get', key });
        return undefined;
      },
      putObject: async (_bucket, key) => {
        calls.push({ op: 'put', key });
      },
      deleteObject: async (_bucket, key) => {
        calls.push({ op: 'delete', key });
      },
    },
  };
}

/*
 * `bootstrap`/`status`/`destroy` are the generic lifecycle verbs §CLI →
 * Plugin lifecycle adds - see this module's TASK 16 doc comment for the
 * precedence. Every one of these tests exists to catch the load-bearing
 * defect this task fixes: a plugin's own scoped state
 * (`state/<env>.<plugin>.json`) must be the ONLY state key any of the three
 * ever touches - never the site's `state/<env>.json` - which is why every
 * test below pins the exact keys the recording S3 client saw, not just
 * that the command "worked".
 */
describe('runPlugin - the generic bootstrap/status/destroy lifecycle verbs', () => {
  it("bootstrap runs applyGraph over the plugin's own nodes and touches only its own scoped state key", async () => {
    const world = new Set<string>();
    const { calls, s3 } = recordingS3();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal, { s3 });

    const code = await runPlugin(
      'demo',
      ['bootstrap'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(world.has(NODE_PLUGIN_RESOURCE_ID)).toBe(true);
    // Load (building the plugin context), then one save after the one node -
    // the scoped key, and ONLY the scoped key: never `state/production.json`.
    expect(calls).toEqual([
      { op: 'get', key: 'state/production.demo.json' },
      { op: 'put', key: 'state/production.demo.json' },
    ]);
  });

  it("status reads the plugin's own nodes without creating or deleting anything, and never writes state", async () => {
    const world = new Set([NODE_PLUGIN_RESOURCE_ID]);
    const { calls, s3 } = recordingS3();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal, { s3 });

    const code = await runPlugin(
      'demo',
      ['status'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(terminal.writes.some((line) => line.includes('present'))).toBe(true);
    expect(world.has(NODE_PLUGIN_RESOURCE_ID)).toBe(true); // read-only: status never creates or deletes
    // Only the load that builds the plugin's context - readNodeStatus never saves.
    expect(calls).toEqual([{ op: 'get', key: 'state/production.demo.json' }]);
  });

  it('destroy without --yes refuses with the same contract as the site verb, and destroys nothing', async () => {
    const world = new Set([NODE_PLUGIN_RESOURCE_ID]);
    const { calls, s3 } = recordingS3();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal, { s3 });

    await expect(
      runPlugin('demo', ['destroy'], BASE_VALUES, terminal, createLogger(terminal), makeContext, {
        fs,
        loader,
      }),
    ).rejects.toThrow('refusing to destroy "demo" in "production" without --yes');

    expect(world.has(NODE_PLUGIN_RESOURCE_ID)).toBe(true); // nothing torn down
    // Only the load that builds the plugin's context - the refusal precedes
    // destroyGraph and the scoped store.delete() entirely.
    expect(calls).toEqual([{ op: 'get', key: 'state/production.demo.json' }]);
  });

  it('destroy --yes tears down the nodes via destroyGraph, then deletes the scoped state object', async () => {
    const world = new Set([NODE_PLUGIN_RESOURCE_ID]);
    const { calls, s3 } = recordingS3();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal, { s3 });

    const code = await runPlugin(
      'demo',
      ['destroy'],
      { ...BASE_VALUES, yes: true },
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(world.has(NODE_PLUGIN_RESOURCE_ID)).toBe(false);
    expect(calls).toEqual([
      { op: 'get', key: 'state/production.demo.json' }, // load, building the plugin context
      { op: 'put', key: 'state/production.demo.json' }, // destroyGraph's save after the one node
      { op: 'delete', key: 'state/production.demo.json' }, // the scoped store.delete() at the end
    ]);
  });

  /*
   * The other half of the site teardown's refusal. `assertNoScopedState`
   * (`commands.ts`) prints `blogwright <scope> destroy <env> --yes` as the
   * remedy, so that exact shape - the environment as a positional after the
   * verb - has to dispatch against THAT environment for the printed command
   * to be runnable as shown. Drop the positional and the verb falls back to
   * `DEFAULT_ENV = 'production'`, which is the wrong stack every time the
   * refusal came from `preview teardown` (`runPreview` builds
   * `env: 'preview'` unconditionally).
   */
  it('destroy <env> --yes - the remedy the site teardown prints - targets that environment, not the production default', async () => {
    const world = new Set([NODE_PLUGIN_RESOURCE_ID]);
    const { calls, s3 } = recordingS3();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal, { s3 });

    const code = await runPlugin(
      'demo',
      ['destroy', 'preview'],
      { ...BASE_VALUES, yes: true },
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(world.has(NODE_PLUGIN_RESOURCE_ID)).toBe(false);
    // Every key is the PREVIEW environment's; `state/production.demo.json`,
    // which the env-less form would have reached for, is never touched.
    expect(calls).toEqual([
      { op: 'get', key: 'state/preview.demo.json' },
      { op: 'put', key: 'state/preview.demo.json' },
      { op: 'delete', key: 'state/preview.demo.json' },
    ]);
  });

  it('a plugin with no nodes contributor does not gain the verbs - asking for one lists its real actions and exits non-zero', async () => {
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    for (const action of ['bootstrap', 'status', 'destroy']) {
      const code = await runPlugin(
        'fake',
        [action],
        BASE_VALUES,
        terminal,
        createLogger(terminal),
        makeContext,
        { fs, loader },
      );
      expect(code).toBe(1);
    }

    expect(calls).toEqual([]);
    expect(terminal.errors).toEqual([
      '✗ unknown fake action: bootstrap',
      '✗ unknown fake action: status',
      '✗ unknown fake action: destroy',
    ]);
    expect(terminal.writes.every((line) => line.includes('"fake" actions:'))).toBe(true);
    // ... and the refusal must not ADVERTISE what it just refused: a plugin
    // with no `nodes` contributor gains none of the three, so none of the
    // three may appear among the actions it lists.
    for (const line of terminal.writes) {
      expect(line).not.toMatch(/^ {2}(bootstrap|status|destroy) - /m);
    }
  });

  it('lists all three verbs in the unknown-action refusal for a nodes-contributing plugin that declares no commands at all', async () => {
    // The listing bug this pins: a nodes-only plugin declares NO commands,
    // so a refusal built from `plugin.commands` alone printed the heading
    // and then nothing whatsoever - while all three verbs worked on it. A
    // refusal that says the plugin has no actions, when it has three, is
    // worse than no refusal (see `renderActions`'s own doc comment).
    const world = new Set<string>();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['frobnicate'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown demo action: frobnicate']);
    // Hand-typed, not built from the module's own constant: a summary that
    // drifts from the one the verb dispatches under must fail here.
    expect(terminal.writes).toEqual([
      [
        '"demo" actions:',
        "  bootstrap - reconcile this plugin's resources",
        "  status - show this plugin's resource status",
        "  destroy - tear down this plugin's resources",
      ].join('\n'),
    ]);
  });

  it('omits the generic status from the listing when the plugin declares its own, and lists it once', async () => {
    // Only `status` can collide (`bootstrap`/`destroy` are rejected at
    // discovery), and the declared one is what `matchAction` runs - so it
    // must appear exactly once, under the PLUGIN's summary, not twice.
    const world = new Set<string>();
    const plugin: Plugin = {
      ...makeNodePlugin(world),
      commands: [{ action: 'status', summary: 'plugin-owned status', run: async () => undefined }],
    };
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['frobnicate'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(terminal.writes).toEqual([
      [
        '"demo" actions:',
        '  status - plugin-owned status',
        "  bootstrap - reconcile this plugin's resources",
        "  destroy - tear down this plugin's resources",
      ].join('\n'),
    ]);
  });

  it("a plugin's own declared status command wins over the generic verb", async () => {
    const world = new Set<string>();
    const calls: RecordedRun[] = [];
    const plugin: Plugin = {
      ...makeNodePlugin(world),
      commands: [
        {
          action: 'status',
          summary: 'plugin-owned status',
          run: async (ctx, args) => {
            calls.push({ action: 'status', ctx, args });
          },
        },
      ],
    };
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['status'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe('status');
  });
});

/**
 * §CLI → Plugin lifecycle: `bootstrap`/`destroy` are ALWAYS the generic
 * verbs - a plugin declaring either as one of its own `commands` is
 * unsatisfiable (there is no way for it to run the CLI's own engine
 * itself), so `plugins.ts`'s `rejectDeclaredLifecycleCollisions` rejects it
 * at discovery, beside task 13's `rejectDeclaredInitCollisions` in the same
 * collision pass. Mirrors the "declares both an init command and an
 * init(io) contributor" block above.
 */
describe('discover - a plugin declaring bootstrap or destroy as one of its own commands', () => {
  function makeLifecycleCollisionPlugin(action: 'bootstrap' | 'destroy'): Plugin {
    return {
      name: 'demo',
      description: `declares its own "${action}" command - unsatisfiable`,
      commands: [{ action, summary: 'own', run: async () => undefined }],
    };
  }

  it.each(['bootstrap', 'destroy'] as const)(
    'rejects a plugin declaring its own "%s" command at discovery, naming the package and the action',
    async (action) => {
      const repoRoot = await realRepoRoot();
      const { fs, loader } = await buildDiscoveryPorts([
        {
          packageName: 'blogwright-demo',
          namespace: 'demo',
          plugin: makeLifecycleCollisionPlugin(action),
        },
      ]);

      const result = await discover(repoRoot, cliPackageDir(), { fs, loader });

      expect(result.plugins).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.packageName).toBe('blogwright-demo');
      expect(result.failures[0]?.reason).toContain(`declares a "${action}" command`);
    },
  );

  it('never reaches dispatch: `blogwright demo bootstrap` reports "demo" as not installed at all', async () => {
    const { fs, loader } = await buildDiscoveryPorts([
      {
        packageName: 'blogwright-demo',
        namespace: 'demo',
        plugin: makeLifecycleCollisionPlugin('bootstrap'),
      },
    ]);
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext } = testContextFactory(terminal);

    const code = await runPlugin(
      'demo',
      ['bootstrap'],
      BASE_VALUES,
      terminal,
      createLogger(terminal),
      makeContext,
      { fs, loader },
    );

    expect(code).toBe(1);
    expect(terminal.errors[0]).toContain('no built-in command or installed plugin claims "demo"');
  });

  it('a declared "status" command is NOT a collision - a plugin may own its own status reporting', async () => {
    const repoRoot = await realRepoRoot();
    const plugin: Plugin = {
      name: 'demo',
      description: 'declares its own status command - allowed',
      commands: [{ action: 'status', summary: 'own status', run: async () => undefined }],
    };
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin },
    ]);

    const result = await discover(repoRoot, cliPackageDir(), { fs, loader });

    expect(result.failures).toEqual([]);
    expect(result.plugins.map((p) => p.name)).toEqual(['demo']);
  });
});

/*
 * THE INVERSE PIN, and why it lives in THIS file.
 *
 * Every test above proves a PLUGIN's lifecycle verb touches only the
 * plugin's own `state/<env>.<plugin>.json`. The other half of that
 * separation - that the SITE's own `bootstrap` touches only
 * `state/<env>.json`, even with a node-contributing plugin installed - has
 * nothing to fail against today: `commands.ts`'s transitive closure
 * ({agent-package, context, deploy, graph, logger, microvms, nodes, ports,
 * render, repo, seo}) reaches neither `plugins.ts` nor
 * `plugin-commands.ts`, and `discover` is called only from `cli.ts`'s help
 * path and `runPlugin` - never on the bootstrap dispatch path. It is the
 * task AFTER this one that could break it: wiring plugin nodes into
 * `buildNodes` would put a plugin's resources into the site's own state
 * document with nothing failing to say so.
 *
 * It is in `plugin-commands.test.ts`, not `commands.test.ts`, because this
 * task's `Reviewable:` line runs `vitest run plugin-commands` and asks for
 * "the site-bootstrap test with the same plugin installed" among what that
 * command shows - a test in `commands.test.ts` would not be run by it.
 */
describe("the site's own bootstrap, with a node-contributing plugin installed", () => {
  /** Matches `packageAndUploadAgent`'s required 12-hex manifest hash. */
  const AGENT_HASH = '0123456789ab';

  /**
   * An `OpsContext` for a fully-provisioned production environment: every
   * node's `read` answers "exists", so `applyGraph` reconciles rather than
   * creates and the run needs no create-path mocking at all. `keys` records
   * every S3 object key the run touches, in order.
   *
   * `save` is rebound to persist THIS state through THIS store, exactly as
   * the real composition root does (`context.ts`); `createTestContext`'s own
   * default is a no-op, which would leave `keys` empty and the assertions
   * below vacuous.
   */
  function siteContext(fs: FileSystem): { ctx: OpsContext; keys: string[] } {
    const keys: string[] = [];
    const base = createTestContext({
      env: 'production',
      names: { bucket: 'my-bucket' },
      agentDir: '/agent',
      ports: { fs, terminal: createScriptedTerminal({ interactive: false }) },
      clients: {
        s3: {
          getObjectText: async (_bucket, key) => {
            keys.push(key);
            return undefined;
          },
          putObject: async (_bucket, key) => {
            keys.push(key);
          },
          deleteObject: async (_bucket, key) => {
            keys.push(key);
          },
          bucketExists: async () => true,
          putBucketTagging: async () => undefined,
          putPublicAccessBlock: async () => undefined,
          putBucketPolicy: async () => undefined,
        },
        logs: { logGroupExists: async () => true, putRetentionPolicy: async () => undefined },
        logsUsEast1: {
          logGroupExists: async () => true,
          putRetentionPolicy: async () => undefined,
        },
        iam: {
          getRoleArn: async (name) => `arn:aws:iam::123456789012:role/${name}`,
          putRolePolicy: async () => undefined,
        },
        microvms: {
          getImage: async (id) => ({
            imageArn: id,
            imageName: 'builder',
            state: 'CREATED',
            imageVersion: 'v1',
          }),
        },
        cloudfront: {
          getDistribution: async (id) => ({
            id,
            arn: 'arn:aws:cloudfront::123456789012:distribution/D1',
            domainName: 'd1.cloudfront.net',
            status: 'Deployed',
            etag: undefined,
          }),
        },
      },
    });
    // The outputs the state-keyed reads (OAC, router function, image,
    // distribution, log delivery) answer "exists" from.
    Object.assign(base.state.resources, {
      oac: { id: 'E1OAC' },
      'cloudfront-function': { arn: 'arn:aws:cloudfront::123456789012:function/router' },
      'microvm-image': {
        arn: 'arn:aws:lambda:eu-west-1:123456789012:microvm-image/builder',
        agentHash: AGENT_HASH,
        logGroup: base.names.microvmLogGroup,
      },
      'cloudfront-distribution': {
        id: 'D1',
        arn: 'arn:aws:cloudfront::123456789012:distribution/D1',
        domainName: 'd1.cloudfront.net',
      },
      'cloudfront-log-delivery': { delivery: 'configured' },
    });
    return { ctx: { ...base, save: async () => base.store.save(base.state) }, keys };
  }

  it("records into state/<env>.json only - never the plugin's scoped key - and never runs the plugin's node", async () => {
    const world = new Set<string>();
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-demo', namespace: 'demo', plugin: makeNodePlugin(world) },
    ]);
    // The builder-image node re-packages the agent bundle on every
    // reconcile; these three files are all `packageAndUploadAgent` reads.
    await fs.writeText('/agent/Dockerfile', 'FROM scratch');
    await fs.writeText('/agent/server.js', 'export default 1;');
    await fs.writeText('/agent/agent-manifest.json', JSON.stringify({ hash: AGENT_HASH }));

    // The plugin really is installed and really does contribute nodes - so a
    // future `buildNodes` that consulted discovery WOULD find it here.
    const discovered = await discover(await realRepoRoot(), cliPackageDir(), { fs, loader });
    expect(discovered.plugins.map((plugin) => plugin.name)).toEqual(['demo']);
    expect(typeof discovered.plugins[0]?.nodes).toBe('function');

    const terminal = createScriptedTerminal({ interactive: false });
    const { ctx, keys } = siteContext(fs);

    const code = await main(
      ['bootstrap'],
      () => terminal,
      async () => ctx,
      () => ({ fs, loader }),
    );

    // The whole graph applied. `main` does not catch, so a node that threw
    // would reject this call rather than return; and `bootstrap` awaits
    // `applyGraph` over every node before returning - so a 0 here is what
    // rules out a run that stopped part-way.
    expect(code).toBe(0);
    // The site's graph is the site's own - the plugin's node is not in it...
    expect(buildNodes(ctx).map((node) => node.id)).not.toContain(NODE_PLUGIN_RESOURCE_ID);
    // ...and so it never ran: nothing of the plugin's was created.
    expect(world.size).toBe(0);
    expect(ctx.state.resources[NODE_PLUGIN_RESOURCE_ID]).toBeUndefined();
    // Every state object this run touched is the SITE's own, and there is at
    // least one (the reconcile genuinely saved) - never `state/production.demo.json`.
    const stateKeys = keys.filter((key) => key.startsWith('state/'));
    expect(stateKeys.length).toBeGreaterThan(0);
    expect([...new Set(stateKeys)]).toEqual(['state/production.json']);
    // Corroboration, not proof of a full walk: the builder-image node really
    // reconciled and wrote its bundle. That node is 7th of the graph's 11 in
    // topological order (bucket, cloudfront-function, the two log groups,
    // the two IAM roles, THIS, then oac, cloudfront-distribution,
    // bucket-policy, cloudfront-log-delivery), so this artifact alone would
    // survive a run truncated anywhere after it. What rules an early exit
    // out is `expect(code).toBe(0)` above; what this line adds is that the
    // graph was genuinely exercised rather than no-opped, so the state-key
    // assertion above is not vacuous.
    expect(keys).toContain(`build/agent/agent-${AGENT_HASH}.zip`);
  });
});
