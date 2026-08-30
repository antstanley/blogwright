import { join } from 'node:path';

import {
  createMemoryFileSystem,
  createNodeFileSystem,
  createScriptedTerminal,
  emptyState,
  findRepoRoot,
  parseConfig,
  type OpsState,
  type Plugin,
  type PluginContext,
  type ResourceNode,
  type ResourceOutputs,
} from 'blogwright-core';
import type { PdsContext } from 'blogwright-pds';
import { describe, expect, it } from 'vitest';

import {
  main,
  type ContextFactory,
  type DiscoveryPortsFactory,
  type PackageManagerFactory,
} from './cli.js';
import {
  cliPackageDir,
  deriveAppTag,
  loadConfig,
  resolveConfigPath,
  type ContextOptions,
  type OpsContext,
} from './context.js';
import { destroyGraph } from './graph.js';
import { createLogger } from './logger.js';
import { runPlugin, type PluginValues } from './plugin-commands.js';
import { discover } from './plugins.js';
import {
  buildDiscoveryPorts,
  createTestContext,
  type FakePluginSpec,
  type RecordedRun,
} from './test-support.js';

const ROOT = '/repo';

/**
 * A `PackageManagerFactory` that throws if called - the two `main` calls in
 * this file drive built-in commands, none of which may reach the
 * `PackageManager` port (only `blogwright plugin add`/`plugin remove` do).
 */
const unreachablePackages: PackageManagerFactory = () => {
  throw new Error('unexpected: package manager built for a command that should never reach it');
};

describe('cliPackageDir', () => {
  it("resolves the real directory holding the CLI's own package.json, callable with no context", async () => {
    // No createContext/createTestContext call anywhere here: blogwright plugin
    // list dispatches before a context exists and still needs this value.
    const dir = cliPackageDir();
    const pkg = JSON.parse(await createNodeFileSystem().readText(join(dir, 'package.json'))) as {
      name: string;
    };
    expect(pkg.name).toBe('blogwright');
  });
});

describe('loadConfig', () => {
  it('loads the per-environment file, stripping JSONC comments', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{\n  // the slug\n  "siteName": "example"\n}\n',
    });
    const { config } = await loadConfig(fs, { env: 'production', root: ROOT });
    expect(config.siteName).toBe('example');
    expect(config.region).toBe('us-east-1'); // merged over defaults
  });

  it('falls back to ops.config.jsonc when the per-environment file is absent', async () => {
    const fs = createMemoryFileSystem({
      '/repo/ops.config.jsonc': '{"siteName": "fallback"}',
    });
    const { config } = await loadConfig(fs, { env: 'staging', root: ROOT });
    expect(config.siteName).toBe('fallback');
  });

  it('reads only the explicit path when one is given', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"siteName": "wrong"}',
      '/elsewhere/custom.jsonc': '{"siteName": "custom"}',
    });
    const { config } = await loadConfig(fs, {
      env: 'production',
      root: ROOT,
      configPath: '/elsewhere/custom.jsonc',
    });
    expect(config.siteName).toBe('custom');
  });

  it('names every candidate it looked for when none exists', async () => {
    const fs = createMemoryFileSystem();
    await expect(loadConfig(fs, { env: 'staging', root: ROOT })).rejects.toThrow(
      /no config found for environment "staging".*config\/staging\.jsonc.*ops\.config\.jsonc/,
    );
  });

  it('returns the raw document beside the parsed config, carrying a top-level key OpsConfig never declares', async () => {
    // `raw` is the DOCUMENT, not the merged config: the plugin block below
    // has no `OpsConfig` field to land in, and `region` - which every
    // `OpsConfig` carries by default - is absent from it entirely. Asserting
    // both directions is what separates the raw half from the merged one; an
    // implementation that returned `{ config, raw: config }` would satisfy
    // the first assertion alone.
    const text =
      '{\n  "siteName": "example",\n  // a plugin owns this key end to end\n' +
      '  "analytics": { "namespace": "hits", "dashboard": { "port": 4321 } }\n}\n';
    const fs = createMemoryFileSystem({ '/repo/config/production.jsonc': text });

    const { config, raw } = await loadConfig(fs, { env: 'production', root: ROOT });

    expect(raw['analytics']).toEqual({ namespace: 'hits', dashboard: { port: 4321 } });
    expect(raw['region']).toBeUndefined();
    // The parsed half is unchanged from what `parseConfig` has always
    // returned for the same text - only the return type widened.
    expect(config).toEqual(parseConfig(text));
    expect(config.region).toBe('us-east-1');
  });

  it("keeps an UNINSTALLED plugin's block on both halves - valid and inert, the contract `pds` has today", async () => {
    // Nothing installed claims "ghost". Core neither knows nor validates the
    // key, and it must not reject the document for carrying it: task 27
    // moves the `pds` block out of core on exactly this contract.
    const text = '{"siteName": "example", "ghost": {"token": "abc"}}';
    const fs = createMemoryFileSystem({ '/repo/config/production.jsonc': text });

    const { config, raw } = await loadConfig(fs, { env: 'production', root: ROOT });

    expect(raw['ghost']).toEqual({ token: 'abc' });
    // Survives the merge too - `mergeConfig`'s `...raw` spread keeps unknown
    // keys - it is simply unreachable through `OpsConfig`'s type.
    expect(config).toHaveProperty('ghost.token', 'abc');
  });

  it('surfaces validation failures instead of trying the next candidate', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"region": "us-east-1"}', // no siteName
      '/repo/ops.config.jsonc': '{"siteName": "example"}',
    });
    await expect(loadConfig(fs, { env: 'production', root: ROOT })).rejects.toThrow(
      /siteName is required/,
    );
  });
});

