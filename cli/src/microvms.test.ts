import { describe, expect, it, vi } from 'vitest';

import type { Microvm } from '@iamstan/ops-core';

import type { OpsContext } from './context.js';
import { clearRunningMicrovms, runningStackMicrovms } from './microvms.js';

const IMAGE_ARN = 'arn:aws:lambda:us-east-1:1:microvm-image:preview-iamstan-builder';

function vm(id: string, state: string, imageArn?: string): Microvm {
  return { microvmId: id, state, endpoint: '', ...(imageArn ? { imageArn } : {}) };
}

function fakeCtx(
  vms: Microvm[],
  terminate = vi.fn(async () => {}),
  listImpl?: () => Promise<Microvm[]>,
): OpsContext {
  const noop = () => {};
  return {
    names: { microvmImage: 'preview-iamstan-builder' },
    state: { version: 1, env: 'preview', resources: { 'microvm-image': { arn: IMAGE_ARN } } },
    logger: { info: noop, step: noop, ok: noop, warn: noop, error: noop },
    clients: {
      microvms: {
        listMicrovms: listImpl ?? (async () => vms),
        terminateMicrovm: terminate,
      },
    },
  } as unknown as OpsContext;
}

describe('runningStackMicrovms', () => {
  it('keeps only active VMs launched from this stack image', async () => {
    const ctx = fakeCtx([
      vm('a', 'RUNNING', IMAGE_ARN), // ✓ ours + active
      vm('b', 'TERMINATED', IMAGE_ARN), // ✗ terminated
      vm('c', 'RUNNING', 'arn:aws:lambda:us-east-1:1:microvm-image:production-iamstan-builder'), // ✗ other env
      vm('d', 'PENDING', IMAGE_ARN), // ✓ ours + active
    ]);
    const running = await runningStackMicrovms(ctx);
    expect(running.map((v) => v.microvmId)).toEqual(['a', 'd']);
  });

  it('falls back to matching the image name when state has no ARN yet', async () => {
    const ctx = fakeCtx([vm('a', 'RUNNING', IMAGE_ARN)]);
    // Drop the recorded ARN so only the name-based fallback can match.
    (ctx.state.resources['microvm-image'] as { arn?: string }).arn = undefined;
    const running = await runningStackMicrovms(ctx);
    expect(running.map((v) => v.microvmId)).toEqual(['a']);
  });
});

describe('clearRunningMicrovms', () => {
  it('proceeds without prompting when nothing is running', async () => {
    const terminate = vi.fn(async () => {});
    const ctx = fakeCtx([vm('x', 'TERMINATED', IMAGE_ARN)], terminate);
    expect(await clearRunningMicrovms(ctx)).toBe(true);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('terminates running VMs and waits for them to clear (non-TTY default = yes)', async () => {
    const terminate = vi.fn(async () => {});
    // First listing (the guard) sees a running VM; subsequent listings (the wait loop)
    // see it gone — so pollUntil resolves on its first probe without sleeping.
    let calls = 0;
    const listImpl = async () => (calls++ === 0 ? [vm('a', 'RUNNING', IMAGE_ARN)] : []);
    const ctx = fakeCtx([], terminate, listImpl);

    expect(await clearRunningMicrovms(ctx)).toBe(true);
    expect(terminate).toHaveBeenCalledWith('a');
  });
});
