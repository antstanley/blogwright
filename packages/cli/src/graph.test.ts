import type { PluginContext, ResourceNode } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { applyGraph, destroyGraph, topoSort } from './graph.js';
import { createTestContext } from './test-support.js';

function node(id: string, dependsOn: string[], log: string[]): ResourceNode<OpsContext> {
  return {
    id,
    dependsOn,
    title: id,
    read: async () => false,
    create: async () => {
      log.push(`create:${id}`);
    },
    delete: async () => {
      log.push(`delete:${id}`);
    },
  };
}

describe('topoSort', () => {
  it('orders dependencies before dependents', () => {
    const log: string[] = [];
    const nodes = [node('a', ['b'], log), node('b', ['c'], log), node('c', [], log)];
    expect(topoSort(nodes).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });

  it('throws on a cycle', () => {
    const log: string[] = [];
    expect(() => topoSort([node('a', ['b'], log), node('b', ['a'], log)])).toThrow(/cycle/);
  });

  it('throws on an unknown dependency', () => {
    const log: string[] = [];
    expect(() => topoSort([node('a', ['missing'], log)])).toThrow(/unknown node/);
  });
});

describe('applyGraph / destroyGraph', () => {
  it('creates in dependency order and destroys in reverse', async () => {
    const log: string[] = [];
    const nodes = [node('a', ['b'], log), node('b', [], log)];
    await applyGraph(nodes, createTestContext());
    expect(log).toEqual(['create:b', 'create:a']);

    log.length = 0;
    await destroyGraph(nodes, createTestContext());
    expect(log).toEqual(['delete:a', 'delete:b']);
  });

  it('persists outputs a node recorded before its create() failed', async () => {
    const savedSnapshots: string[] = [];
    const ctx = createTestContext({
      save: async () => {
        savedSnapshots.push(JSON.stringify(ctx.state.resources));
      },
    });
    const failing: ResourceNode<OpsContext> = {
      id: 'dist',
      dependsOn: [],
      title: 'dist',
      read: async () => false,
      // Mirrors a real node: the remote create succeeded (identity recorded), a
      // secondary mutation then threw.
      create: async (c) => {
        c.state.resources['dist'] = { id: 'D1' };
        throw new Error('TagResource failed');
      },
      delete: async () => undefined,
    };

    await expect(applyGraph([failing], ctx)).rejects.toThrow(/TagResource failed/);

    expect(savedSnapshots).toHaveLength(1);
    expect(JSON.parse(savedSnapshots[0]!)).toEqual({ dist: { id: 'D1' } });
  });

  it('a failing save on the failure path warns but never masks the node error', async () => {
    const warnings: string[] = [];
    const ctx = createTestContext({
      save: async () => {
        throw new Error('NoSuchBucket');
      },
      logger: {
        warn: (msg) => {
          warnings.push(msg);
        },
      },
    });
    const failing: ResourceNode<OpsContext> = {
      id: 'bucket',
      dependsOn: [],
      title: 'bucket',
      read: async () => false,
      create: async () => {
        throw new Error('CreateBucket denied');
      },
      delete: async () => undefined,
    };

    // The bucket's own failure surfaces - not the (inevitable) save failure after it.
    await expect(applyGraph([failing], ctx)).rejects.toThrow(/CreateBucket denied/);
    expect(warnings.join('\n')).toContain('NoSuchBucket');
  });

  it('reconciles existing nodes via update instead of create', async () => {
    const log: string[] = [];
    const updating: ResourceNode<OpsContext> = {
      id: 'x',
      dependsOn: [],
      title: 'x',
      read: async () => true,
      create: async () => {
        log.push('create');
      },
      update: async () => {
        log.push('update');
      },
      delete: async () => {
        log.push('delete');
      },
    };
    await applyGraph([updating], createTestContext());
    expect(log).toEqual(['update']);
  });
});

/**
 * `topoSort`/`applyGraph`/`destroyGraph` are generic over the engine's own
 * structural minimum (`GraphContext`), not over `OpsContext` - the CLI's own
 * nodes above are just one instantiation, `ResourceNode<OpsContext>`. This
 * suite exercises the other real instantiation: a node written against
 * core's `PluginContext` alone, run through the very same engine, with a
 * `PluginContext` built the way task 01's `PluginContext composition` test
 * builds one (`context.test.ts`) - an `OpsContext` spread plus `pluginConfig`,
 * `siteState` and `record`.
 */
describe('the engine over a core PluginContext instantiation', () => {
  it('accepts a node typed on PluginContext through topoSort and applyGraph', async () => {
    const ops = createTestContext();
    const ctx: PluginContext<unknown> = {
      ...ops,
      pluginConfig: {},
      siteState: { resources: ops.state.resources },
      record: (nodeId, outputs) => {
        ops.state.resources[nodeId] = outputs;
      },
    };

    const log: string[] = [];
    const pluginNode: ResourceNode<PluginContext<unknown>> = {
      id: 'plugin-resource',
      dependsOn: [],
      title: 'plugin resource',
      read: async (c) => c.siteState.resources['plugin-resource'] !== undefined,
      create: async (c) => {
        log.push('create');
        c.record('plugin-resource', { id: 'p1' });
      },
      delete: async () => {
        log.push('delete');
      },
    };

    expect(topoSort([pluginNode]).map((n) => n.id)).toEqual(['plugin-resource']);
    await applyGraph([pluginNode], ctx);
    expect(log).toEqual(['create']);
    expect(ctx.state.resources['plugin-resource']).toEqual({ id: 'p1' });
  });
});
