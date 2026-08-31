/**
 * Dispatch-level tests for `main`. `main` takes its terminal, context and
 * discovery-ports factories as parameters (see cli.ts's `TerminalFactory`,
 * `ContextFactory` and `DiscoveryPortsFactory`), so these drive it with
 * `createScriptedTerminal`, a stub over `createTestContext`, and a map-backed
 * `{ fs, loader }` pair - never a module mock, never real disk or AWS
 * (DEVELOPMENT.md: "tests substitute at the port"). They pin today's help,
 * unknown-command, `pds`, and `status` behaviour so later dispatch-rebuild
 * tasks have a regression net. Task 29 rewrote the `pds` half: the
 * namespace is dispatched by `runPlugin` now, so those cases assert generic
 * dispatch over the REAL bundled plugin object rather than a hardcoded
 * branch in `cli.ts`.
 */

import {
  createMemoryFileSystem,
  createNodeFileSystem,
  createScriptedTerminal,
  findRepoRoot,
  type Plugin,
  type ScriptedTerminal,
} from 'blogwright-core';
import pdsPlugin from 'blogwright-pds';
import { describe, expect, it } from 'vitest';

import {
  main,
  type ContextFactory,
  type DiscoveryPortsFactory,
  type PackageManagerFactory,
} from './cli.js';
import { cliPackageDir, loadConfig, type ContextOptions, type OpsContext } from './context.js';
import { RESERVED_COMMANDS } from './known-commands.js';
import { createLogger } from './logger.js';
import { toPluginContext } from './plugin-commands.js';
import type { ModuleLoader } from './ports.js';
import {
  buildDiscoveryPorts,
  createFakeModuleLoader,
  createTestContext,
  makeFakePlugin,
  scopedStateOnlyS3,
  withBrokenPlugin,
  type FakePluginSpec,
  type RecordedRun,
} from './test-support.js';

/**
 * An independent copy of the `USAGE` constant in `cli.ts`, pinned
 * byte-exact. This is the regression net tasks 11 and 29 rebuild help
 * output against - an import of the live constant would not catch a change
 * to it, so the text is duplicated here on purpose.
 *
 * MOVED DELIBERATELY AT TASK 26, and this is the only edit this pin has
 * taken: the fifteen static `pds …` lines are gone from both copies. Task
 * 26 declares `"blogwright": { "plugin": "pds" }` in
 * `packages/pds/package.json`, which makes the bundled `blogwright-pds`
 * package a DISCOVERED plugin, so task 11's dynamic `Plugins:` section
 * renders every pds action from the plugin's own `description` and its
 * commands' `summary` fields. Keeping the static block until task 29
 * deletes `runPds` would list all six actions twice, in every repo, for the
 * whole span 26 -> 29. The rest of the constant - every other command, and
 * every `Options:` line - is byte-identical to what task 07 pinned, which
 * is what a reviewer should check: this is one block removed, not a pin
 * re-typed from whatever the code now emits.
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

  plugin add <name>           Install a plugin, pinned to this CLI's own
                              version (analytics -> blogwright-analytics)
  plugin list                 List installed plugins: namespace, package,
                              version and the config key each owns
  plugin remove <name>        Uninstall a plugin, asking first whether to tear
                              down the resources it provisioned

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
function testContextFactory(
  terminal: ScriptedTerminal,
  // The raw config DOCUMENT every context this factory builds carries -
  // what `resolvePluginConfig` (`plugins.ts`) reads a dispatched plugin's
  // own block off. Defaults to `createTestContext`'s own empty document, so
  // every existing caller is unchanged; the pds cases below seed a real
  // block, because the bundled plugin declares a `validateConfig` and
  // generic dispatch runs it.
  overrides: { configDocument?: Record<string, unknown> } = {},
): {
  makeContext: ContextFactory;
  contexts: OpsContext[];
} {
  const contexts: OpsContext[] = [];
  const makeContext: ContextFactory = async (opts) => {
    const ctx = createTestContext({
      env: opts.env,
      ports: opts.ports,
      logger: createLogger(terminal),
      ...(overrides.configDocument ? { configDocument: overrides.configDocument } : {}),
      // Every dispatched plugin command now runs through `toPluginContext`,
      // which loads the plugin's own scoped store - a call the tests below
      // that dispatch a command, but don't care about state, never asked
      // for. `scopedStateOnlyS3` answers that ONE key shape with a fresh,
      // empty state and leaves every other read at `createTestContext`'s
      // own reject-everything default.
      clients: { s3: scopedStateOnlyS3() },
    });
    contexts.push(ctx);
    return ctx;
  };
  return { makeContext, contexts };
}

/**
 * A `DiscoveryPortsFactory` that throws if called - used below for the
 * `status` dispatch, a fully built-in command whose path never reaches
 * `runPlugin` or any USAGE print site, so discovery must never run at all.
 */
const unreachableDiscoveryPorts: DiscoveryPortsFactory = () => {
  throw new Error('unexpected: discovery ports built for a command that should never reach it');
};

/**
 * A `PackageManagerFactory` that throws if called. Every `main` call in this
 * file passes it, which is the point: `blogwright plugin add` and `plugin
 * remove` (task 18) are the ONLY commands that may reach the `PackageManager`
 * port, and both are covered in `plugin-commands.test.ts`. A regression that
 * built - let alone called - a package manager for `--help`, `init`, `status`,
 * `pds`, `preview`, plugin dispatch or `plugin list` fails here rather than
 * shelling out to `pnpm` on someone's machine.
 */
