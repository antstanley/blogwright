/*
 * Characterization tests for `status`, written before `readNodeStatus` is
 * extracted from it (task 15). They pin the exact lines `status` emits - in
 * both interactive and plain mode, including the read-failure path - against
 * a small fake node set standing in for the real (AWS-calling) production
 * graph `buildNodes(ctx)` returns. They must keep passing, unmodified, once
 * the per-node read loop moves into `readNodeStatus`.
 *
 * The fake node set is handed to `status` as a real argument - `status`'s
 * node set is a parameter (defaulting to `buildNodes(ctx)`), not a module
 * reached for internally - so no module or global is patched to isolate it
 * (see DEVELOPMENT.md: "Tests substitute at the port, not by patching
 * modules or globals").
 */

import { colors, createScriptedTerminal, stripColors, type ResourceNode } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { readNodeStatus, status } from './commands.js';
import type { OpsContext } from './context.js';
import { buildNodes } from './nodes.js';
import { createTestContext } from './test-support.js';

/**
 * Three nodes - present, missing, and one whose `read` throws - small enough
 * to hand-verify every emitted line against, standing in for `buildNodes(ctx)`.
 */
function fakeNodes(): ResourceNode<OpsContext>[] {
  return [
    {
      id: 'state-bucket',
      dependsOn: [],
      title: 'state bucket',
      read: async () => true,
      create: async () => undefined,
      delete: async () => undefined,
    },
    {
      id: 'distribution',
      dependsOn: [],
      title: 'cloudfront distribution',
      read: async () => false,
      create: async () => undefined,
      delete: async () => undefined,
    },
    {
      id: 'iam-role',
      dependsOn: [],
      title: 'exec role',
      read: async () => {
        throw new Error('AccessDenied: iam:GetRole');
      },
      create: async () => undefined,
      delete: async () => undefined,
    },
  ];
}

/** Run `status` against the fake node set, capturing exactly what it logs. */
async function runStatus(interactive: boolean): Promise<{ info: string[]; warn: string[] }> {
  const info: string[] = [];
  const warn: string[] = [];
  const ctx = createTestContext({
    env: 'test',
    names: { bucket: 'test-bucket' },
    state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
    ports: { terminal: createScriptedTerminal({ interactive }) },
    logger: {
      info: (msg) => info.push(msg),
      warn: (msg) => warn.push(msg),
    },
  });
  await status(ctx, fakeNodes());
  return { info: info.map(stripColors), warn: warn.map(stripColors) };
}

describe('status (interactive)', () => {
  it('renders the heading and a status tree: present, missing, and an error entry', async () => {
    const { info, warn } = await runStatus(true);

    expect(info).toEqual([
      'Status for "test" (bucket test-bucket)',
      '├─ ✓ state bucket {"name":"my-bucket"}',
      '├─ ◌ cloudfront distribution',
      '╰─ ✗ exec role AccessDenied: iam:GetRole',
    ]);
    expect(warn).toEqual([]);
  });

  it('reports a failed read as a tree entry carrying the exact error message', async () => {
    const { info } = await runStatus(true);

    expect(info.at(-1)).toBe('╰─ ✗ exec role AccessDenied: iam:GetRole');
  });
});

describe('status (plain)', () => {
  it('prints the heading and one line per node, plain form', async () => {
    const { info, warn } = await runStatus(false);

    expect(info).toEqual([
      'Status for "test" (bucket test-bucket)',
      '  present  state bucket {"name":"my-bucket"}',
      '  missing  cloudfront distribution ',
    ]);
    expect(warn).toEqual(['exec role: read failed (AccessDenied: iam:GetRole)']);
  });

  it('reports a failed read as a warning line carrying the exact error message', async () => {
    const { warn } = await runStatus(false);

    expect(warn).toEqual(['exec role: read failed (AccessDenied: iam:GetRole)']);
  });

  it('reconstructs the warning byte-identically even when the error message is empty', async () => {
    // The old code built this line inline, straight off the caught `err`:
    // `${node.title}: read failed (${(err as Error).message})`. The new code
    // rebuilds it from the returned StatusEntry's `detail`. Pin that the two
    // agree even at the edge - a message of '' - where a bug in the
    // reconstruction (e.g. `detail || 'unknown'`) would go unnoticed by every
    // other test here.
    const info: string[] = [];
    const warn: string[] = [];
    const ctx = createTestContext({
      env: 'test',
      names: { bucket: 'test-bucket' },
      ports: { terminal: createScriptedTerminal({ interactive: false }) },
      logger: {
        info: (msg) => info.push(msg),
        warn: (msg) => warn.push(msg),
      },
    });
    const nodes: ResourceNode<OpsContext>[] = [
      {
        id: 'blank-error',
        dependsOn: [],
        title: 'blank error node',
        read: async () => {
          throw new Error('');
        },
        create: async () => undefined,
        delete: async () => undefined,
      },
    ];

    await status(ctx, nodes);

    expect(warn).toEqual(['blank error node: read failed ()']);
  });
});