describe('resolveConfigPath', () => {
  // `loadConfig` (above) is entirely `parseConfig(await fs.readText(await resolveConfigPath(...)))`
  // now, so these pin the extracted candidate resolution directly - the same
  // function `blogwright <plugin> init` (`plugin-commands.ts`) calls to find
  // exactly the file `loadConfig` would read, without re-deriving the
  // candidate list a second time.
  it('resolves the per-environment candidate when it exists', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"siteName": "example"}',
    });
    await expect(resolveConfigPath(fs, { env: 'production', root: ROOT })).resolves.toBe(
      '/repo/config/production.jsonc',
    );
  });

  it('falls back to ops.config.jsonc when the per-environment file is absent', async () => {
    const fs = createMemoryFileSystem({ '/repo/ops.config.jsonc': '{"siteName": "example"}' });
    await expect(resolveConfigPath(fs, { env: 'staging', root: ROOT })).resolves.toBe(
      '/repo/ops.config.jsonc',
    );
  });

  it('resolves only the explicit --config path when one is given, never the per-environment candidates', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"siteName": "wrong"}',
      '/elsewhere/custom.jsonc': '{"siteName": "custom"}',
    });
    await expect(
      resolveConfigPath(fs, {
        env: 'production',
        root: ROOT,
        configPath: '/elsewhere/custom.jsonc',
      }),
    ).resolves.toBe('/elsewhere/custom.jsonc');
  });

  it('throws naming every candidate it looked for when none exists - the same message loadConfig has always raised', async () => {
    const fs = createMemoryFileSystem();
    await expect(resolveConfigPath(fs, { env: 'staging', root: ROOT })).rejects.toThrow(
      /no config found for environment "staging".*config\/staging\.jsonc.*ops\.config\.jsonc/,
    );
  });
});

describe('deriveAppTag', () => {
  it('prefers the explicit config option, then domain, then repo directory name', () => {
    expect(deriveAppTag({ app: 'my-app' }, 'blog.example.com', '/home/x/site')).toBe('my-app');
    expect(deriveAppTag({ app: undefined }, 'blog.example.com', '/home/x/site')).toBe(
      'blog.example.com',
    );
    expect(deriveAppTag({ app: undefined }, undefined, '/home/x/site')).toBe('site');
  });
});

/**
 * `PluginContext<TConfig>` (declared in blogwright-core) is the narrow slice
 * of `OpsContext` a plugin command receives. Thirteen of its sixteen members
 * come straight off `OpsContext` structurally (`ports` narrows to the
 * two-member `PluginPorts`, `tags` narrows to optional); the other three -
 * `pluginConfig`, `siteState`, `record` - come from the dispatch boundary a
 * later task builds. This suite is the compile-time proof that the narrowing
 * holds today, with no cast and no `any`: it fails the build the moment a
 * `PluginContext` member stops being suppliable from those two sources. Per
 * DEVELOPMENT.md's reviewability bar, adding to `PluginContext` a field
 * neither `OpsContext` nor this boundary supplies must fail `pnpm typecheck`
 * right here.
 */