const unreachablePackages: PackageManagerFactory = () => {
  throw new Error('unexpected: package manager built for a command that should never reach it');
};

/**
 * A `ModuleLoader` that throws if any method is called - for the
 * "discovery cannot even start" tests below, where `findRepoRoot` or
 * `discover`'s own `package.json` read fails before `ports.loader` is ever
 * touched at all.
 */
const neverLoader: ModuleLoader = {
  resolve: async () => {
    throw new Error('unexpected: ModuleLoader.resolve called before discovery could reach it');
  },
  packageJsonPathFor: async () => {
    throw new Error(
      'unexpected: ModuleLoader.packageJsonPathFor called before discovery could reach it',
    );
  },
  load: async () => {
    throw new Error('unexpected: ModuleLoader.load called before discovery could reach it');
  },
};

/**
 * One discovered plugin shared by the "help reflects installed plugins"
 * tests below: a single namespace, a single command, nothing else -
 * `makeFakePlugin`'s four-action "fake" plugin (used by the dispatch tests
 * above) is deliberately not reused here, because those assertions are
 * about action MATCHING, not about what `--help` renders from a plugin's
 * `description`/`summary` fields.
 */
const WIDGET_PLUGIN: Plugin = {
  name: 'widget',
  description: 'manage widgets',
  commands: [{ action: 'sync', summary: 'sync widgets', run: async () => undefined }],
};

/**
 * `EXPECTED_USAGE` with `WIDGET_PLUGIN`'s section appended, exactly as
 * `buildHelp` (`cli.ts`) is specified to render it - the plugin's
 * `description` as a header, one line per command built from `action` and
 * `summary`. Hand-typed independently of `cli.ts`'s own rendering code, the
 * same way `EXPECTED_USAGE` itself is independent of the live `USAGE`
 * constant, so a rendering bug in `buildHelp` cannot pass by construction.
 */
const EXPECTED_HELP_WITH_WIDGET = `${EXPECTED_USAGE}
Plugins:

  widget - manage widgets
    sync - sync widgets
`;

