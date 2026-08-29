import {
  createMemoryFileSystem,
  emptyState,
  type OpsState,
  type PluginContext,
  type ResourceNode,
  type ResourceOutputs,
} from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { deriveAppTag, loadConfig, type OpsContext } from './context.js';
import { destroyGraph } from './graph.js';
import { createTestContext } from './test-support.js';

const ROOT = '/repo';

describe('loadConfig', () => {
  it('loads the per-environment file, stripping JSONC comments', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{\n  // the slug\n  "siteName": "example"\n}\n',
    });
    const config = await loadConfig(fs, { env: 'production', root: ROOT });
    expect(config.siteName).toBe('example');
    expect(config.region).toBe('us-east-1'); // merged over defaults
  });

  it('falls back to ops.config.jsonc when the per-environment file is absent', async () => {
    const fs = createMemoryFileSystem({
      '/repo/ops.config.jsonc': '{"siteName": "fallback"}',
    });
    const config = await loadConfig(fs, { env: 'staging', root: ROOT });
    expect(config.siteName).toBe('fallback');
  });

  it('reads only the explicit path when one is given', async () => {
    const fs = createMemoryFileSystem({
      '/repo/config/production.jsonc': '{"siteName": "wrong"}',
      '/elsewhere/custom.jsonc': '{"siteName": "custom"}',
    });
    const config = await loadConfig(fs, {
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