describe('PluginContext composition', () => {
  /** Stand-in for the dispatch boundary's own `record`: write into a scoped state. */
  function scopedRecord(state: OpsState): (nodeId: string, outputs: ResourceOutputs) => void {
    return (nodeId, outputs) => {
      state.resources[nodeId] = outputs;
    };
  }

  it('builds a PluginContext from an OpsContext plus exactly pluginConfig, siteState and record', () => {
    const ops = createTestContext();
    const ctx: PluginContext<unknown> = {
      ...ops,
      pluginConfig: {},
      siteState: { resources: ops.state.resources },
      record: scopedRecord(ops.state),
    };
    expect(ctx.env).toBe(ops.env);
  });

  it("exposes pluginConfig as the plugin's own typed config block", () => {
    const ops = createTestContext();
    const ctx: PluginContext<{ foo: string }> = {
      ...ops,
      pluginConfig: { foo: 'bar' },
      siteState: { resources: ops.state.resources },
      record: scopedRecord(ops.state),
    };
    // Compiles with no cast. `ctx.config.foo` is not offered here: OpsConfig
    // has no index signature, so a plugin's block is unreachable off `config`
    // (TS2339) - that is a compile-time fact, not something this assertion
    // can exercise at runtime.
    expect(ctx.pluginConfig.foo).toBe('bar');
  });

  it("records a node's outputs into the plugin's own state, leaving siteState untouched", async () => {
    const ops = createTestContext({
      state: { resources: { site: { arn: 'site-bucket-arn' } } },
    });
    const pluginState = emptyState(ops.env);
    const ctx: PluginContext<unknown> = {
      ...ops,
      pluginConfig: {},
      siteState: { resources: ops.state.resources },
      state: pluginState,
      record: scopedRecord(pluginState),
    };

    // Shaped like a plugin's resource node: it records through ctx.record,
    // never by writing ctx.state or calling ctx.store.save() itself.
    const node = {
      async create(c: PluginContext<unknown>): Promise<void> {
        c.record('n', { arn: 'a' });
      },
    };
    await node.create(ctx);

    expect(ctx.state.resources['n']).toEqual({ arn: 'a' });
    expect(ctx.siteState.resources['n']).toBeUndefined();
    expect(ctx.siteState.resources['site']).toEqual({ arn: 'site-bucket-arn' });
  });

  it('types state as OpsState itself, not a bare outputs map - the real destroyGraph reaches through it', async () => {
    const ops = createTestContext({ env: 'test' });
    ops.state = emptyState('test');
    ops.state.resources['queue'] = { arn: 'queue-arn' };
    const ctx: PluginContext<unknown> = {
      ...ops,
      pluginConfig: {},
      siteState: { resources: {} },
      record: scopedRecord(ops.state),
    };

    const node: ResourceNode<OpsContext> = {
      id: 'queue',
      dependsOn: [],
      title: 'queue',
      read: async () => true,
      create: async () => undefined,
      delete: async () => undefined,
    };
    // Run it against ops, whose state is the very same object the
    // PluginContext was composed over above - so the engine's mutation,
    // `delete ctx.state.resources[node.id]` (graph.ts), is visible through
    // ctx too, which is what this test asserts. Since task 02 the engine is
    // generic over GraphContext and would accept the PluginContext directly;
    // using ops keeps the aliasing that makes the assertion meaningful.
    await destroyGraph([node], ops);

    expect(ctx.state.resources['queue']).toBeUndefined();
  });
});

/**
 * `PdsContext` (`packages/pds/src/context.ts`) is a `Pick` over
 * `PluginContext<PdsConfig>` of the seven members the pds package actually
 * uses, narrowed further so `clients` names only `secrets`. This is the
 * explicit, compile-time proof that `OpsContext` still satisfies it by plain
 * assignment - no cast, no `satisfies` escape hatch. Until task 29 that
 * proof was implicit, carried by `cli.ts` passing an `OpsContext` straight
 * to `pds.keygen`; this task deletes that call, so this assignment is what
 * keeps a future widening of `PluginContext` (or of `OpsContext` narrowing
 * away from it) failing `pnpm typecheck` here rather than surfacing as a
 * runtime break at the pds dispatch boundary.
 */
