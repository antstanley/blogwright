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
