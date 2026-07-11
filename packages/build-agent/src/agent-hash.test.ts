import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { agentSourceHash } from './agent-hash.js';

/**
 * Build a minimal workspace fixture mirroring the real layout: the hash
 * resolves the sibling core package and the workspace root (lockfile, base
 * tsconfig) relative to the agent dir, so the `packages/` level matters.
 */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-'));
  const agent = join(root, 'packages', 'build-agent');
  const core = join(root, 'packages', 'core');
  await mkdir(join(agent, 'src'), { recursive: true });
  await mkdir(join(core, 'src', 'aws'), { recursive: true });
  await writeFile(join(agent, 'Dockerfile'), 'FROM base\n');
  await writeFile(join(agent, 'package.json'), '{"name":"agent"}');
  await writeFile(join(agent, 'rolldown.config.ts'), 'export default {};');
  await writeFile(join(agent, 'tsconfig.json'), '{}');
  await writeFile(join(agent, 'src', 'server.ts'), 'export const s = 1;');
  await writeFile(join(core, 'package.json'), '{"name":"core"}');
  await writeFile(join(core, 'src', 'aws', 's3.ts'), 'export const s3 = 1;');
  await writeFile(join(root, 'tsconfig.base.json'), '{}');
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  return agent;
}

describe('agentSourceHash', () => {
  it('is deterministic and 12 hex chars', async () => {
    const dir = await fixture();
    const a = await agentSourceHash(dir);
    const b = await agentSourceHash(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('ignores test files', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, 'src', 'server.test.ts'), 'test only');
    expect(await agentSourceHash(dir)).toBe(before);
  });

  it('changes when build-agent source changes', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, 'src', 'server.ts'), 'export const s = 2;');
    expect(await agentSourceHash(dir)).not.toBe(before);
  });

  it('changes when the bundled ops-core source changes', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, '..', 'core', 'src', 'aws', 's3.ts'), 'export const s3 = 2;');
    expect(await agentSourceHash(dir)).not.toBe(before);
  });

  it('changes when the lockfile or bundler config changes', async () => {
    const dir = await fixture();
    const before = await agentSourceHash(dir);
    await writeFile(join(dir, '..', '..', 'pnpm-lock.yaml'), 'lockfileVersion: 9\n# bumped\n');
    const afterLock = await agentSourceHash(dir);
    expect(afterLock).not.toBe(before);
    await writeFile(join(dir, 'rolldown.config.ts'), 'export default { minify: true };');
    expect(await agentSourceHash(dir)).not.toBe(afterLock);
  });
});
