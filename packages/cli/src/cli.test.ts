/**
 * Dispatch-level tests for `main`. `main` takes its terminal, context and
 * discovery-ports factories as parameters (see cli.ts's `TerminalFactory`,
 * `ContextFactory` and `DiscoveryPortsFactory`), so these drive it with
 * `createScriptedTerminal`, a stub over `createTestContext`, and a map-backed
 * `{ fs, loader }` pair - never a module mock, never real disk or AWS
 * (DEVELOPMENT.md: "tests substitute at the port"). They pin today's help,
 * unknown-command, `pds`, and `status` behaviour so later dispatch-rebuild
 * tasks have a regression net.
 */

import { createScriptedTerminal, findRepoRoot, type ScriptedTerminal } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { main, type ContextFactory, type DiscoveryPortsFactory } from './cli.js';
import { cliPackageDir, loadConfig, type ContextOptions, type OpsContext } from './context.js';
import { RESERVED_COMMANDS } from './known-commands.js';
import { createLogger } from './logger.js';
import { toPluginContext } from './plugin-commands.js';
import {
  buildDiscoveryPorts,
  createTestContext,
  makeFakePlugin,
  type RecordedRun,
} from './test-support.js';

/**
 * An independent copy of the `USAGE` constant at cli.ts:11-63, pinned
 * byte-exact at the time this test was written. This is the regression net
 * tasks 11 and 29 rebuild help output against - an import of the live
 * constant would not catch a change to it, so the text is duplicated here
 * on purpose.
 */
const EXPECTED_USAGE = `blogwright - full operations for a blog site on AWS (S3 + CloudFront, MicroVM builds)

Usage:
  blogwright <command> [env] [options]

Commands:
  init                        First-run wizard: writes config/production.jsonc
  bootstrap   [env]           Create/reconcile the infrastructure graph
  deploy      [env]           Zip the repo, build in a MicroVM, publish to site/
  rollback    <hash> [env]    Re-deploy an existing build by hash
  delete      [env]           Empty the live site/ prefix
  destroy     [env] --yes     Tear down all infrastructure
  history     [env]           List deployment history
  logs        <hash> [env]    Show CloudWatch build logs for a hash
  status      [env]           Show planned graph vs. live state

  preview bootstrap           Provision the shared preview stack
  preview deploy <id>         Build + publish a PR preview (id like pr-42)
  preview destroy <id>        Remove one PR preview
  preview list                List active previews
  preview teardown --yes      Tear down the whole preview stack

  pds keygen                  Generate the OAuth client key: private JWK into
                              Secrets Manager, public documents into public/oauth/
                              (commit + release those before pds login)
  pds login --identifier <handle-or-did>
                              Interactive OAuth bootstrap: prints an authorize URL,
                              then expects the pasted /oauth/callback redirect URL;
                              the session is stored in Secrets Manager and refreshed
                              automatically on every sync
  pds secret status           Show secret metadata (never the value)
  pds secret delete --yes     Delete the secret (logs out and discards the key)
  pds init                    Create/update the standard.site publication record and
                              write the site verification files (commit them)
  pds sync                    Reconcile site.standard.document records with the
                              content collection (production only; also runs after
                              every successful production deploy)

Options:
  --env <name>      Environment (default: production; also accepted positionally)
  --domain <fqdn>   Custom domain (ACM cert + CloudFront alias)
  --config <path>   Path to a JSONC config file
  --endpoint <url>  AWS endpoint override (e.g. http://localhost:4566 for floci)
  --id <preview>    Preview id for preview deploy/destroy (also accepted positionally)
  --plain           Minimal machine-friendly output (no colour, no live status,
                    no prompts) - for CI systems and agents; also automatic when
                    output is piped. NO_COLOR disables colour only.
  --refresh         Re-upload every file on deploy, even unchanged ones, so
                    metadata fixes (content types, object tags) reach live
                    objects the ETag comparison would otherwise skip.
  --yes             Confirm destructive operations
  --help            Show this help
`;

/** A TerminalFactory that always hands back the same captured terminal. */
function fixedTerminal(terminal: ScriptedTerminal) {
  return () => terminal;
}

