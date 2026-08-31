import {
  createClients,
  createMemoryFileSystem,
  deriveNames,
  emptyState,
  mergeConfig,
  StateStore,
  staticCredentials,
  validatePlugin,
  type OpsConfig,
  type PdsConfig,
  type Plugin,
  type PluginContext,
  type PluginLogger,
  type ResourceOutputs,
  type SecretsManagerClient,
  type Terminal,
  type Transport,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import * as commands from './commands.js';
import { validatePdsConfig } from './config.js';
import * as packageExports from './index.js';
import { buildPdsNodes } from './nodes.js';
import plugin, { createPdsPlugin, type PdsCommandFunctions } from './plugin.js';

/**
 * The action strings in the order the CLI's `runPds` set spelled them
 * (`packages/cli/src/cli.ts`), frozen here as they stood before task 29
 * deleted that branch. Written out rather than derived from the plugin, so
 * the enumeration below compares the declaration against the dispatch it had
 * to reproduce - not against itself. That is why the list stays hand-written
 * now the branch is gone: it is the pre-migration contract these
 * declarations replaced, and the only remaining record of it.
 */
const RUNPDS_ACTIONS = ['keygen', 'login', 'init', 'sync', 'secret status', 'secret delete'];

/** The secret every fixture's `pds` block resolves to (`<siteName>/atproto`). */
const SECRET = 'example/atproto';

/** One call the fixture's recording Secrets Manager client received. */
interface SecretCall {
  op: 'describeSecret' | 'deleteSecret';
  name: string;
}

const NOOP_LOGGER: PluginLogger = {
  info: () => undefined,
  step: () => undefined,
  ok: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const silentTerminal: Terminal = {
  isInteractive: false,
  write: () => undefined,
  error: () => undefined,
  status: () => undefined,
  question: async (prompt) => {
    throw new Error(`unexpected terminal prompt in test: ${prompt}`);
  },
};

/** Any AWS call this suite has not deliberately recorded is a defect, not a pass. */
const rejectAllTransport: Transport = async (req) => {
  throw new Error(`unexpected AWS request in test: ${req.method} ${req.url}`);
};

/**
 * A `pds` block for a fixture. The cast mirrors `nodes.test.ts`: core still
 * declares `secretName` as required while a real config file omits it and
 * `mergeConfig` is what fills it in.
 */
function pdsBlock(overrides: Partial<PdsConfig>): PdsConfig {
  return { name: 'Example', ...overrides } as PdsConfig;
}

interface ContextOverrides {
  /** The `pds` block, merged over `{ name: 'Example' }`. Absent means the site configures none. */
  pds?: Partial<PdsConfig> | undefined;
  /** The site's domain. Absent by default - the state `pds keygen`/`pds init` refuse in. */
  domain?: string | undefined;
  /** Merged over `{ siteName: 'example', githubRepo: 'antstanley/example' }`. */
  config?: Partial<OpsConfig> | undefined;
  /** The site's recorded outputs. Defaults to a bootstrapped stack - the deploy role's ARN present. */
  siteResources?: Record<string, ResourceOutputs> | undefined;
}

interface ContextFixture {
  ctx: PluginContext<PdsConfig>;
  /** Every Secrets Manager call a command made, in order. */
  secretCalls: SecretCall[];
}

/**
 * A real `PluginContext<PdsConfig>` - the context the lifecycle verbs build,
 * which is what a plugin command's `run` receives - over a recording Secrets
 * Manager client. Every other client is a genuine core client on a transport
 * that rejects, so an unexpected AWS call is a failure rather than a silent
 * pass.
 */
function createPluginContext(overrides: ContextOverrides = {}): ContextFixture {
  const config = mergeConfig({
    siteName: 'example',
    githubRepo: 'antstanley/example',
    ...overrides.config,
    ...(overrides.pds ? { pds: pdsBlock(overrides.pds) } : {}),
  });
  const env = 'test';
  const accountId = '123456789012';
  const secretCalls: SecretCall[] = [];

  const base = createClients({
    region: config.region,
    credentials: staticCredentials({ accessKeyId: 'test', secretAccessKey: 'test' }),
    transport: rejectAllTransport,
  });
  const secrets: SecretsManagerClient = Object.assign(
    Object.create(base.secrets) as SecretsManagerClient,
    {
      describeSecret: async (name: string) => {
        secretCalls.push({ op: 'describeSecret', name });
        return undefined;
      },
      deleteSecret: async (name: string) => {
        secretCalls.push({ op: 'deleteSecret', name });
      },
    },
  );

  const state = emptyState(env);
  const names = deriveNames(env, accountId, config);
  const ctx: PluginContext<PdsConfig> = {
    env,
    domain: overrides.domain,
    preview: false,
    config,
    pluginConfig: config.pds ?? pdsBlock({}),
    names,
    accountId,
    clients: { ...base, secrets },
    ports: { fs: createMemoryFileSystem(), terminal: silentTerminal },
    logger: NOOP_LOGGER,
    store: new StateStore(base.s3, `${env}-example-${accountId}`, env, 'pds'),
    state,
    siteState: {
      resources: overrides.siteResources ?? {
        'gh-oidc-role': { arn: `arn:aws:iam::${accountId}:role/${names.githubRole}` },
      },
    },
    record: (nodeId, outputs) => {
      state.resources[nodeId] = outputs;
    },
    save: async () => undefined,
  };
  return { ctx, secretCalls };
}

/** One recorded call to an injected command double: which slot, and what it was handed. */
interface CommandCall {
  fn: keyof PdsCommandFunctions;
  ctx: unknown;
  opts?: unknown;
}

/**
 * Doubles for all six wrapped functions, recording the context and the options
 * object each was handed. This is the only way to see what a wrapper passed
 * through: the real `login` reaches the network before the identifier is used,
 * so there is no port on which its argument could be observed instead.
 */
function recordingCommands(): { fns: PdsCommandFunctions; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const fns: PdsCommandFunctions = {
    keygen: async (ctx) => {
      calls.push({ fn: 'keygen', ctx });
    },
    login: async (ctx, opts) => {
      calls.push({ fn: 'login', ctx, opts });
    },
    init: async (ctx) => {
      calls.push({ fn: 'init', ctx });
    },
    sync: async (ctx) => {
      calls.push({ fn: 'sync', ctx });
    },
    secretStatus: async (ctx) => {
      calls.push({ fn: 'secretStatus', ctx });
    },
    secretDelete: async (ctx, opts) => {
      calls.push({ fn: 'secretDelete', ctx, opts });
    },
  };
  return { fns, calls };
}

/** The declared command for `action`, or a failure naming what was declared instead. */
function commandFor(target: Plugin<PdsConfig>, action: string) {
  const command = target.commands.find((candidate) => candidate.action === action);
  if (!command) {
    throw new Error(
      `no "${action}" command declared - got ${JSON.stringify(target.commands.map((c) => c.action))}`,
    );
  }
  return command;
}

/** Run one declared action on the real plugin, with the tokens the host would supply. */
async function run(action: string, ctx: PluginContext<PdsConfig>, args: string[] = []) {
  await commandFor(plugin, action).run(ctx, args);
}

/** The nodes the plugin contributes, or a failure when it declares no contributor at all. */
function contributedNodes(ctx: PluginContext<PdsConfig>) {
  const nodes = plugin.nodes;
  if (!nodes) throw new Error('the plugin declares no nodes contributor');
  return nodes(ctx);
}

describe('the blogwright-pds plugin declaration', () => {
  it("satisfies core's Plugin contract as a package default export", () => {
    expect(validatePlugin({ default: plugin }, 'blogwright-pds')).toBe(plugin);
  });

  it('claims the pds namespace and owns the pds config key', () => {
    expect(plugin.name).toBe('pds');
    expect(plugin.configKey).toBe('pds');
  });

  it('carries a one-line description for `blogwright --help`', () => {
    expect(plugin.description.trim().length).toBeGreaterThan(0);
    expect(plugin.description).not.toContain('\n');
  });

  it('declares exactly the six actions the deleted runPds branch accepted', () => {
    expect(plugin.commands.map((command) => command.action)).toEqual(RUNPDS_ACTIONS);
  });

  it('gives every declared action a non-empty summary', () => {
    expect(plugin.commands.map((command) => command.summary.trim())).not.toContain('');
    expect(plugin.commands).toHaveLength(RUNPDS_ACTIONS.length);
  });

  it('declares none of the generic lifecycle verbs, which the host owns', () => {
    // `bootstrap` and `destroy` are rejected at load by the CLI's collision
    // pass (`packages/cli/src/plugins.ts`) - a plugin cannot run the engine -
    // and a declared `status` would shadow the generic one over `nodes`.
    const actions = plugin.commands.map((command) => command.action);
    expect(actions).not.toContain('bootstrap');
    expect(actions).not.toContain('status');
    expect(actions).not.toContain('destroy');
  });

  it('declares no init config contributor, so `pds init` stays the publication-setup command', () => {
    // With a contributor here, the host's generic `blogwright <plugin> init`
    // (task 13) would shadow the declared `init` action below.
    expect(plugin.init).toBeUndefined();
    expect(plugin.commands.map((command) => command.action)).toContain('init');
  });
});

describe('the plugin config validator', () => {
  it("is this package's own validatePdsConfig, not a re-implementation", () => {
    expect(plugin.validateConfig).toBe(validatePdsConfig);
  });

  it('rejects a bad block with the message core raises for it today', () => {
    expect(() => plugin.validateConfig?.({ name: '', secretName: SECRET })).toThrow(
      'config.pds.name is required',
    );
  });

  it('returns the block it accepted, for the host to put on ctx.pluginConfig', () => {
    const block = { name: 'Example', secretName: SECRET };
    expect(plugin.validateConfig?.(block)).toEqual(block);
  });
});

describe('argument pass-through into the wrapped functions', () => {
  it('hands `secret delete --yes` a true `yes`', async () => {
    const { fns, calls } = recordingCommands();
    const { ctx } = createPluginContext({ pds: {} });
    await commandFor(createPdsPlugin(fns), 'secret delete').run(ctx, ['--yes']);
    expect(calls).toEqual([{ fn: 'secretDelete', ctx, opts: { yes: true } }]);
  });

  it('hands `secret delete` with no flag a false `yes`', async () => {
    const { fns, calls } = recordingCommands();
    const { ctx } = createPluginContext({ pds: {} });
    await commandFor(createPdsPlugin(fns), 'secret delete').run(ctx, []);
    expect(calls).toEqual([{ fn: 'secretDelete', ctx, opts: { yes: false } }]);
  });

  it('hands `login --identifier alice.example` that exact identifier', async () => {
    const { fns, calls } = recordingCommands();
    const { ctx } = createPluginContext({ pds: {} });
    await commandFor(createPdsPlugin(fns), 'login').run(ctx, ['--identifier', 'alice.example']);
    expect(calls).toEqual([{ fn: 'login', ctx, opts: { identifier: 'alice.example' } }]);
  });

  it('finds --identifier wherever the host placed it among the other forwarded flags', async () => {
    const { fns, calls } = recordingCommands();
    const { ctx } = createPluginContext({ pds: {} });
    await commandFor(createPdsPlugin(fns), 'login').run(ctx, [
      '--domain',
      'example.com',
      '--identifier',
      'alice.example',
      '--yes',
    ]);
    expect(calls).toEqual([{ fn: 'login', ctx, opts: { identifier: 'alice.example' } }]);
  });

  it('hands `login` with no flag an undefined identifier, for the command to refuse', async () => {
    const { fns, calls } = recordingCommands();
    const { ctx } = createPluginContext({ pds: {} });
    await commandFor(createPdsPlugin(fns), 'login').run(ctx, []);
    expect(calls).toEqual([{ fn: 'login', ctx, opts: { identifier: undefined } }]);
  });

  it('routes each of the four flagless actions to its own function, and to no other', async () => {
    for (const [action, fn] of [
      ['keygen', 'keygen'],
      ['init', 'init'],
      ['sync', 'sync'],
      ['secret status', 'secretStatus'],
    ] as const) {
      const { fns, calls } = recordingCommands();
      const { ctx } = createPluginContext({ pds: {} });
      await commandFor(createPdsPlugin(fns), action).run(ctx, []);
      expect(calls).toEqual([{ fn, ctx }]);
    }
  });
});

/*
 * The tests above run against injected doubles, which prove the wrappers pass
 * the right arguments but say nothing about WHICH functions the package's own
 * default export is built over. These run the default export - the object the
 * host will import - and observe the real command functions: two on the
 * recording Secrets Manager client, four on the refusal each raises before it
 * reaches any port.
 */
describe('the default export runs the real command functions', () => {
  it("reaches secretDelete: `secret delete --yes` deletes the block's own secret", async () => {
    const { ctx, secretCalls } = createPluginContext({ pds: {} });
    await run('secret delete', ctx, ['--yes']);
    expect(secretCalls).toEqual([{ op: 'deleteSecret', name: SECRET }]);
  });

  it('reaches secretDelete: `secret delete` without --yes refuses and deletes nothing', async () => {
    const { ctx, secretCalls } = createPluginContext({ pds: {} });
    await expect(run('secret delete', ctx, [])).rejects.toThrow(
      `refusing to delete secret "${SECRET}" without --yes`,
    );
    expect(secretCalls).toEqual([]);
  });

  it('reaches secretStatus: `secret status` describes the secret and never reads its value', async () => {
    const { ctx, secretCalls } = createPluginContext({ pds: {} });
    await run('secret status', ctx, []);
    expect(secretCalls).toEqual([{ op: 'describeSecret', name: SECRET }]);
  });

  it("reaches login: `login` with no identifier raises that command's own refusal", async () => {
    const { ctx } = createPluginContext({ pds: {} });
    await expect(run('login', ctx, [])).rejects.toThrow(
      'pds login requires --identifier <handle-or-did>',
    );
  });

  it("reaches keygen: `keygen` on a domainless site raises keygen's own refusal", async () => {
    const { ctx } = createPluginContext({ pds: {} });
    await expect(run('keygen', ctx, [])).rejects.toThrow('pds keygen requires a configured domain');
  });

  it('reaches the publication-setup init, not a config contributor', async () => {
    // `pds init requires a configured domain` is raised by `commands.init` and
    // by nothing else in this package - it is what distinguishes the
    // publication-setup command from `keygen`, whose refusal names keygen.
    const { ctx } = createPluginContext({ pds: {} });
    await expect(run('init', ctx, [])).rejects.toThrow('pds init requires a configured domain');
  });

  it("reaches sync: `sync` outside production raises sync's own refusal", async () => {
    const { ctx } = createPluginContext({ pds: {} });
    await expect(run('sync', ctx, [])).rejects.toThrow(
      'pds sync publishes canonical production URLs and refuses to run for "test"',
    );
  });
});

describe('the contributed nodes', () => {
  it('is buildPdsNodes itself - nothing wraps, filters or re-orders it', () => {
    expect(plugin.nodes).toBe(buildPdsNodes);
  });

  it("returns task 23's single deploy-role grant for a configured site", () => {
    const { ctx } = createPluginContext({ pds: {} });
    expect(contributedNodes(ctx).map((node) => node.id)).toEqual(['pds-oidc-policy']);
    expect(contributedNodes(ctx).map((node) => node.id)).toEqual(
      buildPdsNodes(ctx).map((node) => node.id),
    );
  });

  it('contributes nothing when the site configures no pds block', () => {
    const { ctx } = createPluginContext();
    expect(ctx.config.pds).toBeUndefined();
    expect(contributedNodes(ctx)).toEqual([]);
  });
});

describe("the package's public surface", () => {
  it('default-exports the plugin from the package index, not only from plugin.ts', () => {
    expect(packageExports.default).toBe(plugin);
  });

  it('still exports all six command functions and syncAfterDeploy by name', () => {
    // `packages/cli/src/commands.ts` imports `syncAfterDeploy` by name and
    // `packages/cli/src/cli.ts` reaches the other six through a namespace
    // import; adding a default export must move none of them.
    expect(packageExports.keygen).toBe(commands.keygen);
    expect(packageExports.login).toBe(commands.login);
    expect(packageExports.init).toBe(commands.init);
    expect(packageExports.sync).toBe(commands.sync);
    expect(packageExports.secretStatus).toBe(commands.secretStatus);
    expect(packageExports.secretDelete).toBe(commands.secretDelete);
    expect(packageExports.syncAfterDeploy).toBe(commands.syncAfterDeploy);
  });
});
