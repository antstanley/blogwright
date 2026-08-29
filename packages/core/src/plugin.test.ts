import { describe, expect, it } from 'vitest';

import { createMemoryFileSystem } from './adapters/memory-fs.js';
import { createScriptedTerminal } from './adapters/script-terminal.js';
import { staticCredentials } from './aws/credentials.js';
import { createClients } from './clients.js';
import { deriveNames, mergeConfig } from './config.js';
import {
  PLUGIN_NAME_PATTERN,
  validatePlugin,
  type Plugin,
  type PluginContext,
  type PluginLogger,
} from './plugin.js';
import { emptyState, StateStore } from './state.js';

const PACKAGE = 'acme-plugin';

describe('PLUGIN_NAME_PATTERN', () => {
  it('accepts only lowercase alphanumerics and dashes', () => {
    expect(PLUGIN_NAME_PATTERN.test('analytics')).toBe(true);
    expect(PLUGIN_NAME_PATTERN.test('my-plugin-2')).toBe(true);
    expect(PLUGIN_NAME_PATTERN.test('My-Plugin')).toBe(false);
    expect(PLUGIN_NAME_PATTERN.test('my_plugin')).toBe(false);
    expect(PLUGIN_NAME_PATTERN.test('')).toBe(false);
  });
});

describe('validatePlugin', () => {
  it('returns a typed Plugin from a minimal valid module', () => {
    const module = {
      default: {
        name: 'acme',
        description: 'Acme integration',
        commands: [{ action: 'sync', summary: 'sync content', run: async () => undefined }],
      },
    };

    const plugin = validatePlugin(module, PACKAGE);

    expect(plugin.name).toBe('acme');
    expect(plugin.description).toBe('Acme integration');
    expect(plugin.commands).toHaveLength(1);
    expect(plugin.commands[0]?.action).toBe('sync');
  });

  it('rejects a module with no default export', () => {
    expect(() => validatePlugin({}, PACKAGE)).toThrow(new RegExp(PACKAGE));
    expect(() => validatePlugin({}, PACKAGE)).toThrow(/no default export/);
    // undefined and non-record modules take the same path.
    expect(() => validatePlugin(undefined, PACKAGE)).toThrow(/no default export/);
  });

  it('rejects a non-object default export', () => {
    expect(() => validatePlugin({ default: 'nope' }, PACKAGE)).toThrow(new RegExp(PACKAGE));
    expect(() => validatePlugin({ default: 'nope' }, PACKAGE)).toThrow(/not a Plugin object/);
    expect(() => validatePlugin({ default: 42 }, PACKAGE)).toThrow(/not a Plugin object/);
    expect(() => validatePlugin({ default: null }, PACKAGE)).toThrow(/not a Plugin object/);
  });

  it('rejects a missing or empty name', () => {
    expect(() => validatePlugin({ default: { description: 'd', commands: [] } }, PACKAGE)).toThrow(
      new RegExp(PACKAGE),
    );
    expect(() => validatePlugin({ default: { description: 'd', commands: [] } }, PACKAGE)).toThrow(
      /Plugin\.name is required/,
    );
    expect(() =>
      validatePlugin({ default: { name: '', description: 'd', commands: [] } }, PACKAGE),
    ).toThrow(/Plugin\.name is required/);
  });

  it('rejects a name that violates PLUGIN_NAME_PATTERN', () => {
    const module = { default: { name: 'Not Valid!', description: 'd', commands: [] } };
    expect(() => validatePlugin(module, PACKAGE)).toThrow(new RegExp(PACKAGE));
    expect(() => validatePlugin(module, PACKAGE)).toThrow(/lowercase alphanumerics and dashes/);
  });

  it('rejects a missing description', () => {
    const module = { default: { name: 'ok', commands: [] } };
    expect(() => validatePlugin(module, PACKAGE)).toThrow(new RegExp(PACKAGE));
    expect(() => validatePlugin(module, PACKAGE)).toThrow(/description is required/);
  });

  it('rejects commands that is not an array', () => {
    const module = { default: { name: 'ok', description: 'd', commands: {} } };
    expect(() => validatePlugin(module, PACKAGE)).toThrow(new RegExp(PACKAGE));
    expect(() => validatePlugin(module, PACKAGE)).toThrow(/commands must be an array/);
  });

  it('rejects a command missing action or run', () => {
    const missingAction = {
      default: {
        name: 'ok',
        description: 'd',
        commands: [{ summary: 's', run: async () => undefined }],
      },
    };
    const missingRun = {
      default: { name: 'ok', description: 'd', commands: [{ action: 'a', summary: 's' }] },
    };
    expect(() => validatePlugin(missingAction, PACKAGE)).toThrow(new RegExp(PACKAGE));
    expect(() => validatePlugin(missingAction, PACKAGE)).toThrow(/missing action or run/);
    expect(() => validatePlugin(missingRun, PACKAGE)).toThrow(/missing action or run/);
  });

  it('validates cleanly even when nodes() would throw if called', () => {
    const module = {
      default: {
        name: 'ok',
        description: 'd',
        commands: [{ action: 'run', summary: 's', run: async () => undefined }],
        nodes: () => {
          throw new Error('nodes must never be invoked while validating');
        },
      },
    };

    expect(() => validatePlugin(module, PACKAGE)).not.toThrow();
  });

  it('never includes a value read off the module in the raised message', () => {
    const marker = 'SECRET_MARKER_9f3a';
    const messageOf = (module: unknown): string => {
      try {
        validatePlugin(module, PACKAGE);
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error('expected validatePlugin to reject');
    };

    const messages = [
      messageOf({ default: { name: `Bad ${marker}`, description: 'd', commands: [] } }),
      messageOf({ default: { name: 'ok', description: 'd', commands: marker } }),
      messageOf({ default: { name: 'ok', description: 'd', commands: [{ action: marker }] } }),
    ];

    for (const message of messages) {
      expect(message).not.toContain(marker);
    }
  });
});

/**
 * Build a real, fully-typed `PluginContext<unknown>` from the same
 * fixtures core's own tests already use (`createClients`,
 * `staticCredentials`, `createMemoryFileSystem`, `createScriptedTerminal`) -
 * no cast anywhere in its construction.
 */
function makeContext(pluginConfig: unknown): PluginContext<unknown> {
  const clients = createClients({
    region: 'us-east-1',
    credentials: staticCredentials({ accessKeyId: 'test', secretAccessKey: 'test' }),
    transport: async () => {
      throw new Error('unexpected AWS request in a plugin type-level test');
    },
  });
  const config = mergeConfig({ siteName: 'example' });
  const names = deriveNames('production', '123456789012', config);
  const state = emptyState('production');
  const logger: PluginLogger = {
    info: () => undefined,
    step: () => undefined,
    ok: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  return {
    env: 'production',
    domain: undefined,
    preview: false,
    config,
    pluginConfig,
    names,
    accountId: '123456789012',
    clients,
    ports: {
      fs: createMemoryFileSystem(),
      terminal: createScriptedTerminal({ interactive: false }),
    },
    logger,
    store: new StateStore(clients.s3, names.bucket, 'production', 'acme'),
    state,
    siteState: { resources: {} },
    record: (nodeId, outputs) => {
      state.resources[nodeId] = outputs;
    },
    save: async () => undefined,
  };
}

describe('Plugin<TConfig> type-level contract', () => {
  it('joins a heterogeneous registry through Plugin<unknown> with no cast, and dispatches both run methods', async () => {
    const calls: Array<{ plugin: string; value: unknown }> = [];

    const pluginA: Plugin<{ a: string }> = {
      name: 'plugin-a',
      description: 'Plugin A',
      commands: [
        {
          action: 'run',
          summary: 'run a',
          run: async (ctx) => {
            calls.push({ plugin: 'a', value: ctx.pluginConfig.a });
          },
        },
      ],
    };
    const pluginB: Plugin<{ b: number }> = {
      name: 'plugin-b',
      description: 'Plugin B',
      commands: [
        {
          action: 'run',
          summary: 'run b',
          run: async (ctx) => {
            calls.push({ plugin: 'b', value: ctx.pluginConfig.b });
          },
        },
      ],
    };

    // No cast: Plugin<{ a: string }> and Plugin<{ b: number }> both join
    // Plugin<unknown>[] because commands[].run and nodes are method-declared
    // and therefore bivariant.
    const registry: Plugin<unknown>[] = [pluginA, pluginB];
    const ctx = makeContext({ a: 'x', b: 1 });

    for (const plugin of registry) {
      for (const command of plugin.commands) {
        await command.run(ctx, []);
      }
    }

    expect(calls).toEqual([
      { plugin: 'a', value: 'x' },
      { plugin: 'b', value: 1 },
    ]);
  });

  it('never default: a property read off ctx.pluginConfig is TS2339, while a whole-field assignment compiles', () => {
    // Type-only probes: declared but never invoked, so the body typechecks
    // (pnpm typecheck runs across this test file) without ever executing at
    // runtime - `ctx` needs no value, only a type.
    function probes(ctx: PluginContext): void {
      // @ts-expect-error TS2339 - a bare Plugin's pluginConfig is `never`; no property reads off it.
      void ctx.pluginConfig.anything;

      // The one recorded unsoundness: `never` is assignable to every type, so
      // this whole-field assignment compiles - documented, not relied on.
      const wholeFieldAssignment: number = ctx.pluginConfig;
      void wholeFieldAssignment;
    }
    void probes;

    expect(typeof probes).toBe('function');
  });
});