/**
 * A ContextFactory over `createTestContext`, wired to the same terminal
 * `main` built (mirroring context.ts's own `createLogger(ports.terminal)`)
 * so a dispatched command's `ctx.logger` calls land in that terminal's
 * captured `writes`/`errors`, and recording every context it builds so a
 * test can assert against derived fields (e.g. bucket name).
 */
function testContextFactory(terminal: ScriptedTerminal): {
  makeContext: ContextFactory;
  contexts: OpsContext[];
} {
  const contexts: OpsContext[] = [];
  const makeContext: ContextFactory = async (opts) => {
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

/**
 * A `DiscoveryPortsFactory` that throws if called - for every test below
 * that dispatches a built-in command and must never reach plugin dispatch
 * at all. Stronger than asserting a loader's call log stayed empty: it
 * fails the instant `runPlugin` is reached, rather than relying on
 * `findRepoRoot`/`discover` also behaving in a way that keeps the loader
 * unreached (see the "never touches the ModuleLoader..." test below for the
 * one case that still checks the loader directly, on `main`'s explicit
 * request from that section of the task).
 */
const unreachableDiscoveryPorts: DiscoveryPortsFactory = () => {
  throw new Error('unexpected: discovery ports built for a command that should never reach it');
};

describe('main - help and error surface', () => {
  it('prints USAGE and exits 0 for --help', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      unreachableDiscoveryPorts,
    );

    expect(code).toBe(0);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
    expect(terminal.errors).toEqual([]);
  });

  it('prints USAGE and exits 1 for a bare invocation', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      [],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      unreachableDiscoveryPorts,
    );

    expect(code).toBe(1);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it('reports an unrecognised first positional as neither a built-in nor an installed plugin, and exits 1', async () => {
    // Task 10 replaces the old "unknown command: x" + USAGE pair with plugin
    // dispatch: `frobnicate` is neither a built-in nor `plugin`, so it falls
    // through to `runPlugin`, which runs discovery (finding nothing, here)
    // before reporting the name unclaimed. This is the task-07 pin, updated
    // deliberately rather than deleted (see plugin-commands.ts's
    // `runPlugin` for the message this now asserts) -
    //   OLD: '✗ unknown command: frobnicate' + [EXPECTED_USAGE]
    //   NEW: the message below, with no USAGE print at all (task 11 is what
    //        wires a USAGE-equivalent print site back in for plugin dispatch,
    //        if it ever does - see that task's pointer on cli.ts:119 being
    //        deliberately absent from its print-site list).
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([]);

    const code = await main(
      ['frobnicate'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual([
      '✗ no built-in command or installed plugin claims "frobnicate" - run ' +
        '`blogwright plugin list` to see what is installed',
    ]);
    expect(terminal.writes).toEqual([]);
  });
});

describe('main - generic plugin dispatch', () => {
  it('dispatches a single-word action with no trailing environment, defaulting to "production"', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);

    const code = await main(
      ['fake', 'sync'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe('sync');
    expect(calls[0]?.ctx.env).toBe('production');
    expect(calls[0]?.args).toEqual([]);
  });

  it('dispatches a single-word action with a trailing environment positional', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const factory = testContextFactory(terminal);

    const code = await main(
      ['fake', 'sync', 'staging'],
      fixedTerminal(terminal),
      factory.makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ctx.env).toBe('staging');
    // The environment positional is consumed, never forwarded as a data arg.
    expect(calls[0]?.args).toEqual([]);
    // Exactly ONE context is built, with the resolved environment. The earlier
    // design built a provisional `production` context first and rebuilt when the
    // positional differed; the staging-only regression test below catches that
    // only on a repo where production has no config. On a repo where it does,
    // this count is the only thing that would notice the second build coming
    // back - along with its second sts.getAccountId round-trip.
    expect(factory.contexts).toHaveLength(1);
    expect(factory.contexts[0]?.env).toBe('staging');
  });

  it('dispatches a multi-word action ("secret status") by declaration, not by positional shifting, with a trailing environment', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);

    const code = await main(
      ['fake', 'secret', 'status', 'staging'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    // Matched the two-word "secret status", not the bare "secret" - proven
    // by the action recorded AND by "status" never appearing in args/env.
    expect(calls[0]?.action).toBe('secret status');
    expect(calls[0]?.ctx.env).toBe('staging');
    expect(calls[0]?.args).toEqual([]);
  });

  it('lets --env override a positional environment', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);

    const code = await main(
      ['fake', 'sync', 'staging', '--env', 'canary'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ctx.env).toBe('canary');
    expect(calls[0]?.args).toEqual([]);
  });

  it('passes flag values through to run() - the --identifier and --yes shapes task 29 depends on - positively, not merely absence of a refusal', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);

    const code = await main(
      ['fake', 'secret', 'status', '--identifier', 'alice.example', '--yes'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe('secret status');
    expect(calls[0]?.ctx.env).toBe('production');
    expect(calls[0]?.args).toEqual(['--identifier', 'alice.example', '--yes']);
  });

  it('dispatches a plugin bundled with the CLI even when the consumer package.json names only "blogwright"', async () => {
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

    const code = await main(
      ['fake', 'sync'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    // Resolved from the CLI's own directory - never from the consumer root,
    // which declares no blogwright-* dependency at all.
    expect(
      loader.packageJsonPathForCalls.some(
        (call) => call.specifier === 'blogwright-fake' && call.fromDir === cliPackageDir(),
      ),
    ).toBe(true);
  });

  it('dispatches an action with a positional environment even when only THAT environment has a config file (no config/production.jsonc, no ops.config.jsonc) - regression', async () => {
    // Pins the fix for a real bug an earlier, provisional-context version of
    // `runPlugin` had: it built a throwaway OpsContext for a GUESSED
    // environment (production, absent --env) purely to reach ports for
    // discovery, before the real environment (the "staging" positional
    // here) was ever read. On a repo configured for staging only, that
    // guess made `loadConfig` throw `no config found for environment
    // "production"` - naming an environment the operator never asked for.
    // This test drives `main` through a `makeContext` that reproduces
    // `createContext`'s REAL ordering (config loaded, and able to throw,
    // before any AWS client is built) rather than `createTestContext`'s
    // bypass - `createTestContext` never calls `loadConfig` at all, so it
    // cannot reproduce this failure mode.
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin(calls) },
    ]);
    const repoRoot = await findRepoRoot(fs);
    await fs.writeText(`${repoRoot}/config/staging.jsonc`, JSON.stringify({ siteName: 'example' }));

    const makeContext = async (opts: ContextOptions): Promise<OpsContext> => {
      await loadConfig(fs, { env: opts.env, root: repoRoot, configPath: opts.configPath });
      return createTestContext({
        env: opts.env,
        ports: opts.ports,
        logger: createLogger(terminal),
      });
    };

    const code = await main(
      ['fake', 'sync', 'staging'],
      fixedTerminal(terminal),
      makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ctx.env).toBe('staging');
  });

  it('reports an unknown plugin name, naming `blogwright plugin list`, and exits 1', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin([]) },
    ]);

    const code = await main(
      ['ghost', 'sync'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
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

    const code = await main(
      ['fake', 'bogus'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown fake action: bogus']);
    expect(terminal.writes).toEqual([
      [
        '"fake" actions:',
        '  sync - sync it',
        '  secret - show secret (bare, should never win over "secret status")',
        '  secret status - show secret status',
        '  secret delete - delete the secret',
      ].join('\n'),
    ]);
  });

  it('never touches the ModuleLoader for deploy, status or bootstrap - discovery stays lazy for every built-in', async () => {
    // Two independent signals, both required to stay zero: `makeDiscoveryPorts`
    // itself must never be invoked (the direct proof that `runPlugin` was
    // never reached), and the fake `ModuleLoader` it would have handed back
    // must show no calls either (the task's own requested assertion).
    // (Verified: this test fails when `!KNOWN_COMMANDS.has(command)` in
    // cli.ts is hoisted/replaced so every command falls through to
    // `runPlugin`.)
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-fake', namespace: 'fake', plugin: makeFakePlugin([]) },
    ]);
    let discoveryPortsCalls = 0;
    const makeDiscoveryPorts: DiscoveryPortsFactory = () => {
      discoveryPortsCalls += 1;
      return { fs, loader };
    };
    const { makeContext } = testContextFactory(terminal);

    for (const command of ['deploy', 'status', 'bootstrap']) {
      await main([command], fixedTerminal(terminal), makeContext, makeDiscoveryPorts).catch(
        () => undefined,
      );
    }

    expect(discoveryPortsCalls).toBe(0);
    expect(loader.resolveCalls).toEqual([]);
    expect(loader.packageJsonPathForCalls).toEqual([]);
    expect(loader.loadCalls).toEqual([]);
  });
});