describe('OpsContext satisfies PdsContext', () => {
  it('assigns an OpsContext to a PdsContext-typed binding with no cast', () => {
    const ops = createTestContext();
    const pdsCtx: PdsContext = ops;
    expect(pdsCtx.env).toBe(ops.env);
    expect(pdsCtx.clients.secrets).toBe(ops.clients.secrets);
  });
});

/**
 * Task 19 - a plugin's own config block, from the config FILE to the value
 * its command reads off `ctx.pluginConfig`.
 *
 * These live here rather than beside `runPlugin`'s other dispatch cases in
 * `plugin-commands.test.ts` because the behaviour under test is the thread
 * this task ran THROUGH the context: `loadConfig` -> `OpsContext.configDocument`
 * -> `resolvePluginConfig` (`plugins.ts`) -> `PluginContext.pluginConfig`.
 * Every fixture below is a fake plugin; no real plugin declares a
 * `configKey` yet.
 *
 * Each `makeContext` here calls the REAL `loadConfig` over the fixture's own
 * config file, the way `createContext` does, rather than handing
 * `createTestContext` a hand-written document - so a break anywhere along
 * that thread fails here rather than being papered over by a fixture that
 * starts halfway down it.
 */

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

/** The single action every config-owning fake below declares. */
const SHOW_ACTION = 'show';

/** What {@link makeConfigOwningPlugin} records about one dispatch. */
interface ConfigPluginSpec {
  name: string;
  /** The top-level config key this fake claims, if any. */
  configKey?: string | undefined;
  /** Its `validateConfig` body, if it declares one. */
  validate?: ((raw: unknown) => unknown) | undefined;
  /** Every `raw` the validator was handed, in call order - `[]` when it was never called. */
  validatorCalls: unknown[];
  /** Every invocation of its one command. */
  runs: RecordedRun[];
}

/**
 * A fake plugin owning a config key. Its `validateConfig` records what it
 * was handed before delegating, so a test can assert the validator received
 * the block rather than the whole document (or `undefined` rather than a
 * placeholder).
 *
 * Its command deliberately reaches AWS (`clients.sts.getAccountId()`) before
 * recording: "the command did no work" is only a meaningful claim about a
 * command that would otherwise have done some.
 */
function makeConfigOwningPlugin(spec: ConfigPluginSpec): Plugin<unknown> {
  const { validate } = spec;
  return {
    name: spec.name,
    description: `fake ${spec.name} plugin, for config-validation tests`,
    commands: [
      {
        action: SHOW_ACTION,
        summary: 'record the context this ran against',
        run: async (ctx, args) => {
          await ctx.clients.sts.getAccountId();
          spec.runs.push({ action: SHOW_ACTION, ctx, args });
        },
      },
    ],
    ...(spec.configKey === undefined ? {} : { configKey: spec.configKey }),
    ...(validate === undefined
      ? {}
      : {
          validateConfig: (raw: unknown): unknown => {
            spec.validatorCalls.push(raw);
            return validate(raw);
          },
        }),
  };
}

/** A recording `sts`. Dispatch itself never calls it, so a recorded call means a plugin's command ran. */
function recordingSts(calls: string[]): { getAccountId: () => Promise<string> } {
  return {
    getAccountId: async () => {
      calls.push('getAccountId');
      return '123456789012';
    },
  };
}

/**
 * A recording `s3` that answers every read with an empty state. Deliberately
 * looser than `test-support.ts`'s `scopedStateOnlyS3`: every test below
 * asserts the EXACT list of keys read, so a read that should not have
 * happened surfaces as a failed assertion naming the key rather than as a
 * thrown transport error from somewhere down the stack.
 */
function recordingS3(keys: string[]): {
  getObjectText: (bucket: string, key: string) => Promise<string | undefined>;
} {
  return {
    getObjectText: async (_bucket, key) => {
      keys.push(key);
      return undefined;
    },
  };
}