describe('main - help and error surface', () => {
  it('runs discovery, and with no plugins installed prints USAGE byte-identical to the task-07 pin, exiting 0 for --help', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([]);
    let discoveryPortsCalls = 0;
    const makeDiscoveryPorts: DiscoveryPortsFactory = () => {
      discoveryPortsCalls += 1;
      return { fs, loader };
    };

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      makeDiscoveryPorts,
      unreachablePackages,
    );

    expect(code).toBe(0);
    // Byte-identical to today's USAGE: the pin every plugin-section change
    // in this task must keep passing, per task 07 and this task's own DoD.
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
    expect(terminal.errors).toEqual([]);
    // Discovery genuinely ran for --help, not merely "did not crash" -
    // `unreachableDiscoveryPorts` above would have thrown had `main` never
    // called `makeDiscoveryPorts` at all.
    expect(discoveryPortsCalls).toBe(1);
  });

  it('runs discovery and prints USAGE byte-identical to the task-07 pin, exiting 1 for a bare invocation', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([]);
    let discoveryPortsCalls = 0;
    const makeDiscoveryPorts: DiscoveryPortsFactory = () => {
      discoveryPortsCalls += 1;
      return { fs, loader };
    };

    const code = await main(
      [],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      makeDiscoveryPorts,
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
    expect(discoveryPortsCalls).toBe(1);
  });

  it('appends one section per discovered plugin to --help, ordered by plugin name regardless of dependency/discovery order', async () => {
    // `blogwright-a-pkg` sorts FIRST among dependency names (and so is
    // resolved and loaded first) yet declares the plugin named "zzz";
    // `blogwright-z-pkg` sorts and loads SECOND yet declares "aaa". If
    // `buildHelp` rendered sections in discovery order rather than sorting
    // by `Plugin.name`, this would render "zzz" before "aaa" - the opposite
    // of what is asserted below.
    const terminal = createScriptedTerminal({ interactive: false });
    const aaaPlugin: Plugin = {
      name: 'aaa',
      description: 'the aaa plugin',
      commands: [{ action: 'sync', summary: 'sync aaa', run: async () => undefined }],
    };
    const zzzPlugin: Plugin = {
      name: 'zzz',
      description: 'the zzz plugin',
      commands: [{ action: 'sync', summary: 'sync zzz', run: async () => undefined }],
    };
    const specs: FakePluginSpec[] = [
      { packageName: 'blogwright-a-pkg', namespace: 'zzz', plugin: zzzPlugin },
      { packageName: 'blogwright-z-pkg', namespace: 'aaa', plugin: aaaPlugin },
    ];
    const { fs, loader } = await buildDiscoveryPorts(specs);

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(terminal.writes).toEqual([
      `${EXPECTED_USAGE}
Plugins:

  aaa - the aaa plugin
    sync - sync aaa

  zzz - the zzz plugin
    sync - sync zzz
`,
    ]);
  });

  it('lists the generic lifecycle verbs under a plugin that contributes nodes, and none under one that does not', async () => {
    // The three verbs are conditional on `plugin.nodes` at dispatch
    // (`genericLifecycleCommand`, `plugin-commands.ts`), so the listing must
    // be conditional on exactly the same thing: `gadget` answers none of
    // them and must advertise none, while `widget` answers all three -
    // including `hollow`, which declares no commands at all and rendered
    // here as a bare description line with nothing under it.
    const terminal = createScriptedTerminal({ interactive: false });
    const gadget: Plugin = {
      name: 'gadget',
      description: 'manage gadgets',
      commands: [{ action: 'poke', summary: 'poke gadgets', run: async () => undefined }],
    };
    const widget: Plugin = { ...WIDGET_PLUGIN, nodes: () => [] };
    const hollow: Plugin = {
      name: 'hollow',
      description: 'contributes nodes and nothing else',
      commands: [],
      nodes: () => [],
    };
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-gadget', namespace: 'gadget', plugin: gadget },
      { packageName: 'blogwright-hollow', namespace: 'hollow', plugin: hollow },
      { packageName: 'blogwright-widget', namespace: 'widget', plugin: widget },
    ]);

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    // Hand-typed rather than built from the module's own constant, the same
    // way EXPECTED_USAGE is - a summary that drifts from the one the verb
    // dispatches under must fail here.
    expect(terminal.writes).toEqual([
      `${EXPECTED_USAGE}
Plugins:

  gadget - manage gadgets
    poke - poke gadgets

  hollow - contributes nodes and nothing else
    bootstrap - reconcile this plugin's resources
    status - show this plugin's resource status
    destroy - tear down this plugin's resources

  widget - manage widgets
    sync - sync widgets
    bootstrap - reconcile this plugin's resources
    status - show this plugin's resource status
    destroy - tear down this plugin's resources
`,
    ]);
  });

  it("leaves a working plugin's section rendered when another plugin fails to load, surfacing the failure with no stack trace", async () => {
    const goodPlugin: Plugin = {
      name: 'good',
      description: 'a good plugin',
      commands: [{ action: 'sync', summary: 'sync it', run: async () => undefined }],
    };
    const terminal = createScriptedTerminal({ interactive: false });
    const base = await buildDiscoveryPorts([
      { packageName: 'blogwright-good', namespace: 'good', plugin: goodPlugin },
    ]);
    const { fs, loader } = await withBrokenPlugin(base, 'blogwright-broken');

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(terminal.writes).toEqual([
      `${EXPECTED_USAGE}
Plugins:

  good - a good plugin
    sync - sync it

Plugins that failed to load:
  blogwright-broken: plugin package "blogwright-broken"'s Plugin.name is required - the CLI namespace it claims, e.g. "analytics"
`,
    ]);
  });

  it('dispatches the built-in `plugin` namespace instead of the switch default, listing its actions and exiting 1 for a bare `blogwright plugin`', async () => {
    // `plugin` is in `KNOWN_COMMANDS`, so no installed plugin can claim the
    // name - but `main` now intercepts it ahead of the switch (task 17), so
    // it never reaches the switch's `default:` arm any more. That arm is
    // consequently unreachable and documented as such in `cli.ts`: every
    // other member of `KNOWN_COMMANDS` has a case.
    const terminal = createScriptedTerminal({ interactive: false });
    const base = await buildDiscoveryPorts([
      { packageName: 'blogwright-widget', namespace: 'widget', plugin: WIDGET_PLUGIN },
    ]);

    const code = await main(
      ['plugin'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => base,
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown plugin action: (none)']);
    expect(terminal.writes).toEqual([
      `"plugin" actions:
  add - install a plugin package, pinned to the CLI's own version
  list - show installed plugins, their versions and the config key each owns
  remove - uninstall a plugin package, asking first about its teardown`,
    ]);
  });

  it('runs `blogwright plugin list` without ever building an OpsContext, so it works with no config and no AWS credentials', async () => {
    // The whole reason `cli.ts` dispatches `plugin` beside `init` rather
    // than from the switch: `createContext` loads `config/<env>.jsonc` and
    // calls `sts.getAccountId()`. This `ContextFactory` throws if it is ever
    // called, so a regression that moved the dispatch below `makeContext`
    // fails here rather than only on an operator's unconfigured repo.
    const terminal = createScriptedTerminal({ interactive: false });
    const base = await buildDiscoveryPorts([
      { packageName: 'blogwright-widget', namespace: 'widget', plugin: WIDGET_PLUGIN },
    ]);
    const refuseContext: ContextFactory = () => {
      throw new Error('createContext must not run for `blogwright plugin list`');
    };

    const code = await main(
      ['plugin', 'list'],
      fixedTerminal(terminal),
      refuseContext,
      () => base,
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(terminal.errors).toEqual([]);
    expect(terminal.writes).toEqual([
      'namespace package version configKey',
      'widget blogwright-widget (unknown) (none)',
    ]);
  });

  it('falls back to plain USAGE (not a crash) when --help runs outside any discoverable repo, exiting 0', async () => {
    // An EMPTY memory fs has no `.git`/`.jj` anywhere above `process.cwd()`,
    // so `findRepoRoot` throws before `discover` is ever reached - exactly
    // what running `blogwright --help` in a freshly created empty directory
    // looks like. `--help` must still answer with today's USAGE rather than
    // surfacing that internal failure and refusing to print anything.
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs: createMemoryFileSystem(), loader: neverLoader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
    expect(terminal.errors).toEqual([]);
  });

  it('falls back to plain USAGE outside any discoverable repo for a bare invocation too, exiting 1', async () => {
    const terminal = createScriptedTerminal({ interactive: false });

    const code = await main(
      [],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs: createMemoryFileSystem(), loader: neverLoader }),
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it('falls back to plain USAGE when --help runs inside a repo with no root package.json yet, exiting 0', async () => {
    // A repo before its first `npm init`: the `.jj` marker `findRepoRoot`
    // needs is present, but `<repoRoot>/package.json` is not - the second
    // regression the D1 review reproduced against the built binary (`.git`
    // present, no root `package.json`).
    const terminal = createScriptedTerminal({ interactive: false });
    const repoRoot = await findRepoRoot(createNodeFileSystem());
    const fs = createMemoryFileSystem({ [`${repoRoot}/.jj`]: '' });

    const code = await main(
      ['--help'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader: neverLoader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
    expect(terminal.errors).toEqual([]);
  });

  it('falls back to plain USAGE inside a repo with no root package.json for a bare invocation too, exiting 1', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const repoRoot = await findRepoRoot(createNodeFileSystem());
    const fs = createMemoryFileSystem({ [`${repoRoot}/.jj`]: '' });

    const code = await main(
      [],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader: neverLoader }),
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it('does NOT swallow a malformed root package.json - an unrelated discovery failure still propagates out of --help rather than being papered over', async () => {
    // Proves the D1 fix's guard is narrow: it tolerates a MISSING
    // package.json (the "nothing set up yet" precondition above) but a
    // present, unparseable one is an actual defect worth surfacing, not a
    // reason to quietly fall back to USAGE. Without the `isMissingPackageJsonError`/
    // `isNoRepoRootError` narrowing (i.e. if `helpText` swallowed every
    // `Error` from `findRepoRoot`/`discover`), this would resolve to
    // `EXPECTED_USAGE` instead of rejecting.
    const terminal = createScriptedTerminal({ interactive: false });
    const repoRoot = await findRepoRoot(createNodeFileSystem());
    const fs = createMemoryFileSystem({
      [`${repoRoot}/.jj`]: '',
      [`${repoRoot}/package.json`]: 'not valid json {',
    });

    await expect(
      main(
        ['--help'],
        fixedTerminal(terminal),
        testContextFactory(terminal).makeContext,
        () => ({
          fs,
          loader: neverLoader,
        }),
        unreachablePackages,
      ),
    ).rejects.toThrow(/failed to parse .*package\.json as JSON/);
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
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual([
      '✗ no built-in command or installed plugin claims "frobnicate" - run ' +
        '`blogwright plugin list` to see what is installed',
    ]);
    expect(terminal.writes).toEqual([]);
  });
});

describe('main - init dispatch', () => {
  it('discovers installed plugins and asks their questions in deterministic (name-sorted) order, writing every block into the one file', async () => {
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });
    const asked: string[] = [];
    const zzz: Plugin = {
      name: 'zzz',
      description: 'plugin zzz',
      commands: [],
      configKey: 'zzz',
      init: async () => {
        asked.push('zzz');
        return [{ property: '"x": true' }];
      },
    };
    const aaa: Plugin = {
      name: 'aaa',
      description: 'plugin aaa',
      commands: [],
      configKey: 'aaa',
      init: async () => {
        asked.push('aaa');
        return [{ property: '"y": true' }];
      },
    };
    // A package's name and the plugin namespace it exports are independent,
    // and here they are deliberately inverted: `blogwright-aaa` exports the
    // plugin named "zzz", `blogwright-zzz` the one named "aaa". Discovery
    // enumerates CANDIDATES in package-name order (`plugins.ts`'s
    // `pluginDependencyNames` sorts them), so `discover` hands the wizard
    // "zzz" first here whichever order this array is written in. The wizard
    // asking "aaa" first can therefore only come from the init path sorting
    // by PLUGIN name of its own accord (`init.ts`'s `collectPluginBlocks`) -
    // with that sort removed, `asked` comes back as ['zzz', 'aaa'] and this
    // fails. A fixture whose package names matched its plugin names would
    // pin nothing: discovery's own ordering would satisfy it either way.
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-zzz', namespace: 'aaa', plugin: aaa },
      { packageName: 'blogwright-aaa', namespace: 'zzz', plugin: zzz },
    ]);
    const repoRoot = await findRepoRoot(fs);

    const code = await main(
      ['init'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(asked).toEqual(['aaa', 'zzz']);
    const written = await fs.readText(`${repoRoot}/config/production.jsonc`);
    expect(written).toContain('"aaa": {\n    "y": true\n  }');
    expect(written).toContain('"zzz": {\n    "x": true\n  }');
    // Written in the same sorted order they were asked in, not discovery's.
    expect(written.indexOf('"aaa"')).toBeLessThan(written.indexOf('"zzz"'));
  });

  it('runs the plain four-question wizard AND warns, rather than crashing on plugin discovery, when there is no repo root or root package.json at all', async () => {
    // blogwright init is exactly the wizard that bootstraps a repo, so this
    // is not a hypothetical: a genuinely first run may have neither. A
    // sibling task's own gate caught an unguarded discovery call breaking
    // `blogwright --help` outside a repo the same way - this pins the fix
    // on init's own discovery call. The tolerance is narrow - mirroring
    // `helpText`'s own `isMissingPackageJsonError` - so this also pins that
    // the warning names the SPECIFIC "missing package.json" precondition,
    // not a blanket "something went wrong" catch-all.
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });
    const fs = createMemoryFileSystem();
    const loader = createFakeModuleLoader([]);

    const code = await main(
      ['init'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(0);
    expect(terminal.errors).toHaveLength(1);
    expect(terminal.errors[0]).toContain('no package.json found at');
    expect(terminal.errors[0]).toContain('continuing with no plugins discovered');
    const written = await fs.readText(`${process.cwd()}/config/production.jsonc`);
    expect(written).toContain('"siteName": "myblog"');
  });

  it('never touches the ModuleLoader for a non-interactive invocation - it refuses before discovery, not after', async () => {
    // D3: discovery (and therefore importing every installed plugin's
    // module) must not run for a command that is about to decline anyway.
    //
    // The fixture has a plugin actually INSTALLED on purpose. Against an
    // empty `createMemoryFileSystem()` the three call logs below stay empty
    // whether or not the guard exists - `discover` would abort at its first
    // precondition (reading the repo's own package.json) long before
    // resolving a single candidate - so the assertions could never fail. With
    // `blogwright-aaa` resolvable, dropping the `!terminal.isInteractive`
    // guard from cli.ts's `init` branch makes all three non-empty and fails
    // this test.
    const terminal = createScriptedTerminal({ interactive: false });
    const installed: Plugin = {
      name: 'aaa',
      description: 'plugin aaa',
      commands: [],
      configKey: 'aaa',
      init: async () => [{ property: '"y": true' }],
    };
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-aaa', namespace: 'aaa', plugin: installed },
    ]);

    const code = await main(
      ['init'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(loader.resolveCalls).toEqual([]);
    expect(loader.packageJsonPathForCalls).toEqual([]);
    expect(loader.loadCalls).toEqual([]);
    expect(terminal.errors.some((l) => l.includes('interactive wizard'))).toBe(true);
  });

  it('propagates a genuine discovery defect (a malformed root package.json) rather than silently discarding plugin config blocks', async () => {
    // D1: the tolerance is narrow. A malformed package.json is a real
    // defect - not a "nothing set up yet" state - so it must NOT be
    // swallowed into "no plugins found" the way a missing file is.
    // Otherwise an operator with a typo'd package.json and a plugin
    // installed gets a config silently missing that plugin's block and a
    // success exit, discovering the problem only later.
    const terminal = createScriptedTerminal({ answers: ['myblog', '', '', ''] });
    const repoRoot = await findRepoRoot(createNodeFileSystem());
    const fs = createMemoryFileSystem({
      [`${repoRoot}/.jj`]: '',
      [`${repoRoot}/package.json`]: '{ this is not json',
      [`${cliPackageDir()}/package.json`]: '{}',
    });
    const loader = createFakeModuleLoader([]);

    await expect(
      main(
        ['init'],
        fixedTerminal(terminal),
        testContextFactory(terminal).makeContext,
        () => ({
          fs,
          loader,
        }),
        unreachablePackages,
      ),
    ).rejects.toThrow(/failed to (read or )?parse/);

    expect(await fs.exists(`${repoRoot}/config/production.jsonc`)).toBe(false);
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
      unreachablePackages,
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
      unreachablePackages,
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
      unreachablePackages,
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
      unreachablePackages,
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
      unreachablePackages,
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
      unreachablePackages,
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
        // `toPluginContext` loads the plugin's own scoped store - see
        // `testContextFactory`'s own doc comment above for why this default
        // is needed once a command actually dispatches.
        clients: { s3: scopedStateOnlyS3() },
      });
    };

    const code = await main(
      ['fake', 'sync', 'staging'],
      fixedTerminal(terminal),
      makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
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
      unreachablePackages,
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
      unreachablePackages,
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
      await main(
        [command],
        fixedTerminal(terminal),
        makeContext,
        makeDiscoveryPorts,
        unreachablePackages,
      ).catch(() => undefined);
    }

    expect(discoveryPortsCalls).toBe(0);
    expect(loader.resolveCalls).toEqual([]);
    expect(loader.packageJsonPathForCalls).toEqual([]);
    expect(loader.loadCalls).toEqual([]);
  });
});