describe('toPluginContext', () => {
  it('adapts an OpsContext with no cast, supplying pluginConfig/siteState/record on top of it', () => {
    const ops = createTestContext({ env: 'staging' });

    const ctx = toPluginContext(ops);

    expect(ctx.env).toBe(ops.env);
    expect(ctx.domain).toBe(ops.domain);
    expect(ctx.names).toBe(ops.names);
    expect(ctx.accountId).toBe(ops.accountId);
    expect(ctx.clients).toBe(ops.clients);
    expect(ctx.logger).toBe(ops.logger);
    expect(ctx.pluginConfig).toEqual({});
    // Pre-task-16: both state surfaces still read the SITE's own store -
    // see toPluginContext's doc comment on why nothing may call
    // `plugin.nodes` against a context built this way before task 16.
    expect(ctx.siteState).toBe(ops.state);
    expect(ctx.state).toBe(ops.state);
    expect(ctx.store).toBe(ops.store);
    expect(ctx.save).toBe(ops.save);

    ctx.record('some-node', { arn: 'arn:aws:s3:::example' });
    expect(ops.state.resources['some-node']).toEqual({ arn: 'arn:aws:s3:::example' });
  });
});

describe('main - pds dispatch', () => {
  it('exits 1 with "unknown pds action: (none)" when no action is given', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['pds'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      unreachableDiscoveryPorts,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown pds action: (none)']);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it('exits 1 with "unknown pds action: bogus" for an unrecognised action', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['pds', 'bogus'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      unreachableDiscoveryPorts,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown pds action: bogus']);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });
});