/**
 * Seed a discovery fixture plus a `config/production.jsonc` holding
 * `configText`, and a `ContextFactory` that builds its context the way
 * `createContext` does - real `loadConfig`, both halves kept.
 */
async function buildDispatchFixture(specs: FakePluginSpec[], configText: string) {
  const { fs, loader } = await buildDiscoveryPorts(specs);
  const repoRoot = await findRepoRoot(createNodeFileSystem());
  await fs.writeText(`${repoRoot}/config/production.jsonc`, configText);

  const terminal = createScriptedTerminal({ interactive: false });
  const logger = createLogger(terminal);
  const stsCalls: string[] = [];
  const s3Keys: string[] = [];
  const makeContext = async (opts: ContextOptions): Promise<OpsContext> => {
    const { config, raw } = await loadConfig(fs, {
      env: opts.env,
      root: repoRoot,
      configPath: opts.configPath,
    });
    return createTestContext({
      env: opts.env,
      ports: opts.ports,
      logger,
      config,
      configDocument: raw,
      clients: { sts: recordingSts(stsCalls), s3: recordingS3(s3Keys) },
    });
  };

  return { fs, loader, terminal, logger, makeContext, stsCalls, s3Keys };
}

describe('plugin config validation', () => {
  it("hands the dispatched plugin the block its configKey names, and puts the validator's RETURN on pluginConfig", async () => {
    // Distinguishable from both `{}` and the raw block, so neither the old
    // placeholder nor a pass-through of the unvalidated block would satisfy
    // the assertion below.
    const validated = { greeting: 'hello', shouted: 'HELLO' };
    const spec: ConfigPluginSpec = {
      name: 'fake',
      configKey: 'fake',
      validate: () => validated,
      validatorCalls: [],
      runs: [],
    };
    const fixture = await buildDispatchFixture(
      [
        {
          packageName: 'blogwright-fake',
          namespace: 'fake',
          plugin: makeConfigOwningPlugin(spec),
        },
      ],
      '{"siteName": "example", "fake": {"greeting": "hello"}, "ghost": {"token": "abc"}}',
    );

    const code = await runPlugin(
      'fake',
      [SHOW_ACTION],
      BASE_VALUES,
      fixture.terminal,
      fixture.logger,
      fixture.makeContext,
      { fs: fixture.fs, loader: fixture.loader },
    );

    expect(code).toBe(0);
    // Its OWN block - not the whole document, and not the "ghost" block
    // belonging to a plugin that is not installed.
    expect(spec.validatorCalls).toEqual([{ greeting: 'hello' }]);
    expect(spec.runs).toHaveLength(1);
    expect(spec.runs[0]?.ctx.pluginConfig).toEqual(validated);
    // The uninstalled plugin's block is inert and still readable on the
    // site config - the same contract `pds` has today (task 27 relies on it).
    expect(spec.runs[0]?.ctx.config).toHaveProperty('ghost.token', 'abc');
    // Positive controls for the two recorders the failing-validator test
    // below asserts are EMPTY: on a dispatch that gets all the way through,
    // the command's STS call and the scoped state load both land here. An
    // empty expectation is only evidence when the recorder can fill.
    expect(fixture.stsCalls).toEqual(['getAccountId']);
    expect(fixture.s3Keys).toEqual(['state/production.fake.json']);
  });

  it('calls the validator with `undefined` when the block is ABSENT, so the plugin applies its own defaults', async () => {
    // The correction this task turns on. Skipping the validator and leaving a
    // raw `{}` on `pluginConfig` puts a block there that never went through
    // the plugin's own defaulting - typed as total, `undefined` at runtime in
    // every defaulted field - and nothing downstream can catch it, because
    // dispatch erases `TConfig` (`Plugin<unknown>`, `PluginContext<unknown>`).
    // A validator is the only thing that can turn an absent block into
    // defaults, and a repo that installs a plugin without writing its block
    // is a valid configuration.
    const defaulted = { greeting: 'default', shouted: 'DEFAULT' };
    const spec: ConfigPluginSpec = {
      name: 'fake',
      configKey: 'fake',
      // Answers differently for an absent block than for a present one, so
      // `pluginConfig` alone proves WHAT the validator was handed.
      validate: (raw) => (raw === undefined ? defaulted : { greeting: 'from-block' }),
      validatorCalls: [],
      runs: [],
    };
    const fixture = await buildDispatchFixture(
      [
        {
          packageName: 'blogwright-fake',
          namespace: 'fake',
          plugin: makeConfigOwningPlugin(spec),
        },
      ],
      '{"siteName": "example"}',
    );

    const code = await runPlugin(
      'fake',
      [SHOW_ACTION],
      BASE_VALUES,
      fixture.terminal,
      fixture.logger,
      fixture.makeContext,
      { fs: fixture.fs, loader: fixture.loader },
    );

    expect(code).toBe(0);
    expect(spec.validatorCalls).toEqual([undefined]);
    expect(spec.runs[0]?.ctx.pluginConfig).toEqual(defaulted);
  });

  it('leaves pluginConfig an empty object, and calls no validator, for a plugin that declares NO configKey', async () => {
    // The one path where `{}` is still right: there is no validator to call,
    // because the plugin owns no key. The fixture's document carries a "fake"
    // block anyway, so an implementation keying off the plugin's NAME rather
    // than its `configKey` would fail here.
    const spec: ConfigPluginSpec = {
      name: 'fake',
      validate: () => ({ never: 'called' }),
      validatorCalls: [],
      runs: [],
    };
    const fixture = await buildDispatchFixture(
      [
        {
          packageName: 'blogwright-fake',
          namespace: 'fake',
          plugin: makeConfigOwningPlugin(spec),
        },
      ],
      '{"siteName": "example", "fake": {"greeting": "hello"}}',
    );

    const code = await runPlugin(
      'fake',
      [SHOW_ACTION],
      BASE_VALUES,
      fixture.terminal,
      fixture.logger,
      fixture.makeContext,
      { fs: fixture.fs, loader: fixture.loader },
    );

    expect(code).toBe(0);
    expect(spec.validatorCalls).toEqual([]);
    // An empty object, never `undefined` - `pluginConfig` is a required
    // member and DEVELOPMENT.md forbids `null`/`undefined` for a domain value.
    expect(spec.runs[0]?.ctx.pluginConfig).toEqual({});
  });

  it("surfaces a validator's own message verbatim, named by plugin and key, before the command or any AWS call", async () => {
    const spec: ConfigPluginSpec = {
      name: 'fake',
      configKey: 'fake',
      validate: () => {
        throw new Error('config.fake.greeting must be a string, got 42');
      },
      validatorCalls: [],
      runs: [],
    };
    const fixture = await buildDispatchFixture(
      [
        {
          packageName: 'blogwright-fake',
          namespace: 'fake',
          plugin: makeConfigOwningPlugin(spec),
        },
      ],
      '{"siteName": "example", "fake": {"greeting": 42}}',
    );

    await expect(
      runPlugin(
        'fake',
        [SHOW_ACTION],
        BASE_VALUES,
        fixture.terminal,
        fixture.logger,
        fixture.makeContext,
        {
          fs: fixture.fs,
          loader: fixture.loader,
        },
      ),
    ).rejects.toThrow(
      'plugin "fake" rejected the "fake" config block: config.fake.greeting must be a string, got 42',
    );

    // Nothing ran and nothing was reached: the command never executed, its
    // STS call never happened, and the plugin's own scoped state object was
    // never loaded - validation happens BEFORE `toPluginContext` builds the
    // scoped store, which is the dispatch's first S3 read.
    expect(spec.runs).toEqual([]);
    expect(fixture.stsCalls).toEqual([]);
    expect(fixture.s3Keys).toEqual([]);
  });

  it('propagates that refusal out of `main`, so bin.ts exits non-zero rather than reporting success', async () => {
    const spec: ConfigPluginSpec = {
      name: 'fake',
      configKey: 'fake',
      validate: () => {
        throw new Error('config.fake.greeting must be a string, got 42');
      },
      validatorCalls: [],
      runs: [],
    };
    const fixture = await buildDispatchFixture(
      [
        {
          packageName: 'blogwright-fake',
          namespace: 'fake',
          plugin: makeConfigOwningPlugin(spec),
        },
      ],
      '{"siteName": "example", "fake": {"greeting": 42}}',
    );

    // `main` returns a number for every refusal it OWNS (unknown plugin,
    // unknown action); a plugin's rejection is not one of those - it rejects,
    // and `bin.ts`'s `.catch` prints the message and sets exit code 1.
    await expect(
      main(
        ['fake', SHOW_ACTION],
        () => fixture.terminal,
        fixture.makeContext,
        () => ({ fs: fixture.fs, loader: fixture.loader }),
        unreachablePackages,
      ),
    ).rejects.toThrow('plugin "fake" rejected the "fake" config block');
  });

  it('rejects two installed plugins claiming the same configKey, naming both packages and the key', async () => {
    const shared = 'metrics';
    const { fs, loader } = await buildDiscoveryPorts([
      {
        packageName: 'blogwright-one',
        namespace: 'one',
        plugin: makeConfigOwningPlugin({
          name: 'one',
          configKey: shared,
          validatorCalls: [],
          runs: [],
        }),
      },
      {
        packageName: 'blogwright-two',
        namespace: 'two',
        plugin: makeConfigOwningPlugin({
          name: 'two',
          configKey: shared,
          validatorCalls: [],
          runs: [],
        }),
      },
    ]);

    const result = await discover(await findRepoRoot(fs), cliPackageDir(), { fs, loader });

    // The whole group fails - there is no "first" survivor to prefer, and
    // whichever won would silently be handed the other plugin's block.
    expect(result.plugins).toEqual([]);
    expect(result.installed).toEqual([]);
    const reason =
      `config key "${shared}" is claimed by more than one installed plugin: ` +
      'blogwright-one, blogwright-two - a plugin owns exactly one top-level config key, and no ' +
      'two plugins may own the same one';
    expect(result.failures).toEqual([
      { packageName: 'blogwright-one', reason },
      { packageName: 'blogwright-two', reason },
    ]);
  });

  it('leaves two plugins owning DIFFERENT keys, and a plugin owning none, installed', async () => {
    // The positive half of the check above: without it, a collision pass that
    // rejected every plugin declaring a configKey at all would still pass.
    const { fs, loader } = await buildDiscoveryPorts([
      {
        packageName: 'blogwright-one',
        namespace: 'one',
        plugin: makeConfigOwningPlugin({
          name: 'one',
          configKey: 'one',
          validatorCalls: [],
          runs: [],
        }),
      },
      {
        packageName: 'blogwright-two',
        namespace: 'two',
        plugin: makeConfigOwningPlugin({
          name: 'two',
          configKey: 'two',
          validatorCalls: [],
          runs: [],
        }),
      },
      {
        packageName: 'blogwright-three',
        namespace: 'three',
        plugin: makeConfigOwningPlugin({ name: 'three', validatorCalls: [], runs: [] }),
      },
    ]);

    const result = await discover(await findRepoRoot(fs), cliPackageDir(), { fs, loader });

    expect(result.failures).toEqual([]);
    expect(result.plugins.map((plugin) => plugin.name).sort()).toEqual(['one', 'three', 'two']);
  });

  it('runs no discovery, and loads no plugin module, for the context-taking built-ins', async () => {
    // The laziness rule this task's scope choice depends on: validation
    // happens in the DISPATCH path, so `deploy`/`bootstrap`/`status` must
    // still never reach a plugin. `cli.test.ts` carries the sibling of this
    // assertion for `main`'s own dispatch; it is repeated here because this
    // task's scope decision (`plugins.ts`'s task-19 DECISION note) is what
    // would break it, and this file is what its reviewable command runs.
    const terminal = createScriptedTerminal({ interactive: false });
    const { fs, loader } = await buildDiscoveryPorts([
      {
        packageName: 'blogwright-fake',
        namespace: 'fake',
        plugin: makeConfigOwningPlugin({
          name: 'fake',
          configKey: 'fake',
          validate: () => ({}),
          validatorCalls: [],
          runs: [],
        }),
      },
    ]);
    let discoveryPortsCalls = 0;
    const makeDiscoveryPorts: DiscoveryPortsFactory = () => {
      discoveryPortsCalls += 1;
      return { fs, loader };
    };
    const makeContext: ContextFactory = async (opts) =>
      createTestContext({ env: opts.env, ports: opts.ports, logger: createLogger(terminal) });

    for (const command of ['deploy', 'bootstrap', 'status']) {
      await main(
        [command],
        () => terminal,
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