describe('toPluginContext', () => {
  it('adapts an OpsContext with no cast, supplying pluginConfig/siteState/record and scoping store/state/save to the plugin', async () => {
    const ops = createTestContext({ env: 'staging', clients: { s3: scopedStateOnlyS3() } });

    const ctx = await toPluginContext(ops, 'demo', {});

    expect(ctx.env).toBe(ops.env);
    expect(ctx.domain).toBe(ops.domain);
    expect(ctx.names).toBe(ops.names);
    expect(ctx.accountId).toBe(ops.accountId);
    expect(ctx.clients).toBe(ops.clients);
    expect(ctx.logger).toBe(ops.logger);
    expect(ctx.pluginConfig).toEqual({});
    // siteState is the SITE's own state, passed straight through, read-only.
    expect(ctx.siteState).toBe(ops.state);
    // store/state/save are scoped to the plugin's own name - genuinely
    // distinct objects from the site's own, not merely type-compatible with
    // it. See `plugin-commands.test.ts`'s own `toPluginContext` describe
    // block for the test that pins the exact scoped state key.
    expect(ctx.store).not.toBe(ops.store);
    expect(ctx.state).not.toBe(ops.state);
    expect(ctx.save).not.toBe(ops.save);

    ctx.record('some-node', { arn: 'arn:aws:s3:::example' });
    expect(ctx.state.resources['some-node']).toEqual({ arn: 'arn:aws:s3:::example' });
    expect(ops.state.resources['some-node']).toBeUndefined();
  });
});