describe('main - status dispatch', () => {
  it('reaches commands.status, which completes despite a rejecting AWS transport', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { makeContext, contexts } = testContextFactory(terminal);

    const code = await main(
      ['status'],
      fixedTerminal(terminal),
      makeContext,
      unreachableDiscoveryPorts,
    );

    expect(code).toBe(0);
    const ctx = contexts[0];
    if (!ctx) throw new Error('expected main to build a context for the status dispatch');
    // commands.ts's status() writes this header before reading any node, and
    // catches each node's read failure - the default test context's clients
    // reject every AWS call - so the command still completes and returns 0.
    expect(terminal.writes[0]).toBe(`Status for "production" (bucket ${ctx.names.bucket})`);
  });
});

describe('RESERVED_COMMANDS', () => {
  it('equals the CLI\'s own dispatch set, including "init", "preview" and "plugin" which dispatch outside KNOWN_COMMANDS', () => {
    // This literal list is independent of known-commands.ts's own
    // KNOWN_COMMANDS/union construction on purpose: if a built-in is ever
    // added to KNOWN_COMMANDS without being folded into RESERVED_COMMANDS
    // too (or one of the three names dispatched ahead of KNOWN_COMMANDS -
    // init, preview, plugin - is ever dropped from the union), this test
    // fails instead of silently letting a plugin shadow that command.
    expect([...RESERVED_COMMANDS].sort()).toEqual(
      [
        'bootstrap',
        'delete',
        'deploy',
        'destroy',
        'history',
        'init',
        'logs',
        'plugin',
        'preview',
        'rollback',
        'status',
      ].sort(),
    );
  });

  it('does not reserve "pds" - see plugins.ts\'s module comment for why', () => {
    expect(RESERVED_COMMANDS.has('pds')).toBe(false);
  });
});
