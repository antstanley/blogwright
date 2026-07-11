import type { OpsContext } from './context.js';

/** A node in the infrastructure dependency graph. */
export interface ResourceNode {
  id: string;
  dependsOn: string[];
  /** Human label for logging. */
  title: string;
  /** Does the resource already exist? (Also hydrates outputs into ctx.state.) */
  read(ctx: OpsContext): Promise<boolean>;
  create(ctx: OpsContext): Promise<void>;
  /** Reconcile an existing resource (optional). */
  update?(ctx: OpsContext): Promise<void>;
  delete(ctx: OpsContext): Promise<void>;
}

/** Topologically order nodes so dependencies come before dependents (Kahn's algorithm). */
export function topoSort(nodes: ResourceNode[]): ResourceNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    dependents.set(node.id, []);
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) throw new Error(`node "${node.id}" depends on unknown node "${dep}"`);
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      dependents.get(dep)!.push(node.id);
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: ResourceNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const dependent of dependents.get(id)!) {
      const d = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, d);
      if (d === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }

  if (order.length !== nodes.length) throw new Error('dependency cycle detected in resource graph');
  return order;
}

/** Reconcile the graph in dependency order (create missing, update existing). */
export async function applyGraph(nodes: ResourceNode[], ctx: OpsContext): Promise<void> {
  for (const node of topoSort(nodes)) {
    const exists = await node.read(ctx);
    if (exists) {
      if (node.update) {
        ctx.logger.step(`reconcile ${node.title}`);
        await node.update(ctx);
      } else {
        ctx.logger.ok(`${node.title} (exists)`);
      }
    } else {
      ctx.logger.step(`create ${node.title}`);
      await node.create(ctx);
      ctx.logger.ok(`created ${node.title}`);
    }
    await ctx.save();
  }
}

/** Tear down the graph in reverse dependency order. */
export async function destroyGraph(nodes: ResourceNode[], ctx: OpsContext): Promise<void> {
  const order = topoSort(nodes).reverse();
  for (const node of order) {
    ctx.logger.step(`delete ${node.title}`);
    await node.delete(ctx);
    delete ctx.state.resources[node.id];
    // The state lives in the bucket that is itself being deleted, so persisting it may
    // fail (NoSuchBucket) once the bucket node is gone — never let that abort teardown.
    await ctx.save().catch(() => undefined);
    ctx.logger.ok(`deleted ${node.title}`);
  }
}
