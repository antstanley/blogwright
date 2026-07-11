import { pollUntil, type Microvm } from 'blogwright-core';

import type { OpsContext } from './context.js';
import { colors, confirm } from './logger.js';

/** A MicroVM keeps its image pinned until it fully terminates, so anything that isn't
 *  already TERMINATED/TERMINATING still blocks deleting the builder image. */
function isActive(vm: Microvm): boolean {
  return !/TERMINATED|TERMINATING/i.test(vm.state);
}

/**
 * Active MicroVMs launched from *this* environment's builder image. Matches on the image
 * ARN recorded in state, falling back to the (env-scoped) image name so a stack whose
 * state predates the ARN still resolves — and a sibling env's VMs are never touched.
 */
export async function runningStackMicrovms(ctx: OpsContext): Promise<Microvm[]> {
  const imageArn = ctx.state.resources['microvm-image']?.arn;
  const imageName = ctx.names.microvmImage;
  // Scope server-side by the builder image when we know its ARN; the client-side filter
  // below is kept as a guard (and covers the name-only fallback when state has no ARN yet).
  const all = await ctx.clients.microvms.listMicrovms(
    typeof imageArn === 'string' ? { imageIdentifier: imageArn } : {},
  );
  return all.filter(
    (vm) =>
      isActive(vm) &&
      ((typeof imageArn === 'string' && vm.imageArn === imageArn) ||
        (vm.imageArn?.includes(imageName) ?? false)),
  );
}

/**
 * Guard a destroy/teardown against running builder MicroVMs (deleting the image 400s while
 * any are alive). Lists them, then interactively offers to terminate — default yes — or to
 * wait, which cancels the destroy. Non-interactive callers get the default (terminate) so
 * automation isn't blocked. Returns true to proceed with the destroy, false to abort.
 */
export async function clearRunningMicrovms(ctx: OpsContext): Promise<boolean> {
  const running = await runningStackMicrovms(ctx);
  if (running.length === 0) return true;

  ctx.logger.warn(
    colors.yellow(
      `${running.length} builder MicroVM(s) must be terminated before the image can be deleted:`,
    ),
  );
  for (const vm of running) ctx.logger.info(`    ${vm.microvmId} (${vm.state})`);

  if (!(await confirm('Terminate them and continue?', { defaultYes: true }))) {
    ctx.logger.info('Leaving MicroVMs running — destroy cancelled.');
    return false;
  }

  for (const vm of running) {
    ctx.logger.step(`terminating ${vm.microvmId}`);
    await ctx.clients.microvms.terminateMicrovm(vm.microvmId);
  }
  // Wait for them to actually clear, so the image delete later in the graph doesn't 400.
  ctx.logger.step('waiting for MicroVMs to terminate…');
  const remaining = await pollUntil(
    () => runningStackMicrovms(ctx),
    (vms) => vms.length === 0,
    { intervalMs: 5000, timeoutMs: 180_000 },
  );
  if (remaining.length > 0) {
    throw new Error(
      `${remaining.length} MicroVM(s) did not terminate in time; re-run destroy once they clear`,
    );
  }
  ctx.logger.ok('MicroVMs terminated');
  return true;
}