/*
 * TASK 29 - `blogwright pds <action>` is answered by generic plugin
 * dispatch, and `cli.ts` no longer knows the namespace exists.
 *
 * The `command === 'pds'` branch that sat AHEAD of the `KNOWN_COMMANDS`
 * membership test is gone, so `pds` falls through to `runPlugin` exactly
 * like any other installed namespace. Every case in the previous version of
 * this block asserted the opposite - that the hardcoded branch won - and all
 * six failed the moment the branch was deleted, which is what made them
 * worth having. They are rewritten below to assert the behaviour that
 * replaced them; each move is named where it happens. Two deliberate,
 * user-visible changes come out of the rewrite:
 *
 *   - An unknown action's refusal now prints the PLUGIN's action listing
 *     (`renderActions`, `plugin-commands.ts`) instead of the whole of
 *     USAGE. That is what every other namespace already did, and it lists
 *     the six actions plus the three lifecycle verbs rather than burying
 *     them under the built-in command table. The case that pinned "an
 *     unknown pds action prints USAGE with a discovered plugin's section
 *     appended" is therefore gone: no such path exists any more. The same
 *     wiring is still pinned for `preview` and for `main`'s
 *     unknown-command default, which do still print USAGE.
 *   - The multi-line guidance the static `pds login`/`pds sync` USAGE lines
 *     carried is gone, replaced by the plugin's own one-line `summary`
 *     fields. Named in the changeset as the small regression it is.
 *
 * THE FIXTURE IS THE REAL PLUGIN. `packages/pds/src/plugin.ts`'s default
 * export, with only the six `run` functions swapped for recorders: `name`,
 * `description`, `configKey`, `validateConfig`, `nodes` and - the point of
 * this task - the six declared action strings and their summaries are the
 * shipped ones. A stand-in that re-typed `secret status` would prove
 * nothing about whether the DECLARED multi-word action dispatches, which is
 * the whole substance of the migration. Discovery is still substituted at
 * the port (a map-backed `{ fs, loader }`); `plugins.test.ts` owns the
 * real-disk proof that this very object is what `discover` finds from a
 * consuming repo.
 */
