import type { ResourceNode, ResourceOutputs } from 'blogwright-core';

/**
 * The structural minimum the engine below (`topoSort`, `applyGraph`,
 * `destroyGraph`) actually reads off a node's context: a logger it calls
 * `step`/`ok`/`warn` on, a way to persist state, and the state's resources
 * map (`destroyGraph` deletes an entry from it). Exported so a caller
 * running this engine over a different context - `OpsContext` (`context.ts`)
 * and core's `PluginContext` (`blogwright-core`) both do already - knows
 * exactly what that context must supply, without this module depending on
 * either one. Neither `OpsContext` nor `PluginContext` is named here on
 * purpose: this is the structural minimum both happen to satisfy, not a
 * fixed supertype of them (see the doc comment on core's `ResourceNode` for
 * why no such supertype is worth naming).
 */
export interface GraphContext {
  logger: {
    step(msg: string): void;
    ok(msg: string): void;
    warn(msg: string): void;
  };
  state: {
    resources: Record<string, ResourceOutputs>;
  };
  save(): Promise<void>;
}

/** Topologically order nodes so dependencies come before dependents (Kahn's algorithm). */
export function topoSort<Ctx>(nodes: ResourceNode<Ctx>[]): ResourceNode<Ctx>[] {
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
  const order: ResourceNode<Ctx>[] = [];
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
export async function applyGraph<Ctx extends GraphContext>(
  nodes: ResourceNode<Ctx>[],
  ctx: Ctx,
): Promise<void> {
  for (const node of topoSort(nodes)) {
    const exists = await node.read(ctx);
    try {
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
    } catch (err) {
      // Persist whatever outputs the node recorded before it failed, so a resource
      // created just before the throw is not orphaned outside the state file.
      // Best-effort: the state bucket may itself be what failed to create, and a
      // save error must never mask the node's own failure.
      await ctx.save().catch((saveErr: unknown) => {
        ctx.logger.warn(`could not save state after ${node.title} failed: ${String(saveErr)}`);
      });
      throw err;
    }
    await ctx.save();
  }
}

/** Tear down the graph in reverse dependency order. */
export async function destroyGraph<Ctx extends GraphContext>(
  nodes: ResourceNode<Ctx>[],
  ctx: Ctx,
): Promise<void> {
  const order = topoSort(nodes).reverse();
  for (const node of order) {
    ctx.logger.step(`delete ${node.title}`);
    await node.delete(ctx);
    delete ctx.state.resources[node.id];
    // The state lives in the bucket that is itself being deleted, so persisting it may
    // fail (NoSuchBucket) once the bucket node is gone - never let that abort teardown.
    await ctx.save().catch(() => undefined);
    ctx.logger.ok(`deleted ${node.title}`);
  }
}