describe('status (default node set)', () => {
  it('falls back to the production graph (buildNodes(ctx)) when no node set is given', async () => {
    // No fake nodes here - this exercises the real `buildNodes(ctx)` default,
    // over a context whose AWS clients reject every call (createTestContext's
    // default). Some production nodes' read() consults recorded state before
    // ever calling AWS (so they resolve present/missing without touching the
    // client), others call AWS straight away (so they land in the reject-all
    // transport and come back as an error) - which nodes do which is
    // nodes.test.ts's concern, not this one. The point here is only that the
    // default parameter really does reach every node in the production
    // graph, the way every existing call site (no second argument) relies on.
    const info: string[] = [];
    const warn: string[] = [];
    const ctx = createTestContext({
      logger: {
        info: (msg) => info.push(msg),
        warn: (msg) => warn.push(msg),
      },
    });

    await status(ctx);

    expect(stripColors(info[0] ?? '')).toBe(`Status for "${ctx.env}" (bucket ${ctx.names.bucket})`);
    // One status line - present/missing (info) or a failed read (warn) - per
    // node in the real graph; the heading is the one `info` line that isn't one.
    expect(info.length - 1 + warn.length).toBe(buildNodes(ctx).length);
  });
});

describe('colors sanity (the pinned tests above strip colour to stay readable)', () => {
  it('the present/missing marks really are coloured in the raw (non-stripped) output', async () => {
    const info: string[] = [];
    const ctx = createTestContext({
      names: { bucket: 'test-bucket' },
      state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
      ports: { terminal: createScriptedTerminal({ interactive: false }) },
      logger: { info: (msg) => info.push(msg) },
    });
    await status(ctx, fakeNodes());
    expect(info[1]).toBe(
      `  ${colors.green('present')}  state bucket ${colors.dim('{"name":"my-bucket"}')}`,
    );
  });
});

/*
 * `readNodeStatus` is the function task 15 extracts from `status` above, so
 * task 16's plugin `status` verb can hand it a plugin's own node set and
 * context instead of `buildNodes(ctx)` / `OpsContext`. These tests call it
 * directly - not through `status` - to pin that it (a) takes an arbitrary
 * node set and context, not just the CLI's production graph, and (b) is a
 * pure query: no logger writes, ever, even on the read-failure path.
 */
describe('readNodeStatus', () => {
  it('returns present/missing/error entries for an arbitrary node set', async () => {
    const ctx = createTestContext({
      state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
    });

    const entries = await readNodeStatus(fakeNodes(), ctx);

    expect(entries).toEqual([
      { title: 'state bucket', state: 'present', detail: '{"name":"my-bucket"}' },
      { title: 'cloudfront distribution', state: 'missing', detail: undefined },
      { title: 'exec role', state: 'error', detail: 'AccessDenied: iam:GetRole' },
    ]);
  });

  it('never writes to the logger, on either the happy or the read-failure path', async () => {
    const info: string[] = [];
    const warn: string[] = [];
    const ctx = createTestContext({
      state: { resources: { 'state-bucket': { name: 'my-bucket' } } },
      logger: {
        info: (msg) => info.push(msg),
        warn: (msg) => warn.push(msg),
      },
    });

    await readNodeStatus(fakeNodes(), ctx);

    expect(info).toEqual([]);
    expect(warn).toEqual([]);
  });
});
