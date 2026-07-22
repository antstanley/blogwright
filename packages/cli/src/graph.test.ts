import { describe, expect, it } from 'vitest';

import { applyGraph, destroyGraph, topoSort, type ResourceNode } from './graph.js';
import { createTestContext } from './test-support.js';

function node(id: string, dependsOn: string[], log: string[]): ResourceNode {
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
    const failing: ResourceNode = {
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
    const failing: ResourceNode = {
      id: 'bucket',
      dependsOn: [],
      title: 'bucket',
      read: async () => false,
      create: async () => {
        throw new Error('CreateBucket denied');
      },
      delete: async () => undefined,
    };

    // The bucket's own failure surfaces — not the (inevitable) save failure after it.
    await expect(applyGraph([failing], ctx)).rejects.toThrow(/CreateBucket denied/);
    expect(warnings.join('\n')).toContain('NoSuchBucket');
  });

  it('reconciles existing nodes via update instead of create', async () => {
    const log: string[] = [];
    const updating: ResourceNode = {
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
