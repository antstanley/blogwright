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

import { createScriptedTerminal, type Plugin } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { cliPackageDir, type ContextOptions, type OpsContext } from './context.js';
import { createLogger } from './logger.js';
import { runPlugin, toPluginContext, type PluginValues } from './plugin-commands.js';
import {
  buildDiscoveryPorts,
  createTestContext,
  makeFakePlugin,
  type RecordedRun,
} from './test-support.js';

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