describe('main - pds dispatch (generic, through runPlugin)', () => {
  /** The plugin's one-line `description`, as `--help` renders it. */
  const PDS_DESCRIPTION =
    'standard.site (AT Protocol) publishing: OAuth client, publication setup and record sync';

  /**
   * The six declared actions and their summaries, hand-typed from
   * `packages/pds/src/plugin.ts` rather than read off the imported object:
   * a listing derived from the plugin would agree with it no matter what it
   * said. This is the pin behind "`blogwright --help` still lists all six
   * pds actions, each with a one-line summary".
   */
  const PDS_ACTION_LINES = [
    'keygen - generate the OAuth client key: private JWK into Secrets Manager, public documents into public/oauth/',
    'login - interactive OAuth bootstrap, storing the session in Secrets Manager (--identifier <handle-or-did>)',
    'init - create or update the standard.site publication record and write the site verification files',
    'sync - reconcile site.standard.document records with the content collection (production only)',
    'secret status - show the secret metadata - never the value',
    'secret delete - delete the secret, logging out and discarding the key (--yes)',
  ];

  /**
   * The three generic lifecycle verbs the host adds for a plugin
   * contributing `nodes` (`genericLifecycleActions`). Listed after the
   * declared six in both renderers, and - unlike between tasks 26 and 29 -
   * now actually answered.
   */
  const PDS_LIFECYCLE_LINES = [
    "bootstrap - reconcile this plugin's resources",
    "status - show this plugin's resource status",
    "destroy - tear down this plugin's resources",
  ];

  const ALL_PDS_LINES = [...PDS_ACTION_LINES, ...PDS_LIFECYCLE_LINES];

  /** `--help` with the bundled plugin discovered and nothing else installed. */
  const EXPECTED_HELP_WITH_PDS = `${EXPECTED_USAGE}
Plugins:

  pds - ${PDS_DESCRIPTION}
${ALL_PDS_LINES.map((line) => `    ${line}`).join('\n')}
`;

  /** What an unknown action's refusal prints - `renderActions`, two spaces of indent. */
  const EXPECTED_PDS_ACTIONS = ['"pds" actions:', ...ALL_PDS_LINES.map((line) => `  ${line}`)].join(
    '\n',
  );

  /**
   * A repo that HAS configured the plugin. Seeded as the raw config
   * DOCUMENT, which is what `resolvePluginConfig` reads (`plugins.ts`) -
   * not the merged `OpsConfig`, which stays without a `pds` block on
   * purpose so the plugin's `nodes` contributor returns nothing and the
   * generic `bootstrap` case below reconciles an empty graph instead of
   * reaching for AWS.
   */
  const CONFIGURED = { pds: { name: 'Example', secretName: 'example/atproto' } };

  /**
   * The shipped plugin with recording `run`s. Spread, not rebuilt: every
   * member except `commands` is the real one, and each command keeps its
   * real `action` and `summary`.
   */
  function recordingPdsPlugin(calls: RecordedRun[]): Plugin<unknown> {
    return {
      ...pdsPlugin,
      commands: pdsPlugin.commands.map((command) => ({
        action: command.action,
        summary: command.summary,
        run: async (ctx, args) => {
          calls.push({ action: command.action, ctx, args });
        },
      })),
    };
  }

  /**
   * Run `main` with the bundled plugin discovered as `blogwright-pds` from
   * the CLI's OWN dependencies (`bundled: true`) - the shape task 26 proved
   * against real disk, and the only way the plugin reaches a consuming repo
   * that depends on `blogwright` alone.
   */
  async function dispatchPds(
    argv: string[],
    opts: { configDocument?: Record<string, unknown> } = {},
  ) {
    const terminal = createScriptedTerminal({ interactive: false });
    const calls: RecordedRun[] = [];
    const { fs, loader } = await buildDiscoveryPorts([
      {
        packageName: 'blogwright-pds',
        namespace: 'pds',
        plugin: recordingPdsPlugin(calls),
        bundled: true,
      },
    ]);
    const { makeContext, contexts } = testContextFactory(terminal, {
      configDocument: opts.configDocument ?? CONFIGURED,
    });
    const run = main(
      argv,
      fixedTerminal(terminal),
      makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );
    return { run, calls, terminal, contexts };
  }

  /** `{ action, args }` for each recorded run - the ctx is asserted separately. */
  function reached(calls: RecordedRun[]) {
    return calls.map((call) => ({ action: call.action, args: call.args }));
  }

  it('dispatches `pds sync` to the declared `sync` action, defaulting to production', async () => {
    const { run, calls, contexts } = await dispatchPds(['pds', 'sync']);

    expect(await run).toBe(0);
    expect(reached(calls)).toEqual([{ action: 'sync', args: [] }]);
    expect(contexts.map((ctx) => ctx.env)).toEqual(['production']);
  });

  it('dispatches `pds login --identifier alice.example`, passing the identifier through', async () => {
    // `--identifier` stays a `main`-level flag (`cli.ts`'s option table) and
    // reaches the plugin as an ordinary token pair via `serialiseFlags`, so
    // `cli.ts` forwards it without knowing what it means. The plugin's own
    // `flagValue` read of that pair is pinned in `packages/pds`.
    const { run, calls, contexts } = await dispatchPds([
      'pds',
      'login',
      '--identifier',
      'alice.example',
    ]);

    expect(await run).toBe(0);
    expect(reached(calls)).toEqual([{ action: 'login', args: ['--identifier', 'alice.example'] }]);
    expect(contexts.map((ctx) => ctx.env)).toEqual(['production']);
  });

  it('dispatches the two-word `pds secret status` by declaration, consuming both words', async () => {
    const { run, calls, contexts } = await dispatchPds(['pds', 'secret', 'status']);

    expect(await run).toBe(0);
    // One recorded run, under the two-word action name - not a `secret`
    // action handed `['status']`, which is what a positional shift would
    // have produced.
    expect(reached(calls)).toEqual([{ action: 'secret status', args: [] }]);
    expect(contexts.map((ctx) => ctx.env)).toEqual(['production']);
  });

  it('dispatches `pds secret delete --yes`, forwarding the confirmation flag', async () => {
    const { run, calls } = await dispatchPds(['pds', 'secret', 'delete', '--yes']);

    expect(await run).toBe(0);
    expect(reached(calls)).toEqual([{ action: 'secret delete', args: ['--yes'] }]);
  });

  /*
   * THE ENVIRONMENT POSITIONAL - the regression this task could most easily
   * have shipped. `runPds` resolved it by hand at `cli.ts:196`, shifting by
   * one for the `secret` sub-action; `runPlugin` resolves it as the first
   * positional left over once the MATCHED action's words are consumed. If
   * that arithmetic were wrong by one, every environment-qualified pds
   * command would silently target production and nothing else in this file
   * would notice.
   */
  it('resolves the environment positional of `pds sync staging` - not production', async () => {
    const { run, calls, contexts } = await dispatchPds(['pds', 'sync', 'staging']);

    expect(await run).toBe(0);
    expect(contexts.map((ctx) => ctx.env)).toEqual(['staging']);
    // And `staging` was consumed as the environment, never handed on as an
    // argument the plugin would have to interpret.
    expect(reached(calls)).toEqual([{ action: 'sync', args: [] }]);
  });

  it('resolves the environment positional of `pds secret status staging` past the two-word action', async () => {
    const { run, calls, contexts } = await dispatchPds(['pds', 'secret', 'status', 'staging']);

    expect(await run).toBe(0);
    expect(contexts.map((ctx) => ctx.env)).toEqual(['staging']);
    expect(reached(calls)).toEqual([{ action: 'secret status', args: [] }]);
  });

  /*
   * THE REFUSALS. Same message shape task 07 pinned - `unknown pds action:
   * <what was typed>` on stderr, exit 1 - now produced by `runPlugin`'s own
   * generic refusal with the plugin's name substituted in, rather than by a
   * branch that spelled `pds` out. What follows it on stdout is the change
   * named at the top of this block: the plugin's own actions, not USAGE.
   */
  it('exits 1 with "unknown pds action: (none)" for `blogwright pds`, listing the plugin\'s actions', async () => {
    const { run, calls, terminal } = await dispatchPds(['pds']);

    expect(await run).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown pds action: (none)']);
    expect(terminal.writes).toEqual([EXPECTED_PDS_ACTIONS]);
    expect(calls).toEqual([]);
  });

  it('exits 1 with "unknown pds action: bogus" for an unrecognised action', async () => {
    const { run, calls, terminal } = await dispatchPds(['pds', 'bogus']);

    expect(await run).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown pds action: bogus']);
    expect(terminal.writes).toEqual([EXPECTED_PDS_ACTIONS]);
    expect(calls).toEqual([]);
  });

  /*
   * TASK 26's PINNED GAP, NOW CLOSED - and this is the case that says so.
   *
   * From task 26 to task 29, `--help` advertised `bootstrap`, `status` and
   * `destroy` for this plugin (it contributes `nodes`) while `runPds`
   * refused all three with `unknown pds action: bootstrap`. Task 26 pinned
   * that contradiction deliberately, so deleting the branch would fail a
   * test that named it rather than let the refusal disappear unremarked.
   * It did fail here, and this is its deliberate replacement: the verb the
   * help advertises is now the verb that runs.
   */
  it('answers the generic `pds bootstrap` its help advertises - the 26 -> 29 gap, closed', async () => {
    const { run, calls, terminal } = await dispatchPds(['pds', 'bootstrap']);

    expect(await run).toBe(0);
    // The host's own verb, not one of the six declared commands: none of
    // them ran, and `runGenericBootstrap` (`plugin-commands.ts`) logged the
    // reconcile it performed against the plugin's own scoped state.
    expect(calls).toEqual([]);
    expect(terminal.writes).toEqual([
      'Bootstrapping "pds" for "production"',
      '✓ bootstrap complete for "pds" in "production"',
    ]);
  });

  it('renders all six actions with their summaries into `blogwright --help`, from the plugin itself', async () => {
    const { run, terminal } = await dispatchPds(['--help']);

    expect(await run).toBe(0);
    expect(terminal.writes).toEqual([EXPECTED_HELP_WITH_PDS]);
    // Spelled out as well as pinned byte-exact above, because "still lists
    // all six pds actions" is the definition-of-done sentence this case
    // discharges.
    for (const line of PDS_ACTION_LINES) expect(terminal.writes[0]).toContain(`    ${line}\n`);
  });

  /*
   * THE DELETION ITSELF. With no plugin claiming `pds`, nothing in `cli.ts`
   * recognises the name at all - the assertion that fails if the hardcoded
   * branch is ever restored, and the counterpart to `RESERVED_COMMANDS`
   * still not reserving it (below). It replaces the two task-07 cases that
   * drove `blogwright pds` against an EMPTY discovery and still expected an
   * answer; a CLI that answers a namespace no installed plugin claims is
   * precisely what this task removed. The real CLI cannot reach this state
   * - `blogwright-pds` is a non-optional dependency of
   * `packages/cli/package.json` (asserted in `commands.test.ts`) - which is
   * why it is reachable here only by seeding discovery with nothing.
   */
  it('treats `pds` as an unknown namespace when no plugin claims it, naming `blogwright plugin list`', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([]);

    const code = await main(
      ['pds', 'sync'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual([
      '✗ no built-in command or installed plugin claims "pds" - run `blogwright plugin list` to see what is installed',
    ]);
  });

  /*
   * A KNOWN DEFECT THIS TASK WIDENS, PINNED THE WAY TASK 26 PINNED ITS OWN.
   *
   * `validatePdsConfig` (`packages/pds/src/config.ts`) dereferences its
   * argument without a guard, so `validatePdsConfig(undefined)` throws a
   * bare `TypeError`. Task 19's dispatch calls `validateConfig` with
   * `undefined` whenever a plugin's block is absent - deliberately, so a
   * plugin's own defaults can apply - and `resolvePluginConfig` wraps
   * whatever comes out. Before this task that was reachable only through
   * `blogwright plugin remove pds`. It is now reachable from every
   * `blogwright pds <action>` on a repo that has not configured the block
   * yet, which is an ordinary first-run state.
   *
   * The regression is in the MESSAGE, not the outcome: all six commands
   * already refused without a block, but through
   * `requirePdsConfig`'s `config has no "pds" section - add it to
   * config/production.jsonc`, which says what to do. What an operator sees
   * now is asserted below, exactly as it is. TASK 28 OWNS THE FIX and this
   * case is expected to fail there - update it to the message that
   * replaces this one; do not delete it.
   */
  it('leaks a TypeError from the plugin validator when the repo has no pds block yet (task 28)', async () => {
    const { run } = await dispatchPds(['pds', 'keygen'], { configDocument: {} });

    const err = await run.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^plugin "pds" rejected the "pds" config block: /);
    // The leak itself: a raw property-access failure, not a validator's own
    // refusal. `requirePdsConfig`'s friendly message never gets a chance to
    // run, because dispatch validates the block before the command does.
    expect((err as Error).cause).toBeInstanceOf(TypeError);
    expect((err as Error).message).not.toContain('config has no "pds" section');
  });
});

describe('main - preview dispatch', () => {
  it('exits 1 with "unknown preview action: bogus", running discovery to build the USAGE it prints', async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([]);

    const code = await main(
      ['preview', 'bogus'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown preview action: bogus']);
    expect(terminal.writes).toEqual([EXPECTED_USAGE]);
  });

  it("appends a discovered plugin's section to the USAGE an unknown preview action prints", async () => {
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([
      { packageName: 'blogwright-widget', namespace: 'widget', plugin: WIDGET_PLUGIN },
    ]);

    const code = await main(
      ['preview'],
      fixedTerminal(terminal),
      testContextFactory(terminal).makeContext,
      () => ({ fs, loader }),
      unreachablePackages,
    );

    expect(code).toBe(1);
    expect(terminal.errors).toEqual(['✗ unknown preview action: (none)']);
    expect(terminal.writes).toEqual([EXPECTED_HELP_WITH_WIDGET]);
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
      unreachablePackages,
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
